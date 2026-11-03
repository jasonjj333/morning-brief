import { esc, inline, plain, splitFrontmatter, stripLeadEmoji, splitItem } from './md.js';
import { Ctx, renderBlocks, rowHTML, parseNote, sections, noteTitle, friendlyName, registry, resolveNote, nextRunLabel } from './render.js';

const DAILY = 'Daily/';
const ACTIONS = 'Home Dashboard/Action Items.md';
const EVENTS = 'Home Dashboard/Upcoming Events.md';

// ---------- dates ----------

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const longDate = (d) => `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
const shortDate = (d) => `${DOW[d.getDay()].slice(0, 3)}, ${MON[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const sameDay = (a, b) => a && b && a.getTime() === b.getTime();

export function ago(iso) {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = new Date(iso);
  return shortDate(d);
}
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// "Wed 11/4 · 1:30" → { date, time }
function cellDate(cell, ref = today()) {
  const m = /(\d{1,2})\/(\d{1,2})/.exec(cell);
  if (!m) return { date: null, time: null };
  let y = ref.getFullYear();
  const mo = +m[1] - 1, da = +m[2];
  if (mo < ref.getMonth() - 6) y++;
  const t = /·\s*([\d:]+(?:\s*[–-]\s*[\d:]+)?\s*(?:am|pm)?)/i.exec(cell);
  return { date: new Date(y, mo, da), time: t ? t[1].replace(/\s+/g, '') : null };
}

// Meeting clocks in the brief are written "9:30" or "3:00" (business hours); read 1–6 as afternoon.
function minutesOf(time) {
  const m = /^(\d{1,2})(?::(\d{2}))?/.exec(time ?? '');
  if (!m) return null;
  let h = +m[1];
  if (/pm/i.test(time) && h < 12) h += 12;
  else if (!/am/i.test(time) && h >= 1 && h <= 6) h += 12;
  return h * 60 + (+m[2] || 0);
}

const nameHue = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return Math.round(h / 60) * 60 + 20; };

// ---------- shared bits ----------

const ICON = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
};
export { ICON };

const addButton = (kind = 'todo') => `<button class="icon-btn" type="button" data-action="add" data-kind="${kind}" aria-label="Add">${ICON.plus}</button>`;

function panel({ title, count, body, span = 12, cls = '', action = '' }) {
  return `<section class="panel span-${span} ${cls}">
    <header class="panel-head"><h2>${title}</h2>${count != null ? `<span class="count">${count}</span>` : ''}${action}</header>
    ${body}
  </section>`;
}

function syncBanner(store) {
  if (store.error) {
    return `<div class="banner banner-error" role="alert"><span>${esc(store.error.message)}</span><button type="button" class="text-btn" data-action="sync">Try again</button></div>`;
  }
  if (store.outbox.length) return `<div class="banner"><span>${store.outbox.length} change${store.outbox.length > 1 ? 's' : ''} not sent yet.</span><button type="button" class="text-btn" data-action="sync">Send now</button></div>`;
  return '';
}

function connectPanel() {
  return `<section class="panel span-12 connect">
    <header class="panel-head"><h2>Connect your vault</h2></header>
    <p>Morning Brief reads your notes straight from your private GitHub repo and writes your feedback back to it. Nothing is stored on this site.</p>
    <ol class="steps">
      <li>Open <a class="ext" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">GitHub → Fine-grained tokens</a>.</li>
      <li>Repository access: only <strong>pariveda-notes</strong>. Permissions: <strong>Contents — Read and write</strong>.</li>
      <li>Paste the token here. It stays in this browser only.</li>
    </ol>
    <button class="btn btn-primary" type="button" data-action="settings">Connect</button>
  </section>`;
}

function loading() { return '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>Loading your notes</div>'; }

// ---------- Today ----------

export function latestDaily(store) {
  return store.files(DAILY).filter((p) => /\d{4}-\d{2}-\d{2}\.md$/.test(p)).sort().pop() ?? null;
}

function upcoming(store) {
  const { blocks } = parseNote(store, EVENTS);
  const sec = sections(blocks);
  const next = sec.find(/next/i);
  const rows = [];
  for (const b of next?.blocks ?? []) if (b.t === 'table') for (const r of b.rows) {
    const { date, time } = cellDate(r.cells[0]);
    if (date) rows.push({ date, time, cells: r.cells, line: r.line });
  }
  return rows;
}

