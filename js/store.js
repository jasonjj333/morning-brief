// Reads the vault from the private GitHub repo (or the local dev server), caches it by blob sha,
// and writes checkbox changes and feedback back as commits.

const CFG_KEY = 'brief.config';
const CACHE_KEY = 'brief.cache.v1';
const OUTBOX_KEY = 'brief.outbox';

const DEFAULTS = { owner: 'jasonjj333', repo: 'pariveda-notes', branch: 'main', token: '', name: 'Jason' };

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const b64encode = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

class GitHubSource {
  constructor(cfg) { this.cfg = cfg; }
  get base() { return `https://api.github.com/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}`; }
  async api(path, opts = {}) {
    const res = await fetch(this.base + path, {
      cache: 'no-store',
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.cfg.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!res.ok) {
      const err = new Error(res.status === 401 ? 'The access token was rejected.' : res.status === 404 ? 'Repository not found, or the token cannot see it.' : `GitHub returned ${res.status}.`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
  async tree() {
    const r = await this.api(`/git/trees/${encodeURIComponent(this.cfg.branch)}?recursive=1`);
    return r.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha }));
  }
  async blob(sha) { return b64decode((await this.api(`/git/blobs/${sha}`)).content); }
  async readFresh(path) {
    try {
      const r = await this.api(`/contents/${encPath(path)}?ref=${encodeURIComponent(this.cfg.branch)}`);
      return { text: b64decode(r.content), sha: r.sha };
    } catch (e) {
      if (e.status === 404) return { text: null, sha: null };
      throw e;
    }
  }
  async write(path, text, sha, message) {
    const body = { message, content: b64encode(text), branch: this.cfg.branch, ...(sha ? { sha } : {}) };
    const r = await this.api(`/contents/${encPath(path)}`, { method: 'PUT', body: JSON.stringify(body) });
    const c = r.commit;
    return { sha: r.content.sha, commit: c ? { date: c.committer?.date, message: (c.message ?? '').split('\n')[0] } : null };
  }
  async lastCommit() {
    const r = await this.api(`/commits?sha=${encodeURIComponent(this.cfg.branch)}&per_page=1`);
    const c = r[0]?.commit;
    return c ? { date: c.committer.date, message: c.message.split('\n')[0] } : null;
  }
}

// Local preview: dev/serve.mjs serves a copy of the vault at /__dev.
class DevSource {
  async j(path, opts) {
    const res = await fetch('/__dev' + path, { cache: 'no-store', ...opts });
    if (!res.ok) { const e = new Error(`Dev server returned ${res.status}`); e.status = res.status; throw e; }
    return res.json();
  }
  tree() { return this.j('/tree'); }
  async blob(sha) { return (await this.j(`/blob/${sha}`)).text; }
  readFresh(path) { return this.j(`/file?path=${encodeURIComponent(path)}`); }
  write(path, text, sha, message) {
    return this.j(`/file?path=${encodeURIComponent(path)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, sha, message }) });
  }
  lastCommit() { return this.j('/commit'); }
}

const WANTED = /\.(md|json|base)$/i;
const SKIP = /^(\.obsidian|\.trash|Templates)\//;

export class Store extends EventTarget {
  constructor() {
    super();
    this.config = { ...DEFAULTS, ...read(CFG_KEY, {}) };
    this.dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('dev');
    const cached = read(CACHE_KEY, null);
    this.tree = cached?.tree ?? [];
    this.blobs = cached?.blobs ?? {};
    this.commit = cached?.commit ?? null;
    this.syncedAt = cached?.syncedAt ?? 0;
    this.syncing = false;
    this.error = null;
    this.outbox = read(OUTBOX_KEY, []);
  }

  get connected() { return this.dev || !!this.config.token; }
  get source() { return this.dev ? new DevSource() : new GitHubSource(this.config); }
  get hasData() { return this.tree.length > 0; }

  setConfig(patch) {
    const repoChanged = ['owner', 'repo', 'branch'].some((k) => k in patch && patch[k] !== this.config[k]);
    this.config = { ...this.config, ...patch };
    write(CFG_KEY, this.config);
    if (repoChanged) { this.tree = []; this.blobs = {}; this.commit = null; this.persist(); }
    this.emit();
  }

  signOut() {
    this.config = { ...this.config, token: '' };
    write(CFG_KEY, this.config);
    this.tree = []; this.blobs = {}; this.commit = null;
    try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    this.emit();
  }

  persist() { write(CACHE_KEY, { tree: this.tree, blobs: this.blobs, commit: this.commit, syncedAt: this.syncedAt }); }
  // kind: 'status' (syncing, errors), 'local' (this device saved something), 'data' (the vault changed elsewhere).
  emit(kind = 'data') { this.dispatchEvent(new CustomEvent('change', { detail: { kind } })); }

  text(path) {
    const e = this.tree.find((x) => x.path === path);
    return e ? this.blobs[e.sha] ?? null : null;
  }
  files(prefix = '') { return this.tree.filter((e) => e.path.startsWith(prefix) && WANTED.test(e.path)).map((e) => e.path); }
  json(path, fallback) { try { return JSON.parse(this.text(path)) ?? fallback; } catch { return fallback; } }

  async sync() {
    if (!this.connected || this.syncing) return;
    this.syncing = true; this.error = null; this.emit('status');
    const before = this.tree.map((e) => e.sha).join() + (this.commit?.date ?? '');
    let changed = false;
    try {
      const src = this.source;
      const [tree, commit] = await Promise.all([src.tree(), src.lastCommit().catch(() => null)]);
      const wanted = tree.filter((e) => WANTED.test(e.path) && !SKIP.test(e.path));
      const missing = wanted.filter((e) => !(e.sha in this.blobs));
      for (let i = 0; i < missing.length; i += 6) {
        const batch = missing.slice(i, i + 6);
        const texts = await Promise.all(batch.map((e) => src.blob(e.sha)));
        batch.forEach((e, k) => { this.blobs[e.sha] = texts[k]; });
      }
      const keep = new Set(wanted.map((e) => e.sha));
      for (const sha of Object.keys(this.blobs)) if (!keep.has(sha)) delete this.blobs[sha];
      this.tree = wanted;
      this.commit = commit;
      this.syncedAt = Date.now();
      changed = before !== this.tree.map((e) => e.sha).join() + (this.commit?.date ?? '');
      this.persist();
      await this.flushOutbox();
    } catch (e) {
      this.error = e;
    } finally {
      this.syncing = false;
      this.emit(changed ? 'data' : 'status');
    }
  }

  // Read the latest copy, change it, write it; retry once if someone else committed in between.
  async mutate(path, fn, message) {
    const src = this.source;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { text, sha } = await src.readFresh(path);
      const next = fn(text);
      if (next == null || next === text) return false;
      try {
        const res = await src.write(path, next, sha, message);
        const entry = this.tree.find((x) => x.path === path);
        if (entry) entry.sha = res.sha; else this.tree.push({ path, sha: res.sha });
        this.blobs[res.sha] = next;
        // Our own commit is the newest one now; remember it so the next sync doesn't treat it as news.
        if (res.commit?.date) this.commit = res.commit;
        this.persist();
        this.emit('local');
        return true;
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt < 2) continue;
        throw e;
      }
    }
    return false;
  }

  // ---------- feedback ----------

  get inbox() { return this.json('Feedback/inbox.json', { version: 1, items: [] }).items ?? []; }
  get processed() { return this.json('Feedback/processed.json', { version: 1, items: [] }).items ?? []; }
  get pending() { return [...this.inbox, ...this.outbox]; }

  async addFeedback(entry) {
    const item = { id: crypto.randomUUID(), at: new Date().toISOString(), ...entry };
    this.outbox.push(item);
    write(OUTBOX_KEY, this.outbox);
    this.emit('local');
    await this.flushOutbox();
    return item;
  }

  async withdrawFeedback(id) {
    const before = this.outbox.length;
    this.outbox = this.outbox.filter((x) => x.id !== id);
    write(OUTBOX_KEY, this.outbox);
    if (this.outbox.length !== before) { this.emit('local'); return; }
    await this.mutate('Feedback/inbox.json', (text) => {
      const doc = safeJson(text);
      doc.items = (doc.items ?? []).filter((x) => x.id !== id);
      return JSON.stringify(doc, null, 2) + '\n';
    }, 'brief: withdraw feedback');
  }

  async flushOutbox() {
    if (!this.outbox.length || !this.connected) return;
    const batch = [...this.outbox];
    try {
      await this.mutate('Feedback/inbox.json', (text) => {
        const doc = safeJson(text);
        const ids = new Set((doc.items ?? []).map((x) => x.id));
        doc.items = [...(doc.items ?? []), ...batch.filter((x) => !ids.has(x.id))];
        return JSON.stringify(doc, null, 2) + '\n';
      }, batch.length === 1 ? `brief: feedback (${batch[0].action}) — ${(batch[0].target?.text || batch[0].add?.text || batch[0].note || '').slice(0, 60)}` : `brief: ${batch.length} feedback items`);
      const sent = new Set(batch.map((x) => x.id));
      this.outbox = this.outbox.filter((x) => !sent.has(x.id));
      write(OUTBOX_KEY, this.outbox);
      this.emit('local');
    } catch (e) {
      this.error = e;
      this.emit('status');
      throw e;
    }
  }

  // ---------- routines and drafts ----------

  get routinesDoc() { return this.json('Feedback/routines.json', { routines: [], models: [] }); }
  get routines() { return this.routinesDoc.routines ?? []; }
  get models() { return this.routinesDoc.models ?? []; }
  get runs() { return this.json('Feedback/runs.json', { runs: [] }).runs ?? []; }
  get runRequests() { return this.json('Feedback/run-requests.json', { requests: [] }).requests ?? []; }
  get drafts() { return this.json('Feedback/drafts.json', { drafts: [] }).drafts ?? []; }

  // The vault's GitHub Action fires the routine when this file changes.
  async requestRun(key) {
    const req = { id: crypto.randomUUID(), routine: key, at: new Date().toISOString() };
    await this.mutate('Feedback/run-requests.json', (text) => {
      const doc = safeJsonDoc(text, 'requests');
      doc.requests = [...doc.requests, req].slice(-50);
      return JSON.stringify(doc, null, 2) + '\n';
    }, `app: run ${key} now`);
    return req;
  }

  async setModel(key, model) {
    await this.mutate('Feedback/routines.json', (text) => {
      const doc = JSON.parse(text);
      const r = doc.routines.find((x) => x.key === key);
      if (!r || r.model === model) return null;
      r.model = model;
      return JSON.stringify(doc, null, 2) + '\n';
    }, `app: ${key} routine uses ${model}`);
  }

  async saveDraft(id, patch) {
    await this.mutate('Feedback/drafts.json', (text) => {
      const doc = safeJsonDoc(text, 'drafts');
      const d = doc.drafts.find((x) => x.id === id);
      if (!d) throw Object.assign(new Error('That draft is gone. Pull to refresh.'), { status: 0 });
      Object.assign(d, patch, { edited: true, updated: new Date().toISOString() });
      return JSON.stringify(doc, null, 2) + '\n';
    }, 'app: edit draft');
  }

  // Toggle "- [ ]" on one line, found by its text so a shifted line number still works.
  async toggleTask(item, done) {
    let line = item.line, raw = item.raw;
    await this.mutate(item.file, (text) => {
      const lines = text.split('\n');
      let n = lines[item.line] === item.raw ? item.line : lines.indexOf(item.raw);
      if (n < 0) throw Object.assign(new Error('That line changed since this page loaded. Pull to refresh and try again.'), { status: 0 });
      lines[n] = lines[n].replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]');
      line = n; raw = lines[n];
      return lines.join('\n');
    }, `brief: ${done ? 'done' : 'reopen'} — ${item.text.slice(0, 60)}`);
    // The page isn't redrawn after a save, so keep the on-screen item in step with the file.
    Object.assign(item, { line, raw, checked: done });
    // Tell the routine, so it can mirror the change into the other notes that list this item.
    this.outbox.push({ id: crypto.randomUUID(), at: new Date().toISOString(), action: done ? 'done' : 'reopen', target: target(item), note: '' });
    write(OUTBOX_KEY, this.outbox);
    await this.flushOutbox().catch(() => {});
  }
}

export const target = (item) => ({ file: item.file, line: item.line, raw: item.raw, text: item.text, section: item.section ?? null });

function safeJsonDoc(text, key) {
  try { const d = JSON.parse(text || ''); if (d && Array.isArray(d[key])) return d; } catch { /* fall through */ }
  return { version: 1, [key]: [] };
}

function safeJson(text) {
  try { const d = JSON.parse(text || ''); return d && typeof d === 'object' ? d : { version: 1, items: [] }; } catch { return { version: 1, items: [] }; }
}
