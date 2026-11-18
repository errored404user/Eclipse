const path = require('node:path');

const launchStates = Object.freeze({
  checking: Object.freeze({
    label: 'Checking Roblox Player…',
    detail: 'Eclipse is checking the official Windows Player release.',
    progress: 12,
    tone: 'active'
  }),
  downloading: Object.freeze({
    label: 'Updating Roblox Player…',
    detail: 'Downloading the official signed Roblox installer.',
    progress: 30,
    tone: 'active'
  }),
  verifying: Object.freeze({
    label: 'Verifying Roblox Player…',
    detail: 'Checking the Windows signature before installation.',
    progress: 48,
    tone: 'active'
  }),
  installing: Object.freeze({
    label: 'Installing Roblox Player…',
    detail: 'The official Roblox installer is updating the Player.',
    progress: 64,
    tone: 'active'
  }),
  finalizing: Object.freeze({
    label: 'Finalizing Roblox Player…',
    detail: 'Confirming the installed Roblox Player version.',
    progress: 77,
    tone: 'active'
  }),
  starting: Object.freeze({
    label: 'Starting Roblox Player…',
    detail: 'Preparing your official Roblox Player handoff.',
    progress: 26,
    tone: 'active'
  }),
  connecting: Object.freeze({
    label: 'Connecting to Roblox…',
    detail: 'Roblox Player has received the selected experience.',
    progress: 72,
    tone: 'active'
  }),
  complete: Object.freeze({
    label: 'Roblox Player is opening',
    detail: 'Eclipse has completed the handoff. Roblox Player now manages the connection.',
    progress: 100,
    tone: 'complete'
  }),
  error: Object.freeze({
    label: 'Roblox Player could not be opened',
    detail: 'Confirm that Roblox Player is installed, then try again.',
    progress: 0,
    tone: 'error'
  })
});

function createPlayerLaunchWindow(BrowserWindow, parent) {
  const launchWindow = new BrowserWindow({
    width: 536,
    height: 322,
    minWidth: 536,
    minHeight: 322,
    maxWidth: 536,
    maxHeight: 322,
    parent,
    modal: Boolean(parent),
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    icon: path.join(__dirname, '..', 'app', 'assets', 'eclipse-icon.png'),
    backgroundColor: '#101011',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'launch-preload.cjs')
    }
  });

  launchWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  launchWindow.loadFile(path.join(__dirname, 'launch.html'));

  const ready = new Promise((resolve) => {
    launchWindow.once('ready-to-show', () => {
      if (!launchWindow.isDestroyed()) launchWindow.show();
      resolve();
    });
  });

  return { window: launchWindow, ready };
}

function sendLaunchState(launchWindow, name) {
  const state = launchStates[name];
  if (!state || !launchWindow || launchWindow.isDestroyed()) return;
  launchWindow.webContents.send('player-launch:update', { name, ...state });
}

module.exports = { createPlayerLaunchWindow, launchStates, sendLaunchState };
