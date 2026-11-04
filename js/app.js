import { Store, target, PROFILES, activeProfile, rememberProfile } from './store.js';
import { nextRunLabel, rowPills, setSchedule } from './render.js';
import { personalTodayView, draftsView, filteredView, findSender, senderSheetHTML } from './personal.js';
import { Navigator } from './nav.js';
import { openSheet, toast, closeAllSheets } from './sheet.js';
import { wireSwipes } from './swipe.js';
import { animate, spring } from './motion.js';
import {
  todayView, actionsView, eventsView, notesView, noteView, feedbackView,
  itemSheetHTML, addSheetHTML, dayItemsHTML, placeThumb, registry, ago, meetingStatus,
  routinesHTML, settingsPageHTML, RECORD_LEAD, draftHTML, journalDrafts, journalStatus,
} from './views.js';

let store = new Store(activeProfile());
setSchedule(store.profile.schedule);
const $ = (s, r = document) => r.querySelector(s);

const ICONS = {
  drafts: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><path d="M4.5 7l7.5 5.5L19.5 7"/></svg>',
};
const WORK_TABS = [
  { id: 'today', label: 'Today', route: 'today', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 5v2.5M5.4 9.4l1.7 1.4M18.6 9.4l-1.7 1.4"/></svg>' },
  { id: 'actions', label: 'Actions', route: 'actions', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.7-5.2"/></svg>' },
  { id: 'events', label: 'Upcoming', route: 'events', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>' },
  { id: 'notes', label: 'Notes', route: 'notes', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6"/></svg>' },
  { id: 'feedback', label: 'Feedback', route: 'feedback', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v9a1.5 1.5 0 0 1-1.5 1.5h-9l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 16V7A1.5 1.5 0 0 1 5 5.5z"/></svg>' },
];
const PERSONAL_TABS = [
  WORK_TABS[0],
  WORK_TABS[2],
  { id: 'drafts', label: 'Drafts', route: 'drafts', icon: ICONS.drafts },
  WORK_TABS[4],
];
const tabsFor = (id) => (id === 'personal' ? PERSONAL_TABS : WORK_TABS);

// The profile chip at the top left of Today switches between Work and Personal.
const profileChip = () => `<button class="profile-chip" type="button" data-action="profile" aria-haspopup="menu" aria-expanded="false" aria-label="Profile: ${store.profile.label}. Switch profile">
  <span class="profile-dot profile-${store.profile.id}" aria-hidden="true"></span><span>${store.profile.label}</span>
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg></button>`;

function makeView(route) {
  if (route.startsWith('note:')) return noteView(store, route.slice(5));
  if (route === 'settings') return {
    route: 'settings', title: 'Settings',
    render(el) { el.innerHTML = settingsPageHTML(store); bindSettings(el); },
  };
  const views = store.profile.id === 'personal'
    ? { today: personalTodayView, events: eventsView, drafts: draftsView, feedback: feedbackView, filtered: filteredView }
    : { today: todayView, actions: actionsView, events: eventsView, notes: notesView, feedback: feedbackView };
  const v = (views[route] ?? views.today)(store);
  if (route === 'today') v.navLeft = profileChip;
  return v;
}

const nav = new Navigator($('#stage'), $('.tabbar'), tabsFor(store.profile.id), makeView);

// ---------- re-render on data changes ----------

// 'data' (the vault changed elsewhere) redraws everything. 'local' (a save from this device) redraws only the
// pages you can't see and patches the rows in front of you, so the page never jumps. 'status' touches the chrome.
const RANK = { status: 0, local: 1, data: 2 };
let raf = 0, pendingKind = 'status';
function onStoreChange(e) {
  const kind = e.detail?.kind ?? 'data';
  if (RANK[kind] > RANK[pendingKind]) pendingKind = kind;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    let k = pendingKind;
    if (k === 'data' && document.activeElement?.matches?.('[data-journal-text]')) k = 'local';
    pendingKind = 'status';
    if (k === 'data') { registry.clear(); nav.refreshAll(); }
    else if (k === 'local') { const cur = nav.current; nav.refreshAll({ except: cur?.view.liveRefresh ? null : cur }); patchRows(cur?.el); }
    chrome();
  });
}
store.addEventListener('change', onStoreChange);

// ---------- profiles ----------

// Work and Personal each have their own repo, pages and cache. Switching swaps the store and rebuilds the tabs
// in place: the old pages sink back and fade, the new ones rise in.
let switching = false;
async function switchProfile(id) {
  if (switching || id === store.profile.id || !PROFILES[id]) return;
  switching = true;
  closeMenu({ instant: true });
  closeAllSheets();
  const stage = $('#stage');
  const s = spring({ response: 0.32, damping: 1 });
  await animate(stage, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.97)' }], s);
  store.removeEventListener('change', onStoreChange);
  clearInterval(pollTimer);
  store = new Store(id);
  setSchedule(store.profile.schedule);
  store.addEventListener('change', onStoreChange);
  rememberProfile(id);
  registry.clear();
  const tabs = tabsFor(id);
  nav.reset(tabs, makeView);
  for (const t of tabs) nav.stack(t.id);
  nav.select(tabs[0].id);
  history.replaceState({ tab: tabs[0].id, routes: nav.routes, profile: id }, '');
  chrome();
  await animate(stage, [{ opacity: 0, transform: 'scale(1.03)' }, { opacity: 1, transform: 'scale(1)' }], spring({ response: 0.42, damping: 0.9 }));
  stage.style.transform = '';
  switching = false;
  store.sync();
}

// The profile chip opens a dropdown menu under itself, like an iOS pull-down menu.
let menu = null;
function closeMenu({ instant = false } = {}) {
  if (!menu) return;
  const { layer, panel, anchor } = menu;
  menu = null;
  anchor.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', onMenuKey, true);
  if (instant) { layer.remove(); return; }
  animate(panel, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.92)' }], { duration: 140, easing: 'ease-in' }).then(() => layer.remove());
}
function onMenuKey(e) {
  if (!menu) return;
  const items = [...menu.panel.querySelectorAll('[role="menuitemradio"]')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); const a = menu.anchor; closeMenu(); a.focus(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
  else if (e.key === 'Tab') closeMenu();
}
function profileMenu(anchor) {
  if (menu) { closeMenu(); return; }
  const layer = document.createElement('div');
  layer.className = 'menu-layer';
  layer.innerHTML = `<div class="menu" role="menu" aria-label="Switch profile">${Object.values(PROFILES).map((p) => `
    <button class="menu-item" type="button" role="menuitemradio" aria-checked="${p.id === store.profile.id}" data-switch="${p.id}">
      <svg class="menu-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.5l3.6 3.6 7.4-8"/></svg>
      <span class="menu-text"><span class="menu-label">${p.label}</span><span class="menu-sub">${p.blurb}</span></span>
      <span class="profile-dot profile-${p.id}" aria-hidden="true"></span>
    </button>`).join('')}</div>`;
  document.body.append(layer);
  const panel = layer.querySelector('.menu');
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${Math.round(r.bottom + 6)}px`;
  panel.style.left = `${Math.round(Math.max(8, Math.min(r.left, innerWidth - panel.offsetWidth - 8)))}px`;
  menu = { layer, panel, anchor };
  anchor.setAttribute('aria-expanded', 'true');
  // Grows out of the chip on a spring.
  animate(panel, [{ opacity: 0, transform: 'scale(0.5)' }, { opacity: 1, transform: 'scale(1)' }], spring({ response: 0.34, damping: 0.82 }));
  layer.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu')) { e.preventDefault(); closeMenu(); } });
  layer.addEventListener('click', (e) => {
    const b = e.target.closest('[data-switch]');
    if (!b) return;
    e.stopPropagation();
    const id = b.dataset.switch;
    for (const x of panel.querySelectorAll('[data-switch]')) x.setAttribute('aria-checked', String(x === b));
    setTimeout(() => { closeMenu(); switchProfile(id); }, 120);
  });
  document.addEventListener('keydown', onMenuKey, true);
  (panel.querySelector('[aria-checked="true"]') ?? panel.querySelector('button')).focus({ preventScroll: true });
}
addEventListener('resize', () => closeMenu({ instant: true }));
document.addEventListener('scroll', () => closeMenu(), { capture: true, passive: true });

function patchRows(root) {
  if (!root) return;
  for (const row of root.querySelectorAll('.row[data-iid]')) {
    const item = registry.get(row.dataset.iid);
    if (!item) continue;
    const { html, removing } = rowPills(store, item);
    const slot = row.querySelector('.row-pills');
    if (slot && slot.innerHTML !== html) slot.innerHTML = html;
    row.classList.toggle('is-removing', removing);
    if (item.kind === 'task') row.classList.toggle('is-done', !!item.checked);
  }
}

function chrome() {
  $('[data-bind="scope"]').textContent = `${store.profile.label}${store.dev ? ' · local preview' : ` · ${store.config.repo}`}`;
  document.documentElement.dataset.profile = store.profile.id;
  for (const b of document.querySelectorAll('.side-profiles [data-switch]')) b.setAttribute('aria-selected', String(b.dataset.switch === store.profile.id));
  $('[data-bind="fresh"]').textContent = store.syncing ? 'Syncing…' : store.commit?.date ? `Updated ${ago(store.commit.date)}` : '';
  nav.setCount('feedback', store.pending.length);
  document.body.classList.toggle('is-syncing', store.syncing);
}

// ---------- open meetings in their apps ----------

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Zoom: zoomus:// on phones, zoommtg:// on desktop. Teams: msteams://. Outlook can't open one event from a
// link, so it opens the app's calendar.
function appUrl(kind, web) {
  try {
    const u = new URL(web);
    if (kind === 'join' && /zoom\.us$/.test(u.hostname)) {
      const confno = (u.pathname.match(/\/j\/(\d+)/) || [])[1];
      if (!confno) return null;
      const pwd = u.searchParams.get('pwd');
      const q = `confno=${confno}${pwd ? `&pwd=${encodeURIComponent(pwd)}` : ''}`;
      return isMobile ? `zoomus://zoom.us/join?${q}` : `zoommtg://${u.hostname}/join?action=join&${q}`;
    }
    if (kind === 'join' && /teams\.(microsoft|live)\.com$/.test(u.hostname)) return web.replace(/^https:/, 'msteams:');
    if (kind === 'outlook') return 'ms-outlook://events';
  } catch { /* not a URL */ }
  return null;
}

// Hand the link to the app. No timed fallback: the browser's "Open Microsoft Outlook?" prompt keeps this page in
// front, which looked like "app not installed" and opened the website instead. Offer the web link in a toast.
function openInApp(kind, web) {
  const app = appUrl(kind, web);
  if (!app) { window.open(web, '_blank', 'noopener'); return; }
  location.href = app;
  toast(kind === 'join' ? 'Opening the meeting app…' : 'Opening Outlook…', {
    action: { label: 'Open in browser', run: () => window.open(web, '_blank', 'noopener') },
  });
}

// ---------- taps ----------

document.addEventListener('click', (e) => {
  if (switching) { e.preventDefault(); return; }
  const rec = e.target.closest('a.mtg-record');
  if (rec) {
    // Let the link open Glean in a new tab; copy the name in case Glean doesn't fill the title.
    e.stopPropagation();
    navigator.clipboard?.writeText(rec.dataset.title).catch(() => {});
    toast(`Opening Glean. "${rec.dataset.title}" is copied if you need to paste the title.`);
    return;
  }
  const appLink = e.target.closest('a.mtg-join, a.mtg-link');
  if (appLink) {
    e.preventDefault();
    e.stopPropagation();
    openInApp(appLink.classList.contains('mtg-join') ? 'join' : 'outlook', appLink.href);
    return;
  }
  const link = e.target.closest('a[data-note]');
  if (link) {
    e.preventDefault();
    closeAllSheets();
    const path = link.dataset.note;
    if (nav.current?.view.route === 'note:' + path) return;
    nav.push('note:' + path);
    return;
  }
  const js = e.target.closest('[data-journal-save]');
  if (js) { saveJournal(journalBox(js)); return; }
  const cs = e.target.closest('[data-copy-standup]');
  if (cs) {
    const text = cs.closest('.panel').querySelector('[data-standup]')?.innerText.trim() ?? '';
    navigator.clipboard?.writeText(text).then(() => toast('Stand-up notes copied'), () => toast('Could not copy. Select the text and copy it.'));
    return;
  }
  if (e.target.closest('[data-open-filtered]')) { if (nav.current?.view.route !== 'filtered') nav.push('filtered'); return; }
  const snd = e.target.closest('[data-sender]');
  if (snd) { senderSheet(snd.dataset.sender); return; }
  const prof = e.target.closest('button[data-switch]');
  if (prof) { switchProfile(prof.dataset.switch); return; }
  const dc = e.target.closest('[data-draft-id]');
  if (dc) { draftSheet(dc.dataset.draftId); return; }
  const act = e.target.closest('[data-action]');
  if (act) {
    const a = act.dataset.action;
    if (a === 'profile') return profileMenu(act);
    if (a === 'settings') { closeAllSheets(); if (nav.current?.view.route !== 'settings') nav.push('settings'); return; }
    if (a === 'routines') return routinesSheet();
    if (a === 'add') return addSheet(act.dataset.kind);
    if (a === 'sync') return store.sync().then(() => { if (!store.error) toast('Up to date'); });
  }
  const go = e.target.closest('[data-goto]');
  if (go) { nav.select(go.dataset.goto); return; }

  const day = e.target.closest('[data-day]');
  if (day) {
    const d = new Date(day.dataset.day + 'T12:00');
    openSheet({ title: d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }), body: dayItemsHTML(store, day.dataset.day) });
    return;
  }

  const run = e.target.closest('[data-run]');
  if (run) { e.stopPropagation(); runRoutine(run.dataset.run, run); return; }

  const check = e.target.closest('button.check');
  if (check) { e.stopPropagation(); toggle(check.closest('[data-iid]')); return; }

  const wd = e.target.closest('[data-withdraw]');
  if (wd) {
    e.stopPropagation();
    const row = wd.closest('.fb-row');
    collapse(row).then(() => store.withdrawFeedback(wd.dataset.withdraw).then(() => toast('Withdrawn')).catch(failed));
    return;
  }

  if (e.target.closest('a, button, input, textarea, select, summary, label')) return;
  const row = e.target.closest('[data-iid]');
  if (row) itemSheet(row);
});

