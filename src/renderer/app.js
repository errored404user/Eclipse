'use strict';

const pageTitles = {
  overview: 'Good to see you.',
  profiles: 'Profiles',
  library: 'Library',
  settings: 'Settings'
};

let dashboard;

const $ = (selector) => document.querySelector(selector);

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  $('#toast-region').append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function formatDate(isoString) {
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(isoString));
  } catch {
    return 'Recently';
  }
}

function setPage(pageName) {
  if (!pageTitles[pageName]) return;

  document.querySelectorAll('[data-page]').forEach((page) => {
    const active = page.dataset.page === pageName;
    page.hidden = !active;
    page.classList.toggle('is-active', active);
  });
  document.querySelectorAll('[data-page-target]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.pageTarget === pageName);
  });
  $('#page-title').textContent = pageTitles[pageName];
}

function createButton(label, action, payload, className = 'icon-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.dataset.action = action;
  Object.entries(payload).forEach(([key, value]) => { button.dataset[key] = String(value); });
  return button;
}

function renderProfiles() {
  const profiles = dashboard.state.profiles;
  $('#profile-count').textContent = `${profiles.length} ${profiles.length === 1 ? 'profile' : 'profiles'}`;
  $('#profile-list-count').textContent = String(profiles.length);
  const list = $('#profiles-list');
  list.replaceChildren();

  if (profiles.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Create a profile to keep a named local setup in Eclipse.';
    list.append(empty);
    return;
  }

  for (const profile of profiles) {
    const item = document.createElement('article');
    item.className = `list-card profile-card accent-${profile.color}`;
    const detail = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = profile.name;
    const description = document.createElement('p');
    description.textContent = profile.description || `Created ${formatDate(profile.createdAt)}`;
    detail.append(title, description);
    item.append(detail, createButton('Remove', 'remove-profile', { profileId: profile.id }));
    list.append(item);
  }
}

function renderFavorites() {
  const favorites = dashboard.state.favorites;
  $('#favorite-count').textContent = `${favorites.length} ${favorites.length === 1 ? 'saved' : 'saved'}`;
  $('#favorite-list-count').textContent = String(favorites.length);
  const list = $('#favorites-list');
  list.replaceChildren();

  if (favorites.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Save an experience ID to create a private launch shortcut.';
    list.append(empty);
    return;
  }

  for (const favorite of favorites) {
    const item = document.createElement('article');
    item.className = 'list-card favorite-card';
    const detail = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = favorite.title;
    const meta = document.createElement('p');
    meta.textContent = `Experience ID ${favorite.placeId} · Saved ${formatDate(favorite.addedAt)}`;
    detail.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'inline-actions';
    actions.append(
      createButton('Launch', 'launch-experience', { placeId: favorite.placeId }, 'text-button compact'),
      createButton('Remove', 'remove-favorite', { placeId: favorite.placeId })
    );
    item.append(detail, actions);
    list.append(item);
  }
}

function renderDiagnostics() {
  const { diagnostics } = dashboard;
  const installation = diagnostics.installation;
  const detected = installation.status === 'detected';
  const status = $('#client-status');
  status.classList.toggle('is-ready', detected);
  status.classList.toggle('is-warning', !detected);
  status.innerHTML = '<span></span>';
  status.append(document.createTextNode(detected ? 'Client detected' : 'Client not detected'));

  $('#installation-heading').textContent = detected ? 'Roblox Player detected' : 'Roblox Player not detected';
  $('#installation-copy').textContent = installation.message;

  const diagnosticsList = $('#diagnostics-list');
  diagnosticsList.replaceChildren();
  const rows = [
    ['Eclipse version', diagnostics.appVersion],
    ['Runtime', diagnostics.platform],
    ['Client status', installation.status.replaceAll('-', ' ')],
    ['Security', diagnostics.security]
  ];
  for (const [term, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    diagnosticsList.append(dt, dd);
  }
}

function renderSettings() {
  const reduceMotion = dashboard.state.settings.reduceMotion;
  $('#reduce-motion').checked = reduceMotion;
  document.documentElement.classList.toggle('reduce-motion', reduceMotion);
}

function render() {
  renderProfiles();
  renderFavorites();
  renderDiagnostics();
  renderSettings();
}

async function refreshDashboard() {
  dashboard = await window.eclipse.getDashboard();
  render();
}

async function runOperation(operation, successMessage) {
  try {
    await operation();
    await refreshDashboard();
    if (successMessage) showToast(successMessage);
  } catch (error) {
    showToast(error?.message || 'Eclipse could not complete that action.', 'error');
  }
}

$('#quick-launch-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#quick-place-id');
  await runOperation(async () => window.eclipse.launchExperience(input.value), 'Opening the official Roblox experience page.');
});

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await runOperation(async () => window.eclipse.createProfile(Object.fromEntries(form)), 'Local profile created.');
  event.currentTarget.reset();
});

$('#favorite-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await runOperation(async () => window.eclipse.addFavorite(Object.fromEntries(form)), 'Experience saved to your library.');
  event.currentTarget.reset();
});

$('#reduce-motion').addEventListener('change', (event) => {
  runOperation(async () => window.eclipse.updateSettings({ reduceMotion: event.currentTarget.checked }), 'Motion preference saved.');
});

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-action], [data-page-target]');
  if (!trigger) return;

  if (trigger.dataset.pageTarget) {
    event.preventDefault();
    setPage(trigger.dataset.pageTarget);
    return;
  }

  const action = trigger.dataset.action;
  if (action === 'open-download') runOperation(() => window.eclipse.openRobloxDownload(), 'Opening the official Roblox download page.');
  if (action === 'open-catalog') runOperation(() => window.eclipse.openRobloxCatalog(), 'Opening the official Roblox catalog.');
  if (action === 'refresh') runOperation(() => Promise.resolve(), 'Diagnostics refreshed.');
  if (action === 'launch-experience') runOperation(() => window.eclipse.launchExperience(trigger.dataset.placeId), 'Opening the official Roblox experience page.');
  if (action === 'remove-profile') runOperation(() => window.eclipse.removeProfile(trigger.dataset.profileId), 'Profile removed.');
  if (action === 'remove-favorite') runOperation(() => window.eclipse.removeFavorite(trigger.dataset.placeId), 'Experience removed from your library.');
});

refreshDashboard().catch((error) => {
  showToast(error?.message || 'Eclipse could not load its local dashboard.', 'error');
});
