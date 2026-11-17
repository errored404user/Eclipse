'use strict';

const pageTitles = {
  overview: 'Good to see you.',
  profiles: 'Profiles',
  library: 'Library',
  fastflags: 'Guarded FastFlags',
  settings: 'Settings'
};

let dashboard;
let initializedPage = false;
let pendingPlaceId = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function showToast(message, type = 'success') {
  if (type === 'success' && dashboard?.state?.settings?.notifications === false) {
    return;
  }

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

function setPage(pageName, { persist = true } = {}) {
  if (!pageTitles[pageName]) return;

  $$('[data-page]').forEach((page) => {
    const active = page.dataset.page === pageName;
    page.hidden = !active;
    page.classList.toggle('is-active', active);
  });
  $$('[data-page-target]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.pageTarget === pageName);
  });
  $('#page-title').textContent = pageTitles[pageName];

  if (persist && dashboard?.state.settings.rememberLastPage) {
    window.eclipse.setLastPage(pageName).then((state) => {
      dashboard.state = state;
    }).catch(() => {
      // Page persistence should never prevent local navigation.
    });
  }
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

function sortFavorites(favorites) {
  const ordered = [...favorites];
  if (dashboard.state.settings.librarySort === 'title') {
    return ordered.sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }));
  }

  return ordered.sort((left, right) => Date.parse(right.addedAt) - Date.parse(left.addedAt));
}

