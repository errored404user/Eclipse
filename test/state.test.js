'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_FAVORITES,
  createFavorite,
  createProfile,
  normalizeState,
  toPlaceId
} = require('../src/shared/state');

test('normalizes persisted state, drops malformed records, and removes duplicate favorites', () => {
  const state = normalizeState({
    settings: { reduceMotion: true },
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

  assert.equal(state.settings.reduceMotion, true);
  assert.deepEqual(state.profiles[0].name, 'Main Setup');
  assert.deepEqual(state.profiles[0].description, 'First profile');
  assert.equal(state.favorites.length, 1);
  assert.equal(state.favorites[0].placeId, 1818);
  assert.equal(state.favorites[0].title, 'Classic Crossroads');
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
