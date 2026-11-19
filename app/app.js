const toast = document.querySelector('[data-toast]');
const pageContent = document.querySelector('[data-page-content]');
const sidebar = document.querySelector('[data-sidebar]');
const desktopWindow = window.eclipseWindow;
const storageKeys = {
  library: 'eclipse.roblox.library.v1',
  recent: 'eclipse.roblox.recent.v1',
  settings: 'eclipse.settings.v1',
  integrations: 'eclipse.integrations.v1',
  profile: 'eclipse.profile.v1',
  fastFlagProfiles: 'eclipse.fastflag-profiles.v1',
  launchHistory: 'eclipse.launch-history.v1'
};

const state = {
  page: 'home',
  library: readStored(storageKeys.library, []).map(normalizeGame).filter(Boolean).sort((left, right) => Number(right.pinned) - Number(left.pinned)),
  recent: readStored(storageKeys.recent, []).map(normalizeGame).filter(Boolean),
  settings: normalizeSettings(readStored(storageKeys.settings, {})),
  integrations: normalizeIntegrations(readStored(storageKeys.integrations, {})),
  profile: normalizeProfile(readStored(storageKeys.profile, {})),
  launchHistory: normalizeLaunchHistory(readStored(storageKeys.launchHistory, [])),
  discover: { games: [], collections: [], collectionId: '', query: '', cursor: '', loading: false, error: '', sort: 'featured', filter: 'all' },
  gameDetails: { universeId: 0, placeId: 0, game: null, passes: [], servers: [], serversCursor: '', loading: false, passesLoading: false, serversLoading: false, error: '', passesError: '', serversError: '', tab: 'about', serverSort: 'ping', origin: 'discover' },
  bootstrapper: { status: null, busy: false, progress: null, error: '' },
  mods: { status: null, targets: null, targetsLoading: false, targetError: '', busy: false, message: '', creator: { open: false, name: '', id: '', version: '1.0.0', description: '', assets: [] } },
  startup: { status: null, busy: false },
  optimization: { status: null, busy: '', message: '' },
  fastFlags: { ...defaultFastFlagSelection(), status: null, profileId: '', busy: false, message: '' },
  fastFlagProfiles: normalizeSavedFastFlagProfiles(readStored(storageKeys.fastFlagProfiles, []))
};

const browserRoblox = {
  async listGames({ query = '', cursor = '' } = {}) {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (cursor) params.set('cursor', cursor);
    const response = await fetch(`/api/roblox/games?${params.toString()}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Roblox discovery is unavailable.');
    return result;
  },
  async gameDetails(universeId) {
    const response = await fetch(`/api/roblox/game-details?universeId=${encodeURIComponent(universeId)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Roblox game details are unavailable.');
    return result;
  },
  async gamePasses(universeId) {
    const response = await fetch(`/api/roblox/game-passes?universeId=${encodeURIComponent(universeId)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Roblox game passes are unavailable.');
    return Array.isArray(result.passes) ? result.passes : [];
  },
  async gameServers(placeId, cursor = '') {
    const params = new URLSearchParams({ placeId: String(placeId) });
    if (cursor) params.set('cursor', cursor);
    const response = await fetch(`/api/roblox/game-servers?${params.toString()}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Roblox servers are unavailable.');
    return result;
  },
  async launchPlace(placeId) {
    window.location.assign(`roblox://experiences/start?placeId=${encodeURIComponent(placeId)}`);
    return { opened: true };
  },
  async openOfficial(action, placeId) {
    const urls = {
      game: `https://www.roblox.com/games/${encodeURIComponent(placeId)}`
    };
    const url = urls[action];
    if (!url) throw new Error('Unsupported Roblox action.');
    window.open(url, '_blank', 'noopener,noreferrer');
    return { opened: true };
  }
};

const roblox = window.eclipseRoblox || browserRoblox;

const browserBootstrapper = {
  async status() {
    return {
      supported: false,
      installed: false,
      updateAvailable: false,
      reason: 'The Eclipse bootstrapper runs in the Windows desktop app. Browser mode can still request the installed Roblox Player through its official protocol.'
    };
  },
  async update() { throw new Error('The Eclipse bootstrapper runs in the Windows desktop app.'); },
  async repair() { throw new Error('The Eclipse bootstrapper runs in the Windows desktop app.'); },
  onProgress() { return () => {}; }
};

const bootstrapper = window.eclipseBootstrapper || browserBootstrapper;

const browserSystem = {
  async startupStatus() { return { supported: false, enabled: false, reason: 'Launch on startup is available in the packaged Windows Eclipse app.' }; },
  async setStartup() { return this.startupStatus(); },
  async optimizationStatus() { return { supported: false, playerRunning: false, robloxCacheBytes: 0, reason: 'Optimization tools are available in the Windows Eclipse desktop app only.' }; },
  async clearEclipseCache() { throw new Error('Eclipse cache cleanup is available in the Windows desktop app only.'); },
  async clearRobloxCache() { throw new Error('Roblox cache cleanup is available in the Windows desktop app only.'); },
  async openWindowsUpdate() { throw new Error('Windows Update can be opened from the Windows Eclipse desktop app only.'); },
  onNavigate() { return () => {}; }
};

const system = window.eclipseSystem || browserSystem;
if (window.eclipseSystem) {
  window.eclipseSystem.onNavigate((page) => setPage(page));
}

const browserFastFlags = {
  async getStatus() { return { supported: false, reason: 'Fast Flags can be applied from the Windows Eclipse desktop app.' }; },
  async apply() { throw new Error('Fast Flags can be applied from the Windows Eclipse desktop app.'); },
  async reset() { throw new Error('Fast Flags can be reset from the Windows Eclipse desktop app.'); }
};

const fastFlags = window.eclipseFastFlags || browserFastFlags;

const browserMods = {
  async status() { return { supported: false, installed: false, playerRunning: false, packs: [], reason: 'Player packs are available in the Windows Eclipse desktop app only.' }; },
  async targets() { throw new Error('Player target scanning is available in the Windows Eclipse desktop app only.'); },
  async importPackage() { throw new Error('Player packs are available in the Windows Eclipse desktop app only.'); },
  async importFolder() { throw new Error('Player packs are available in the Windows Eclipse desktop app only.'); },
  async pickCreatorAsset() { throw new Error('Player packs are available in the Windows Eclipse desktop app only.'); },
  async createPackage() { throw new Error('Player packs are available in the Windows Eclipse desktop app only.'); },
  async setEnabled() { throw new Error('Player packs are available in the Windows Eclipse desktop app only.'); },
  async restore() { throw new Error('Player packs are available in the Windows Eclipse desktop app only.'); },
  async remove() { throw new Error('Player packs are available in the Windows Eclipse desktop app only.'); }
};

const mods = window.eclipseMods || browserMods;


const browserDiscord = {
  async status() {
    return {
      supported: false,
      configured: false,
      enabled: false,
      connected: false,
      connecting: false,
      reason: 'Discord Rich Presence is available from the Eclipse desktop app.'
    };
  },
  async configure() { return this.status(); },
  onStatus() { return () => {}; }
};

const discord = window.eclipseDiscord || browserDiscord;
let discordStatus = null;
if (window.eclipseDiscord) {
  window.eclipseDiscord.onStatus((status) => {
    discordStatus = status;
    if (state.page === 'integrations') renderIntegrations();
  });
}
if (window.eclipseBootstrapper) {
  window.eclipseBootstrapper.onProgress((progress) => {
    state.bootstrapper.progress = progress;
    state.bootstrapper.busy = Boolean(progress?.busy);
    if (progress?.phase === 'error') state.bootstrapper.error = String(progress.detail || 'Roblox Player update failed.');
    if (progress?.phase === 'ready') state.bootstrapper.error = '';
    if (state.page === 'tools') renderTools();
  });
}


let toastTimer;
let pendingProfileAvatar = null;
let profileImageRequest = 0;

function readStored(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(fallback) ? (Array.isArray(value) ? value : fallback) : (value && typeof value === 'object' ? value : fallback);
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeProfileImage(value) {
  const dataUrl = String(value || '');
  if (dataUrl.length > 375_000) return '';
  return /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl) ? dataUrl : '';
}

function normalizeProfile(value) {
  const displayName = String(value?.displayName || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  const avatarDataUrl = normalizeProfileImage(value?.avatarDataUrl);
  return displayName ? { displayName, avatarDataUrl, created: true } : { displayName: 'Eclipse guest', avatarDataUrl: '', created: false };
}

function normalizeDiscordAssetKey(value) {
  const key = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,32}$/.test(key) ? key : 'eclipse';
}

function normalizeDiscordActivityDisplay(value) {
  return ['open-eclipse', 'minimal'].includes(value) ? value : 'open-eclipse';
}

function normalizeIntegrations(value) {
  const activityTracking = value?.activityTracking !== false;
  const discordClientId = String(value?.discordClientId || '').trim();
  return {
    activityTracking,
    discordRichPresence: value?.discordRichPresence === true,
    discordClientId: /^\d{17,20}$/.test(discordClientId) ? discordClientId : '',
    discordAssetKey: normalizeDiscordAssetKey(value?.discordAssetKey),
    discordActivityDisplay: normalizeDiscordActivityDisplay(value?.discordActivityDisplay)
  };
}

function normalizeSettings(value) {
  const scale = Number(value?.uiScale);
  return {
    reducedMotion: value?.reducedMotion === true,
    compactCards: value?.compactCards === true,
    highContrast: value?.highContrast === true,
    uiScale: [1, 1.1, 1.2, 1.3].includes(scale) ? scale : 1,
    clock24Hour: value?.clock24Hour === true
  };
}

function defaultFastFlagSelection() {
  return { profile: 'balanced', msaa: 2, fpsCap: 0, preserveDisplayScaling: false, meshDetailEnabled: false, meshDetail: 3, frmQualityEnabled: false, frmQuality: 21, renderingMode: 'automatic' };
}

function normalizeFastFlagSelection(value = {}) {
  const profile = ['default', 'performance', 'balanced', 'quality'].includes(value.profile) ? value.profile : 'balanced';
  const integer = (candidate, allowed, fallback) => allowed.includes(Number(candidate)) ? Number(candidate) : fallback;
  return {
    profile,
    msaa: integer(value.msaa, [0, 1, 2, 4], profile === 'default' ? 0 : ({ performance: 1, balanced: 2, quality: 4 }[profile] || 2)),
    fpsCap: integer(value.fpsCap, [0, 60, 120, 144, 165, 240], 0),
    preserveDisplayScaling: value.preserveDisplayScaling === true,
    meshDetailEnabled: value.meshDetailEnabled === true,
    meshDetail: integer(value.meshDetail, [0, 1, 2, 3], 3),
    frmQualityEnabled: value.frmQualityEnabled === true,
    frmQuality: integer(value.frmQuality, Array.from({ length: 21 }, (_item, index) => index + 1), 21),
    renderingMode: ['automatic', 'd3d11', 'vulkan'].includes(value.renderingMode) ? value.renderingMode : 'automatic'
  };
}

function normalizeSavedFastFlagProfiles(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.flatMap((item) => {
    const id = String(item?.id || '').trim();
    const name = String(item?.name || '').trim().replace(/\s+/g, ' ').slice(0, 36);
    if (!/^[a-z0-9_-]{8,48}$/i.test(id) || !name || ids.has(id)) return [];
    ids.add(id);
    return [{ id, name, settings: normalizeFastFlagSelection(item.settings), updatedAt: validLocalTimestamp(item.updatedAt) }];
  }).slice(0, 20);
}

function validLocalTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeLaunchHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const placeId = Number(item?.placeId);
    if (!Number.isSafeInteger(placeId) || placeId <= 0) return [];
    const launchedAt = validLocalTimestamp(item.launchedAt);
    return [{ placeId, name: String(item.name || '').trim().slice(0, 160), launchedAt }];
  }).slice(0, 30);
}

function saveIntegrations() {
  state.integrations = normalizeIntegrations(state.integrations);
  writeStored(storageKeys.integrations, state.integrations);
}

function discordPresenceOptions() {
  return {
    applicationId: state.integrations.discordClientId,
    enabled: state.integrations.discordRichPresence === true,
    imageAssetKey: state.integrations.discordAssetKey,
    activityDisplay: state.integrations.discordActivityDisplay
  };
}

async function syncDiscordPresence({ render = false } = {}) {
  try {
    discordStatus = await discord.configure(discordPresenceOptions());
  } catch (error) {
    discordStatus = {
      supported: true,
      configured: Boolean(state.integrations.discordClientId),
      enabled: false,
      connected: false,
      connecting: false,
      reason: error instanceof Error ? error.message : 'Discord Rich Presence could not be configured.'
    };
  }
  if (render && state.page === 'integrations') renderIntegrations();
  return discordStatus;
}

async function refreshDiscordStatus() {
  try {
    discordStatus = await discord.status();
  } catch (error) {
    discordStatus = {
      supported: true,
      configured: false,
      enabled: false,
      connected: false,
      connecting: false,
      reason: error instanceof Error ? error.message : 'Discord Rich Presence status is unavailable.'
    };
  }
  if (state.page === 'integrations') renderIntegrations();
  return discordStatus;
}

function profileInitials(profile = state.profile) {
  const initials = profile.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('');
  return (initials || 'E').toUpperCase();
}

function setAvatarSurface(element, avatarDataUrl, initials = profileInitials()) {
  if (!element) return;
  const hasImage = Boolean(avatarDataUrl);
  element.textContent = hasImage ? '' : initials;
  element.classList.toggle('has-image', hasImage);
  if (hasImage) element.style.backgroundImage = `url("${avatarDataUrl}")`;
  else element.style.removeProperty('background-image');
}

function updateProfileSurface() {
  const { created, displayName, avatarDataUrl } = state.profile;
  const name = created ? displayName : 'Eclipse guest';
  const status = created ? 'Stored on this device' : 'Local profile';
  document.querySelectorAll('[data-profile-name]').forEach((element) => { element.textContent = name; });
  document.querySelectorAll('[data-profile-status]').forEach((element) => { element.textContent = status; });
  document.querySelectorAll('[data-profile-avatar]').forEach((element) => setAvatarSurface(element, avatarDataUrl));
}

function updateProfileDialogAvatar() {
  const avatar = normalizeProfileImage(pendingProfileAvatar);
  document.querySelectorAll('[data-profile-dialog-avatar]').forEach((element) => setAvatarSurface(element, avatar));
  document.querySelectorAll('[data-action="clear-profile-image"]').forEach((button) => {
    button.hidden = !avatar;
  });
}

function profileDialog() {
  return document.querySelector('[data-profile-dialog]');
}

function closeProfileDialog() {
  profileImageRequest += 1;
  pendingProfileAvatar = null;
  const dialog = profileDialog();
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

function openProfileDialog() {
  const dialog = profileDialog();
  if (!dialog) return;
  const input = dialog.querySelector('[name="displayName"]');
  const imageInput = dialog.querySelector('[data-profile-image-input]');
  const title = dialog.querySelector('[data-profile-dialog-title]');
  const copy = dialog.querySelector('[data-profile-dialog-copy]');
  const submit = dialog.querySelector('[data-profile-submit]');
  const error = dialog.querySelector('[data-profile-input-error]');
  const editing = state.profile.created;
  pendingProfileAvatar = state.profile.avatarDataUrl || '';
  if (title) title.textContent = editing ? 'Edit your Eclipse profile' : 'Create your Eclipse profile';
  if (copy) copy.textContent = editing ? 'Update the display name and profile image stored locally in Eclipse on this device.' : 'Choose a display name and optional profile image for this device. This is not a Roblox account and Eclipse never asks for Roblox credentials.';
  if (submit) submit.textContent = editing ? 'Save profile' : 'Create local profile';
  if (input) {
    input.value = editing ? state.profile.displayName : '';
    input.setAttribute('aria-invalid', 'false');
  }
  if (imageInput) imageInput.value = '';
  if (error) error.hidden = true;
  updateProfileDialogAvatar();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  window.setTimeout(() => input?.focus(), 0);
}

function readLocalImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The selected image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function loadLocalImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected image could not be decoded.'));
    image.src = source;
  });
}

async function prepareProfileImage(file) {
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!file || !allowedTypes.has(file.type) || file.size > 4 * 1024 * 1024) {
    throw new Error('Choose a PNG, JPEG, or WebP profile image no larger than 4 MB.');
  }
  const image = await loadLocalImage(await readLocalImage(file));
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error('The selected image has no usable dimensions.');
  const sourceSide = Math.min(sourceWidth, sourceHeight);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Eclipse could not prepare the selected profile image.');
  context.fillStyle = '#21182e';
  context.fillRect(0, 0, 256, 256);
  context.drawImage(image, (sourceWidth - sourceSide) / 2, (sourceHeight - sourceSide) / 2, sourceSide, sourceSide, 0, 0, 256, 256);
  const avatarDataUrl = canvas.toDataURL('image/jpeg', .84);
  if (!normalizeProfileImage(avatarDataUrl)) throw new Error('The prepared profile image is too large to store locally.');
  return avatarDataUrl;
}

