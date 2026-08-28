import { APP_CONFIG } from './config.js';
import { createMusicSource, createTrack, matchTrackIdentity } from './models.js';

const CACHE_ID = 'server-library-cache';
const SUPPORTED_FORMATS = new Set(['mp3', 'wav', 'flac', 'webm']);

const extensionOf = (url = '') => url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() || '';
const asArray = (value) => Array.isArray(value) ? value : [];
const isSupportedAudio = (url) => SUPPORTED_FORMATS.has(extensionOf(url));
const isSafeRemoteUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export const validateLibraryManifest = (manifest) => {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['Manifest must be an object.'] };
  }

  const errors = [];
  if (manifest.version === undefined && manifest.libraryVersion === undefined) errors.push('Manifest version is missing.');
  if (!Array.isArray(manifest.tracks)) errors.push('Manifest tracks must be an array.');
  if (manifest.artists !== undefined && !Array.isArray(manifest.artists)) errors.push('Manifest artists must be an array.');
  if (manifest.albums !== undefined && !Array.isArray(manifest.albums)) errors.push('Manifest albums must be an array.');
  return { valid: errors.length === 0, errors };
};

const manifestTrackToModel = (entry, source) => {
  const audioUrl = entry.audioUrl || entry.audio || entry.url || entry.audioRef;
  if (!audioUrl || !isSafeRemoteUrl(audioUrl) || !isSupportedAudio(audioUrl)) return null;
  const artists = asArray(entry.artists).length ? entry.artists : (entry.artist ? [entry.artist] : []);
  return createTrack({
    id: entry.id || entry.trackId,
    title: entry.title || entry.name,
    artists,
    album: entry.album?.title || entry.album || '',
    albumArtist: entry.albumArtist,
    genre: entry.genre,
    year: entry.year,
    duration: entry.durationMs ?? entry.duration,
    format: entry.format || extensionOf(audioUrl),
    artwork: (entry.artwork || entry.artworkUrl) && isSafeRemoteUrl(entry.artwork || entry.artworkUrl) ? { url: entry.artwork || entry.artworkUrl } : null,
    folder: entry.folder,
    filename: entry.filename || audioUrl.split('/').pop(),
    metadataOrigin: entry.metadataOrigin || 'server-manifest',
    quality: entry.quality,
    rawMetadata: entry.metadata || {},
    sources: [{
      id: `${source.id}:${entry.id || audioUrl}`,
      sourceId: source.id,
      type: 'server',
      url: audioUrl,
      name: entry.filename || audioUrl.split('/').pop(),
      available: true,
      accessible: true,
      browserSupport: SUPPORTED_FORMATS.has(extensionOf(audioUrl)) ? 'supported' : 'unknown',
      quality: entry.quality || 'normal',
      size: entry.size,
    }],
  });
};

export class ServerLibraryManager {
  constructor(storageManager, libraryEngine, config = APP_CONFIG.serverLibrary) {
    this.storage = storageManager;
    this.library = libraryEngine;
    this.config = config;
    this.source = createMusicSource({
      id: config.id,
      type: 'server',
      name: config.name,
      url: config.manifestUrl,
      baseUrl: config.manifestUrl,
      available: false,
      accessible: true,
      browserSupport: 'supported',
    });
    this.manifest = null;
    this.tracks = [];
    this.status = 'not-checked';
  }

  async initialize() {
    const savedSource = await this.storage.read('musicSources', this.config.id);
    const cached = await this.storage.read('serverLibraryCache', CACHE_ID);
    this.source = { ...this.source, ...savedSource, enabled: savedSource?.enabled ?? this.config.enabled };
    if (cached?.manifest) {
      this.manifest = cached.manifest;
      this.tracks = this.normalizeTracks(cached.manifest);
      this.status = 'cached';
    }
    return this.getState();
  }

  async refresh() {
    if (!this.source.enabled) {
      this.status = 'disabled';
      return this.getState();
    }

    this.status = 'refreshing';
    try {
      const response = await fetch(this.source.url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Manifest request failed (${response.status}).`);
      const manifest = await response.json();
      const validation = validateLibraryManifest(manifest);
      if (!validation.valid) throw new Error(validation.errors.join(' '));
      this.manifest = manifest;
      this.tracks = this.normalizeTracks(manifest);
      this.source = { ...this.source, available: true, accessible: true, lastRefreshAt: new Date().toISOString(), trackCount: this.tracks.length, error: null };
      this.status = 'available';
      await this.storage.write('musicSources', this.source);
      await this.storage.write('serverLibraryCache', { id: CACHE_ID, manifest, cachedAt: new Date().toISOString() });
      await this.persistTracks();
    } catch (error) {
      this.source = { ...this.source, available: false, error: error.message, lastFailureAt: new Date().toISOString() };
      this.status = this.manifest ? 'cached-unavailable' : 'unavailable';
      await this.storage.write('musicSources', this.source);
    }
    return this.getState();
  }

  normalizeTracks(manifest) {
    return asArray(manifest.tracks).map((entry) => manifestTrackToModel(entry, this.source)).filter(Boolean);
  }

  async persistTracks() {
    const localTracks = (await this.library.listTracks()).filter((track) => !track.sources?.some((source) => source.sourceId === this.source.id));
    for (const serverTrack of this.tracks) {
      const duplicate = localTracks.find((track) => matchTrackIdentity(track, serverTrack).match);
      if (duplicate) await this.storage.write('tracks', this.library.mergeDuplicateSources(duplicate, serverTrack));
      else await this.storage.write('tracks', serverTrack);
    }
  }

  async setEnabled(enabled) {
    this.source = { ...this.source, enabled: Boolean(enabled) };
    await this.storage.write('musicSources', this.source);
    if (this.source.enabled && this.status === 'not-checked') await this.refresh();
    if (!this.source.enabled) this.status = 'disabled';
    return this.getState();
  }

  async configure(manifestUrl) {
    const url = String(manifestUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('Use a complete HTTP or HTTPS manifest URL.');
    this.source = { ...this.source, url, baseUrl: url, error: null };
    await this.storage.write('musicSources', this.source);
    return this.refresh();
  }

  getState() {
    return { source: this.source, manifest: this.manifest, tracks: this.tracks, status: this.status, cached: this.status === 'cached' || this.status === 'cached-unavailable' };
  }
}
