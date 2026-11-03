import { esc, inline, plain, splitFrontmatter, parseBlocks, stripLeadEmoji, splitItem } from './md.js';

// Every actionable line on screen is registered here, keyed by a short id in data-iid.
export const registry = new Map();
let seq = 0;
export function register(item) {
  const id = 'i' + (++seq).toString(36);
  registry.set(id, item);
  return id;
}

export class Ctx {
  constructor(store, file, { depth = 0 } = {}) {
    this.store = store;
    this.file = file;
    this.depth = depth;
    this.lines = splitFrontmatter(store.text(file) ?? '').lines;
    this.section = null;
  }
  resolve = (name) => resolveNote(this.store, name);
  child(file) { return new Ctx(this.store, file, { depth: this.depth + 1 }); }
}

export function resolveNote(store, name) {
  const n = name.trim().replace(/\.md$/i, '');
  const all = store.files();
  const exact = all.find((p) => p === n || p === n + '.md' || p === n + '.base');
  if (exact) return exact;
  const lower = n.toLowerCase();
  return all.find((p) => p.toLowerCase().replace(/\.md$/, '').split('/').pop() === lower.split('/').pop()) ?? null;
}

export const noteTitle = (path) => path.split('/').pop().replace(/\.(md|base)$/, '');

const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function friendlyName(path) {
  const t = noteTitle(path);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (path.startsWith('Daily/') && m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return `Brief · ${DOW3[d.getDay()]}, ${MON3[d.getMonth()]} ${d.getDate()}`; }
  return t.replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, '');
}