async function setPendingProfileImage(file) {
  const request = ++profileImageRequest;
  try {
    const avatarDataUrl = await prepareProfileImage(file);
    if (request !== profileImageRequest) return;
    pendingProfileAvatar = avatarDataUrl;
    updateProfileDialogAvatar();
    showToast('Profile image prepared for this local Eclipse profile.');
  } catch (error) {
    if (request !== profileImageRequest) return;
    showToast(error instanceof Error ? error.message : 'The selected profile image could not be used.');
  }
}

function saveEclipseProfile(form) {
  const input = form.querySelector('[name="displayName"]');
  const error = form.querySelector('[data-profile-input-error]');
  const displayName = String(new FormData(form).get('displayName') || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  if (!displayName) {
    if (error) {
      error.textContent = 'Enter a display name to create your local Eclipse profile.';
      error.hidden = false;
    }
    input?.setAttribute('aria-invalid', 'true');
    input?.focus();
    return;
  }
  state.profile = normalizeProfile({ displayName, avatarDataUrl: pendingProfileAvatar || '' });
  writeStored(storageKeys.profile, state.profile);
  updateProfileSurface();
  closeProfileDialog();
  renderCurrentPage();
  showToast('Your local Eclipse profile was saved.');
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function safeImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function formatCount(value) {
  const count = Math.max(0, Number(value) || 0);
  return new Intl.NumberFormat(undefined, { notation: count >= 1_000 ? 'compact' : 'standard', maximumFractionDigits: count >= 1_000 ? 1 : 0 }).format(count);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function formatLocalLaunchTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', hour12: !state.settings.clock24Hour }).format(date);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4300);
}

function normalizeGame(game) {
  if (!game || !Number.isSafeInteger(Number(game.placeId)) || !Number.isSafeInteger(Number(game.universeId))) return null;
  const name = String(game.name || '').trim();
  if (!name) return null;
  return {
    universeId: Number(game.universeId),
    placeId: Number(game.placeId),
    name: name.slice(0, 160),
    description: String(game.description || '').slice(0, 360),
    creator: String(game.creator || '').slice(0, 120),
    playing: Math.max(0, Number(game.playing) || 0),
    rating: Number.isFinite(Number(game.rating)) ? Number(game.rating) : null,
    imageUrl: safeImageUrl(game.imageUrl),
    pinned: game.pinned === true,
    launchedAt: game.launchedAt ? validLocalTimestamp(game.launchedAt) : ''
  };
}

function normalizeDiscoverCollections(value) {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set();
  return value.flatMap((collection, index) => {
    const id = String(collection?.id || '').trim().slice(0, 120);
    const title = String(collection?.title || '').trim().slice(0, 60);
    const games = Array.isArray(collection?.games) ? collection.games.map(normalizeGame).filter(Boolean) : [];
    if (!id || !title || !games.length || usedIds.has(id)) return [];
    usedIds.add(id);
    return [{ id, title, games }];
  }).slice(0, 6);
}

function activeDiscoverCollection() {
  const collections = state.discover.collections;
  if (!collections.length) return null;
  return collections.find((collection) => collection.id === state.discover.collectionId) || collections[0];
}

function allKnownGames() {
  const collectionGames = state.discover.collections.flatMap((collection) => collection.games);
  const games = [...state.discover.games, ...collectionGames, ...state.library, ...state.recent];
  return [...new Map(games.map((game) => [Number(game.placeId), game])).values()];
}

function gameForPlace(placeId) {
  return allKnownGames().find((game) => Number(game.placeId) === Number(placeId)) || null;
}

function normalizeGameDetails(value, fallback = null) {
  const game = normalizeGame({ ...fallback, ...value, imageUrl: value?.imageUrl || fallback?.imageUrl || '' });
  if (!game) return null;
  const number = (item) => Number.isFinite(Number(item)) && Number(item) >= 0 ? Math.floor(Number(item)) : 0;
  const genres = Array.isArray(value?.genres) ? value.genres.map((item) => String(item || '').trim().slice(0, 60)).filter(Boolean).slice(0, 3) : [];
  return {
    ...game,
    visits: number(value?.visits),
    favorites: number(value?.favorites),
    maxPlayers: number(value?.maxPlayers),
    created: typeof value?.created === 'string' ? value.created : '',
    updated: typeof value?.updated === 'string' ? value.updated : '',
    genres
  };
}

function normalizeGamePasses(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((pass) => {
    const id = Number(pass?.id);
    const name = String(pass?.name || '').trim().slice(0, 120);
    if (!Number.isSafeInteger(id) || id <= 0 || !name) return [];
    const price = Number(pass?.price);
    return [{ id, name, description: String(pass?.description || '').trim().slice(0, 280), price: Number.isFinite(price) && price >= 0 ? Math.floor(price) : null, isForSale: pass?.isForSale !== false }];
  }).slice(0, 24);
}

function normalizeGameServers(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((server) => {
    const id = String(server?.id || '').trim().slice(0, 200);
    const playing = Number(server?.playing);
    const maxPlayers = Number(server?.maxPlayers);
    const ping = Number(server?.ping);
    const fps = Number(server?.fps);
    if (!id || !Number.isFinite(playing) || playing < 0 || !Number.isFinite(maxPlayers) || maxPlayers <= 0) return [];
    return [{ id, playing: Math.min(Math.floor(playing), Math.floor(maxPlayers)), maxPlayers: Math.floor(maxPlayers), ping: Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : null, fps: Number.isFinite(fps) && fps >= 0 ? Math.round(fps) : null }];
  }).slice(0, 100);
}

function gameDetailsSeed(universeId, placeId) {
  return allKnownGames().find((game) => game.universeId === Number(universeId) || game.placeId === Number(placeId)) || null;
}

function gameDetailsDefaults({ universeId = 0, placeId = 0, origin = 'discover', game = null } = {}) {
  return { universeId: Number(universeId) || 0, placeId: Number(placeId) || 0, game, passes: [], servers: [], serversCursor: '', loading: false, passesLoading: false, serversLoading: false, error: '', passesError: '', serversError: '', tab: 'about', serverSort: 'ping', origin };
}

function openGameDetails(universeId, placeId) {
  const safeUniverseId = Number(universeId);
  const safePlaceId = Number(placeId);
  if (!Number.isSafeInteger(safeUniverseId) || safeUniverseId <= 0 || !Number.isSafeInteger(safePlaceId) || safePlaceId <= 0) {
    showToast('That Roblox experience is unavailable.');
    return;
  }
  const origin = ['home', 'discover', 'library'].includes(state.page) ? state.page : 'discover';
  state.gameDetails = gameDetailsDefaults({ universeId: safeUniverseId, placeId: safePlaceId, origin, game: gameDetailsSeed(safeUniverseId, safePlaceId) });
  state.page = 'game-details';
  document.querySelectorAll('[data-page]').forEach((button) => {
    button.classList.remove('active');
    button.removeAttribute('aria-current');
  });
  sidebar.classList.remove('open');
  renderCurrentPage();
  void loadGameDetails();
}

function backFromGameDetails() {
  setPage(['home', 'discover', 'library'].includes(state.gameDetails.origin) ? state.gameDetails.origin : 'discover');
}

function sortedGameServers() {
  const servers = [...state.gameDetails.servers];
  if (state.gameDetails.serverSort === 'players') {
    return servers.sort((left, right) => left.playing - right.playing || (right.maxPlayers - right.playing) - (left.maxPlayers - left.playing) || (left.ping ?? Infinity) - (right.ping ?? Infinity));
  }
  return servers.sort((left, right) => (left.ping ?? Infinity) - (right.ping ?? Infinity) || left.playing - right.playing);
}

async function loadGameDetails() {
  const detail = state.gameDetails;
  if (detail.loading || !detail.universeId || !detail.placeId) return;
  detail.loading = true;
  detail.passesLoading = true;
  detail.serversLoading = true;
  detail.error = '';
  detail.passesError = '';
  detail.serversError = '';
  if (state.page === 'game-details') renderGameDetails();
  const [gameResult, passesResult, serversResult] = await Promise.allSettled([
    roblox.gameDetails(detail.universeId),
    roblox.gamePasses(detail.universeId),
    roblox.gameServers(detail.placeId)
  ]);
  if (gameResult.status === 'fulfilled') {
    detail.game = normalizeGameDetails(gameResult.value, detail.game);
    if (detail.game) {
      detail.universeId = detail.game.universeId;
      detail.placeId = detail.game.placeId;
    }
  } else if (!detail.game) {
    detail.error = gameResult.reason instanceof Error ? gameResult.reason.message : 'Roblox game details are unavailable.';
  }
  if (passesResult.status === 'fulfilled') detail.passes = normalizeGamePasses(passesResult.value);
  else detail.passesError = passesResult.reason instanceof Error ? passesResult.reason.message : 'Roblox game passes are unavailable.';
  if (serversResult.status === 'fulfilled') {
    detail.servers = normalizeGameServers(serversResult.value?.servers);
    detail.serversCursor = typeof serversResult.value?.nextCursor === 'string' ? serversResult.value.nextCursor : '';
  } else detail.serversError = serversResult.reason instanceof Error ? serversResult.reason.message : 'Roblox servers are unavailable.';
  detail.loading = false;
  detail.passesLoading = false;
  detail.serversLoading = false;
  if (state.page === 'game-details') renderGameDetails();
}

async function loadMoreGameServers() {
  const detail = state.gameDetails;
  if (detail.serversLoading || !detail.serversCursor) return;
  detail.serversLoading = true;
  detail.serversError = '';
  if (state.page === 'game-details') renderGameDetails();
  try {
    const result = await roblox.gameServers(detail.placeId, detail.serversCursor);
    const incoming = normalizeGameServers(result?.servers);
    detail.servers = [...new Map([...detail.servers, ...incoming].map((server) => [server.id, server])).values()].slice(0, 200);
    detail.serversCursor = typeof result?.nextCursor === 'string' ? result.nextCursor : '';
  } catch (error) {
    detail.serversError = error instanceof Error ? error.message : 'Roblox servers are unavailable.';
  } finally {
    detail.serversLoading = false;
    if (state.page === 'game-details') renderGameDetails();
  }
}

async function refreshGameServers() {
  const detail = state.gameDetails;
  if (detail.serversLoading || !detail.placeId) return;
  detail.serversLoading = true;
  detail.serversError = '';
  if (state.page === 'game-details') renderGameDetails();
  try {
    const result = await roblox.gameServers(detail.placeId);
    detail.servers = normalizeGameServers(result?.servers);
    detail.serversCursor = typeof result?.nextCursor === 'string' ? result.nextCursor : '';
  } catch (error) {
    detail.serversError = error instanceof Error ? error.message : 'Roblox servers are unavailable.';
  } finally {
    detail.serversLoading = false;
    if (state.page === 'game-details') renderGameDetails();
  }
}

function isSaved(game) {
  return state.library.some((item) => item.universeId === game.universeId);
}

function saveGame(game) {
  const safeGame = normalizeGame(game);
  if (!safeGame || isSaved(safeGame)) return;
  state.library = [safeGame, ...state.library].slice(0, 120);
  writeStored(storageKeys.library, state.library);
}

function removeGame(universeId) {
  state.library = state.library.filter((game) => game.universeId !== Number(universeId));
  writeStored(storageKeys.library, state.library);
}

function togglePinnedGame(universeId) {
  state.library = state.library.map((game) => game.universeId === Number(universeId) ? { ...game, pinned: !game.pinned } : game);
  state.library.sort((left, right) => Number(right.pinned) - Number(left.pinned));
  writeStored(storageKeys.library, state.library);
}

function addLaunchHistory(placeId, game) {
  if (!state.integrations.activityTracking) return;
  const numericId = Number(placeId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return;
  const entry = { placeId: numericId, name: String(game?.name || '').slice(0, 160), launchedAt: new Date().toISOString() };
  state.launchHistory = [entry, ...state.launchHistory.filter((item) => item.placeId !== numericId)].slice(0, 30);
  writeStored(storageKeys.launchHistory, state.launchHistory);
}

function addRecent(game) {
  if (!state.integrations.activityTracking) return;
  const safeGame = normalizeGame(game);
  if (!safeGame) return;
  safeGame.launchedAt = new Date().toISOString();
  state.recent = [safeGame, ...state.recent.filter((item) => item.universeId !== safeGame.universeId)].slice(0, 16);
  writeStored(storageKeys.recent, state.recent);
}

function setSettings() {
  state.settings = normalizeSettings(state.settings);
  writeStored(storageKeys.settings, state.settings);
  document.documentElement.classList.toggle('reduce-motion', Boolean(state.settings.reducedMotion));
  document.documentElement.classList.toggle('compact-cards', Boolean(state.settings.compactCards));
  document.documentElement.classList.toggle('high-contrast', Boolean(state.settings.highContrast));
  document.documentElement.style.setProperty('--ui-scale', String(state.settings.uiScale));
}

function pageHeader(eyebrow, title, description, actions = '') {
  return `<header class="page-header">
    <div>
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="page-description">${escapeHtml(description)}</p>
    </div>
    <div class="page-header-actions">${actions}</div>
  </header>`;
}

function emptyState(icon, title, description, action = '') {
  return `<section class="empty-state panel">
    <span class="empty-icon" aria-hidden="true">${icon}</span>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(description)}</p>
    ${action}
  </section>`;
}

function gameCard(game, options = {}) {
  const image = safeImageUrl(game.imageUrl);
  const hue = Number(game.universeId) % 280;
  const saved = isSaved(game);
  const secondaryAction = options.library
    ? `<div class="game-cover-actions"><button class="card-icon-button ${game.pinned ? 'saved' : ''}" type="button" data-action="pin-game" data-universe-id="${game.universeId}" aria-label="${game.pinned ? 'Unpin' : 'Pin'} ${escapeHtml(game.name)}">${game.pinned ? '★' : '☆'}</button><button class="card-icon-button" type="button" data-action="remove-game" data-universe-id="${game.universeId}" aria-label="Remove ${escapeHtml(game.name)} from library">×</button></div>`
    : `<div class="game-cover-actions"><button class="card-icon-button ${saved ? 'saved' : ''}" type="button" data-action="save-game" data-place-id="${game.placeId}" aria-label="${saved ? 'Saved in' : 'Save'} ${escapeHtml(game.name)}">${saved ? '✓' : '+'}</button></div>`;
  const rating = game.rating === null || game.rating === undefined ? '' : `<span>${game.rating}% liked</span>`;

  return `<article class="game-card panel" data-game-place="${game.placeId}">
    <div class="game-cover" style="--cover-hue:${hue}">
      ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : '<span class="cover-orbit" aria-hidden="true"></span>'}
      <div class="game-cover-shade"></div>
      ${secondaryAction}
      <button class="card-play" type="button" data-action="launch-game" data-place-id="${game.placeId}" aria-label="Play ${escapeHtml(game.name)}"><span class="play-icon"></span></button>
    </div>
    <div class="game-copy">
      <h3 title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</h3>
      <p>${escapeHtml(game.creator || 'Roblox creator')}</p>
      <div class="game-meta"><span><i class="player-dot"></i>${formatCount(game.playing)} playing</span>${rating}</div>
      <button class="game-details-button" type="button" data-action="game-details" data-universe-id="${game.universeId}" data-place-id="${game.placeId}">View details <span>→</span></button>
    </div>
  </article>`;
}

function featuredGame(game) {
  if (!game) return '';
  const image = safeImageUrl(game.imageUrl);
  return `<article class="live-feature panel">
    <div class="live-feature-art" style="--cover-hue:${Number(game.universeId) % 280}">
      ${image ? `<img src="${escapeHtml(image)}" alt="" referrerpolicy="no-referrer" />` : '<span class="cover-orbit" aria-hidden="true"></span>'}
      <div class="live-feature-shade"></div>
    </div>
    <div class="live-feature-copy">
      <p class="section-kicker"><i></i> Live on Roblox</p>
      <h2>${escapeHtml(game.name)}</h2>
      <p>${escapeHtml(game.description || `Play with ${formatCount(game.playing)} people currently in this experience.`)}</p>
      <div class="feature-facts"><span><i class="player-dot"></i>${formatCount(game.playing)} playing</span>${game.rating !== null && game.rating !== undefined ? `<span>${game.rating}% liked</span>` : ''}</div>
      <div class="featured-actions">
        <button class="play-button" type="button" data-action="launch-game" data-place-id="${game.placeId}"><span class="play-icon"></span> Play in Roblox</button>
        <button class="quiet-button" type="button" data-action="game-details" data-universe-id="${game.universeId}" data-place-id="${game.placeId}">View details</button>
        <button class="quiet-button" type="button" data-action="open-game" data-place-id="${game.placeId}">Official page</button>
      </div>
    </div>
  </article>`;
}

function gameDetailsTabButton(tab, label) {
  return `<button class="game-details-tab ${state.gameDetails.tab === tab ? 'active' : ''}" type="button" data-action="game-details-tab" data-game-details-tab="${tab}" aria-pressed="${state.gameDetails.tab === tab ? 'true' : 'false'}">${label}</button>`;
}

function renderGameDetails() {
  const detail = state.gameDetails;
  const game = detail.game;
  if (!game && detail.loading) {
    pageContent.innerHTML = `<div class="page-shell game-details-page">${pageHeader('Official Roblox experience', 'Loading experience…', 'Retrieving official game information, public servers, and available game passes.', '<button class="quiet-button" type="button" data-action="game-details-back">Back</button>')}<section class="game-details-loading panel"><span></span><span></span><span></span></section></div>`;
    return;
  }
  if (!game) {
    pageContent.innerHTML = `<div class="page-shell game-details-page">${pageHeader('Official Roblox experience', 'Experience unavailable', detail.error || 'Roblox did not return information for this experience.', '<button class="quiet-button" type="button" data-action="game-details-back">Back</button>')}${emptyState('!', 'Details could not be loaded.', detail.error || 'Refresh the official Roblox data and try again.', '<button class="primary-button" type="button" data-action="game-details-retry">Try again</button>')}</div>`;
    return;
  }
  const image = safeImageUrl(game.imageUrl);
  const rating = game.rating === null || game.rating === undefined ? 'Rating unavailable' : `${game.rating}% liked`;
  const genres = Array.isArray(game.genres) ? game.genres : [];
  const about = `<section class="game-detail-about"><article class="game-detail-description panel"><p class="section-kicker"><i></i> About this experience</p><h2>${escapeHtml(game.name)}</h2><p>${escapeHtml(game.description || 'Roblox has not provided a description for this experience.')}</p>${genres.length ? `<div class="game-detail-tags">${genres.map((genre) => `<span>${escapeHtml(genre)}</span>`).join('')}</div>` : ''}</article><aside class="game-detail-facts panel"><p class="section-kicker">Official snapshot</p><div><span>Creator</span><strong>${escapeHtml(game.creator || 'Roblox creator')}</strong></div><div><span>Visits</span><strong>${formatCount(game.visits)}</strong></div><div><span>Favorites</span><strong>${formatCount(game.favorites)}</strong></div><div><span>Updated</span><strong>${escapeHtml(game.updated ? formatDate(game.updated) : 'Unavailable')}</strong></div></aside></section>`;
  const servers = sortedGameServers();
  const serverRows = detail.serversLoading && !servers.length
    ? Array.from({ length: 6 }, () => '<li class="server-row skeleton"><span></span><span></span><span></span></li>').join('')
    : servers.length
      ? servers.map((server, index) => `<li class="server-row"><span class="server-index">${String(index + 1).padStart(2, '0')}</span><div><strong>${formatCount(server.playing)} <small>/ ${formatCount(server.maxPlayers)} players</small></strong><span>${formatCount(Math.max(0, server.maxPlayers - server.playing))} open slot${server.maxPlayers - server.playing === 1 ? '' : 's'}</span></div><div class="server-signal"><strong>${server.ping === null ? '—' : `${server.ping} ms`}</strong><span>${server.ping === null ? 'Ping unavailable' : 'Roblox-reported ping'}${server.fps === null ? '' : ` · ${server.fps} FPS`}</span></div></li>`).join('')
      : `<li class="server-empty">${escapeHtml(detail.serversError || 'No non-full public servers were returned by Roblox right now.')}</li>`;
  const serversPanel = `<section class="game-detail-section"><div class="game-detail-section-head"><div><p class="section-kicker"><i></i> Public servers</p><h2>Find a better room.</h2><p>Sorting uses the current public-server page returned by Roblox. Ping is only shown when Roblox reports a value; Eclipse does not measure your gameplay latency.</p></div><div class="game-detail-actions"><label class="game-server-sort"><span class="sr-only">Sort public servers</span><select data-game-server-sort><option value="ping" ${detail.serverSort === 'ping' ? 'selected' : ''}>Best ping</option><option value="players" ${detail.serverSort === 'players' ? 'selected' : ''}>Low players</option></select></label><button class="quiet-button compact-button" type="button" data-action="game-servers-refresh" ${detail.serversLoading ? 'disabled' : ''}>${detail.serversLoading ? 'Refreshing…' : 'Refresh'}</button></div></div><div class="server-sort-note"><i></i>${detail.serverSort === 'ping' ? 'Best ping puts the lowest Roblox-reported ping first; servers without a reported ping appear afterward.' : 'Low players puts the least occupied non-full public servers first.'}</div><ul class="server-list panel">${serverRows}</ul>${detail.serversCursor ? `<div class="game-detail-load-more"><button class="quiet-button" type="button" data-action="game-servers-more" ${detail.serversLoading ? 'disabled' : ''}>${detail.serversLoading ? 'Loading servers…' : 'Load more servers'}</button></div>` : ''}</section>`;
  const passRows = detail.passesLoading
    ? Array.from({ length: 4 }, () => '<article class="game-pass-card panel skeleton"><span></span><span></span></article>').join('')
    : detail.passes.length
      ? detail.passes.map((pass) => `<article class="game-pass-card panel"><div><p class="section-kicker">Official game pass</p><h3>${escapeHtml(pass.name)}</h3><p>${escapeHtml(pass.description || 'No description provided by the experience creator.')}</p></div><strong>${pass.isForSale ? pass.price === null ? 'Price unavailable' : pass.price === 0 ? 'Free' : `${formatCount(pass.price)} Robux` : 'Off sale'}</strong></article>`).join('')
      : emptyState('◇', 'No game passes listed.', detail.passesError || 'Roblox did not return public game-pass information for this experience.', '');
  const passesPanel = `<section class="game-detail-section"><div class="game-detail-section-head"><div><p class="section-kicker"><i></i> Experience extras</p><h2>Official game passes.</h2><p>Prices and availability come from Roblox. Eclipse does not handle purchases or Roblox account details.</p></div></div><div class="game-pass-grid">${passRows}</div></section>`;
  const tabContent = detail.tab === 'servers' ? serversPanel : detail.tab === 'passes' ? passesPanel : about;
  pageContent.innerHTML = `<div class="page-shell game-details-page">${pageHeader('Official Roblox experience', game.name, 'Explore official experience information, public server availability, and game passes without leaving Eclipse.', '<button class="quiet-button" type="button" data-action="game-details-back">← Back</button>')}<section class="game-detail-hero panel"><div class="game-detail-art" style="--cover-hue:${Number(game.universeId) % 280}">${image ? `<img src="${escapeHtml(image)}" alt="" referrerpolicy="no-referrer" />` : '<span class="cover-orbit" aria-hidden="true"></span>'}<div></div></div><div class="game-detail-hero-copy"><p class="section-kicker"><i></i> ${escapeHtml(game.creator || 'Roblox creator')}</p><h2>${escapeHtml(game.name)}</h2><div class="game-detail-live"><span><i class="player-dot"></i>${formatCount(game.playing)} playing</span><span>${escapeHtml(rating)}</span>${game.maxPlayers ? `<span>${formatCount(game.maxPlayers)} max / server</span>` : ''}</div><div class="featured-actions"><button class="play-button" type="button" data-action="launch-game" data-place-id="${game.placeId}"><span class="play-icon"></span> Play in Roblox</button><button class="quiet-button" type="button" data-action="open-game" data-place-id="${game.placeId}">Official page</button></div></div></section><nav class="game-details-tabs" aria-label="${escapeHtml(game.name)} details">${gameDetailsTabButton('about', 'About')}${gameDetailsTabButton('servers', `Servers${detail.servers.length ? ` · ${detail.servers.length}` : ''}`)}${gameDetailsTabButton('passes', `Game passes${detail.passes.length ? ` · ${detail.passes.length}` : ''}`)}</nav>${tabContent}</div>`;
}

function renderHome() {
  const recent = state.recent.slice(0, 4);
  const saved = state.library.slice(0, 4);
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const primary = saved.find((game) => game.pinned) || recent[0] || saved[0];

  pageContent.innerHTML = `<div class="page-shell home-page">
    ${pageHeader('Your Roblox orbit', `${greeting}.`, 'Launch an official Roblox experience, keep your own library, and explore what is live now.', '<button class="primary-button" type="button" data-page-link="discover"><span class="play-icon"></span> Discover Roblox</button>')}
    ${primary ? featuredGame(primary) : emptyState('◌', 'Your library starts with Roblox.', 'Save official Roblox experiences from Discover. Eclipse keeps the list on this device and never creates custom games.', '<button class="primary-button" type="button" data-page-link="discover">Browse live Roblox games</button>')}
    <section class="content-section">
      <div class="section-heading"><div><p class="section-kicker">Recent launches</p><h2>Continue playing</h2></div>${recent.length ? '<button class="text-button" type="button" data-page-link="library">Open library <span>→</span></button>' : ''}</div>
      ${recent.length ? `<div class="game-grid home-game-grid">${recent.map((game) => gameCard(game)).join('')}</div><p class="section-note">Last Eclipse handoff: ${escapeHtml(formatLocalLaunchTime(recent[0].launchedAt))}. This records only Eclipse’s request to Roblox Player, not game or server state.</p>` : '<p class="section-note">Games you start through Eclipse appear here. Roblox Player handles your account session.</p>'}
    </section>
    <section class="home-utility-grid">
      <article class="utility-panel panel"><span class="utility-symbol">◈</span><div><p class="section-kicker">Eclipse profile</p><h3>${escapeHtml(state.profile.created ? state.profile.displayName : 'Make Eclipse yours')}</h3><p>${state.profile.created ? 'Your display name is stored only in this Eclipse workspace.' : 'Create a local profile to personalize this device.'}</p></div><button class="text-button" type="button" data-profile-action="open">${state.profile.created ? 'Edit profile' : 'Create profile'} <span>→</span></button></article>
      <article class="utility-panel panel"><span class="utility-symbol">↗</span><div><p class="section-kicker">Roblox Player</p><h3>Ready when you are</h3><p>Use the official player protocol to launch selected experiences.</p></div><button class="text-button" type="button" data-page-link="tools">Player tools <span>→</span></button></article>
    </section>
  </div>`;
}

function renderDiscover() {
  pageContent.innerHTML = `<div class="page-shell discover-page">
    ${pageHeader('Official Roblox discovery', 'Find your next experience.', 'Live game names, player counts, and images come from Roblox. Results are not Eclipse-created games.', '')}
    <section class="discovery-panel panel">
      <form class="discovery-search" data-discovery-form>
        <label class="sr-only" for="game-search">Search Roblox experiences</label>
        <span class="search-symbol" aria-hidden="true">⌕</span>
        <input id="game-search" name="query" maxlength="100" value="${escapeHtml(state.discover.query)}" placeholder="Search official Roblox experiences" autocomplete="off" />
        <button class="primary-button" type="submit">Search</button>
      </form>
      <div class="discovery-toolbar"><span><i></i><span data-discovery-context>${state.discover.query ? `Official Roblox search · “${escapeHtml(state.discover.query)}”` : 'Official Roblox Explore collections'}</span></span><div class="discovery-controls"><label><span class="sr-only">Sort experiences</span><select data-discovery-sort><option value="featured" ${state.discover.sort === 'featured' ? 'selected' : ''}>Official order</option><option value="players" ${state.discover.sort === 'players' ? 'selected' : ''}>Most playing</option><option value="rating" ${state.discover.sort === 'rating' ? 'selected' : ''}>Highest rated</option><option value="name" ${state.discover.sort === 'name' ? 'selected' : ''}>Name</option></select></label><label><span class="sr-only">Filter experiences</span><select data-discovery-filter><option value="all" ${state.discover.filter === 'all' ? 'selected' : ''}>All</option><option value="popular" ${state.discover.filter === 'popular' ? 'selected' : ''}>1K+ playing</option><option value="rated" ${state.discover.filter === 'rated' ? 'selected' : ''}>Rated</option></select></label><button class="quiet-button compact-button" type="button" data-action="refresh-discover">Refresh</button></div></div>
      <div class="discovery-collections" data-discovery-collections aria-label="Official Roblox collections"></div>
    </section>
    <div class="discovery-feature" data-discovery-feature></div>
    <section class="content-section"><div class="section-heading"><div><p class="section-kicker" data-discovery-kicker>${state.discover.query ? 'Search results' : 'Explore Roblox'}</p><h2 data-discovery-title>${state.discover.query ? 'Official matches' : 'More ways to play'}</h2></div></div><div class="game-grid" data-game-grid></div><div class="discover-footer" data-discover-footer></div></section>
  </div>`;
  updateDiscoverView();
  if (!state.discover.games.length) loadDiscover();
}

function discoveryCollectionChips() {
  const active = activeDiscoverCollection();
  if (state.discover.query || state.discover.collections.length < 2) return '';
  return state.discover.collections.map((collection) => `<button class="discovery-collection-chip ${collection.id === active?.id ? 'active' : ''}" type="button" data-action="select-discover-collection" data-discovery-collection="${escapeHtml(collection.id)}" aria-pressed="${collection.id === active?.id ? 'true' : 'false'}">${escapeHtml(collection.title)}</button>`).join('');
}

function displayDiscoverGames(games) {
  const filtered = games.filter((game) => {
    if (state.discover.filter === 'popular') return Number(game.playing) >= 1000;
    if (state.discover.filter === 'rated') return Number.isFinite(Number(game.rating));
    return true;
  });
  if (state.discover.sort === 'players') return [...filtered].sort((left, right) => Number(right.playing) - Number(left.playing));
  if (state.discover.sort === 'rating') return [...filtered].sort((left, right) => Number(right.rating ?? -1) - Number(left.rating ?? -1));
  if (state.discover.sort === 'name') return [...filtered].sort((left, right) => left.name.localeCompare(right.name));
  return filtered;
}

function updateDiscoverView() {
  const feature = pageContent.querySelector('[data-discovery-feature]');
  const grid = pageContent.querySelector('[data-game-grid]');
  const footer = pageContent.querySelector('[data-discover-footer]');
  const context = pageContent.querySelector('[data-discovery-context]');
  const collections = pageContent.querySelector('[data-discovery-collections]');
  const kicker = pageContent.querySelector('[data-discovery-kicker]');
  const title = pageContent.querySelector('[data-discovery-title]');
  if (!feature || !grid || !footer || !context || !collections || !kicker || !title) return;

  const activeCollection = activeDiscoverCollection();
  const rawVisibleGames = state.discover.query ? state.discover.games : activeCollection?.games || state.discover.games;
  const visibleGames = displayDiscoverGames(rawVisibleGames);
  const collectionTitle = activeCollection?.title || 'Popular on Roblox';
  context.textContent = state.discover.query ? `Official Roblox search · “${state.discover.query}”` : `${collectionTitle} · official Roblox Explore`;
  collections.innerHTML = discoveryCollectionChips();
  kicker.textContent = state.discover.query ? 'Search results' : 'Official Roblox collection';
  title.textContent = state.discover.query ? 'Official matches' : collectionTitle;

  if (state.discover.loading && !visibleGames.length) {
    feature.innerHTML = '';
    grid.innerHTML = Array.from({ length: 8 }, () => '<article class="game-card skeleton-card panel"><div></div><span></span><span></span></article>').join('');
    footer.innerHTML = '<p class="section-note">Loading live Roblox collections…</p>';
    return;
  }
  if (state.discover.error) {
    feature.innerHTML = '';
    grid.innerHTML = '';
    footer.innerHTML = emptyState('!', 'Roblox discovery is unavailable.', state.discover.error, '<button class="primary-button" type="button" data-action="refresh-discover">Try again</button>');
    return;
  }
  if (!visibleGames.length) {
    feature.innerHTML = '';
    grid.innerHTML = '';
    const filteredEmpty = rawVisibleGames.length > 0;
    footer.innerHTML = filteredEmpty
      ? emptyState('○', 'No experiences match this view.', 'The official Roblox result set is loaded, but none match the local filter you selected.', '<button class="primary-button" type="button" data-action="clear-discover-filters">Clear filters</button>')
      : emptyState('○', 'No official Roblox experiences found.', 'Try another search term or refresh the official Roblox collections.', '<button class="primary-button" type="button" data-action="refresh-discover">Show Roblox collections</button>');
    return;
  }

  feature.innerHTML = state.discover.query ? '' : featuredGame(visibleGames[0]);
  const listedGames = state.discover.query ? visibleGames : visibleGames.slice(1);
  grid.innerHTML = listedGames.map((game) => gameCard(game)).join('');
  footer.innerHTML = state.discover.nextCursor
    ? `<button class="quiet-button" type="button" data-action="load-more" ${state.discover.loading ? 'disabled' : ''}>${state.discover.loading ? 'Loading…' : 'Load more results'}</button>`
    : state.discover.query
      ? '<p class="section-note">Discovery data is supplied by Roblox. Availability and rankings can change at any time.</p>'
      : `<p class="section-note">Choose another Roblox collection above to see more official experiences.</p>`;
}

async function loadDiscover({ append = false, resetToPopular = false } = {}) {
  if (state.discover.loading) return;
  if (resetToPopular) {
    state.discover.query = '';
    state.discover.cursor = '';
    state.discover.games = [];
    state.discover.collections = [];
    state.discover.collectionId = '';
  }
  state.discover.loading = true;
  state.discover.error = '';
  updateDiscoverView();
  try {
    const result = await roblox.listGames({ query: state.discover.query, cursor: append ? state.discover.cursor : '' });
    const games = Array.isArray(result.games) ? result.games.map(normalizeGame).filter(Boolean) : [];
    const loadedCollections = state.discover.query ? [] : normalizeDiscoverCollections(result.collections);
    state.discover.games = append
      ? [...new Map([...state.discover.games, ...games].map((game) => [game.universeId, game])).values()]
      : games;
    state.discover.collections = loadedCollections;
    if (!loadedCollections.some((collection) => collection.id === state.discover.collectionId)) {
      state.discover.collectionId = loadedCollections[0]?.id || '';
    }
    state.discover.cursor = typeof result.nextCursor === 'string' ? result.nextCursor : '';
  } catch (error) {
    state.discover.error = error instanceof Error ? error.message : 'Roblox discovery could not be loaded. Please try again.';
  } finally {
    state.discover.loading = false;
    updateDiscoverView();
  }
}

function renderLibrary() {
  pageContent.innerHTML = `<div class="page-shell library-page">
    ${pageHeader('Your library', 'Saved Roblox experiences.', 'Library items are official Roblox places you saved in Eclipse. Pin favorites to keep them first; the list stays only on this device.', '<button class="primary-button" type="button" data-page-link="discover">Discover games</button>')}
    <section class="content-section"><div class="section-heading"><div><p class="section-kicker">Saved locally</p><h2>${state.library.length ? `${state.library.length} saved ${state.library.length === 1 ? 'experience' : 'experiences'}` : 'Nothing saved yet'}</h2></div></div>
    ${state.library.length ? `<div class="game-grid">${state.library.map((game) => gameCard(game, { library: true })).join('')}</div>` : emptyState('◇', 'Save official games you want to revisit.', 'Open Discover to browse live Roblox experiences, then use the plus button on a game card to add it here.', '<button class="primary-button" type="button" data-page-link="discover">Open Discover</button>')}</section>
  </div>`;
}

const fastFlagProfiles = {
  default: { label: 'Default', detail: 'Remove Eclipse-managed texture and MSAA overrides.', flags: {}, msaa: 0 },
  performance: { label: 'Performance', detail: 'Lower texture quality with 1× MSAA.', flags: { DFFlagTextureQualityOverrideEnabled: 'True', DFIntTextureQualityOverride: '0' }, msaa: 1 },
  balanced: { label: 'Balanced', detail: 'Moderate texture quality with 2× MSAA.', flags: { DFFlagTextureQualityOverrideEnabled: 'True', DFIntTextureQualityOverride: '2' }, msaa: 2 },
  quality: { label: 'Quality', detail: 'Higher texture quality with 4× MSAA.', flags: { DFFlagTextureQualityOverrideEnabled: 'True', DFIntTextureQualityOverride: '3' }, msaa: 4 }
};

function fastFlagPreviewFor(source) {
  const selection = normalizeFastFlagSelection(source);
  const flags = { ...fastFlagProfiles[selection.profile].flags };
  if ([1, 2, 4].includes(Number(selection.msaa))) flags.FIntDebugForceMSAASamples = String(selection.msaa);
  if ([60, 120, 144, 165, 240].includes(Number(selection.fpsCap))) flags.DFIntTaskSchedulerTargetFps = String(selection.fpsCap);
  if (selection.preserveDisplayScaling) flags.DFFlagDisableDPIScale = 'True';
  if (selection.meshDetailEnabled) {
    const detail = Math.max(0, Math.min(3, Number(selection.meshDetail) || 0));
    const meshKeys = ['DFIntCSGLevelOfDetailSwitchingDistance', 'DFIntCSGLevelOfDetailSwitchingDistanceL12', 'DFIntCSGLevelOfDetailSwitchingDistanceL23', 'DFIntCSGLevelOfDetailSwitchingDistanceL34'];
    flags.DFIntCSGLevelOfDetailSwitchingDistanceStatic = String(detail);
    meshKeys.forEach((key, index) => { flags[key] = String((Math.max(0, Math.min(3, detail - index)) + 1) * 250); });
  }
  if (selection.frmQualityEnabled) flags.DFIntDebugFRMQualityLevelOverride = String(Math.max(1, Math.min(21, Number(selection.frmQuality) || 21)));
  if (selection.renderingMode === 'd3d11') flags.FFlagDebugGraphicsPreferD3D11 = 'True';
  if (selection.renderingMode === 'vulkan') flags.FFlagDebugGraphicsPreferVulkan = 'True';
  return flags;
}

function fastFlagPreview() {
  return fastFlagPreviewFor(state.fastFlags);
}

function fastFlagToggle(field, checked, title, description, disabled) {
  return `<label class="ff-toggle"><input type="checkbox" data-fastflag-field="${field}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}/><span></span><b>${title}</b><small>${description}</small></label>`;
}

function fastFlagSelection() {
  return normalizeFastFlagSelection(state.fastFlags);
}

function saveFastFlagProfiles() {
  state.fastFlagProfiles = normalizeSavedFastFlagProfiles(state.fastFlagProfiles);
  writeStored(storageKeys.fastFlagProfiles, state.fastFlagProfiles);
}

function activeSavedFastFlagProfile() {
  return state.fastFlagProfiles.find((item) => item.id === state.fastFlags.profileId) || null;
}

function persistActiveFastFlagProfile() {
  const active = activeSavedFastFlagProfile();
  if (!active) return;
  active.settings = fastFlagSelection();
  active.updatedAt = new Date().toISOString();
  saveFastFlagProfiles();
}

function managedFlagDifferenceCount(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].filter((key) => left[key] !== right[key]).length;
}

function createSavedFastFlagProfile() {
  if (state.fastFlagProfiles.length >= 20) return showToast('Keep up to 20 local Fast Flag profiles.');
  const name = String(window.prompt('Name this local Fast Flag profile:', 'My graphics profile') || '').trim().replace(/\s+/g, ' ').slice(0, 36);
  if (!name) return;
  const id = `ff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  state.fastFlagProfiles.push({ id, name, settings: fastFlagSelection(), updatedAt: new Date().toISOString() });
  state.fastFlags.profileId = id;
  saveFastFlagProfiles();
  updateFastFlagsPanel();
  showToast(`Saved “${name}” locally.`);
}

function duplicateSavedFastFlagProfile() {
  const active = activeSavedFastFlagProfile();
  if (!active) return createSavedFastFlagProfile();
  if (state.fastFlagProfiles.length >= 20) return showToast('Keep up to 20 local Fast Flag profiles.');
  const name = String(window.prompt('Name the duplicate:', `${active.name} copy`) || '').trim().replace(/\s+/g, ' ').slice(0, 36);
  if (!name) return;
  const id = `ff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  state.fastFlagProfiles.push({ id, name, settings: fastFlagSelection(), updatedAt: new Date().toISOString() });
  state.fastFlags.profileId = id;
  saveFastFlagProfiles();
  updateFastFlagsPanel();
  showToast(`Duplicated “${active.name}”.`);
}

function renameSavedFastFlagProfile() {
  const active = activeSavedFastFlagProfile();
  if (!active) return showToast('Select a saved profile before renaming it.');
  const name = String(window.prompt('Rename local Fast Flag profile:', active.name) || '').trim().replace(/\s+/g, ' ').slice(0, 36);
  if (!name) return;
  active.name = name;
  active.updatedAt = new Date().toISOString();
  saveFastFlagProfiles();
  updateFastFlagsPanel();
  showToast('Local Fast Flag profile renamed.');
}

function deleteSavedFastFlagProfile() {
  const active = activeSavedFastFlagProfile();
  if (!active) return showToast('Built-in presets are always available and cannot be deleted.');
  if (!window.confirm(`Delete the local Fast Flag profile “${active.name}”?`)) return;
  state.fastFlagProfiles = state.fastFlagProfiles.filter((item) => item.id !== active.id);
  state.fastFlags.profileId = '';
  saveFastFlagProfiles();
  updateFastFlagsPanel();
  showToast('Local Fast Flag profile deleted.');
}

function exportSavedFastFlagProfiles() {
  const payload = { schema: 'eclipse-fastflags/v1', exportedAt: new Date().toISOString(), profiles: normalizeSavedFastFlagProfiles(state.fastFlagProfiles) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'eclipse-fastflag-profiles.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast('Validated local Fast Flag profiles exported.');
}

async function importSavedFastFlagProfiles(file) {
  if (!file || file.size > 180_000 || !/\.json$/i.test(file.name || '')) throw new Error('Choose an Eclipse Fast Flag JSON export smaller than 180 KB.');
  const parsed = JSON.parse(await file.text());
  if (!parsed || parsed.schema !== 'eclipse-fastflags/v1') throw new Error('This is not an Eclipse Fast Flag profile export.');
  const imported = normalizeSavedFastFlagProfiles(parsed.profiles);
  if (!imported.length) throw new Error('No validated Eclipse-managed profiles were found in that export.');
  const existingByName = new Set(state.fastFlagProfiles.map((profile) => profile.name.toLocaleLowerCase()));
  for (const profile of imported) {
    if (state.fastFlagProfiles.length >= 20) break;
    let name = profile.name;
    let counter = 2;
    while (existingByName.has(name.toLocaleLowerCase())) name = `${profile.name.slice(0, 31)} ${counter++}`;
    state.fastFlagProfiles.push({ ...profile, id: `ff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`, name, updatedAt: new Date().toISOString() });
    existingByName.add(name.toLocaleLowerCase());
  }
  saveFastFlagProfiles();
  updateFastFlagsPanel();
  showToast('Validated Eclipse-managed Fast Flag profiles imported.');
}

function fastFlagsPanel() {
  const selection = state.fastFlags;
  const { status, profile, msaa, fpsCap, preserveDisplayScaling, meshDetailEnabled, meshDetail, frmQualityEnabled, frmQuality, renderingMode, busy, message } = selection;
  const supported = status?.supported === true;
  const disabled = busy || !supported;
  const flags = fastFlagPreview();
  const profileButtons = Object.entries(fastFlagProfiles).map(([key, item]) => `<button class="ff-profile ${profile === key && !selection.profileId ? 'selected' : ''}" type="button" data-action="fastflag-profile" data-fastflag-profile="${key}" ${disabled ? 'disabled' : ''}><strong>${item.label}</strong><span>${item.detail}</span></button>`).join('');
  const savedProfileButtons = state.fastFlagProfiles.map((item) => {
    const changes = managedFlagDifferenceCount(fastFlagPreview(), { ...fastFlagProfiles[item.settings.profile].flags, ...fastFlagPreviewFor(item.settings) });
    return `<button class="ff-profile ff-profile-saved ${selection.profileId === item.id ? 'selected' : ''}" type="button" data-action="select-saved-fastflag-profile" data-saved-fastflag-profile="${escapeHtml(item.id)}" ${disabled ? 'disabled' : ''}><strong>${escapeHtml(item.name)}</strong><span>${changes ? `${changes} managed change${changes === 1 ? '' : 's'}` : 'Matches current settings'}</span></button>`;
  }).join('');
  const flagsJson = Object.keys(flags).length ? JSON.stringify(flags, null, 2) : '{}';
  const appliedChangeCount = managedFlagDifferenceCount(status?.managedFlags || {}, flags);
  const activeLocalProfile = activeSavedFastFlagProfile();
  const statusText = status
    ? supported
      ? `${Object.keys(status.managedFlags || {}).length ? 'Existing Eclipse-managed flags found.' : 'No Eclipse-managed flags are currently applied.'}`
      : status.reason
    : 'Checking Fast Flag support…';
  const pathText = supported ? `Target: ${status.settingsPath}` : 'Eclipse writes only to the active Roblox Player ClientSettings file.';

  return `<section class="fastflags-panel panel">
    <div class="ff-heading"><div><p class="section-kicker"><i></i> Fast Flags</p><h2>Managed graphics controls</h2><p>Choose a supported preset, then fine-tune the same rendering controls used by established Roblox launchers. Roblox decides which local flags it accepts.</p></div><span class="ff-status ${supported ? 'available' : ''}"><i></i>${supported ? 'Windows player detected' : 'Desktop app required'}</span></div>
    <div class="ff-profile-grid">${profileButtons}${savedProfileButtons}</div>
    <div class="ff-profile-actions"><span>${state.fastFlagProfiles.length ? `${state.fastFlagProfiles.length} local profile${state.fastFlagProfiles.length === 1 ? '' : 's'} · settings never leave this device` : 'Save a named local profile for repeatable Eclipse-managed settings.'}</span><div><button class="quiet-button compact-button" type="button" data-action="fastflag-profile-create">Save current</button><button class="quiet-button compact-button" type="button" data-action="fastflag-profile-duplicate">Duplicate</button><button class="quiet-button compact-button" type="button" data-action="fastflag-profile-rename">Rename</button><button class="quiet-button compact-button" type="button" data-action="fastflag-profile-delete">Delete</button><button class="quiet-button compact-button" type="button" data-action="fastflag-profile-export">Export</button><label class="quiet-button compact-button ff-import-button">Import<input type="file" data-fastflag-import accept="application/json,.json" /></label></div></div>
    <details class="ff-profile-inspect"><summary>Inspect changes · ${activeLocalProfile ? escapeHtml(activeLocalProfile.name) : 'current preset'} · ${appliedChangeCount} difference${appliedChangeCount === 1 ? '' : 's'} from currently applied managed flags</summary><p>Comparison includes only Eclipse-managed keys. Unrelated ClientAppSettings values are not read into profiles or exports.</p></details>
    <form class="ff-options" data-fastflags-form>
      <section class="ff-setting-group"><h3>Geometry</h3><div class="ff-setting-card ${meshDetailEnabled ? 'is-expanded' : ''}"><div class="ff-setting-top"><div><strong>Mesh detail</strong><p>Control how detailed meshes appear in-game.</p></div>${fastFlagToggle('meshDetailEnabled', meshDetailEnabled, 'Enable override', 'Lower qualities can make meshes disappear.', disabled)}</div>${meshDetailEnabled ? `<div class="ff-range-area"><p>Lower qualities may cause meshes to disappear.</p><div class="ff-range-line"><span>Lowest quality</span><input type="range" min="0" max="3" step="1" value="${meshDetail}" data-fastflag-field="meshDetail" aria-label="Mesh detail" ${disabled ? 'disabled' : ''}/><span>Highest quality</span><output data-fastflag-output="meshDetail">${meshDetail}</output></div></div>` : ''}</div></section>
      <section class="ff-setting-group"><h3>Rendering &amp; graphics</h3><div class="ff-setting-card ff-choice-card"><div><strong>Anti-aliasing quality (MSAA)</strong><p>Choose the managed sample count for Roblox Player.</p></div><label class="ff-select"><span class="sr-only">Anti-aliasing quality</span><select data-fastflag-field="msaa" ${disabled ? 'disabled' : ''}><option value="0" ${Number(msaa) === 0 ? 'selected' : ''}>Roblox default</option><option value="1" ${Number(msaa) === 1 ? 'selected' : ''}>1×</option><option value="2" ${Number(msaa) === 2 ? 'selected' : ''}>2×</option><option value="4" ${Number(msaa) === 4 ? 'selected' : ''}>4×</option></select></label></div>
        <div class="ff-setting-card">${fastFlagToggle('preserveDisplayScaling', preserveDisplayScaling, 'Preserve rendering quality with display scaling', 'Prevents Roblox from reducing rendering quality based on Windows display scaling.', disabled)}</div>
        <div class="ff-setting-card ${frmQualityEnabled ? 'is-expanded' : ''}"><div class="ff-setting-top"><div><strong>FRM quality override</strong><p>Choose the FRM quality Roblox should use.</p></div>${fastFlagToggle('frmQualityEnabled', frmQualityEnabled, 'Enable override', 'Higher values can cost more GPU performance.', disabled)}</div>${frmQualityEnabled ? `<div class="ff-range-area"><div class="ff-range-line"><span>Lowest quality</span><input type="range" min="1" max="21" step="1" value="${frmQuality}" data-fastflag-field="frmQuality" aria-label="FRM quality override" ${disabled ? 'disabled' : ''}/><span>Highest quality</span><output data-fastflag-output="frmQuality">${frmQuality}</output></div></div>` : ''}</div>
        <div class="ff-setting-card ff-choice-card"><div><strong>Rendering mode</strong><p>Use Automatic unless you need to prefer a specific renderer.</p></div><label class="ff-select"><span class="sr-only">Rendering mode</span><select data-fastflag-field="renderingMode" data-fastflag-type="string" ${disabled ? 'disabled' : ''}><option value="automatic" ${renderingMode === 'automatic' ? 'selected' : ''}>Automatic</option><option value="d3d11" ${renderingMode === 'd3d11' ? 'selected' : ''}>Direct3D 11</option><option value="vulkan" ${renderingMode === 'vulkan' ? 'selected' : ''}>Vulkan</option></select></label></div>
      </section>
      <section class="ff-setting-group"><h3>Player pacing</h3><div class="ff-setting-card ff-choice-card"><div><strong>Frame-rate target</strong><p>Set a managed target or leave Roblox Player at its default.</p></div><label class="ff-select"><span class="sr-only">Frame-rate target</span><select data-fastflag-field="fpsCap" ${disabled ? 'disabled' : ''}><option value="0" ${Number(fpsCap) === 0 ? 'selected' : ''}>Roblox default</option><option value="60" ${Number(fpsCap) === 60 ? 'selected' : ''}>60 FPS</option><option value="120" ${Number(fpsCap) === 120 ? 'selected' : ''}>120 FPS</option><option value="144" ${Number(fpsCap) === 144 ? 'selected' : ''}>144 FPS</option><option value="165" ${Number(fpsCap) === 165 ? 'selected' : ''}>165 FPS</option><option value="240" ${Number(fpsCap) === 240 ? 'selected' : ''}>240 FPS</option></select></label></div></section>
      <div class="ff-actions"><button class="primary-button" type="submit" ${disabled ? 'disabled' : ''}>${busy ? 'Applying…' : 'Apply Fast Flags'}</button><button class="quiet-button" type="button" data-action="fastflag-reset" ${disabled ? 'disabled' : ''}>Reset managed flags</button></div>
    </form>
    <div class="ff-preview"><div><p class="section-kicker">Eclipse-managed preview</p><p>${escapeHtml(statusText)}</p><small>${escapeHtml(pathText)}</small></div><pre>${escapeHtml(flagsJson)}</pre></div>
    ${message ? `<p class="ff-message">${escapeHtml(message)}</p>` : ''}
    <p class="ff-safety">Eclipse writes only the fixed graphics keys shown above. Applying preserves settings it does not manage; close Roblox Player before applying changes, then relaunch it.</p>
  </section>`;
}

function updateFastFlagsPanel() {
  const panel = pageContent.querySelector('[data-fastflags-panel]');
  if (panel) panel.innerHTML = fastFlagsPanel();
}

async function refreshFastFlagsStatus() {
  try {
    state.fastFlags.status = await fastFlags.getStatus();
    state.fastFlags.message = '';
  } catch (error) {
    state.fastFlags.status = { supported: false, reason: error instanceof Error ? error.message : 'Fast Flag support could not be checked.' };
  }
  updateFastFlagsPanel();
  if (state.page === 'tools') renderTools();
}

async function applyFastFlags() {
  state.fastFlags.busy = true;
  updateFastFlagsPanel();
  try {
    const selection = fastFlagSelection();
    Object.assign(state.fastFlags, selection);
    persistActiveFastFlagProfile();
    const result = await fastFlags.apply(selection);
    state.fastFlags.status = result;
    state.fastFlags.message = 'Fast Flags were written. Restart Roblox Player to use them.';
    showToast('Fast Flags applied to Roblox Player.');
  } catch (error) {
    state.fastFlags.message = error instanceof Error ? error.message : 'Fast Flags could not be applied.';
    showToast(state.fastFlags.message);
  } finally {
    state.fastFlags.busy = false;
    updateFastFlagsPanel();
  }
}

async function resetFastFlags() {
  state.fastFlags.busy = true;
  updateFastFlagsPanel();
  try {
    const result = await fastFlags.reset();
    state.fastFlags.status = result;
    state.fastFlags.message = 'Eclipse-managed Fast Flags were removed.';
    showToast('Eclipse-managed Fast Flags were reset.');
  } catch (error) {
    state.fastFlags.message = error instanceof Error ? error.message : 'Fast Flags could not be reset.';
    showToast(state.fastFlags.message);
  } finally {
    state.fastFlags.busy = false;
    updateFastFlagsPanel();
  }
}

function bootstrapperErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error || 'Eclipse could not inspect Roblox Player.');
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^RobloxBootstrapperError:\s*/i, '');
  if (/HTTP 403|download returned HTTP 403/i.test(message)) {
    return 'Roblox temporarily rejected the installer download. Eclipse will use its official fallback source; check your connection and retry if it continues.';
  }
  return message;
}

