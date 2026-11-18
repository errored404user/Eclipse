const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eclipsePlayerLaunch', {
  dismiss: () => ipcRenderer.invoke('player-launch:dismiss'),
  onUpdate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('player-launch:update', listener);
    return () => ipcRenderer.removeListener('player-launch:update', listener);
  }
});