// The hourly feedback routine fires at :30 past each hour, Monday to Friday (UTC).
export function nextRun(from = new Date()) {
  const d = new Date(from);
  d.setUTCSeconds(0, 0);
  if (d.getUTCMinutes() >= 30) d.setUTCHours(d.getUTCHours() + 1);
  d.setUTCMinutes(30);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1), d.setUTCHours(0, 30);
  return d;
}
export function nextRunLabel() {
  const d = nextRun();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { weekday: 'short' })} ${t}`;
}

// Pending feedback on a line shows on the line itself.
export function statusOf(store, file, raw) {
  const mine = store.pending.filter((f) => f.target && f.target.file === file && f.target.raw === raw);
  return {
    remove: mine.some((f) => f.action === 'remove'),
    confirm: mine.some((f) => f.action === 'confirm'),
    note: mine.some((f) => f.action === 'feedback'),
  };
}

function pills(st) {
  const out = [];
  if (st.remove) out.push(`<span class="pill pill-negative">Removing at ${nextRunLabel()}</span>`);
  if (st.confirm) out.push('<span class="pill pill-positive">Confirmed</span>');
  if (st.note) out.push('<span class="pill pill-neutral">Note sent</span>');
  return out.join('');
}

// A swipeable row: tasks get a checkbox and swipe-right-to-complete; every row can be swiped left.
export function rowHTML(ctx, { text, line, task = false, checked = false, kind = 'bullet', extra = '' }) {
  const raw = ctx.lines[line] ?? '';
  const item = { file: ctx.file, line, raw, text: plain(text), kind: task ? 'task' : kind, checked, section: ctx.section };
  const id = register(item);
  const st = statusOf(ctx.store, ctx.file, raw);
  const { main, meta } = splitItem(text);
  const cls = ['row', task ? 'is-task' : '', checked ? 'is-done' : '', st.remove ? 'is-removing' : ''].filter(Boolean).join(' ');
  return `<li class="${cls}" data-iid="${id}">
    <div class="row-actions" aria-hidden="true">
      <span class="ra ra-done">${checked ? 'Reopen' : 'Done'}</span>
      <span class="ra-right"><span class="ra ra-note">Note</span><span class="ra ra-remove">Remove</span></span>
    </div>
    <div class="row-body">
      ${task ? `<button class="check" type="button" aria-pressed="${checked}" aria-label="${checked ? 'Mark not done' : 'Mark done'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.5l3.6 3.6 7.4-8"/></svg></button>` : ''}
      <div class="row-text">
        <div class="row-main">${inline(main, ctx)}</div>
        ${meta ? `<div class="row-meta">${inline(meta, ctx)}</div>` : ''}
        ${pills(st)}${extra}
      </div>
    </div>
  </li>`;
}

const CALLOUT_LABEL = { danger: 'Priority', tip: 'Tip', todo: 'To do', warning: 'Heads up', info: 'Info', note: 'Note', summary: 'Summary', quote: 'Sources', example: 'Archive', question: 'Question', failure: 'Problem' };

export function renderBlocks(blocks, ctx) {
  let html = '';
  for (const b of blocks) {
    switch (b.t) {
      case 'h': {
        ctx.section = stripLeadEmoji(b.text);
        const lvl = Math.min(6, b.level + 1);
        html += `<h${lvl} class="md-h md-h${b.level}">${inline(stripLeadEmoji(b.text), ctx)}</h${lvl}>`;
        break;
      }
      case 'p': html += `<p>${inline(b.text, ctx)}</p>`; break;
      case 'hr': html += '<div class="md-gap" role="separator"></div>'; break;
      case 'list': html += renderList(b, ctx); break;
      case 'quote': html += `<blockquote>${renderBlocks(b.children, ctx)}</blockquote>`; break;
      case 'table': html += renderTable(b, ctx); break;
      case 'callout': {
        const title = stripLeadEmoji(b.title) || CALLOUT_LABEL[b.kind] || 'Note';
        const body = renderBlocks(b.children, ctx);
        if (b.fold === '-' || b.fold === '+') {
          html += `<details class="callout c-${esc(b.kind)}"${b.fold === '+' ? ' open' : ''}><summary><span>${inline(title, ctx)}</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></summary><div class="callout-body">${body}</div></details>`;
        } else {
          html += `<div class="callout c-${esc(b.kind)}"><div class="callout-title">${inline(title, ctx)}</div><div class="callout-body">${body}</div></div>`;
        }
        break;
      }
      case 'embed': html += renderEmbed(b, ctx); break;
    }
  }
  return html;
}

function renderList(list, ctx) {
  const tag = list.ordered ? 'ol' : 'ul';
  const items = list.items.map((it) => {
    if (/^\*\(.*\)\*$/.test(it.text.trim())) return `<li class="row-empty">${inline(it.text.replace(/^\*\(|\)\*$/g, ''), ctx)}</li>`;
    const nested = it.children ? renderList(it.children, ctx) : '';
    return rowHTML(ctx, { text: it.text, line: it.line, task: it.task, checked: it.checked, extra: nested });
  }).join('');
  return `<${tag} class="rows${list.ordered ? ' rows-ordered' : ''}">${items}</${tag}>`;
}

function renderTable(t, ctx) {
  const head = t.head.map((h) => `<th scope="col">${inline(h, ctx)}</th>`).join('');
  const rows = t.rows.map((r) => {
    if (r.cells.every((c) => !c || /^\*\(.*\)\*$/.test(c))) return '';
    const raw = ctx.lines[r.line] ?? '';
    const id = register({ file: ctx.file, line: r.line, raw, text: plain(r.cells.filter(Boolean).join(' · ')), kind: 'row', section: ctx.section });
    const st = statusOf(ctx.store, ctx.file, raw);
    return `<tr data-iid="${id}" class="${st.remove ? 'is-removing' : ''}">${r.cells.map((c, k) => `<td>${inline(c, ctx)}${k === 1 ? pills(st) : ''}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="table-frame"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderEmbed(b, ctx) {
  const path = ctx.resolve(b.target.split('#')[0]);
  if (!path) return `<p class="muted">Missing note: ${esc(b.target)}</p>`;
  if (path.endsWith('.base')) return baseList(ctx.store, path);
  if (ctx.depth >= 2) return `<p><a class="wl" href="#" data-note="${esc(path)}">${esc(noteTitle(path))}</a></p>`;
  const child = ctx.child(path);
  const { lines, start } = splitFrontmatter(ctx.store.text(path) ?? '');
  const body = lines.slice(start);
  const at = body.map((_, i) => i + start);
  let blocks = parseBlocks(body, at);
  if (blocks[0]?.t === 'h' && blocks[0].level === 1) blocks = blocks.slice(1);
  return `<div class="embed"><a class="embed-head wl" href="#" data-note="${esc(path)}">${esc(noteTitle(path))}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a>${renderBlocks(blocks, child)}</div>`;
}

// Obsidian Bases: show the folder the base filters on as a list of notes.
export function baseList(store, path) {
  const text = store.text(path) ?? '';
  const folder = (text.match(/inFolder\("([^"]+)"\)/) || [])[1];
  const files = (folder ? store.files(folder + '/') : []).filter((p) => p.endsWith('.md')).sort().reverse();
  if (!files.length) return '<p class="muted">Nothing here yet.</p>';
  return `<ul class="links">${files.slice(0, 12).map((p) => `<li><a class="wl link-row" href="#" data-note="${esc(p)}"><span>${esc(noteTitle(p))}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a></li>`).join('')}</ul>${files.length > 12 ? `<p class="muted">${files.length - 12} more in ${esc(folder)}</p>` : ''}`;
}

// Parse a note into its frontmatter and blocks, keeping original line numbers.
export function parseNote(store, path) {
  const { data, lines, start } = splitFrontmatter(store.text(path) ?? '');
  const body = lines.slice(start);
  const at = body.map((_, i) => i + start);
  return { data, blocks: parseBlocks(body, at) };
}

// Group a note's blocks under its h2 headings.
export function sections(blocks) {
  const out = { lead: [], list: [] };
  let cur = null;
  for (const b of blocks) {
    if (b.t === 'h' && b.level === 2) { cur = { title: stripLeadEmoji(b.text), blocks: [] }; out.list.push(cur); continue; }
    if (b.t === 'h' && b.level === 1) continue;
    (cur ? cur.blocks : out.lead).push(b);
  }
  out.find = (re) => out.list.find((s) => re.test(s.title));
  return out;
}
