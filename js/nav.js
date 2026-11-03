// iOS-style navigation: a stack per tab, push/pop on a spring, an interactive edge swipe to go back,
// large titles that hand over to the bar title as you scroll.

import { animate, PUSH, spring, Velocity, clamp, reducedMotion } from './motion.js';

const PARALLAX = 0.3;   // the page underneath moves a third of the way, as on iOS
const SHADE = 0.12;

export class Navigator {
  constructor(stage, tabbar, tabs, makeView) {
    this.stage = stage;
    this.tabbar = tabbar;
    this.tabs = tabs;                 // [{ id, label, icon, route }]
    this.makeView = makeView;         // (route) => view
    this.stacks = new Map();
    this.active = null;
    this.busy = false;
    this.lastEdgeTouch = 0;
    this.buildTabbar();
    addEventListener('popstate', (e) => this.onPop(e.state));
    addEventListener('touchstart', (e) => { if (e.touches[0].clientX < 30) this.lastEdgeTouch = performance.now(); }, { passive: true });
  }

  buildTabbar() {
    const wrap = this.tabbar.querySelector('.tabs');
    wrap.innerHTML = this.tabs.map((t) => `
      <button class="tab" type="button" role="tab" data-tab="${t.id}" aria-selected="false">
        <span class="tab-icon">${t.icon}</span><span class="tab-label">${t.label}</span><span class="tab-count" data-count="${t.id}"></span>
      </button>`).join('');
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      if (b.dataset.tab === this.active) this.popToRoot();
      else this.select(b.dataset.tab);
    });
  }

  setCount(tabId, n) {
    const el = this.tabbar.querySelector(`[data-count="${tabId}"]`);
    if (el) el.textContent = n ? String(n) : '';
  }

  stack(tabId) {
    if (!this.stacks.has(tabId)) {
      const el = document.createElement('div');
      el.className = 'stack';
      el.dataset.tab = tabId;
      el.hidden = true;
      this.stage.append(el);
      const s = { id: tabId, el, pages: [] };
      this.stacks.set(tabId, s);
      const tab = this.tabs.find((t) => t.id === tabId);
      this.mount(s, this.makeView(tab.route));
    }
    return this.stacks.get(tabId);
  }

  get current() { const s = this.stacks.get(this.active); return s?.pages[s.pages.length - 1]; }
  get routes() { return this.stacks.get(this.active)?.pages.map((p) => p.view.route) ?? []; }

  select(tabId, { record = true } = {}) {
    const prev = this.active ? this.stacks.get(this.active) : null;
    const next = this.stack(tabId);
    this.active = tabId;
    for (const b of this.tabbar.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tabId));
    if (prev && prev !== next) {
      next.el.hidden = false;
      animate(next.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
      prev.el.hidden = true;
    } else next.el.hidden = false;
    if (this.current) this.onScroll(this.current);
    this.current?.view.onShow?.();
    if (record) history.replaceState({ tab: tabId, routes: this.routes }, '');
  }

  mount(stack, view) {
    const page = document.createElement('section');
    page.className = 'page';
    page.innerHTML = `
      <header class="navbar">
        <div class="nav-left"></div>
        <div class="nav-title" aria-hidden="true"></div>
        <div class="nav-right"></div>
      </header>
      <div class="scroll"><div class="content"></div></div>
      <div class="shade" aria-hidden="true"></div>`;
    const p = { el: page, view, scroll: page.querySelector('.scroll'), content: page.querySelector('.content') };
    view.page = p;
    view.nav = this;
    stack.el.append(page);
    stack.pages.push(p);
    this.renderPage(p, stack);
    this.wireScroll(p);
    if (stack.pages.length > 1) this.wireBackSwipe(p, stack);
    return p;
  }

  renderPage(p, stack = this.stacks.get(this.active)) {
    const { view } = p;
    const idx = stack.pages.indexOf(p);
    const below = idx > 0 ? stack.pages[idx - 1] : null;
    const left = p.el.querySelector('.nav-left');
    left.innerHTML = below
      ? `<button class="back" type="button" aria-label="Back to ${below.view.shortTitle ?? below.view.title}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>${below.view.shortTitle ?? below.view.title}</span></button>`
      : (view.navLeft?.() ?? '');
    left.querySelector('.back')?.addEventListener('click', () => history.back());
    p.el.querySelector('.nav-title').textContent = view.title;
    p.el.querySelector('.nav-right').innerHTML = view.navRight?.() ?? '';
    const y = p.scroll.scrollTop;
    view.render(p.content);
    p.scroll.scrollTop = y;
    this.onScroll(p);
  }

  refreshAll() {
    for (const s of this.stacks.values()) for (const p of s.pages) this.renderPage(p, s);
  }

  wireScroll(p) {
    let ticking = false;
    p.scroll.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; this.onScroll(p); });
    }, { passive: true });
  }

  onScroll(p) {
    const y = p.scroll.scrollTop;
    const large = p.content.querySelector('.large-title');
    const threshold = large ? large.offsetTop + large.offsetHeight - 8 : 0;
    const t = large ? clamp((y - threshold + 24) / 24, 0, 1) : 1;
    p.el.style.setProperty('--title-in', t.toFixed(3));
    p.el.classList.toggle('scrolled', y > 2);
    p.view.onScroll?.(y);
  }

  push(route) {
    if (this.busy) return;
    const stack = this.stacks.get(this.active);
    const under = stack.pages[stack.pages.length - 1];
    const page = this.mount(stack, this.makeView(route));
    history.pushState({ tab: this.active, routes: this.routes }, '');
    this.busy = true;
    const s = PUSH();
    under.el.inert = true;
    Promise.all([
      animate(page.el, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], s),
      animate(under.el, [{ transform: 'translateX(0)' }, { transform: `translateX(${-PARALLAX * 100}%)` }], s),
      animate(under.el.querySelector('.shade'), [{ opacity: 0 }, { opacity: SHADE }], s),
    ]).then(() => { this.busy = false; });
  }

  // The browser (or our back button) moved history; follow it.
  onPop(state) {
    if (!state) return;
    if (state.tab !== this.active) {
      this.select(state.tab, { record: false });
    }
    const stack = this.stacks.get(this.active);
    const want = state.routes?.length ?? 1;
    // Safari's own edge swipe already animated a snapshot; don't animate twice.
    const instant = performance.now() - this.lastEdgeTouch < 900 && !this.gesturing;
    while (stack.pages.length > Math.max(1, want)) {
      if (stack.pages.length === want + 1 && !instant && !this.skipAnim) this.popAnimated(stack);
      else this.drop(stack);
    }
    this.skipAnim = false;
  }

  drop(stack) {
    const top = stack.pages.pop();
    top.view.onLeave?.();
    top.el.remove();
    const under = stack.pages[stack.pages.length - 1];
    under.el.inert = false;
    under.el.style.transform = '';
    under.el.querySelector('.shade').style.opacity = '';
    under.view.onShow?.();
  }

  popAnimated(stack, { from = 0, v0 = 0 } = {}) {
    const top = stack.pages[stack.pages.length - 1];
    const under = stack.pages[stack.pages.length - 2];
    stack.pages.pop();
    this.busy = true;
    const s = spring({ response: 0.44, damping: 1, v0 });
    const w = top.el.offsetWidth;
    const x0 = from * w;
    Promise.all([
      animate(top.el, [{ transform: `translateX(${x0}px)` }, { transform: 'translateX(100%)' }], s),
      animate(under.el, [{ transform: `translateX(${(-PARALLAX * (1 - from)) * 100}%)` }, { transform: 'translateX(0)' }], s),
      animate(under.el.querySelector('.shade'), [{ opacity: SHADE * (1 - from) }, { opacity: 0 }], s),
    ]).then(() => {
      top.view.onLeave?.();
      top.el.remove();
      under.el.inert = false;
      under.el.style.transform = '';
      under.el.querySelector('.shade').style.opacity = '';
      this.busy = false;
      under.view.onShow?.();
    });
  }

  popToRoot() {
    const stack = this.stacks.get(this.active);
    if (stack.pages.length > 1) {
      const n = stack.pages.length - 1;
      history.go(-n);
    } else {
      stack.pages[0].scroll.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }

  // Interactive back: drag from the left edge, release past halfway or with a flick.
  wireBackSwipe(p, stack) {
    const el = p.el;
    let start = null, vel = null, dragging = false, under = null, w = 0;
    el.addEventListener('pointerdown', (e) => {
      if (this.busy || e.pointerType === 'mouse' || e.clientX - el.getBoundingClientRect().left > 28) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      vel = new Velocity(); vel.add(e.clientX, e.clientY);
      dragging = false;
    });
    el.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      vel.add(e.clientX, e.clientY);
      if (!dragging) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { start = null; return; }
        if (dx < 8) return;
        dragging = true;
        this.gesturing = true;
        el.setPointerCapture(e.pointerId);
        under = stack.pages[stack.pages.indexOf(p) - 1];
        w = el.offsetWidth;
        el.classList.add('dragging');
      }
      const prog = clamp(dx / w, 0, 1);
      el.style.transform = `translateX(${prog * w}px)`;
      under.el.style.transform = `translateX(${-PARALLAX * (1 - prog) * 100}%)`;
      under.el.querySelector('.shade').style.opacity = String(SHADE * (1 - prog));
    });
    const end = (e) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      if (!dragging) return;
      el.classList.remove('dragging');
      const prog = clamp(parseFloat(el.style.transform.replace(/[^\d.-]/g, '')) / w || 0, 0, 1);
      const { vx } = vel.get();
      const v0 = (vx * 1000) / w; // progress per second
      if (prog > 0.5 || vx > 0.45) {
        this.skipAnim = true;
        this.popAnimated(stack, { from: prog, v0: clamp(v0 / (1 - prog || 1), 0, 12) });
        history.back();
      } else {
        const s = spring({ response: 0.36, damping: 1 });
        animate(el, [{ transform: el.style.transform }, { transform: 'translateX(0)' }], s).then(() => { el.style.transform = ''; });
        animate(under.el, [{ transform: under.el.style.transform }, { transform: `translateX(${-PARALLAX * 100}%)` }], s);
        animate(under.el.querySelector('.shade'), [{ opacity: under.el.querySelector('.shade').style.opacity }, { opacity: SHADE }], s);
      }
      setTimeout(() => { this.gesturing = false; }, 50);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // Rebuild stacks from a saved history state (reload in the middle of a stack).
  restore(state) {
    const tab = state?.tab && this.tabs.some((t) => t.id === state.tab) ? state.tab : this.tabs[0].id;
    this.select(tab, { record: false });
    const stack = this.stacks.get(tab);
    for (const r of (state?.routes ?? []).slice(1)) {
      const under = stack.pages[stack.pages.length - 1];
      under.el.inert = true;
      under.el.style.transform = `translateX(${-PARALLAX * 100}%)`;
      under.el.querySelector('.shade').style.opacity = String(SHADE);
      this.mount(stack, this.makeView(r));
    }
    history.replaceState({ tab, routes: this.routes }, '');
  }
}
