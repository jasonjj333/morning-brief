// Local preview: serves the site and a throwaway copy of a vault at /__dev.
// node dev/serve.mjs <path-to-vault-copy> [port] [path-to-personal-vault-copy]
// The work vault is served at /__dev, the personal one at /__devp.
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, extname, dirname, resolve, relative } from 'node:path';

const site = resolve(dirname(new URL(import.meta.url).pathname), '..');
// Without a third path, a personal-copy folder next to the work copy is used when there is one.
const work = resolve(process.argv[2] ?? '');
const sibling = join(dirname(work), 'personal-copy');
const vaults = { '/__dev': work, '/__devp': resolve(process.argv[4] ?? (existsSync(sibling) ? sibling : work)) };
let vault = vaults['/__dev'];
const port = +(process.argv[3] ?? 4173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const sha = (t) => createHash('sha1').update(t).digest('hex');
const blobs = new Map();

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out); else out.push(p);
  }
  return out;
}
const inside = (p) => { const r = relative(vault, p); return r && !r.startsWith('..'); };
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = /^(\/__devp?)(\/.*)$/.exec(url.pathname);
  if (m) { vault = vaults[m[1]]; url.pathname = '/__dev' + m[2]; }
  try {
    if (url.pathname === '/__dev/tree') {
      const files = await walk(vault);
      const tree = [];
      for (const f of files) { const t = await readFile(f, 'utf8'); const h = sha(t); blobs.set(h, t); tree.push({ path: relative(vault, f), sha: h }); }
      return json(res, 200, tree);
    }
    if (url.pathname.startsWith('/__dev/blob/')) return json(res, 200, { text: blobs.get(url.pathname.split('/').pop()) ?? '' });
    if (url.pathname === '/__dev/commit') return json(res, 200, { date: new Date().toISOString(), message: 'Local preview' });
    if (url.pathname === '/__dev/file') {
      const p = resolve(vault, url.searchParams.get('path'));
      if (!inside(p)) return json(res, 400, {});
      if (req.method === 'PUT') {
        let body = ''; for await (const c of req) body += c;
        const { text, sha: prev, message } = JSON.parse(body);
        let cur = null; try { cur = await readFile(p, 'utf8'); } catch {}
        if (cur != null && prev && sha(cur) !== prev) return json(res, 409, {});
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, text);
        console.log('write', relative(vault, p), '—', message);
        const h = sha(text); blobs.set(h, text);
        return json(res, 200, { sha: h });
      }
      try { const t = await readFile(p, 'utf8'); return json(res, 200, { text: t, sha: sha(t) }); } catch { return json(res, 200, { text: null, sha: null }); }
    }
    let p = join(site, decodeURIComponent(url.pathname));
    if ((await stat(p).catch(() => null))?.isDirectory()) p = join(p, 'index.html');
    if (!p.startsWith(site) || p.includes('/dev/') || p.includes('/.')) { res.writeHead(404); return res.end(); }
    const body = await readFile(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end(String(e.message)); }
}).listen(port, () => console.log(`http://localhost:${port}/?dev`));