export function todayView(store) {
  return {
    route: 'today', title: 'Today',
    navRight: () => `<button class="icon-btn" type="button" data-action="settings" aria-label="Settings">${ICON.gear}</button>${addButton('todo')}`,
    render(el) {
      if (!store.connected) { el.innerHTML = `${heroHTML(store, null)}<div class="grid">${connectPanel()}</div>`; return; }
      const path = latestDaily(store);
      if (!path) { el.innerHTML = `${heroHTML(store, null)}${syncBanner(store)}${store.syncing && !store.hasData ? loading() : '<div class="grid">' + panel({ title: 'No brief yet', body: '<p class="muted">The first brief arrives at 7:00 on the next weekday.</p>' }) + '</div>'}`; return; }

      const ctx = new Ctx(store, path);
      const { data, blocks } = parseNote(store, path);
      const sec = sections(blocks);
      const top = sec.lead.find((b) => b.t === 'callout');
      const topList = top?.children.find((b) => b.t === 'list');

      const todo = sec.find(/to-?do/i);
      const todoList = todo?.blocks.find((b) => b.t === 'list');
      const todoOpen = todoList?.items.filter((i) => i.task && !i.checked).length ?? 0;
      const todoDone = todoList?.items.filter((i) => i.task && i.checked).length ?? 0;

      const meet = sec.find(/meeting/i);
      const meetTable = meet?.blocks.find((b) => b.t === 'table');
      const meetings = (meetTable?.rows ?? []).filter((r) => r.cells.some(Boolean)).map((r) => ({ ...r, canceled: /~~/.test(r.cells[1] ?? '') }));
      const live = meetings.filter((m) => !m.canceled);
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      const isToday = sameDay(parseYmd(data.date), today());
      const timed = live.filter((m) => minutesOf(m.cells[0]) != null);
      const nextMeeting = isToday ? timed.find((m) => minutesOf(m.cells[0]) >= nowMin - 15) : timed[0];

      const week = sec.find(/attention|this week/i);
      const weekTable = week?.blocks.find((b) => b.t === 'table');
      const weekRows = (weekTable?.rows ?? []).filter((r) => r.cells.some(Boolean));

      const yest = sec.find(/yesterday/i);
      const waiting = sec.find(/waiting/i);
      const sources = [...sec.list.flatMap((s) => s.blocks), ...sec.lead].find((b) => b.t === 'callout' && b.kind === 'quote');

      const pending = store.pending;
      const firstTop = topList?.items[0];
      const n = topList?.items.length ?? 0;
      const finding = firstTop ? `${['', 'One thing', 'Two things', 'Three things', 'Four things', 'Five things'][n] ?? `${n} things`} matter${n === 1 ? 's' : ''} today. First up: ${inline(splitItem(firstTop.text).main, ctx)}.` : '';

      // Tiles: one container split into four counts.
      const tiles = `<div class="tiles span-12">
        <div class="tile"><span class="tile-label">To do today</span><span class="tile-value">${todoOpen}</span><span class="tile-cap">${todoDone ? `${todoDone} done` : todoOpen ? 'None done yet' : 'All clear'}</span></div>
        <div class="tile"><span class="tile-label">Meetings today</span><span class="tile-value">${isToday ? live.length : '—'}</span><span class="tile-cap">${nextMeeting ? `Next ${esc(nextMeeting.cells[0])} · ${esc(plain(nextMeeting.cells[1]))}` : isToday ? 'Nothing left today' : 'Brief is from ' + esc(data.date ?? '')}</span></div>
        <div class="tile"><span class="tile-label">Due this week</span><span class="tile-value">${weekRows.length}</span><span class="tile-cap">${weekRows[0] ? `First ${esc(plain(weekRows[0].cells[0]))}` : 'Nothing due'}</span></div>
        <div class="tile"><span class="tile-label">Sent to Claude</span><span class="tile-value">${pending.length}</span><span class="tile-cap">${pending.length ? `Applied at ${nextRunLabel()}` : 'Nothing waiting'}</span></div>
      </div>`;

      ctx.section = 'Top 3 today';
      const topBody = topList ? `<ol class="rows rows-top">${topList.items.map((it) => rowHTML(ctx, { text: it.text, line: it.line })).join('')}</ol>` : '<p class="muted">No priorities in this brief.</p>';

      ctx.section = "Today's meetings";
      const meetBody = meetings.length ? `<ul class="rows">${meetings.map((m) => rowHTML(ctx, {
        text: `${m.cells[1]}${m.cells[2] ? ' — ' + m.cells[2] : ''}`, line: m.line, kind: 'row',
        extra: '',
      }).replace('<div class="row-body">', `<div class="row-body"><span class="row-time${m.canceled ? ' is-canceled' : ''}">${esc(m.cells[0])}</span>`)).join('')}</ul>` : '<p class="muted">No meetings.</p>';

      ctx.section = 'To-do today';
      const todoBody = (todoList ? renderBlocks([todoList], ctx) : '<p class="muted">Nothing to do.</p>')
        + `<button class="add-row" type="button" data-action="add" data-kind="todo">${ICON.plus}<span>Add a to-do</span></button>`;

      ctx.section = 'Needs attention this week';
      const weekBody = weekRows.length ? `<ul class="rows">${weekRows.map((r) => rowHTML(ctx, {
        text: `${r.cells[1]} — ${[r.cells[2], r.cells[3]].filter(Boolean).join(' · ')}`, line: r.line, kind: 'row',
      }).replace('<div class="row-body">', `<div class="row-body"><span class="row-time">${inline(r.cells[0], ctx)}</span>`)).join('')}</ul>` : '<p class="muted">Nothing due this week.</p>';

      let yestBody = '';
      if (yest) {
        ctx.section = 'Yesterday';
        const tldr = yest.blocks.find((b) => b.t === 'callout');
        const parts = [];
        let cur = null;
        for (const b of yest.blocks) {
          if (b.t === 'h' && b.level === 3) { cur = { title: stripLeadEmoji(b.text), blocks: [] }; parts.push(cur); }
          else if (cur && b !== tldr) cur.blocks.push(b);
        }
        yestBody = `${tldr ? `<div class="tldr">${renderBlocks(tldr.children, ctx)}</div>` : ''}
          <div class="yest-cols">${parts.map((p) => { ctx.section = `Yesterday · ${p.title}`; return `<div class="yest-col"><h3>${esc(p.title)}</h3>${renderBlocks(p.blocks, ctx)}</div>`; }).join('')}</div>`;
      }

      ctx.section = 'Waiting on others';
      const waitBody = waiting ? renderBlocks(waiting.blocks, ctx) : '<p class="muted">Nobody owes you anything.</p>';

      const pendBody = pending.length
        ? `<ul class="rows">${pending.slice(-4).reverse().map(feedbackRow).join('')}</ul><button class="text-btn" type="button" data-goto="feedback">See all feedback</button>`
        : '<p class="muted">Tap any item to confirm it, remove it, or tell Claude what to change. Claude applies it within the hour on weekdays.</p>';

      const yLabel = yest ? stripLeadEmoji(yest.title) : 'Yesterday';
      el.innerHTML = `
        ${heroHTML(store, data, finding)}
        ${syncBanner(store)}
        ${weekStrip(store)}
        <div class="grid">
          ${tiles}
          ${panel({ title: 'Top 3 today', body: topBody, span: 6, cls: 'panel-top' })}
          ${panel({ title: "Today's meetings", count: isToday ? live.length : null, body: meetBody, span: 6 })}
          ${panel({ title: 'To do today', count: todoOpen, body: todoBody, span: 6 })}
          ${panel({ title: 'This week', count: weekRows.length, body: weekBody, span: 6 })}
          ${yest ? panel({ title: esc(yLabel), body: yestBody, span: 12, cls: 'panel-yest' }) : ''}
          ${panel({ title: 'Waiting on others', body: waitBody, span: 6 })}
          ${panel({ title: 'Sent to Claude', count: pending.length || null, body: pendBody, span: 6 })}
          ${sources ? `<div class="span-12">${renderBlocks([sources], ctx)}</div>` : ''}
          <div class="span-12 foot-links"><a class="wl link-row" href="#" data-note="${esc(path)}"><span>Open the full brief</span>${ICON.chev}</a><a class="wl link-row" href="#" data-note="Home Dashboard/Home Dashboard.md"><span>Home Dashboard</span>${ICON.chev}</a></div>
        </div>`;
    },
  };
}