async function toggle(row) {
  const item = registry.get(row?.dataset.iid);
  if (!item) return;
  const done = !item.checked;
  row.classList.toggle('is-done', done);
  const c = row.querySelector('button.check');
  if (c) {
    c.setAttribute('aria-pressed', String(done));
    animate(c, [{ transform: 'scale(0.7)' }, { transform: 'scale(1)' }], spring({ response: 0.34, damping: 0.55 }));
  }
  try {
    await store.toggleTask(item, done);
    toast(done ? 'Marked done' : 'Reopened');
  } catch (e) { row.classList.toggle('is-done', !done); failed(e); }
}

function failed(e) { toast(e?.message || 'Could not save. Check your connection.', { tone: 'error' }); }

function collapse(el) {
  if (!el) return Promise.resolve();
  const h = el.offsetHeight;
  return animate(el, [{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' }], spring({ response: 0.34, damping: 1 }));
}

async function send(item, action, note = '') {
  try {
    await store.addFeedback({ action, target: target(item), note });
    toast(action === 'remove' ? `Claude removes it at ${nextRunLabel()}` : action === 'confirm' ? 'Confirmed' : 'Sent to Claude');
  } catch (e) { failed(e); }
}

// ---------- What I did today ----------

// Saves a second and a half after you stop typing, when you leave the box, or on Save.
const journalTimers = new Map();
function journalBox(el) { return el.closest('[data-journal]'); }
async function saveJournal(box) {
  const path = box.dataset.journal;
  const key = store.profile.id + ':' + path;
  clearTimeout(journalTimers.get(key));
  if (!journalDrafts.has(key)) return;
  const text = journalDrafts.get(key);
  const status = box.querySelector('[data-journal-status]');
  const btn = box.querySelector('[data-journal-save]');
  status.textContent = 'Saving…';
  btn.disabled = true;
  try {
    await store.saveJournal(path, text);
    // Typed more while saving? Keep that as the next draft.
    if (journalDrafts.get(key) === text) journalDrafts.delete(key);
    status.textContent = journalDrafts.has(key) ? 'Not saved yet' : journalStatus(store, path) || 'Saved';
    btn.disabled = !journalDrafts.has(key);
  } catch (e) {
    status.textContent = 'Not saved yet';
    btn.disabled = false;
    failed(e);
  }
}
document.addEventListener('input', (e) => {
  const ta = e.target.closest?.('[data-journal-text]');
  if (!ta) return;
  const box = journalBox(ta);
  const key = store.profile.id + ':' + box.dataset.journal;
  journalDrafts.set(key, ta.value);
  box.querySelector('[data-journal-status]').textContent = 'Not saved yet';
  box.querySelector('[data-journal-save]').disabled = false;
  clearTimeout(journalTimers.get(key));
  journalTimers.set(key, setTimeout(() => { if (box.isConnected) saveJournal(box); }, 1500));
});
document.addEventListener('focusout', (e) => {
  const ta = e.target.closest?.('[data-journal-text]');
  if (ta) saveJournal(journalBox(ta));
});

// ---------- swipes ----------

wireSwipes($('#stage'), {
  done: (row) => toggle(row),
  remove: (row) => { const item = registry.get(row.dataset.iid); if (item) send(item, 'remove'); },
  note: (row) => itemSheet(row, { focusNote: true }),
});

// ---------- sheets ----------

function itemSheet(row, { focusNote = false } = {}) {
  const item = registry.get(row.dataset.iid);
  if (!item) return;
  const showOpen = nav.current?.view.route !== 'note:' + item.file;
  openSheet({
    title: item.kind === 'task' ? 'To-do' : item.kind === 'row' ? 'Item' : 'Item',
    body: itemSheetHTML(store, item, { showOpen }),
    onMount({ sheet, close }) {
      bindDraft(sheet);
      const ta = sheet.querySelector('[data-sheet-note]');
      const sendBtn = sheet.querySelector('[data-sheet="send"]');
      ta.addEventListener('input', () => { sendBtn.disabled = !ta.value.trim(); });
      if (focusNote) setTimeout(() => ta.focus(), 350);
      sheet.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sheet]');
        if (!b) return;
        const k = b.dataset.sheet;
        if (k === 'toggle') { close(); toggle(row); }
        if (k === 'confirm') { close(); send(item, 'confirm'); }
        if (k === 'remove') { close(); send(item, 'remove'); }
        if (k === 'send' && ta.value.trim()) { close(); send(item, 'feedback', ta.value.trim()); }
      });
    },
  });
}

