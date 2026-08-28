import { createMusicSource, createTrack, matchTrackIdentity } from './models.js';

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'webm']);
const TEMPORARY_NAME = /(^\.|~$|\.tmp$|\.part$|\.crdownload$)/i;

const extensionOf = (name) => name.split('.').pop()?.toLowerCase() || '';
const isSupportedAudio = (file) => AUDIO_EXTENSIONS.has(extensionOf(file.name));
const isIgnoredName = (name) => TEMPORARY_NAME.test(name);
const fileFingerprint = (file, relativePath) => `${relativePath}|${file.size}|${file.lastModified}`;

export class LocalSourceManager {
  constructor(storageManager, libraryEngine) {
    this.storage = storageManager;
    this.library = libraryEngine;
    this.sources = [];
    this.objectUrls = new Map();
  }

  get supportsDirectoryPicker() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  }

  async loadSources() {
    const saved = await this.storage.list('musicSources');
    this.sources = saved
      .filter((source) => source.type === 'local')
      .map((source) => ({
        ...source,
        available: source.available !== false,
        accessible: source.accessible !== false,
        requiresReconnect: Boolean(source.requiresReconnect && source.available === false),
      }));
    return this.sources;
  }

  async addDirectory() {
    if (!this.supportsDirectoryPicker) {
      return { supported: false, source: null };
    }

    let handle;
    try {
      handle = await window.showDirectoryPicker({ mode: 'read' });
      const permission = await this.ensurePermission(handle, false);
      if (permission !== 'granted') {
        return { supported: true, denied: true, source: null };
      }
    } catch (error) {
      if (error.name === 'AbortError') return { supported: true, cancelled: true, source: null };
      throw error;
    }

    for (const existing of this.sources) {
      if (existing.handle?.isSameEntry && await existing.handle.isSameEntry(handle)) {
        return { supported: true, source: existing, alreadyConnected: true };
      }
    }

    const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    const source = createMusicSource({
      id: `local-folder-${randomId}`,
      type: 'local',
      name: handle.name,
      accessible: true,
      available: true,
      browserSupport: 'supported',
      supportedFormats: [...AUDIO_EXTENSIONS],
      handle,
    });
    source.handle = handle;
    this.sources.push(source);
    await this.storage.write('musicSources', source);
    return { supported: true, source };
  }

  async ensurePermission(handle, request = true) {
    if (!handle?.queryPermission) return 'granted';
    const current = await handle.queryPermission({ mode: 'read' });
    if (current === 'granted' || !request) return current;
    return handle.requestPermission({ mode: 'read' });
  }

  async scanSource(source, onProgress = () => {}) {
    const handle = source.handle;
    if (!handle) {
      const cachedTracks = await this.library.listTracks();
      const tracks = cachedTracks.filter((track) => track.sources?.some((candidate) => candidate.sourceId === source.id && candidate.type === 'local'));
      const restored = {
        ...source,
        available: source.available !== false,
        accessible: source.accessible !== false,
        requiresReconnect: false,
        updatedAt: new Date().toISOString(),
      };

      if (source.available !== false || source.accessible !== false || tracks.length) {
        await this.storage.write('musicSources', restored);
        this.sources = this.sources.map((item) => item.id === source.id ? restored : item);
        return { source: restored, tracks, missing: false };
      }

      const unavailable = { ...source, available: false, accessible: false, requiresReconnect: true, updatedAt: new Date().toISOString() };
      await this.storage.write('musicSources', unavailable);
      return { source: unavailable, tracks: [], missing: true };
    }

    const permission = await this.ensurePermission(handle, true);
    if (permission !== 'granted') {
      const unavailable = { ...source, available: false, accessible: false, requiresReconnect: true, updatedAt: new Date().toISOString() };
      await this.storage.write('musicSources', unavailable);
      return { source: unavailable, tracks: [], denied: true };
    }

    const discovered = [];
    await this.walk(handle, '', discovered, onProgress);
    const existing = await this.library.listTracks();
    const tracks = [];
    const workingTracks = [...existing];
    const discoveredFingerprints = new Set(discovered.map((item) => item.fingerprint));

    for (const existingTrack of existing) {
      const sourceChanged = existingTrack.sources?.some((candidate) => candidate.sourceId === source.id && !discoveredFingerprints.has(candidate.fingerprint));
      if (sourceChanged) {
        const updated = {
          ...existingTrack,
          sources: existingTrack.sources.map((candidate) => candidate.sourceId === source.id && !discoveredFingerprints.has(candidate.fingerprint)
            ? { ...candidate, available: false, accessible: false }
            : candidate),
          updatedAt: new Date().toISOString(),
        };
        await this.storage.write('tracks', updated);
      }
    }

    for (const item of discovered) {
      const previous = existing.find((track) => track.sources?.some((candidate) => candidate.fingerprint === item.fingerprint && candidate.sourceId === source.id));
      const objectUrl = URL.createObjectURL(item.file);
      const sourceCandidate = { id: `${source.id}:${item.fingerprint}`, sourceId: source.id, type: 'local', name: item.file.name, url: objectUrl, fingerprint: item.fingerprint, available: true, accessible: true, browserSupport: 'supported', size: item.file.size };
      const previousUrl = this.objectUrls.get(`${source.id}:${item.fingerprint}`);
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      this.objectUrls.set(`${source.id}:${item.fingerprint}`, objectUrl);
      if (previous) {
        const updated = { ...previous, sources: previous.sources.map((candidate) => candidate.fingerprint === item.fingerprint && candidate.sourceId === source.id ? sourceCandidate : candidate), updatedAt: new Date().toISOString() };
        await this.storage.write('tracks', updated);
        tracks.push(updated);
        continue;
      }

      const track = createTrack({
        title: item.file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled track',
        artists: [],
        album: '',
        duration: 0,
        format: extensionOf(item.file.name),
        filename: item.file.name,
        folder: item.relativePath.split('/').slice(0, -1).join('/') || null,
        metadataOrigin: 'filename',
        sources: [sourceCandidate],
      });
      const duplicate = workingTracks.find((candidate) => matchTrackIdentity(candidate, track).match);
      if (duplicate) {
        const merged = this.library.mergeDuplicateSources(duplicate, track);
        await this.storage.write('tracks', merged);
        const duplicateIndex = workingTracks.findIndex((candidate) => candidate.id === duplicate.id);
        if (duplicateIndex >= 0) workingTracks[duplicateIndex] = merged;
        tracks.push(merged);
      } else {
        await this.storage.write('tracks', track);
        workingTracks.push(track);
        tracks.push(track);
      }
    }

    const refreshed = { ...source, available: true, accessible: true, requiresReconnect: false, lastScanAt: new Date().toISOString(), fileCount: discovered.length, updatedAt: new Date().toISOString() };
    await this.storage.write('musicSources', refreshed);
    this.sources = this.sources.map((item) => item.id === source.id ? refreshed : item);
    return { source: refreshed, tracks, missing: false };
  }

  async walk(directory, parentPath, discovered, onProgress) {
    for await (const entry of directory.values()) {
      if (isIgnoredName(entry.name)) continue;
      const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        await this.walk(entry, relativePath, discovered, onProgress);
      } else if (entry.kind === 'file' && isSupportedAudio(entry)) {
        const file = await entry.getFile();
        discovered.push({ file, relativePath, fingerprint: fileFingerprint(file, relativePath) });
        onProgress(discovered.length);
      }
    }
  }

  async removeSource(sourceId) {
    this.sources = this.sources.filter((source) => source.id !== sourceId);
    await this.storage.delete('musicSources', sourceId);
    const tracks = await this.library.listTracks();
    for (const track of tracks) {
      const hasSource = track.sources?.some((source) => source.sourceId === sourceId);
      if (!hasSource) continue;
      const updated = {
        ...track,
        sources: track.sources.map((source) => source.sourceId === sourceId
          ? { ...source, available: false, accessible: false }
          : source),
        updatedAt: new Date().toISOString(),
      };
      await this.storage.write('tracks', updated);
    }
    [...this.objectUrls.keys()].filter((key) => key.startsWith(`${sourceId}:`)).forEach((key) => {
      URL.revokeObjectURL(this.objectUrls.get(key));
      this.objectUrls.delete(key);
    });
  }

  async reconnect(sourceId) {
    const result = await this.addDirectory();
    if (!result.source) return result;
    const oldSource = this.sources.find((source) => source.id === sourceId);
    if (oldSource) await this.removeSource(sourceId);
    return result;
  }

  async refreshAll(onProgress) {
    const results = [];
    for (const source of this.sources) results.push(await this.scanSource(source, onProgress));
    return results;
  }

  dispose() {
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls.clear();
  }
}
