const { randomUUID } = require('node:crypto');

const CACHE_TTL_MS = 45_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_GAMES = 24;
const MAX_EXPLORE_COLLECTIONS = 6;
const MAX_GAMES_PER_COLLECTION = 12;
const MAX_ICON_IDS = 100;
const MAX_SERVER_PAGE = 100;
const cache = new Map();

function readNumber(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function normalizePlaceId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^\d{1,15}$/.test(text)) return null;
  const placeId = Number(text);
  return Number.isSafeInteger(placeId) && placeId > 0 ? placeId : null;
}

function normalizeGameInstanceId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text.toLowerCase() : '';
}

function normalizeGame(item) {
  const universeId = readNumber(item.universeId ?? item.id);
  const placeId = readNumber(item.rootPlaceId ?? item.placeId);
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  if (!universeId || !placeId || !name) return null;

  const upVotes = readNumber(item.totalUpVotes ?? item.upVotes);
  const downVotes = readNumber(item.totalDownVotes ?? item.downVotes);
  const votes = upVotes + downVotes;
  const playing = readNumber(item.playerCount ?? item.playing);
  const creator = typeof item.creatorName === 'string'
    ? item.creatorName
    : typeof item.creator?.name === 'string'
      ? item.creator.name
      : '';

  return {
    universeId,
    placeId,
    name: name.slice(0, 160),
    description: typeof item.gameDescription === 'string'
      ? item.gameDescription.slice(0, 360)
      : typeof item.description === 'string'
        ? item.description.slice(0, 360)
        : '',
    creator: creator.slice(0, 120),
    playing,
    rating: votes ? Math.round((upVotes / votes) * 100) : null,
    imageUrl: ''
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Eclipse/2.0.0'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Roblox responded with ${response.status}`);
  }

  return response.json();
}

async function attachIcons(games) {
  const ids = [...new Set(games.map((game) => game.universeId))].slice(0, MAX_ICON_IDS);
  if (!ids.length) return games;

  const url = new URL('https://thumbnails.roblox.com/v1/games/icons');
  url.search = new URLSearchParams({
    universeIds: ids.join(','),
    returnPolicy: 'PlaceHolder',
    size: '512x512',
    format: 'Png',
    isCircular: 'false'
  }).toString();

  try {
    const result = await fetchJson(url);
    const icons = new Map((result.data ?? []).map((item) => [readNumber(item.targetId), item.imageUrl]));
    return games.map((game) => ({ ...game, imageUrl: typeof icons.get(game.universeId) === 'string' ? icons.get(game.universeId) : '' }));
  } catch {
    return games;
  }
}

function exploreCollectionTitle(sort, index) {
  const title = String(sort.sortDisplayName ?? sort.displayName ?? sort.name ?? '').trim();
  return (title || `Explore Roblox ${index + 1}`).slice(0, 60);
}

function collectExploreCollections(payload) {
  const sorts = Array.isArray(payload.sorts) ? payload.sorts : [];
  const preferred = sorts.find((sort) => /top[- ]?playing|popular/i.test(String(sort.sortId ?? sort.sortDisplayName ?? '')));
  const groups = preferred ? [preferred, ...sorts.filter((sort) => sort !== preferred)] : sorts;
  const collectionIds = new Set();
  const collections = [];

  for (const [index, sort] of groups.entries()) {
    const sortId = String(sort.sortId ?? sort.id ?? '').trim().slice(0, 120);
    const id = sortId || `explore-${index + 1}`;
    if (collectionIds.has(id)) continue;
    const games = [];
    const gameIds = new Set();
    for (const item of Array.isArray(sort.games) ? sort.games : []) {
      const game = normalizeGame(item);
      if (!game || gameIds.has(game.universeId)) continue;
      gameIds.add(game.universeId);
      games.push(game);
      if (games.length >= MAX_GAMES_PER_COLLECTION) break;
    }
    if (!games.length) continue;
    collectionIds.add(id);
    collections.push({ id, title: exploreCollectionTitle(sort, index), games });
    if (collections.length >= MAX_EXPLORE_COLLECTIONS) break;
  }

  return collections;
}

function collectSearchGames(payload) {
  const unique = new Map();
  for (const group of Array.isArray(payload.searchResults) ? payload.searchResults : []) {
    for (const item of Array.isArray(group.contents) ? group.contents : []) {
      if (item.isSponsored === true) continue;
      const game = normalizeGame(item);
      if (game && !unique.has(game.universeId)) unique.set(game.universeId, game);
      if (unique.size >= MAX_GAMES) return [...unique.values()];
    }
  }
  return [...unique.values()];
}