// Drafts: edit, copy, open in Slack or Outlook, save. Nothing is ever sent from here.
function bindDraft(sheet) {
  const box = sheet.querySelector('[data-draft]');
  if (!box) return;
  const body = box.querySelector('[data-draft-body]');
  const subject = box.querySelector('[data-draft-subject]');
  const to = box.querySelector('[data-draft-to]');
  const save = box.querySelector('[data-draft-save]');
  const fields = [body, subject, to].filter(Boolean);
  const initial = fields.map((f) => f.value).join('\u0000');
  for (const f of fields) f.addEventListener('input', () => { save.disabled = fields.map((x) => x.value).join('\u0000') === initial; });
  const copy = async () => { try { await navigator.clipboard.writeText(body.value); return true; } catch { return false; } };

  box.querySelector('[data-draft-copy]').addEventListener('click', async () => toast(await copy() ? 'Copied' : 'Could not copy. Select the text and copy it.'));
  box.querySelector('[data-draft-open]').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const ch = b.dataset.draftOpen;
    if (ch === 'gmail' || ch === 'yahoo') {
      const q = (k, v) => (v ? `${k}=${encodeURIComponent(v)}` : '');
      const to = box.querySelector('[data-draft-to]')?.value, sub = box.querySelector('[data-draft-subject]')?.value, text = body.value;
      const app = ch === 'gmail'
        ? `googlegmail://co?${[q('to', to), q('subject', sub), q('body', text)].filter(Boolean).join('&')}`
        : `ymail://mail/compose?${[q('to', to), q('subject', sub), q('body', text)].filter(Boolean).join('&')}`;
      const web = ch === 'gmail'
        ? `https://mail.google.com/mail/u/0/?${['view=cm', 'fs=1', q('to', to), q('su', sub), q('body', text)].filter(Boolean).join('&')}`
        : `https://compose.mail.yahoo.com/?${[q('to', to), q('subject', sub), q('body', text)].filter(Boolean).join('&')}`;
      // Phones: the mail app. Desktop: the web compose window (where these accounts live on a Mac).
      if (isMobile) {
        location.href = app;
        toast(`Opening ${ch === 'gmail' ? 'Gmail' : 'Yahoo Mail'}…`, { action: { label: 'Open in browser', run: () => window.open(web, '_blank', 'noopener') } });
      } else window.open(web, '_blank', 'noopener');
      return;
    }
    if (ch === 'slack') {
      const ok = await copy();
      if (b.dataset.slack) location.href = b.dataset.slack;
      toast(ok ? 'Copied. Paste it into the conversation.' : 'Opening Slack…');
      return;
    }
    const q = (k, v) => (v ? `${k}=${encodeURIComponent(v)}` : '');
    const params = [q('to', to?.value), q('subject', subject?.value), q('body', body.value)].filter(Boolean).join('&');
    location.href = `ms-outlook://compose?${params}`;
    toast('Opening Outlook…', { action: { label: 'Use my mail app', run: () => { location.href = `mailto:${encodeURIComponent(to?.value ?? '')}?${[q('subject', subject?.value), q('body', body.value)].filter(Boolean).join('&')}`; } } });
  });
  for (const sb of box.querySelectorAll('[data-draft-status]')) sb.addEventListener('click', async () => {
    const status = sb.dataset.draftStatus;
    try {
      await store.setDraftStatus(box.dataset.draft, status);
      sheet.dispatchEvent(new CustomEvent('draft-handled'));
      toast(status === 'sent' ? 'Marked sent' : status ? 'No reply needed' : 'Back in your drafts');
    } catch (err) { failed(err); }
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await store.saveDraft(box.dataset.draft, { body: body.value, ...(subject ? { subject: subject.value } : {}), ...(to ? { email: to.value } : {}) });
      toast('Draft saved');
    } catch (err) { save.disabled = false; failed(err); }
  });
}