function renderFavorites() {
  const favorites = sortFavorites(dashboard.state.favorites);
  $('#favorite-count').textContent = `${favorites.length} saved`;
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
    const idLabel = dashboard.state.settings.showExperienceId ? `Experience ID ${favorite.placeId} · ` : '';
    meta.textContent = `${idLabel}Saved ${formatDate(favorite.addedAt)}`;
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

function renderInstallation() {
  const { diagnostics } = dashboard;
  const { installation, ready } = diagnostics;
  const status = $('#client-status');
  status.classList.toggle('is-ready', ready);
  status.classList.toggle('is-warning', !ready);
  status.replaceChildren();
  status.append(document.createElement('span'), document.createTextNode(ready ? 'Client detected' : 'Setup required'));

  $('#sidebar-readiness').textContent = ready ? 'Official client ready' : 'Setup required';
  const heroReadiness = $('#hero-readiness');
  heroReadiness.classList.toggle('is-ready', ready);
  heroReadiness.replaceChildren(document.createElement('i'), document.createTextNode(ready ? 'Official client ready' : 'Setup required'));
  $('#installation-heading').textContent = ready ? 'Roblox Player detected' : 'Roblox Player not detected';
  $('#installation-copy').textContent = installation.message;
  $('#quick-launch-button').disabled = !ready;
  $('#quick-place-id').disabled = !ready;
  $('#launch-gate-copy').textContent = ready
    ? 'Eclipse opens the official Roblox experience page in your default browser.'
    : 'Install the official Roblox Player, then select “Check again” to unlock launches.';

  const gate = $('#installation-gate');
  gate.hidden = ready;
  document.body.classList.toggle('setup-required', !ready);
  $('#setup-copy').textContent = ready
    ? 'The official Roblox Player is ready. Eclipse can now open official experience pages.'
    : `${installation.message} Use Roblox’s official installer, then return here to check again.`;
  $('#setup-verify-step').classList.toggle('is-current', !ready);
  $('#setup-ready-step').classList.toggle('is-complete', ready);
}

function renderDiagnostics() {
  const { diagnostics } = dashboard;
  const rows = [
    ['Eclipse version', diagnostics.appVersion],
    ['Runtime', diagnostics.platform],
    ['Client status', diagnostics.installation.status.replaceAll('-', ' ')],
    ['Security', diagnostics.security]
  ];

  if (diagnostics.installation.executablePath) {
    rows.splice(3, 0, ['Detected path', diagnostics.installation.executablePath]);
  }

  const diagnosticsList = $('#diagnostics-list');
  diagnosticsList.replaceChildren();
  for (const [term, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    diagnosticsList.append(dt, dd);
  }
}

function applySettings(settings) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.accent = settings.accent;
  root.dataset.density = settings.density;
  root.dataset.fontScale = settings.fontScale;
  root.classList.toggle('reduce-motion', settings.reduceMotion);
  root.classList.toggle('high-contrast', settings.highContrast);
  root.classList.toggle('focus-mode', settings.focusMode);

  $$('[data-setting]').forEach((control) => {
    const value = settings[control.dataset.setting];
    if (control.type === 'checkbox') {
      control.checked = value === true;
    } else {
      control.value = value;
    }
  });
}

function renderFastFlags() {
  const fastFlags = dashboard.fastFlags;
  const controlsDisabled = !dashboard.diagnostics.ready || !fastFlags.available || fastFlags.blocked;
  const preferences = fastFlags.preferences;

  document.querySelectorAll('[data-fastflag]').forEach((control) => {
    const key = control.dataset.fastflag;
    if (key === 'grassMotion') {
      control.checked = preferences.grassMotion === 'minimized';
    } else if (control.type === 'checkbox') {
      control.checked = preferences[key] === true;
    } else {
      control.value = preferences[key];
    }
    control.disabled = controlsDisabled;
  });
  $('#fastflag-apply').disabled = controlsDisabled;
  $('[data-action="reset-fastflags"]').disabled = controlsDisabled;

  const status = $('#fastflag-status');
  status.classList.toggle('is-ready', fastFlags.available && !fastFlags.blocked && dashboard.diagnostics.ready);
  status.classList.toggle('is-warning', controlsDisabled);
  const statusTitle = !fastFlags.available
    ? 'Windows ClientSettings unavailable'
    : fastFlags.blocked
      ? 'ClientSettings requires attention'
      : !dashboard.diagnostics.ready
        ? 'Install Roblox before applying settings'
        : 'Guarded configuration ready';
  const statusCopy = !dashboard.diagnostics.ready
    ? 'Eclipse will not write overrides until it detects the official Roblox Player.'
    : fastFlags.message;
  status.replaceChildren(document.createElement('span'), (() => {
    const detail = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = statusTitle;
    const copy = document.createElement('small');
    copy.textContent = statusCopy;
    detail.append(title, copy);
    return detail;
  })());

  $('#fastflag-status-heading').textContent = fastFlags.blocked ? 'Configuration blocked' : 'ClientSettings status';
  const details = $('#fastflag-details');
  details.replaceChildren();
  const rows = [
    ['Configuration', fastFlags.configExists ? 'Existing file found' : 'Will be created on apply'],
    ['Backup', fastFlags.backupExists ? 'Latest Eclipse backup available' : 'No Eclipse backup yet'],
    ['Managed overrides', fastFlags.hasManagedOverrides ? 'Active' : 'Roblox defaults'],
    ['Other entries', String(fastFlags.unmanagedFlagCount)]
  ];
  for (const [term, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    details.append(dt, dd);
  }

  const issues = $('#fastflag-issues');
  issues.replaceChildren();
  if (fastFlags.issues.length === 0) {
    issues.hidden = true;
  } else {
    const heading = document.createElement('strong');
    heading.textContent = 'Review needed before applying changes';
    const list = document.createElement('ul');
    for (const issue of fastFlags.issues) {
      const item = document.createElement('li');
      item.textContent = issue;
      list.append(item);
    }
    issues.append(heading, list);
    issues.hidden = false;
  }
}

function getFastFlagPreferences() {
  const preferences = {};
  document.querySelectorAll('[data-fastflag]').forEach((control) => {
    const key = control.dataset.fastflag;
    if (key === 'grassMotion') {
      preferences.grassMotion = control.checked ? 'minimized' : 'roblox-default';
    } else if (control.type === 'checkbox') {
      preferences[key] = control.checked;
    } else {
      preferences[key] = control.value;
    }
  });
  return preferences;
}

function renderSettings() {
  applySettings(dashboard.state.settings);
}

function render() {
  renderProfiles();
  renderFavorites();
  renderInstallation();
  renderDiagnostics();
  renderFastFlags();
  renderSettings();
}

async function refreshDashboard({ initializePage = false } = {}) {
  dashboard = await window.eclipse.getDashboard();
  render();

  if (initializePage || !initializedPage) {
    const { settings, ui } = dashboard.state;
    setPage(settings.rememberLastPage ? ui.lastPage : settings.startPage, { persist: false });
    initializedPage = true;
  }
}

async function runOperation(operation, successMessage) {
  try {
    await operation();
    await refreshDashboard();
    if (successMessage) showToast(successMessage);
    return true;
  } catch (error) {
    showToast(error?.message || 'Eclipse could not complete that action.', 'error');
    return false;
  }
}

function showLaunchConfirmation(placeId) {
  pendingPlaceId = String(placeId);
  $('#confirm-copy').textContent = `Eclipse will open Roblox experience ID ${pendingPlaceId} through the official Roblox page in your default browser.`;
  $('#launch-confirmation').hidden = false;
}

function closeLaunchConfirmation() {
  pendingPlaceId = null;
  $('#launch-confirmation').hidden = true;
}

async function requestLaunch(placeId) {
  if (!dashboard.diagnostics.ready) {
    showToast('Install the official Roblox Player before launching an experience.', 'error');
    return;
  }

  if (dashboard.state.settings.confirmLaunch) {
    showLaunchConfirmation(placeId);
    return;
  }

  await runOperation(() => window.eclipse.launchExperience(placeId), 'Opening the official Roblox experience page.');
}

async function refreshInstallation() {
  try {
    await refreshDashboard();
    if (dashboard.diagnostics.ready) {
      showToast('Official Roblox Player detected. Launches are unlocked.');
    } else {
      showToast('Roblox Player is not detected yet. Complete the official installer, then check again.', 'error');
    }
  } catch (error) {
    showToast(error?.message || 'Eclipse could not refresh the installation check.', 'error');
  }
}

$('#quick-launch-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await requestLaunch($('#quick-place-id').value);
});

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const succeeded = await runOperation(() => window.eclipse.createProfile(Object.fromEntries(form)), 'Local profile created.');
  if (succeeded) event.currentTarget.reset();
});

