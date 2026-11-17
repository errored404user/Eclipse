'use strict';

const { randomUUID } = require('node:crypto');

const STATE_VERSION = 1;
const MAX_PROFILES = 12;
const MAX_FAVORITES = 48;
const PROFILE_COLORS = new Set(['violet', 'sky', 'mint', 'amber', 'rose']);
const PROFILE_ID_PATTERN = /^profile_[a-z0-9-]{20,}$/i;

function createDefaultState() {
  return {
    schemaVersion: STATE_VERSION,
    settings: {
      reduceMotion: false
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

  state.settings.reduceMotion = source.settings?.reduceMotion === true;

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
  MAX_FAVORITES,
  MAX_PROFILES,
  STATE_VERSION,
  boundedText,
  cloneState,
  createDefaultState,
  createFavorite,
  createProfile,
  normalizeState,
  toPlaceId
};
