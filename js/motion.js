// Springs expressed as CSS linear() easings, so every move runs on the compositor.
// response = seconds for one undamped period (SwiftUI's meaning), damping = ratio (1 = no overshoot).

const supportsLinear = (() => {
  try { return CSS.supports('animation-timing-function', 'linear(0, 1)'); } catch { return false; }
})();

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const cache = new Map();

// v0 is the starting velocity in "progress per second" (1 = whole distance per second).
export function spring({ response = 0.42, damping = 1, v0 = 0 } = {}) {
  const key = `${response}|${damping}|${v0.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key);
  const w = (2 * Math.PI) / response;
  const z = damping;
  const at = (t) => {
    if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z);
      const B = (v0 - z * w) / wd;
      return 1 + Math.exp(-z * w * t) * (-Math.cos(wd * t) + B * Math.sin(wd * t));
    }
    return 1 + Math.exp(-w * t) * (-1 + (v0 - w) * t);
  };
  // Settle when within 0.1% and staying there.
  let duration = 0.1;
  for (let t = 0.05; t < 3; t += 0.01) {
    if (Math.abs(at(t) - 1) < 0.001 && Math.abs(at(t + 0.05) - 1) < 0.001) { duration = t; break; }
  }
  const steps = 48;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const v = at((duration * i) / steps);
    pts.push(+v.toFixed(4));
  }
  pts[0] = 0; pts[steps] = 1;
  const result = {
    easing: supportsLinear ? `linear(${pts.join(', ')})` : 'cubic-bezier(0.32, 0.72, 0, 1)',
    duration: Math.round(duration * 1000),
  };
  cache.set(key, result);
  return result;
}

export const PUSH = () => spring({ response: 0.44, damping: 1 });
export const SHEET = () => spring({ response: 0.46, damping: 0.88 });
export const SNAP = () => spring({ response: 0.32, damping: 0.86 });

// Animate and resolve when done; commits the final style so nothing snaps back.
export function animate(el, keyframes, { easing, duration, delay = 0, fill = 'both' } = {}) {
  if (!el) return Promise.resolve();
  if (reducedMotion.matches) duration = Math.min(duration ?? 200, 120);
  const anim = el.animate(keyframes, { easing, duration, delay, fill });
  return anim.finished.then(() => {
    try { anim.commitStyles(); } catch { /* element detached */ }
    anim.cancel();
  }).catch(() => {});
}

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Tracks pointer velocity over the last ~80ms.
export class Velocity {
  constructor() { this.samples = []; }
  add(x, y) {
    const t = performance.now();
    this.samples.push({ x, y, t });
    while (this.samples.length > 2 && t - this.samples[0].t > 80) this.samples.shift();
  }
  get() {
    const s = this.samples;
    if (s.length < 2) return { vx: 0, vy: 0 };
    const a = s[0], b = s[s.length - 1];
    const dt = Math.max(1, b.t - a.t);
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt }; // px per ms
  }
}
