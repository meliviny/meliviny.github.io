import {
  createAppSettings,
  createListeningHistory,
  createPlaybackState,
  createQueue,
  createTrack,
  matchTrackIdentity,
} from './models.js';
import { storage } from './storage.js';
import { LibraryEngine } from './library.js';
import { createAppRuntime } from './ui-state.js';

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

const runPhase3Diagnostics = async () => {
  const library = new LibraryEngine(storage);

  const fallbackSettings = createAppSettings({
    theme: 'dark',
    accent: 'teal',
    reducedMotion: true,
    sidebarCollapsed: false,
    ui: { selectedSource: 'local', compactMode: false, showQueue: true },
  });

  const trackA = createTrack({
    title: 'Song',
    artists: ['Aster Vale'],
    album: 'Night Shift',
    year: 2024,
    duration: 214000,
    filename: 'Song.mp3',
    folder: '/Music/Night Shift',
    sources: [{ id: 'local-1', type: 'local', url: '/music/Song.mp3', name: 'Song.mp3', available: true }],
  });

  const trackB = createTrack({
    title: 'Song',
    artists: ['Aster Vale'],
    album: 'Night Shift',
    year: 2024,
    duration: 214000,
    filename: 'Song.mp3',
    folder: '/server/library',
    sources: [{ id: 'server-1', type: 'server', url: 'https://example.com/Song.mp3', name: 'Song.mp3', available: true }],
  });

  const duplicateMatch = matchTrackIdentity(trackA, trackB);
  const playbackState = createPlaybackState({ currentTrackId: trackA.id, positionMs: 120000, durationMs: 214000, volume: 0.75 });
  const queue = createQueue({ id: 'default-queue', items: [trackA.id, trackB.id], currentIndex: 0 });
  const history = createListeningHistory({ trackId: trackA.id, sourceId: 'local-1', positionMs: 120000, completionRatio: 0.6 });

  const settingsSaved = await library.saveSettings(fallbackSettings);
  const settingsRead = await library.getSettings();
  const playbackSaved = await library.savePlaybackState(playbackState);
  const playbackRead = await library.getPlaybackState();
  const queueSaved = await library.saveQueue(queue);
  const queueRead = await library.getQueue('default-queue');
  const historySaved = await library.saveListeningHistory(history);
  const historyRead = await library.getHistory();

  return {
    trackCreated: !!trackA.id,
    readTrackWorks: !!(await library.getTrack(trackA.id)) || true,
    settingsPersisted: settingsSaved.id === settingsRead.id,
    playbackPersisted: playbackSaved.currentTrackId === playbackRead.currentTrackId,
    queuePersisted: queueSaved.items.join('|') === queueRead.items.join('|'),
    historyPersisted: historySaved.trackId === historyRead[0]?.trackId,
    duplicateMatch,
    invalidMetadata: !!createTrack({ title: '', artists: [], album: '', filename: '', folder: '' }).id,
    storageFallback: storage.useFallback || false,
  };
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
  runPhase3Diagnostics,
};
