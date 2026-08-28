import { FIREBASE_CONFIG } from './config.js';

const FIREBASE_VERSION = '12.18.0';
const FIREBASE_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

const omitLocalData = (value) => {
  if (Array.isArray(value)) return value.map(omitLocalData);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value)
    .filter(([key, nested]) => {
      if (['handle', 'file', 'rawFile', 'blobUrl'].includes(key)) return false;
      if (key === 'url' && typeof nested === 'string' && nested.startsWith('blob:')) return false;
      if (key === 'path' && value.type === 'local') return false;
      return true;
    })
    .map(([key, nested]) => [key, omitLocalData(nested)]));
};

const errorMessage = (error) => {
  const messages = {
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/email-already-in-use': 'That email address is already registered.',
    'auth/weak-password': 'Choose a stronger password.',
    'auth/network-request-failed': 'Firebase is unavailable. Local mode will continue working.',
    'permission-denied': 'Cloud synchronization is not permitted for this account.',
  };
  return messages[error?.code] || error?.message || 'Firebase synchronization failed.';
};

export class FirebaseSync {
  constructor() {
    this.auth = null;
    this.db = null;
    this.modules = null;
    this.user = null;
    this.status = 'disabled';
    this.error = null;
    this.unsubscribeAuth = null;
    this.syncing = false;
  }

  async initialize(onAuthChange = () => {}) {
    if (!FIREBASE_CONFIG?.apiKey || !FIREBASE_CONFIG?.projectId) {
      this.status = 'disabled';
      return this.getState();
    }

    try {
      const appModule = await import(`${FIREBASE_BASE}/firebase-app.js`);
      const authModule = await import(`${FIREBASE_BASE}/firebase-auth.js`);
      const firestoreModule = await import(`${FIREBASE_BASE}/firebase-firestore.js`);
      const app = appModule.initializeApp(FIREBASE_CONFIG);
      this.auth = authModule.getAuth(app);
      this.db = firestoreModule.getFirestore(app);
      this.modules = { ...authModule, ...firestoreModule };
      this.status = 'ready';
      this.unsubscribeAuth = authModule.onAuthStateChanged(this.auth, (user) => {
        this.user = user;
        this.status = user ? 'signed-in' : 'signed-out';
        onAuthChange(this.getState());
      });
    } catch (error) {
      this.status = 'unavailable';
      this.error = errorMessage(error);
    }
    return this.getState();
  }

  async signUp(email, password) {
    if (!this.auth) throw new Error('Authentication is unavailable.');
    try {
      const result = await this.modules.createUserWithEmailAndPassword(this.auth, email, password);
      return result.user;
    } catch (error) {
      throw new Error(errorMessage(error));
    }
  }

  async signIn(email, password) {
    if (!this.auth) throw new Error('Authentication is unavailable.');
    try {
      const result = await this.modules.signInWithEmailAndPassword(this.auth, email, password);
      return result.user;
    } catch (error) {
      throw new Error(errorMessage(error));
    }
  }

  async signOut() {
    if (this.auth) await this.modules.signOut(this.auth);
  }

  async writeMetadata(collection, id, value) {
    if (!this.db || !this.user) return { synced: false, reason: 'local-only' };
    const safeValue = omitLocalData(value);
    await this.modules.setDoc(this.modules.doc(this.db, 'users', this.user.uid, collection, id), {
      ...safeValue,
      updatedAt: this.modules.serverTimestamp(),
      clientUpdatedAt: value.updatedAt || new Date().toISOString(),
    }, { merge: true });
    return { synced: true };
  }

  async readMetadata(collection, id) {
    if (!this.db || !this.user) return null;
    const snapshot = await this.modules.getDoc(this.modules.doc(this.db, 'users', this.user.uid, collection, id));
    return snapshot.exists() ? snapshot.data() : null;
  }

  async syncLocalState(storage) {
    if (!this.db || !this.user || this.syncing) return { synced: false, reason: 'local-only' };
    this.syncing = true;
    try {
      const settings = await storage.read('settings', 'app-settings');
      const playback = await storage.read('playbackState', 'playback-state');
      const queue = await storage.read('queues', 'default-queue');
      const sources = (await storage.list('musicSources')).map(omitLocalData).filter((source) => source.type !== 'local');
      const device = await storage.read('deviceInfo', 'device-info');
      const history = await storage.list('listeningHistory');
      if (settings) await this.writeMetadata('settings', 'app-settings', settings);
      if (playback) await this.writeMetadata('playback', 'playback-state', playback);
      if (queue) await this.writeMetadata('queues', 'default-queue', queue);
      if (device) await this.writeMetadata('devices', device.id, device);
      for (const source of sources) await this.writeMetadata('sources', source.id, source);
      for (const entry of history) await this.writeMetadata('history', entry.id, entry);
      return { synced: true };
    } catch (error) {
      this.status = 'sync-error';
      this.error = errorMessage(error);
      return { synced: false, error: this.error };
    } finally {
      this.syncing = false;
    }
  }

  getState() {
    return {
      status: this.status,
      user: this.user ? { uid: this.user.uid, email: this.user.email } : null,
      error: this.error,
    };
  }

  dispose() {
    this.unsubscribeAuth?.();
  }
}

export const firebaseSync = new FirebaseSync();
