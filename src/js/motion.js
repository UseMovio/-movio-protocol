// Motion toolkit: damped-spring solver, scroll reveal, parallax, progress, spotlight, count-up.
// Every entry point checks reduced motion first and jumps straight to the end state.

export const prefersReduced = (win = globalThis) =>
  !!win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Damped harmonic oscillator, semi-implicit Euler with a fixed sub-step.
 * x'' = (-k (x - to) - c x') / m. Under-damped by default (zeta about 0.84) for a small settle.
 */
export function spring({ from = 0, to = 1, k = 170, c = 22, m = 1, delay = 0, onUpdate, onDone, reduce, raf = globalThis.requestAnimationFrame, caf = globalThis.cancelAnimationFrame }) {
  if (reduce ?? prefersReduced()) {
    onUpdate(to);
    onDone?.();
    return () => {};
  }
  let x = from, v = 0, last = null, id = 0, started = false, cancelled = false;
  const h = 1 / 240;
  const begin = performance.now() + delay;
  const frame = (t) => {
    if (cancelled) return;
    if (t < begin) { id = raf(frame); return; }
    if (!started) { started = true; last = t; }
    let dt = Math.min((t - last) / 1000, 1 / 20);
    last = t;
    while (dt > 0) {
      const step = Math.min(h, dt);
      v += ((-k * (x - to) - c * v) / m) * step;
      x += v * step;
      dt -= step;
    }
    if (Math.abs(x - to) < 5e-4 && Math.abs(v) < 5e-3) {
      onUpdate(to);
      onDone?.();
      return;
    }
    onUpdate(x);
    id = raf(frame);
  };
  id = raf(frame);
  return () => { cancelled = true; caf?.(id); };
}

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/** Scroll reveal: elements rise and fade on a spring, staggered inside each intersection batch. */
export function initReveal(root = document, win = window) {
  const els = [...root.querySelectorAll('[data-reveal]')];
  const reduce = prefersReduced(win);
  const show = (el, i) => {
    const done = () => { el.classList.add('is-in'); el.style.opacity = ''; el.style.transform = ''; };
    if (reduce) { done(); return; }
    spring({
      delay: i * 70,
      k: 150, c: 19,
      onUpdate: (p) => { el.style.opacity = String(clamp(p * 1.4, 0, 1)); el.style.transform = `translateY(${(1 - p) * 28}px)`; },
      onDone: done,
    });
  };
  if (reduce || !('IntersectionObserver' in win)) { els.forEach((el, i) => show(el, i)); return; }
  const io = new win.IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e, i) => { io.unobserve(e.target); show(e.target, i); });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  els.forEach((el) => io.observe(el));
}

/** Scroll progress bar, written as one custom property per frame. */
export function initProgress(bar, win = window) {
  let queued = false;
  const update = () => {
    queued = false;
    const doc = win.document.documentElement;
    const max = doc.scrollHeight - win.innerHeight;
    bar.style.setProperty('--p', max > 0 ? clamp(win.scrollY / max, 0, 1).toFixed(4) : '0');
  };
  const on = () => { if (!queued) { queued = true; win.requestAnimationFrame(update); } };
  win.addEventListener('scroll', on, { passive: true });
  win.addEventListener('resize', on, { passive: true });
  update();
}

/** Pointer and scroll parallax. Layers chase their targets with a critically damped follower. */
export function initParallax(hero, win = window) {
  if (prefersReduced(win)) return;
  const layers = [...hero.querySelectorAll('[data-depth]')].map((el) => ({ el, d: parseFloat(el.dataset.depth), x: 0, y: 0, vx: 0, vy: 0 }));
  if (!layers.length) return;
  const target = { px: 0, py: 0, sc: 0 };
  let running = false, last = 0;
  const k = 90, c = 2 * Math.sqrt(k);
  const loop = (t) => {
    const dt = Math.min((t - last) / 1000 || 0.016, 1 / 20);
    last = t;
    let moving = false;
    for (const L of layers) {
      const tx = target.px * L.d * 26;
      const ty = target.py * L.d * 18 - target.sc * L.d * 70;
      let rem = dt;
      while (rem > 0) {
        const s = Math.min(rem, 1 / 240);
        L.vx += (-k * (L.x - tx) - c * L.vx) * s; L.x += L.vx * s;
        L.vy += (-k * (L.y - ty) - c * L.vy) * s; L.y += L.vy * s;
        rem -= s;
      }
      if (Math.abs(L.x - tx) > 0.05 || Math.abs(L.y - ty) > 0.05 || Math.abs(L.vx) > 0.05 || Math.abs(L.vy) > 0.05) moving = true;
      L.el.style.transform = `translate3d(${L.x.toFixed(2)}px, ${L.y.toFixed(2)}px, 0)`;
    }
    if (moving) win.requestAnimationFrame(loop); else running = false;
  };
  const kick = () => { if (!running) { running = true; last = performance.now(); win.requestAnimationFrame(loop); } };
  win.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const r = hero.getBoundingClientRect();
    if (r.bottom < 0 || r.top > win.innerHeight) return;
    target.px = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    target.py = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
    kick();
  }, { passive: true });
  win.addEventListener('scroll', () => {
    const r = hero.getBoundingClientRect();
    target.sc = clamp(-r.top / Math.max(r.height, 1), 0, 1.2);
    kick();
  }, { passive: true });
}

/** Spotlight: tracks the pointer inside any .spot or .row and exposes it as custom properties. */
export function initSpotlight(doc = document) {
  let queued = null, pending = false;
  doc.addEventListener('pointermove', (e) => {
    const host = e.target.closest?.('.spot, .row');
    if (!host) return;
    queued = { host, x: e.clientX, y: e.clientY };
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const q = queued;
      if (!q) return;
      const r = q.host.getBoundingClientRect();
      q.host.style.setProperty('--mx', `${q.x - r.left}px`);
      q.host.style.setProperty('--my', `${q.y - r.top}px`);
    });
  }, { passive: true });
}

/** Count a number toward its target; reduced motion lands on the target at once. */
export function countTo(el, to, fmt, { from = 0, duration = 700, reduce } = {}) {
  el._target = to;
  el._cancel?.();
  if (reduce ?? prefersReduced()) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  let id = 0, dead = false;
  const step = (t) => {
    if (dead) return;
    const p = clamp((t - t0) / duration, 0, 1);
    const e = 1 - Math.pow(1 - p, 4);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) id = requestAnimationFrame(step); else el.textContent = fmt(to);
  };
  id = requestAnimationFrame(step);
  el._cancel = () => { dead = true; cancelAnimationFrame(id); };
}

export function flash(el, dir, reduce) {
  if (reduce ?? prefersReduced()) return;
  const cls = dir > 0 ? 'flash-up' : 'flash-down';
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 950);
}
