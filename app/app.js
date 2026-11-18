const toast = document.querySelector('[data-toast]');
const pageContent = document.querySelector('[data-page-content]');
const sidebar = document.querySelector('[data-sidebar]');
const desktopWindow = window.eclipseWindow;
const storageKeys = {
  library: 'eclipse.roblox.library.v1',
  recent: 'eclipse.roblox.recent.v1',
  settings: 'eclipse.settings.v1'
};

const state = {
  page: 'home',
  library: readStored(storageKeys.library, []),
  recent: readStored(storageKeys.recent, []),
  settings: { reducedMotion: false, compactCards: false, ...readStored(storageKeys.settings, {}) },
  discover: { games: [], query: '', cursor: '', loading: false, error: '' }
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
      login: 'https://www.roblox.com/login',
      download: 'https://www.roblox.com/download',
      game: `https://www.roblox.com/games/${encodeURIComponent(placeId)}`
    };
    const url = urls[action];
    if (!url) throw new Error('Unsupported Roblox action.');
    window.open(url, '_blank', 'noopener,noreferrer');
    return { opened: true };
  }
};

const roblox = window.eclipseRoblox || browserRoblox;
let toastTimer;

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

function allKnownGames() {
  const games = [...state.discover.games, ...state.library, ...state.recent];
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
      <article class="utility-panel panel"><span class="utility-symbol">◈</span><div><p class="section-kicker">Account safety</p><h3>Sign in only with Roblox</h3><p>Eclipse never asks for or stores your Roblox password.</p></div><button class="text-button" type="button" data-account-action="login">Sign in <span>→</span></button></article>
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
      <div class="discovery-toolbar"><span><i></i>${state.discover.query ? `Search results for “${escapeHtml(state.discover.query)}”` : 'Popular experiences from Roblox'}</span><button class="quiet-button compact-button" type="button" data-action="refresh-discover">Refresh</button></div>
    </section>
    <div class="discovery-feature" data-discovery-feature></div>
    <section class="content-section"><div class="section-heading"><div><p class="section-kicker">${state.discover.query ? 'Search results' : 'Trending now'}</p><h2>${state.discover.query ? 'Official matches' : 'Popular on Roblox'}</h2></div></div><div class="game-grid" data-game-grid></div><div class="discover-footer" data-discover-footer></div></section>
  </div>`;
  updateDiscoverView();
  if (!state.discover.games.length) loadDiscover();
}

function updateDiscoverView() {
  const feature = pageContent.querySelector('[data-discovery-feature]');
  const grid = pageContent.querySelector('[data-game-grid]');
  const footer = pageContent.querySelector('[data-discover-footer]');
  if (!feature || !grid || !footer) return;

  if (state.discover.loading && !state.discover.games.length) {
    feature.innerHTML = '';
    grid.innerHTML = Array.from({ length: 8 }, () => '<article class="game-card skeleton-card panel"><div></div><span></span><span></span></article>').join('');
    footer.innerHTML = '<p class="section-note">Loading live Roblox discovery…</p>';
    return;
  }
  if (state.discover.error) {
    feature.innerHTML = '';
    grid.innerHTML = '';
    footer.innerHTML = emptyState('!', 'Roblox discovery is unavailable.', state.discover.error, '<button class="primary-button" type="button" data-action="refresh-discover">Try again</button>');
    return;
  }
  if (!state.discover.games.length) {
    feature.innerHTML = '';
    grid.innerHTML = '';
    footer.innerHTML = emptyState('○', 'No official Roblox experiences found.', 'Try another search term or refresh the popular experience list.', '<button class="primary-button" type="button" data-action="refresh-discover">Show popular games</button>');
    return;
  }

  feature.innerHTML = state.discover.query ? '' : featuredGame(state.discover.games[0]);
  const listedGames = state.discover.query ? state.discover.games : state.discover.games.slice(1);
  grid.innerHTML = listedGames.map((game) => gameCard(game)).join('');
  footer.innerHTML = state.discover.nextCursor
    ? `<button class="quiet-button" type="button" data-action="load-more" ${state.discover.loading ? 'disabled' : ''}>${state.discover.loading ? 'Loading…' : 'Load more results'}</button>`
    : '<p class="section-note">Discovery data is supplied by Roblox. Availability and rankings can change at any time.</p>';
}

async function loadDiscover({ append = false, resetToPopular = false } = {}) {
  if (state.discover.loading) return;
  if (resetToPopular) {
    state.discover.query = '';
    state.discover.cursor = '';
    state.discover.games = [];
  }
  state.discover.loading = true;
  state.discover.error = '';
  updateDiscoverView();
  try {
    const result = await roblox.listGames({ query: state.discover.query, cursor: append ? state.discover.cursor : '' });
    const games = Array.isArray(result.games) ? result.games.map(normalizeGame).filter(Boolean) : [];
    state.discover.games = append
      ? [...new Map([...state.discover.games, ...games].map((game) => [game.universeId, game])).values()]
      : games;
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
    ${pageHeader('Your library', 'Saved Roblox experiences.', 'Library items are official Roblox places you saved in Eclipse. They are stored locally on this device.', '<button class="primary-button" type="button" data-page-link="discover">Discover games</button>')}
    <section class="content-section"><div class="section-heading"><div><p class="section-kicker">Saved locally</p><h2>${state.library.length ? `${state.library.length} saved ${state.library.length === 1 ? 'experience' : 'experiences'}` : 'Nothing saved yet'}</h2></div></div>
    ${state.library.length ? `<div class="game-grid">${state.library.map((game) => gameCard(game, { library: true })).join('')}</div>` : emptyState('◇', 'Save official games you want to revisit.', 'Open Discover to browse live Roblox experiences, then use the plus button on a game card to add it here.', '<button class="primary-button" type="button" data-page-link="discover">Open Discover</button>')}</section>
  </div>`;
}

