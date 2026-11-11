// My Project: the CTS Search second brain kept in the vault under Projects/CTS Search/.
// Reads _data/status.json (cloud routine), _data/repos.json (repo sync on the Mac), the newest Updates/*.md,
// the Overview notes and Concepts/. Everything opens in the normal note view.

import { esc, inline, plain } from './md.js';
import { Ctx, renderBlocks, parseNote, sections, noteTitle } from './render.js';
import { panel, connectPanel, syncBanner, loading, ICON, ago, parseYmd, shortDate, today } from './views.js';

const ROOT = 'Projects/CTS Search/';
const P = (rel) => ROOT + rel;
const DAY = 86_400_000;

const noteLink = (path, label, cls = 'wl') => `<a class="${cls}" href="#" data-note="${esc(path)}">${label}</a>`;
const extLink = (url, label, cls = 'ext') => `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
const linkRow = (path, label, meta = '') => `<li><a class="wl link-row" href="#" data-note="${esc(path)}"><span>${esc(label)}</span>${meta ? `<span class="link-meta">${esc(meta)}</span>` : ''}${ICON.chev}</a></li>`;
const dayLabel = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? shortDate(d) : ''; };

function latestUpdates(store) {
  return store.files(P('Updates/')).filter((p) => /\d{4}-\d{2}-\d{2}\.md$/.test(p)).sort().reverse();
}

// The "In one line" tip of a concept note, as plain text.
function conceptLine(store, path) {
  const { blocks } = parseNote(store, path);
  const tip = blocks.find((b) => b.t === 'callout');
  const p = tip?.children.find((b) => b.t === 'p');
  return p ? plain(p.text) : '';
}

function concepts(store) {
  return store.files(P('Concepts/')).filter((p) => p.endsWith('.md')).map((path) => {
    const { data } = parseNote(store, path);
    return { path, name: noteTitle(path), status: data.status || 'new', first: data.first_seen || '', category: data.category || '' };
  });
}

function hero(store, status) {
  const updated = status?.updated ? `updated ${ago(status.updated)}` : '';
  const sub = [status?.project ?? 'CTS Search Platform', status?.client ?? 'Toyota', updated].filter(Boolean).join(' · ');
  return `<header class="hero">
    <h1 class="greeting large-title">My Project</h1>
    <p class="dateline">${esc(sub)}</p>
    ${status?.headline ? `<p class="finding">${esc(status.headline)}</p>` : ''}
  </header>`;
}

function tiles(status, repos, cs) {
  const end = parseYmd(status?.deadline);
  const start = parseYmd(status?.start);
  const now = today();
  const left = end ? Math.max(0, Math.round((end - now) / DAY)) : null;
  const pct = end && start ? Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100))) : null;
  const open = (repos?.repos ?? []).flatMap((r) => r.open_prs ?? []);
  const mine = open.filter((p) => p.mine).length;
  const fresh = cs.filter((c) => c.status === 'new').length;
  return `<div class="tiles span-12">
    <div class="tile"><span class="tile-label">Days to build deadline</span><span class="tile-value">${left ?? '—'}</span><span class="tile-cap">${end ? `Due ${esc(shortDate(end))}` : 'No deadline set'}</span></div>
    <div class="tile"><span class="tile-label">Timeline used</span><span class="tile-value">${pct != null ? `${pct}%` : '—'}</span><span class="tile-cap">${esc([status?.phase, status?.sprint?.name].filter(Boolean).join(' · ') || '—')}</span></div>
    <div class="tile"><span class="tile-label">Open PRs</span><span class="tile-value">${open.length}</span><span class="tile-cap">${mine ? `${mine} ${mine === 1 ? 'is' : 'are'} yours` : 'None are yours'}</span></div>
    <div class="tile"><span class="tile-label">Concepts to learn</span><span class="tile-value">${fresh}</span><span class="tile-cap">${cs.length} explained so far</span></div>
  </div>`;
}

function updatePanel(store) {
  const list = latestUpdates(store);
  if (!list.length) return panel({ title: 'Latest update', body: '<p class="muted">The first project update arrives with the next morning brief.</p>', span: 12 });
  const path = list[0];
  const ctx = new Ctx(store, path);
  const { data, blocks } = parseNote(store, path);
  const sec = sections(blocks);
  const tldr = sec.lead.find((b) => b.t === 'callout');
  const forYou = sec.find(/means for you/i);
  const rest = sec.list.filter((s) => s !== forYou && !/new to you/i.test(s.title));
  ctx.section = 'Latest update';
  const d = parseYmd(data.date);
  const body = `${tldr ? `<div class="tldr">${renderBlocks(tldr.children, ctx)}</div>` : ''}
    ${forYou ? `<div class="proj-group proj-you"><h3 class="proj-title">What this means for you</h3>${renderBlocks(forYou.blocks, ctx)}</div>` : ''}
    <div class="proj-sections">${rest.map((s) => { ctx.section = `Update · ${s.title}`; return `<details class="callout c-note"><summary><span>${esc(s.title)}</span>${ICON.chev}</summary><div class="callout-body">${renderBlocks(s.blocks, ctx)}</div></details>`; }).join('')}</div>
    <ul class="links proj-links">${linkRow(path, 'Open the full update')}${list.slice(1, 5).map((p) => { const dd = parseYmd(noteTitle(p)); return linkRow(p, dd ? `Update · ${shortDate(dd)}` : noteTitle(p)); }).join('')}</ul>`;
  return panel({ title: d ? `Latest update · ${esc(shortDate(d))}` : 'Latest update', body, span: 12, cls: 'panel-update' });
}

function pill(text, kind) { return `<span class="pill pill-${kind}">${esc(text)}</span>`; }
const REVIEW = { APPROVED: ['Approved', 'positive'], CHANGES_REQUESTED: ['Changes requested', 'negative'], REVIEW_REQUIRED: ['Needs review', 'neutral'] };
const CI = { passing: ['CI passing', 'positive'], failing: ['CI failing', 'negative'], pending: ['CI running', 'warning'] };

function repoCard(store, r) {
  const notePath = r.note && store.text(r.note) != null ? r.note : null;
  const name = notePath ? noteLink(notePath, esc(r.name)) : esc(r.name);
  const prs = (r.open_prs ?? []).map((p) => {
    const rv = REVIEW[p.review] ?? REVIEW.REVIEW_REQUIRED;
    const ci = CI[p.ci];
    return `<li class="pr">
      <div class="pr-title">${extLink(p.url, `#${p.number} ${esc(p.title)}`)}</div>
      <div class="pr-meta">${esc(p.author)}${p.updated ? ` · updated ${esc(ago(p.updated))}` : ''}${p.files ? ` · ${p.files} files` : ''}</div>
      <div class="row-pills">${p.mine ? pill('Yours', 'accent') : ''}${pill(rv[0], rv[1])}${ci ? pill(ci[0], ci[1]) : ''}</div>
      ${p.ci_note ? `<div class="pr-note muted">${esc(p.ci_note)}</div>` : ''}
      ${p.summary ? `<p class="pr-sum">${esc(p.summary)}</p>` : ''}
    </li>`;
  }).join('');
  const merged = (r.recent_prs ?? []).slice(0, 3).map((p) => `<li>${extLink(p.url, `#${p.number} ${esc(p.title)}`)} <span class="muted">· ${esc(p.state === 'MERGED' ? 'merged' : 'closed')} ${esc(dayLabel(p.date))}</span></li>`).join('');
  const commits = (r.recent_commits ?? []).slice(0, 3).map((c) => `<li><code>${esc(c.sha)}</code> ${esc(c.subject)} <span class="muted">· ${esc(c.author)} ${esc(dayLabel(c.date))}</span></li>`).join('');
  const comments = (r.recent_comments ?? []).slice(0, 2).map((c) => `<li><strong>${esc(c.author)}</strong> on ${extLink(c.url, `#${c.pr}`)}: “${esc(c.text)}”</li>`).join('');
  return `<article class="repo-card">
    <header class="repo-head"><h3>${name}</h3>${extLink(r.url, 'GitHub', 'ext repo-gh')}</header>
    ${r.summary ? `<p class="repo-sum muted">${esc(r.summary)}</p>` : ''}
    <h4>Open PRs <span class="count">${(r.open_prs ?? []).length}</span></h4>
    ${prs ? `<ul class="pr-list">${prs}</ul>` : '<p class="muted">No open PRs.</p>'}
    ${merged ? `<h4>Recently merged or closed</h4><ul class="mini-list">${merged}</ul>` : ''}
    ${commits ? `<h4>Latest commits</h4><ul class="mini-list">${commits}</ul>` : ''}
    ${comments ? `<h4>Review comments</h4><ul class="mini-list">${comments}</ul>` : ''}
  </article>`;
}

function reposPanel(store, repos) {
  if (!repos?.repos?.length) return panel({ title: 'Repos', body: '<p class="muted">Repo activity appears after the first repo sync on your Mac.</p>', span: 12 });
  const today = latestRepoActivity(store);
  const action = today ? noteLink(today, 'Today’s activity', 'wl text-btn panel-action') : '';
  const synced = repos.synced_at ? `<p class="muted repo-synced">Synced ${esc(ago(repos.synced_at))} from your Mac.</p>` : '';
  return panel({ title: 'Repos', body: `${synced}<div class="repo-grid">${repos.repos.map((r) => repoCard(store, r)).join('')}</div>`, span: 12, cls: 'panel-repos', action });
}

function latestRepoActivity(store) {
  return store.files(P('Repos/Activity/')).filter((p) => p.endsWith('.md')).sort().pop() ?? null;
}

function focusPanel(store, status) {
  const item = (x) => {
    const target = x.note && store.text(x.note) != null ? noteLink(x.note, esc(x.text)) : x.link ? extLink(x.link, esc(x.text)) : esc(x.text);
    return `<li>${target}</li>`;
  };
  const mine = (status?.my_focus ?? []).map(item).join('');
  const hi = (status?.highlights ?? []).map(item).join('');
  if (!mine && !hi) return '';
  const body = `${mine ? `<h3 class="proj-title">Your open items</h3><ul class="mini-list">${mine}</ul>` : ''}${hi ? `<h3 class="proj-title">Project highlights</h3><ul class="mini-list">${hi}</ul>` : ''}`;
  return panel({ title: 'Focus', body, span: 6, cls: 'panel-focus' });
}

function learnPanel(store, cs) {
  if (!cs.length) return panel({ title: 'New to you', body: '<p class="muted">Explainers appear here as new services and tools come up.</p>', span: 6 });
  const order = { new: 0, learning: 1, known: 2 };
  const sorted = [...cs].sort((a, b) => (order[a.status] ?? 0) - (order[b.status] ?? 0) || b.first.localeCompare(a.first) || a.name.localeCompare(b.name));
  const row = (c) => `<li><a class="wl concept-row" href="#" data-note="${esc(c.path)}"><span class="concept-name">${esc(c.name)}${c.status !== 'new' ? ` <span class="pill pill-${c.status === 'known' ? 'positive' : 'warning'}">${esc(c.status)}</span>` : ''}</span><span class="concept-line">${esc(conceptLine(store, c.path))}</span></a></li>`;
  const top = sorted.slice(0, 6).map(row).join('');
  const more = sorted.slice(6);
  const body = `<p class="muted learn-hint">One note per service or tool: what it is and how we use it. Set <code>status: known</code> in Obsidian when you've got it.</p>
    <ul class="concept-list">${top}</ul>
    ${more.length ? `<details class="more"><summary>${more.length} more ${ICON.chev}</summary><ul class="concept-list">${more.map(row).join('')}</ul></details>` : ''}`;
  return panel({ title: 'New to you', count: cs.filter((c) => c.status === 'new').length, body, span: 6, cls: 'panel-learn' });
}

function decisionsPanel(store) {
  const path = P('Overview/Decisions.md');
  if (store.text(path) == null) return '';
  const ctx = new Ctx(store, path);
  const { blocks } = parseNote(store, path);
  const items = [];
  let date = '';
  for (const b of blocks) {
    if (b.t === 'h' && b.level === 2) date = b.text;
    if (b.t === 'list') for (const it of b.items) if (items.length < 5) items.push({ date, text: it.text });
  }
  const body = items.length
    ? `<ul class="mini-list">${items.map((x) => `<li>${inline(x.text, ctx)} <span class="muted">· ${esc(x.date)}</span></li>`).join('')}</ul><ul class="links proj-links">${linkRow(path, 'All decisions')}</ul>`
    : '<p class="muted">No decisions logged yet.</p>';
  return panel({ title: 'Recent decisions', body, span: 6 });
}

function questionsPanel(store) {
  const path = P('Overview/Open Questions.md');
  if (store.text(path) == null) return '';
  const ctx = new Ctx(store, path);
  const { blocks } = parseNote(store, path);
  const open = sections(blocks).find(/^open/i);
  const table = open?.blocks.find((b) => b.t === 'table');
  const rows = (table?.rows ?? []).filter((r) => r.cells[0]);
  const body = rows.length
    ? `<ul class="mini-list">${rows.slice(0, 5).map((r) => `<li>${inline(r.cells[0], ctx)}${r.cells[1] ? ` <span class="muted">· ${esc(plain(r.cells[1]))}</span>` : ''}</li>`).join('')}</ul><ul class="links proj-links">${linkRow(path, `All open questions`, String(rows.length))}</ul>`
    : '<p class="muted">Nothing open.</p>';
  return panel({ title: 'Open questions', count: rows.length, body, span: 6 });
}

function teamPanel(store, status) {
  const team = status?.team ?? [];
  if (!team.length) return '';
  const chips = team.map((m) => {
    const label = `<span class="team-name">${esc(m.name)}</span><span class="team-role">${esc(m.role ?? '')}</span>`;
    return m.note && store.text(m.note) != null ? `<a class="wl team-chip" href="#" data-note="${esc(m.note)}">${label}</a>` : `<span class="team-chip">${label}</span>`;
  }).join('');
  return panel({ title: 'Team', body: `<div class="team-grid">${chips}</div>`, span: 6 });
}

function mapPanel(store, status) {
  const notes = [
    ['CTS Search.md', 'Project hub'], ['Overview/Architecture.md', 'Architecture'], ['Overview/Roadmap.md', 'Roadmap'],
    ['Overview/Stakeholders.md', 'Stakeholders'], ['Overview/Jira & Sprints.md', 'Jira & sprints'],
  ].filter(([p]) => store.text(P(p)) != null).map(([p, l]) => linkRow(P(p), l)).join('');
  const links = (status?.links ?? []).map((l) => extLink(l.url, esc(l.label), 'chip-link ext')).join('');
  return panel({ title: 'Map', body: `<ul class="links">${notes}</ul>${links ? `<div class="chip-row">${links}</div>` : ''}`, span: 6 });
}

export function projectView(store) {
  return {
    route: 'project', title: 'My Project',
    render(el) {
      if (!store.connected) { el.innerHTML = `${hero(store, null)}<div class="grid">${connectPanel(store)}</div>`; return; }
      const status = store.json(P('_data/status.json'), null);
      const repos = store.json(P('_data/repos.json'), null);
      const hasBrain = status || repos || store.files(ROOT).length;
      if (!hasBrain) {
        el.innerHTML = `${hero(store, null)}${syncBanner(store)}${store.syncing && !store.hasData ? loading() : `<div class="grid">${panel({ title: 'No project brain yet', body: '<p class="muted">The brain hasn\'t been built yet. Once <code>Projects/CTS Search/</code> is in your vault, this page shows the project status, repo activity and new concepts.</p>', span: 12 })}</div>`}`;
        return;
      }
      const cs = concepts(store);
      el.innerHTML = `
        ${hero(store, status)}
        ${syncBanner(store)}
        <div class="grid">
          ${tiles(status, repos, cs)}
          ${updatePanel(store)}
          ${focusPanel(store, status)}
          ${learnPanel(store, cs)}
          ${reposPanel(store, repos)}
          ${decisionsPanel(store)}
          ${questionsPanel(store)}
          ${teamPanel(store, status)}
          ${mapPanel(store, status)}
        </div>`;
    },
  };
}

