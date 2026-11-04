// The Personal profile: important email, what's coming up, and drafted replies from Gmail and Yahoo.
import { esc, inline, plain, splitItem } from './md.js';
import { Ctx, renderBlocks, rowHTML, parseNote, sections, nextRunLabel } from './render.js';
import {
  ICON, panel, syncBanner, heroHTML, loading, connectPanel, weekStrip, upcoming, addButton, journalPanel,
  latestDaily, today, sameDay, parseYmd, ago, nameHue, shortDate,
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
          ${filtered || store.filtered ? filteredCard(store, filtered, data) : ''}
          ${sources ? `<div class="span-12">${renderBlocks([sources], ctx)}</div>` : ''}
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

// ---------- Filtered out ----------

const KIND_LABEL = { promotions: 'Promotions', newsletters: 'Newsletters', social: 'Social', automated: 'Automated notices', receipts: 'Receipts and orders', jobs: 'Job alerts', other: 'Other' };
const KIND_ORDER = Object.keys(KIND_LABEL);
const addrKey = (account, address) => `${account}:${String(address ?? '').toLowerCase()}`;

// Everything we know about one sender: waiting feedback, blocked, and the latest unsubscribe result.
export function senderState(store, account, address) {
  const key = addrKey(account, address);
  const mine = store.pending.filter((f) => f.sender && addrKey(f.sender.account, f.sender.address) === key);
  const pending = mine[mine.length - 1] ?? null;
  const blocked = store.blocked.some((b) => addrKey(b.account, b.address) === key);
  const unsub = [...store.mailActions].reverse().find((a) => a.type === 'unsubscribe' && addrKey(a.account, a.address) === key) ?? null;
  return { pending, blocked, unsub };
}

function statusPill(st) {
  if (st.pending) {
    const what = { block: 'Blocking', unsubscribe: 'Unsubscribing', unblock: 'Unblocking', not_junk: 'Showing again' }[st.pending.action] ?? 'Sent';
    return `<span class="pill pill-neutral">${what} at ${esc(nextRunLabel())}</span>`;
  }
  if (st.blocked) return '<span class="pill pill-negative">Blocked</span>';
  if (st.unsub?.status === 'done') return '<span class="pill pill-positive">Unsubscribed</span>';
  if (st.unsub?.status === 'needs_you') return '<span class="pill pill-warning">Finish unsubscribing</span>';
  if (st.unsub) return '<span class="pill pill-neutral">Unsubscribing</span>';
  return '';
}

function avatar(name) {
  const n = String(name || '?').trim();
  return `<span class="avatar sender-avatar" data-hue="${nameHue(n) % 360}" aria-hidden="true">${esc((n.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase())}</span>`;
}

function senderRow(store, s) {
  const st = senderState(store, s.account, s.address);
  return `<li><button class="sender-row" type="button" data-sender="${esc(s.id ?? addrKey(s.account, s.address))}">
    ${avatar(s.name || s.address)}
    <span class="sender-text">
      <span class="sender-name">${esc(s.name || s.address)}</span>
      <span class="sender-meta">${esc(s.address)} · ${s.account === 'yahoo' ? 'Yahoo' : 'Gmail'}</span>
      ${statusPill(st) ? `<span class="sender-pills">${statusPill(st)}</span>` : ''}
    </span>
    <span class="sender-count">${Number(s.count) || 1}</span>
    ${ICON.chev}
  </button></li>`;
}

// The Filtered out card on Today: a summary that opens the full list.
export function filteredCard(store, callout, data) {
  const f = store.filtered;
  const total = f?.total ?? (Number(data?.filtered) || 0);
  const summary = f?.groups?.length
    ? f.groups.filter((g) => g.count).map((g) => `${g.count} ${String(g.label ?? KIND_LABEL[g.kind] ?? g.kind).toLowerCase()}`).join(', ')
    : plain((callout?.children ?? []).map((b) => b.text ?? b.items?.map((i) => i.text).join(' ') ?? '').join(' ')).slice(0, 160);
  return `<button class="filtered-card span-12" type="button" data-open-filtered>
    <span class="filtered-text">
      <span class="filtered-title">Filtered out${total ? ` <span class="count">${total}</span>` : ''}</span>
      ${summary ? `<span class="filtered-sum">${esc(summary)}</span>` : ''}
      <span class="filtered-cta">See senders, block or unsubscribe</span>
    </span>
    ${ICON.chev}
  </button>`;
}

export function findSender(store, id) {
  const f = store.filtered;
  const s = f?.senders?.find((x) => (x.id ?? addrKey(x.account, x.address)) === id);
  if (s) return s;
  const b = store.blocked.find((x) => addrKey(x.account, x.address) === id);
  return b ? { ...b, id, count: 0, examples: [], blockedOnly: true } : null;
}

export function filteredView(store) {
  return {
    route: 'filtered', title: 'Filtered out', shortTitle: 'Filtered',
    liveRefresh: true,
    render(el) {
      const f = store.filtered;
      const senders = (f?.senders ?? []).filter((s) => s.address);
      const finish = [...store.mailActions].reverse().filter((a, i, all) => a.type === 'unsubscribe' && a.status === 'needs_you' && all.findIndex((b) => addrKey(b.account, b.address) === addrKey(a.account, a.address)) === i);
      const groups = KIND_ORDER.map((k) => ({ k, rows: senders.filter((s) => (KIND_LABEL[s.kind] ? s.kind : 'other') === k) })).filter((g) => g.rows.length);
      const blocked = store.blocked;
      const when = f?.date ? shortDate(parseYmd(f.date)) : null;
      el.innerHTML = `
        <h1 class="large-title page-title">Filtered out</h1>
        <p class="subtitle">${f ? `${f.total ?? senders.reduce((n, s) => n + (Number(s.count) || 1), 0)} emails kept out of your brief${when ? ` · ${esc(when)}` : ''}. Tap a sender to block or unsubscribe.` : 'The sender list arrives with your next brief.'}</p>
        ${syncBanner(store)}
        <div class="grid">
          ${finish.length ? panel({ title: 'Finish unsubscribing', count: finish.length, cls: 'panel-top', body: `<ul class="sender-list">${finish.map((a) => `<li class="finish-row">
              ${avatar(a.name || a.address)}
              <span class="sender-text"><span class="sender-name">${esc(a.name || a.address)}</span><span class="sender-meta">${esc(a.result ?? '')}</span></span>
              ${a.https ? `<a class="btn btn-small" href="${esc(a.https)}" target="_blank" rel="noopener noreferrer">Open page</a>` : a.mailto ? `<a class="btn btn-small" href="${esc(a.mailto)}">Send email</a>` : `<button class="btn btn-small" type="button" data-sender="${esc(addrKey(a.account, a.address))}">Block</button>`}
            </li>`).join('')}</ul>` }) : ''}
          ${groups.map((g) => panel({ title: KIND_LABEL[g.k], count: g.rows.reduce((n, s) => n + (Number(s.count) || 1), 0), body: `<ul class="sender-list">${g.rows.map((s) => senderRow(store, s)).join('')}</ul>` })).join('')
            || panel({ title: 'No sender details yet', body: '<p class="muted">Tomorrow\'s brief lists every sender it filtered, with example emails, so you can block or unsubscribe from them here.</p>' })}
          ${blocked.length ? panel({ title: 'Blocked', count: blocked.length, cls: 'panel-quiet', body: `<ul class="sender-list">${blocked.map((b) => senderRow(store, { ...b, id: addrKey(b.account, b.address), count: b.moved || '' })).join('')}</ul>` }) : ''}
        </div>`;
    },
  };
}

export function senderSheetHTML(store, s) {
  const st = senderState(store, s.account, s.address);
  const gmail = s.account !== 'yahoo';
  const ex = (s.examples ?? []).slice(0, 3);
  const busy = !!st.pending;
  const unsubDone = st.unsub && st.unsub.status !== 'failed';
  return `
    <div class="sender-head">
      ${avatar(s.name || s.address)}
      <div class="sender-text">
        <p class="sender-name">${esc(s.name || s.address)}</p>
        <p class="sender-meta">${esc(s.address)} · ${gmail ? 'Gmail' : 'Yahoo'}${s.kind ? ` · ${esc(KIND_LABEL[s.kind] ?? s.kind)}` : ''}</p>
      </div>
    </div>
    ${s.count ? `<p class="muted">${Number(s.count)} email${Number(s.count) === 1 ? '' : 's'} filtered${store.filtered?.date ? ` in the brief for ${esc(shortDate(parseYmd(store.filtered.date)))}` : ''}.</p>` : ''}
    ${ex.length ? `<h3 class="sheet-sub">Examples</h3><ul class="example-list">${ex.map((e) => `<li>${e.link && /^https:/.test(e.link) ? `<a class="example ext" href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">` : '<span class="example">'}
        <span class="example-subject">${esc(e.subject || '(no subject)')}</span>${e.date ? `<span class="example-date">${esc(ago(e.date))}</span>` : ''}${e.link ? '</a>' : '</span>'}</li>`).join('')}</ul>` : ''}
    ${statusPill(st) ? `<p class="sender-status">${statusPill(st)}${st.unsub?.result && !st.pending ? ` <span class="muted small">${esc(st.unsub.result)}</span>` : ''}</p>` : ''}
    ${st.unsub?.status === 'needs_you' && !busy ? (st.unsub.https ? `<a class="btn btn-primary btn-wide" href="${esc(st.unsub.https)}" target="_blank" rel="noopener noreferrer">Open the unsubscribe page</a>` : st.unsub.mailto ? `<a class="btn btn-primary btn-wide" href="${esc(st.unsub.mailto)}">Send the unsubscribe email</a>` : '') : ''}
    ${busy ? `<button class="btn btn-wide" type="button" data-sender-undo="${esc(st.pending.id)}">Undo</button>`
      : st.blocked ? `<button class="btn btn-wide" type="button" data-sender-act="unblock">Unblock</button>`
      : `${unsubDone ? '' : `<button class="btn btn-primary btn-wide" type="button" data-sender-act="unsubscribe">Unsubscribe</button>`}
         <button class="btn btn-danger btn-wide" type="button" data-sender-act="block">Block</button>
         <button class="text-btn" type="button" data-sender-act="not_junk">Not junk: show their emails in my brief</button>`}
    ${gmail && (st.blocked || st.pending?.action === 'block') && ex[0]?.link ? `<a class="mtg-more ext" href="${esc(ex[0].link)}" target="_blank" rel="noopener noreferrer">Also block in Gmail (open an email, then ⋮ → Block)${ICON.chev}</a>` : ''}
    <p class="muted small">${busy ? `Claude applies this at ${esc(nextRunLabel())}.` : `Unsubscribe asks the sender to stop. Block moves their mail out of your inbox${gmail ? ' (Gmail: keeps them out of your brief)' : ' and into Yahoo spam'}. Claude applies it at ${esc(nextRunLabel())}.`}${!s.unsubscribe && !unsubDone && !st.blocked && !busy ? ' No unsubscribe link was seen in their emails, so Block may work better.' : ''}</p>`;
}