function renderTools() {
  pageContent.innerHTML = `<div class="page-shell tools-page">
    ${pageHeader('Player tools', 'Launch Roblox Player.', 'Eclipse asks the installed Roblox Player to open an official experience. Roblox manages the account session and gameplay.', '')}
    <div class="tools-grid">
      <article class="tool-panel panel"><p class="section-kicker"><i></i> Direct launch</p><h2>Start an official place</h2><p>Paste a Roblox place ID. Eclipse validates it, then opens Roblox Player using the official Roblox protocol.</p><form class="place-form" data-place-form><label for="place-id">Roblox place ID</label><div><input id="place-id" name="placeId" inputmode="numeric" pattern="[0-9]+" placeholder="Example: 1818" required /><button class="primary-button" type="submit"><span class="play-icon"></span> Launch</button></div></form><p class="form-note">No Roblox password is requested or stored.</p></article>
      <article class="tool-panel panel"><p class="section-kicker">Account</p><h2>Use an existing Roblox account</h2><p>Eclipse does not create Roblox accounts. Sign in through Roblox’s official website, then the installed Roblox Player uses that account when it launches.</p><div class="stacked-actions"><button class="quiet-button" type="button" data-account-action="login">Sign in at Roblox</button><button class="text-button" type="button" data-account-action="download">Get Roblox Player <span>→</span></button></div></article>
      <article class="tool-panel panel tool-wide"><p class="section-kicker">How it works</p><ol class="protocol-list"><li><span>1</span><p>Sign in to your Roblox account through Roblox’s official site or installed Player.</p></li><li><span>2</span><p>Choose a live game from Discover or paste a trusted place ID.</p></li><li><span>3</span><p>Eclipse opens <code>roblox://experiences/start?placeId=…</code> and Roblox Player handles the launch.</p></li></ol></article>
    </div>
  </div>`;
}

