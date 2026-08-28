const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'bass-boost': [6, 5, 4, 2, 1, 0, 0, 0, 0, 0],
  vocal: [-2, -1, 0, 2, 4, 4, 3, 2, 1, 0],
  treble: [0, 0, 0, 0, 1, 2, 3, 4, 5, 6],
  classical: [3, 2, 1, 0, -1, -1, 0, 2, 3, 4],
};

const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export class AudioEngine {
  constructor(audioElement, onStateChange = () => {}, persistence = null) {
    this.audio = audioElement;
    this.onStateChange = onStateChange;
    this.persistence = persistence;
    this.track = null;
    this.source = null;
    this.queue = [];
    this.currentIndex = -1;
    this.repeatMode = 'off';
    this.shuffle = false;
    this.shuffledOrder = [];
    this.error = null;
    this.status = 'idle';
    this.context = null;
    this.sourceNode = null;
    this.eqFilters = [];
    this.outputNode = null;
    this.monoNodes = null;
    this.monoEnabled = false;
    this.muted = false;
    this.lastPersistedSecond = -1;
    this.bindEvents();
    this.bindMediaSession();
  }

  bindEvents() {
    if (!this.audio) return;
    this.audio.addEventListener('loadstart', () => this.setStatus('loading'));
    this.audio.addEventListener('waiting', () => this.setStatus('buffering'));
    this.audio.addEventListener('canplay', () => this.setStatus(this.audio.paused ? 'paused' : 'playing'));
    this.audio.addEventListener('timeupdate', () => {
      const second = Math.floor(this.audio.currentTime);
      if (second !== this.lastPersistedSecond) {
        this.lastPersistedSecond = second;
        this.persistPosition();
      }
      this.emitState();
    });
    this.audio.addEventListener('play', () => this.setStatus('playing'));
    this.audio.addEventListener('pause', () => this.setStatus('paused'));
    this.audio.addEventListener('ended', () => { this.handleEnded(); });
    this.audio.addEventListener('error', () => {
      this.error = `This source could not be played${this.audio.error?.message ? `: ${this.audio.error.message}` : '.'}`;
      this.setStatus('error');
    });
  }

  bindMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const actions = {
      play: () => this.play(),
      pause: () => this.pause(),
      nexttrack: () => this.next(),
      previoustrack: () => this.previous(),
      seekbackward: () => this.seekTo((this.audio?.currentTime || 0) - 10),
      seekforward: () => this.seekTo((this.audio?.currentTime || 0) + 10),
    };
    Object.entries(actions).forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
    });
  }

  loadTrack(track, source, options = {}) {
    if (!this.audio || !track || !source?.url) {
      this.error = 'A playable track source is required.';
      this.setStatus('error');
      return false;
    }

    this.audio.pause();
    this.track = track;
    this.source = source;
    this.error = null;
    this.status = 'loading';
    this.audio.src = source.url;
    this.audio.load();
    this.updateMediaSession();

    if (options.restorePosition && this.persistence) {
      this.persistence.read('playbackState', 'playback-state').then((saved) => {
        if (this.track?.id !== track.id || this.source?.id !== source.id) return;
        if (saved?.currentTrackId === track.id && saved.positionMs > 0) {
          this.audio.addEventListener('loadedmetadata', () => this.seekTo(saved.positionMs / 1000), { once: true });
        }
      });
    }
    this.emitState();
    return true;
  }

  setQueue(tracks, startIndex = 0) {
    this.queue = Array.isArray(tracks) ? tracks.filter((item) => item?.track && item?.source) : [];
    this.currentIndex = this.queue.length ? Math.min(Math.max(startIndex, 0), this.queue.length - 1) : -1;
    this.rebuildShuffle();
    this.persistQueue();
    this.emitState();
  }

  addToQueue(item) { if (item?.track && item?.source) this.queue.push(item); this.rebuildShuffle(); this.persistQueue(); this.emitState(); }
  removeFromQueue(index) { if (index >= 0 && index < this.queue.length) { this.queue.splice(index, 1); if (index <= this.currentIndex) this.currentIndex -= 1; this.rebuildShuffle(); this.persistQueue(); this.emitState(); } }
  clearQueue() { this.queue = this.track && this.source ? [{ track: this.track, source: this.source }] : []; this.currentIndex = this.queue.length ? 0 : -1; this.persistQueue(); this.emitState(); }
  reorderQueue(from, to) {
    if (from < 0 || to < 0 || from >= this.queue.length || to >= this.queue.length || from === to) return;
    const [item] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, item);
    if (this.currentIndex === from) this.currentIndex = to;
    else if (from < this.currentIndex && to >= this.currentIndex) this.currentIndex -= 1;
    else if (from > this.currentIndex && to <= this.currentIndex) this.currentIndex += 1;
    this.persistQueue();
    this.emitState();
  }

  async next() {
    if (!this.queue.length) return false;
    if (this.repeatMode === 'repeat-one') return this.restartCurrent();
    const nextIndex = this.shuffle ? this.nextShuffleIndex() : this.currentIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.repeatMode !== 'repeat-all') { this.setStatus('ended'); return false; }
      this.currentIndex = this.shuffle ? this.shuffledOrder[0] : 0;
    } else this.currentIndex = nextIndex;
    const item = this.queue[this.currentIndex];
    await this.loadTrack(item.track, item.source);
    return this.play();
  }

  async previous() {
    if (!this.queue.length) return false;
    if (this.audio?.currentTime > 3) { this.seekTo(0); return true; }
    this.currentIndex = this.currentIndex <= 0 ? (this.repeatMode === 'repeat-all' ? this.queue.length - 1 : 0) : this.currentIndex - 1;
    const item = this.queue[this.currentIndex];
    await this.loadTrack(item.track, item.source);
    return this.play();
  }

  async play() {
    if (!this.audio || !this.track || !this.source) { this.error = 'Select a track before starting playback.'; this.setStatus('error'); return false; }
    try { await this.audio.play(); return true; } catch { this.error = 'Playback was blocked or this source is unavailable.'; this.setStatus('error'); return false; }
  }
  pause() { this.audio?.pause(); }
  togglePlayback() { return this.audio?.paused ? this.play() : (this.pause(), Promise.resolve(true)); }
  seekTo(seconds) { if (this.audio && Number.isFinite(seconds) && Number.isFinite(this.audio.duration)) this.audio.currentTime = Math.min(Math.max(seconds, 0), this.audio.duration); this.emitState(); }
  setVolume(value) { if (this.audio) this.audio.volume = Math.min(Math.max(Number(value), 0), 1); this.emitState(); }
  toggleMute() { if (!this.audio) return; this.muted = !this.muted; this.audio.muted = this.muted; this.emitState(); }
  setRepeatMode(mode) { if (['off', 'repeat-all', 'repeat-one'].includes(mode)) this.repeatMode = mode; this.emitState(); }
  setShuffle(enabled) { this.shuffle = Boolean(enabled); this.rebuildShuffle(); this.emitState(); }

  async setEqPreset(preset) {
    const gains = EQ_PRESETS[preset] || EQ_PRESETS.flat;
    await this.ensureAudioGraph();
    this.eqFilters.forEach((filter, index) => { filter.gain.value = gains[index]; });
    this.emitState();
  }

  async ensureAudioGraph() {
    if (!this.audio || this.sourceNode || !window.AudioContext && !window.webkitAudioContext) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    this.context = new Context();
    this.sourceNode = this.context.createMediaElementSource(this.audio);
    this.eqFilters = EQ_FREQUENCIES.map((frequency) => { const filter = this.context.createBiquadFilter(); filter.type = 'peaking'; filter.frequency.value = frequency; filter.Q.value = 1; filter.gain.value = 0; return filter; });
    this.eqFilters.reduce((input, filter) => input.connect(filter), this.sourceNode);
    this.outputNode = this.eqFilters.at(-1);
    this.rewireOutput();
  }

  rewireOutput() {
    if (!this.context || !this.outputNode) return;
    try { this.outputNode.disconnect(); } catch { /* already disconnected */ }
    this.monoNodes?.merger.disconnect();
    this.monoNodes = null;
    if (this.monoEnabled) this.connectMono(this.outputNode); else this.outputNode.connect(this.context.destination);
  }

  connectMono(input) {
    if (!this.context) return;
    const splitter = this.context.createChannelSplitter(2);
    const merger = this.context.createChannelMerger(2);
    const left = this.context.createGain(); const right = this.context.createGain();
    left.gain.value = 0.5; right.gain.value = 0.5;
    input.connect(splitter); splitter.connect(left, 0); splitter.connect(right, 1);
    left.connect(merger, 0, 0); left.connect(merger, 0, 1); right.connect(merger, 0, 0); right.connect(merger, 0, 1); merger.connect(this.context.destination);
    this.monoNodes = { splitter, merger, left, right };
  }
  setMono(enabled) { this.monoEnabled = Boolean(enabled); this.rewireOutput(); this.emitState(); }

  async handleEnded() {
    if (this.repeatMode === 'repeat-one') {
      await this.restartCurrent();
      return;
    }

    const movedToNext = await this.next();
    if (!movedToNext) this.setStatus('ended');
  }
  restartCurrent() { this.seekTo(0); return this.play(); }
  rebuildShuffle() { this.shuffledOrder = this.queue.map((_, index) => index); if (!this.shuffle) return; for (let index = this.shuffledOrder.length - 1; index > 0; index -= 1) { const swap = (index * 17 + this.queue.length) % (index + 1); [this.shuffledOrder[index], this.shuffledOrder[swap]] = [this.shuffledOrder[swap], this.shuffledOrder[index]]; } }
  nextShuffleIndex() { const position = this.shuffledOrder.indexOf(this.currentIndex); return this.shuffledOrder[position + 1] ?? this.queue.length; }
  setStatus(status) {
    this.status = status;
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = status === 'playing' ? 'playing' : 'paused'; } catch { /* unavailable */ }
    }
    this.emitState();
  }
  persistPosition() { if (!this.persistence || !this.track) return; this.persistence.write('playbackState', { id: 'playback-state', currentTrackId: this.track.id, positionMs: Math.round((this.audio?.currentTime || 0) * 1000), durationMs: Math.round((this.audio?.duration || 0) * 1000), isPlaying: false, sourceId: this.source?.id || null, queueId: 'default-queue', volume: this.audio?.volume || 0.8, updatedAt: new Date().toISOString() }); }
  persistQueue() { if (this.persistence) this.persistence.write('queues', { id: 'default-queue', name: 'Now playing', items: this.queue.map((item) => item.track.id), currentIndex: this.currentIndex, updatedAt: new Date().toISOString() }); }
  updateMediaSession() { if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !this.track || typeof MediaMetadata === 'undefined') return; navigator.mediaSession.metadata = new MediaMetadata({ title: this.track.title, artist: this.track.artistNames?.join(', ') || this.track.artists?.join(', ') || 'Unknown artist', album: this.track.album || 'Unknown album', artwork: this.track.artwork?.url ? [{ src: this.track.artwork.url }] : [] }); }
  getState() { return { track: this.track, source: this.source, queue: this.queue, currentIndex: this.currentIndex, repeatMode: this.repeatMode, shuffle: this.shuffle, isPlaying: Boolean(this.audio && !this.audio.paused), status: this.status, positionSeconds: this.audio?.currentTime || 0, durationSeconds: Number.isFinite(this.audio?.duration) ? this.audio.duration : 0, volume: this.audio?.volume ?? 0.8, muted: this.muted, mono: this.monoEnabled, error: this.error }; }
  emitState() { this.onStateChange(this.getState()); }
}

export { EQ_PRESETS };
export const AudioPlayer = AudioEngine;