function sanitizeDiagnosticText(value) {
  return String(value || '')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, '%USERPROFILE%')
    .replace(/\/home\/[^/\s]+/g, '~')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 600);
}

function playerDiagnostics() {
  const { status, progress, error } = state.bootstrapper;
  const safePath = sanitizeDiagnosticText(status?.managedLocation).replace('%USERPROFILE%\\AppData\\Local', '%LOCALAPPDATA%');
  return [
    'Eclipse Player Health diagnostics',
    `Platform: ${window.eclipseBootstrapper ? 'Windows desktop bridge' : 'Browser preview'}`,
    `Installed: ${status?.installed === true ? 'yes' : 'no'}`,
    `Installed version: ${status?.installedVersion || 'not detected'}`,
    `Official latest version: ${status?.latestVersion || 'not checked'}`,
    `Update available: ${status?.updateAvailable === true ? 'yes' : 'no'}`,
    `Install folder state: ${status?.installedDirectoryPresent ? 'detected' : 'not detected'}`,
    `Versions location: ${safePath || 'not available'}`,
    `Fast Flags: ${state.fastFlags.status?.supported ? `${Object.keys(state.fastFlags.status.managedFlags || {}).length} Eclipse-managed setting(s)` : 'not available'}`,
    `Update check: ${status?.checkError ? 'unavailable' : 'completed or not requested'}`,
    `Current Eclipse operation: ${progress?.phase || 'idle'}`,
    `Sanitized error: ${sanitizeDiagnosticText(error || status?.checkError || 'none')}`
  ].join('\n');
}