function renderSettings() {
  pageContent.innerHTML = `<div class="page-shell settings-page">
    ${pageHeader('Settings', 'Make Eclipse yours.', 'These interface preferences stay on this device. Roblox account credentials are never part of Eclipse settings.', '')}
    <section class="settings-list panel"><div class="setting-row"><div><h2>Reduce interface motion</h2><p>Minimize hover movement and visual transitions.</p></div><label class="toggle"><input type="checkbox" data-setting="reducedMotion" ${state.settings.reducedMotion ? 'checked' : ''}/><span></span></label></div><div class="setting-row"><div><h2>Compact game cards</h2><p>Fit more official Roblox experiences on Discover and Library.</p></div><label class="toggle"><input type="checkbox" data-setting="compactCards" ${state.settings.compactCards ? 'checked' : ''}/><span></span></label></div><div class="setting-row account-setting"><div><p class="section-kicker">Account privacy</p><h2>Roblox credentials stay with Roblox</h2><p>Eclipse opens only Roblox’s official sign-in page and does not store cookies, passwords, or authentication tokens.</p></div><button class="quiet-button" type="button" data-account-action="login">Official sign-in</button></div></section>
  </div>`;
}

function updateWindowTab() {
  const labels = { home: 'Home', discover: 'Discover', library: 'Library', tools: 'Tools', settings: 'Settings' };
  const label = labels[state.page] || 'Home';
  const target = document.querySelector('[data-active-page]');
  if (target) target.textContent = label;
  document.title = `Eclipse — ${label}`;
}

function renderCurrentPage() {
  setSettings();
  updateWindowTab();
  if (state.page === 'discover') renderDiscover();
  else if (state.page === 'library') renderLibrary();
  else if (state.page === 'tools') renderTools();
  else if (state.page === 'settings') renderSettings();
  else renderHome();
  pageContent.focus({ preventScroll: true });
}

function setPage(page) {
  if (!['home', 'discover', 'library', 'tools', 'settings'].includes(page)) return;
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
    const messages = { login: 'Opening Roblox’s official sign-in page.', download: 'Opening the official Roblox Player download page.', game: 'Opening the official Roblox game page.' };
    showToast(messages[action] || 'Opening Roblox.');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Roblox could not be opened.');
  }
}

function setMaximizeControl(isMaximized) {
  const button = document.querySelector('[data-window-control="maximize"]');
  if (!button) return;
  button.setAttribute('aria-label', isMaximized ? 'Restore window' : 'Maximize');
  button.textContent = isMaximized ? '❐' : '□';
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

  const accountButton = document.querySelector('[data-account-button]');
  const accountMenu = document.querySelector('[data-account-menu]');
  accountButton.addEventListener('click', () => {
    const isOpen = accountButton.getAttribute('aria-expanded') === 'true';
    accountButton.setAttribute('aria-expanded', String(!isOpen));
    accountMenu.hidden = isOpen;
  });
  document.addEventListener('click', (event) => {
    if (!accountButton.contains(event.target) && !accountMenu.contains(event.target)) {
      accountButton.setAttribute('aria-expanded', 'false');
      accountMenu.hidden = true;
    }
  });
  document.querySelector('[data-mobile-menu]').addEventListener('click', () => sidebar.classList.toggle('open'));
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const { action, accountAction, pageLink } = button.dataset;
  if (pageLink) setPage(pageLink);
  if (accountAction) await openOfficial(accountAction);
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
  if (action === 'open-status') showToast('Eclipse uses official Roblox discovery data and Player deep links.');
});

document.addEventListener('submit', async (event) => {
  if (event.target.matches('[data-discovery-form]')) {
    event.preventDefault();
    const query = new FormData(event.target).get('query');
    state.discover.query = String(query || '').trim();
    state.discover.cursor = '';
    state.discover.games = [];
    state.discover.error = '';
    updateDiscoverView();
    await loadDiscover();
  }
  if (event.target.matches('[data-place-form]')) {
    event.preventDefault();
    const placeId = String(new FormData(event.target).get('placeId') || '');
    await launchGame(placeId);
  }
});

document.addEventListener('change', (event) => {
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
