// Meeting alerts: when one of today's meetings starts, pop up a card with Join and Record in Glean, bring the
// app forward, and (if allowed) show a system notification while the tab is in the background.
// Meetings that are canceled, or that you removed or marked for removal, never alert.
//
// This runs in the page, so it works while the app is open in a tab or installed window (even in the
// background), not when it's closed.

import { esc, plain } from './md.js';
import { Ctx, parseNote, sections, statusOf } from './render.js';
import { meetingRows, latestDaily, gleanNoteUrl, parseYmd, today, sameDay } from './views.js';
import { animate, spring } from './motion.js';

const PREFS = 'brief.alerts';
const SEEN = 'brief.alerted';
const GRACE = 10 * 60_000; // still alert if the laptop wakes up to 10 minutes after the start

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export const alertPrefs = () => ({ on: true, sound: true, ...read(PREFS, {}) });
export function setAlertPrefs(patch) { write(PREFS, { ...alertPrefs(), ...patch }); }
export const notifyState = () => (!('Notification' in window) ? 'unsupported' : Notification.permission);
export async function askNotify() {
  if (notifyState() !== 'default') return notifyState();
  try { return await Notification.requestPermission(); } catch { return notifyState(); }
}

// Today's meetings that should alert, from the newest brief, if that brief is today's.
export function alertableMeetings(store) {
  const path = latestDaily(store);
  if (!path) return [];
  const { data, blocks } = parseNote(store, path);
  if (!sameDay(parseYmd(data?.date), today())) return [];
  const table = sections(blocks).find(/meeting/i)?.blocks.find((b) => b.t === 'table');
  const lines = new Ctx(store, path).lines;
  return meetingRows(table, data.date)
    .filter((m) => !m.canceled && m.start != null && !statusOf(store, path, lines[m.line] ?? '').remove)
    .map((m) => ({ ...m, title: plain(m.name), key: `${data.date}|${m.start}|${plain(m.name)}` }));
}

const clockOf = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const ICON_CAL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';

let layer = null;
const shown = new Map(); // key → { el, end }
let baseTitle = document.title, flashTimer = 0;
let audio = null;

// Browsers only allow sound after you've touched the page once; get ready on the first tap.
addEventListener('pointerdown', () => {
  if (audio) return;
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; }
}, { capture: true });

function chime() {
  if (!audio || !alertPrefs().sound) return;
  try {
    audio.resume?.();
    const t = audio.currentTime;
    for (const [f, at] of [[880, 0], [1318.5, 0.16]]) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.18, t + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.5);
      o.connect(g).connect(audio.destination);
      o.start(t + at); o.stop(t + at + 0.55);
    }
  } catch { /* no sound */ }
}

function flashTitle(text) {
  clearInterval(flashTimer);
  if (document.visibilityState === 'visible') return;
  baseTitle = document.title.startsWith('● ') ? baseTitle : document.title;
  let on = false;
  flashTimer = setInterval(() => { on = !on; document.title = on ? `● ${text}` : baseTitle; }, 1000);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  clearInterval(flashTimer); document.title = baseTitle;
  shown.values().next().value?.el.querySelector('.alert-join, .alert-record, .alert-dismiss')?.focus({ preventScroll: true });
});

function cardHTML(m) {
  const late = Date.now() - m.start > 60_000;
  const when = late ? `Started ${Math.round((Date.now() - m.start) / 60000)} min ago` : 'Starting now';
  const ask = notifyState() === 'default'
    ? '<button class="text-btn alert-ask" type="button" data-alert-notify>Also notify me when this tab is in the background</button>' : '';
  return `
    <div class="alert-head">
      <span class="alert-icon">${ICON_CAL}</span>
      <span class="alert-kind">${when}</span>
      <span class="alert-time">${esc(clockOf(m.start))}–${esc(clockOf(m.end))}</span>
      <button class="alert-x" type="button" data-alert-close aria-label="Dismiss">${ICON_X}</button>
    </div>
    <p class="alert-title" id="alert-t-${m.start}">${esc(m.title)}</p>
    ${m.prep ? `<p class="alert-prep">${esc(plain(m.prep))}</p>` : ''}
    <div class="alert-actions">
      ${m.join ? `<a class="btn btn-primary alert-join" href="${esc(m.join)}" target="_blank" rel="noopener noreferrer">Join</a>` : ''}
      <a class="btn alert-record" href="${esc(gleanNoteUrl(m.title))}" target="_blank" rel="noopener noreferrer" data-title="${esc(m.title)}"><span class="rec-dot" aria-hidden="true"></span>Record in Glean</a>
      <button class="btn alert-dismiss" type="button" data-alert-close>Dismiss</button>
    </div>
    ${ask}`;
}

