export const createUiState = (initial = {}) => ({
  ready: Boolean(initial.ready),
  theme: initial.theme || 'system',
  accent: initial.accent || 'violet',
  sidebarCollapsed: Boolean(initial.sidebarCollapsed),
  selectedSource: initial.selectedSource || 'local',
  reducedMotion: Boolean(initial.reducedMotion),
  isMobile: Boolean(initial.isMobile),
  activeSection: initial.activeSection || 'home',
});

export const createAppRuntime = (initial = {}) => ({
  ui: createUiState(initial.ui || initial),
  errors: [],
  lastUpdated: new Date().toISOString(),
});

export const updateUiState = (state, patch = {}) => ({
  ...state,
  ...patch,
  lastUpdated: new Date().toISOString(),
});
