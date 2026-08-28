export const STORAGE_SCHEMA_VERSION = 2;

const normalizeText = (value, fallback = 'Unknown') => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }

  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return String(value);
};

const toArray = (value) => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return [value];
};

const uniqueValues = (values) => [...new Set(values.filter(Boolean))];

const safeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const slugify = (value, fallback = 'item') => {
  const text = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();

  return text || fallback;
};

export const hashString = (value) => {
  let hash = 2166136261;
  const text = String(value || '');

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
};

export const normalizeMetadataValue = (value, fallback = 'Unknown') => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }

  return String(value);
};

export const normalizeComparableText = (value, fallback = '') => {
  return normalizeText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
};

export const createArtist = (input = {}) => {
  const name = normalizeText(input.name, 'Unknown artist');

  return {
    id: input.id || `artist-${slugify(name)}`,
    name,
    sortName: name,
    aliases: uniqueValues(toArray(input.aliases)).map((alias) => normalizeText(alias, '')),
    artwork: input.artwork || null,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
};

export const createAlbum = (input = {}) => {
  const title = normalizeText(input.title, 'Unknown album');

  return {
    id: input.id || `album-${slugify(title)}`,
    title,
    artistId: input.artistId || null,
    albumArtist: normalizeMetadataValue(input.albumArtist, 'Unknown artist'),
    year: input.year || null,
    genre: normalizeMetadataValue(input.genre, 'Unknown genre'),
    artwork: input.artwork || null,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
};

export const createPlaylist = (input = {}) => {
  return {
    id: input.id || `playlist-${slugify(input.name || 'untitled-playlist')}-${Date.now()}`,
    name: normalizeText(input.name, 'Untitled playlist'),
    description: normalizeText(input.description, 'No description provided'),
    trackIds: uniqueValues(toArray(input.trackIds)).map(String),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
};

export const createFolder = (input = {}) => {
  return {
    id: input.id || `folder-${slugify(input.name || input.path || 'new-folder')}-${Date.now()}`,
    name: normalizeText(input.name, 'New folder'),
    path: normalizeText(input.path, '/'),
    parentFolderId: input.parentFolderId || null,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
};

export const createMusicSource = (input = {}) => {
  const type = input.type || 'local';

  return {
    id: input.id || `${type}-${slugify(input.name || input.url || 'source')}-${Date.now()}`,
    type,
    name: normalizeText(input.name, 'New source'),
    url: input.url || null,
    baseUrl: input.baseUrl || null,
    supportedFormats: uniqueValues(toArray(input.supportedFormats)).map(String),
    preferred: Boolean(input.preferred),
    accessible: Boolean(input.accessible),
    offlineAvailable: Boolean(input.offlineAvailable),
    quality: input.quality || 'normal',
    browserSupport: input.browserSupport || 'unknown',
    available: Boolean(input.available),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
};

export const createPlaybackState = (input = {}) => {
  return {
    id: input.id || 'playback-state',
    currentTrackId: input.currentTrackId || null,
    positionMs: safeNumber(input.positionMs, 0),
    durationMs: safeNumber(input.durationMs, 0),
    isPlaying: Boolean(input.isPlaying),
    sourceId: input.sourceId || null,
    queueId: input.queueId || null,
    volume: clampNumber(input.volume, 0, 1, 0.8),
    playbackRate: clampNumber(input.playbackRate, 0.5, 2, 1),
    playbackMode: input.playbackMode || 'normal',
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
};

export const createQueue = (input = {}) => {
  const items = uniqueValues(toArray(input.items)).map((item) => String(item));

  return {
    id: input.id || 'default-queue',
    name: normalizeText(input.name, 'Now playing'),
    items,
    currentIndex: clampNumber(input.currentIndex, 0, Math.max(0, items.length - 1), 0),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
};

export const createListeningHistory = (input = {}) => {
  return {
    id: input.id || `history-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    trackId: input.trackId || null,
    sourceId: input.sourceId || null,
    playedAt: input.playedAt || new Date().toISOString(),
    durationMs: safeNumber(input.durationMs, 0),
    positionMs: safeNumber(input.positionMs, 0),
    completionRatio: clampNumber(input.completionRatio, 0, 1, 0),
    createdAt: input.createdAt || new Date().toISOString(),
  };
};

export const createAppSettings = (input = {}) => {
  return {
    id: input.id || 'app-settings',
    version: STORAGE_SCHEMA_VERSION,
    theme: input.theme || 'system',
    accent: input.accent || 'violet',
    customAccent: input.customAccent || null,
    reducedMotion: Boolean(input.reducedMotion),
    sidebarCollapsed: Boolean(input.sidebarCollapsed),
    sourcePreference: input.sourcePreference || 'smart',
    playback: {
      volume: clampNumber(input.playback?.volume, 0, 1, 0.8),
      playbackRate: clampNumber(input.playback?.playbackRate, 0.5, 2, 1),
      shuffle: Boolean(input.playback?.shuffle),
      repeatMode: input.playback?.repeatMode || 'off',
      monoMode: Boolean(input.playback?.monoMode),
      gapless: Boolean(input.playback?.gapless),
      persistPosition: input.playback?.persistPosition !== false,
      eqPreset: input.playback?.eqPreset || 'flat',
    },
    eq: input.eq || null,
    ui: {
      compactMode: Boolean(input.ui?.compactMode),
      showQueue: Boolean(input.ui?.showQueue),
      selectedSource: input.ui?.selectedSource || 'local',
    },
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
};

export const createDeviceInfo = (input = {}) => {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  const hasNavigator = typeof navigator !== 'undefined';

  return {
    id: input.id || `device-${hashString(userAgent)}`,
    platform: input.platform || 'web',
    userAgent: input.userAgent || userAgent,
    capabilities: {
      indexedDb: Boolean(input.capabilities?.indexedDb ?? (typeof indexedDB !== 'undefined')),
      serviceWorker: Boolean(input.capabilities?.serviceWorker ?? (hasNavigator && 'serviceWorker' in navigator)),
      localStorage: Boolean(input.capabilities?.localStorage ?? (typeof localStorage !== 'undefined')),
    },
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
};

export const createTrack = (input = {}) => {
  const title = normalizeText(input.title, 'Untitled track');
  const artists = uniqueValues(toArray(input.artists).map((artist) => normalizeText(artist, 'Unknown artist')));
  const album = normalizeText(input.album, 'Unknown album');
  const albumArtist = normalizeMetadataValue(input.albumArtist, artists[0] || 'Unknown artist');
  const genre = normalizeMetadataValue(input.genre, 'Unknown genre');
  const sourceCandidates = Array.isArray(input.sources)
    ? input.sources.map((source) => ({ ...source }))
    : (
        input.source
          ? [input.source]
          : []
      );

  const stableId = input.id || buildTrackIdentity({
    title,
    artists,
    album,
    year: input.year || null,
    duration: safeNumber(input.duration, 0),
    sourceCandidates,
    folder: input.folder || null,
    filename: input.filename || null,
  });

  return {
    id: stableId,
    title,
    artists,
    artistNames: artists,
    album,
    albumArtist,
    genre,
    year: input.year || null,
    duration: safeNumber(input.duration, 0),
    format: normalizeMetadataValue(input.format, 'unknown'),
    artwork: input.artwork || null,
    sources: sourceCandidates,
    folder: input.folder || null,
    filename: normalizeMetadataValue(input.filename, 'unknown-file'),
    metadataOrigin: normalizeMetadataValue(input.metadataOrigin, 'unknown'),
    quality: input.quality || null,
    rawMetadata: input.rawMetadata || {},
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
};

export const buildTrackIdentity = (metadata = {}) => {
  const title = normalizeComparableText(metadata.title, 'untitled-track');
  const album = normalizeComparableText(metadata.album, 'unknown-album');
  const artists = uniqueValues(toArray(metadata.artists)).map((artist) => normalizeComparableText(artist, 'unknown-artist'));
  const duration = safeNumber(metadata.duration, 0);
  const year = metadata.year || 'unknown-year';
  const metadataKey = [title, album, artists.join('|'), duration, year].join('|');

  if (title !== 'untitled track' && artists.length && album !== 'unknown album') {
    return `track-${hashString(metadataKey)}`;
  }

  const folder = normalizeComparableText(metadata.folder, 'unknown-folder');
  const filename = normalizeComparableText(metadata.filename, 'unknown-file');
  return `track-${hashString([metadataKey, folder, filename].join('|'))}`;
};

export const matchTrackIdentity = (firstTrack, secondTrack) => {
  if (!firstTrack || !secondTrack) {
    return { match: false, level: 0, confidence: 0 };
  }

  if (firstTrack.id && secondTrack.id && firstTrack.id === secondTrack.id) {
    return { match: true, level: 1, confidence: 1 };
  }

  const strongKeyA = [normalizeComparableText(firstTrack.title), normalizeComparableText(firstTrack.album), firstTrack.artists?.map((artist) => normalizeComparableText(artist)).join('|')].join('|');
  const strongKeyB = [normalizeComparableText(secondTrack.title), normalizeComparableText(secondTrack.album), secondTrack.artists?.map((artist) => normalizeComparableText(artist)).join('|')].join('|');

  if (strongKeyA && strongKeyB && strongKeyA === strongKeyB) {
    return { match: true, level: 2, confidence: 0.9 };
  }

  const normalizedA = [normalizeComparableText(firstTrack.title), normalizeComparableText(firstTrack.album), normalizeComparableText(firstTrack.artistNames?.[0] || firstTrack.artists?.[0])].join('|');
  const normalizedB = [normalizeComparableText(secondTrack.title), normalizeComparableText(secondTrack.album), normalizeComparableText(secondTrack.artistNames?.[0] || secondTrack.artists?.[0])].join('|');

  if (normalizedA && normalizedB && normalizedA === normalizedB) {
    return { match: true, level: 3, confidence: 0.75 };
  }

  const sourcesMatch = firstTrack.sources?.some((source) => secondTrack.sources?.some((otherSource) => {
    return source.url && otherSource.url && source.url === otherSource.url;
  }));

  if (sourcesMatch) {
    return { match: true, level: 4, confidence: 0.6 };
  }

  return { match: false, level: 0, confidence: 0 };
};

export const choosePreferredSource = (track, candidateSources = []) => {
  const sources = Array.isArray(candidateSources) && candidateSources.length
    ? candidateSources
    : (Array.isArray(track?.sources) ? track.sources : []);

  if (!sources.length) {
    return null;
  }

  const scored = sources.map((source) => {
    const metadata = {
      availability: source.available ? 3 : 0,
      browserSupport: source.browserSupport === 'supported' ? 3 : source.browserSupport === 'partial' ? 2 : 1,
      quality: source.quality === 'lossless' ? 4 : source.quality === 'high' ? 3 : source.quality === 'normal' ? 2 : 1,
      preferred: source.preferred ? 2 : 0,
      accessible: source.accessible ? 1 : 0,
      offline: source.offlineAvailable ? 1 : 0,
    };

    const score = Object.values(metadata).reduce((total, value) => total + value, 0);
    return { source, score };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.source || null;
};

function clampNumber(value, min, max, fallback) {
  const safe = Number(value);
  if (!Number.isFinite(safe)) {
    return fallback;
  }

  return Math.min(Math.max(safe, min), max);
}