async function listGames(request = {}) {
  const query = typeof request.query === 'string' ? request.query.trim().slice(0, 100) : '';
  const cursor = typeof request.cursor === 'string' ? request.cursor.slice(0, 500) : '';
  const key = `${query}\u0000${cursor}`;
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.value;

  const sessionId = randomUUID();
  let games;
  let collections = [];
  let nextCursor = '';
  let source;

  if (query) {
    const url = new URL('https://apis.roblox.com/search-api/omni-search');
    url.search = new URLSearchParams({
      searchQuery: query,
      pageToken: cursor,
      sessionId,
      pageType: 'all'
    }).toString();
    const payload = await fetchJson(url);
    games = collectSearchGames(payload);
    nextCursor = typeof payload.nextPageToken === 'string' ? payload.nextPageToken : '';
    source = 'search';
  } else {
    const url = new URL('https://apis.roblox.com/explore-api/v1/get-sorts');
    url.searchParams.set('sessionId', sessionId);
    const payload = await fetchJson(url);
    collections = collectExploreCollections(payload);
    const iconReadyGames = await attachIcons(collections.flatMap((collection) => collection.games));
    const icons = new Map(iconReadyGames.map((game) => [game.universeId, game.imageUrl]));
    collections = collections.map((collection) => ({
      ...collection,
      games: collection.games.map((game) => ({ ...game, imageUrl: icons.get(game.universeId) || '' }))
    }));
    games = collections[0]?.games ?? [];
    source = 'explore';
  }

  const value = {
    games: query ? await attachIcons(games) : games,
    collections,
    nextCursor,
    source
  };
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function normalizeCursor(value) {
  return typeof value === 'string' ? value.trim().slice(0, 500) : '';
}

function cacheResult(key, ttl, loader) {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return Promise.resolve(existing.value);
  return Promise.resolve(loader()).then((value) => {
    cache.set(key, { value, expiresAt: Date.now() + ttl });
    return value;
  });
}

function normalizeDetailGame(item) {
  const game = normalizeGame(item);
  if (!game) return null;
  const numeric = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  };
  const creator = item?.creator && typeof item.creator === 'object' ? item.creator : {};
  const genres = [item?.genre, item?.genreL1, item?.genreL2].filter((value, index, values) => typeof value === 'string' && value.trim() && values.indexOf(value) === index).map((value) => value.trim().slice(0, 60));
  return {
    ...game,
    creator: game.creator || String(creator.name || '').trim().slice(0, 120),
    visits: numeric(item?.visits),
    favorites: numeric(item?.favoritedCount ?? item?.favorites),
    maxPlayers: numeric(item?.maxPlayers),
    created: typeof item?.created === 'string' ? item.created.slice(0, 64) : '',
    updated: typeof item?.updated === 'string' ? item.updated.slice(0, 64) : '',
    genres
  };
}

function normalizeServer(item) {
  const id = normalizeGameInstanceId(item?.id);
  const playing = Number.isFinite(Number(item?.playing)) && Number(item.playing) >= 0 ? Math.floor(Number(item.playing)) : 0;
  const maxPlayers = Number.isFinite(Number(item?.maxPlayers)) && Number(item.maxPlayers) > 0 ? Math.floor(Number(item.maxPlayers)) : 0;
  if (!id || !maxPlayers) return null;
  const pingValue = Number(item?.ping);
  const fpsValue = Number(item?.fps);
  return {
    id,
    playing: Math.min(playing, maxPlayers),
    maxPlayers,
    ping: Number.isFinite(pingValue) && pingValue >= 0 ? Math.round(pingValue) : null,
    fps: Number.isFinite(fpsValue) && fpsValue >= 0 ? Math.round(fpsValue) : null
  };
}

async function getGameDetails(universeId) {
  const id = readNumber(universeId);
  if (!id) throw new Error('A valid Roblox universe ID is required.');
  return cacheResult(`detail:${id}`, CACHE_TTL_MS, async () => {
    const url = new URL('https://games.roblox.com/v1/games');
    url.searchParams.set('universeIds', String(id));
    const payload = await fetchJson(url);
    const game = normalizeDetailGame(Array.isArray(payload?.data) ? payload.data[0] : null);
    if (!game) throw new Error('Roblox did not return details for this experience.');
    return game;
  });
}

async function listGameServers(placeId, cursor = '') {
  const id = normalizePlaceId(placeId);
  if (!id) throw new Error('A valid Roblox place ID is required.');
  const safeCursor = normalizeCursor(cursor);
  return cacheResult(`servers:${id}:${safeCursor}`, 15_000, async () => {
    const url = new URL(`https://games.roblox.com/v1/games/${id}/servers/Public`);
    url.searchParams.set('sortOrder', 'Asc');
    url.searchParams.set('limit', String(MAX_SERVER_PAGE));
    url.searchParams.set('excludeFullGames', 'true');
    if (safeCursor) url.searchParams.set('cursor', safeCursor);
    const payload = await fetchJson(url);
    return {
      servers: (Array.isArray(payload?.data) ? payload.data : []).map(normalizeServer).filter(Boolean).slice(0, MAX_SERVER_PAGE),
      nextCursor: normalizeCursor(payload?.nextPageCursor)
    };
  });
}

module.exports = { getGameDetails, listGameServers, listGames, normalizeGameInstanceId, normalizePlaceId };
