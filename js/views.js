import { esc, inline, plain, splitFrontmatter, stripLeadEmoji, splitItem } from './md.js';
import { scheduleEditorHTML, nextRunLine } from './schedule-ui.js';
import { swapContent } from './press.js';
import { Ctx, renderBlocks, rowHTML, parseNote, sections, noteTitle, friendlyName, registry, resolveNote, nextRunLabel, draftFor } from './render.js';

const DAILY = 'Daily/';
const ACTIONS = 'Home Dashboard/Action Items.md';
const EVENTS = 'Home Dashboard/Upcoming Events.md';

// ---------- dates ----------

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
export const longDate = (d) => `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
export const shortDate = (d) => `${DOW[d.getDay()].slice(0, 3)}, ${MON[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
export const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const sameDay = (a, b) => a && b && a.getTime() === b.getTime();

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
export function cellDate(cell, ref = today()) {
  const m = /(\d{1,2})\/(\d{1,2})/.exec(cell);
  if (!m) return { date: null, time: null };
  let y = ref.getFullYear();
  const mo = +m[1] - 1, da = +m[2];
  if (mo < ref.getMonth() - 6) y++;
  const t = /·\s*([\d:]+(?:\s*[–-]\s*[\d:]+)?\s*(?:am|pm)?)/i.exec(cell);
  return { date: new Date(y, mo, da), time: t ? t[1].replace(/\s+/g, '') : null };
}

// Meeting clocks in the brief are written "9:30" or "3:00" (business hours); read 1–6 as afternoon.
export function minutesOf(time) {
  const m = /^(\d{1,2})(?::(\d{2}))?/.exec(time ?? '');
  if (!m) return null;
  let h = +m[1];
  if (/pm/i.test(time) && h < 12) h += 12;
  else if (!/am/i.test(time) && h >= 1 && h <= 6) h += 12;
  return h * 60 + (+m[2] || 0);
}

// The meetings table: columns are found by header, so older three-column briefs still read.
const firstUrl = (cell) => (/\((https?:[^)\s]+)\)/.exec(cell ?? '') || /(https?:\/\/[^\s)|]+)/.exec(cell ?? '') || [])[1] ?? null;

export function meetingRows(table, dateStr) {
  const head = (table?.head ?? []).map((x) => plain(x).toLowerCase());
  const col = (re, d) => { const i = head.findIndex((x) => re.test(x)); return i >= 0 ? i : d; };
  const ci = { time: col(/time/, 0), name: col(/meeting/, 1), prep: col(/prep|note/, 2), join: col(/join/, -1), outlook: col(/outlook/, -1), recap: col(/recap/, -1) };
  const day = parseYmd(dateStr) ?? today();
  const at = (m) => (m == null ? null : new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60).getTime());
  return (table?.rows ?? []).filter((r) => r.cells.some(Boolean)).map((r) => {
    const get = (i) => (i >= 0 ? r.cells[i] ?? '' : '');
    const time = plain(get(ci.time));
    const [a, b] = time.split(/\s*[–-]\s*/);
    const sm = minutesOf(a);
    let em = b ? minutesOf(b) : null;
    if (sm != null && (em == null || em <= sm)) em = sm + 30;
    return {
      ...r, timeLabel: a || time || '—', start: at(sm), end: at(em),
      name: get(ci.name), prep: get(ci.prep), join: firstUrl(get(ci.join)), outlook: firstUrl(get(ci.outlook)), recap: get(ci.recap),
      canceled: /~~/.test(get(ci.name)),
    };
  });
}

export const RECORD_LEAD = 5 * 60_000;
// Glean starts a new meeting note at /notes/new. It ignores the title parameter (notes start "Untitled"), so the
// app also copies the meeting name when the button is used.
export const gleanNoteUrl = (title) => `https://app.glean.com/notes/new?title=${encodeURIComponent(title)}`;

// "in 23 min" within the hour, like Outlook; "Now · 12 min left" while it runs.
export function meetingStatus(start, end, now = Date.now()) {
  if (start == null) return { text: '', cls: '' };
  if (now >= end) return { text: 'Ended', cls: 'is-ended' };
  if (now >= start) return { text: `Now · ${Math.max(1, Math.round((end - now) / 60000))} min left`, cls: 'is-now' };
  const m = Math.round((start - now) / 60000);
  if (m <= 60) return { text: m <= 1 ? 'Starting now' : `in ${m} min`, cls: 'is-soon' };
  const h = Math.floor(m / 60), mm = m % 60;
  return { text: `in ${h} h${mm ? ` ${mm} min` : ''}`, cls: '' };
}

