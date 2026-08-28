import { createAppSettings } from './models.js';
import { storage } from './storage.js';
import { LibraryEngine } from './library.js';
import { createAppRuntime } from './ui-state.js';
import { AudioPlayer } from './player.js';
import { LocalSourceManager } from './local-sources.js';

const appState = {
  ready: false,
  supportsServiceWorker: 'serviceWorker' in navigator,
  supportsModules: !!document.querySelector('script[type="module"]'),
  theme: 'system',
  accent: 'violet',
};

const runtime = createAppRuntime({
  ui: {
    theme: appState.theme,
    accent: appState.accent,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    sidebarCollapsed: false,
    selectedSource: 'local',
    activeSection: 'home',
  },
});

let audioPlayer = null;
let localSources = null;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const hexToHsl = (hex) => {
  const normalized = hex.replace('#', '');
  const fullHex = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;

  const num = Number.parseInt(fullHex, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;

  if (delta !== 0) {
    if (max === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (max === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
  }

  hue = Math.round(hue * 60);
  if (hue < 0) {
    hue += 360;
  }

  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  return {
    h: clamp(Math.round(hue), 0, 360),
    s: clamp(Math.round(saturation * 100), 10, 95),
    l: clamp(Math.round(lightness * 100), 30, 70),
  };
};

const applyAccentStyle = (value) => {
  const root = document.body;
  const customInput = document.getElementById('custom-accent');

  if (value && value !== 'custom') {
    root.dataset.accent = value;
    root.style.setProperty('--base-hue', value === 'violet' ? 253 : value === 'teal' ? 176 : value === 'rose' ? 348 : 43);
    root.style.setProperty('--base-sat', '90%');
    if (customInput) {
      customInput.value = value === 'violet' ? '#8b5cf6' : value === 'teal' ? '#2dd4bf' : value === 'rose' ? '#fb7185' : '#fbbf24';
    }
    runtime.ui.accent = value;
    return;
  }

  const color = customInput?.value || '#8b5cf6';
  const { h } = hexToHsl(color);
  root.dataset.accent = 'custom';
  root.style.setProperty('--base-hue', String(h));
  root.style.setProperty('--base-sat', '80%');
  runtime.ui.accent = 'custom';
};

const persistSettings = () => {
  const customInput = document.getElementById('custom-accent');
  const library = new LibraryEngine(storage);

  return library.saveSettings(createAppSettings({
    id: 'app-settings',
    theme: appState.theme,
    accent: appState.accent,
    customAccent: customInput?.value || null,
    reducedMotion: runtime.ui.reducedMotion,
    sidebarCollapsed: runtime.ui.sidebarCollapsed,
    ui: { selectedSource: runtime.ui.selectedSource, compactMode: false, showQueue: true },
  })).catch((error) => {
    runtime.errors.push({ type: 'settings', message: error.message });
  });
};

const applyThemePreference = (theme) => {
  const body = document.body;
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const resolvedTheme = theme === 'system'
    ? (mediaQuery.matches ? 'dark' : 'light')
    : theme;

  body.dataset.theme = resolvedTheme;
  body.dataset.themeSetting = theme;
  appState.theme = theme;
  runtime.ui.theme = theme;

  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.value = theme;
  }
};

const handleSidebarToggle = () => {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) {
    return;
  }

  const isCollapsed = sidebar.dataset.collapsed === 'true';
  sidebar.dataset.collapsed = String(!isCollapsed);
  runtime.ui.sidebarCollapsed = !isCollapsed;

  const toggleButton = document.querySelector('.sidebar-toggle');
  if (toggleButton) {
    toggleButton.setAttribute('aria-label', isCollapsed ? 'Collapse sidebar' : 'Expand sidebar');
    toggleButton.innerHTML = isCollapsed ? '<span aria-hidden="true">⟨</span>' : '<span aria-hidden="true">⟩</span>';
  }
};

const handleMobileSidebar = () => {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) {
    return;
  }

  const isMobile = window.innerWidth <= 760;
  if (!isMobile) {
    sidebar.style.display = '';
    sidebar.classList.remove('is-open');
    return;
  }

  const shouldOpen = sidebar.classList.contains('is-open');
  sidebar.classList.toggle('is-open', shouldOpen);
  sidebar.style.display = shouldOpen ? 'flex' : 'none';
};