$('#favorite-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const succeeded = await runOperation(() => window.eclipse.addFavorite(Object.fromEntries(form)), 'Experience saved to your library.');
  if (succeeded) event.currentTarget.reset();
});

$('#fastflags-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!dashboard.diagnostics.ready) {
    showToast('Install the official Roblox Player before applying FastFlags.', 'error');
    return;
  }
  await runOperation(() => window.eclipse.applyFastFlags(getFastFlagPreferences()), 'Reviewed FastFlags saved. Restart Roblox to apply them.');
});

$$('[data-setting]').forEach((control) => {
  control.addEventListener('change', (event) => {
    const key = event.currentTarget.dataset.setting;
    const value = event.currentTarget.type === 'checkbox' ? event.currentTarget.checked : event.currentTarget.value;
    runOperation(() => window.eclipse.updateSettings({ [key]: value }), 'Preference saved.');
  });
});

document.querySelector('[data-window-drag]').addEventListener('dblclick', () => {
  window.eclipse.toggleMaximizeWindow();
});

document.addEventListener('click', (event) => {
  const control = event.target.closest('[data-window-action]');
  if (!control) return;

  event.preventDefault();
  if (control.dataset.windowAction === 'minimize') window.eclipse.minimizeWindow();
  if (control.dataset.windowAction === 'maximize') window.eclipse.toggleMaximizeWindow();
  if (control.dataset.windowAction === 'close') window.eclipse.closeWindow();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#launch-confirmation').hidden) {
    closeLaunchConfirmation();
  }
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
  if (action === 'open-download') runOperation(() => window.eclipse.openRobloxDownload(), 'Opening Roblox’s official download page.');
  if (action === 'open-catalog') runOperation(() => window.eclipse.openRobloxCatalog(), 'Opening the official Roblox catalog.');
  if (action === 'refresh-installation') refreshInstallation();
  if (action === 'launch-experience') requestLaunch(trigger.dataset.placeId);
  if (action === 'remove-profile') runOperation(() => window.eclipse.removeProfile(trigger.dataset.profileId), 'Profile removed.');
  if (action === 'remove-favorite') runOperation(() => window.eclipse.removeFavorite(trigger.dataset.placeId), 'Experience removed from your library.');
  if (action === 'reset-settings') runOperation(() => window.eclipse.resetSettings(), 'Preferences restored to defaults.');
  if (action === 'open-fastflag-reference') runOperation(() => window.eclipse.openFastFlagReference(), 'Opening Roblox FastFlag guidance.');
  if (action === 'reset-fastflags') runOperation(() => window.eclipse.resetFastFlags(), 'Eclipse-managed FastFlags removed. Restart Roblox to use its defaults.');
  if (action === 'cancel-launch') closeLaunchConfirmation();
  if (action === 'confirm-launch' && pendingPlaceId) {
    const placeId = pendingPlaceId;
    closeLaunchConfirmation();
    runOperation(() => window.eclipse.launchExperience(placeId), 'Opening the official Roblox experience page.');
  }
});

refreshDashboard({ initializePage: true }).catch((error) => {
  showToast(error?.message || 'Eclipse could not load its local dashboard.', 'error');
});
