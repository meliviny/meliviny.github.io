import {
  buildTrackIdentity,
  choosePreferredSource,
  createPlaybackState,
  createQueue,
  createTrack,
  matchTrackIdentity,
} from './models.js';

export class LibraryEngine {
  constructor(storageManager) {
    this.storage = storageManager;
  }

  async addTrack(trackInput) {
    const normalized = createTrack(trackInput);
    await this.storage.write('tracks', normalized);
    return normalized;
  }

  async getTrack(trackId) {
    return this.storage.read('tracks', trackId);
  }

  async listTracks() {
    return this.storage.list('tracks');
  }

  async saveSettings(settings) {
    await this.storage.write('settings', settings);
    return settings;
  }

  async getSettings() {
    const existing = await this.storage.read('settings', 'app-settings');
    return existing || null;
  }

  async savePlaybackState(state) {
    const normalized = createPlaybackState(state);
    await this.storage.write('playbackState', normalized);
    return normalized;
  }

  async getPlaybackState() {
    return this.storage.read('playbackState', 'playback-state');
  }

  async saveQueue(queue) {
    const normalized = createQueue(queue);
    await this.storage.write('queues', normalized);
    return normalized;
  }

  async getQueue(queueId) {
    return this.storage.read('queues', queueId || 'default-queue');
  }

  async saveListeningHistory(historyEntry) {
    const payload = {
      id: historyEntry.id || `history-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      trackId: historyEntry.trackId || null,
      sourceId: historyEntry.sourceId || null,
      playedAt: historyEntry.playedAt || new Date().toISOString(),
      durationMs: Number(historyEntry.durationMs || 0),
      positionMs: Number(historyEntry.positionMs || 0),
      completionRatio: Number(historyEntry.completionRatio || 0),
      createdAt: historyEntry.createdAt || new Date().toISOString(),
    };

    await this.storage.write('listeningHistory', payload);
    return payload;
  }

  async getHistory() {
    return this.storage.list('listeningHistory');
  }

  mergeDuplicateSources(track, duplicateTrack) {
    const mergedSources = [...(track.sources || []), ...(duplicateTrack.sources || [])];
    const uniqueSources = mergedSources.filter((source, index, collection) => {
      return collection.findIndex((item) => item.url === source.url || item.name === source.name) === index;
    });

    const mergedTrack = {
      ...track,
      sources: uniqueSources,
      id: track.id || duplicateTrack.id || buildTrackIdentity({
        title: track.title || duplicateTrack.title,
        album: track.album || duplicateTrack.album,
        artists: [...(track.artists || []), ...(duplicateTrack.artists || [])],
      }),
      updatedAt: new Date().toISOString(),
    };

    const preferredSource = choosePreferredSource(mergedTrack, uniqueSources);
    mergedTrack.preferredSourceId = preferredSource?.id || null;
    return mergedTrack;
  }

  findDuplicateMatches(tracks = []) {
    const matches = [];

    for (let leftIndex = 0; leftIndex < tracks.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < tracks.length; rightIndex += 1) {
        const left = tracks[leftIndex];
        const right = tracks[rightIndex];
        const comparison = matchTrackIdentity(left, right);

        if (comparison.match) {
          matches.push({
            leftId: left.id,
            rightId: right.id,
            level: comparison.level,
            confidence: comparison.confidence,
          });
        }
      }
    }

    return matches;
  }

  selectPreferredSource(track, sourceOverrides = []) {
    const candidates = sourceOverrides.length ? sourceOverrides : (track.sources || []);
    return choosePreferredSource(track, candidates);
  }
}