const showUnavailableNotice = (message) => {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  let notice = document.querySelector('.app-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.className = 'app-notice';
    notice.setAttribute('role', 'status');
    root.append(notice);
  }

  notice.textContent = message;
  notice.classList.add('is-visible');
  window.clearTimeout(notice.dismissTimer);
  notice.dismissTimer = window.setTimeout(() => notice.classList.remove('is-visible'), 3200);
};

const formatTime = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
};

const readAudioDuration = (file) => new Promise((resolve) => {
  const objectUrl = URL.createObjectURL(file);
  const probe = document.createElement('audio');
  probe.preload = 'metadata';
  probe.onloadedmetadata = () => {
    const duration = Number.isFinite(probe.duration) ? Math.round(probe.duration * 1000) : 0;
    URL.revokeObjectURL(objectUrl);
    resolve(duration);
  };
  probe.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(0);
  };
  probe.src = objectUrl;
});

const scanAudioFiles = async (files, library, resultsElement, emptyState) => {
  const audioFiles = [...files].filter((file) => file.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(file.name));
  if (!audioFiles.length) {
    showUnavailableNotice('No supported audio files were selected.');
    return;
  }

  emptyState.hidden = true;
  resultsElement.hidden = false;
  resultsElement.textContent = `Scanning ${audioFiles.length} file${audioFiles.length === 1 ? '' : 's'}...`;
  const tracks = [];

  for (const file of audioFiles) {
    const title = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
    const duration = await readAudioDuration(file);
    const track = await library.addTrack({
      title: title || 'Untitled track',
      artists: [],
      album: '',
      duration,
      format: file.name.split('.').pop()?.toLowerCase() || 'unknown',
      filename: file.name,
      folder: file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(0, -1).join('/') : null,
      metadataOrigin: 'filename',
      sources: [{
        id: `local-${file.name}-${file.lastModified}`,
        type: 'local',
        name: file.name,
        url: URL.createObjectURL(file),
        available: true,
        accessible: true,
        browserSupport: 'supported',
      }],
    });
    tracks.push(track);
  }

  resultsElement.innerHTML = `<strong>${tracks.length} track${tracks.length === 1 ? '' : 's'} indexed</strong>`;
  tracks.forEach((track) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'library-track-row';
    row.innerHTML = `<span>${track.title}</span><small>${track.format.toUpperCase()} · ${formatTime(track.duration / 1000)}</small>`;
    row.addEventListener('click', () => {
      audioPlayer.setQueue(tracks.map((queueTrack) => ({ track: queueTrack, source: queueTrack.sources[0] })), tracks.indexOf(track));
      audioPlayer.loadTrack(track, track.sources[0], { restorePosition: true });
      document.querySelector('.player-drawer')?.classList.add('is-open');
    });
    resultsElement.append(row);
  });
};

const renderConnectedSources = (sources, container) => {
  if (!container) return;
  container.innerHTML = '';
  if (!sources.length) {
    container.innerHTML = '<p class="source-help">No local folders connected.</p>';
    return;
  }
  sources.forEach((source) => {
    const row = document.createElement('div');
    row.className = 'connected-source';
    const state = source.requiresReconnect ? 'Reconnect required' : `${source.fileCount || 0} files`;
    row.innerHTML = `<span><strong>${source.name}</strong><small>${state}</small></span><span class="source-row-actions"><button class="text-button refresh-source" type="button">${source.requiresReconnect ? 'Reconnect' : 'Refresh'}</button><button class="text-button remove-source" type="button">Remove</button></span>`;
    row.querySelector('.refresh-source').addEventListener('click', async () => {
      const result = source.requiresReconnect ? await localSources.reconnect(source.id) : await localSources.scanSource(source);
      renderConnectedSources(localSources.sources, container);
      if (result.source && !result.source.requiresReconnect && result.source.fileCount === undefined) {
        const scan = await localSources.scanSource(result.source);
        renderConnectedSources(localSources.sources, container);
        showUnavailableNotice(`Folder reconnected. Indexed ${scan.tracks.length} track${scan.tracks.length === 1 ? '' : 's'}.`);
      } else {
        showUnavailableNotice(result.denied ? 'Folder permission was denied.' : `Scanned ${result.source?.fileCount || 0} audio files.`);
      }
    });
    row.querySelector('.remove-source').addEventListener('click', async () => {
      await localSources.removeSource(source.id);
      renderConnectedSources(localSources.sources, container);
      showUnavailableNotice('Folder connection removed. Your files were not changed.');
    });
    container.append(row);
  });
};

