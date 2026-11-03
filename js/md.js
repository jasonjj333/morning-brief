// A small Obsidian-flavoured markdown parser that keeps the source line of every item,
// so a checkbox or a feedback note can point back at the exact line in the vault.

const LEAD_EMOJI = /^(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]+\s*)+/u;
export const stripLeadEmoji = (s) => s.replace(LEAD_EMOJI, '').trim();

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function splitFrontmatter(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let data = {};
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      data = parseYaml(lines.slice(1, end));
      start = end + 1;
    }
  }
  return { data, lines, start };
}

function parseYaml(ls) {
  const out = {};
  for (const l of ls) {
    const m = l.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean);
    } else v = unquote(v);
    out[m[1]] = v;
  }
  return out;
}
const unquote = (s) => s.replace(/^["'](.*)["']$/, '$1');

// ---------- blocks ----------

const RE = {
  heading: /^(#{1,6})\s+(.*)$/,
  hr: /^(?:-{3,}|\*{3,}|_{3,})\s*$/,
  list: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
  task: /^\[([ xX])\]\s+(.*)$/,
  quote: /^\s{0,3}>\s?(.*)$/,
  callout: /^\[!([A-Za-z-]+)\]([-+]?)\s*(.*)$/,
  embed: /^!\[\[([^\]]+)\]\]\s*$/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
};

// lines: the text lines to parse; at: original line number of each.
export function parseBlocks(lines, at = lines.map((_, i) => i)) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m;
    if ((m = line.match(RE.heading))) { blocks.push({ t: 'h', level: m[1].length, text: m[2].trim(), line: at[i] }); i++; continue; }
    if (RE.hr.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }
    if ((m = line.match(RE.embed))) { blocks.push({ t: 'embed', target: m[1], line: at[i] }); i++; continue; }

    if (RE.quote.test(line)) {
      const inner = [], innerAt = [];
      while (i < lines.length && RE.quote.test(lines[i])) {
        inner.push(lines[i].match(RE.quote)[1]); innerAt.push(at[i]); i++;
      }
      const c = inner[0].match(RE.callout);
      if (c) {
        blocks.push({
          t: 'callout', kind: c[1].toLowerCase(), fold: c[2], title: c[3].trim(),
          children: parseBlocks(inner.slice(1), innerAt.slice(1)), line: innerAt[0],
        });
      } else blocks.push({ t: 'quote', children: parseBlocks(inner, innerAt) });
      continue;
    }

    if (line.trim().startsWith('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push({ cells: cells(lines[i]), line: at[i] }); i++;
      }
      blocks.push({ t: 'table', head, rows });
      continue;
    }

    if (RE.list.test(line)) {
      const start = i;
      const items = [];
      while (i < lines.length) {
        const lm = lines[i].match(RE.list);
        if (lm) { items.push({ indent: lm[1].replace(/\t/g, '    ').length, marker: lm[2], body: lm[3], line: at[i] }); i++; continue; }
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1].body += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      if (i === start) i++;
      blocks.push(buildList(items));
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !RE.heading.test(lines[i]) && !RE.list.test(lines[i]) && !RE.quote.test(lines[i]) && !RE.embed.test(lines[i]) && !(lines[i].trim().startsWith('|'))) {
      para.push(lines[i].trim()); i++;
    }
    if (para.length) blocks.push({ t: 'p', text: para.join(' ') });
    else i++;
  }
  return blocks;
}

function cells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // Split on pipes that are not escaped or inside [[a|b]].
  const out = [];
  let cur = '', depth = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '[' && s[k + 1] === '[') { depth++; cur += '[['; k++; continue; }
    if (ch === ']' && s[k + 1] === ']') { depth = Math.max(0, depth - 1); cur += ']]'; k++; continue; }
    if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (ch === '|' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function buildList(flat) {
  const root = { t: 'list', ordered: /\d/.test(flat[0]?.marker ?? ''), items: [] };
  const stack = [{ indent: -1, list: root }];
  for (const f of flat) {
    while (stack.length > 1 && f.indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];
    const tm = f.body.match(RE.task);
    const item = { text: tm ? tm[2] : f.body, task: !!tm, checked: tm ? tm[1].toLowerCase() === 'x' : false, line: f.line, children: null };
    let list = parent.list;
    if (parent.item) {
      if (!parent.item.children) parent.item.children = { t: 'list', ordered: /\d/.test(f.marker), items: [] };
      list = parent.item.children;
    }
    list.items.push(item);
    stack.push({ indent: f.indent, list, item });
  }
  return root;
}

// ---------- inline ----------

// taste-skill-ignore: vault priority emoji are converted to plain dots here, never shown.
const PRIO = { '🔴': ['high', 'Must do today'], '🟡': ['mid', 'Should do today'], '🟢': ['low', 'If time allows'] }; // taste-skill-ignore

export function inline(src, ctx = {}) {
  let s = esc(src);
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;

  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  s = s.replace(/!\[\[([^\]]+)\]\]/g, (_, t) => keep(wiki(t, ctx)));
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_, t) => keep(wiki(t, ctx)));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const h = href.replace(/&amp;/g, '&');
    if (!/^(https?:|mailto:)/i.test(h)) return text;
    return keep(`<a class="ext" href="${esc(h)}" target="_blank" rel="noopener noreferrer">${text}</a>`);
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/🔴|🟡|🟢/gu, (e) => keep(`<span class="prio prio-${PRIO[e][0]}" role="img" aria-label="${PRIO[e][1]}"></span>`)); // taste-skill-ignore
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => stash[+n]);
}

function wiki(target, ctx) {
  const [rawTarget, alias] = target.replace(/&#39;/g, "'").replace(/&amp;/g, '&').split('|');
  const name = rawTarget.split('#')[0].trim();
  const label = esc(alias ?? name.split('/').pop().replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, ''));
  const path = ctx.resolve ? ctx.resolve(name) : null;
  if (!path) return `<span class="wl missing">${label}</span>`;
  return `<a class="wl" href="#" data-note="${esc(path)}">${label}</a>`;
}

export function plain(src) {
  return String(src)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_, t) => t.split('/').pop())
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/🔴|🟡|🟢/gu, '') // taste-skill-ignore
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- items ----------

// "**Action** — context · Due: today · [Slack](url)" → { main, meta, due }
export function splitItem(text) {
  // The first " — " outside **bold** separates the item from its context.
  let idx = -1;
  for (let k = text.indexOf(' — '); k >= 0; k = text.indexOf(' — ', k + 1)) {
    if ((text.slice(0, k).match(/\*\*/g) || []).length % 2 === 0) { idx = k; break; }
  }
  const main = idx >= 0 ? text.slice(0, idx) : text;
  const rest = idx >= 0 ? text.slice(idx + 3) : '';
  const due = (rest.match(/Due:\s*([^·—]+?)(?=\s*[·—]|$)/) || [])[1]?.trim() || null;
  return { main, meta: rest, due };
}
