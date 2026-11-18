const toast = document.querySelector('[data-toast]');
const pageContent = document.querySelector('[data-page-content]');
const sidebar = document.querySelector('[data-sidebar]');
const desktopWindow = window.eclipseWindow;
const storageKeys = {
  library: 'eclipse.roblox.library.v1',
  recent: 'eclipse.roblox.recent.v1',
  settings: 'eclipse.settings.v1',
  integrations: 'eclipse.integrations.v1',
  profile: 'eclipse.profile.v1'
};

const state = {
  page: 'home',
  library: readStored(storageKeys.library, []),
  recent: readStored(storageKeys.recent, []),
  settings: { reducedMotion: false, compactCards: false, ...readStored(storageKeys.settings, {}) },
  integrations: normalizeIntegrations(readStored(storageKeys.integrations, {})),
  community: createCommunityState(),
  profile: normalizeProfile(readStored(storageKeys.profile, {})),
  discover: { games: [], collections: [], collectionId: '', query: '', cursor: '', loading: false, error: '' },
  bootstrapper: { status: null, busy: false, progress: null, error: '' },
  fastFlags: { status: null, profile: 'balanced', msaa: 2, fpsCap: 0, preserveDisplayScaling: false, meshDetailEnabled: false, meshDetail: 3, frmQualityEnabled: false, frmQuality: 21, renderingMode: 'automatic', busy: false, message: '' }
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
  onProgress() { return () => {}; }
};

const bootstrapper = window.eclipseBootstrapper || browserBootstrapper;

const browserFastFlags = {
  async getStatus() { return { supported: false, reason: 'Fast Flags can be applied from the Windows Eclipse desktop app.' }; },
  async apply() { throw new Error('Fast Flags can be applied from the Windows Eclipse desktop app.'); },
  async reset() { throw new Error('Fast Flags can be reset from the Windows Eclipse desktop app.'); }
};

const fastFlags = window.eclipseFastFlags || browserFastFlags;


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