async function copyPlayerDiagnostics() {
  try {
    await navigator.clipboard.writeText(playerDiagnostics());
    showToast('Sanitized Player Health diagnostics copied.');
  } catch {
    showToast('Eclipse could not access the clipboard. Select and copy the diagnostics shown here.');
  }
}

function bootstrapperPanel() {
  const { status, busy, progress, error } = state.bootstrapper;
  const desktopSupported = Boolean(window.eclipseBootstrapper);
  const phase = String(progress?.phase || '');
  const detail = String(progress?.detail || '');
  const unsupported = status && !status.supported;
  const statusLabel = !status
    ? 'Checking official Player…'
    : !status.supported
      ? 'Windows desktop app required'
      : busy
        ? detail || 'Working with official Roblox Player…'
        : !status.installed
          ? 'Roblox Player not installed'
          : status.updateAvailable
            ? 'Official Roblox Player update available'
            : status.checkError
              ? 'Installed Player · update check unavailable'
              : 'Official Roblox Player is current';
  const actionLabel = busy
    ? phase === 'downloading' ? 'Downloading official installer…' : phase === 'installing' ? 'Installing official Player…' : 'Checking Player…'
    : status?.installed && !status.updateAvailable ? 'Check for updates' : status?.installed ? 'Update Roblox Player' : 'Install Roblox Player';
  const actionDisabled = !desktopSupported || unsupported || busy;
  const note = error || status?.checkError || status?.reason || (status?.installed
    ? 'Eclipse checks the official Windows Player release before it launches an experience. The Roblox protocol association stays unchanged.'
    : 'Eclipse downloads only from official Roblox distribution endpoints, validates the Windows signature, then runs the official installer.');
  const installedText = status?.installed ? `${status.installedVersion || 'Detected'} · folder ${status.installedDirectoryPresent ? 'present' : 'unavailable'}` : 'No official Player folder detected';
  const flagText = state.fastFlags.status?.supported ? `${Object.keys(state.fastFlags.status.managedFlags || {}).length} Eclipse-managed setting(s)` : 'Fast Flag status pending';
  return `<article class="tool-panel panel bootstrapper-panel"><p class="section-kicker"><i></i> Player Health & Repair Center</p><div class="bootstrapper-heading"><div><h2>Official Roblox Player</h2><p>Inspect the installed Windows Player, its official release check, and Eclipse-managed graphics settings. Repair uses the existing signed official installer path only.</p></div><span class="bootstrapper-status ${status?.installed && !status?.updateAvailable && !error ? 'ready' : busy ? 'working' : ''}"><i></i>${escapeHtml(statusLabel)}</span></div><div class="health-grid"><div><span>Installed Player</span><strong>${escapeHtml(installedText)}</strong></div><div><span>Official release</span><strong>${escapeHtml(status?.latestVersion || 'Waiting for check')}</strong></div><div><span>Fast Flags</span><strong>${escapeHtml(flagText)}</strong></div></div><div class="bootstrapper-actions"><button class="primary-button" type="button" data-action="bootstrapper-update" ${actionDisabled ? 'disabled' : ''}>${escapeHtml(actionLabel)}</button><button class="quiet-button" type="button" data-action="bootstrapper-repair" ${actionDisabled ? 'disabled' : ''}>Repair Player</button><button class="quiet-button" type="button" data-action="copy-player-diagnostics">Copy diagnostics</button>${status?.installed ? '<button class="quiet-button" type="button" data-action="open-fastflags">Review Fast Flags</button>' : ''}</div><p class="bootstrapper-note"><i></i>${escapeHtml(note)}</p><details class="health-diagnostics"><summary>Sanitized diagnostics</summary><pre>${escapeHtml(playerDiagnostics())}</pre></details></article>`;
}

