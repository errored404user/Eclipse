const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eclipseWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, isMaximized) => callback(Boolean(isMaximized));
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  }
});

contextBridge.exposeInMainWorld('eclipseRoblox', {
  listGames: (request = {}) => ipcRenderer.invoke('roblox:list-games', {
    query: typeof request.query === 'string' ? request.query : '',
    cursor: typeof request.cursor === 'string' ? request.cursor : ''
  }),
  launchPlace: (placeId) => ipcRenderer.invoke('roblox:launch-place', placeId),
  openOfficial: (action, placeId) => ipcRenderer.invoke('roblox:open-official', action, placeId)
});
