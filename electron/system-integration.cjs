const navigationPages = Object.freeze(['home', 'discover', 'library', 'history', 'tools', 'optimization', 'fastflags', 'mods', 'integrations', 'accounts', 'settings']);

function navigationPage(value) {
  const page = String(value || '').trim().toLowerCase();
  return navigationPages.includes(page) ? page : '';
}

function navigationPageFromArguments(argumentsList = []) {
  for (const argument of argumentsList) {
    const match = /^--eclipse-page=([a-z-]+)$/i.exec(String(argument || ''));
    const page = navigationPage(match?.[1]);
    if (page) return page;
  }
  return '';
}

function placeIdFromArguments(argumentsList = []) {
  for (const argument of argumentsList) {
    const match = /^--eclipse-place=(\d{1,15})$/i.exec(String(argument || ''));
    const placeId = Number(match?.[1]);
    if (Number.isSafeInteger(placeId) && placeId > 0) return placeId;
  }
  return 0;
}

function taskbarTasks(executablePath) {
  if (!executablePath) return [];
  return [
    ['Home', 'home', 'Open Eclipse Home'],
    ['Discover Roblox', 'discover', 'Browse official Roblox experiences in Eclipse'],
    ['Your Library', 'library', 'Open your local Eclipse library'],
    ['Local Mods', 'mods', 'Manage local validated Player packs'],
    ['Player Tools', 'tools', 'Open official Roblox Player tools']
  ].map(([title, page, description]) => ({
    program: executablePath,
    arguments: `--eclipse-page=${page}`,
    iconPath: executablePath,
    iconIndex: 0,
    title,
    description
  }));
}

function taskbarJumpList(executablePath, recentPlaceIds = []) {
  const recents = [...new Set(recentPlaceIds.map(Number).filter((placeId) => Number.isSafeInteger(placeId) && placeId > 0))].slice(0, 6)
    .map((placeId) => ({
      program: executablePath,
      arguments: `--eclipse-page=tools --eclipse-place=${placeId}`,
      iconPath: executablePath,
      iconIndex: 0,
      title: `Place ${placeId}`,
      description: 'Repeat an Eclipse handoff to this Roblox place'
    }));
  return [
    { type: 'custom', name: 'Eclipse destinations', items: taskbarTasks(executablePath) },
    ...(recents.length ? [{ type: 'custom', name: 'Recent Eclipse handoffs', items: recents }] : [])
  ];
}

function startupStatus({ platform = process.platform, isPackaged = false, loginItemSettings = {} } = {}) {
  if (platform !== 'win32') return { supported: false, enabled: false, reason: 'Launch on startup is available in the packaged Windows app.' };
  if (!isPackaged) return { supported: false, enabled: false, reason: 'Launch on startup is available after Eclipse is installed or packaged for Windows.' };
  return { supported: true, enabled: loginItemSettings.openAtLogin === true, reason: '' };
}

module.exports = {
  navigationPage,
  navigationPageFromArguments,
  navigationPages,
  placeIdFromArguments,
  startupStatus,
  taskbarJumpList,
  taskbarTasks
};