async function communityJson(path, options = {}) {
  const response = await fetch(`/api/community${path}`, {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Eclipse Community request failed.');
  return payload;
}

const browserCommunity = {
  status: () => communityJson('/status'),
  register: (details) => communityJson('/auth/register', { method: 'POST', body: details }),
  login: (details) => communityJson('/auth/login', { method: 'POST', body: details }),
  logout: () => communityJson('/auth/logout', { method: 'POST' }),
  me: () => communityJson('/auth/me'),
  resendVerification: () => communityJson('/auth/resend-verification', { method: 'POST' }),
  chats: () => communityJson('/chats'),
  lookup: (username) => communityJson(`/users/lookup?username=${encodeURIComponent(username)}`),
  requestChat: (username) => communityJson('/message-requests', { method: 'POST', body: { username } }),
  respondToMessageRequest: (id, action) => communityJson(`/message-requests/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { method: 'POST' }),
  conversation: (contact) => communityJson(`/conversations?contact=${encodeURIComponent(contact)}`),
  sendMessage: (contact, body) => communityJson('/conversations', { method: 'POST', body: { contact, body } }),
  sendPlaceInvite: (contact, placeId) => communityJson('/place-invites', { method: 'POST', body: { contact, placeId } }),
  block: (username) => communityJson('/blocks', { method: 'POST', body: { username } }),
  report: (details) => communityJson('/reports', { method: 'POST', body: details })
};

const communityApi = window.eclipseCommunity || browserCommunity;
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

function normalizeIntegrations(value) {
  const activityTracking = value?.activityTracking !== false;
  const discordClientId = String(value?.discordClientId || '').trim();
  return {
    activityTracking,
    discordRichPresence: value?.discordRichPresence === true,
    discordClientId: /^\d{17,20}$/.test(discordClientId) ? discordClientId : ''
  };
}

function saveIntegrations() {
  state.integrations = normalizeIntegrations(state.integrations);
  writeStored(storageKeys.integrations, state.integrations);
}

function discordPresenceOptions() {
  return {
    applicationId: state.integrations.discordClientId,
    enabled: state.integrations.discordRichPresence === true
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

function normalizeCommunityHandle(value) {
  const handle = String(value || '').trim().replace(/^@+/, '').slice(0, 32);
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(handle) ? handle : '';
}

function createCommunityState() {
  return {
    status: null,
    loading: false,
    error: '',
    user: null,
    emailVerified: false,
    authMode: 'login',
    authBusy: false,
    authError: '',
    chats: { chats: [], incoming: [], outgoing: [] },
    lookup: null,
    lookupBusy: false,
    selectedChat: '',
    messages: [],
    placeInvites: [],
    messagesBusy: false
  };
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
  const count = Number(value) || 0;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}K`;
  return String(count);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
    imageUrl: safeImageUrl(game.imageUrl)
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

function addRecent(game) {
  if (!state.integrations.activityTracking) return;
  const safeGame = normalizeGame(game);
  if (!safeGame) return;
  safeGame.launchedAt = new Date().toISOString();
  state.recent = [safeGame, ...state.recent.filter((item) => item.universeId !== safeGame.universeId)].slice(0, 16);
  writeStored(storageKeys.recent, state.recent);
}

function setSettings() {
  writeStored(storageKeys.settings, state.settings);
  document.documentElement.classList.toggle('reduce-motion', Boolean(state.settings.reducedMotion));
  document.documentElement.classList.toggle('compact-cards', Boolean(state.settings.compactCards));
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
    ? `<button class="card-icon-button" type="button" data-action="remove-game" data-universe-id="${game.universeId}" aria-label="Remove ${escapeHtml(game.name)} from library">×</button>`
    : `<button class="card-icon-button ${saved ? 'saved' : ''}" type="button" data-action="save-game" data-place-id="${game.placeId}" aria-label="${saved ? 'Saved in' : 'Save'} ${escapeHtml(game.name)}">${saved ? '✓' : '+'}</button>`;
  const rating = game.rating === null || game.rating === undefined ? '' : `<span>${game.rating}% liked</span>`;

  return `<article class="game-card panel" data-game-place="${game.placeId}">
    <div class="game-cover" style="--cover-hue:${hue}">
      ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : '<span class="cover-orbit" aria-hidden="true"></span>'}
      <div class="game-cover-shade"></div>
      <div class="game-cover-actions">${secondaryAction}</div>
      <button class="card-play" type="button" data-action="launch-game" data-place-id="${game.placeId}" aria-label="Play ${escapeHtml(game.name)}"><span class="play-icon"></span></button>
    </div>
    <div class="game-copy">
      <h3 title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</h3>
      <p>${escapeHtml(game.creator || 'Roblox creator')}</p>
      <div class="game-meta"><span><i class="player-dot"></i>${formatCount(game.playing)} playing</span>${rating}</div>
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
        <button class="quiet-button" type="button" data-action="open-game" data-place-id="${game.placeId}">Official page</button>
      </div>
    </div>
  </article>`;
}

function renderHome() {
  const recent = state.recent.slice(0, 4);
  const saved = state.library.slice(0, 4);
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const primary = recent[0] || saved[0];

  pageContent.innerHTML = `<div class="page-shell home-page">
    ${pageHeader('Your Roblox orbit', `${greeting}.`, 'Launch an official Roblox experience, keep your own library, and explore what is live now.', '<button class="primary-button" type="button" data-page-link="discover"><span class="play-icon"></span> Discover Roblox</button>')}
    ${primary ? featuredGame(primary) : emptyState('◌', 'Your library starts with Roblox.', 'Save official Roblox experiences from Discover. Eclipse keeps the list on this device and never creates custom games.', '<button class="primary-button" type="button" data-page-link="discover">Browse live Roblox games</button>')}
    <section class="content-section">
      <div class="section-heading"><div><p class="section-kicker">Recent launches</p><h2>Continue playing</h2></div>${recent.length ? '<button class="text-button" type="button" data-page-link="library">Open library <span>→</span></button>' : ''}</div>
      ${recent.length ? `<div class="game-grid home-game-grid">${recent.map((game) => gameCard(game)).join('')}</div>` : '<p class="section-note">Games you start through Eclipse appear here. Roblox Player handles your account session.</p>'}
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
      <div class="discovery-toolbar"><span><i></i><span data-discovery-context>${state.discover.query ? `Search results for “${escapeHtml(state.discover.query)}”` : 'Official Roblox collections'}</span></span><button class="quiet-button compact-button" type="button" data-action="refresh-discover">Refresh</button></div>
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
  const visibleGames = state.discover.query ? state.discover.games : activeCollection?.games || state.discover.games;
  const collectionTitle = activeCollection?.title || 'Popular on Roblox';
  context.textContent = state.discover.query ? `Search results for “${state.discover.query}”` : `${collectionTitle} from Roblox`;
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
    footer.innerHTML = emptyState('○', 'No official Roblox experiences found.', 'Try another search term or refresh the official Roblox collections.', '<button class="primary-button" type="button" data-action="refresh-discover">Show Roblox collections</button>');
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

function communityCardInitials(username) {
  return String(username || 'E').replace(/^@/, '').slice(0, 2).toUpperCase();
}

function communityMessageMarkup(message) {
  const own = message.senderId === state.community.user?.id;
  return `<article class="community-message ${own ? 'own' : ''}"><div><strong>${escapeHtml(own ? 'You' : `@${message.senderUsername}`)}</strong><time>${escapeHtml(formatDate(message.createdAt))}</time></div><p>${escapeHtml(message.body)}</p></article>`;
}

function communityPlaceInviteMarkup(invite) {
  const own = invite.senderId === state.community.user?.id;
  return `<article class="community-place-invite ${own ? 'own' : ''}"><div><span class="community-system-mark" aria-hidden="true">↗</span><span><strong>${escapeHtml(own ? 'You shared an official Roblox place' : `@${invite.senderUsername} shared an official Roblox place`)}</strong><small>${escapeHtml(formatDate(invite.createdAt))} · Place ${escapeHtml(invite.placeId)}</small></span></div><button class="quiet-button compact-button" type="button" data-action="launch-game" data-place-id="${escapeHtml(invite.placeId)}">Play in Roblox</button></article>`;
}

function renderCommunityAuth() {
  const community = state.community;
  const registering = community.authMode === 'register';
  return `<section class="community-auth-layout">
    <article class="community-identity-panel panel">
      <p class="section-kicker"><i></i> Eclipse Community account</p>
      <h2>${registering ? 'Create a separate Eclipse identity.' : 'Sign in to Community.'}</h2>
      <p>Your Community email and password belong only to Eclipse Community. Eclipse never asks for, sends, stores, or links Roblox credentials.</p>
      <ul class="community-trust-list"><li><i></i> Unique Eclipse username</li><li><i></i> Email verification before message requests</li><li><i></i> Recipient acceptance before private chat</li></ul>
    </article>
    <form class="community-auth-form panel" data-community-auth-form novalidate>
      <div class="community-auth-switch" role="tablist" aria-label="Community account action"><button type="button" class="${registering ? '' : 'active'}" data-action="community-auth-mode" data-community-auth-mode="login" aria-selected="${!registering}">Sign in</button><button type="button" class="${registering ? 'active' : ''}" data-action="community-auth-mode" data-community-auth-mode="register" aria-selected="${registering}">Create account</button></div>
      <h2>${registering ? 'Start your Eclipse account' : 'Welcome back'}</h2>
      ${registering ? '<label>Eclipse username<input name="username" maxlength="32" autocomplete="username" placeholder="orbit.eclipse" required /></label>' : ''}
      <label>Email<input name="email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com" required /></label>
      <label>Password<input name="password" type="password" minlength="12" maxlength="256" autocomplete="${registering ? 'new-password' : 'current-password'}" placeholder="At least 12 characters" required /></label>
      ${community.authError ? `<p class="community-form-error" role="alert">${escapeHtml(community.authError)}</p>` : ''}
      <button class="primary-button" type="submit" ${community.authBusy ? 'disabled' : ''}>${community.authBusy ? 'Please wait…' : registering ? 'Create Eclipse account' : 'Sign in securely'}</button>
      <small>${registering ? 'We will send a verification link to this email. Your username is used for Community only.' : 'A secure Community session is created after your password is verified.'}</small>
    </form>
  </section>`;
}

function renderCommunityVerification() {
  const { user } = state.community;
  return `<section class="community-verification panel"><span class="community-verification-mark" aria-hidden="true">✦</span><div><p class="section-kicker">Email verification required</p><h2>Check the inbox for @${escapeHtml(user?.username)}.</h2><p>Verify this Eclipse account email before sending or accepting message requests and opening a private chat. This keeps Community separate from Roblox accounts and reduces abuse.</p></div><button class="primary-button" type="button" data-action="community-resend-verification">Resend verification email</button></section>`;
}

function renderCommunityChat(contact, selected) {
  return `<button class="community-online-contact ${selected ? 'active' : ''}" type="button" data-action="select-community-chat" data-community-chat="${escapeHtml(contact.username)}" aria-pressed="${selected}"><span class="community-contact-avatar">${escapeHtml(communityCardInitials(contact.username))}</span><span><strong>@${escapeHtml(contact.username)}</strong><small>Accepted private chat</small></span></button>`;
}

function renderCommunityVerified() {
  const community = state.community;
  const chats = community.chats.chats || [];
  const incoming = community.chats.incoming || [];
  const outgoing = community.chats.outgoing || [];
  const selected = chats.find((contact) => contact.username === community.selectedChat) || null;
  const searchResult = community.lookup?.user;
  const contacts = chats.length
    ? chats.map((contact) => renderCommunityChat(contact, contact.username === selected?.username)).join('')
    : '<div class="community-empty-contacts"><span aria-hidden="true">◌</span><strong>No private chats yet</strong><p>Search an Eclipse username and send a message request. Private chat opens after they accept.</p></div>';
  const incomingMarkup = incoming.length ? `<section class="community-request-group"><h3>Message requests</h3>${incoming.map((request) => `<article class="community-request-card"><span class="community-contact-avatar">${escapeHtml(communityCardInitials(request.username))}</span><div><strong>@${escapeHtml(request.username)}</strong><small>Requested a private chat</small></div><div><button type="button" class="quiet-button compact-button" data-action="community-respond-request" data-request-id="${escapeHtml(request.id)}" data-request-action="decline">Decline</button><button type="button" class="primary-button compact-button" data-action="community-respond-request" data-request-id="${escapeHtml(request.id)}" data-request-action="accept">Accept</button></div></article>`).join('')}</section>` : '';
  const outgoingMarkup = outgoing.length ? `<section class="community-request-group community-outgoing"><h3>Sent message requests</h3>${outgoing.map((request) => `<p><span class="community-draft-dot"></span>@${escapeHtml(request.username)} <small>Awaiting acceptance</small></p>`).join('')}</section>` : '';
  const lookupMarkup = searchResult
    ? `<div class="community-lookup-result"><span class="community-contact-avatar">${escapeHtml(communityCardInitials(searchResult.username))}</span><div><strong>@${escapeHtml(searchResult.username)}</strong><small>Verified Eclipse account</small></div><button class="primary-button compact-button" type="button" data-action="community-send-message-request" data-community-username="${escapeHtml(searchResult.username)}">Request chat</button></div>`
    : '';
  const threadEvents = [
    ...community.messages.map((message) => ({ ...message, type: 'message' })),
    ...community.placeInvites.map((invite) => ({ ...invite, type: 'place-invite' }))
  ].sort((first, second) => new Date(first.createdAt) - new Date(second.createdAt));
  const thread = selected
    ? `<section class="community-workbench panel"><header class="community-workbench-heading"><div><p class="section-kicker"><i></i> Private chat</p><h2>@${escapeHtml(selected.username)}</h2><p>This private chat opened because its recipient accepted the message request. Chat is text-only, with safe official Roblox place invites.</p></div><button class="quiet-button compact-button" type="button" data-action="community-block" data-community-username="${escapeHtml(selected.username)}">Block</button></header><div class="community-thread community-online-thread">${community.messagesBusy ? '<p class="community-draft-empty">Loading your private chat…</p>' : threadEvents.length ? threadEvents.map((event) => event.type === 'message' ? communityMessageMarkup(event) : communityPlaceInviteMarkup(event)).join('') : '<div class="community-system-message"><span class="community-system-mark" aria-hidden="true">E</span><div><strong>Your private chat is ready</strong><p>Only you and this accepted Eclipse chat contact can post here. Eclipse Community does not use Roblox identity or credentials.</p></div></div>'}</div><div class="community-chat-composers"><form class="community-composer community-online-composer" data-community-send-message-form><label class="sr-only" for="community-message">Message @${escapeHtml(selected.username)}</label><textarea id="community-message" name="message" maxlength="1500" placeholder="Message @${escapeHtml(selected.username)}" required></textarea><div class="community-composer-actions"><span>Text only · 1,500 characters maximum</span><button class="primary-button" type="submit">Send message</button></div></form><form class="community-place-invite-form" data-community-send-invite-form><label for="community-place-invite">Official Roblox place ID</label><input id="community-place-invite" name="placeId" inputmode="numeric" pattern="[0-9]+" maxlength="15" placeholder="Share a trusted place ID" required /><button class="quiet-button" type="submit">Share place</button></form></div><form class="community-report-form" data-community-report-form><strong>Safety tools</strong><input type="hidden" name="username" value="${escapeHtml(selected.username)}" /><select name="reason" aria-label="Report reason"><option value="">Report reason…</option><option value="harassment">Harassment or hate</option><option value="spam">Spam or scam</option><option value="safety">Safety concern</option><option value="other">Other</option></select><input name="details" maxlength="1000" placeholder="Optional details for moderators" /><button class="text-button" type="submit">Report @${escapeHtml(selected.username)}</button></form></section>`
    : `<section class="community-workbench panel community-chat-empty"><div class="community-system-message"><span class="community-system-mark" aria-hidden="true">E</span><div><strong>Private chat waits for acceptance.</strong><p>Search an Eclipse username, send a message request, and select the chat once they accept. Neither Roblox accounts nor Roblox credentials are involved.</p></div></div><div class="community-media-status"><i></i><span>Image, GIF, and file uploads are disabled until a moderated media delivery service is deployed. Accepted private chats can still share official Roblox place IDs safely.</span></div></section>`;
  return `<div class="community-online-page">
    <section class="community-account-strip panel"><div><span class="community-contact-avatar">${escapeHtml(communityCardInitials(community.user?.username))}</span><span><small>Signed in as</small><strong>@${escapeHtml(community.user?.username)}</strong></span></div><span><i></i> Verified Eclipse account</span></section>
    <section class="community-find-user panel"><div><p class="section-kicker"><i></i> Search Eclipse username</p><h2>Start a private chat by username.</h2><p>Search a unique Eclipse username, then send a message request. The recipient must accept before chat opens.</p></div><form data-community-lookup-form><label class="sr-only" for="community-username-search">Eclipse username</label><input id="community-username-search" name="username" maxlength="32" autocomplete="off" placeholder="username.eclipse" required /><button class="quiet-button" type="submit" ${community.lookupBusy ? 'disabled' : ''}>${community.lookupBusy ? 'Searching…' : 'Search'}</button></form>${lookupMarkup}</section>
    <div class="community-layout community-online-layout"><aside class="community-rail panel"><div class="community-rail-heading"><div><p class="section-kicker">Private chats</p><h2>Messages</h2></div><span>${chats.length}</span></div><div class="community-contact-list">${contacts}</div>${incomingMarkup}${outgoingMarkup}<div class="community-rail-footer"><i></i><span>Chat opens after acceptance</span></div></aside>${thread}</div>
  </div>`;
}

function renderCommunity() {
  const community = state.community;
  if (!community.status && !community.loading) Promise.resolve().then(() => loadCommunity());
  const status = community.status;
  const content = !status
    ? '<section class="community-loading panel"><span class="community-offline-symbol" aria-hidden="true">◌</span><div><p class="section-kicker">Secure service</p><h2>Checking Eclipse Community…</h2><p>Account, username search, message-request, and chat availability are being checked.</p></div></section>'
    : !status.enabled
      ? `<section class="community-offline-notice panel"><span class="community-offline-symbol" aria-hidden="true">◌</span><div><p class="section-kicker">Service unavailable</p><h2>Online Community has not been configured here.</h2><p>${escapeHtml(status.reason || 'The Eclipse Community service is unavailable.')} Community needs its own HTTPS service, PostgreSQL database, transactional email, and session secret. Your local Eclipse profile remains separate and no Roblox credential is ever requested.</p></div><span class="community-offline-status"><i></i> Offline</span></section>`
      : !community.user
        ? renderCommunityAuth()
        : !community.emailVerified
          ? renderCommunityVerification()
          : renderCommunityVerified();
  pageContent.innerHTML = `<div class="page-shell community-page">${pageHeader('Eclipse Community', 'Community.', 'Search an Eclipse username, send a message request, and chat privately after acceptance. Never a Roblox sign-in.', community.user ? '<button class="quiet-button" type="button" data-action="community-logout">Sign out</button>' : '')}${community.error ? `<p class="community-service-error" role="alert">${escapeHtml(community.error)}</p>` : ''}${content}<section class="community-safety panel"><p class="section-kicker"><i></i> Safety baseline</p><h2>Moderation-aware by design.</h2><p>Verified email, recipient acceptance, blocking, reporting, rate limits, and moderation audit records protect this text-only release. Media uploads are explicitly disabled rather than accepted without safe processing.</p><span><i></i> Eclipse Community never handles Roblox credentials</span></section></div>`;
}

async function loadCommunity({ refresh = false } = {}) {
  const community = state.community;
  if (community.loading) return;
  community.loading = true;
  community.error = '';
  try {
    community.status = await communityApi.status();
    if (!community.status.enabled) return;
    try {
      const account = await communityApi.me();
      community.user = account.user;
      community.emailVerified = Boolean(account.emailVerified);
    } catch (error) {
      community.user = null;
      community.emailVerified = false;
      if (!/Sign in|session has expired|AUTH_REQUIRED/i.test(error instanceof Error ? error.message : '')) throw error;
      return;
    }
    if (community.emailVerified) await refreshCommunityData();
  } catch (error) {
    community.status = { enabled: false, reason: error instanceof Error ? error.message : 'Eclipse Community could not be reached.' };
  } finally {
    community.loading = false;
    if (state.page === 'community') renderCommunity();
  }
}

async function refreshCommunityData() {
  const community = state.community;
  const chatListing = await communityApi.chats();
  community.chats = {
    chats: Array.isArray(chatListing.chats) ? chatListing.chats : [],
    incoming: Array.isArray(chatListing.incoming) ? chatListing.incoming : [],
    outgoing: Array.isArray(chatListing.outgoing) ? chatListing.outgoing : []
  };
  if (!community.chats.chats.some((contact) => contact.username === community.selectedChat)) {
    community.selectedChat = '';
    community.messages = [];
    community.placeInvites = [];
  }
  if (community.selectedChat) await loadCommunityMessages(community.selectedChat, false);
}

async function loadCommunityMessages(username, updateView = true) {
  const community = state.community;
  if (!username) return;
  community.messagesBusy = true;
  if (updateView && state.page === 'community') renderCommunity();
  try {
    const result = await communityApi.conversation(username);
    community.messages = Array.isArray(result.messages) ? result.messages : [];
    community.placeInvites = Array.isArray(result.placeInvites) ? result.placeInvites : [];
  } catch (error) {
    community.messages = [];
    community.placeInvites = [];
    showToast(error instanceof Error ? error.message : 'The private chat could not be loaded.');
  } finally {
    community.messagesBusy = false;
    if (state.page === 'community') renderCommunity();
  }
}

async function submitCommunityAuth(form) {
  const community = state.community;
  const values = new FormData(form);
  const details = { email: String(values.get('email') || ''), password: String(values.get('password') || '') };
  if (community.authMode === 'register') details.username = String(values.get('username') || '');
  community.authBusy = true;
  community.authError = '';
  renderCommunity();
  try {
    if (community.authMode === 'register') {
      const result = await communityApi.register(details);
      community.authMode = 'login';
      showToast(result.message || 'Check your email to verify your Eclipse account, then sign in.');
    } else {
      await communityApi.login(details);
      await loadCommunity();
      showToast('Signed in to Eclipse Community.');
    }
  } catch (error) {
    community.authError = error instanceof Error ? error.message : 'Eclipse Community could not complete that request.';
  } finally {
    community.authBusy = false;
    if (state.page === 'community') renderCommunity();
  }
}

async function lookupCommunityUser(form) {
  const community = state.community;
  const username = normalizeCommunityHandle(new FormData(form).get('username'));
  if (!username) return showToast('Enter a valid 3–32 character Eclipse username.');
  community.lookupBusy = true;
  community.lookup = null;
  renderCommunity();
  try {
    community.lookup = await communityApi.lookup(username);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'That Eclipse username could not be found.');
  } finally {
    community.lookupBusy = false;
    if (state.page === 'community') renderCommunity();
  }
}

async function sendCommunityMessageRequest(username) {
  try {
    const result = await communityApi.requestChat(username);
    state.community.lookup = null;
    await refreshCommunityData();
    renderCommunity();
    showToast(`Message request sent to @${result.username}.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'The message request could not be sent.');
  }
}

async function respondToCommunityRequest(requestId, action) {
  try {
    const result = await communityApi.respondToMessageRequest(requestId, action);
    await refreshCommunityData();
    if (action === 'accept' && result.contactUsername) {
      state.community.selectedChat = result.contactUsername;
      await loadCommunityMessages(result.contactUsername, false);
    }
    renderCommunity();
    showToast(action === 'accept' ? 'Message request accepted. Your private chat is open.' : 'Message request declined.');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'That message request could not be updated.');
  }
}

async function sendCommunityMessage(form) {
  const message = String(new FormData(form).get('message') || '').trim();
  const username = state.community.selectedChat;
  if (!message || !username) return;
  try {
    await communityApi.sendMessage(username, message);
    await loadCommunityMessages(username, false);
    renderCommunity();
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'The private message could not be sent.');
  }
}

