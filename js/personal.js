// The Personal profile: important email, what's coming up, and drafted replies from Gmail and Yahoo.
import { esc, inline, plain, splitItem } from './md.js';
import { Ctx, renderBlocks, rowHTML, parseNote, sections, nextRunLabel } from './render.js';
import {
  ICON, panel, syncBanner, heroHTML, loading, connectPanel, weekStrip, upcoming, addButton, journalPanel,
  latestDaily, today, sameDay, parseYmd, ago,
} from './views.js';

const EVENTS = 'Home Dashboard/Upcoming Events.md';
const tasks = (list) => list?.items.filter((i) => i.task) ?? [];
const openOf = (list) => tasks(list).filter((i) => !i.checked);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const navRight = () => `<button class="icon-btn" type="button" data-action="routines" aria-label="Run routines">${ICON.run}</button><button class="icon-btn" type="button" data-action="settings" aria-label="Settings">${ICON.gear}</button>${addButton('todo')}`;
export const openDrafts = (store) => store.drafts.filter((d) => !d.status);

// The next seven days from Upcoming Events, falling back to the brief's own Coming up table.
function comingUp(store, briefTable) {
  const t = today();
  const end = new Date(t); end.setDate(t.getDate() + 7);
  const rows = upcoming(store).filter((r) => r.date >= t && r.date < end).sort((a, b) => a.date - b.date);
  if (rows.length) return { file: EVENTS, rows: rows.map((r) => ({ when: r.cells[0], what: r.cells[1], rest: [r.cells[2], r.cells[3]], line: r.line })) };
  const brief = (briefTable?.rows ?? []).filter((r) => r.cells.some(Boolean) && !/^\*\(/.test(r.cells[0]));
  return { file: null, rows: brief.map((r) => ({ when: r.cells[0], what: r.cells[1], rest: [r.cells[2], r.cells[3]], line: r.line })) };
}

function eventRows(ctx, rows) {
  return `<ul class="rows">${rows.map((r) => rowHTML(ctx, { text: `${r.what} — ${r.rest.filter(Boolean).join(' · ')}`, line: r.line, kind: 'row' })
    .replace('<div class="row-body">', `<div class="row-body"><span class="row-time">${inline(r.when, ctx)}</span>`)).join('')}</ul>`;
}

export function personalTodayView(store) {
  return {
    route: 'today', title: 'Today', navRight,
    render(el) {
      if (!store.connected) { el.innerHTML = `${heroHTML(store, null)}<div class="grid">${connectPanel(store)}</div>`; return; }
      const path = latestDaily(store);
      if (!path) {
        el.innerHTML = `${heroHTML(store, null)}${syncBanner(store)}${store.syncing && !store.hasData ? loading() : `<div class="grid">${panel({ title: 'No brief yet', body: `<p class="muted">Your first personal brief arrives at 7:00 tomorrow morning, or tap ${ICON.run.replace('<svg', '<svg class="inline-icon"')} to run it now.</p>` })}${journalPanel(store, { span: 12 })}</div>`}`;
        return;
      }
      const ctx = new Ctx(store, path);
      const { data, blocks } = parseNote(store, path);
      const sec = sections(blocks);
      const failures = sec.lead.filter((b) => b.t === 'callout' && b.kind === 'failure');
      const top = sec.lead.find((b) => b.t === 'callout' && b.kind === 'danger');
      const topList = top?.children.find((b) => b.t === 'list');

      const mail = sec.find(/important/i);
      const mailList = mail?.blocks.find((b) => b.t === 'list');
      const mailOpen = openOf(mailList);
      const urgent = mailOpen.filter((i) => /🔴/.test(i.text)).length;

      const coming = sec.find(/coming up/i);
      const up = comingUp(store, coming?.blocks.find((b) => b.t === 'table'));

      const replies = sec.find(/draft/i);
      const replyList = replies?.blocks.find((b) => b.t === 'list');
      const drafts = openDrafts(store);

      const since = sec.find(/since|yesterday/i);
      const callouts = [...sec.list.flatMap((s) => s.blocks), ...sec.lead].filter((b) => b.t === 'callout');
      const filtered = callouts.find((b) => b.kind === 'example' && /filter/i.test(b.title));
      const sources = callouts.find((b) => b.kind === 'quote');
      const filteredCount = Number(data.filtered) || 0;

      const firstTop = topList?.items[0];
      const n = mailOpen.length;
      const finding = firstTop && !/nothing urgent/i.test(firstTop.text)
        ? `${n ? `${plural(n, 'email')} need${n === 1 ? 's' : ''} you` : 'Your inbox is calm'}. First up: ${inline(splitItem(firstTop.text).main, ctx)}.`
        : n ? `${plural(n, 'email')} worth your time, nothing urgent.` : 'Nothing in your inbox needs you today.';

      const tiles = `<div class="tiles span-12">
        <div class="tile"><span class="tile-label">Important email</span><span class="tile-value">${n}</span><span class="tile-cap">${urgent ? `${urgent} urgent` : n ? 'Nothing urgent' : 'All clear'}</span></div>
        <div class="tile"><span class="tile-label">Next 7 days</span><span class="tile-value">${up.rows.length}</span><span class="tile-cap">${up.rows[0] ? `${esc(plain(up.rows[0].when))} · ${esc(plain(up.rows[0].what))}` : 'Nothing booked'}</span></div>
        <div class="tile"><span class="tile-label">Replies drafted</span><span class="tile-value">${drafts.length}</span><span class="tile-cap">${drafts.length ? 'Ready to review' : 'Nobody waiting'}</span></div>
        <div class="tile"><span class="tile-label">Filtered out</span><span class="tile-value">${filteredCount || '—'}</span><span class="tile-cap">Ads and automated mail</span></div>
      </div>`;

      ctx.section = 'Needs you today';
      const topBody = topList ? `<ol class="rows rows-top">${topList.items.map((it) => rowHTML(ctx, { text: it.text, line: it.line })).join('')}</ol>` : '<p class="muted">Nothing urgent today.</p>';

      const upCtx = up.file ? new Ctx(store, up.file) : ctx;
      upCtx.section = up.file ? 'Next 14 days' : 'Coming up';
      const upBody = (up.rows.length ? eventRows(upCtx, up.rows) : '<p class="muted">No appointments or bookings in the next week.</p>')
        + '<button class="text-btn" type="button" data-goto="events">See everything coming up</button>';

      ctx.section = 'Important email';
      const mailBody = (mailList ? renderBlocks([mailList], ctx) : '<p class="muted">Nothing important came in.</p>')
        + `<button class="add-row" type="button" data-action="add" data-kind="todo">${ICON.plus}<span>Add a to-do</span></button>`;

      ctx.section = 'Drafted replies';
      const replyBody = replyList && tasks(replyList).length
        ? `${renderBlocks([replyList], ctx)}<button class="text-btn" type="button" data-goto="drafts">Open all drafts</button>`
        : '<p class="muted">No replies to write today.</p>';

      let sinceBody = '';
      if (since) {
        ctx.section = 'Since yesterday';
        const tldr = since.blocks.find((b) => b.t === 'callout');
        const rest = since.blocks.filter((b) => b !== tldr && b !== filtered && b !== sources);
        sinceBody = `${tldr ? `<div class="tldr">${renderBlocks(tldr.children, ctx)}</div>` : ''}${renderBlocks(rest, ctx)}`;
      }

      el.innerHTML = `
        ${heroHTML(store, data, finding)}
        ${syncBanner(store)}
        ${failures.length ? `<div class="grid">${failures.map((f) => `<div class="span-12">${renderBlocks([f], ctx)}</div>`).join('')}</div>` : ''}
        ${weekStrip(store)}
        <div class="grid">
          ${tiles}
          ${panel({ title: 'Needs you today', body: topBody, span: 6, cls: 'panel-top' })}
          ${panel({ title: 'Coming up', count: up.rows.length || null, body: upBody, span: 6 })}
          ${panel({ title: 'Important email', count: n, body: mailBody, span: 12 })}
          ${panel({ title: 'Drafted replies', count: drafts.length || null, body: replyBody, span: 6 })}
          ${since ? panel({ title: 'Since yesterday', body: sinceBody, span: 6 }) : ''}
          ${journalPanel(store, { span: 12 })}
          ${filtered || sources ? `<div class="span-12">${renderBlocks([filtered, sources].filter(Boolean), ctx)}</div>` : ''}
          <div class="span-12 foot-links"><a class="wl link-row" href="#" data-note="${esc(path)}"><span>Open the full brief</span>${ICON.chev}</a></div>
        </div>`;
    },
  };
}

// ---------- Drafts ----------

const CH = { gmail: 'Gmail', yahoo: 'Yahoo', email: 'Email', slack: 'Slack' };

function draftCard(d) {
  const preview = (d.body ?? '').replace(/\s+/g, ' ').trim();
  return `<li><button class="draft-card" type="button" data-draft-id="${esc(d.id)}">
    <span class="draft-card-head"><span class="draft-card-to">${esc(d.to || d.email || 'Reply')}</span><span class="pill pill-neutral">${esc(CH[d.channel] ?? 'Email')}</span>${d.edited ? '<span class="pill pill-accent">Edited</span>' : ''}${d.status ? `<span class="pill pill-positive">${d.status === 'sent' ? 'Sent' : 'No reply needed'}</span>` : ''}</span>
    <span class="draft-card-subject">${esc(d.subject || d.item || '')}</span>
    <span class="draft-card-body">${esc(preview)}</span>
    ${ICON.chev}
  </button></li>`;
}

export function draftsView(store) {
  return {
    route: 'drafts', title: 'Drafts',
    liveRefresh: true, // cards, not swipe rows: redraw so a handled draft moves down at once
    render(el) {
      if (!store.connected) { el.innerHTML = `<h1 class="large-title page-title">Drafts</h1><div class="grid">${connectPanel(store)}</div>`; return; }
      const open = openDrafts(store).sort((a, b) => (b.updated ?? b.created ?? '').localeCompare(a.updated ?? a.created ?? ''));
      const done = store.drafts.filter((d) => d.status).sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? '')).slice(0, 12);
      el.innerHTML = `
        <h1 class="large-title page-title">Drafts</h1>
        <p class="subtitle">Replies Claude wrote for you. Edit, then open them in Gmail or Yahoo to send.</p>
        ${syncBanner(store)}
        <div class="grid">
          ${panel({ title: 'Ready to review', count: open.length || null, body: open.length ? `<ul class="draft-list">${open.map(draftCard).join('')}</ul>` : '<p class="muted">No replies waiting. When an email needs an answer, a draft shows up here.</p>' })}
          ${done.length ? panel({ title: 'Handled', body: `<ul class="draft-list">${done.map(draftCard).join('')}</ul>`, cls: 'panel-quiet' }) : ''}
        </div>`;
    },
  };
}

export { ago, sameDay, parseYmd };