function heroHTML(store, data, finding = '') {
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  const d = parseYmd(data?.date) ?? today();
  const stale = data?.date && !sameDay(d, today());
  const when = store.commit?.date ? `updated ${ago(store.commit.date)}` : '';
  return `<header class="hero">
    <h1 class="greeting large-title">Good ${part}, ${esc(store.config.name || 'Jason')}.</h1>
    <p class="dateline">${esc(longDate(today()))}${stale ? ` · showing the brief from ${esc(shortDate(d))}` : ''}${when ? ` · ${esc(when)}` : ''}</p>
    ${finding ? `<p class="finding">${finding}</p>` : ''}
  </header>`;
}

// The week at a glance: Monday to Friday, with every dated item from Upcoming Events.
function weekStrip(store) {
  const t = today();
  const mon = new Date(t);
  const dow = t.getDay();
  mon.setDate(t.getDate() + (dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow));
  const rows = upcoming(store);
  const days = Array.from({ length: 5 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
  return `<div class="week" role="list" aria-label="This week">${days.map((d) => {
    const items = rows.filter((r) => sameDay(r.date, d));
    const isT = sameDay(d, t);
    const past = d < t;
    return `<button class="day${isT ? ' is-today' : ''}${past ? ' is-past' : ''}" type="button" role="listitem" data-day="${ymd(d)}" aria-label="${esc(longDate(d))}, ${items.length} item${items.length === 1 ? '' : 's'}">
      <span class="day-name">${DOW[d.getDay()].slice(0, 3)}</span>
      <span class="day-num">${d.getDate()}</span>
      <span class="day-dots">${items.slice(0, 4).map(() => '<i></i>').join('')}</span>
      <span class="day-first">${items[0] ? esc(plain(items[0].cells[1])) : ''}</span>
    </button>`;
  }).join('')}</div>`;
}

export function dayItemsHTML(store, day) {
  const d = parseYmd(day);
  const ctx = new Ctx(store, EVENTS);
  ctx.section = 'Next 14 days';
  const items = upcoming(store).filter((r) => sameDay(r.date, d));
  if (!items.length) return '<p class="muted">Nothing on the calendar that needs you.</p>';
  return `<ul class="rows">${items.map((r) => rowHTML(ctx, { text: `${r.cells[1]} — ${[r.cells[2], r.cells[3]].filter(Boolean).join(' · ')}`, line: r.line, kind: 'row' })
    .replace('<div class="row-body">', `<div class="row-body"><span class="row-time">${esc(r.time ?? 'All day')}</span>`)).join('')}</ul>`;
}

// ---------- Actions ----------

export function actionsView(store) {
  return {
    route: 'actions', title: 'Action items', shortTitle: 'Actions',
    navRight: () => addButton('todo'),
    render(el) {
      if (!store.connected) { el.innerHTML = `<h1 class="large-title page-title">Action items</h1><div class="grid">${connectPanel()}</div>`; return; }
      const ctx = new Ctx(store, ACTIONS);
      const { blocks } = parseNote(store, ACTIONS);
      const sec = sections(blocks);
      const open = (s) => s.blocks.filter((b) => b.t === 'list').flatMap((l) => l.items).filter((i) => i.task && !i.checked).length;
      const total = sec.list.reduce((n, s) => n + (/done/i.test(s.title) ? 0 : open(s)), 0);
      el.innerHTML = `
        <h1 class="large-title page-title">Action items</h1>
        <p class="subtitle">${total} open · swipe right to complete, left for a note or to remove</p>
        ${syncBanner(store)}
        <div class="grid">${sec.list.map((s) => {
          ctx.section = s.title;
          const body = renderBlocks(s.blocks.filter((b) => b.t !== 'p'), ctx) || '<p class="muted">Nothing here.</p>';
          const isDone = /done/i.test(s.title);
          return panel({ title: esc(s.title), count: isDone ? null : open(s), body, span: 12, cls: isDone ? 'panel-quiet' : '' });
        }).join('') || panel({ title: 'Nothing yet', body: '<p class="muted">The morning brief fills this list.</p>' })}</div>`;
    },
  };
}

// ---------- Events ----------

export function eventsView(store) {
  return {
    route: 'events', title: 'Upcoming', shortTitle: 'Upcoming',
    navRight: () => addButton('event'),
    render(el) {
      if (!store.connected) { el.innerHTML = `<h1 class="large-title page-title">Upcoming</h1><div class="grid">${connectPanel()}</div>`; return; }
      const ctx = new Ctx(store, EVENTS);
      const { blocks } = parseNote(store, EVENTS);
      const sec = sections(blocks);
      const rows = upcoming(store);
      const t = today();
      const tomorrow = new Date(t); tomorrow.setDate(t.getDate() + 1);
      const groups = [];
      for (const r of rows.sort((a, b) => a.date - b.date || (minutesOf(a.time) ?? 0) - (minutesOf(b.time) ?? 0))) {
        const key = ymd(r.date);
        let g = groups.find((x) => x.key === key);
        if (!g) { g = { key, date: r.date, rows: [] }; groups.push(g); }
        g.rows.push(r);
      }
      ctx.section = 'Next 14 days';
      const label = (d) => sameDay(d, t) ? `Today · ${shortDate(d)}` : sameDay(d, tomorrow) ? `Tomorrow · ${shortDate(d)}` : longDate(d);
      const list = groups.map((g) => `<section class="panel span-12${g.date < t ? ' panel-quiet' : ''}">
          <header class="panel-head"><h2>${esc(label(g.date))}</h2></header>
          <ul class="rows">${g.rows.map((r) => rowHTML(ctx, { text: `${r.cells[1]} — ${[r.cells[2], r.cells[3]].filter(Boolean).join(' · ')}`, line: r.line, kind: 'row' })
            .replace('<div class="row-body">', `<div class="row-body"><span class="row-time">${esc(r.time ?? 'All day')}</span>`)).join('')}</ul>
        </section>`).join('');
      const tbd = sec.find(/tbd/i);
      ctx.section = 'Date TBD';
      const tbdTable = tbd?.blocks.find((b) => b.t === 'table');
      const tbdBody = tbdTable ? `<ul class="rows">${tbdTable.rows.filter((r) => r.cells.some(Boolean) && !/^\*\(/.test(r.cells[0])).map((r) => rowHTML(ctx, { text: `${r.cells[0]} — ${[r.cells[1], r.cells[2]].filter(Boolean).join(' · ')}`, line: r.line, kind: 'row' })).join('')}</ul>` : '';
      const rest = sec.list.filter((s) => !/next|tbd/i.test(s.title)).flatMap((s) => s.blocks);
      const tail = [...(tbd?.blocks.filter((b) => b.t !== 'table') ?? []), ...rest];
      el.innerHTML = `
        <h1 class="large-title page-title">Upcoming</h1>
        <p class="subtitle">The next two weeks, soonest first</p>
        ${syncBanner(store)}
        <div class="grid">
          ${list || panel({ title: 'Nothing scheduled', body: '<p class="muted">The morning brief adds dates from your calendar, email and Slack.</p>' })}
          ${tbdBody ? panel({ title: 'Date to be set', body: tbdBody }) : ''}
          ${tail.length ? `<div class="span-12">${renderBlocks(tail, ctx)}</div>` : ''}
        </div>`;
    },
  };
}

// ---------- Notes ----------

export function notesView(store) {
  const state = { seg: 'meetings', q: '' };
  const segs = [['meetings', 'Meetings'], ['briefs', 'Briefs'], ['dashboard', 'Dashboard'], ['all', 'All']];
  return {
    route: 'notes', title: 'Notes',
    render(el) {
      if (!store.connected) { el.innerHTML = `<h1 class="large-title page-title">Notes</h1><div class="grid">${connectPanel()}</div>`; return; }
      el.innerHTML = `
        <h1 class="large-title page-title">Notes</h1>
        <label class="search">${ICON.search}<input type="search" placeholder="Search notes" value="${esc(state.q)}" aria-label="Search notes" enterkeyhint="search"></label>
        <div class="segmented" role="tablist" aria-label="Note type">
          <span class="seg-thumb" aria-hidden="true"></span>
          ${segs.map(([k, l]) => `<button type="button" role="tab" data-seg="${k}" aria-selected="${state.seg === k}">${l}</button>`).join('')}
        </div>
        <div class="note-list"></div>`;
      const list = el.querySelector('.note-list');
      const draw = () => { list.innerHTML = noteListHTML(store, state); };
      draw();
      placeThumb(el.querySelector('.segmented'), false);
      el.querySelector('input').addEventListener('input', (e) => { state.q = e.target.value; draw(); });
      el.querySelector('.segmented').addEventListener('click', (e) => {
        const b = e.target.closest('[data-seg]');
        if (!b || b.dataset.seg === state.seg) return;
        state.seg = b.dataset.seg;
        for (const x of el.querySelectorAll('[data-seg]')) x.setAttribute('aria-selected', String(x === b));
        placeThumb(el.querySelector('.segmented'), true);
        draw();
      });
    },
    onShow() { const s = this.page?.content.querySelector('.segmented'); if (s) placeThumb(s, false); },
  };
}

export function placeThumb(seg, animateIt) {
  const sel = seg.querySelector('[aria-selected="true"]');
  const thumb = seg.querySelector('.seg-thumb');
  if (!sel || !thumb) return;
  const x = sel.offsetLeft, w = sel.offsetWidth;
  if (!animateIt) { thumb.style.transform = `translateX(${x}px)`; thumb.style.width = `${w}px`; return; }
  const from = thumb.style.transform || 'translateX(0px)';
  thumb.style.width = `${w}px`;
  thumb.animate([{ transform: from }, { transform: `translateX(${x}px)` }], { duration: 340, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
  thumb.style.transform = `translateX(${x}px)`;
}

function noteListHTML(store, { seg, q }) {
  let files = store.files().filter((p) => p.endsWith('.md'));
  if (seg === 'meetings') files = files.filter((p) => p.startsWith('Meetings/'));
  if (seg === 'briefs') files = files.filter((p) => p.startsWith(DAILY));
  if (seg === 'dashboard') files = files.filter((p) => p.startsWith('Home Dashboard/'));
  const needle = q.trim().toLowerCase();
  if (needle) files = files.filter((p) => p.toLowerCase().includes(needle) || (store.text(p) ?? '').toLowerCase().includes(needle));
  files.sort((a, b) => (seg === 'dashboard' ? a.localeCompare(b) : b.localeCompare(a)));
  if (!files.length) return `<p class="muted empty">${needle ? 'No notes match.' : 'No notes here yet.'}</p>`;
  return `<ul class="list-card">${files.map((p) => {
    const { data } = splitFrontmatter(store.text(p) ?? '');
    let title = noteTitle(p).replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, '');
    const d = parseYmd(data.date ?? noteTitle(p));
    if (p.startsWith(DAILY) && d) title = `Brief for ${longDate(d)}`;
    const who = Array.isArray(data.attendees) ? data.attendees.length : 0;
    const sub = [d ? shortDate(d) : null, who ? `${who} attendee${who > 1 ? 's' : ''}` : null, seg === 'all' ? p.split('/').slice(0, -1).join('/') || 'Vault' : null].filter(Boolean).join(' · ');
    return `<li><a class="note-row wl" href="#" data-note="${esc(p)}"><span class="note-row-text"><span class="note-row-title">${esc(title)}</span>${sub ? `<span class="note-row-sub">${esc(sub)}</span>` : ''}</span>${ICON.chev}</a></li>`;
  }).join('')}</ul>`;
}

// ---------- One note ----------

export function noteView(store, path) {
  const short = noteTitle(path).replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, '');
  return {
    route: 'note:' + path, title: short, shortTitle: short.length > 14 ? 'Back' : short,
    render(el) {
      const text = store.text(path);
      if (text == null) { el.innerHTML = `<h1 class="large-title page-title">${esc(short)}</h1><p class="muted">This note isn't in the vault any more.</p>`; return; }
      const ctx = new Ctx(store, path);
      const { data, blocks } = parseNote(store, path);
      let body = blocks;
      if (body[0]?.t === 'h' && body[0].level === 1) body = body.slice(1);
      // The header shows these, so drop the duplicated label lines.
      body = body.filter((b) => !(b.t === 'p' && /^\*\*(Date|Attendees|Glean summary|Transcript):\*\*/.test(b.text)));
      const d = parseYmd(data.date);
      const people = Array.isArray(data.attendees) ? data.attendees : [];
      const links = [
        data.source ? `<a class="chip-link ext" href="${esc(data.source)}" target="_blank" rel="noopener noreferrer">Glean summary</a>` : '',
        /^https?:/.test(data.transcript ?? '') ? `<a class="chip-link ext" href="${esc(data.transcript)}" target="_blank" rel="noopener noreferrer">Transcript</a>` : '',
        data.zoom_link ? `<a class="chip-link ext" href="${esc(data.zoom_link)}" target="_blank" rel="noopener noreferrer">Zoom</a>` : '',
      ].join('');
      el.innerHTML = `
        <h1 class="large-title page-title">${esc(path.startsWith(DAILY) && d ? `Brief for ${longDate(d)}` : short)}</h1>
        <p class="subtitle">${esc([d ? longDate(d) : null, path.split('/').slice(0, -1).join(' / ')].filter(Boolean).join(' · '))}</p>
        ${people.length ? `<ul class="people">${people.map((n) => { const h = nameHue(n); return `<li class="person" data-hue="${h % 360}"><span class="avatar">${esc(n.trim()[0] ?? '?')}</span>${esc(n)}</li>`; }).join('')}</ul>` : ''}
        ${links ? `<div class="chips">${links}</div>` : ''}
        <article class="md">${path.endsWith('.base') ? '' : renderBlocks(body, ctx)}</article>`;
      // Pale identity tints per person, set through CSSOM (the CSP blocks inline style attributes).
      for (const p of el.querySelectorAll('.person')) p.style.setProperty('--hue', p.dataset.hue);
    },
  };
}

// ---------- Feedback ----------

const ACTION_LABEL = { confirm: 'Confirmed', remove: 'Remove', feedback: 'Note', add: 'New', done: 'Marked done', reopen: 'Reopened' };
const ACTION_TONE = { confirm: 'positive', remove: 'negative', feedback: 'neutral', add: 'accent', done: 'positive', reopen: 'neutral' };

function feedbackRow(f) {
  const what = f.target ? splitItem(f.target.text).main : f.add?.text ?? '';
  const kind = f.add ? ({ todo: 'To-do', event: 'Event', note: 'Note to Claude' }[f.add.kind] ?? 'New') : null;
  return `<li class="fb-row" data-fid="${esc(f.id)}">
    <div class="fb-main">
      <span class="pill pill-${ACTION_TONE[f.action] ?? 'neutral'}">${esc(kind ?? ACTION_LABEL[f.action] ?? f.action)}</span>
      <span class="fb-text">${esc(what)}</span>
    </div>
    ${f.note ? `<p class="fb-note">“${esc(f.note)}”</p>` : ''}
    ${f.add?.due ? `<p class="fb-meta">Due ${esc(f.add.due)}</p>` : ''}
    <p class="fb-meta">${esc(ago(f.at))}${f.target?.file ? ` · ${esc(friendlyName(f.target.file))}` : ''}</p>
  </li>`;
}

// Check-offs already changed the note, so only notes, removals and additions can be withdrawn.
const withdrawable = (f) => feedbackRow(f).replace('</li>', /^(done|reopen)$/.test(f.action) ? '</li>' : `<button class="text-btn fb-withdraw" type="button" data-withdraw="${esc(f.id)}">Withdraw</button></li>`);

export function feedbackView(store) {
  return {
    route: 'feedback', title: 'Feedback',
    navRight: () => addButton('note'),
    render(el) {
      if (!store.connected) { el.innerHTML = `<h1 class="large-title page-title">Feedback</h1><div class="grid">${connectPanel()}</div>`; return; }
      const pending = [...store.pending].reverse();
      const done = [...store.processed].reverse().slice(0, 40);
      el.innerHTML = `
        <h1 class="large-title page-title">Feedback</h1>
        <p class="subtitle">Claude applies these at half past every hour on weekdays. Next run ${esc(nextRunLabel())}.</p>
        ${syncBanner(store)}
        <div class="grid">
          ${panel({ title: 'Waiting for the next run', count: pending.length || null, body: pending.length ? `<ul class="rows fb-list">${pending.map(withdrawable).join('')}</ul>` : '<p class="muted">Nothing waiting. Tap any item in your brief to confirm it, remove it, or add a note.</p>' })}
          ${panel({ title: 'Applied', body: done.length ? `<ul class="rows fb-list">${done.map((f) => feedbackRow(f).replace('</li>', `${f.resolution ? `<p class="fb-resolution">${esc(f.resolution)}</p>` : ''}<p class="fb-meta">Applied ${esc(ago(f.processed ?? f.at))}</p></li>`)).join('')}</ul>` : '<p class="muted">Nothing applied yet.</p>', cls: 'panel-quiet' })}
        </div>`;
    },
  };
}

// ---------- sheets ----------

export function itemSheetHTML(store, item, { showOpen = true } = {}) {
  const { main, meta } = splitItem(item.raw.replace(/^>?\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '').replace(/^\|/, ''));
  const ctx = new Ctx(store, item.file);
  const mine = store.pending.filter((f) => f.target && f.target.file === item.file && f.target.raw === item.raw);
  const isRow = item.kind === 'row';
  return `
    <div class="item-preview">
      <p class="item-main">${isRow ? esc(item.text) : inline(main, ctx)}</p>
      ${!isRow && meta ? `<p class="item-meta">${inline(meta, ctx)}</p>` : ''}
      <p class="item-where">${esc(friendlyName(item.file))}${item.section ? ` · ${esc(item.section)}` : ''}</p>
    </div>
    ${item.kind === 'task' ? `<button class="btn btn-primary btn-wide" type="button" data-sheet="toggle">${item.checked ? 'Mark not done' : 'Mark done'}</button>` : ''}
    <div class="btn-pair">
      <button class="btn" type="button" data-sheet="confirm">Looks right</button>
      <button class="btn btn-danger" type="button" data-sheet="remove">Remove</button>
    </div>
    <label class="field">
      <span class="field-label">Tell Claude what to change</span>
      <textarea rows="3" placeholder="It moved to Friday. Or: this is done, someone else owns it now." data-sheet-note></textarea>
    </label>
    <button class="btn btn-primary btn-wide" type="button" data-sheet="send" disabled>Send note</button>
    ${mine.length ? `<div class="item-pending"><h3>Already sent</h3><ul class="rows fb-list">${mine.map(withdrawable).join('')}</ul></div>` : ''}
    ${showOpen && resolveNote(store, item.file) ? `<a class="wl link-row" href="#" data-note="${esc(item.file)}"><span>Open ${esc(friendlyName(item.file))}</span>${ICON.chev}</a>` : ''}`;
}

export function addSheetHTML(kind = 'todo') {
  const kinds = [['todo', 'To-do'], ['event', 'Event'], ['note', 'Note to Claude']];
  return `
    <div class="segmented" role="tablist" aria-label="What to add">
      <span class="seg-thumb" aria-hidden="true"></span>
      ${kinds.map(([k, l]) => `<button type="button" role="tab" data-seg="${k}" aria-selected="${k === kind}">${l}</button>`).join('')}
    </div>
    <label class="field">
      <span class="field-label" data-add-label>${kind === 'note' ? 'What should Claude know or do?' : kind === 'event' ? 'What is happening?' : 'What needs doing?'}</span>
      <textarea rows="3" autofocus data-add-text placeholder="${kind === 'note' ? 'Skip channels I am not in when you recap Slack.' : kind === 'event' ? 'Sprint demo with the client' : 'Send the follow-up questions'}"></textarea>
    </label>
    <label class="field" data-add-due${kind === 'note' ? ' hidden' : ''}>
      <span class="field-label">${kind === 'event' ? 'Date' : 'Due date (optional)'}</span>
      <input type="date" data-add-date>
    </label>
    <button class="btn btn-primary btn-wide" type="button" data-add-send disabled>Send to Claude</button>
    <p class="muted small">Claude adds it to your notes at ${esc(nextRunLabel())}.</p>`;
}

export function settingsSheetHTML(store) {
  const c = store.config;
  return `
    <form class="settings" data-settings>
      <label class="field"><span class="field-label">Your first name</span><input name="name" value="${esc(c.name)}" autocomplete="given-name"></label>
      <div class="field-row">
        <label class="field"><span class="field-label">GitHub owner</span><input name="owner" value="${esc(c.owner)}" autocapitalize="off" spellcheck="false"></label>
        <label class="field"><span class="field-label">Repository</span><input name="repo" value="${esc(c.repo)}" autocapitalize="off" spellcheck="false"></label>
      </div>
      <label class="field"><span class="field-label">Branch</span><input name="branch" value="${esc(c.branch)}" autocapitalize="off" spellcheck="false"></label>
      <label class="field">
        <span class="field-label">Access token</span>
        <input name="token" type="password" value="" placeholder="${c.token ? 'Saved · paste a new one to replace it' : 'github_pat_…'}" autocomplete="off" spellcheck="false" aria-describedby="token-help">
        <span class="field-help" id="token-help">A fine-grained token with access to this one repository and <strong>Contents: Read and write</strong>. <a class="ext" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Create one on GitHub</a>. It is kept in this browser only.</span>
      </label>
      <p class="status" data-settings-status>${store.commit?.date ? `Last synced ${esc(ago(new Date(store.syncedAt).toISOString()))} · latest commit ${esc(clock(store.commit.date))} “${esc(store.commit.message)}”` : ''}</p>
      <button class="btn btn-primary btn-wide" type="submit">Save and sync</button>
      ${c.token ? '<button class="btn btn-danger btn-wide" type="button" data-signout>Forget token on this device</button>' : ''}
    </form>`;
}

export { registry };
