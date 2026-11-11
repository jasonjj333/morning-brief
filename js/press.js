// Touch feedback and small content transitions, iOS-style.
// - Press: anything tappable sinks a little the moment a finger lands and springs back on release.
//   A drag (scrolling) cancels the press, the way UIKit cancels a highlight once the scroll view takes over.
// - Disclosure: <details> open and close with an animated height instead of jumping.
// - swapContent: a list that changes in place (a segmented filter) slides and fades to its new contents.

import { animate, spring, reducedMotion } from './motion.js';

// Tappable things and how far each one sinks. More specific entries first.
const PRESSABLE = [
  ['.tab', 0.9],
  ['.icon-btn, .back, .prio-remove, .day-tog', 0.88],
  ['.btn, .profile-chip, .chip-link, .mtg-join, .mtg-record, .text-btn, .side-btn, .side-profiles button', 0.94],
  ['.segmented button, .add-row, .day', 0.95],
  ['.repo-tile, .team-chip, .concept-row, .profile-opt, .filtered-card, .sender-row, .draft-card', 0.975],
  ['.link-row, .note-row, .menu-item, .callout > summary, details.more > summary', 0.985],
];
const SELECTOR = PRESSABLE.map(([s]) => s).join(', ');
const scaleFor = (el) => PRESSABLE.find(([s]) => el.matches(s))?.[1] ?? 0.97;
const SLOP = 10; // px a finger can drift before it counts as a scroll

export function initPress() {
  // The release spring (a little bounce) is shared with CSS as custom properties.
  const back = spring({ response: 0.42, damping: 0.62 });
  const root = document.documentElement.style;
  root.setProperty('--press-release-ease', back.easing);
  root.setProperty('--press-release-ms', `${back.duration}ms`);

  let cur = null;
  const release = () => {
    if (!cur) return;
    cur.el.classList.remove('is-pressed');
    cur = null;
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || reducedMotion.matches) return;
    const el = e.target.closest(SELECTOR);
    if (!el || el.disabled || el.closest('.row.swiping')) return;
    release();
    el.classList.add('pressable');
    el.style.setProperty('--press-scale', String(scaleFor(el)));
    // Force the resting style first so the press transitions instead of snapping.
    void el.offsetWidth;
    el.classList.add('is-pressed');
    cur = { el, x: e.clientX, y: e.clientY, id: e.pointerId };
  }, { passive: true, capture: true });
  document.addEventListener('pointermove', (e) => {
    if (cur && e.pointerId === cur.id && Math.hypot(e.clientX - cur.x, e.clientY - cur.y) > SLOP) release();
  }, { passive: true, capture: true });
  for (const t of ['pointerup', 'pointercancel', 'dragstart']) document.addEventListener(t, release, { passive: true, capture: true });
  addEventListener('blur', release);
  document.addEventListener('scroll', release, { passive: true, capture: true });

  initDisclosure();
}

// ---------- <details> ----------

function initDisclosure() {
  document.addEventListener('click', (e) => {
    const sum = e.target.closest('details > summary');
    if (!sum || e.defaultPrevented || reducedMotion.matches) return;
    const d = sum.parentElement;
    if (d.dataset.animating) { e.preventDefault(); return; }
    e.preventDefault();
    toggleDetails(d, !d.open);
  });
}

function toggleDetails(d, open) {
  d.dataset.animating = '1';
  const start = d.offsetHeight;
  d.open = open;
  const end = d.offsetHeight;
  d.open = true; // keep the content rendered while it animates
  d.style.overflow = 'hidden';
  const s = spring({ response: open ? 0.42 : 0.34, damping: 1 });
  const body = [...d.children].filter((c) => c.tagName !== 'SUMMARY');
  if (open) for (const b of body) animate(b, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], s);
  else for (const b of body) animate(b, [{ opacity: 1 }, { opacity: 0 }], { duration: Math.round(s.duration * 0.6), easing: 'ease-out' });
  animate(d, [{ height: `${start}px` }, { height: `${end}px` }], s).then(() => {
    d.open = open;
    d.style.height = '';
    d.style.overflow = '';
    for (const b of body) { b.style.opacity = ''; b.style.transform = ''; }
    delete d.dataset.animating;
  });
}

// ---------- content swaps ----------

// Replace a container's contents with a short slide-and-fade. dir: 1 = new content comes from the right.
export function swapContent(box, draw, dir = 1) {
  if (!box) return;
  if (reducedMotion.matches) { draw(); return; }
  const tok = (box._swap = (box._swap ?? 0) + 1);
  const live = () => tok === box._swap;
  const h0 = box.offsetHeight;
  box.getAnimations().forEach((a) => a.cancel());
  animate(box, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * 14}px)` }], { duration: 110, easing: 'cubic-bezier(0.4, 0, 1, 1)' }).then(() => {
    if (!live()) return;
    draw();
    const h1 = box.scrollHeight;
    animate(box, [{ opacity: 0, transform: `translateX(${dir * 18}px)` }, { opacity: 1, transform: 'none' }], spring({ response: 0.4, damping: 0.9 }))
      .then(() => { if (live()) { box.style.opacity = ''; box.style.transform = ''; } });
    // Let the height follow too, so content below doesn't jump.
    if (Math.abs(h1 - h0) > 2) {
      box.style.overflow = 'hidden';
      animate(box, [{ height: `${h0}px` }, { height: `${h1}px` }], spring({ response: 0.42, damping: 1 }))
        .then(() => { if (live()) { box.style.height = ''; box.style.overflow = ''; } });
    }
  });
}