// A filtered sender: examples, then Unsubscribe / Block / Not junk. Each is feedback the morning routine applies.
function senderSheet(id) {
  const s = findSender(store, id);
  if (!s) { toast('That sender is gone from the list. Pull to refresh.'); return; }
  openSheet({
    title: 'Sender',
    body: `<div data-sender-body>${senderSheetHTML(store, s)}</div>`,
    onMount({ root, sheet, close }) {
      const body = sheet.querySelector('[data-sender-body]');
      const redraw = () => {
        if (!root.isConnected) { store.removeEventListener('change', redraw); return; }
        const cur = findSender(store, id);
        if (cur) body.innerHTML = senderSheetHTML(store, cur);
      };
      store.addEventListener('change', redraw);
      sheet.addEventListener('click', async (e) => {
        const undo = e.target.closest('[data-sender-undo]');
        if (undo) {
          try { await store.withdrawFeedback(undo.dataset.senderUndo); toast('Undone'); } catch (err) { failed(err); }
          return;
        }
        const b = e.target.closest('[data-sender-act]');
        if (!b) return;
        const action = b.dataset.senderAct;
        const sender = { name: s.name ?? '', address: s.address, account: s.account, kind: s.kind ?? null, unsubscribe: s.unsubscribe ?? null };
        b.disabled = true;
        try {
          await store.addFeedback({ action, sender, note: '' });
          const when = nextRunLabel();
          toast({ block: `Blocking at ${when}`, unsubscribe: `Unsubscribing at ${when}`, unblock: `Unblocking at ${when}`, not_junk: `Their mail shows in your brief from ${when}` }[action]);
          if (action === 'not_junk') close();
        } catch (err) { b.disabled = false; failed(err); }
      });
    },
  });
}