async function refreshBootstrapperStatus({ render = true } = {}) {
  if (state.bootstrapper.busy) return state.bootstrapper.status;
  try {
    state.bootstrapper.status = await bootstrapper.status();
  } catch (error) {
    state.bootstrapper.status = { supported: Boolean(window.eclipseBootstrapper), installed: false, updateAvailable: false };
    state.bootstrapper.error = bootstrapperErrorMessage(error);
  } finally {
    if (render && state.page === 'tools') renderTools();
  }
  return state.bootstrapper.status;
}

async function updateRobloxPlayer({ repair = false } = {}) {
  if (state.bootstrapper.busy) return;
  state.bootstrapper.busy = true;
  state.bootstrapper.error = '';
  state.bootstrapper.progress = { phase: 'checking', detail: repair ? 'Preparing the official Roblox Player repair.' : 'Checking the official Roblox Windows Player release.', busy: true };
  renderTools();
  try {
    const result = repair ? await bootstrapper.repair() : await bootstrapper.update();
    state.bootstrapper.status = result;
    showToast(repair ? 'The official Roblox Player repair path completed.' : result.changed ? 'Official Roblox Player is ready.' : 'Official Roblox Player is already current.');
  } catch (error) {
    state.bootstrapper.error = bootstrapperErrorMessage(error);
    showToast(state.bootstrapper.error);
  } finally {
    state.bootstrapper.busy = false;
    state.bootstrapper.progress = null;
    await refreshBootstrapperStatus({ render: false });
    if (state.page === 'tools') renderTools();
  }
}

function renderTools() {
  if (!state.bootstrapper.status && !state.bootstrapper.busy) Promise.resolve().then(() => refreshBootstrapperStatus());
  if (!state.fastFlags.status) Promise.resolve().then(() => refreshFastFlagsStatus());
  const launchHistory = state.launchHistory.slice(0, 6);
  const launchHistoryMarkup = launchHistory.length ? `<ul class="launch-history-list">${launchHistory.map((item) => `<li><div><strong>${escapeHtml(item.name || `Place ${item.placeId}`)}</strong><span>Place ${item.placeId} · ${escapeHtml(formatLocalLaunchTime(item.launchedAt))}</span></div><button class="quiet-button compact-button" type="button" data-action="relaunch-place" data-place-id="${item.placeId}">Relaunch</button></li>`).join('')}</ul>` : '<p class="form-note">Recent Eclipse handoffs appear here. This is local request history, not Roblox gameplay history.</p>';
  pageContent.innerHTML = `<div class="page-shell tools-page">
    ${pageHeader('Roblox Player', 'Eclipse bootstrapper.', 'Eclipse checks, installs, and updates the official Windows Roblox Player before an Eclipse launch. It never handles Roblox credentials or takes over your Roblox links.', '')}
    <div class="tools-grid">
      ${bootstrapperPanel()}
      <article class="tool-panel panel"><p class="section-kicker"><i></i> Launch an experience</p><h2>Start an official place</h2><p>Paste a Roblox place ID. Eclipse prepares the official Player, then requests the existing Roblox protocol handler to open the experience.</p><form class="place-form" data-place-form><label for="place-id">Roblox place ID</label><div><input id="place-id" name="placeId" inputmode="numeric" pattern="[0-9]+" placeholder="Example: 1818" required /><button class="primary-button" type="submit"><span class="play-icon"></span> Launch</button></div></form><p class="form-note">No Roblox password is requested or stored. Eclipse does not change the <code>roblox://</code> link handler.</p></article>
      <article class="tool-panel panel"><p class="section-kicker"><i></i> Local launch history</p><h2>Recent place handoffs</h2><p>Relaunch a place Eclipse previously requested. Times reflect this device’s local handoff record only.</p>${launchHistoryMarkup}</article>
      <article class="tool-panel panel"><p class="section-kicker">Eclipse profile</p><h2>${escapeHtml(state.profile.created ? state.profile.displayName : 'Create your local workspace')}</h2><p>Eclipse profiles personalize this device only. They are not Roblox accounts, do not sign you in to Roblox, and never collect Roblox credentials.</p><div class="stacked-actions"><button class="quiet-button" type="button" data-profile-action="open">${state.profile.created ? 'Edit Eclipse profile' : 'Create Eclipse profile'}</button></div></article>
      <article class="tool-panel panel tool-wide"><p class="section-kicker">How bootstrapper launches work</p><ol class="protocol-list"><li><span>1</span><p>Eclipse checks the installed Windows Player against Roblox’s official release service.</p></li><li><span>2</span><p>If needed, Eclipse validates and runs the signed official Roblox installer. It never downloads client files from third parties.</p></li><li><span>3</span><p>Eclipse requests <code>roblox://experiences/start?placeId=…</code>. Roblox keeps account sign-in, connection, and gameplay under its own control.</p></li></ol></article>
    </div>
  </div>`;
}

function formatStorageBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let amount = bytes / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

async function refreshOptimizationStatus({ render = true } = {}) {
  try {
    state.optimization.status = await system.optimizationStatus();
  } catch (error) {
    state.optimization.status = { supported: false, playerRunning: false, robloxCacheBytes: 0, reason: error instanceof Error ? error.message : 'Optimization status is unavailable.' };
  }
  if (render && state.page === 'optimization') renderOptimization();
  return state.optimization.status;
}

async function runOptimization(kind, operation, successMessage) {
  if (state.optimization.busy) return;
  state.optimization.busy = kind;
  state.optimization.message = '';
  if (state.page === 'optimization') renderOptimization();
  try {
    const result = await operation();
    state.optimization.status = result?.supported === undefined ? state.optimization.status : result;
    state.optimization.message = successMessage;
    showToast(successMessage);
  } catch (error) {
    state.optimization.message = error instanceof Error ? error.message : 'Eclipse could not complete that optimization action.';
    showToast(state.optimization.message);
  } finally {
    state.optimization.busy = '';
    await refreshOptimizationStatus({ render: false });
    if (state.page === 'optimization') renderOptimization();
  }
}

