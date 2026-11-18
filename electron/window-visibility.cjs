function isUsableWindow(window) {
  return Boolean(window) && typeof window.isDestroyed === 'function' && !window.isDestroyed();
}

function revealWindow(window) {
  if (!isUsableWindow(window)) return false;
  try {
    if (typeof window.isMinimized === 'function' && window.isMinimized() && typeof window.restore === 'function') {
      window.restore();
    }
    if (typeof window.setSkipTaskbar === 'function') window.setSkipTaskbar(false);
    if (typeof window.show === 'function') window.show();
    if (typeof window.focus === 'function') window.focus();
    return true;
  } catch {
    return false;
  }
}

module.exports = { isUsableWindow, revealWindow };
