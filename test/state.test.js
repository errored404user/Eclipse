'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_FAVORITES,
  createFavorite,
  createProfile,
  normalizeSettingsPatch,
  normalizeState,
  toPlaceId
} = require('../src/shared/state');
const { isOfficialClientDetected } = require('../src/shared/installation');

test('normalizes persisted state, drops malformed records, and removes duplicate favorites', () => {
  const state = normalizeState({
    settings: { reduceMotion: true, theme: 'aurora', density: 'compact', accent: 'mint' },
    ui: { lastPage: 'library' },
    profiles: [
      { id: 'profile_12345678901234567890', name: '  Main\nSetup ', description: ' First   profile ', color: 'mint', createdAt: '2026-01-01' },
      { name: '   ' }
    ],
    favorites: [
      { placeId: '1818', title: ' Classic   Crossroads ', addedAt: '2026-01-02' },
      { placeId: 1818, title: 'Duplicate' },
      { placeId: 'not-an-id', title: 'Bad' }
    ]
  });

  assert.equal(state.schemaVersion, 2);
  assert.equal(state.settings.reduceMotion, true);
  assert.equal(state.settings.theme, 'aurora');
  assert.equal(state.settings.accent, 'mint');
  assert.equal(state.settings.density, 'compact');
  assert.equal(state.ui.lastPage, 'library');
  assert.deepEqual(state.profiles[0].name, 'Main Setup');
  assert.deepEqual(state.profiles[0].description, 'First profile');
  assert.equal(state.favorites.length, 1);
  assert.equal(state.favorites[0].placeId, 1818);
  assert.equal(state.favorites[0].title, 'Classic Crossroads');
});

test('settings use safe defaults and reject malformed update patches', () => {
  const state = normalizeState({
    settings: {
      theme: 'untrusted-theme',
      highContrast: 'true',
      startPage: 'unknown-page',
      librarySort: 'title'
    },
    ui: { lastPage: 'not-a-page' }
  });

  assert.equal(state.settings.theme, 'midnight');
  assert.equal(state.settings.highContrast, false);
  assert.equal(state.settings.startPage, 'overview');
  assert.equal(state.settings.librarySort, 'title');
  assert.equal(state.ui.lastPage, 'overview');
  assert.deepEqual(normalizeSettingsPatch({ highContrast: true, theme: 'carbon' }), { highContrast: true, theme: 'carbon' });
  assert.throws(() => normalizeSettingsPatch({ theme: 'untrusted-theme' }), /theme setting is invalid/);
  assert.throws(() => normalizeSettingsPatch({ highContrast: 'true' }), /highContrast setting must be enabled or disabled/);
  assert.throws(() => normalizeSettingsPatch({ unknown: true }), /Unsupported setting/);
});

test('profile and favorite creators enforce required valid user inputs', () => {
  assert.throws(() => createProfile({ name: '   ' }), /Profile name is required/);
  assert.throws(() => createFavorite({ placeId: 'anything' }), /valid numeric Roblox experience ID/);
  assert.equal(toPlaceId('0001818'), 1818);

  const profile = createProfile({ name: '  Weekend  ', description: '  Calm  setup ', color: 'sky' });
  assert.match(profile.id, /^profile_/);
  assert.equal(profile.name, 'Weekend');
  assert.equal(profile.color, 'sky');

  const favorite = createFavorite({ placeId: '1818', title: '  Crossroads ' });
  assert.equal(favorite.placeId, 1818);
  assert.equal(favorite.title, 'Crossroads');
});

test('state retains a bounded number of unique favorite entries', () => {
  const favorites = Array.from({ length: MAX_FAVORITES + 10 }, (_, index) => ({
    placeId: index + 1,
    title: `Experience ${index + 1}`
  }));
  const state = normalizeState({ favorites });

  assert.equal(state.favorites.length, MAX_FAVORITES);
  assert.equal(state.favorites[0].placeId, 1);
  assert.equal(state.favorites.at(-1).placeId, MAX_FAVORITES);
});

test('only a detected official client satisfies the launch gate', () => {
  assert.equal(isOfficialClientDetected({ status: 'detected' }), true);
  assert.equal(isOfficialClientDetected({ status: 'not-detected' }), false);
  assert.equal(isOfficialClientDetected({ status: 'unsupported-platform' }), false);
  assert.equal(isOfficialClientDetected(null), false);
});