function renderOptimization() {
  if (!state.optimization.status && !state.optimization.busy) Promise.resolve().then(() => refreshOptimizationStatus());
  const status = state.optimization.status || { supported: Boolean(window.eclipseSystem), playerRunning: false, robloxCacheBytes: 0, reason: 'Inspecting local Windows and Player maintenance…' };
  const supported = Boolean(status.supported);
  const busy = state.optimization.busy;
  const playerClosed = supported && !status.playerRunning;
  const cacheText = status.robloxCacheTruncated ? `${formatStorageBytes(status.robloxCacheBytes)}+` : formatStorageBytes(status.robloxCacheBytes);
  const message = state.optimization.message || status.reason || '';
  pageContent.innerHTML = `<div class="page-shell optimization-page">
    ${pageHeader('Windows performance care', 'Optimization.', 'A safe maintenance workspace for Eclipse and Roblox Player. Eclipse does not install drivers, change the registry, or use “booster” downloads.', '')}
    <section class="optimization-status-grid">
      <article class="optimization-status-card panel"><span class="optimization-status-icon driver">◈</span><div><span>Graphics drivers</span><strong>Windows Update</strong><small>Official update path only</small></div></article>
      <article class="optimization-status-card panel"><span class="optimization-status-icon ${status.playerRunning ? 'warning' : 'ready'}">◌</span><div><span>Roblox Player</span><strong>${status.playerRunning ? 'Close Player first' : supported ? 'Ready for maintenance' : 'Desktop app required'}</strong><small>${status.playerRunning ? 'Cache cleanup is paused' : 'No live Player files are changed'}</small></div></article>
      <article class="optimization-status-card panel"><span class="optimization-status-icon cache">✦</span><div><span>Roblox cache & logs</span><strong>${supported ? cacheText : 'Unavailable'}</strong><small>${status.robloxCacheTruncated ? 'Bounded estimate' : 'Safe local cleanup only'}</small></div></article>
    </section>
    <section class="optimization-grid">
      <article class="optimization-panel panel"><p class="section-kicker"><i></i> Driver care</p><h2>Use Windows’ trusted driver path.</h2><p>Check graphics drivers through Windows Update. Eclipse never downloads, installs, or recommends third-party driver packages.</p><div class="optimization-actions"><button class="primary-button" type="button" data-action="optimization-windows-update" ${supported && !busy ? '' : 'disabled'}>Open Windows Update</button><button class="quiet-button" type="button" data-action="optimization-refresh" ${busy ? 'disabled' : ''}>Refresh status</button></div><small>Windows can offer signed display-driver updates through its standard update flow.</small></article>
      <article class="optimization-panel panel"><p class="section-kicker"><i></i> Cache hygiene</p><h2>Clear temporary data safely.</h2><p>Clear Eclipse’s browser cache at any time. Roblox cache and logs can be cleared only after Roblox Player is completely closed.</p><div class="optimization-actions"><button class="quiet-button" type="button" data-action="optimization-clear-eclipse-cache" ${supported && !busy ? '' : 'disabled'}>${busy === 'eclipse-cache' ? 'Clearing Eclipse cache…' : 'Clear Eclipse cache'}</button><button class="quiet-button" type="button" data-action="optimization-clear-roblox-cache" ${playerClosed && !busy ? '' : 'disabled'}>${busy === 'roblox-cache' ? 'Clearing Roblox cache…' : 'Clear Roblox cache & logs'}</button></div><small>${escapeHtml(message || (status.playerRunning ? 'Close Roblox Player to enable Roblox cache cleanup.' : 'Only Roblox local HTTP cache and logs are removed. Player content and settings are left intact.'))}</small></article>
      <article class="optimization-panel panel"><p class="section-kicker"><i></i> Player tuning</p><h2>Choose intentional settings.</h2><p>Review the bounded Fast Flags Eclipse manages, or run the signed official Player repair path if the installation itself needs attention.</p><div class="optimization-actions"><button class="quiet-button" type="button" data-page-link="fastflags">Review Fast Flags</button><button class="quiet-button" type="button" data-page-link="tools">Player Health</button></div><small>These workflows preserve Eclipse’s local-only, recoverable boundaries.</small></article>
      <article class="optimization-panel panel optimization-note"><p class="section-kicker">What Eclipse will not do</p><h2>No placebo “boost” switches.</h2><ul><li>No driver booster downloads or unsigned installers.</li><li>No registry cleaners, network tweaks, or background process killing.</li><li>No changes to Roblox Player while it is running.</li></ul></article>
    </section>
  </div>`;
}

function renderFastFlags() {
  pageContent.innerHTML = `<div class="page-shell fastflags-page">
    ${pageHeader('Roblox Player configuration', 'Fast Flags.', 'Manage Eclipse-supported Roblox Player graphics settings in one place. Eclipse writes only the settings shown here and preserves unrelated ClientAppSettings values.', '')}
    <div data-fastflags-panel>${fastFlagsPanel()}</div>
  </div>`;
  refreshFastFlagsStatus();
}

function modsStatusPresentation(status = state.mods.status) {
  if (!status) return { label: 'Inspecting Player packs…', className: '', canApply: false };
  if (!status.supported) return { label: 'Windows desktop app required', className: '', canApply: false };
  if (!status.installed) return { label: 'Roblox Player not installed', className: 'warning', canApply: false };
  if (status.playerRunning) return { label: 'Close Roblox Player to change packs', className: 'warning', canApply: false };
  return { label: `Player closed · ${status.versionGuid || 'ready'}`, className: 'ready', canApply: true };
}

function modPackCard(pack, canApply) {
  const assets = Array.isArray(pack.assets) ? pack.assets : [];
  const textures = assets.filter((asset) => asset.kind === 'texture').length;
  const sounds = assets.filter((asset) => asset.kind === 'sound').length;
  const stateLabel = pack.needsReview ? 'Review required' : pack.enabled ? 'Enabled' : 'Stored locally';
  const cardClass = pack.needsReview ? 'review' : pack.enabled ? 'enabled' : '';
  const actionLabel = pack.enabled ? 'Disable & restore' : pack.needsReview ? 'Review & enable' : 'Enable pack';
  const lastApplied = pack.lastAppliedVersion ? `Applied to ${pack.lastAppliedVersion}` : 'Not applied to Player';
  const note = pack.lastError || (pack.needsReview ? 'The official Player changed. Review this pack before enabling it again.' : lastApplied);
  return `<article class="mod-pack panel ${cardClass}">
    <div class="mod-pack-head"><div><p class="section-kicker">Local Player pack · v${escapeHtml(pack.version)}</p><h3>${escapeHtml(pack.name)}</h3><p>${escapeHtml(pack.description || 'Validated texture and sound replacements stored only on this device.')}</p></div><span class="mod-pack-state">${escapeHtml(stateLabel)}</span></div>
    <div class="mod-pack-meta"><span>${assets.length} asset${assets.length === 1 ? '' : 's'}</span>${textures ? `<span>${textures} texture${textures === 1 ? '' : 's'}</span>` : ''}${sounds ? `<span>${sounds} sound${sounds === 1 ? '' : 's'}</span>` : ''}</div>
    <p class="mod-pack-note">${escapeHtml(note)}</p>
    <div class="mod-pack-actions"><div><button class="primary-button" type="button" data-action="mod-toggle" data-mod-id="${escapeHtml(pack.id)}" data-mod-enabled="${pack.enabled ? 'false' : 'true'}" ${canApply ? '' : 'disabled'}>${escapeHtml(actionLabel)}</button><button class="quiet-button" type="button" data-action="mod-remove" data-mod-id="${escapeHtml(pack.id)}" ${state.mods.busy || (pack.enabled && !canApply) ? 'disabled' : ''}>Remove</button></div><span class="card-meta">ID · ${escapeHtml(pack.id)}</span></div>
  </article>`;
}

function modsFormatGuide() {
  const manifest = `{
  "schema": "eclipse-player-pack/v1",
  "id": "violet-interface",
  "name": "Violet Interface",
  "version": "1.0.0",
  "description": "Local visual pack",
  "assets": [
    {
      "source": "assets/interface.png",
      "target": "content/textures/interface.png",
      "kind": "texture"
    }
  ]
}`;
  return `<details class="mods-format"><summary>Local pack format and safety rules</summary><p>Import a <code>.eclipsepack</code> ZIP containing <code>manifest.json</code>, or a developer folder with the same structure. Eclipse accepts only declared PNG/JPEG/WebP textures and OGG/MP3/WAV sounds under <code>content/textures</code> or <code>content/sounds</code>. It blocks code, DLLs, injectors, scripts, executables, network permissions, and every undeclared path.</p><pre>${escapeHtml(manifest)}</pre></details>`;
}

function defaultModsCreator() {
  return { open: false, name: '', id: '', version: '1.0.0', description: '', assets: [] };
}

