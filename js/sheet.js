// Bottom sheets that rise on a spring, push the page back like an iOS card sheet,
// and follow your finger when dragged down to dismiss.

import { animate, SHEET, spring, Velocity, clamp } from './motion.js';

const layer = () => document.getElementById('sheets');
const app = () => document.getElementById('app');
const isPhone = () => matchMedia('(max-width: 899px)').matches;
let open = [];

export function openSheet({ title, body, onMount, label }) {
  const root = document.createElement('div');
  root.className = 'sheet-wrap';
  root.innerHTML = `
    <div class="backdrop"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${label ?? title}">
      <div class="grabber" aria-hidden="true"></div>
      <header class="sheet-head">
        <h2 class="sheet-title">${title}</h2>
        <button class="sheet-close" type="button" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>
      </header>
      <div class="sheet-body">${body}</div>
    </div>`;
  layer().append(root);
  const sheet = root.querySelector('.sheet');
  const backdrop = root.querySelector('.backdrop');
  const returnFocus = document.activeElement;

  const s = SHEET();
  animate(sheet, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], s);
  animate(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
  if (isPhone() && open.length === 0) {
    app().classList.add('behind');
    animate(app(), [{ transform: 'scale(1)', borderRadius: '0px' }, { transform: 'scale(0.94)', borderRadius: '14px' }], s);
  }

  let closed = false;
  const close = (opts = {}) => {
    if (closed) return Promise.resolve();
    closed = true;
    open = open.filter((x) => x !== api);
    const c = spring({ response: 0.4, damping: 1, v0: opts.v0 ?? 0 });
    const from = opts.from ?? 'translateY(0)';
    const done = Promise.all([
      animate(sheet, [{ transform: from }, { transform: 'translateY(100%)' }], c),
      animate(backdrop, [{ opacity: getComputedStyle(backdrop).opacity }, { opacity: 0 }], { duration: 240, easing: 'ease-out' }),
      isPhone() && open.length === 0 ? animate(app(), [{ transform: 'scale(0.94)', borderRadius: '14px' }, { transform: 'scale(1)', borderRadius: '0px' }], c) : null,
    ]).then(() => {
      root.remove();
      if (open.length === 0) { app().classList.remove('behind'); app().style.transform = ''; app().style.borderRadius = ''; }
      returnFocus?.focus?.({ preventScroll: true });
    });
    return done;
  };

  const api = { root, sheet, close };
  open.push(api);
  backdrop.addEventListener('click', () => close());
  root.querySelector('.sheet-close').addEventListener('click', () => close());
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  dragToDismiss(sheet, backdrop, close);
  onMount?.(api);
  requestAnimationFrame(() => (sheet.querySelector('[autofocus]') ?? root.querySelector('.sheet-close')).focus({ preventScroll: true }));
  return api;
}

function dragToDismiss(sheet, backdrop, close) {
  const body = sheet.querySelector('.sheet-body');
  let start = null, vel = null, dy = 0, dragging = false;
  sheet.addEventListener('pointerdown', (e) => {
    if (e.target.closest('input, textarea, select, button, a')) return;
    if (body.contains(e.target) && body.scrollTop > 0) return;
    start = { y: e.clientY, x: e.clientX, id: e.pointerId };
    vel = new Velocity(); vel.add(e.clientX, e.clientY);
    dragging = false; dy = 0;
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    vel.add(e.clientX, e.clientY);
    const d = e.clientY - start.y;
    if (!dragging) {
      if (Math.abs(e.clientX - start.x) > Math.abs(d) || d < 6) { if (d < -6) start = null; return; }
      dragging = true;
      sheet.setPointerCapture(e.pointerId);
      sheet.classList.add('dragging');
    }
    // Dragging up past the top resists, like a rubber band.
    dy = d > 0 ? d : -Math.sqrt(-d) * 2;
    sheet.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(clamp(1 - dy / sheet.offsetHeight, 0, 1));
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    if (!dragging) return;
    sheet.classList.remove('dragging');
    const { vy } = vel.get();
    const h = sheet.offsetHeight;
    if (dy > h * 0.33 || vy > 0.5) {
      close({ from: `translateY(${dy}px)`, v0: clamp((vy * 1000) / Math.max(1, h - dy), 0, 10) });
    } else {
      animate(sheet, [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], spring({ response: 0.36, damping: 0.82 }));
      backdrop.style.opacity = '';
    }
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

export function closeAllSheets() { return Promise.all(open.map((s) => s.close())); }

let toastTimer = 0;
export function toast(message, { tone = 'plain' } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.dataset.tone = tone;
  clearTimeout(toastTimer);
  el.classList.add('show');
  animate(el, [{ transform: 'translate(-50%, 24px)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1 }], spring({ response: 0.4, damping: 0.8 }));
  toastTimer = setTimeout(() => {
    animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out' }).then(() => el.classList.remove('show'));
  }, 2800);
}
