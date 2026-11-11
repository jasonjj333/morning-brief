// Project profile: the CTS Search second brain kept in the work vault under Projects/CTS Search/.
// Five pages, each leading with a short plain summary and putting detail one tap away:
// Overview, Updates, Repos (+ a page per repo), Learn and Decisions.
// Data: _data/status.json (cloud routine), _data/repos.json (repo sync on the Mac), Updates/*.md,
// Overview/*.md, Concepts/*.md and the hub note. Every note opens in the normal note view.

import { esc, inline, plain, stripLeadEmoji } from './md.js';
import { Ctx, renderBlocks, parseNote, sections, noteTitle } from './render.js';
import { panel, connectPanel, syncBanner, loading, ICON, ago, parseYmd, shortDate, longDate, today, placeThumb } from './views.js';

const ROOT = 'Projects/CTS Search/';
const P = (rel) => ROOT + rel;
const DAY = 86_400_000;

const status = (store) => store.json(P('_data/status.json'), null);
const reposDoc = (store) => store.json(P('_data/repos.json'), null);
const has = (store, path) => store.text(path) != null;

// ---------- small pieces ----------

const noteLink = (path, label, cls = 'wl') => `<a class="${cls}" href="#" data-note="${esc(path)}">${label}</a>`;
const extLink = (url, label, cls = 'ext') => `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
const linkRow = (path, label, meta = '') => `<li><a class="wl link-row" href="#" data-note="${esc(path)}"><span>${esc(label)}</span>${meta ? `<span class="link-meta">${esc(meta)}</span>` : ''}${ICON.chev}</a></li>`;
const pill = (text, kind) => `<span class="pill pill-${kind}">${esc(text)}</span>`;
const dayLabel = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? shortDate(d) : ''; };
const gear = () => `<button class="icon-btn" type="button" data-action="settings" aria-label="Settings">${ICON.gear}</button>`;

function pageHead(title, sub = '', lead = '') {
  return `<header class="hero p-head">
    <h1 class="greeting large-title">${esc(title)}</h1>
    ${sub ? `<p class="dateline">${esc(sub)}</p>` : ''}
    ${lead ? `<p class="finding">${lead}</p>` : ''}
  </header>`;
}

// A page needs the vault; show the connect card or an empty state until it has one.
function guard(store, el, title) {
  if (!store.connected) { el.innerHTML = `${pageHead(title)}<div class="grid">${connectPanel(store)}</div>`; return false; }
  if (!store.files(ROOT).length) {
    el.innerHTML = `${pageHead(title)}${syncBanner(store)}${store.syncing && !store.hasData ? loading()
      : `<div class="grid">${panel({ title: 'No project brain yet', span: 12, body: '<p class="muted">Once <code>Projects/CTS Search/</code> is in your vault, this shows the project status, daily updates, repo activity and explainers.</p>' })}</div>`}`;
    return false;
  }
  return true;
}

// A segmented control like the Notes page uses; onPick(key) redraws the list below it.
function segmented(el, segs, state, onPick) {
  const bar = el.querySelector('.segmented');
  placeThumb(bar, false);
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg]');
    if (!b || b.dataset.seg === state.seg) return;
    state.seg = b.dataset.seg;
    for (const x of bar.querySelectorAll('[data-seg]')) x.setAttribute('aria-selected', String(x === b));
    placeThumb(bar, true);
    onPick(state.seg);
  });
}
const segHTML = (segs, cur, label) => `<div class="segmented" role="tablist" aria-label="${esc(label)}"><span class="seg-thumb" aria-hidden="true"></span>${segs.map(([k, l]) => `<button type="button" role="tab" data-seg="${k}" aria-selected="${cur === k}">${esc(l)}</button>`).join('')}</div>`;

// ---------- data helpers ----------

function updatesList(store) {
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
    return { path, name: noteTitle(path), status: data.status || 'new', first: data.first_seen || '', category: (data.category || 'other').toLowerCase() };
  });
}

// Wikilink targets mentioned in a block of markdown text (used for an update's "New to you" concepts).
const linkTargets = (text) => [...new Set([...(text ?? '').matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()))];

function phases(store) {
  const path = P('Overview/Roadmap.md');
  if (!has(store, path)) return [];
  const { blocks } = parseNote(store, path);
  const table = sections(blocks).find(/phase/i)?.blocks.find((b) => b.t === 'table');
  return (table?.rows ?? []).filter((r) => r.cells[1]).map((r) => {
    const raw = r.cells.join(' ');
    return {
      n: plain(r.cells[0]),
      name: plain(r.cells[1]),
      what: plain(r.cells[2] ?? '').replace(/←.*$/, '').trim(),
      current: /we are here/i.test(raw),
    };
  });
}

// ---------- shared cards ----------

function tiles(st, repos, cs) {
  const end = parseYmd(st?.deadline);
  const start = parseYmd(st?.start);
  const now = today();
  const left = end ? Math.max(0, Math.round((end - now) / DAY)) : null;
  const pct = end && start ? Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100))) : null;
  const open = (repos?.repos ?? []).flatMap((r) => r.open_prs ?? []);
  const mine = open.filter((p) => p.mine).length;
  const fresh = cs.filter((c) => c.status === 'new').length;
  return `<div class="tiles span-12">
    <div class="tile"><span class="tile-label">Days to build deadline</span><span class="tile-value">${left ?? '—'}</span><span class="tile-cap">${end ? `Due ${esc(shortDate(end))}` : 'No deadline set'}</span></div>
    <div class="tile"><span class="tile-label">Timeline used</span><span class="tile-value">${pct != null ? `${pct}%` : '—'}</span><span class="tile-cap">${esc(st?.sprint?.name ?? '—')}</span></div>
    <div class="tile"><span class="tile-label">Open PRs</span><span class="tile-value">${open.length}</span><span class="tile-cap">${mine ? `${mine} ${mine === 1 ? 'is' : 'are'} yours` : 'None are yours'}</span></div>
    <div class="tile"><span class="tile-label">Concepts to learn</span><span class="tile-value">${fresh}</span><span class="tile-cap">${cs.length} explained so far</span></div>
  </div>`;
}

const REVIEW = { APPROVED: ['Approved', 'positive'], CHANGES_REQUESTED: ['Changes requested', 'negative'], REVIEW_REQUIRED: ['Needs review', 'neutral'] };
const CI = { passing: ['CI passing', 'positive'], failing: ['CI failing', 'negative'], pending: ['CI running', 'warning'] };

function prHTML(p, { full = true } = {}) {
  const rv = REVIEW[p.review] ?? REVIEW.REVIEW_REQUIRED;
  const ci = CI[p.ci];
  return `<li class="pr">
    <div class="pr-title">${extLink(p.url, `#${p.number} ${esc(p.title)}`)}</div>
    <div class="pr-meta">${esc(p.author)}${p.updated ? ` · updated ${esc(ago(p.updated))}` : ''}${p.files ? ` · ${p.files} files` : ''}</div>
    <div class="row-pills">${p.mine ? pill('Yours', 'accent') : ''}${pill(rv[0], rv[1])}${ci ? pill(ci[0], ci[1]) : ''}</div>
    ${p.ci_note ? `<div class="pr-note muted">${esc(p.ci_note)}</div>` : ''}
    ${full && p.summary ? `<p class="pr-sum">${esc(p.summary)}</p>` : ''}
  </li>`;
}

// ---------- 1. Overview ----------

export function projectHomeView(store) {
  return {
    route: 'p-home', title: 'Overview',
    navRight: gear,
    render(el) {
      if (!guard(store, el, 'CTS Search')) return;
      const st = status(store);
      const repos = reposDoc(store);
      const cs = concepts(store);
      const hub = P('CTS Search.md');
      const sub = [st?.client ?? 'Toyota', st?.phase, st?.updated ? `updated ${ago(st.updated)}` : ''].filter(Boolean).join(' · ');

      // Where things stand: the hub's own section, so it reads exactly like the note.
      let stand = '';
      if (has(store, hub)) {
        const ctx = new Ctx(store, hub);
        const s = sections(parseNote(store, hub).blocks).find(/where things stand/i);
        if (s) { ctx.section = 'Where things stand'; stand = renderBlocks(s.blocks, ctx); }
      }

      // Roadmap stepper.
      const ph = phases(store);
      const roadmap = ph.length ? `<ol class="stepper">${ph.map((x) => `<li class="step${x.current ? ' is-current' : ''}">
          <span class="step-dot" aria-hidden="true">${esc(x.n)}</span>
          <span class="step-text"><span class="step-name">${esc(x.name)}${x.current ? ` ${pill('Now', 'accent')}` : ''}</span><span class="step-what">${esc(x.what)}</span></span>
        </li>`).join('')}</ol>` : '<p class="muted">The roadmap note is missing.</p>';
      const sprint = st?.sprint ? `<p class="sprint-line"><strong>${esc(st.sprint.name)}</strong>${st.sprint.goal ? ` · Goal: ${esc(st.sprint.goal)}` : ''}${st.deadline ? ` · Build due ${esc(shortDate(parseYmd(st.deadline)))}` : ''}</p>` : '';

      // For you: your open items plus what the latest update says to do.
      const focus = (st?.my_focus ?? []).map((x) => `<li>${x.note && has(store, x.note) ? noteLink(x.note, esc(x.text)) : x.link ? extLink(x.link, esc(x.text)) : esc(x.text)}</li>`).join('');
      const latest = updatesList(store)[0];
      let means = '';
      if (latest) {
        const ctx = new Ctx(store, latest);
        const s = sections(parseNote(store, latest).blocks).find(/means for you/i);
        if (s) { ctx.section = 'What this means for you'; means = renderBlocks(s.blocks, ctx); }
      }
      const forYou = `${focus ? `<h3 class="proj-title">Your open items</h3><ul class="mini-list">${focus}</ul>` : ''}
        ${means ? `<h3 class="proj-title">From the latest update</h3>${means}` : ''}` || '<p class="muted">Nothing waiting on you.</p>';

      const team = (st?.team ?? []).map((m) => {
        const label = `<span class="team-name">${esc(m.name)}</span><span class="team-role">${esc(m.role ?? '')}</span>`;
        return m.note && has(store, m.note) ? `<a class="wl team-chip" href="#" data-note="${esc(m.note)}">${label}</a>` : `<span class="team-chip">${label}</span>`;
      }).join('');

      const notes = [['CTS Search.md', 'Project hub'], ['Overview/Architecture.md', 'How it works (architecture)'], ['Overview/Roadmap.md', 'Roadmap'], ['Overview/Stakeholders.md', 'Who’s who at Toyota']]
        .filter(([p]) => has(store, P(p))).map(([p, l]) => linkRow(P(p), l)).join('');
      const links = (st?.links ?? []).map((l) => extLink(l.url, esc(l.label), 'chip-link ext')).join('')
        + (repos?.repos ?? []).map((r) => extLink(r.url, esc(r.name), 'chip-link ext')).join('');

      el.innerHTML = `
        ${pageHead(st?.project ?? 'CTS Search Platform', sub, st?.headline ? esc(st.headline) : '')}
        ${syncBanner(store)}
        <div class="grid">
          ${tiles(st, repos, cs)}
          ${panel({ title: 'Where things stand', body: stand || '<p class="muted">The hub has no status yet.</p>', span: 12, cls: 'p-stand' })}
          ${panel({ title: 'Roadmap', body: sprint + roadmap, span: 12, cls: 'p-roadmap' })}
          ${panel({ title: 'For you', body: forYou, span: 6, cls: 'p-foryou' })}
          ${panel({ title: 'Team', body: team ? `<div class="team-grid">${team}</div>` : '<p class="muted">No team list yet.</p>', span: 6 })}
          ${panel({ title: 'Go deeper', body: `<ul class="links">${notes}</ul>${links ? `<div class="chip-row">${links}</div>` : ''}`, span: 12 })}
        </div>`;
    },
  };
}

// ---------- 2. Updates ----------

export function projectUpdatesView(store) {
  return {
    route: 'p-updates', title: 'Updates',
    render(el) {
      if (!guard(store, el, 'Updates')) return;
      const list = updatesList(store);
      if (!list.length) {
        el.innerHTML = `${pageHead('Updates')}<div class="grid">${panel({ title: 'No updates yet', span: 12, body: '<p class="muted">The first daily project update arrives with the next morning brief.</p>' })}</div>`;
        return;
      }
      const card = (path, i) => {
        const ctx = new Ctx(store, path);
        const { data, blocks } = parseNote(store, path);
        const sec = sections(blocks);
        const d = parseYmd(data.date ?? noteTitle(path));
        const tldr = sec.lead.find((b) => b.t === 'callout');
        const you = sec.find(/means for you/i);
        const learn = sec.find(/new to you/i);
        const learnText = (store.text(path) ?? '').split(/\n(?=## )/).find((s) => /^## .*new to you/i.test(s)) ?? '';
        const chips = linkTargets(learnText).map((t) => {
          const hit = ctx.resolve(t);
          return hit ? `<a class="wl chip-link chip-small" href="#" data-note="${esc(hit)}">${esc(t.split('/').pop())}</a>` : '';
        }).join('');
        const rest = sec.list.filter((s) => s !== you && s !== learn);
        ctx.section = 'Update';
        return `<article class="panel span-12 upd-card${i === 0 ? ' is-latest' : ''}">
          <header class="upd-head"><h2>${esc(d ? longDate(d) : noteTitle(path))}</h2>${i === 0 ? pill('Latest', 'accent') : ''}${noteLink(path, 'Open', 'wl text-btn upd-open')}</header>
          ${tldr ? `<div class="tldr">${renderBlocks(tldr.children, ctx)}</div>` : ''}
          ${you ? `<div class="proj-group"><h3 class="proj-title">What this means for you</h3>${renderBlocks(you.blocks, ctx)}</div>` : ''}
          ${chips ? `<div class="upd-learn"><span class="upd-learn-label">New to you</span><div class="chip-row">${chips}</div></div>` : ''}
          ${rest.length ? `<div class="proj-sections">${rest.map((s) => { ctx.section = `Update · ${s.title}`; return `<details class="callout c-note"><summary><span>${esc(s.title)}</span>${ICON.chev}</summary><div class="callout-body">${renderBlocks(s.blocks, ctx)}</div></details>`; }).join('')}</div>` : ''}
        </article>`;
      };
      const shown = list.slice(0, 7);
      const older = list.slice(7);
      el.innerHTML = `
        ${pageHead('Updates', `${list.length} daily update${list.length === 1 ? '' : 's'}`, 'One note per weekday: what changed in meetings, Slack, email and the repos, and what it means for you.')}
        ${syncBanner(store)}
        <div class="grid">
          ${shown.map(card).join('')}
          ${older.length ? panel({ title: 'Older updates', count: older.length, span: 12, body: `<ul class="links">${older.map((p) => { const d = parseYmd(noteTitle(p)); return linkRow(p, d ? longDate(d) : noteTitle(p)); }).join('')}</ul>` }) : ''}
        </div>`;
    },
  };
}

// ---------- 3. Repos ----------

const repoLast = (r) => [...(r.recent_commits ?? []).map((c) => c.date), ...(r.open_prs ?? []).map((p) => p.updated)].filter(Boolean).sort().pop();
const latestActivity = (store) => store.files(P('Repos/Activity/')).filter((p) => p.endsWith('.md')).sort().pop() ?? null;

export function projectReposView(store) {
  return {
    route: 'p-repos', title: 'Repos',
    render(el) {
      if (!guard(store, el, 'Repos')) return;
      const doc = reposDoc(store);
      const repos = doc?.repos ?? [];
      const activity = latestActivity(store);
      if (!repos.length) {
        el.innerHTML = `${pageHead('Repos')}<div class="grid">${panel({ title: 'No repo data yet', span: 12, body: '<p class="muted">Repo activity appears after the first repo sync on your Mac (weekdays at 5:30).</p>' })}</div>`;
        return;
      }
      const mine = repos.flatMap((r) => (r.open_prs ?? []).filter((p) => p.mine).map((p) => ({ ...p, repo: r.name })));
      const needs = mine.length
        ? `<ul class="pr-list">${mine.map((p) => prHTML(p, { full: false }).replace('<div class="pr-meta">', `<div class="pr-meta">${esc(p.repo)} · `)).join('')}</ul>`
        : '<p class="muted">None of your PRs are open.</p>';
      const cards = repos.map((r) => {
        const open = r.open_prs ?? [];
        const failing = open.filter((p) => p.ci === 'failing').length;
        const last = repoLast(r);
        return `<a class="repo-tile" href="#" data-push="repo:${esc(r.name)}">
          <span class="repo-tile-head"><span class="repo-tile-name">${esc(r.name)}</span>${ICON.chev}</span>
          <span class="repo-tile-sum">${esc(r.summary ?? '')}</span>
          <span class="row-pills">${pill(`${open.length} open PR${open.length === 1 ? '' : 's'}`, open.length ? 'accent' : 'neutral')}${failing ? pill(`${failing} CI failing`, 'negative') : ''}${open.some((p) => p.mine) ? pill('Has yours', 'positive') : ''}</span>
          ${last ? `<span class="repo-tile-last">Last activity ${esc(ago(last))}</span>` : ''}
        </a>`;
      }).join('');
      el.innerHTML = `
        ${pageHead('Repos', doc?.synced_at ? `Synced from your Mac ${ago(doc.synced_at)}` : '', 'The three CTS Search repos: what each is for, what’s open, and what changed. Tap a repo for its PRs, commits and review comments.')}
        ${syncBanner(store)}
        <div class="grid">
          ${panel({ title: 'Needs you', count: mine.length, body: needs, span: 12 })}
          <div class="span-12 repo-tiles">${cards}</div>
          ${activity ? `<div class="span-12 foot-links"><a class="wl link-row" href="#" data-note="${esc(activity)}"><span>Latest repo activity note</span><span class="link-meta">${esc(parseYmd(noteTitle(activity)) ? shortDate(parseYmd(noteTitle(activity))) : noteTitle(activity))}</span>${ICON.chev}</a></div>` : ''}
        </div>`;
    },
  };
}

export function repoDetailView(store, name) {
  return {
    route: 'repo:' + name, title: name, shortTitle: 'Repos',
    render(el) {
      const r = (reposDoc(store)?.repos ?? []).find((x) => x.name === name);
      if (!r) { el.innerHTML = `${pageHead(name)}<p class="muted">This repo isn’t in the latest sync.</p>`; return; }
      const open = r.open_prs ?? [];
      const merged = (r.recent_prs ?? []).map((p) => `<li>${extLink(p.url, `#${p.number} ${esc(p.title)}`)} <span class="muted">· ${esc(p.author)} · ${esc(p.state === 'MERGED' ? 'merged' : 'closed')} ${esc(dayLabel(p.date))}</span></li>`).join('');
      const commits = (r.recent_commits ?? []).map((c) => `<li>${extLink(c.url, `<code>${esc(c.sha)}</code>`)} ${esc(c.subject)} <span class="muted">· ${esc(c.author)} · ${esc(dayLabel(c.date))}</span></li>`).join('');
      const comments = (r.recent_comments ?? []).map((c) => `<li><strong>${esc(c.author)}</strong> on ${extLink(c.url, `#${c.pr}`)}${c.file ? ` <span class="muted">(${esc(c.file.split('/').pop())})</span>` : ''}: “${esc(c.text)}”</li>`).join('');
      const activity = latestActivity(store);
      const links = [r.note && has(store, r.note) ? linkRow(r.note, 'Repo note: layout, stack, CI/CD') : '', activity ? linkRow(activity, 'Latest activity note') : ''].join('');
      el.innerHTML = `
        ${pageHead(name, r.default_branch ? `Default branch ${r.default_branch}` : '', esc(r.summary ?? ''))}
        <div class="grid">
          <div class="span-12 chip-row repo-links">${extLink(r.url, 'Open on GitHub', 'chip-link ext')}</div>
          ${panel({ title: 'Open PRs', count: open.length, span: 12, body: open.length ? `<ul class="pr-list">${open.map((p) => prHTML(p)).join('')}</ul>` : '<p class="muted">Nothing open.</p>' })}
          ${panel({ title: 'Recently merged or closed', span: 6, body: merged ? `<ul class="mini-list">${merged}</ul>` : '<p class="muted">Nothing yet.</p>' })}
          ${panel({ title: 'Latest commits', span: 6, body: commits ? `<ul class="mini-list">${commits}</ul>` : '<p class="muted">No commits yet.</p>' })}
          ${panel({ title: 'Review comments', span: 12, body: comments ? `<ul class="mini-list">${comments}</ul>` : '<p class="muted">No review comments yet.</p>' })}
          ${links ? `<ul class="span-12 links">${links}</ul>` : ''}
        </div>`;
    },
  };
}

// ---------- 4. Learn ----------

const CATEGORIES = [
  ['search', 'Search'], ['ai', 'AI'], ['aws', 'AWS'], ['infra', 'Infrastructure'], ['backend', 'Backend'],
  ['frontend', 'Frontend'], ['tooling', 'Tooling'], ['security', 'Security'], ['process', 'Process'], ['other', 'Other'],
];
const START_HERE = ['Overview/Architecture.md', 'Concepts/OpenSearch Serverless.md', 'Concepts/Lexical vs Semantic vs Hybrid Search.md'];

export function projectLearnView(store) {
  const state = { seg: 'new' };
  return {
    route: 'p-learn', title: 'Learn',
    render(el) {
      if (!guard(store, el, 'Learn')) return;
      const cs = concepts(store);
      const count = (k) => cs.filter((c) => k === 'all' || c.status === k).length;
      const segs = [['new', `New ${count('new')}`], ['learning', `Learning ${count('learning')}`], ['known', `Known ${count('known')}`], ['all', 'All']];
      const start = START_HERE.filter((p) => has(store, P(p))).map((p) => {
        const path = P(p);
        const line = p.startsWith('Concepts/') ? conceptLine(store, path) : 'How the pieces fit together, step by step.';
        return `<li><a class="wl concept-row" href="#" data-note="${esc(path)}"><span class="concept-name">${esc(noteTitle(path))}</span><span class="concept-line">${esc(line)}</span></a></li>`;
      }).join('');
      el.innerHTML = `
        ${pageHead('Learn', `${cs.length} explainers`, 'Every service, tool or idea that has come up on the project, explained in plain words and tied to how we use it. When you’ve got one, set its <code>status:</code> to <code>known</code> in Obsidian.')}
        ${syncBanner(store)}
        <div class="grid">
          ${start ? panel({ title: 'Start here', span: 12, body: `<ul class="concept-list concept-grid">${start}</ul>` }) : ''}
          <div class="span-12">${segHTML(segs, state.seg, 'Filter explainers')}<div class="learn-groups"></div></div>
        </div>`;
      const box = el.querySelector('.learn-groups');
      const draw = () => {
        const pick = cs.filter((c) => state.seg === 'all' || c.status === state.seg);
        if (!pick.length) {
          box.innerHTML = `<p class="muted empty">${state.seg === 'new' ? 'Nothing new to learn. Nice.' : state.seg === 'known' ? 'Mark a note <code>status: known</code> in Obsidian and it moves here.' : 'Nothing here yet.'}</p>`;
          return;
        }
        const known = new Set(CATEGORIES.map(([k]) => k));
        box.innerHTML = CATEGORIES.map(([k, label]) => {
          const items = pick.filter((c) => (known.has(c.category) ? c.category : 'other') === k).sort((a, b) => a.name.localeCompare(b.name));
          if (!items.length) return '';
          return `<section class="learn-group"><h2 class="learn-cat">${esc(label)} <span class="count">${items.length}</span></h2><ul class="concept-list concept-grid">${items.map((c) => `<li><a class="wl concept-row" href="#" data-note="${esc(c.path)}"><span class="concept-name">${esc(c.name)}${c.status !== 'new' ? ` ${pill(c.status, c.status === 'known' ? 'positive' : 'warning')}` : ''}</span><span class="concept-line">${esc(conceptLine(store, c.path))}</span></a></li>`).join('')}</ul></section>`;
        }).join('');
      };
      draw();
      segmented(el, segs, state, draw);
    },
    onShow() { const s = this.page?.content.querySelector('.segmented'); if (s) placeThumb(s, false); },
  };
}

// ---------- 5. Decisions ----------

function decisionsHTML(store) {
  const path = P('Overview/Decisions.md');
  if (!has(store, path)) return '<p class="muted">No decision log yet.</p>';
  const ctx = new Ctx(store, path);
  const groups = [];
  for (const b of parseNote(store, path).blocks) {
    if (b.t === 'h' && b.level === 2) groups.push({ date: b.text, items: [] });
    else if (b.t === 'list' && groups.length) groups[groups.length - 1].items.push(...b.items);
  }
  if (!groups.length) return '<p class="muted">No decisions logged yet.</p>';
  return `<ol class="timeline">${groups.map((g) => {
    const d = parseYmd(g.date);
    return `<li class="tl-day"><h3 class="tl-date">${esc(d ? longDate(d) : g.date)}</h3><ul class="mini-list">${g.items.map((it) => `<li>${inline(it.text, ctx)}</li>`).join('')}</ul></li>`;
  }).join('')}</ol><ul class="links proj-links">${linkRow(path, 'Open the decision log')}</ul>`;
}

function questionsHTML(store) {
  const path = P('Overview/Open Questions.md');
  if (!has(store, path)) return '<p class="muted">No open questions note yet.</p>';
  const ctx = new Ctx(store, path);
  const sec = sections(parseNote(store, path).blocks);
  const rows = (sec.find(/^open/i)?.blocks.find((b) => b.t === 'table')?.rows ?? []).filter((r) => r.cells[0]);
  const resolved = sec.find(/resolved/i);
  const cards = rows.map((r) => `<li class="q-card">
      <div class="q-text">${inline(r.cells[0], ctx)}</div>
      <div class="q-meta">${r.cells[1] ? `<span>Owner: ${esc(plain(r.cells[1]))}</span>` : ''}${r.cells[2] ? `<span>Since ${esc(plain(r.cells[2]))}</span>` : ''}</div>
      ${r.cells[3] ? `<p class="q-notes">${inline(r.cells[3], ctx)}</p>` : ''}
    </li>`).join('');
  return `${cards ? `<ul class="q-list">${cards}</ul>` : '<p class="muted">Nothing open.</p>'}
    ${resolved ? `<details class="callout c-note"><summary><span>Resolved</span>${ICON.chev}</summary><div class="callout-body">${renderBlocks(resolved.blocks, ctx)}</div></details>` : ''}
    <ul class="links proj-links">${linkRow(path, 'Open the questions note')}</ul>`;
}

function storiesHTML(store) {
  const path = P('Overview/Jira & Sprints.md');
  if (!has(store, path)) return '<p class="muted">No Jira note yet.</p>';
  const ctx = new Ctx(store, path);
  const sec = sections(parseNote(store, path).blocks);
  const sprint = sec.list.find((s) => /sprint/i.test(s.title) && s.blocks.some((b) => b.t === 'table'));
  const table = sprint?.blocks.find((b) => b.t === 'table');
  const goal = sprint?.blocks.find((b) => b.t === 'p');
  const rules = sec.find(/rules/i);
  const statusKind = (s) => (/merged|done|accepted/i.test(s) ? 'positive' : /review/i.test(s) ? 'warning' : 'neutral');
  const cards = (table?.rows ?? []).filter((r) => r.cells[0]).map((r) => `<li class="q-card">
      <div class="q-text">${inline(r.cells[0], ctx)}</div>
      <div class="q-meta">${r.cells[1] ? `<span>${inline(r.cells[1], ctx)}</span>` : ''}${r.cells[2] ? pill(plain(r.cells[2]), statusKind(r.cells[2])) : ''}${r.cells[3] ? `<span>${inline(r.cells[3], ctx)}</span>` : ''}</div>
    </li>`).join('');
  return `${sprint ? `<h3 class="proj-title">${esc(stripLeadEmoji(sprint.title))}</h3>` : ''}${goal ? `<p class="sprint-line">${inline(goal.text, ctx)}</p>` : ''}
    ${cards ? `<ul class="q-list">${cards}</ul>` : '<p class="muted">No stories listed yet.</p>'}
    ${rules ? `<details class="callout c-note"><summary><span>Board rules</span>${ICON.chev}</summary><div class="callout-body">${renderBlocks(rules.blocks, ctx)}</div></details>` : ''}
    <ul class="links proj-links">${linkRow(path, 'Open Jira & sprints')}</ul>`;
}

export function projectDecisionsView(store) {
  const state = { seg: 'decisions' };
  return {
    route: 'p-decisions', title: 'Decisions',
    render(el) {
      if (!guard(store, el, 'Decisions')) return;
      const segs = [['decisions', 'Decisions'], ['questions', 'Questions'], ['stories', 'Stories']];
      el.innerHTML = `
        ${pageHead('Decisions', '', 'What the team has decided and why, what’s still open, and the stories in this sprint.')}
        ${syncBanner(store)}
        ${segHTML(segs, state.seg, 'Decisions view')}
        <div class="panel dec-body"></div>`;
      const box = el.querySelector('.dec-body');
      const draw = () => { box.innerHTML = state.seg === 'questions' ? questionsHTML(store) : state.seg === 'stories' ? storiesHTML(store) : decisionsHTML(store); };
      draw();
      segmented(el, segs, state, draw);
    },
    onShow() { const s = this.page?.content.querySelector('.segmented'); if (s) placeThumb(s, false); },
  };
}