function creatorPackId(name) {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

function creatorAssetSource(fileName) {
  const leaf = String(fileName || 'asset').trim().replace(/[\\/:]/g, '-').replace(/\s+/g, '-').slice(0, 120) || 'asset';
  const existing = new Set(state.mods.creator.assets.map((asset) => asset.source.toLowerCase()));
  let source = `assets/${leaf}`;
  let number = 2;
  const extensionMatch = /^(.*?)(\.[^.]+)?$/.exec(leaf);
  while (existing.has(source.toLowerCase())) {
    source = `assets/${extensionMatch?.[1] || 'asset'}-${number}${extensionMatch?.[2] || ''}`;
    number += 1;
  }
  return source;
}

function modsTutorial(canCreate) {
  return `<section class="mods-tutorial panel"><div class="mods-tutorial-heading"><div><p class="section-kicker"><i></i> New to Player Packs?</p><h2>A safe three-step workflow.</h2><p>Make or import a local visual/audio pack, inspect its declared paths, then apply it only when Roblox Player is closed.</p></div><button class="primary-button" type="button" data-action="mod-creator-open" ${canCreate ? '' : 'disabled'}>Create a Player Pack</button></div><ol class="mods-tutorial-steps"><li><span>01</span><div><strong>Choose an asset</strong><p>Add a PNG, JPEG, WebP, OGG, MP3, or WAV file from your device. Eclipse never uploads it.</p></div></li><li><span>02</span><div><strong>Choose a verified target</strong><p>The creator scans eligible existing files below <code>content/textures</code> and <code>content/sounds</code>, so you do not have to guess a path.</p></div></li><li><span>03</span><div><strong>Build, review, enable</strong><p>Eclipse saves a shareable <code>.eclipsepack</code>, imports it locally, then takes a versioned backup before applying it.</p></div></li></ol></section>`;
}

function creatorTargetOptions(kind) {
  const targets = kind === 'texture' ? state.mods.targets?.textures : state.mods.targets?.sounds;
  return Array.isArray(targets) ? targets : [];
}

function verifiedCreatorTarget(asset) {
  const target = String(asset?.target || '').trim();
  if (!target) return '';
  return creatorTargetOptions(asset?.kind).find((candidate) => candidate.toLowerCase() === target.toLowerCase()) || '';
}

function creatorTargetsAreVerified() {
  return Boolean(state.mods.targets) && state.mods.creator.assets.every((asset) => Boolean(verifiedCreatorTarget(asset)));
}

function updateModsCreatorPreflight() {
  const submit = pageContent.querySelector('[data-mod-creator-form] button[type="submit"]');
  if (!submit) return;
  const canBuild = Boolean(window.eclipseMods) && state.mods.creator.assets.length > 0 && creatorTargetsAreVerified() && !state.mods.busy;
  submit.disabled = !canBuild;
  pageContent.querySelectorAll('[data-mod-creator-target]').forEach((input) => {
    const asset = state.mods.creator.assets[Number(input.dataset.modCreatorTarget)];
    const invalid = Boolean(String(asset?.target || '').trim()) && !verifiedCreatorTarget(asset);
    input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
  });
}

function modsCreator(canCreate) {
  const creator = state.mods.creator;
  if (!creator.open) return '';
  if (!state.mods.targets && !state.mods.targetsLoading && !state.mods.targetError && canCreate) Promise.resolve().then(() => refreshModsTargets());
  const textureOptions = creatorTargetOptions('texture').map((target) => `<option value="${escapeHtml(target)}"></option>`).join('');
  const soundOptions = creatorTargetOptions('sound').map((target) => `<option value="${escapeHtml(target)}"></option>`).join('');
  const targetCount = creatorTargetOptions('texture').length + creatorTargetOptions('sound').length;
  const targetStatus = state.mods.targetsLoading
    ? 'Scanning the installed Player for eligible media targets…'
    : state.mods.targetError
      ? state.mods.targetError
      : state.mods.targets
        ? `${targetCount} verified target${targetCount === 1 ? '' : 's'} found for ${escapeHtml(state.mods.targets.versionGuid || 'this Player version')}${state.mods.targets.truncated ? ' · showing a bounded catalog' : ''}.`
        : 'Open the creator on Windows to scan the installed Player for eligible targets.';
  const assets = creator.assets.map((asset, index) => {
    const hasTarget = Boolean(String(asset.target || '').trim());
    const targetVerified = Boolean(verifiedCreatorTarget(asset));
    return `<li class="mods-creator-asset"><div class="mods-creator-asset-head"><span class="mods-creator-kind ${asset.kind}">${asset.kind === 'texture' ? 'Texture / UI' : 'Sound'}</span><strong>${escapeHtml(asset.fileName)}</strong><button class="text-button" type="button" data-action="mod-creator-remove-asset" data-mod-creator-asset-index="${index}" ${state.mods.busy ? 'disabled' : ''}>Remove</button></div><label>Verified Roblox Player target<input type="text" list="mod-creator-${asset.kind}-targets" value="${escapeHtml(asset.target)}" data-mod-creator-target="${index}" maxlength="220" spellcheck="false" placeholder="Choose a path from the verified catalog" ${hasTarget && !targetVerified ? 'aria-invalid="true"' : ''} required /></label><small>${hasTarget && !targetVerified ? 'Select an exact suggestion from the verified catalog.' : `Package source · ${escapeHtml(asset.source)}`}</small></li>`;
  }).join('');
  const targetsReady = Boolean(state.mods.targets) && !state.mods.targetsLoading;
  const targetsVerified = creatorTargetsAreVerified();
  const canBuild = canCreate && creator.assets.length && targetsVerified && !state.mods.busy;
  return `<section class="mods-creator panel"><div class="mods-creator-heading"><div><p class="section-kicker"><i></i> Pack creator</p><h2>Build a local, shareable Player Pack.</h2><p>Use only files you have permission to use. The creator saves a validated <code>.eclipsepack</code> and adds it to this device’s local vault.</p></div><button class="quiet-button" type="button" data-action="mod-creator-cancel" ${state.mods.busy ? 'disabled' : ''}>Close creator</button></div><div class="mods-target-catalog"><div><span class="mods-target-catalog-signal ${state.mods.targetError ? 'warning' : targetsReady ? 'ready' : ''}"><i></i>${state.mods.targetsLoading ? 'Scanning Player targets' : targetsReady ? 'Verified target catalog ready' : 'Target catalog unavailable'}</span><p>${escapeHtml(targetStatus)}</p></div><button class="quiet-button compact-button" type="button" data-action="mod-creator-refresh-targets" ${canCreate && !state.mods.targetsLoading ? '' : 'disabled'}>${state.mods.targetsLoading ? 'Scanning…' : 'Refresh targets'}</button></div><form class="mods-creator-form" data-mod-creator-form><datalist id="mod-creator-texture-targets">${textureOptions}</datalist><datalist id="mod-creator-sound-targets">${soundOptions}</datalist><div class="mods-creator-fields"><label>Pack name<input name="name" value="${escapeHtml(creator.name)}" data-mod-creator-field="name" maxlength="60" placeholder="Violet Interface" required /></label><label>Pack ID<input name="id" value="${escapeHtml(creator.id)}" data-mod-creator-field="id" maxlength="64" pattern="[a-z0-9][a-z0-9-]{2,63}" placeholder="violet-interface" required /></label><label>Version<input name="version" value="${escapeHtml(creator.version)}" data-mod-creator-field="version" maxlength="32" placeholder="1.0.0" required /></label><label class="mods-creator-description">Description <span>optional</span><textarea name="description" data-mod-creator-field="description" maxlength="320" placeholder="A local visual pack">${escapeHtml(creator.description)}</textarea></label></div><div class="mods-creator-assets"><div><p class="section-kicker">Pack assets</p><h3>Add only supported local media.</h3></div><div class="mods-creator-add"><button class="quiet-button" type="button" data-action="mod-creator-add-asset" data-mod-creator-kind="texture" ${canCreate ? '' : 'disabled'}>+ Texture / UI</button><button class="quiet-button" type="button" data-action="mod-creator-add-asset" data-mod-creator-kind="sound" ${canCreate ? '' : 'disabled'}>+ Sound</button></div></div>${assets ? `<ul class="mods-creator-asset-list">${assets}</ul>` : '<p class="mods-creator-empty">Add at least one local texture/UI or sound asset to start.</p>'}<div class="mods-creator-footer"><p><strong>Preflight:</strong> ${targetsReady ? targetsVerified ? 'every target matches the verified catalog for this Player version.' : 'select an exact suggestion from the verified catalog for every asset.' : 'scan the installed Player, then choose an exact catalog target for every asset.'} Eclipse checks every selected file’s signature, target, and size before it writes the archive.</p><button class="primary-button" type="submit" ${canBuild ? '' : 'disabled'}>${state.mods.busy ? 'Building…' : 'Build & add .eclipsepack'}</button></div></form></section>`;
}
async function addModsCreatorAsset(kind) {
  if (state.mods.busy) return;
  try {
    const selected = await mods.pickCreatorAsset(kind);
    if (selected?.canceled) return;
    const safeKind = selected?.kind === 'sound' ? 'sound' : selected?.kind === 'texture' ? 'texture' : '';
    const fileName = String(selected?.fileName || '').trim();
    const token = String(selected?.token || '').trim();
    if (!safeKind || !fileName || !token) throw new Error('Eclipse could not keep the selected creator asset. Choose it again.');
    const source = creatorAssetSource(fileName);
    state.mods.creator.assets.push({ token, fileName, source, kind: safeKind, target: '' });
    if (state.page === 'mods') renderMods();
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Eclipse could not choose the creator asset.');
  }
}

function renderMods() {
  if (!state.mods.status && !state.mods.busy) Promise.resolve().then(() => refreshModsStatus());
  const status = state.mods.status;
  const presentation = modsStatusPresentation(status);
  const packs = Array.isArray(status?.packs) ? status.packs : [];
  const desktopSupported = Boolean(window.eclipseMods);
  const canImport = desktopSupported && !state.mods.busy;
  const statusReason = status?.reason ? `<p class="mods-runtime-note">${escapeHtml(status.reason)}</p>` : '';
  const packMarkup = packs.length
    ? `<div class="mod-pack-grid">${packs.map((pack) => modPackCard(pack, presentation.canApply && !state.mods.busy)).join('')}</div>`
    : emptyState('✦', 'Your local Player pack library is empty.', 'Import a validated .eclipsepack or a local developer folder. Packs are stored on this device, never uploaded, and remain disabled until you enable them while Player is closed.', '');
  pageContent.innerHTML = `<div class="page-shell mods-page">
    ${pageHeader('Advanced local Player packs', 'Mods.', 'Build a local texture and sound pack library with declared paths, versioned backups, and official Player repair support. Eclipse never loads mod code or contacts a mod service.', '')}
    <section class="mods-overview">
      <article class="mods-panel panel"><p class="section-kicker"><i></i> Player pack control</p><h2>Local assets, not injected code.</h2><p>Enable or restore a pack only after Roblox Player is fully closed. Eclipse backs up original files per Player version before any declared texture or sound is replaced.</p><span class="mods-status ${presentation.className}"><i></i>${escapeHtml(presentation.label)}</span>${statusReason}<div class="mods-actions"><button class="primary-button" type="button" data-action="mod-import-package" ${canImport ? '' : 'disabled'}>Import .eclipsepack</button><button class="quiet-button" type="button" data-action="mod-import-folder" ${canImport ? '' : 'disabled'}>Import developer folder</button><button class="quiet-button" type="button" data-action="mod-restore" ${presentation.canApply && packs.some((pack) => pack.enabled) && !state.mods.busy ? '' : 'disabled'}>${state.mods.busy ? 'Working…' : 'Restore active version'}</button><button class="text-button" type="button" data-action="refresh-mods">Refresh status <span>→</span></button></div><p class="mods-safety"><i></i><span><strong>Advanced Local Mode.</strong> Packages must declare every asset and target. On an official Player update or repair, Eclipse restores originals, disables all packs, and marks them for review.</span></p></article>
      <aside class="mods-panel panel"><p class="section-kicker">Guardrails</p><h2>Designed to be recoverable.</h2><div class="mods-guardrails"><div><strong>Declared paths only</strong><span>Only existing files below content/textures and content/sounds are eligible.</span></div><div><strong>Versioned backups</strong><span>Original Player files are retained locally before a pack can replace them.</span></div><div><strong>Review after updates</strong><span>Official Player updates and repairs disable packs instead of carrying modifications forward.</span></div></div></aside>
    </section>
    ${modsTutorial(canImport)}
    ${modsCreator(canImport)}
    <section class="mods-library content-section"><div class="mods-library-heading"><div><p class="section-kicker">Local pack vault</p><h2>${packs.length ? `${packs.length} local Player pack${packs.length === 1 ? '' : 's'}` : 'No Player packs imported'}</h2></div><p class="section-note">${packs.filter((pack) => pack.enabled).length} enabled · ${packs.filter((pack) => pack.needsReview).length} need review</p></div>${packMarkup}${modsFormatGuide()}</section>
  </div>`;
}

async function refreshModsStatus({ render = true } = {}) {
  const previousVersion = state.mods.status?.versionGuid || '';
  try {
    state.mods.status = await mods.status();
    if (previousVersion && previousVersion !== state.mods.status?.versionGuid) state.mods.targets = null;
    if (!state.mods.busy) state.mods.message = '';
  } catch (error) {
    state.mods.status = { supported: Boolean(window.eclipseMods), installed: false, playerRunning: false, packs: [], reason: error instanceof Error ? error.message : 'Player pack status is unavailable.' };
  }
  if (render && state.page === 'mods') renderMods();
  return state.mods.status;
}

async function refreshModsTargets({ render = true } = {}) {
  if (state.mods.targetsLoading) return state.mods.targets;
  state.mods.targetsLoading = true;
  state.mods.targetError = '';
  if (render && state.page === 'mods') renderMods();
  try {
    state.mods.targets = await mods.targets();
  } catch (error) {
    state.mods.targets = null;
    state.mods.targetError = error instanceof Error ? error.message : 'Eclipse could not scan Player asset targets.';
  } finally {
    state.mods.targetsLoading = false;
    if (render && state.page === 'mods') renderMods();
  }
  return state.mods.targets;
}

async function runModsOperation(operation, successMessage) {
  if (state.mods.busy) return;
  state.mods.busy = true;
  state.mods.message = '';
  if (state.page === 'mods') renderMods();
  try {
    const result = await operation();
    state.mods.status = result;
    if (!result?.canceled) {
      state.mods.message = successMessage;
      showToast(successMessage);
    }
  } catch (error) {
    state.mods.message = error instanceof Error ? error.message : 'Eclipse could not update the local Player pack library.';
    showToast(state.mods.message);
  } finally {
    state.mods.busy = false;
    await refreshModsStatus({ render: false });
    if (state.page === 'mods') renderMods();
  }
}

function renderIntegrations() {
  const { activityTracking, discordRichPresence, discordClientId, discordAssetKey, discordActivityDisplay } = state.integrations;
  const status = discordStatus || {
    supported: Boolean(window.eclipseDiscord),
    configured: Boolean(discordClientId),
    enabled: discordRichPresence,
    imageAssetKey: discordAssetKey,
    activityDisplay: discordActivityDisplay,
    connected: false,
    connecting: Boolean(window.eclipseDiscord),
    reason: window.eclipseDiscord ? 'Checking Discord Desktop…' : 'Discord Rich Presence is available from the Eclipse desktop app.'
  };
  const statusClass = status.connected ? 'ready' : status.enabled || status.connecting ? 'configured' : '';
  const statusLabel = status.connected
    ? 'Connected to Discord'
    : status.connecting
      ? 'Connecting to Discord'
      : status.enabled
        ? 'Waiting for Discord'
        : status.supported
          ? 'Rich Presence off'
          : 'Desktop app required';
  const displayDescription = discordActivityDisplay === 'minimal'
    ? 'Open Eclipse'
    : 'Open Eclipse · Roblox launcher';
  pageContent.innerHTML = `<div class="page-shell integrations-page">
    ${pageHeader('Connections', 'Integrations.', 'Control the local activity Eclipse keeps and the optional desktop integrations it publishes.', '')}
    <section class="integration-section">
      <div class="integration-heading"><div><p class="section-kicker"><i></i> Activity tracking</p><h2>Keep your Eclipse launch history local.</h2><p>Eclipse records only Roblox launch requests it successfully starts. It cannot inspect Roblox sessions opened outside Eclipse or read your Roblox account.</p></div><span class="integration-status ${activityTracking ? 'ready' : ''}"><i></i>${activityTracking ? 'Local tracking on' : 'Local tracking off'}</span></div>
      <div class="settings-list panel integration-list">
        <div class="setting-row"><div><h2>Enable activity tracking</h2><p>Add Roblox experiences launched through Eclipse to this device’s recent activity. Turning this off stops new local entries; it does not inspect or remove Roblox data.</p></div><label class="toggle"><input type="checkbox" data-integration="activityTracking" ${activityTracking ? 'checked' : ''}/><span></span></label></div>
      </div>
    </section>
    <section class="integration-section">
      <div class="integration-heading"><div><p class="section-kicker"><i></i> Discord Rich Presence</p><h2>Show Eclipse in Discord.</h2><p>When enabled, Discord Desktop displays the Eclipse application with a local Eclipse status. It never claims you are playing a Roblox game, reads Discord credentials, or exposes Roblox account details.</p></div><span class="integration-status ${statusClass}"><i></i>${escapeHtml(statusLabel)}</span></div>
      <div class="settings-list panel integration-list discord-presence-settings">
        <div class="setting-row integration-client-id-row"><div><h2>Discord Application ID</h2><p>Use the public ID from your Discord Developer Portal application. It is not a secret and stays only in this local Eclipse workspace.</p></div><label class="integration-select integration-client-id"><span class="sr-only">Discord Application ID</span><input data-discord-client-id inputmode="numeric" pattern="[0-9]{17,20}" maxlength="20" value="${escapeHtml(discordClientId)}" placeholder="17–20 digit application ID" autocomplete="off" /></label></div>
        <div class="setting-row"><div><h2>Show Eclipse activity</h2><p>Publish this device’s Eclipse activity while the desktop app is open. Eclipse clears it when it exits.</p></div><label class="toggle ${!status.supported ? 'is-disabled' : ''}"><input type="checkbox" data-integration="discordRichPresence" ${discordRichPresence ? 'checked' : ''} ${!status.supported ? 'disabled' : ''}/><span></span></label></div>
        <div class="setting-row integration-select-row"><div><h2>Discord status display</h2><p>Choose the truthful Eclipse-owned text shown through Rich Presence.</p></div><label class="integration-select"><span class="sr-only">Discord status display</span><select data-discord-display ${!status.supported ? 'disabled' : ''}><option value="open-eclipse" ${discordActivityDisplay === 'open-eclipse' ? 'selected' : ''}>Open Eclipse · Roblox launcher</option><option value="minimal" ${discordActivityDisplay === 'minimal' ? 'selected' : ''}>Open Eclipse only</option></select></label></div>
        <div class="setting-row integration-client-id-row"><div><h2>Eclipse icon asset key</h2><p>Use the name of an image asset uploaded to your Discord application. The included Eclipse icon uses <code>eclipse</code>.</p></div><label class="integration-select integration-client-id"><span class="sr-only">Eclipse icon asset key</span><input data-discord-asset-key maxlength="32" value="${escapeHtml(discordAssetKey)}" placeholder="eclipse" autocomplete="off" /></label></div>
        <div class="setting-row integration-unavailable"><div><h2>Allow activity joining</h2><p>Unavailable by design. Eclipse cannot read a Roblox server or session, so it cannot offer Discord joining links.</p></div><label class="toggle is-disabled"><input type="checkbox" disabled /><span></span></label></div>
        <div class="setting-row integration-unavailable"><div><h2>Allow Discord invites</h2><p>Unavailable by design. Eclipse does not create Roblox server invites or communicate with Discord accounts.</p></div><label class="toggle is-disabled"><input type="checkbox" disabled /><span></span></label></div>
        <div class="setting-row integration-unavailable"><div><h2>Show Roblox account</h2><p>Unavailable by design. Eclipse never signs in to Roblox, reads Roblox account data, or handles Roblox credentials.</p></div><label class="toggle is-disabled"><input type="checkbox" disabled /><span></span></label></div>
      </div>
      <div class="discord-presence-preview panel"><img src="assets/eclipse-icon.png" alt="Eclipse icon preview" /><div><p class="section-kicker"><i></i> Discord card preview</p><strong>Eclipse</strong><span>${escapeHtml(displayDescription)}</span><small>Discord uses your Application name. Name the application <b>Eclipse</b> in the Discord Developer Portal, then upload this provided PNG as the <code>${escapeHtml(discordAssetKey)}</code> image asset.</small></div><a class="quiet-button compact-button" href="assets/eclipse-icon.png" download="eclipse-discord-icon.png">Download Eclipse icon</a></div>
      <div class="integration-note"><i></i><span><strong>${escapeHtml(status.reason || 'Discord Rich Presence is ready to configure.')}</strong> ${status.supported ? 'For the icon to appear, upload the downloaded Eclipse PNG in the Discord Application’s Rich Presence assets and use the same asset key above. Eclipse only sends the selected Eclipse-owned status through Discord’s local IPC connection.' : 'The browser preview never attempts a Discord connection.'}</span><button class="text-button" type="button" data-action="refresh-discord">Refresh status <span>→</span></button></div>
    </section>
  </div>`;
}

async function refreshStartupStatus({ render = true } = {}) {
  try {
    state.startup.status = await system.startupStatus();
  } catch (error) {
    state.startup.status = { supported: false, enabled: false, reason: error instanceof Error ? error.message : 'Startup status is unavailable.' };
  }
  if (render && state.page === 'settings') renderSettings();
  return state.startup.status;
}

async function updateStartup(enabled) {
  state.startup.busy = true;
  renderSettings();
  try {
    state.startup.status = await system.setStartup(enabled);
    showToast(state.startup.status.enabled ? 'Eclipse will launch when you sign in to Windows.' : 'Eclipse will no longer launch when you sign in to Windows.');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Eclipse could not update the startup preference.');
  } finally {
    state.startup.busy = false;
    if (state.page === 'settings') renderSettings();
  }
}

function renderSettings() {
  if (!state.startup.status && !state.startup.busy) Promise.resolve().then(() => refreshStartupStatus());
  const startup = state.startup.status || { supported: false, enabled: false, reason: 'Checking Windows integration…' };
  pageContent.innerHTML = `<div class="page-shell settings-page">
    ${pageHeader('Settings', 'Make Eclipse yours.', 'Interface and Windows preferences remain local to this device. Eclipse never requests Roblox account credentials.', '')}
    <section class="settings-list panel"><div class="setting-row"><div><p class="section-kicker">Accessibility</p><h2>Reduce interface motion</h2><p>Minimize hover movement and visual transitions. Eclipse also honors your system reduced-motion preference.</p></div><label class="toggle"><input type="checkbox" data-setting="reducedMotion" ${state.settings.reducedMotion ? 'checked' : ''}/><span></span></label></div><div class="setting-row"><div><h2>High contrast surfaces</h2><p>Increase boundaries and text separation across Eclipse panels.</p></div><label class="toggle"><input type="checkbox" data-setting="highContrast" ${state.settings.highContrast ? 'checked' : ''}/><span></span></label></div><div class="setting-row"><div><h2>Interface scale</h2><p>Use a larger text and control scale without changing Windows settings.</p></div><label class="settings-select"><span class="sr-only">Interface scale</span><select data-setting-select="uiScale"><option value="1" ${state.settings.uiScale === 1 ? 'selected' : ''}>Default</option><option value="1.1" ${state.settings.uiScale === 1.1 ? 'selected' : ''}>Large 110%</option><option value="1.2" ${state.settings.uiScale === 1.2 ? 'selected' : ''}>Larger 120%</option><option value="1.3" ${state.settings.uiScale === 1.3 ? 'selected' : ''}>Largest 130%</option></select></label></div><div class="setting-row"><div><p class="section-kicker">Layout & locale</p><h2>Compact game cards</h2><p>Fit more official Roblox experiences on Discover and Library.</p></div><label class="toggle"><input type="checkbox" data-setting="compactCards" ${state.settings.compactCards ? 'checked' : ''}/><span></span></label></div><div class="setting-row"><div><h2>Use a 24-hour clock</h2><p>Format local Eclipse launch times using your locale with 24-hour time.</p></div><label class="toggle"><input type="checkbox" data-setting="clock24Hour" ${state.settings.clock24Hour ? 'checked' : ''}/><span></span></label></div><div class="setting-row"><div><p class="section-kicker">Windows integration</p><h2>Launch Eclipse at sign-in</h2><p>${escapeHtml(startup.supported ? 'Optional. Eclipse adds no Roblox protocol ownership and retains only its own Windows startup preference.' : startup.reason || 'Available in the packaged Windows app.')}</p></div><label class="toggle ${!startup.supported || state.startup.busy ? 'is-disabled' : ''}"><input type="checkbox" data-startup-setting ${startup.enabled ? 'checked' : ''} ${!startup.supported || state.startup.busy ? 'disabled' : ''}/><span></span></label></div><div class="setting-row account-setting"><div><p class="section-kicker">Local identity</p><h2>${escapeHtml(state.profile.created ? state.profile.displayName : 'No Eclipse profile yet')}</h2><p>${state.profile.created ? 'This profile is stored locally in Eclipse. It is not connected to Roblox or an online account.' : 'Create a local Eclipse profile without an email, password, or Roblox account.'}</p></div><button class="quiet-button" type="button" data-profile-action="open">${state.profile.created ? 'Edit profile' : 'Create profile'}</button></div></section>
  </div>`;
}

function updateWindowTab() {
  const labels = { home: 'Home', discover: 'Discover', library: 'Library', 'game-details': 'Game details', tools: 'Tools', optimization: 'Optimization', fastflags: 'Fast Flags', mods: 'Mods', integrations: 'Integrations', settings: 'Settings' };
  const label = labels[state.page] || 'Home';
  const target = document.querySelector('[data-active-page]');
  if (target) target.textContent = label;
  document.title = `Eclipse — ${label}`;
}

function renderCurrentPage() {
  setSettings();
  updateProfileSurface();
  updateWindowTab();
  if (state.page === 'discover') renderDiscover();
  else if (state.page === 'library') renderLibrary();
  else if (state.page === 'game-details') renderGameDetails();
  else if (state.page === 'tools') renderTools();
  else if (state.page === 'optimization') renderOptimization();
  else if (state.page === 'fastflags') renderFastFlags();
  else if (state.page === 'mods') renderMods();
  else if (state.page === 'integrations') renderIntegrations();
  else if (state.page === 'settings') renderSettings();
  else renderHome();
  pageContent.focus({ preventScroll: true });
}

function setPage(page) {
  if (!['home', 'discover', 'library', 'tools', 'optimization', 'fastflags', 'mods', 'integrations', 'settings'].includes(page)) return;
  state.page = page;
  document.querySelectorAll('[data-page]').forEach((button) => {
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  sidebar.classList.remove('open');
  renderCurrentPage();
}

async function launchGame(placeId) {
  const game = gameForPlace(placeId);
  const numericId = Number(placeId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    showToast('A valid Roblox place ID is required.');
    return;
  }
  try {
    await roblox.launchPlace(numericId);
    addLaunchHistory(numericId, game);
    if (game) addRecent(game);
    showToast('Eclipse handed the place to Roblox Player. Eclipse cannot confirm Roblox connection or gameplay state.');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Roblox Player could not be started.');
  }
}

async function openOfficial(action, placeId) {
  try {
    await roblox.openOfficial(action, placeId);
    const messages = { game: 'Opening the official Roblox game page.' };
    showToast(messages[action] || 'Opening Roblox.');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Roblox could not be opened.');
  }
}

function setMaximizeControl(isMaximized) {
  const button = document.querySelector('[data-window-control="maximize"]');
  if (!button) return;
  button.setAttribute('aria-label', isMaximized ? 'Restore window' : 'Maximize');
  button.dataset.maximized = String(isMaximized);
}

function wireWindowControls() {
  document.querySelectorAll('[data-window-control]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.windowControl;
      if (!desktopWindow) {
        showToast('Window controls are available in the Eclipse desktop app.');
        return;
      }
      if (action === 'minimize') await desktopWindow.minimize();
      if (action === 'maximize') setMaximizeControl(await desktopWindow.toggleMaximize());
      if (action === 'close') await desktopWindow.close();
    });
  });
  if (desktopWindow) {
    desktopWindow.isMaximized().then(setMaximizeControl);
    desktopWindow.onMaximizedChange(setMaximizeControl);
  }
}

