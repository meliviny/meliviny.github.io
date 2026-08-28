export class AudioPlayer {
  constructor(audioElement, onStateChange = () => {}) {
    this.audio = audioElement;
    this.onStateChange = onStateChange;
    this.track = null;
    this.source = null;
    this.error = null;
    this.bindEvents();
  }

  bindEvents() {
    if (!this.audio) {
      return;
    }

    this.audio.addEventListener('timeupdate', () => this.emitState());
    this.audio.addEventListener('loadedmetadata', () => this.emitState());
    this.audio.addEventListener('play', () => this.emitState());
    this.audio.addEventListener('pause', () => this.emitState());
    this.audio.addEventListener('ended', () => this.emitState());
    this.audio.addEventListener('error', () => {
      this.error = 'The selected source could not be played.';
      this.emitState();
    });
  }

  async loadTrack(track, source) {
    if (!this.audio || !track || !source?.url) {
      this.error = 'A playable track source is required.';
      this.emitState();
      return false;
    }

    this.audio.pause();
    this.audio.src = source.url;
    this.audio.load();
    this.track = track;
    this.source = source;
    this.error = null;
    this.emitState();
    return true;
  }

  async togglePlayback() {
    if (!this.audio || !this.track || !this.source) {
      this.error = 'Load a track with a playable source before starting playback.';
      this.emitState();
      return false;
    }

    try {
      if (this.audio.paused) {
        await this.audio.play();
      } else {
        this.audio.pause();
      }
      return true;
    } catch (error) {
      this.error = 'Playback was blocked or the source is unavailable.';
      this.emitState();
      return false;
    }
  }

  seekTo(positionSeconds) {
    if (!this.audio || !Number.isFinite(positionSeconds) || !this.audio.duration) {
      return;
    }

    this.audio.currentTime = Math.min(Math.max(positionSeconds, 0), this.audio.duration);
  }

  getState() {
    return {
      track: this.track,
      source: this.source,
      isPlaying: Boolean(this.audio && !this.audio.paused),
      positionSeconds: this.audio?.currentTime || 0,
      durationSeconds: Number.isFinite(this.audio?.duration) ? this.audio.duration : 0,
      error: this.error,
    };
  }

  emitState() {
    this.onStateChange(this.getState());
  }
}