function draftSheet(id) {
  const d = store.drafts.find((x) => x.id === id);
  if (!d) return;
  openSheet({
    title: d.status ? 'Handled reply' : 'Draft reply',
    body: `${d.item ? `<div class="item-preview"><p class="item-main">${escText(d.item)}</p></div>` : ''}${draftHTML(d, { handled: !d.status })}${d.status ? '<button class="btn btn-wide" type="button" data-draft-status="">Move back to drafts</button>' : ''}`,
    onMount({ sheet, close }) {
      // "Move back" sits outside the draft box; give it the box's handler.
      const back = sheet.querySelector(':scope [data-draft-status=""]');
      if (back && !back.closest('[data-draft]')) sheet.querySelector('[data-draft]').append(back);
      bindDraft(sheet);
      sheet.addEventListener('draft-handled', () => close());
    },
  });
}
const escText = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function addSheet(kind = 'todo') {
  openSheet({
    title: 'Add',
    body: addSheetHTML(kind),
    onMount({ sheet, close }) {
      const seg = sheet.querySelector('.segmented');
      const ta = sheet.querySelector('[data-add-text]');
      const date = sheet.querySelector('[data-add-date]');
      const btn = sheet.querySelector('[data-add-send]');
      requestAnimationFrame(() => placeThumb(seg, false));
      const labels = { todo: 'What needs doing?', event: 'What is happening?', note: 'What should Claude know or do?' };
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-seg]');
        if (!b) return;
        kind = b.dataset.seg;
        for (const x of seg.querySelectorAll('[data-seg]')) x.setAttribute('aria-selected', String(x === b));
        placeThumb(seg, true);
        sheet.querySelector('[data-add-label]').textContent = labels[kind];
        sheet.querySelector('[data-add-due]').hidden = kind === 'note';
        sheet.querySelector('[data-add-due] .field-label').textContent = kind === 'event' ? 'Date' : 'Due date (optional)';
      });
      ta.addEventListener('input', () => { btn.disabled = !ta.value.trim(); });
      btn.addEventListener('click', async () => {
        const text = ta.value.trim();
        if (!text) return;
        close();
        try {
          await store.addFeedback({ action: 'add', add: { kind, text, due: kind === 'note' ? null : date.value || null }, note: '' });
          toast('Sent to Claude');
        } catch (e) { failed(e); }
      });
    },
  });
}