function show(m) {
  if (!layer) { layer = document.createElement('div'); layer.className = 'alert-layer'; document.body.append(layer); }
  const el = document.createElement('section');
  el.className = 'mtg-alert';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-labelledby', `alert-t-${m.start}`);
  el.dataset.alertKey = m.key;
  el.innerHTML = cardHTML(m);
  layer.prepend(el);
  shown.set(m.key, { el, end: m.end });
  animate(el, [{ opacity: 0, transform: 'translateY(-24px) scale(0.96)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], spring({ response: 0.42, damping: 0.78 }));
  try { window.focus(); } catch { /* not allowed */ }
  if (document.visibilityState === 'visible') el.querySelector('.alert-join, .alert-record')?.focus({ preventScroll: true });
  chime();
  flashTitle(`Meeting now: ${m.title}`);
  systemNotify(m);
}

function systemNotify(m) {
  if (notifyState() !== 'granted' || document.visibilityState === 'visible') return;
  try {
    const n = new Notification(`Meeting now: ${m.title}`, {
      body: `${clockOf(m.start)}–${clockOf(m.end)}${m.join ? ' · Open Morning Brief to join or record' : ' · Open Morning Brief to record in Glean'}`,
      tag: `mtg-${m.key}`, requireInteraction: true, icon: 'icons/icon-512.png',
    });
    n.onclick = () => { try { window.focus(); } catch { /* ignore */ } n.close(); };
    shown.get(m.key).note = n;
  } catch { /* some browsers only allow notifications from a service worker */ }
}

export function dismissAlert(key) {
  const s = shown.get(key);
  if (!s) return;
  shown.delete(key);
  s.note?.close?.();
  if (!shown.size) { clearInterval(flashTimer); document.title = baseTitle; }
  animate(s.el, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'translateY(-12px) scale(0.96)' }], spring({ response: 0.28, damping: 1 }))
    .then(() => s.el.remove());
}

// Called every few seconds and whenever the brief changes.
export function checkMeetingAlerts(store) {
  const now = Date.now();
  const list = store ? alertableMeetings(store) : [];
  const keys = new Set(list.map((m) => m.key));
  // Close cards for meetings that ended, or that you removed while the card was up.
  for (const [key, s] of shown) if (now >= s.end || (!keys.has(key) && !key.startsWith('test|'))) dismissAlert(key);
  if (!alertPrefs().on) return;
  const seen = read(SEEN, []);
  let changed = false;
  for (const m of list) {
    if (now < m.start || now >= Math.min(m.end, m.start + GRACE) || seen.includes(m.key) || shown.has(m.key)) continue;
    seen.push(m.key); changed = true;
    show(m);
  }
  if (changed) write(SEEN, seen.slice(-60));
}

// Card buttons. Join and Record are handled by the app's own link handlers (same as the meeting rows).
document.addEventListener('click', async (e) => {
  const close = e.target.closest('[data-alert-close]');
  if (close) { dismissAlert(close.closest('.mtg-alert').dataset.alertKey); return; }
  const ask = e.target.closest('[data-alert-notify]');
  if (ask) {
    const res = await askNotify();
    for (const b of document.querySelectorAll('[data-alert-notify]')) b.remove();
    document.dispatchEvent(new CustomEvent('alerts-changed', { detail: { permission: res } }));
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !shown.size) return;
  const card = e.target.closest?.('.mtg-alert');
  if (card) dismissAlert(card.dataset.alertKey);
});

// ---------- settings ----------

const NOTIFY_TEXT = {
  granted: 'On. You get a notification while this tab is in the background.',
  denied: 'Blocked. Allow notifications for this site in your browser settings.',
  unsupported: 'This browser can’t show notifications from a web page. The pop-up still appears in the app.',
  default: 'Off. Turn on to get a notification while this tab is in the background.',
};

export function alertsSettingsHTML() {
  const p = alertPrefs(), n = notifyState();
  const sw = (key, label, note) => `<label class="alert-opt"><span class="alert-opt-text"><span class="alert-opt-name">${label}</span><span class="alert-opt-note">${note}</span></span>
    <input type="checkbox" role="switch" class="switch" data-alert-pref="${key}"${p[key] ? ' checked' : ''}></label>`;
  return `<div class="alert-settings" data-alert-settings>
    ${sw('on', 'Pop up when a meeting starts', 'Join and Record in Glean, right when it starts. Canceled meetings and ones you removed are skipped.')}
    ${sw('sound', 'Play a sound', 'A short chime with the pop-up.')}
    <div class="alert-opt"><span class="alert-opt-text"><span class="alert-opt-name">System notifications</span><span class="alert-opt-note">${NOTIFY_TEXT[n]}</span></span>
      ${n === 'default' ? '<button class="btn btn-small" type="button" data-alert-notify>Turn on</button>' : ''}</div>
    <button class="btn btn-wide" type="button" data-alert-test>Show a test alert</button>
    <p class="muted small">Alerts come from the app itself, so keep Morning Brief open in a tab or as an installed app. A closed app can’t alert you.</p>
  </div>`;
}

export function testAlert() {
  const start = Date.now();
  show({ key: `test|${start}`, start, end: start + 30 * 60_000, title: 'Test meeting', prep: 'This is what a meeting alert looks like.', join: null });
}

document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-alert-pref]');
  if (t) setAlertPrefs({ [t.dataset.alertPref]: t.checked });
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-alert-test]')) testAlert();
});
document.addEventListener('alerts-changed', () => {
  for (const box of document.querySelectorAll('[data-alert-settings]')) box.outerHTML = alertsSettingsHTML();
});
