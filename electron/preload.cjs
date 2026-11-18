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

contextBridge.exposeInMainWorld('eclipseBootstrapper', {
  status: () => ipcRenderer.invoke('roblox-bootstrapper:status'),
  update: () => ipcRenderer.invoke('roblox-bootstrapper:update'),
  onProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('roblox-bootstrapper:progress', listener);
    return () => ipcRenderer.removeListener('roblox-bootstrapper:progress', listener);
  }
});

contextBridge.exposeInMainWorld('eclipseFastFlags', {
  getStatus: () => ipcRenderer.invoke('fastflags:status'),
  apply: (options = {}) => ipcRenderer.invoke('fastflags:apply', options),
  reset: () => ipcRenderer.invoke('fastflags:reset')
});

contextBridge.exposeInMainWorld('eclipseDiscord', {
  status: () => ipcRenderer.invoke('discord:status'),
  configure: (options = {}) => ipcRenderer.invoke('discord:configure', {
    applicationId: typeof options.applicationId === 'string' ? options.applicationId : '',
    enabled: options.enabled === true
  }),
  onStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('discord:status', listener);
    return () => ipcRenderer.removeListener('discord:status', listener);
  }
});

contextBridge.exposeInMainWorld('eclipseCommunity', {
  status: () => ipcRenderer.invoke('community:status'),
  register: (details = {}) => ipcRenderer.invoke('community:register', details),
  login: (details = {}) => ipcRenderer.invoke('community:login', details),
  logout: () => ipcRenderer.invoke('community:logout'),
  me: () => ipcRenderer.invoke('community:me'),
  resendVerification: () => ipcRenderer.invoke('community:resend-verification'),
  chats: () => ipcRenderer.invoke('community:chats'),
  lookup: (username) => ipcRenderer.invoke('community:lookup', username),
  requestChat: (username) => ipcRenderer.invoke('community:request-chat', username),
  respondToMessageRequest: (id, action) => ipcRenderer.invoke('community:respond-message-request', id, action),
  conversation: (contact) => ipcRenderer.invoke('community:conversation', contact),
  sendMessage: (contact, body) => ipcRenderer.invoke('community:send-message', contact, body),
  sendPlaceInvite: (contact, placeId) => ipcRenderer.invoke('community:send-place-invite', contact, placeId),
  block: (username) => ipcRenderer.invoke('community:block', username),
  report: (details = {}) => ipcRenderer.invoke('community:report', details)
});