// ---------- routines ----------

let pollTimer = 0;
// Watch for the Action and the routine to report back: sync every 20 s for up to 6 minutes.
function pollRuns() {
  clearInterval(pollTimer);
  let n = 0;
  pollTimer = setInterval(() => { store.sync(); if (++n >= 18) clearInterval(pollTimer); }, 20_000);
}

async function runRoutine(key, btn) {
  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
    await store.requestRun(key);
    toast('Run requested. It starts within a minute.');
    pollRuns();
  } catch (e) {
    failed(e);
    btn.disabled = false;
    btn.textContent = 'Run now';
  }
}

function routinesSheet() {
  openSheet({
    title: 'Routines',
    body: `<div data-routines-body>${routinesHTML(store)}</div>
      <button class="text-btn" type="button" data-action="settings">Change models in Settings</button>`,
    onMount({ root, sheet }) {
      const body = sheet.querySelector('[data-routines-body]');
      const update = () => {
        if (!root.isConnected) { store.removeEventListener('change', update); return; }
        body.innerHTML = routinesHTML(store);
      };
      store.addEventListener('change', update);
      store.sync();
    },
  });
}

document.addEventListener('change', async (e) => {
  const radio = e.target.closest('[data-model-for]');
  if (!radio) return;
  try {
    await store.setModel(radio.dataset.modelFor, radio.value);
    toast('Saved. Applies from the next run.');
  } catch (err) { failed(err); }
});

