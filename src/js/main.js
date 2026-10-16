import { initReveal, initProgress, initParallax, initSpotlight, prefersReduced } from './motion.js';
import { initCopy } from './copy.js';
import { createMarket } from './market.js';

const root = document.documentElement;
root.classList.add('js');

function readRegister() {
  try { return JSON.parse(document.getElementById('register').textContent).records; } catch { return []; }
}

function initTabs() {
  const list = document.querySelector('.tablist');
  if (!list) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      panel.hidden = !on;
      if (on && !prefersReduced()) {
        panel.classList.add('is-entering');
        panel.querySelectorAll('.card').forEach((c, i) => c.style.setProperty('--i', String(i)));
        panel.querySelectorAll('[data-reveal]').forEach((c) => { c.classList.add('is-in'); });
        setTimeout(() => panel.classList.remove('is-entering'), 900);
      } else if (on) {
        panel.querySelectorAll('[data-reveal]').forEach((c) => c.classList.add('is-in'));
      }
    });
    if (focus) tab.focus();
  };
  tabs.forEach((t) => t.addEventListener('click', () => select(t)));
  list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    select(tabs[(to + tabs.length) % tabs.length], true);
  });
}

function trackHud() {
  const hud = document.querySelector('.hud');
  if (!hud) return;
  const set = () => root.style.setProperty('--hud-h', `${Math.ceil(hud.getBoundingClientRect().bottom)}px`);
  set();
  if ('ResizeObserver' in window) new ResizeObserver(set).observe(hud);
  window.addEventListener('resize', set, { passive: true });
}

function boot() {
  trackHud();
  initProgress(document.querySelector('.progress'));
  initSpotlight();
  initCopy();
  initTabs();
  initReveal();
  const hero = document.getElementById('hero');
  if (hero) initParallax(hero);
  const records = readRegister();
  const record = records.find((r) => r.id === 'market-source');
  createMarket({ record, reduce: prefersReduced() }).start();
}

boot();
