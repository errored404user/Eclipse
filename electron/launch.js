const shell = document.querySelector('.launch-shell');
const heading = document.querySelector('[data-heading]');
const detail = document.querySelector('[data-detail]');
const progress = document.querySelector('[data-progress]');
const progressbar = document.querySelector('[role="progressbar"]');
const status = document.querySelector('[data-status]');
const dismiss = document.querySelector('[data-dismiss]');

function renderLaunchState(next = {}) {
  const value = Math.max(0, Math.min(100, Number(next.progress) || 0));
  heading.textContent = String(next.label || 'Starting Roblox Player…');
  detail.textContent = String(next.detail || 'Preparing your official Roblox Player handoff.');
  progress.style.width = `${value}%`;
  progressbar.setAttribute('aria-valuenow', String(value));
  shell.classList.toggle('complete', next.tone === 'complete');
  shell.classList.toggle('error', next.tone === 'error');
  status.textContent = next.tone === 'error' ? 'Handoff unavailable' : next.tone === 'complete' ? 'Handoff complete' : 'Secure protocol';
}

if (window.eclipsePlayerLaunch) {
  window.eclipsePlayerLaunch.onUpdate(renderLaunchState);
  dismiss.addEventListener('click', () => window.eclipsePlayerLaunch.dismiss());
}