function bindSettings(root) {
  const form = root.querySelector('[data-settings]');
  if (!form) return;
  const status = root.querySelector('[data-settings-status]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const patch = { name: f.get('name').trim(), owner: f.get('owner').trim(), repo: f.get('repo').trim(), branch: f.get('branch').trim() || 'main' };
    const token = f.get('token').trim();
    if (token) patch.token = token;
    store.setConfig(patch);
    status.textContent = 'Connecting…';
    await store.sync();
    if (store.error) { status.textContent = store.error.message; return; }
    toast('Connected');
  });
  root.querySelector('[data-signout]')?.addEventListener('click', () => { store.signOut(); toast('Token removed from this device'); });
}

// ---------- pull to refresh (iOS rubber band) ----------

let armed = false;
$('#stage').addEventListener('scroll', (e) => {
  const sc = e.target;
  if (!sc.classList?.contains('scroll')) return;
  const y = sc.scrollTop;
  const page = sc.closest('.page');
  if (y < -70 && !armed) { armed = true; page.classList.add('pull-armed'); }
  page.style.setProperty('--pull', String(Math.min(1, Math.max(0, -y / 70))));
}, { capture: true, passive: true });
addEventListener('touchend', () => {
  if (!armed) return;
  armed = false;
  for (const p of document.querySelectorAll('.pull-armed')) p.classList.remove('pull-armed');
  store.sync().then(() => { if (!store.error) toast('Up to date'); });
}, { passive: true });