const updatePlayerUi = (state) => {
  const track = state.track;
  const title = track?.title || 'No track loaded';
  const artist = track?.artistNames?.join(', ') || track?.artists?.join(', ') || 'Player ready';
  const titleTargets = document.querySelectorAll('.player-meta h3, .mini-track-info strong');
  const artistTargets = document.querySelectorAll('.fallback-artist, .mini-track-info span');
  const playButtons = document.querySelectorAll('.playback-toggle');
  const progressFills = document.querySelectorAll('.progress-fill, .mini-progress-fill');
  const timeTargets = document.querySelectorAll('.time-row span');
  const statusTarget = document.querySelector('.player-kicker');
  const queueList = document.getElementById('queue-list');
  const queueEmpty = document.querySelector('.queue-empty');
  const navigationButtons = document.querySelectorAll('.previous-toggle, .next-toggle, .shuffle-toggle, .repeat-toggle, .mute-toggle');
  const volumeRange = document.getElementById('volume-range');
  const muteToggle = document.querySelector('.mute-toggle');
  const repeatSelect = document.getElementById('repeat-select');
  const shuffleToggle = document.querySelector('.shuffle-toggle');
  const monoToggle = document.getElementById('mono-toggle');

  titleTargets.forEach((element) => { element.textContent = title; });
  artistTargets.forEach((element) => { element.textContent = artist; });
  if (statusTarget) statusTarget.textContent = state.status === 'idle' ? 'Player ready' : state.status;
  playButtons.forEach((button) => {
    button.disabled = !track || !state.source;
    button.textContent = state.isPlaying ? '❚❚' : '▶';
    button.setAttribute('aria-label', state.isPlaying ? 'Pause' : 'Play');
  });
  navigationButtons.forEach((button) => { button.disabled = !track; });
  if (volumeRange) volumeRange.value = String(state.volume);
  if (muteToggle) {
    muteToggle.disabled = !track;
    muteToggle.textContent = state.muted ? 'Unmute' : 'Mute';
  }
  if (repeatSelect) repeatSelect.value = state.repeatMode;
  if (shuffleToggle) {
    shuffleToggle.classList.toggle('is-active', state.shuffle);
    shuffleToggle.setAttribute('aria-pressed', String(state.shuffle));
  }
  if (monoToggle) monoToggle.checked = state.mono;

  const ratio = state.durationSeconds ? (state.positionSeconds / state.durationSeconds) * 100 : 0;
  progressFills.forEach((element) => { element.style.width = `${Math.min(Math.max(ratio, 0), 100)}%`; });
  if (timeTargets.length >= 2) {
    timeTargets[0].textContent = formatTime(state.positionSeconds);
    timeTargets[1].textContent = formatTime(state.durationSeconds);
  }

  if (queueList && queueEmpty) {
    queueList.innerHTML = '';
    queueEmpty.hidden = state.queue.length > 0;
    queueList.hidden = state.queue.length === 0;
    state.queue.forEach((item, index) => {
      const entry = document.createElement('li');
      entry.className = `queue-item${index === state.currentIndex ? ' active' : ''}`;
      entry.innerHTML = `<span>${item.track.title}</span><button type="button" class="queue-remove" aria-label="Remove ${item.track.title}">×</button>`;
      entry.querySelector('.queue-remove').addEventListener('click', () => audioPlayer.removeFromQueue(index));
      queueList.append(entry);
    });
  }

  if (state.error) {
    showUnavailableNotice(state.error);
  }
};