function meetingHTML(store, ctx, m, isToday) {
  const st = isToday ? meetingStatus(m.start, m.end) : { text: '', cls: '' };
  const ended = st.cls === 'is-ended';
  const status = st.text ? `<span class="mtg-status ${st.cls}" data-start="${m.start}" data-end="${m.end}">${esc(st.text)}</span>` : '';
  const join = m.join && !ended && !m.canceled ? `<a class="mtg-join ext" href="${esc(m.join)}" target="_blank" rel="noopener noreferrer">Join</a>` : '';
  const outlook = m.outlook ? `<a class="mtg-link ext" href="${esc(m.outlook)}" target="_blank" rel="noopener noreferrer">Outlook</a>` : '';
  let recap = '';
  if (ended && !m.canceled) {
    const link = /\[\[([^\]|]+)/.exec(m.recap ?? '')?.[1];
    const path = link ? resolveNote(store, link) : resolveNote(store, `${noteTitle(ctx.file)} - ${plain(m.name)}`);
    const summary = (m.recap ?? '').replace(/\s*·?\s*\[\[[^\]]+\]\]\s*$/, '').trim();
    recap = summary
      ? `<div class="mtg-recap">${inline(summary, ctx)}</div>`
      : `<div class="mtg-recap muted">Recap appears here once the transcript is ready.</div>`;
    if (path) recap += `<a class="mtg-more wl" href="#" data-note="${esc(path)}">View full breakdown${ICON.chev}</a>`;
  }
  // Record in Glean: from 5 minutes before the start until the meeting ends.
  const recordable = isToday && !m.canceled && m.start != null && Date.now() >= m.start - RECORD_LEAD && Date.now() < m.end;
  const record = recordable ? `<a class="mtg-record ext" href="${esc(gleanNoteUrl(plain(m.name)))}" target="_blank" rel="noopener noreferrer" data-title="${esc(plain(m.name))}"><span class="rec-dot" aria-hidden="true"></span>Record in Glean</a>` : '';
  const line = status || join || outlook ? `<div class="mtg-line">${status}${record}${join}${outlook}</div>` : '';
  const text = ended || !m.prep ? m.name : `${m.name} — ${m.prep}`;
  return rowHTML(ctx, { text, line: m.line, kind: 'row', extra: line + recap })
    .replace('<li class="row', `<li class="row mtg${ended ? ' is-past' : ''}`)
    .replace('<div class="row-body">', `<div class="row-body"><span class="row-time${m.canceled ? ' is-canceled' : ''}">${esc(m.timeLabel)}</span>`);
}

export const nameHue = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return Math.round(h / 60) * 60 + 20; };

// ---------- shared bits ----------

const ICON = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
  run: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M10.2 8.6l5 3.4-5 3.4z"/></svg>',
};
export { ICON };

export const addButton = (kind = 'todo') => `<button class="icon-btn" type="button" data-action="add" data-kind="${kind}" aria-label="Add">${ICON.plus}</button>`;

export function panel({ title, count, body, span = 12, cls = '', action = '' }) {
  return `<section class="panel span-${span} ${cls}">
    <header class="panel-head"><h2>${title}</h2>${count != null ? `<span class="count">${count}</span>` : ''}${action}</header>
    ${body}
  </section>`;
}

export function syncBanner(store) {
  if (store.error) {
    return `<div class="banner banner-error" role="alert"><span>${esc(store.error.message)}</span><button type="button" class="text-btn" data-action="sync">Try again</button></div>`;
  }
  if (store.outbox.length) return `<div class="banner"><span>${store.outbox.length} change${store.outbox.length > 1 ? 's' : ''} not sent yet.</span><button type="button" class="text-btn" data-action="sync">Send now</button></div>`;
  return '';
}

export function connectPanel(store) {
  return `<section class="panel span-12 connect">
    <header class="panel-head"><h2>Connect your vault</h2></header>
    <p>Morning Brief reads your notes straight from your private GitHub repo and writes your feedback back to it. Nothing is stored on this site.</p>
    <ol class="steps">
      <li>Open <a class="ext" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">GitHub → Fine-grained tokens</a>.</li>
      <li>Repository access: <strong>${esc(store.config.repo)}</strong>${store.profile.id === 'personal' ? ' (or edit your work token and add it there)' : ''}. Permissions: <strong>Contents — Read and write</strong>.</li>
      <li>Paste the token here. It stays in this browser only.</li>
    </ol>
    <button class="btn btn-primary" type="button" data-action="settings">Connect</button>
  </section>`;
}

