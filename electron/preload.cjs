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

contextBridge.exposeInMainWorld('eclipseFastFlags', {
  getStatus: () => ipcRenderer.invoke('fastflags:status'),
  apply: (options = {}) => ipcRenderer.invoke('fastflags:apply', options),
  reset: () => ipcRenderer.invoke('fastflags:reset')
});

contextBridge.exposeInMainWorld('eclipseCommunity', {
  status: () => ipcRenderer.invoke('community:status'),
  register: (details = {}) => ipcRenderer.invoke('community:register', details),
  login: (details = {}) => ipcRenderer.invoke('community:login', details),
  logout: () => ipcRenderer.invoke('community:logout'),
  me: () => ipcRenderer.invoke('community:me'),
  resendVerification: () => ipcRenderer.invoke('community:resend-verification'),
  friends: () => ipcRenderer.invoke('community:friends'),
  lookup: (username) => ipcRenderer.invoke('community:lookup', username),
  requestFriend: (username) => ipcRenderer.invoke('community:request-friend', username),
  respondFriendRequest: (id, action) => ipcRenderer.invoke('community:respond-friend-request', id, action),
  messages: (friend) => ipcRenderer.invoke('community:messages', friend),
  sendMessage: (friend, body) => ipcRenderer.invoke('community:send-message', friend, body),
  sendPlaceInvite: (friend, placeId) => ipcRenderer.invoke('community:send-place-invite', friend, placeId),
  block: (username) => ipcRenderer.invoke('community:block', username),
  report: (details = {}) => ipcRenderer.invoke('community:report', details)
});
