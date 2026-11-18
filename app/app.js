const toast = document.querySelector('[data-toast]');
const desktopWindow = window.eclipseWindow;
let toastTimer;

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3600);
}

function setLaunchLoading(button) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="loading-dot" aria-hidden="true">◌</span> Preparing launch…';
  window.setTimeout(() => {
    button.disabled = false;
    button.innerHTML = original;
    showToast('Launch request prepared. Native client wiring is the next milestone.');
  }, 900);
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

wireWindowControls();

document.querySelectorAll('[data-launch]').forEach((button) => {
  button.addEventListener('click', () => setLaunchLoading(button));
});

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.remove('active');
      item.removeAttribute('aria-current');
    });
    button.classList.add('active');
    button.setAttribute('aria-current', 'page');
    const page = button.dataset.page;
    showToast(page === 'Home' ? 'You are already home.' : `${page} is mapped in the shell and ready for its dedicated page.`);
    document.querySelector('[data-sidebar]').classList.remove('open');
  });
});

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

document.querySelector('[data-mobile-menu]').addEventListener('click', () => {
  document.querySelector('[data-sidebar]').classList.toggle('open');
});

document.querySelector('[data-refresh]').addEventListener('click', () => {
  const button = document.querySelector('[data-refresh]');
  button.textContent = 'Refreshing…';
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = 'Refresh';
    button.disabled = false;
    showToast('Your Eclipse overview is current.');
  }, 650);
});

document.querySelectorAll('[data-status-button]').forEach((button) => {
  button.addEventListener('click', () => showToast('Eclipse Preview v0.1.0-preview.2 is healthy and ready to launch.'));
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const labels = {
      activity: 'Activity history will live in your Home overview.',
      friends: 'Social presence is planned for a later Home increment.',
      'release-notes': 'Release notes will open from the Eclipse update center.',
      profiles: 'Launch profiles will be available from Tools.',
      diagnostics: 'Diagnostics will be available from Tools.',
      preferences: 'Appearance controls will be available from Settings.'
    };
    showToast(labels[button.dataset.action]);
  });
});
