const appState = {
  ready: false,
  supportsServiceWorker: 'serviceWorker' in navigator,
  supportsModules: !!document.querySelector('script[type="module"]'),
  theme: 'system',
  accent: 'violet',
};

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
    return;
  }

  const color = customInput ? customInput.value : '#8b5cf6';
  const { h } = hexToHsl(color);
  root.dataset.accent = 'custom';
  root.style.setProperty('--base-hue', String(h));
  root.style.setProperty('--base-sat', '80%');
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

const initApp = () => {
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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Ignore registration errors during the project foundation phase.
    });
  }

  applyThemePreference(appState.theme);
  applyAccentStyle('violet');

  if (themeSelect) {
    themeSelect.addEventListener('change', (event) => {
      applyThemePreference(event.target.value);
    });
  }

  accentButtons.forEach((button) => {
    button.addEventListener('click', () => {
      accentButtons.forEach((item) => item.classList.toggle('is-selected', item === button));
      applyAccentStyle(button.dataset.accent);
      appState.accent = button.dataset.accent;
    });
  });

  if (customAccentInput) {
    customAccentInput.addEventListener('input', () => {
      accentButtons.forEach((item) => item.classList.remove('is-selected'));
      applyAccentStyle('custom');
      appState.accent = 'custom';
    });
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', handleSidebarToggle);
  }

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
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
  initApp();
}

window.meliviny = {
  init: initApp,
  state: appState,
};
