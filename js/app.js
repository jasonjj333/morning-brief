import { Store, target } from './store.js';
import { nextRunLabel } from './render.js';
import { Navigator } from './nav.js';
import { openSheet, toast, closeAllSheets } from './sheet.js';
import { wireSwipes } from './swipe.js';
import { animate, spring } from './motion.js';
import {
  todayView, actionsView, eventsView, notesView, noteView, feedbackView,
  itemSheetHTML, addSheetHTML, settingsSheetHTML, dayItemsHTML, placeThumb, registry, ago,
} from './views.js';

const store = new Store();
const $ = (s, r = document) => r.querySelector(s);

const TABS = [
  { id: 'today', label: 'Today', route: 'today', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 5v2.5M5.4 9.4l1.7 1.4M18.6 9.4l-1.7 1.4"/></svg>' },
  { id: 'actions', label: 'Actions', route: 'actions', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.7-5.2"/></svg>' },
  { id: 'events', label: 'Upcoming', route: 'events', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>' },
  { id: 'notes', label: 'Notes', route: 'notes', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6"/></svg>' },
  { id: 'feedback', label: 'Feedback', route: 'feedback', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v9a1.5 1.5 0 0 1-1.5 1.5h-9l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 16V7A1.5 1.5 0 0 1 5 5.5z"/></svg>' },
];

function makeView(route) {
  if (route.startsWith('note:')) return noteView(store, route.slice(5));
  return { today: todayView, actions: actionsView, events: eventsView, notes: notesView, feedback: feedbackView }[route](store);
}

const nav = new Navigator($('#stage'), $('.tabbar'), TABS, makeView);

// ---------- re-render on data changes ----------

let raf = 0;
store.addEventListener('change', () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    registry.clear();
    nav.refreshAll();
    chrome();
  });
});

function chrome() {
  $('[data-bind="scope"]').textContent = store.dev ? 'Local preview' : `${store.config.owner}/${store.config.repo}`;
  $('[data-bind="fresh"]').textContent = store.syncing ? 'Syncing…' : store.commit?.date ? `Updated ${ago(store.commit.date)}` : '';
  nav.setCount('feedback', store.pending.length);
  document.body.classList.toggle('is-syncing', store.syncing);
}

// ---------- taps ----------

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-note]');
  if (link) {
    e.preventDefault();
    closeAllSheets();
    const path = link.dataset.note;
    if (nav.current?.view.route === 'note:' + path) return;
    nav.push('note:' + path);
    return;
  }
  const act = e.target.closest('[data-action]');
  if (act) {
    const a = act.dataset.action;
    if (a === 'settings') return settingsSheet();
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

function settingsSheet() {
  openSheet({
    title: 'Settings',
    body: settingsSheetHTML(store),
    onMount({ sheet, close }) {
      const form = sheet.querySelector('[data-settings]');
      const status = sheet.querySelector('[data-settings-status]');
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
        close();
        toast('Connected');
      });
      sheet.querySelector('[data-signout]')?.addEventListener('click', () => { store.signOut(); close(); toast('Token removed from this device'); });
    },
  });
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

// ---------- keep fresh ----------

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - store.syncedAt > 60_000) store.sync();
});
addEventListener('online', () => store.sync());

// ---------- start ----------

for (const t of TABS) nav.stack(t.id);
nav.restore(history.state);
chrome();
store.sync();
document.documentElement.classList.add('ready');