export function loading() { return '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>Loading your notes</div>'; }

// ---------- What I did today ----------

// Unsaved text survives redraws (a sync, a profile switch) until it's saved.
export const journalDrafts = new Map();
// The day a note is about: until 5:00 AM (before the morning brief) a note still counts for the day before,
// so one written at 1 AM lands in the stand-up notes the brief writes that morning.
export const JOURNAL_ROLLOVER = 5;
export function journalDay(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() < JOURNAL_ROLLOVER) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}
export const journalPath = (d = journalDay()) => `Journal/${ymd(d)}.md`;
export function journalSaved(store, path) {
  const text = store.text(path);
  if (text == null) return { body: '', updated: null };
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const updated = m ? (/^updated:\s*(.+)$/m.exec(m[1]) || [])[1]?.trim() ?? null : null;
  return { body: (m ? text.slice(m[0].length) : text).replace(/^\n+/, '').replace(/\s+$/, ''), updated };
}
export function journalStatus(store, path) {
  const key = store.profile.id + ':' + path;
  if (journalDrafts.has(key)) return 'Not saved yet';
  const { updated } = journalSaved(store, path);
  return updated ? `Saved ${ago(updated)}` : '';
}

export function journalPanel(store, { span = 6 } = {}) {
  const day = journalDay();
  const path = journalPath(day);
  const late = !sameDay(day, today());
  const key = store.profile.id + ':' + path;
  const work = store.profile.id !== 'personal';
  const value = journalDrafts.get(key) ?? journalSaved(store, path).body;
  const help = work
    ? `Tomorrow's brief turns this into your stand-up notes, along with your meetings, Slack and email. Edit it any time before the next refresh.`
    : `Tomorrow's brief folds this into Since yesterday. Edit it any time before the next refresh.`;
  const placeholder = work
    ? 'Paired with De\'Aun on the Pelago account setup. Got SSO working in dev. Blocked on the AWS sandbox quota; asked Ben. Next: data migration script.'
    : 'Booked the dentist. Paid the water bill. Called Mom about Thanksgiving.';
  return panel({
    title: 'What I did today', span, cls: 'panel-journal',
    body: `<div class="journal" data-journal="${esc(path)}">
      <textarea class="journal-text" data-journal-text rows="5" placeholder="${esc(placeholder)}" aria-label="What I did today">${esc(value)}</textarea>
      <div class="journal-foot">
        <span class="journal-status" data-journal-status aria-live="polite">${esc(journalStatus(store, path))}</span>
        <button class="btn btn-small" type="button" data-journal-save${journalDrafts.has(key) ? '' : ' disabled'}>Save</button>
      </div>
      <p class="muted small">${late ? `It's after midnight, so this is saved as ${esc(DOW[day.getDay()])}'s note. ` : ''}${help}</p>
    </div>`,
  });
}

// ---------- Today ----------

export function latestDaily(store) {
  return store.files(DAILY).filter((p) => /\d{4}-\d{2}-\d{2}\.md$/.test(p)).sort().pop() ?? null;
}

