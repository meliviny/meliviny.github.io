import { STORAGE_SCHEMA_VERSION } from './models.js';

const DB_NAME = 'meliviny-db';
const DB_STORES = {
  tracks: 'tracks',
  artists: 'artists',
  albums: 'albums',
  playlists: 'playlists',
  folders: 'folders',
  musicSources: 'musicSources',
  playbackState: 'playbackState',
  queues: 'queues',
  listeningHistory: 'listeningHistory',
  settings: 'settings',
  deviceInfo: 'deviceInfo',
};

export class StorageManager {
  constructor() {
    this.dbPromise = null;
    this.useFallback = false;
  }

  async open() {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = this.createDatabase();
    return this.dbPromise;
  }

  async createDatabase() {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      this.useFallback = true;
      return null;
    }

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, STORAGE_SCHEMA_VERSION);

      request.onupgradeneeded = (event) => {
        const database = event.target.result;

        Object.values(DB_STORES).forEach((storeName) => {
          if (!database.objectStoreNames.contains(storeName)) {
            database.createObjectStore(storeName, { keyPath: 'id' });
          }
        });
      };

      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => {
        console.warn('Meliviny IndexedDB unavailable. Falling back to localStorage.', event);
        this.useFallback = true;
        resolve(null);
      };
    });
  }

  async read(storeName, key) {
    try {
      const database = await this.open();

      if (!database) {
        return this.readFallback(storeName, key);
      }

      return new Promise((resolve) => {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(this.readFallback(storeName, key));
      });
    } catch (error) {
      console.warn(`Meliviny storage read failed for ${storeName}.`, error);
      return this.readFallback(storeName, key);
    }
  }

  async write(storeName, value) {
    try {
      const database = await this.open();

      if (!database) {
        return this.writeFallback(storeName, value);
      }

      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(value);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => {
          console.warn(`IndexedDB write failed for ${storeName}.`, event);
          resolve(this.writeFallback(storeName, value));
        };
      });
    } catch (error) {
      console.warn(`Meliviny storage write failed for ${storeName}.`, error);
      return this.writeFallback(storeName, value);
    }
  }

  async list(storeName) {
    try {
      const database = await this.open();

      if (!database) {
        return this.listFallback(storeName);
      }

      return new Promise((resolve) => {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve(this.listFallback(storeName));
      });
    } catch (error) {
      console.warn(`Meliviny storage list failed for ${storeName}.`, error);
      return this.listFallback(storeName);
    }
  }

  async bulkWrite(storeName, values) {
    const items = Array.isArray(values) ? values : [values];

    for (const item of items) {
      await this.write(storeName, item);
    }

    return items;
  }

  async clear(storeName) {
    try {
      const database = await this.open();
      if (!database) {
        return this.clearFallback(storeName);
      }

      return new Promise((resolve) => {
        const transaction = database.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(this.clearFallback(storeName));
      });
    } catch (error) {
      console.warn(`Meliviny clear failed for ${storeName}.`, error);
      return this.clearFallback(storeName);
    }
  }

  async delete(storeName, key) {
    try {
      const database = await this.open();
      if (!database) {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(this.getFallbackKey(storeName, key));
        return true;
      }

      return new Promise((resolve) => {
        const transaction = database.transaction(storeName, 'readwrite');
        const request = transaction.objectStore(storeName).delete(key);
        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(false);
      });
    } catch (error) {
      console.warn(`Meliviny storage delete failed for ${storeName}.`, error);
      return false;
    }
  }

  readFallback(storeName, key) {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    const raw = localStorage.getItem(this.getFallbackKey(storeName, key));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`Meliviny found corrupted fallback data for ${storeName}.`, error);
      localStorage.removeItem(this.getFallbackKey(storeName, key));
      return null;
    }
  }

  writeFallback(storeName, value) {
    if (typeof localStorage === 'undefined' || !value || !value.id) {
      return null;
    }

    try {
      localStorage.setItem(this.getFallbackKey(storeName, value.id), JSON.stringify(value));
      return value;
    } catch (error) {
      console.warn('Meliviny localStorage quota exceeded.', error);
      return null;
    }
  }

  listFallback(storeName) {
    if (typeof localStorage === 'undefined') {
      return [];
    }

    const prefix = `${DB_NAME}:${storeName}:`;
    const values = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(prefix)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            values.push(JSON.parse(raw));
          } catch {
            // ignore corrupted entries
          }
        }
      }
    }

    return values;
  }

  clearFallback(storeName) {
    if (typeof localStorage === 'undefined') {
      return true;
    }

    const prefix = `${DB_NAME}:${storeName}:`;
    const itemsToRemove = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(prefix)) {
        itemsToRemove.push(key);
      }
    }

    itemsToRemove.forEach((key) => localStorage.removeItem(key));
    return true;
  }

  getFallbackKey(storeName, key) {
    return `${DB_NAME}:${storeName}:${String(key)}`;
  }
}

export const storage = new StorageManager();
export const DB_STORE_NAMES = DB_STORES;
