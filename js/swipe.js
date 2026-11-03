// Mail-style swipe actions on rows: right to complete, left to reveal Note and Remove,
// a long left swipe removes outright.

import { animate, spring, Velocity, clamp } from './motion.js';

const OPEN_LEFT = -152;   // two 76px buttons
const DONE_AT = 72;
const FULL_LEFT = 0.6;    // share of row width

let openRow = null;

export function wireSwipes(root, handlers) {
  let s = null;

  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const row = e.target.closest('.row');
    if (!row || e.target.closest('a, button.check, .ra')) return;
    const page = row.closest('.page');
    if (page && e.clientX - page.getBoundingClientRect().left < 28 && page.previousElementSibling) return; // back swipe owns the edge
    if (openRow && openRow !== row) closeRow(openRow);
    const body = row.querySelector('.row-body');
    s = { row, body, x: e.clientX, y: e.clientY, id: e.pointerId, base: row === openRow ? OPEN_LEFT : 0, dx: 0, dragging: false, vel: new Velocity() };
    s.vel.add(e.clientX, e.clientY);
  });

  root.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    s.vel.add(e.clientX, e.clientY);
    if (!s.dragging) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { s = null; return; }
      if (Math.abs(dx) < 10) return;
      s.dragging = true;
      s.row.setPointerCapture(e.pointerId);
      s.row.classList.add('swiping');
    }
    let x = s.base + dx;
    const canDone = s.row.classList.contains('is-task');
    if (x > 0 && !canDone) x = Math.sqrt(x) * 3;      // nothing on the left for plain rows: resist
    if (x > 0) x = x > 140 ? 140 + (x - 140) * 0.25 : x;
    s.dx = x;
    s.body.style.transform = `translateX(${x}px)`;
    const w = s.row.offsetWidth;
    s.row.classList.toggle('arm-done', canDone && x > DONE_AT);
    s.row.classList.toggle('arm-remove', x < -w * FULL_LEFT);
    s.row.classList.toggle('show-left', x > 0);
  });

  const end = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const st = s; s = null;
    if (!st.dragging) return;
    st.row.classList.remove('swiping');
    // A drag is not a tap.
    st.row.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
    const { vx } = st.vel.get();
    const w = st.row.offsetWidth;
    const x = st.dx;
    if (x > DONE_AT && st.row.classList.contains('is-task')) {
      settle(st.row, 0, x);
      handlers.done(st.row);
    } else if (x < -w * FULL_LEFT || (x < OPEN_LEFT && vx < -1.2)) {
      animate(st.body, [{ transform: `translateX(${x}px)` }, { transform: `translateX(${-w}px)` }], spring({ response: 0.3, damping: 1 }))
        .then(() => { handlers.remove(st.row); settle(st.row, 0, -w, true); });
    } else if (x < OPEN_LEFT / 2 || vx < -0.4) {
      settle(st.row, OPEN_LEFT, x);
      openRow = st.row;
    } else {
      settle(st.row, 0, x);
    }
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  root.addEventListener('click', (e) => {
    const a = e.target.closest('.ra');
    if (!a) return;
    const row = a.closest('.row');
    e.stopPropagation();
    closeRow(row);
    if (a.classList.contains('ra-remove')) handlers.remove(row);
    else if (a.classList.contains('ra-note')) handlers.note(row);
  }, true);

  root.addEventListener('scroll', () => { if (openRow) closeRow(openRow); }, { capture: true, passive: true });
}

function settle(row, to, from, instant = false) {
  const body = row.querySelector('.row-body');
  row.classList.remove('arm-done', 'arm-remove');
  if (to === 0) { if (openRow === row) openRow = null; }
  row.classList.toggle('is-open', to !== 0);
  if (instant) { body.style.transform = ''; row.classList.remove('show-left'); return; }
  animate(body, [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], spring({ response: 0.34, damping: 0.86 }))
    .then(() => { if (to === 0) { body.style.transform = ''; row.classList.remove('show-left'); } });
}

export function closeRow(row) {
  if (!row) return;
  const body = row.querySelector('.row-body');
  const m = /translateX\((-?[\d.]+)px\)/.exec(body.style.transform);
  settle(row, 0, m ? parseFloat(m[1]) : OPEN_LEFT);
}

export const clampX = clamp;