function wireShell() {
  document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
  document.querySelectorAll('[data-page-link]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.pageLink)));
  document.querySelector('[data-mobile-menu]').addEventListener('click', () => sidebar.classList.toggle('open'));
}

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    setPage('discover');
    window.setTimeout(() => document.querySelector('[data-discovery-form] input')?.focus(), 0);
    return;
  }
  if (typing || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !target.matches?.('[data-page]')) return;
  const pages = [...document.querySelectorAll('[data-page]')];
  const index = pages.indexOf(target);
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + pages.length) % pages.length;
  event.preventDefault();
  pages[nextIndex]?.focus();
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const { action, profileAction, pageLink } = button.dataset;
  if (pageLink) setPage(pageLink);
  if (profileAction === 'open') openProfileDialog();
  if (action === 'close-profile-dialog') closeProfileDialog();
  if (action === 'clear-profile-image') {
    pendingProfileAvatar = '';
    profileImageRequest += 1;
    const imageInput = profileDialog()?.querySelector('[data-profile-image-input]');
    if (imageInput) imageInput.value = '';
    updateProfileDialogAvatar();
  }
  if (action === 'refresh-discord') await refreshDiscordStatus();
  if (action === 'bootstrapper-update') await updateRobloxPlayer();
  if (action === 'bootstrapper-repair') await updateRobloxPlayer({ repair: true });
  if (action === 'copy-player-diagnostics') await copyPlayerDiagnostics();
  if (action === 'open-fastflags') setPage('fastflags');
  if (action === 'optimization-refresh') await refreshOptimizationStatus();
  if (action === 'optimization-windows-update') await runOptimization('windows-update', () => system.openWindowsUpdate(), 'Windows Update opened for official driver and system updates.');
  if (action === 'optimization-clear-eclipse-cache') await runOptimization('eclipse-cache', () => system.clearEclipseCache(), 'Eclipse browser cache cleared.');
  if (action === 'optimization-clear-roblox-cache') await runOptimization('roblox-cache', () => system.clearRobloxCache(), 'Roblox local cache and logs cleared.');
  if (action === 'launch-game' || action === 'relaunch-place') await launchGame(button.dataset.placeId);
  if (action === 'open-game') await openOfficial('game', button.dataset.placeId);
  if (action === 'game-details') openGameDetails(button.dataset.universeId, button.dataset.placeId);
  if (action === 'game-details-back') backFromGameDetails();
  if (action === 'game-details-retry') void loadGameDetails();
  if (action === 'game-details-tab') {
    const tab = button.dataset.gameDetailsTab;
    if (['about', 'servers', 'passes'].includes(tab)) {
      state.gameDetails.tab = tab;
      if (state.page === 'game-details') renderGameDetails();
    }
  }
  if (action === 'game-servers-refresh') void refreshGameServers();
  if (action === 'game-servers-more') void loadMoreGameServers();
  if (action === 'save-game') {
    const game = gameForPlace(button.dataset.placeId);
    if (game) {
      saveGame(game);
      button.classList.add('saved');
      button.textContent = '✓';
      button.setAttribute('aria-label', `Saved in library: ${game.name}`);
      showToast(`${game.name} was saved to your library.`);
    }
  }
  if (action === 'pin-game') {
    togglePinnedGame(button.dataset.universeId);
    renderLibrary();
    showToast('Favorite pin updated in your local library.');
  }
  if (action === 'remove-game') {
    removeGame(button.dataset.universeId);
    renderLibrary();
    showToast('Removed from your local Eclipse library.');
  }
  if (action === 'refresh-discover') await loadDiscover({ resetToPopular: !state.discover.query });
  if (action === 'clear-discover-filters') {
    state.discover.filter = 'all';
    state.discover.sort = 'featured';
    renderDiscover();
  }
  if (action === 'load-more') await loadDiscover({ append: true });
  if (action === 'select-discover-collection' && !state.discover.query) {
    const collectionId = String(button.dataset.discoveryCollection || '');
    if (state.discover.collections.some((collection) => collection.id === collectionId)) {
      state.discover.collectionId = collectionId;
      updateDiscoverView();
    }
  }
  if (action === 'open-status') showToast('Eclipse uses official Roblox discovery data and Player deep links.');
  if (action === 'fastflag-profile') {
    const profile = button.dataset.fastflagProfile;
    state.fastFlags.profile = profile;
    state.fastFlags.msaa = fastFlagProfiles[profile]?.msaa ?? 0;
    state.fastFlags.profileId = '';
    updateFastFlagsPanel();
  }
  if (action === 'select-saved-fastflag-profile') {
    const saved = state.fastFlagProfiles.find((item) => item.id === button.dataset.savedFastflagProfile);
    if (saved) {
      Object.assign(state.fastFlags, saved.settings, { profileId: saved.id });
      updateFastFlagsPanel();
      showToast(`Loaded “${saved.name}”.`);
    }
  }
  if (action === 'fastflag-profile-create') createSavedFastFlagProfile();
  if (action === 'fastflag-profile-duplicate') duplicateSavedFastFlagProfile();
  if (action === 'fastflag-profile-rename') renameSavedFastFlagProfile();
  if (action === 'fastflag-profile-delete') deleteSavedFastFlagProfile();
  if (action === 'fastflag-profile-export') exportSavedFastFlagProfiles();
  if (action === 'fastflag-reset') await resetFastFlags();
  if (action === 'refresh-mods') await refreshModsStatus();
  if (action === 'mod-creator-open') {
    if (!state.mods.targets) state.mods.targetError = '';
    state.mods.creator.open = true;
    if (state.page === 'mods') renderMods();
  }
  if (action === 'mod-creator-cancel') {
    state.mods.creator = defaultModsCreator();
    if (state.page === 'mods') renderMods();
  }
  if (action === 'mod-creator-refresh-targets') await refreshModsTargets();
  if (action === 'mod-creator-add-asset') await addModsCreatorAsset(button.dataset.modCreatorKind);
  if (action === 'mod-creator-remove-asset') {
    const index = Number(button.dataset.modCreatorAssetIndex);
    if (Number.isSafeInteger(index) && index >= 0) {
      state.mods.creator.assets.splice(index, 1);
      if (state.page === 'mods') renderMods();
    }
  }
  if (action === 'mod-import-package') await runModsOperation(() => mods.importPackage(), 'Local .eclipsepack imported to Eclipse. Review it before enabling.');
  if (action === 'mod-import-folder') await runModsOperation(() => mods.importFolder(), 'Local developer folder imported to Eclipse. Review it before enabling.');
  if (action === 'mod-restore') await runModsOperation(() => mods.restore(), 'Original files were restored and local Player packs were disabled.');
  if (action === 'mod-toggle') {
    const enable = button.dataset.modEnabled === 'true';
    await runModsOperation(() => mods.setEnabled(button.dataset.modId, enable), enable ? 'Player pack enabled with a versioned local backup.' : 'Player pack disabled and original assets restored.');
  }
  if (action === 'mod-remove') await runModsOperation(() => mods.remove(button.dataset.modId), 'Local Player pack removed from Eclipse.');
});

document.addEventListener('submit', async (event) => {
  if (event.target.matches('[data-mod-creator-form]')) {
    event.preventDefault();
    const creator = state.mods.creator;
    const formData = new FormData(event.target);
    const manifest = {
      schema: 'eclipse-player-pack/v1',
      id: String(formData.get('id') || '').trim(),
      name: String(formData.get('name') || '').trim(),
      version: String(formData.get('version') || '').trim(),
      description: String(formData.get('description') || '').trim(),
      assets: creator.assets.map((asset) => ({ source: asset.source, target: asset.target, kind: asset.kind }))
    };
    if (!manifest.assets.length) {
      showToast('Add at least one texture/UI or sound asset before building a Player pack.');
      return;
    }
    if (!creatorTargetsAreVerified()) {
      showToast('Choose a verified Player target from the catalog for every asset before building.');
      updateModsCreatorPreflight();
      return;
    }
    await runModsOperation(async () => {
      const result = await mods.createPackage({
        manifest,
        assets: creator.assets.map((asset) => ({ source: asset.source, token: asset.token }))
      });
      if (!result?.canceled) state.mods.creator = defaultModsCreator();
      return result;
    }, 'Player pack built, saved, and added to your local Eclipse vault.');
    return;
  }
  if (event.target.matches('[data-profile-form]')) {
    event.preventDefault();
    saveEclipseProfile(event.target);
    return;
  }
  if (event.target.matches('[data-discovery-form]')) {
    event.preventDefault();
    const query = new FormData(event.target).get('query');
    state.discover.query = String(query || '').trim();
    state.discover.cursor = '';
    state.discover.games = [];
    state.discover.collections = [];
    state.discover.collectionId = '';
    state.discover.error = '';
    updateDiscoverView();
    await loadDiscover();
  }
  if (event.target.matches('[data-place-form]')) {
    event.preventDefault();
    const placeId = String(new FormData(event.target).get('placeId') || '');
    await launchGame(placeId);
  }
  if (event.target.matches('[data-fastflags-form]')) {
    event.preventDefault();
    await applyFastFlags();
  }
});

document.addEventListener('input', (event) => {
  const creatorField = event.target.closest('[data-mod-creator-field]');
  if (creatorField) {
    const field = creatorField.dataset.modCreatorField;
    const value = String(creatorField.value || '');
    if (field === 'name') {
      const previousName = state.mods.creator.name;
      const idWasAutomatic = !state.mods.creator.id || state.mods.creator.id === creatorPackId(previousName);
      state.mods.creator.name = value;
      if (idWasAutomatic) {
        state.mods.creator.id = creatorPackId(value);
        const idInput = pageContent.querySelector('[data-mod-creator-field="id"]');
        if (idInput) idInput.value = state.mods.creator.id;
      }
    } else if (['id', 'version', 'description'].includes(field)) {
      state.mods.creator[field] = value;
    }
    return;
  }
  const creatorTarget = event.target.closest('[data-mod-creator-target]');
  if (creatorTarget) {
    const index = Number(creatorTarget.dataset.modCreatorTarget);
    if (Number.isSafeInteger(index) && state.mods.creator.assets[index]) {
      const asset = state.mods.creator.assets[index];
      const value = String(creatorTarget.value || '').trim();
      asset.target = creatorTargetOptions(asset.kind).find((candidate) => candidate.toLowerCase() === value.toLowerCase()) || value;
      updateModsCreatorPreflight();
    }
    return;
  }
  const fastFlagInput = event.target.closest('input[type="range"][data-fastflag-field]');
  if (fastFlagInput) {
    state.fastFlags[fastFlagInput.dataset.fastflagField] = Number(fastFlagInput.value);
    const output = pageContent.querySelector(`[data-fastflag-output="${fastFlagInput.dataset.fastflagField}"]`);
    if (output) output.textContent = fastFlagInput.value;
    return;
  }
  const profileInput = event.target.closest('[name="displayName"]');
  if (profileInput) {
    profileInput.setAttribute('aria-invalid', 'false');
    const error = profileInput.closest('[data-profile-form]')?.querySelector('[data-profile-input-error]');
    if (error) error.hidden = true;
    return;
  }
});

document.addEventListener('change', async (event) => {
  const serverSort = event.target.closest('[data-game-server-sort]');
  if (serverSort) {
    state.gameDetails.serverSort = serverSort.value === 'players' ? 'players' : 'ping';
    if (state.page === 'game-details') renderGameDetails();
    return;
  }
  const fastFlagImport = event.target.closest('[data-fastflag-import]');
  if (fastFlagImport) {
    try {
      await importSavedFastFlagProfiles(fastFlagImport.files?.[0]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Fast Flag profiles could not be imported.');
    } finally {
      fastFlagImport.value = '';
    }
    return;
  }
  const profileImageInput = event.target.closest('[data-profile-image-input]');
  if (profileImageInput) {
    setPendingProfileImage(profileImageInput.files?.[0]);
    return;
  }
  const fastFlagInput = event.target.closest('[data-fastflag-field]');
  if (fastFlagInput) {
    state.fastFlags[fastFlagInput.dataset.fastflagField] = fastFlagInput.type === 'checkbox' ? fastFlagInput.checked : fastFlagInput.dataset.fastflagType === 'string' ? fastFlagInput.value : Number(fastFlagInput.value);
    persistActiveFastFlagProfile();
    updateFastFlagsPanel();
    return;
  }
  const discoverySort = event.target.closest('[data-discovery-sort], [data-discovery-filter]');
  if (discoverySort) {
    if (discoverySort.matches('[data-discovery-sort]')) state.discover.sort = discoverySort.value;
    if (discoverySort.matches('[data-discovery-filter]')) state.discover.filter = discoverySort.value;
    updateDiscoverView();
    return;
  }
  const discordClientInput = event.target.closest('[data-discord-client-id]');
  if (discordClientInput) {
    const applicationId = String(discordClientInput.value || '').trim();
    if (applicationId && !/^\d{17,20}$/.test(applicationId)) {
      discordClientInput.setAttribute('aria-invalid', 'true');
      showToast('Discord Application IDs are 17–20 digits.');
      return;
    }
    discordClientInput.setAttribute('aria-invalid', 'false');
    state.integrations.discordClientId = applicationId;
    saveIntegrations();
    await syncDiscordPresence({ render: true });
    showToast(applicationId ? 'Discord Application ID saved locally.' : 'The local Discord Application ID was cleared.');
    return;
  }
  const discordAssetInput = event.target.closest('[data-discord-asset-key]');
  if (discordAssetInput) {
    const assetKey = String(discordAssetInput.value || '').trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(assetKey)) {
      discordAssetInput.setAttribute('aria-invalid', 'true');
      showToast('Discord image asset keys use 1–32 letters, numbers, hyphens, or underscores.');
      return;
    }
    discordAssetInput.setAttribute('aria-invalid', 'false');
    state.integrations.discordAssetKey = assetKey;
    saveIntegrations();
    await syncDiscordPresence({ render: true });
    showToast('Discord Eclipse icon asset key saved locally.');
    return;
  }
  const discordDisplayInput = event.target.closest('[data-discord-display]');
  if (discordDisplayInput) {
    state.integrations.discordActivityDisplay = normalizeDiscordActivityDisplay(discordDisplayInput.value);
    saveIntegrations();
    await syncDiscordPresence({ render: true });
    showToast('Discord Eclipse status display updated.');
    return;
  }
  const integrationInput = event.target.closest('[data-integration]');
  if (integrationInput) {
    const field = integrationInput.dataset.integration;
    if (!['activityTracking', 'discordRichPresence'].includes(field)) return;
    state.integrations[field] = integrationInput.type === 'checkbox' ? integrationInput.checked : integrationInput.value;
    saveIntegrations();
    await syncDiscordPresence({ render: true });
    const messages = {
      activityTracking: state.integrations.activityTracking ? 'Local activity tracking enabled.' : 'Local activity tracking paused.',
      discordRichPresence: state.integrations.discordRichPresence ? 'Discord Rich Presence enabled. Discord will show Eclipse when Discord Desktop connects.' : 'Discord Rich Presence disabled and cleared.'
    };
    showToast(messages[field]);
    return;
  }
  const startupInput = event.target.closest('[data-startup-setting]');
  if (startupInput) {
    await updateStartup(startupInput.checked);
    return;
  }
  const select = event.target.closest('[data-setting-select]');
  if (select) {
    state.settings[select.dataset.settingSelect] = Number(select.value);
    setSettings();
    renderSettings();
    showToast('Eclipse interface scale saved on this device.');
    return;
  }
  const input = event.target.closest('[data-setting]');
  if (!input) return;
  state.settings[input.dataset.setting] = input.checked;
  setSettings();
  showToast('Eclipse preference saved on this device.');
});

wireWindowControls();
wireShell();
setSettings();
renderCurrentPage();
void syncDiscordPresence();
