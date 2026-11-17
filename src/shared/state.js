'use strict';

const { randomUUID } = require('node:crypto');

const STATE_VERSION = 3;
const MAX_PROFILES = 12;
const MAX_FAVORITES = 48;
const PROFILE_COLORS = new Set(['violet', 'sky', 'mint', 'amber', 'rose']);
const PROFILE_ID_PATTERN = /^profile_[a-z0-9-]{20,}$/i;
const UI_PAGES = ['overview', 'profiles', 'library', 'integrations', 'deployment', 'installation', 'fastflags', 'settings'];
const SETTING_OPTIONS = Object.freeze({
  theme: ['midnight', 'aurora', 'carbon'],
  accent: ['violet', 'sky', 'mint', 'amber', 'rose'],
  density: ['comfortable', 'compact'],
  fontScale: ['standard', 'large', 'extra-large'],
  startPage: UI_PAGES,
  librarySort: ['recent', 'title']
});
const DEFAULT_SETTINGS = Object.freeze({
  theme: 'midnight',
  accent: 'violet',
  density: 'comfortable',
  fontScale: 'standard',
  reduceMotion: false,
  highContrast: false,
  focusMode: false,
  notifications: true,
  activityTracking: false,
  showStartupLauncher: true,
  confirmLaunch: true,
  rememberLastPage: true,
  startPage: 'overview',
  librarySort: 'recent',
  showExperienceId: true,
  showInstallationPath: false
});

function createDefaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

function createDefaultState() {
  return {
    schemaVersion: STATE_VERSION,
    settings: createDefaultSettings(),
    ui: {
      lastPage: 'overview'
    },
    profiles: [],
    favorites: []
  };
}

function boundedText(value, maximumLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength);
}

function toPlaceId(value) {
  const candidate = typeof value === 'number' ? String(value) : boundedText(value, 18);

  if (!/^\d+$/.test(candidate)) {
    throw new Error('Enter a valid numeric Roblox experience ID.');
  }

  const placeId = Number(candidate);
  if (!Number.isSafeInteger(placeId) || placeId < 1) {
    throw new Error('Enter a valid Roblox experience ID.');
  }

  return placeId;
}

function validDate(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return new Date().toISOString();
  }

  return new Date(value).toISOString();
}

function isUiPage(value) {
  return typeof value === 'string' && UI_PAGES.includes(value);
}

function normalizeEnum(value, allowedValues, fallback) {
  return typeof value === 'string' && allowedValues.includes(value) ? value : fallback;
}

function normalizeSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const settings = createDefaultSettings();

  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof fallback === 'boolean') {
      settings[key] = typeof source[key] === 'boolean' ? source[key] : fallback;
      continue;
    }

    settings[key] = normalizeEnum(source[key], SETTING_OPTIONS[key], fallback);
  }

  return settings;
}

function normalizeSettingsPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Settings details are required.');
  }

  const patch = {};
  for (const [key, input] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) {
      throw new Error(`Unsupported setting: ${key}.`);
    }

    const fallback = DEFAULT_SETTINGS[key];
    if (typeof fallback === 'boolean') {
      if (typeof input !== 'boolean') {
        throw new Error(`The ${key} setting must be enabled or disabled.`);
      }
      patch[key] = input;
      continue;
    }

    if (typeof input !== 'string' || !SETTING_OPTIONS[key].includes(input)) {
      throw new Error(`The ${key} setting is invalid.`);
    }
    patch[key] = input;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('No supported settings were provided.');
  }

  return patch;
}

function normalizeProfile(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const name = boundedText(value.name, 36);
  if (!name) {
    return null;
  }

  const candidateId = boundedText(value.id, 64);
  const color = boundedText(value.color, 12);

  return {
    id: PROFILE_ID_PATTERN.test(candidateId) ? candidateId : `profile_${randomUUID()}`,
    name,
    description: boundedText(value.description, 140),
    color: PROFILE_COLORS.has(color) ? color : 'violet',
    pinned: value.pinned === true,
    createdAt: validDate(value.createdAt)
  };
}

function normalizeFavorite(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  try {
    const placeId = toPlaceId(value.placeId);
    const title = boundedText(value.title, 60);

    return {
      placeId,
      title: title || `Experience ${placeId}`,
      addedAt: validDate(value.addedAt)
    };
  } catch {
    return null;
  }
}

function normalizeState(value) {
  const source = value && typeof value === 'object' ? value : {};
  const state = createDefaultState();
  state.settings = normalizeSettings(source.settings);
  state.ui.lastPage = isUiPage(source.ui?.lastPage) ? source.ui.lastPage : state.settings.startPage;

  const profileIds = new Set();
  for (const rawProfile of Array.isArray(source.profiles) ? source.profiles : []) {
    const profile = normalizeProfile(rawProfile);
    if (!profile || profileIds.has(profile.id) || state.profiles.length >= MAX_PROFILES) {
      continue;
    }

    profileIds.add(profile.id);
    state.profiles.push(profile);
  }

  const favoriteIds = new Set();
  for (const rawFavorite of Array.isArray(source.favorites) ? source.favorites : []) {
    const favorite = normalizeFavorite(rawFavorite);
    if (!favorite || favoriteIds.has(favorite.placeId) || state.favorites.length >= MAX_FAVORITES) {
      continue;
    }

    favoriteIds.add(favorite.placeId);
    state.favorites.push(favorite);
  }

  return state;
}

function createProfile(input) {
  const name = boundedText(input?.name, 36);
  if (!name) {
    throw new Error('Profile name is required.');
  }

  const color = boundedText(input?.color, 12);
  return {
    id: `profile_${randomUUID()}`,
    name,
    description: boundedText(input?.description, 140),
    color: PROFILE_COLORS.has(color) ? color : 'violet',
    pinned: false,
    createdAt: new Date().toISOString()
  };
}

function createFavorite(input) {
  const placeId = toPlaceId(input?.placeId);
  const title = boundedText(input?.title, 60);

  return {
    placeId,
    title: title || `Experience ${placeId}`,
    addedAt: new Date().toISOString()
  };
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

module.exports = {
  DEFAULT_SETTINGS,
  MAX_FAVORITES,
  MAX_PROFILES,
  SETTING_OPTIONS,
  STATE_VERSION,
  UI_PAGES,
  boundedText,
  cloneState,
  createDefaultSettings,
  createDefaultState,
  createFavorite,
  createProfile,
  isUiPage,
  normalizeSettings,
  normalizeSettingsPatch,
  normalizeState,
  toPlaceId
};