// ---------- meeting countdowns ----------

// Every 15 s: refresh "in 23 min". Re-render when a meeting ends (Join gives way to the recap) or comes within
// 5 minutes of starting (Record in Glean appears).
function tickMeetings() {
  let ended = false;
  const now = Date.now();
  for (const el of document.querySelectorAll('.mtg-status[data-start]')) {
    const st = meetingStatus(+el.dataset.start, +el.dataset.end);
    if (st.cls === 'is-ended' && !el.classList.contains('is-ended')) ended = true;
    const wantRecord = now >= +el.dataset.start - RECORD_LEAD && now < +el.dataset.end;
    if (wantRecord !== !!el.parentElement.querySelector('.mtg-record')) ended = true;
    el.textContent = st.text;
    el.className = `mtg-status ${st.cls}`;
  }
  if (ended) { registry.clear(); nav.refreshAll(); }
}
setInterval(tickMeetings, 15_000);

// ---------- keep fresh ----------

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  tickMeetings();
  if (Date.now() - store.syncedAt > 60_000) store.sync();
});
addEventListener('online', () => store.sync());

// ---------- start ----------

for (const t of tabsFor(store.profile.id)) nav.stack(t.id);
nav.restore(history.state?.profile && history.state.profile !== store.profile.id ? null : history.state);
chrome();
store.sync();
document.documentElement.classList.add('ready');