export function upcoming(store) {
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
    navRight: () => `<button class="icon-btn" type="button" data-action="routines" aria-label="Run routines">${ICON.run}</button><button class="icon-btn" type="button" data-action="settings" aria-label="Settings">${ICON.gear}</button>${addButton('todo')}`,
    render(el) {
      if (!store.connected) { el.innerHTML = `${heroHTML(store, null)}<div class="grid">${connectPanel(store)}</div>`; return; }
      const path = latestDaily(store);
      if (!path) { el.innerHTML = `${heroHTML(store, null)}${syncBanner(store)}${store.syncing && !store.hasData ? loading() : '<div class="grid">' + panel({ title: 'No brief yet', body: '<p class="muted">The first brief arrives at 7:00 on the next weekday.</p>' }) + journalPanel(store, { span: 12 }) + '</div>'}`; return; }

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
      const meetings = meetingRows(meetTable, data.date);
      const live = meetings.filter((m) => !m.canceled);
      const isToday = sameDay(parseYmd(data.date), today());
      const timed = live.filter((m) => m.start != null);
      const nextMeeting = isToday ? timed.find((m) => m.end > Date.now()) : timed[0];

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
        <div class="tile"><span class="tile-label">Meetings today</span><span class="tile-value">${isToday ? live.length : '—'}</span><span class="tile-cap">${nextMeeting ? `${isToday && meetingStatus(nextMeeting.start, nextMeeting.end).cls ? esc(meetingStatus(nextMeeting.start, nextMeeting.end).text) : `Next ${esc(nextMeeting.timeLabel)}`} · ${esc(plain(nextMeeting.name))}` : isToday ? 'Nothing left today' : 'Brief is from ' + esc(data.date ?? '')}</span></div>
        <div class="tile"><span class="tile-label">Due this week</span><span class="tile-value">${weekRows.length}</span><span class="tile-cap">${weekRows[0] ? `First ${esc(plain(weekRows[0].cells[0]))}` : 'Nothing due'}</span></div>
        <div class="tile"><span class="tile-label">Sent to Claude</span><span class="tile-value">${pending.length}</span><span class="tile-cap">${pending.length ? `Applied at ${nextRunLabel()}` : 'Nothing waiting'}</span></div>
      </div>`;

      ctx.section = 'Top 3 today';
      // Project notes: one group per project (h3), then the team. Everything about them, not just what's for you.
      const proj = sec.find(/project notes/i);
      let projBody = '<p class="muted">Project and team updates start with the next morning brief.</p>';
      if (proj) {
        const lead = [], groups = [];
        let g = null;
        for (const b of proj.blocks) {
          if (b.t === 'h' && b.level === 3) { g = { title: stripLeadEmoji(b.text), blocks: [] }; groups.push(g); }
          else (g ? g.blocks : lead).push(b);
        }
        ctx.section = 'Project notes';
        projBody = (lead.length ? renderBlocks(lead, ctx) : '') + groups.map((x) => {
          ctx.section = `Project notes · ${x.title}`;
          return `<div class="proj-group"><h3 class="proj-title">${inline(x.title, ctx)}</h3>${renderBlocks(x.blocks, ctx)}</div>`;
        }).join('');
        if (!projBody.trim()) projBody = '<p class="muted">Nothing new on your projects.</p>';
      }

      ctx.section = "Today's meetings";
      const meetBody = meetings.length ? `<ul class="rows">${meetings.map((m) => meetingHTML(store, ctx, m, isToday)).join('')}</ul>` : '<p class="muted">No meetings.</p>';

      ctx.section = 'To-do today';
      const todoBody = (todoList ? renderBlocks([todoList], ctx) : '<p class="muted">Nothing to do.</p>')
        + `<button class="add-row" type="button" data-action="add" data-kind="todo">${ICON.plus}<span>Add a to-do</span></button>`;

      ctx.section = 'Needs attention this week';
      const weekBody = weekRows.length ? `<ul class="rows">${weekRows.map((r) => rowHTML(ctx, {
        text: `${r.cells[1]} — ${[r.cells[2], r.cells[3]].filter(Boolean).join(' · ')}`, line: r.line, kind: 'row',
      }).replace('<div class="row-body">', `<div class="row-body"><span class="row-time">${inline(r.cells[0], ctx)}</span>`)).join('')}</ul>` : '<p class="muted">Nothing due this week.</p>';

      let yestBody = '', standup = null, standupBody = '';
      if (yest) {
        ctx.section = 'Yesterday';
        const tldr = yest.blocks.find((b) => b.t === 'callout');
        const parts = [];
        let cur = null;
        for (const b of yest.blocks) {
          if (b.t === 'h' && b.level === 3) { cur = { title: stripLeadEmoji(b.text), blocks: [] }; parts.push(cur); }
          else if (cur && b !== tldr) cur.blocks.push(b);
        }
        standup = parts.find((p) => /stand-?up/i.test(p.title));
        const cols = parts.filter((p) => p !== standup);
        if (standup) { ctx.section = 'Yesterday · Stand-up notes'; standupBody = `<div class="standup" data-standup>${renderBlocks(standup.blocks, ctx)}</div>`; }
        yestBody = `${tldr ? `<div class="tldr">${renderBlocks(tldr.children, ctx)}</div>` : ''}
          <div class="yest-cols">${cols.map((p) => { ctx.section = `Yesterday · ${p.title}`; return `<div class="yest-col"><h3>${esc(p.title)}</h3>${renderBlocks(p.blocks, ctx)}</div>`; }).join('')}</div>`;
      }

      ctx.section = 'Waiting on others';
      const waitBody = waiting ? renderBlocks(waiting.blocks, ctx) : '<p class="muted">Nobody owes you anything.</p>';

      const yLabel = yest ? stripLeadEmoji(yest.title) : 'Yesterday';
      el.innerHTML = `
        ${heroHTML(store, data, finding)}
        ${syncBanner(store)}
        ${weekStrip(store)}
        <div class="grid">
          ${tiles}
          ${panel({ title: 'Project notes', body: projBody, span: 6, cls: 'panel-proj' })}
          ${panel({ title: "Today's meetings", count: isToday ? live.length : null, body: meetBody, span: 6 })}
          ${panel({ title: 'To do today', count: todoOpen, body: todoBody, span: 6 })}
          ${panel({ title: 'This week', count: weekRows.length, body: weekBody, span: 6 })}
          ${standup ? panel({ title: 'Stand-up notes', body: standupBody, span: 12, cls: 'panel-standup', action: `<button class="text-btn panel-action" type="button" data-copy-standup>Copy</button>` }) : ''}
          ${yest ? panel({ title: esc(yLabel), body: yestBody, span: 12, cls: 'panel-yest' }) : ''}
          ${panel({ title: 'Waiting on others', body: waitBody, span: 6 })}
          ${journalPanel(store, { span: 6 })}
          ${sources ? `<div class="span-12">${renderBlocks([sources], ctx)}</div>` : ''}
          <div class="span-12 foot-links"><a class="wl link-row" href="#" data-note="${esc(path)}"><span>Open the full brief</span>${ICON.chev}</a><a class="wl link-row" href="#" data-note="Home Dashboard/Home Dashboard.md"><span>Home Dashboard</span>${ICON.chev}</a><button class="link-row prio-link" type="button" data-open-priorities><span>Priorities</span><span class="link-meta">${esc(prioritySummary(store))}</span>${ICON.chev}</button></div>
        </div>`;
    },
  };
}

export function heroHTML(store, data, finding = '') {
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
export function weekStrip(store) {
  const t = today();
  const mon = new Date(t);
  const dow = t.getDay();
  const seven = store.profile?.id === 'personal';
  if (!seven) mon.setDate(t.getDate() + (dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow));
  const rows = upcoming(store);
  const days = Array.from({ length: seven ? 7 : 5 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
  return `<div class="week${seven ? ' week-7' : ''}" role="list" aria-label="${seven ? 'The next seven days' : 'This week'}">${days.map((d) => {
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
      if (!store.connected) { el.innerHTML = `<h1 class="large-title page-title">Action items</h1><div class="grid">${connectPanel(store)}</div>`; return; }
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
      if (!store.connected) { el.innerHTML = `<h1 class="large-title page-title">Upcoming</h1><div class="grid">${connectPanel(store)}</div>`; return; }
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
          ${list || panel({ title: 'Nothing scheduled', body: `<p class="muted">${store.profile?.id === 'personal' ? 'The morning brief adds appointments and bookings it finds in your email.' : 'The morning brief adds dates from your calendar, email and Slack.'}</p>` })}
          ${tbdBody ? panel({ title: 'Date to be set', body: tbdBody }) : ''}
          ${tail.length ? `<div class="span-12">${renderBlocks(tail, ctx)}</div>` : ''}
        </div>`;
    },
  };
}

// ---------- Notes ----------

export function notesView(store) {
  const state = { seg: 'meetings', q: '' };
  const segs = [['meetings', 'Meetings'], ['briefs', 'Briefs'], ['project', 'Project'], ['dashboard', 'Dashboard'], ['all', 'All']];
  return {
    route: 'notes', title: 'Notes',
    render(el) {
      if (!store.connected) { el.innerHTML = `<h1 class="large-title page-title">Notes</h1><div class="grid">${connectPanel(store)}</div>`; return; }
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
        const keys = segs.map(([k]) => k);
        const dir = Math.sign(keys.indexOf(b.dataset.seg) - keys.indexOf(state.seg)) || 1;
        state.seg = b.dataset.seg;
        for (const x of el.querySelectorAll('[data-seg]')) x.setAttribute('aria-selected', String(x === b));
        placeThumb(el.querySelector('.segmented'), true);
        swapContent(list, draw, dir);
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
  if (seg === 'project') files = files.filter((p) => p.startsWith('Projects/'));
  const needle = q.trim().toLowerCase();
  if (needle) files = files.filter((p) => p.toLowerCase().includes(needle) || (store.text(p) ?? '').toLowerCase().includes(needle));
  files.sort((a, b) => (seg === 'dashboard' || seg === 'project' ? a.localeCompare(b) : b.localeCompare(a)));
  if (!files.length) return `<p class="muted empty">${needle ? 'No notes match.' : 'No notes here yet.'}</p>`;
  return `<ul class="list-card">${files.map((p) => {
    const { data } = splitFrontmatter(store.text(p) ?? '');
    let title = noteTitle(p).replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, '');
    const d = parseYmd(data.date ?? noteTitle(p));
    if (p.startsWith(DAILY) && d) title = `Brief for ${longDate(d)}`;
    const who = Array.isArray(data.attendees) ? data.attendees.length : 0;
    const sub = [d ? shortDate(d) : null, who ? `${who} attendee${who > 1 ? 's' : ''}` : null, seg === 'all' ? p.split('/').slice(0, -1).join('/') || 'Vault' : seg === 'project' ? p.split('/').slice(2, -1).join(' / ') || 'Hub' : null].filter(Boolean).join(' · ');
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

const ACTION_LABEL = { confirm: 'Confirmed', remove: 'Remove', feedback: 'Note', add: 'New', done: 'Marked done', reopen: 'Reopened', block: 'Block', unblock: 'Unblock', unsubscribe: 'Unsubscribe', not_junk: 'Not junk' };
const ACTION_TONE = { confirm: 'positive', remove: 'negative', feedback: 'neutral', add: 'accent', done: 'positive', reopen: 'neutral', block: 'negative', unblock: 'neutral', unsubscribe: 'negative', not_junk: 'positive' };

export function feedbackRow(f) {
  const what = f.target ? splitItem(f.target.text).main : f.add?.text ?? (f.sender ? `${f.sender.name || f.sender.address}${f.sender.name ? ` · ${f.sender.address}` : ''}` : '');
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

// ---------- Priorities (work) ----------

export const PRIORITY_LISTS = [
  { key: 'projects', title: 'Projects', one: 'project', placeholder: 'Checkout redesign (client name, React)',
    help: 'Anything about these is high priority, wherever it comes up. Put other names for it in brackets so Claude can find it.' },
  { key: 'people', title: 'People', one: 'person', placeholder: 'Your project lead',
    help: 'What they ask of you, your team or your projects is high priority. Their posts elsewhere, like an IT question, aren’t.' },
  { key: 'channels', title: 'Slack channels', one: 'channel', placeholder: 'project-general', hash: true,
    help: 'Checked one by one every morning, private ones too. A post to everyone here counts even without an @mention.' },
  { key: 'quiet_channels', title: 'Never high priority', one: 'channel', placeholder: 'ask-internal-it', hash: true,
    help: 'Help desks and social channels. Posts here only make the brief when they name you, even from people above.' },
];

// "#Project General " → "project-general"; people and projects keep their own spelling.
export function cleanPriority(key, value) {
  const v = String(value ?? '').replace(/\s+/g, ' ').trim();
  const list = PRIORITY_LISTS.find((l) => l.key === key);
  return list?.hash ? v.replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase() : v;
}

export function priorityChipsHTML(store, key) {
  const list = PRIORITY_LISTS.find((l) => l.key === key);
  const items = store.priorities[key];
  if (!items.length) return `<p class="muted small prio-empty">No ${list.key === 'quiet_channels' ? 'channels' : list.title.toLowerCase()} yet.</p>`;
  return `<ul class="prio-chips">${items.map((v) => `<li class="prio-chip${key === 'quiet_channels' ? ' prio-quiet' : ''}"><span class="prio-text">${list.hash ? '#' : ''}${esc(v)}</span><button type="button" class="prio-remove" data-prio-remove="${esc(key)}" data-value="${esc(v)}" aria-label="Remove ${esc(v)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button></li>`).join('')}</ul>`;
}

export function prioritySummary(store) {
  const p = store.priorities;
  const parts = PRIORITY_LISTS.slice(0, 3).map((l) => p[l.key].length ? `${p[l.key].length} ${p[l.key].length === 1 ? l.one : l.one === 'person' ? 'people' : l.one + 's'}` : '').filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing set yet';
}

export function prioritiesView(store) {
  return {
    route: 'priorities', title: 'Priorities',
    render(el) {
      if (!store.connected) { el.innerHTML = `<h1 class="large-title page-title">Priorities</h1><div class="grid">${connectPanel(store)}</div>`; return; }
      el.innerHTML = `
        <h1 class="large-title page-title">Priorities</h1>
        <p class="subtitle">The morning brief searches these first, marks what it finds with ⭐ and turns their requests into to-dos. Changes apply from the next morning brief.</p>
        ${syncBanner(store)}
        <div class="grid">
          ${PRIORITY_LISTS.map((l) => panel({ title: esc(l.title), span: 6, cls: 'panel-prio', body: `
            <div data-prio-list="${l.key}">${priorityChipsHTML(store, l.key)}</div>
            <form class="prio-add" data-prio-add="${l.key}" autocomplete="off">
              <label class="sr-only" for="prio-${l.key}">Add ${esc(l.one)}</label>
              ${l.hash ? '<span class="prio-hash" aria-hidden="true">#</span>' : ''}
              <input id="prio-${l.key}" data-prio-input enterkeyhint="done" autocapitalize="${l.hash ? 'off' : 'words'}" spellcheck="false" placeholder="${esc(l.placeholder)}">
              <button class="btn btn-small" type="submit" disabled>Add</button>
            </form>
            <p class="muted small">${l.help}</p>` })).join('')}
        </div>`;
    },
  };
}

export function feedbackView(store) {
  return {
    route: 'feedback', title: 'Feedback',
    navRight: () => addButton('note'),
    render(el) {
      if (!store.connected) { el.innerHTML = `<h1 class="large-title page-title">Feedback</h1><div class="grid">${connectPanel(store)}</div>`; return; }
      const pending = [...store.pending].reverse();
      const done = [...store.processed].reverse().slice(0, 40);
      el.innerHTML = `
        <h1 class="large-title page-title">Feedback</h1>
        <p class="subtitle">Claude applies these on its next run, ${esc(nextRunLabel())}.</p>
        ${syncBanner(store)}
        <div class="grid">
          ${panel({ title: 'Waiting for the next run', count: pending.length || null, body: pending.length ? `<ul class="rows fb-list">${pending.map(withdrawable).join('')}</ul>` : '<p class="muted">Nothing waiting. Tap any item in your brief to remove it or add a note.</p>' })}
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
    ${item.kind === 'task' && !item.checked && draftFor(store, main) ? draftHTML(draftFor(store, main), { handled: store.profile?.id === 'personal' }) : ''}
    ${item.kind === 'task' ? `<button class="btn btn-primary btn-wide" type="button" data-sheet="toggle">${item.checked ? 'Mark not done' : 'Mark done'}</button>` : ''}
    <button class="btn btn-danger btn-wide" type="button" data-sheet="remove">Remove</button>
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

// ---------- routines ----------

const modelLabel = (store, v) => store.models.find((m) => m.value === v)?.label ?? 'Sonnet 5.5';

// What each routine is doing: from the app's run requests, the Action's results and the routines' own log.
export function routineState(store, key) {
  const runs = store.runs.filter((r) => r.routine === key);
  const reqs = store.runRequests.filter((r) => r.routine === key);
  const req = reqs[reqs.length - 1];
  const last = [...runs].reverse().find((r) => r.status === 'done' || (r.status === 'failed' && !r.request));
  const fired = req && [...runs].reverse().find((r) => r.request === req.id);
  if (req && !req.status) return { busy: true, text: 'Starting…', last };
  if (fired?.status === 'failed') return { error: fired.error, last };
  if (fired?.status === 'started' && (!last || last.at < fired.at)) return { busy: true, text: 'Running now', session: fired.session_url, last };
  return { last };
}

export function routinesHTML(store, { withModels = false } = {}) {
  if (!store.routines.length) {
    if (store.error) return `<p class="routine-error">${esc(store.error.message)}</p>`;
    if (!store.connected) return `<p class="muted">Connect ${esc(store.config.repo)} in Settings to see its routines.</p>`;
    return store.syncing ? '<p class="muted">Loading routines…</p>' : '<p class="muted">No routines found in the vault yet.</p>';
  }
  return `<ul class="routine-list">${store.routines.map((r) => {
    const st = routineState(store, r.key);
    const last = st.last ? `Last run ${esc(ago(st.last.at))}${st.last.kind === 'manual' ? ' (manual)' : ''}${st.last.summary ? ` · ${esc(st.last.summary)}` : ''}` : 'No runs logged yet';
    return `<li class="routine" data-routine="${esc(r.key)}">
      <div class="routine-head">
        <div class="routine-text">
          <p class="routine-name">${esc(r.name)}</p>
          <p class="routine-meta">${esc(r.schedules ? nextRunLine(store, r) : `${r.schedule} · ${modelLabel(store, r.model)}`)}</p>
        </div>
        <button class="btn btn-run" type="button" data-run="${esc(r.key)}"${st.busy ? ' disabled' : ''}>${st.busy ? esc(st.text) : 'Run now'}</button>
      </div>
      <p class="routine-desc">${esc(r.description ?? '')}</p>
      ${st.error ? `<p class="routine-error">${esc(st.error)}</p>` : ''}
      ${st.session ? `<a class="mtg-more ext" href="${esc(st.session)}" target="_blank" rel="noopener noreferrer">Watch the run${ICON.chev}</a>` : ''}
      <p class="routine-last">${last}</p>
      ${withModels ? `<div class="routine-sched"><h3 class="routine-sub">Schedule</h3>${scheduleEditorHTML(store, r)}</div>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

export function settingsPageHTML(store, alertsHTML = '') {
  return `
    <h1 class="large-title page-title">Settings</h1>
    <p class="subtitle">Routines, models and the connection to your vault</p>
    <div class="grid">
      ${store.profile?.id === 'personal' ? '' : panel({ title: 'Priorities', span: 12, body: `<button class="link-row prio-link" type="button" data-open-priorities><span>Projects, people and channels</span><span class="link-meta">${esc(prioritySummary(store))}</span>${ICON.chev}</button><p class="muted small">What the morning brief should never miss.</p>` })}
      ${panel({ title: 'Routines', body: `${routinesHTML(store, { withModels: true })}<p class="muted small">Each time slot runs with the model you pick for it. Run now uses its own pick.</p>`, span: 12 })}
      ${alertsHTML ? panel({ title: 'Meeting alerts', body: alertsHTML, span: 12 }) : ''}
      ${panel({ title: 'Connection', body: settingsSheetHTML(store), span: 12 })}
    </div>`;
}

// ---------- drafts ----------

function slackLink(d) {
  const c = d.slack?.channel ?? (/archives\/([A-Z0-9]+)/.exec(d.link ?? '') || [])[1];
  const t = d.slack?.team ?? 'T024F3C1G';
  return c ? `slack://channel?team=${encodeURIComponent(t)}&id=${encodeURIComponent(c)}` : '';
}

const DRAFT_APP = { email: 'Outlook', gmail: 'Gmail', yahoo: 'Yahoo Mail', slack: 'Slack' };

export function draftHTML(d, { handled = false } = {}) {
  const ch = DRAFT_APP[d.channel] ? d.channel : 'email';
  const email = ch !== 'slack';
  const from = ch === 'gmail' ? 'Gmail' : ch === 'yahoo' ? 'Yahoo' : '';
  return `<section class="draft" data-draft="${esc(d.id)}">
    <h3>Draft ${email ? 'email' : 'Slack message'}${d.to ? ` to ${esc(d.to)}` : ''}${from ? ` <span class="pill pill-neutral">${from}</span>` : ''}${d.edited ? ' <span class="pill pill-neutral">Edited</span>' : ''}</h3>
    ${email ? `<label class="field"><span class="field-label">To</span><input data-draft-to value="${esc(d.email ?? '')}" autocomplete="off"></label>
    <label class="field"><span class="field-label">Subject</span><input data-draft-subject value="${esc(d.subject ?? '')}"></label>` : ''}
    <label class="field"><span class="field-label">Message</span><textarea rows="7" data-draft-body>${esc(d.body ?? '')}</textarea></label>
    <div class="btn-pair">
      <button class="btn btn-primary" type="button" data-draft-open="${ch}" data-slack="${esc(email ? '' : slackLink(d))}">Open in ${DRAFT_APP[ch]}</button>
      <button class="btn" type="button" data-draft-copy>Copy</button>
    </div>
    <button class="btn btn-wide" type="button" data-draft-save disabled>Save my edits</button>
    ${d.link && /^https:/.test(d.link) && ch !== 'slack' ? `<a class="mtg-more ext" href="${esc(d.link)}" target="_blank" rel="noopener noreferrer">Read their email${ICON.chev}</a>` : ''}
    ${handled ? `<div class="btn-pair"><button class="btn" type="button" data-draft-status="sent">I sent it</button><button class="btn" type="button" data-draft-status="dismissed">No reply needed</button></div>` : ''}
    <p class="muted small">Nothing is sent for you. ${email ? `${DRAFT_APP[ch]} opens a new email with this filled in.` : 'The message is copied; paste it into the conversation.'}</p>
  </section>`;
}

export { registry };