const initApp = async () => {
  const root = document.getElementById('app');

  if (!root) {
    return;
  }

  const supportsBasicFeatures = document.documentElement && !!document.body;

  if (!supportsBasicFeatures) {
    return;
  }

  const themeSelect = document.getElementById('theme-select');
  const accentButtons = document.querySelectorAll('.accent-swatch');
  const customAccentInput = document.getElementById('custom-accent');
  const sidebarToggle = document.querySelector('.sidebar-toggle');
  const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
  const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
  const desktopNavItems = document.querySelectorAll('.nav-item');
  const playerDrawer = document.querySelector('.player-drawer');
  const playerClose = document.querySelector('.player-close');
  const miniArt = document.querySelector('.mini-art');
  const primaryButton = document.querySelector('.primary-button');
  const actionButtons = document.querySelectorAll('.text-button, .player-actions button');
  const mediaCards = document.querySelectorAll('.media-card');
  const queueButton = document.querySelector('.queue-button');
  const audioElement = document.getElementById('audio-engine');
  const playbackToggles = document.querySelectorAll('.playback-toggle');
  const progressBars = document.querySelectorAll('.progress-bar, .mini-progress');
  const volumeRange = document.getElementById('volume-range');
  const muteToggle = document.querySelector('.mute-toggle');
  const repeatSelect = document.getElementById('repeat-select');
  const shuffleToggle = document.querySelector('.shuffle-toggle');
  const monoToggle = document.getElementById('mono-toggle');
  const eqSelect = document.getElementById('eq-select');
  const previousToggles = document.querySelectorAll('.previous-toggle');
  const nextToggles = document.querySelectorAll('.next-toggle');
  const shareButton = document.getElementById('share-button');
  const fileInfoButton = document.getElementById('file-info-button');
  const sourceDialog = document.getElementById('source-dialog');
  const settingsDialog = document.getElementById('settings-dialog');
  const sourceButton = document.querySelector('.source-button');
  const settingsButton = document.querySelector('.meta-button:not(.source-button)');
  const sourceSaveButton = document.querySelector('.source-save-button');
  const settingsSaveButton = document.querySelector('.settings-save-button');
  const scanFilesButton = document.querySelector('.scan-files-button');
  const scanFolderButton = document.querySelector('.scan-folder-button');
  const filesInput = document.getElementById('audio-files-input');
  const folderInput = document.getElementById('audio-folder-input');
  const libraryEmptyState = document.getElementById('library-empty-state');
  const libraryResults = document.getElementById('library-results');
  const connectedSources = document.getElementById('connected-sources');
  const addFolderButton = document.querySelector('.add-folder-button');

  audioPlayer = new AudioPlayer(audioElement, updatePlayerUi);
  localSources = new LocalSourceManager(storage, new LibraryEngine(storage));
  await localSources.loadSources();
  renderConnectedSources(localSources.sources, connectedSources);
  updatePlayerUi(audioPlayer.getState());

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Ignore registration errors during the project foundation phase.
    });
  }

  try {
    const library = new LibraryEngine(storage);
    const storedSettings = await library.getSettings();
    if (storedSettings) {
      appState.theme = storedSettings.theme || appState.theme;
      appState.accent = storedSettings.accent || appState.accent;
      if (customAccentInput && storedSettings.customAccent) {
        customAccentInput.value = storedSettings.customAccent;
      }
      applyThemePreference(appState.theme);
      applyAccentStyle(appState.accent);
    } else {
      applyThemePreference(appState.theme);
      applyAccentStyle(appState.accent);
    }

    const savedPlayback = await library.getPlaybackState();
    const savedTrack = savedPlayback?.currentTrackId ? await library.getTrack(savedPlayback.currentTrackId) : null;
    const savedSource = savedTrack?.sources?.find((source) => source.id === savedPlayback.sourceId) || savedTrack?.sources?.[0];
    if (savedTrack && savedSource?.url && !savedSource.url.startsWith('blob:')) {
      await audioPlayer.loadTrack(savedTrack, savedSource, { restorePosition: true });
    }
  } catch (error) {
    console.warn('Meliviny could not load saved settings.', error);
    applyThemePreference(appState.theme);
    applyAccentStyle(appState.accent);
  }

  if (themeSelect) {
    themeSelect.addEventListener('change', (event) => {
      applyThemePreference(event.target.value);
      persistSettings();
    });
  }

  accentButtons.forEach((button) => {
    button.addEventListener('click', () => {
      accentButtons.forEach((item) => item.classList.toggle('is-selected', item === button));
      applyAccentStyle(button.dataset.accent);
      appState.accent = button.dataset.accent;
      persistSettings();
    });
  });

  if (customAccentInput) {
    customAccentInput.addEventListener('input', () => {
      accentButtons.forEach((item) => item.classList.remove('is-selected'));
      applyAccentStyle('custom');
      appState.accent = 'custom';
      persistSettings();
    });
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      handleSidebarToggle();
      persistSettings();
    });
  }

  mobileNavItems.forEach((item) => {
    item.addEventListener('click', () => {
      mobileNavItems.forEach((navItem) => navItem.classList.toggle('active', navItem === item));
      runtime.ui.activeSection = item.getAttribute('aria-label')?.toLowerCase() || 'home';
      const target = document.getElementById(`${runtime.ui.activeSection}-heading`);
      target?.scrollIntoView({ behavior: runtime.ui.reducedMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });

  desktopNavItems.forEach((item) => {
    item.addEventListener('click', () => {
      desktopNavItems.forEach((navItem) => navItem.classList.toggle('active', navItem === item));
      const label = item.querySelector('.nav-label')?.textContent?.toLowerCase() || 'home';
      runtime.ui.activeSection = label;
      const target = document.getElementById(`${label}-heading`);
      target?.scrollIntoView({ behavior: runtime.ui.reducedMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });

  const openPlayer = () => playerDrawer?.classList.add('is-open');
  const closePlayer = () => playerDrawer?.classList.remove('is-open');
  playerClose?.addEventListener('click', closePlayer);
  miniArt?.addEventListener('click', openPlayer);
  primaryButton?.addEventListener('click', () => document.getElementById('library-heading')?.scrollIntoView({ behavior: 'smooth' }));
  actionButtons.forEach((button) => button.addEventListener('click', () => {
    showUnavailableNotice('This library action will be available when a music source is connected.');
  }));
  mediaCards.forEach((card) => card.addEventListener('click', () => {
    showUnavailableNotice('Playback is not connected yet. No audio has been started.');
  }));
  queueButton?.addEventListener('click', openPlayer);
  playbackToggles.forEach((button) => button.addEventListener('click', () => audioPlayer.togglePlayback()));
  previousToggles.forEach((button) => button.addEventListener('click', () => audioPlayer.previous()));
  nextToggles.forEach((button) => button.addEventListener('click', () => audioPlayer.next()));
  shuffleToggle?.addEventListener('click', () => audioPlayer.setShuffle(!audioPlayer.getState().shuffle));
  muteToggle?.addEventListener('click', () => audioPlayer.toggleMute());
  volumeRange?.addEventListener('input', () => audioPlayer.setVolume(volumeRange.value));
  repeatSelect?.addEventListener('change', () => audioPlayer.setRepeatMode(repeatSelect.value));
  monoToggle?.addEventListener('change', () => audioPlayer.setMono(monoToggle.checked));
  eqSelect?.addEventListener('change', () => audioPlayer.setEqPreset(eqSelect.value));
  progressBars.forEach((bar) => bar.addEventListener('click', (event) => {
    if (!audioPlayer?.getState().durationSeconds) {
      return;
    }

    const bounds = bar.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / bounds.width;
    audioPlayer.seekTo(audioPlayer.getState().durationSeconds * ratio);
  }));

  sourceButton?.addEventListener('click', () => sourceDialog?.showModal());
  settingsButton?.addEventListener('click', () => {
    const settingsTheme = document.getElementById('settings-theme-select');
    const reducedMotionSetting = document.getElementById('reduced-motion-setting');
    if (settingsTheme) settingsTheme.value = appState.theme;
    if (reducedMotionSetting) reducedMotionSetting.checked = runtime.ui.reducedMotion;
    settingsDialog?.showModal();
  });
  sourceSaveButton?.addEventListener('click', () => {
    const selectedSource = document.querySelector('input[name="source"]:checked')?.value || 'local';
    runtime.ui.selectedSource = selectedSource;
    const sourceName = document.querySelector('.source-button strong');
    if (sourceName) sourceName.textContent = selectedSource === 'server' ? 'Personal server' : 'Local library';
    persistSettings();
  });
  settingsSaveButton?.addEventListener('click', () => {
    const settingsTheme = document.getElementById('settings-theme-select');
    const reducedMotionSetting = document.getElementById('reduced-motion-setting');
    if (settingsTheme) applyThemePreference(settingsTheme.value);
    if (reducedMotionSetting) runtime.ui.reducedMotion = reducedMotionSetting.checked;
    persistSettings();
  });
  scanFilesButton?.addEventListener('click', () => filesInput?.click());
  scanFolderButton?.addEventListener('click', () => folderInput?.click());
  filesInput?.addEventListener('change', () => scanAudioFiles(filesInput.files, new LibraryEngine(storage), libraryResults, libraryEmptyState));
  folderInput?.addEventListener('change', () => scanAudioFiles(folderInput.files, new LibraryEngine(storage), libraryResults, libraryEmptyState));
  addFolderButton?.addEventListener('click', async () => {
    if (!localSources.supportsDirectoryPicker) {
      showUnavailableNotice('Folder access is unavailable in this browser. Use Choose files as a fallback.');
      return;
    }
    try {
      const result = await localSources.addDirectory();
      if (result.denied) showUnavailableNotice('Folder permission was denied. No files were read.');
      else if (result.source) {
        const scan = await localSources.scanSource(result.source);
        renderConnectedSources(localSources.sources, connectedSources);
        showUnavailableNotice(`Folder connected. Indexed ${scan.tracks.length} track${scan.tracks.length === 1 ? '' : 's'}.`);
      }
    } catch (error) {
      showUnavailableNotice(`Folder access failed: ${error.message}`);
    }
  });
  shareButton?.addEventListener('click', async () => {
    const state = audioPlayer.getState();
    if (!state.track) { showUnavailableNotice('Select a track before sharing.'); return; }
    const text = `${state.track.title} - ${state.track.artists?.join(', ') || 'Unknown artist'} (${state.track.album || 'Unknown album'})`;
    try {
      if (navigator.share) await navigator.share({ title: state.track.title, text });
      else await navigator.clipboard.writeText(text);
      showUnavailableNotice(navigator.share ? 'Share sheet opened.' : 'Track details copied to clipboard.');
    } catch { showUnavailableNotice('Sharing was cancelled or unavailable.'); }
  });
  fileInfoButton?.addEventListener('click', () => {
    const state = audioPlayer.getState();
    if (!state.track) { showUnavailableNotice('Select a track to view file information.'); return; }
    const source = state.source;
    showUnavailableNotice(`${state.track.filename || 'Unknown file'} · ${state.track.format || 'Unknown format'} · ${formatTime(state.durationSeconds)} · ${source?.type || 'Unknown source'}`);
  });
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (event.code === 'Space') { event.preventDefault(); audioPlayer.togglePlayback(); }
    if (event.key === 'ArrowRight') audioPlayer.seekTo(audioPlayer.getState().positionSeconds + 5);
    if (event.key === 'ArrowLeft') audioPlayer.seekTo(audioPlayer.getState().positionSeconds - 5);
    if (event.key === 'ArrowUp') audioPlayer.setVolume(audioPlayer.getState().volume + 0.05);
    if (event.key === 'ArrowDown') audioPlayer.setVolume(audioPlayer.getState().volume - 0.05);
    if (event.key.toLowerCase() === 'm') audioPlayer.toggleMute();
    if (event.key.toLowerCase() === 'n') audioPlayer.next();
    if (event.key.toLowerCase() === 'p') audioPlayer.previous();
    if (event.key.toLowerCase() === 'q') openPlayer();
  });

  if (mobileMenuToggle) {
    mobileMenuToggle.addEventListener('click', () => {
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) {
        return;
      }

      const isOpen = sidebar.classList.toggle('is-open');
      sidebar.style.display = isOpen ? 'flex' : 'none';
    });
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', () => {
      if (appState.theme === 'system') {
        applyThemePreference('system');
      }
    });
  }

  window.addEventListener('resize', handleMobileSidebar);
  handleMobileSidebar();
  root.dataset.ready = 'true';
  appState.ready = true;
  runtime.ready = true;
  runtime.lastUpdated = new Date().toISOString();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initApp();
  }, { once: true });
} else {
  initApp();
}

window.meliviny = {
  init: initApp,
  state: appState,
  runtime,
  storage,
  library: new LibraryEngine(storage),
  loadTrack: (track, source) => audioPlayer?.loadTrack(track, source) || false,
};