async function sendCommunityPlaceInvite(form) {
  const placeId = String(new FormData(form).get('placeId') || '').trim();
  const username = state.community.selectedChat;
  if (!/^\d{1,15}$/.test(placeId) || !username) {
    showToast('Enter a valid official Roblox place ID.');
    return;
  }
  try {
    await communityApi.sendPlaceInvite(username, placeId);
    await loadCommunityMessages(username, false);
    renderCommunity();
    showToast(`Official Roblox place invite sent to @${username}.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'The official Roblox place invite could not be sent.');
  }
}

async function blockCommunityUser(username) {
  if (!username || !window.confirm(`Block @${username}? This ends the private chat and prevents further messages.`)) return;
  try {
    await communityApi.block(username);
    await refreshCommunityData();
    renderCommunity();
    showToast(`@${username} has been blocked.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'The account could not be blocked.');
  }
}

async function reportCommunityUser(form) {
  const details = Object.fromEntries(new FormData(form));
  if (!details.reason) return showToast('Choose a report reason first.');
  try {
    await communityApi.report(details);
    form.reset();
    showToast('Your report has been recorded for Eclipse moderation review.');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'The report could not be sent.');
  }
}

async function logoutCommunity() {
  try { await communityApi.logout(); } catch { /* clear the client state even if the network has gone away */ }
  const status = state.community.status;
  state.community = createCommunityState();
  state.community.status = status;
  if (state.page === 'community') renderCommunity();
  showToast('Signed out of Eclipse Community.');
}

