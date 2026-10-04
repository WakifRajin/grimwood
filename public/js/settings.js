// Player preferences, saved in localStorage, plus the Settings dialog wiring.
const KEY = 'grimwood.settings';
const DEFAULTS = { music: 0.35, sfx: 0.7, muted: false, speed: 'normal', motion: 'full', vibrate: true };

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // migrate the older standalone speed key
    const legacySpeed = localStorage.getItem('grimwood.speed');
    if (legacySpeed && !saved.speed) saved.speed = legacySpeed;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

export function reducedMotion() {
  return settings.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// onChange(key) is called after any setting changes.
export function initSettingsUI(onChange) {
  const $ = id => document.getElementById(id);
  const dlg = $('dlg-settings');
  const set = (k, v) => { settings[k] = v; saveSettings(); onChange(k); sync(); };

  function sync() {
    $('set-music').value = Math.round(settings.music * 100);
    $('set-sfx').value = Math.round(settings.sfx * 100);
    $('set-vibrate').checked = settings.vibrate;
    for (const b of dlg.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', String(b.dataset.speed === settings.speed));
    for (const b of dlg.querySelectorAll('[data-motion]')) b.setAttribute('aria-pressed', String(b.dataset.motion === settings.motion));
    document.documentElement.classList.toggle('reduce-motion', settings.motion === 'reduced');
    const icon = $('btn-sound').querySelector('use');
    icon.setAttribute('href', settings.muted ? '#i-mute' : '#i-volume');
    $('btn-sound').setAttribute('aria-label', settings.muted ? 'Unmute' : 'Mute');
    $('btn-sound').title = settings.muted ? 'Unmute' : 'Mute';
    $('btn-sound').setAttribute('aria-pressed', String(settings.muted));
  }

  $('set-music').addEventListener('input', e => set('music', e.target.value / 100));
  $('set-sfx').addEventListener('input', e => set('sfx', e.target.value / 100));
  $('set-sfx').addEventListener('change', () => onChange('sfx-preview'));
  $('set-vibrate').addEventListener('change', e => set('vibrate', e.target.checked));
  dlg.addEventListener('click', e => {
    const b = e.target.closest('[data-speed],[data-motion]');
    if (!b) return;
    if (b.dataset.speed) set('speed', b.dataset.speed);
    else set('motion', b.dataset.motion);
  });
  $('btn-settings').addEventListener('click', () => { sync(); dlg.showModal(); });
  $('btn-sound').addEventListener('click', () => set('muted', !settings.muted));
  if (!navigator.vibrate) $('set-vibrate').closest('.set-row').hidden = true;
  sync();
}