function renderLibrary() {
  pageContent.innerHTML = `<div class="page-shell library-page">
    ${pageHeader('Your library', 'Saved Roblox experiences.', 'Library items are official Roblox places you saved in Eclipse. They are stored locally on this device.', '<button class="primary-button" type="button" data-page-link="discover">Discover games</button>')}
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

function fastFlagPreview() {
  const selection = state.fastFlags;
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

function fastFlagToggle(field, checked, title, description, disabled) {
  return `<label class="ff-toggle"><input type="checkbox" data-fastflag-field="${field}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}/><span></span><b>${title}</b><small>${description}</small></label>`;
}

function fastFlagsPanel() {
  const selection = state.fastFlags;
  const { status, profile, msaa, fpsCap, preserveDisplayScaling, meshDetailEnabled, meshDetail, frmQualityEnabled, frmQuality, renderingMode, busy, message } = selection;
  const supported = status?.supported === true;
  const disabled = busy || !supported;
  const flags = fastFlagPreview();
  const profileButtons = Object.entries(fastFlagProfiles).map(([key, item]) => `<button class="ff-profile ${profile === key ? 'selected' : ''}" type="button" data-action="fastflag-profile" data-fastflag-profile="${key}" ${disabled ? 'disabled' : ''}><strong>${item.label}</strong><span>${item.detail}</span></button>`).join('');
  const flagsJson = Object.keys(flags).length ? JSON.stringify(flags, null, 2) : '{}';
  const statusText = status
    ? supported
      ? `${Object.keys(status.managedFlags || {}).length ? 'Existing Eclipse-managed flags found.' : 'No Eclipse-managed flags are currently applied.'}`
      : status.reason
    : 'Checking Fast Flag support…';
  const pathText = supported ? `Target: ${status.settingsPath}` : 'Eclipse writes only to the active Roblox Player ClientSettings file.';

  return `<section class="fastflags-panel panel">
    <div class="ff-heading"><div><p class="section-kicker"><i></i> Fast Flags</p><h2>Managed graphics controls</h2><p>Choose a supported preset, then fine-tune the same rendering controls used by established Roblox launchers. Roblox decides which local flags it accepts.</p></div><span class="ff-status ${supported ? 'available' : ''}"><i></i>${supported ? 'Windows player detected' : 'Desktop app required'}</span></div>
    <div class="ff-profile-grid">${profileButtons}</div>
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
}

async function applyFastFlags() {
  state.fastFlags.busy = true;
  updateFastFlagsPanel();
  try {
    const result = await fastFlags.apply({ profile: state.fastFlags.profile, msaa: state.fastFlags.msaa, fpsCap: state.fastFlags.fpsCap, preserveDisplayScaling: state.fastFlags.preserveDisplayScaling, meshDetailEnabled: state.fastFlags.meshDetailEnabled, meshDetail: state.fastFlags.meshDetail, frmQualityEnabled: state.fastFlags.frmQualityEnabled, frmQuality: state.fastFlags.frmQuality, renderingMode: state.fastFlags.renderingMode });
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
  return `<article class="tool-panel panel bootstrapper-panel"><p class="section-kicker"><i></i> Eclipse bootstrapper</p><div class="bootstrapper-heading"><div><h2>Official Roblox Player</h2><p>Keep the installed Windows Player ready without sharing a Roblox password or changing your system’s Roblox link handler.</p></div><span class="bootstrapper-status ${status?.installed && !status?.updateAvailable && !error ? 'ready' : busy ? 'working' : ''}"><i></i>${escapeHtml(statusLabel)}</span></div><div class="bootstrapper-actions"><button class="primary-button" type="button" data-action="bootstrapper-update" ${actionDisabled ? 'disabled' : ''}>${escapeHtml(actionLabel)}</button>${status?.latestVersion ? `<small>Official release: ${escapeHtml(status.latestVersion)}</small>` : ''}</div><p class="bootstrapper-note"><i></i>${escapeHtml(note)}</p></article>`;
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

async function updateRobloxPlayer() {
  if (state.bootstrapper.busy) return;
  state.bootstrapper.busy = true;
  state.bootstrapper.error = '';
  state.bootstrapper.progress = { phase: 'checking', detail: 'Checking the official Roblox Windows Player release.', busy: true };
  renderTools();
  try {
    const result = await bootstrapper.update();
    state.bootstrapper.status = result;
    showToast(result.changed ? 'Official Roblox Player is ready.' : 'Official Roblox Player is already current.');
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
  pageContent.innerHTML = `<div class="page-shell tools-page">
    ${pageHeader('Roblox Player', 'Eclipse bootstrapper.', 'Eclipse checks, installs, and updates the official Windows Roblox Player before an Eclipse launch. It never handles Roblox credentials or takes over your Roblox links.', '')}
    <div class="tools-grid">
      ${bootstrapperPanel()}
      <article class="tool-panel panel"><p class="section-kicker"><i></i> Launch an experience</p><h2>Start an official place</h2><p>Paste a Roblox place ID. Eclipse prepares the official Player, then requests the existing Roblox protocol handler to open the experience.</p><form class="place-form" data-place-form><label for="place-id">Roblox place ID</label><div><input id="place-id" name="placeId" inputmode="numeric" pattern="[0-9]+" placeholder="Example: 1818" required /><button class="primary-button" type="submit"><span class="play-icon"></span> Launch</button></div></form><p class="form-note">No Roblox password is requested or stored. Eclipse does not change the <code>roblox://</code> link handler.</p></article>
      <article class="tool-panel panel"><p class="section-kicker">Eclipse profile</p><h2>${escapeHtml(state.profile.created ? state.profile.displayName : 'Create your local workspace')}</h2><p>Eclipse profiles personalize this device only. They are not Roblox accounts, do not sign you in to Roblox, and never collect Roblox credentials.</p><div class="stacked-actions"><button class="quiet-button" type="button" data-profile-action="open">${state.profile.created ? 'Edit Eclipse profile' : 'Create Eclipse profile'}</button></div></article>
      <article class="tool-panel panel tool-wide"><p class="section-kicker">How bootstrapper launches work</p><ol class="protocol-list"><li><span>1</span><p>Eclipse checks the installed Windows Player against Roblox’s official release service.</p></li><li><span>2</span><p>If needed, Eclipse validates and runs the signed official Roblox installer. It never downloads client files from third parties.</p></li><li><span>3</span><p>Eclipse requests <code>roblox://experiences/start?placeId=…</code>. Roblox keeps account sign-in, connection, and gameplay under its own control.</p></li></ol></article>
    </div>
  </div>`;
}

function renderFastFlags() {
  pageContent.innerHTML = `<div class="page-shell fastflags-page">
    ${pageHeader('Roblox Player configuration', 'Fast Flags.', 'Manage Eclipse-supported Roblox Player graphics settings in one place. Eclipse writes only the settings shown here and preserves unrelated ClientAppSettings values.', '')}
    <div data-fastflags-panel>${fastFlagsPanel()}</div>
  </div>`;
  refreshFastFlagsStatus();
}

function renderIntegrations() {
  const { activityTracking, discordRichPresence, discordClientId } = state.integrations;
  const status = discordStatus || {
    supported: Boolean(window.eclipseDiscord),
    configured: Boolean(discordClientId),
    enabled: discordRichPresence,
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
  pageContent.innerHTML = `<div class="page-shell integrations-page">
    ${pageHeader('Connections', 'Integrations.', 'Control the local activity Eclipse keeps and the optional desktop integrations it publishes.', '')}
    <section class="integration-section">
      <div class="integration-heading"><div><p class="section-kicker"><i></i> Activity tracking</p><h2>Keep your Eclipse launch history local.</h2><p>Eclipse records only Roblox launch requests it successfully starts. It cannot inspect Roblox sessions opened outside Eclipse or read your Roblox account.</p></div><span class="integration-status ${activityTracking ? 'ready' : ''}"><i></i>${activityTracking ? 'Local tracking on' : 'Local tracking off'}</span></div>
      <div class="settings-list panel integration-list">
        <div class="setting-row"><div><h2>Enable activity tracking</h2><p>Add Roblox experiences launched through Eclipse to this device’s recent activity. Turning this off stops new local entries; it does not inspect or remove Roblox data.</p></div><label class="toggle"><input type="checkbox" data-integration="activityTracking" ${activityTracking ? 'checked' : ''}/><span></span></label></div>
      </div>
    </section>
    <section class="integration-section">
      <div class="integration-heading"><div><p class="section-kicker"><i></i> Discord Rich Presence</p><h2>Show that Eclipse is open.</h2><p>When enabled, the Discord Desktop app displays <strong>Open Eclipse</strong> with the Eclipse application. It never claims that Roblox joined a game or reads Discord or Roblox credentials.</p></div><span class="integration-status ${statusClass}"><i></i>${escapeHtml(statusLabel)}</span></div>
      <div class="settings-list panel integration-list">
        <div class="setting-row integration-client-id-row"><div><h2>Discord Application ID</h2><p>Use the public ID from an Eclipse Discord Developer Portal application. It is not a secret and is stored only in this local Eclipse workspace.</p></div><label class="integration-select integration-client-id"><span class="sr-only">Discord Application ID</span><input data-discord-client-id inputmode="numeric" pattern="[0-9]{17,20}" maxlength="20" value="${escapeHtml(discordClientId)}" placeholder="17–20 digit application ID" autocomplete="off" /></label></div>
        <div class="setting-row"><div><h2>Show Open Eclipse in Discord</h2><p>Publish a minimal Rich Presence while Eclipse is running. Eclipse clears it when the desktop app exits.</p></div><label class="toggle ${!status.supported ? 'is-disabled' : ''}"><input type="checkbox" data-integration="discordRichPresence" ${discordRichPresence ? 'checked' : ''} ${!status.supported ? 'disabled' : ''}/><span></span></label></div>
      </div>
      <div class="integration-note"><i></i><span><strong>${escapeHtml(status.reason || 'Discord Rich Presence is ready to configure.')}</strong> ${status.supported ? 'Start Discord Desktop, save a valid Application ID, then enable the switch. Eclipse sends only the Open Eclipse activity through Discord’s local IPC connection.' : 'The browser preview never attempts a Discord connection.'}</span><button class="text-button" type="button" data-action="refresh-discord">Refresh status <span>→</span></button></div>
    </section>
  </div>`;
}

function renderSettings() {
  pageContent.innerHTML = `<div class="page-shell settings-page">
    ${pageHeader('Settings', 'Make Eclipse yours.', 'These interface preferences and your optional Eclipse profile stay on this device.', '')}
    <section class="settings-list panel"><div class="setting-row"><div><h2>Reduce interface motion</h2><p>Minimize hover movement and visual transitions.</p></div><label class="toggle"><input type="checkbox" data-setting="reducedMotion" ${state.settings.reducedMotion ? 'checked' : ''}/><span></span></label></div><div class="setting-row"><div><h2>Compact game cards</h2><p>Fit more official Roblox experiences on Discover and Library.</p></div><label class="toggle"><input type="checkbox" data-setting="compactCards" ${state.settings.compactCards ? 'checked' : ''}/><span></span></label></div><div class="setting-row account-setting"><div><p class="section-kicker">Local identity</p><h2>${escapeHtml(state.profile.created ? state.profile.displayName : 'No Eclipse profile yet')}</h2><p>${state.profile.created ? 'This profile is stored locally in Eclipse. It is not connected to Roblox or an online account.' : 'Create a local Eclipse profile without an email, password, or Roblox account.'}</p></div><button class="quiet-button" type="button" data-profile-action="open">${state.profile.created ? 'Edit profile' : 'Create profile'}</button></div></section>
  </div>`;
}

function updateWindowTab() {
  const labels = { home: 'Home', discover: 'Discover', library: 'Library', community: 'Community', tools: 'Tools', fastflags: 'Fast Flags', integrations: 'Integrations', settings: 'Settings' };
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
  else if (state.page === 'community') renderCommunity();
  else if (state.page === 'tools') renderTools();
  else if (state.page === 'fastflags') renderFastFlags();
  else if (state.page === 'integrations') renderIntegrations();
  else if (state.page === 'settings') renderSettings();
  else renderHome();
  pageContent.focus({ preventScroll: true });
}

function setPage(page) {
  if (!['home', 'discover', 'library', 'community', 'tools', 'fastflags', 'integrations', 'settings'].includes(page)) return;
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
    if (game) addRecent(game);
    showToast('Asked Roblox Player to launch. If it is not installed, use Player tools to download it.');
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
  if (action === 'community-auth-mode') {
    state.community.authMode = button.dataset.communityAuthMode === 'register' ? 'register' : 'login';
    state.community.authError = '';
    renderCommunity();
  }
  if (action === 'community-logout') await logoutCommunity();
  if (action === 'bootstrapper-update') await updateRobloxPlayer();
  if (action === 'community-resend-verification') {
    try {
      await communityApi.resendVerification();
      showToast('A new Eclipse account verification email was sent.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The verification email could not be sent.');
    }
  }
  if (action === 'community-send-message-request') await sendCommunityMessageRequest(button.dataset.communityUsername);
  if (action === 'community-respond-request') await respondToCommunityRequest(button.dataset.requestId, button.dataset.requestAction);
  if (action === 'select-community-chat') {
    const username = button.dataset.communityChat;
    if (state.community.chats.chats.some((contact) => contact.username === username)) {
      state.community.selectedChat = username;
      state.community.messages = [];
      state.community.placeInvites = [];
      await loadCommunityMessages(username);
    }
  }
  if (action === 'community-block') await blockCommunityUser(button.dataset.communityUsername);
  if (action === 'refresh-discord') await refreshDiscordStatus();
  if (action === 'launch-game') await launchGame(button.dataset.placeId);
  if (action === 'open-game') await openOfficial('game', button.dataset.placeId);
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
  if (action === 'remove-game') {
    removeGame(button.dataset.universeId);
    renderLibrary();
    showToast('Removed from your local Eclipse library.');
  }
  if (action === 'refresh-discover') await loadDiscover({ resetToPopular: !state.discover.query });
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
    updateFastFlagsPanel();
  }
  if (action === 'fastflag-reset') await resetFastFlags();
});

document.addEventListener('submit', async (event) => {
  if (event.target.matches('[data-profile-form]')) {
    event.preventDefault();
    saveEclipseProfile(event.target);
    return;
  }
  if (event.target.matches('[data-community-auth-form]')) {
    event.preventDefault();
    await submitCommunityAuth(event.target);
    return;
  }
  if (event.target.matches('[data-community-lookup-form]')) {
    event.preventDefault();
    await lookupCommunityUser(event.target);
    return;
  }
  if (event.target.matches('[data-community-send-message-form]')) {
    event.preventDefault();
    await sendCommunityMessage(event.target);
    return;
  }
  if (event.target.matches('[data-community-send-invite-form]')) {
    event.preventDefault();
    await sendCommunityPlaceInvite(event.target);
    return;
  }
  if (event.target.matches('[data-community-report-form]')) {
    event.preventDefault();
    await reportCommunityUser(event.target);
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
  const profileImageInput = event.target.closest('[data-profile-image-input]');
  if (profileImageInput) {
    setPendingProfileImage(profileImageInput.files?.[0]);
    return;
  }
  const fastFlagInput = event.target.closest('[data-fastflag-field]');
  if (fastFlagInput) {
    state.fastFlags[fastFlagInput.dataset.fastflagField] = fastFlagInput.type === 'checkbox' ? fastFlagInput.checked : fastFlagInput.dataset.fastflagType === 'string' ? fastFlagInput.value : Number(fastFlagInput.value);
    updateFastFlagsPanel();
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
  const integrationInput = event.target.closest('[data-integration]');
  if (integrationInput) {
    const field = integrationInput.dataset.integration;
    if (!['activityTracking', 'discordRichPresence'].includes(field)) return;
    state.integrations[field] = integrationInput.type === 'checkbox' ? integrationInput.checked : integrationInput.value;
    saveIntegrations();
    await syncDiscordPresence({ render: true });
    const messages = {
      activityTracking: state.integrations.activityTracking ? 'Local activity tracking enabled.' : 'Local activity tracking paused.',
      discordRichPresence: state.integrations.discordRichPresence ? 'Discord Rich Presence enabled. Eclipse will show Open Eclipse when Discord Desktop connects.' : 'Discord Rich Presence disabled and cleared.'
    };
    showToast(messages[field]);
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
