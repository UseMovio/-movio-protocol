// Live market: DexScreener boosts -> Solana tokens -> pairs -> top ten by 24h volume.
// Follows the market-source register record and nothing else. Contract state never reaches this file.
import { fmtPrice, fmtCompact, fmtPct, arrow, DASH } from './format.js';
import { countTo, flash } from './motion.js';
import { copyText } from './copy.js';

export const POLL_MS = 60000;
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_MAX_MS = 60000;
export const ROWS = 10;
const CHUNK = 30;

export const backoffDelay = (failures, jitter = 0) =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1)) * (1 + jitter);

async function getJson(fetchFn, url, timeoutMs = 12000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(url, { headers: { accept: 'application/json' }, signal: ctl?.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } finally { if (timer) clearTimeout(timer); }
}

const num = (v) => (v == null || v === '' ? NaN : Number(v));

/** Pure pipeline, exported so the gates can drive it with a fake fetch. */
export async function loadTop(fetchFn, rec, limit = ROWS) {
  const boosts = await getJson(fetchFn, rec.boosts);
  if (!Array.isArray(boosts)) throw new Error('boosts payload is not a list');
  const addrs = [...new Set(boosts.filter((b) => b && b.chainId === 'solana' && typeof b.tokenAddress === 'string').map((b) => b.tokenAddress))];
  if (!addrs.length) throw new Error('no solana entries');
  const chunks = [];
  for (let i = 0; i < addrs.length; i += CHUNK) chunks.push(addrs.slice(i, i + CHUNK));
  const pairs = (await Promise.all(chunks.map((c) => getJson(fetchFn, rec.pairs + c.join(','))))).flat();
  const wanted = new Set(addrs);
  const by = new Map();
  for (const p of pairs) {
    const a = p?.baseToken?.address;
    if (!p || p.chainId !== 'solana' || !wanted.has(a)) continue;
    const liq = num(p.liquidity?.usd), vol = num(p.volume?.h24);
    let t = by.get(a);
    if (!t) { t = { address: a, name: p.baseToken.name || p.baseToken.symbol || DASH, symbol: p.baseToken.symbol || '', volume: 0, liquidity: 0, bestLiq: -1, price: NaN, change: NaN, imageUrl: '' }; by.set(a, t); }
    // volume and liquidity add up across a token's pools; price and change come from its deepest pool
    if (Number.isFinite(vol)) t.volume += vol;
    if (Number.isFinite(liq)) t.liquidity += liq;
    const depth = Number.isFinite(liq) ? liq : 0;
    if (depth > t.bestLiq) { t.bestLiq = depth; t.price = num(p.priceUsd); t.change = num(p.priceChange?.h24); }
    if (!t.imageUrl && typeof p.info?.imageUrl === 'string') t.imageUrl = p.info.imageUrl;
  }
  const out = [...by.values()].filter((t) => t.volume > 0).sort((a, b) => b.volume - a.volume).slice(0, limit);
  if (!out.length) throw new Error('no usable pairs');
  return out;
}

const STATUS_TEXT = { syncing: 'Syncing', live: 'Live', retrying: 'Retrying', paused: 'Paused', off: 'Offline' };

export function createMarket({ doc = document, win = window, record, fetchFn = (...a) => fetch(...a), reduce = false, rand = Math.random, timers } = {}) {
  const T = timers ?? { set: (f, ms) => win.setTimeout(f, ms), clear: (id) => win.clearTimeout(id) };
  const board = doc.querySelector('[data-board]');
  const ticker = doc.querySelector('[data-ticker]');
  const track = doc.querySelector('[data-ticker-track]');
  const errEl = doc.querySelector('[data-feed-error]');
  const noteEls = [...doc.querySelectorAll('[data-feed-note]')];
  const pills = [...doc.querySelectorAll('[data-feed-pill]')];
  const rows = new Map(); // address -> li
  const addrOf = new WeakMap();
  let data = [];
  let hasData = false;
  let failures = 0, timer = null, inflight = false, stopped = false, status = 'syncing';

  const setStatus = (s, note) => {
    status = s;
    pills.forEach((p) => { p.dataset.state = s; const l = p.querySelector('[data-feed-label]'); if (l) l.textContent = STATUS_TEXT[s]; });
    if (note) noteEls.forEach((n) => { n.textContent = note; });
  };

  const letter = (t) => ((t.symbol || t.name || '?').match(/[A-Za-z0-9]/)?.[0] || '?').toUpperCase();
  const safeImg = (u) => {
    try {
      const x = new URL(u);
      if (x.protocol !== 'https:') return '';
      // tiles are tiny, so ask the image host for a small rendition when it supports sizing
      if (x.searchParams.has('width')) { x.searchParams.set('width', '128'); x.searchParams.set('height', '128'); }
      return x.href;
    } catch { return ''; }
  };

  function tileEl(t, small) {
    const tile = doc.createElement('span');
    tile.className = 'tile' + (small ? ' tile-sm' : '');
    tile.textContent = letter(t);
    const src = safeImg(t.imageUrl);
    if (src) {
      const img = doc.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      // the host only serves certain renditions, so retry once with the URL exactly as given
      img.addEventListener('error', () => {
        if (img.dataset.retry || src === t.imageUrl) { img.remove(); return; }
        img.dataset.retry = '1';
        img.src = t.imageUrl;
      });
      img.addEventListener('load', () => { tile.textContent = ''; tile.appendChild(img); }, { once: true });
      img.src = src;
    }
    return tile;
  }

  const cell = (cls, label) => { const c = doc.createElement('span'); c.className = cls; c.setAttribute('role', 'cell'); if (label) c.dataset.label = label; return c; };

  function buildRow(t, i) {
    const li = doc.createElement('li');
    li.className = 'row row-live';
    li.setAttribute('role', 'row');
    li.style.setProperty('--i', String(i));
    const rank = cell('c-rank'); rank.textContent = String(i + 1);
    const tok = cell('c-token');
    const names = doc.createElement('span'); names.className = 'tname';
    const b = doc.createElement('b'); b.textContent = t.name; b.title = t.name;
    const s = doc.createElement('i'); s.textContent = t.symbol;
    names.append(b, s);
    tok.append(tileEl(t), names);
    const price = cell('c-num c-price', 'Price'), chg = cell('c-num c-chg', '24h'), vol = cell('c-num c-vol', 'Volume'), liq = cell('c-num c-liq', 'Liquidity');
    const act = cell('c-act');
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'copy copy-sq';
    btn.setAttribute('aria-label', `Copy address for ${t.symbol || t.name}`);
    btn.innerHTML = '<span class="copy-ico"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>';
    btn.addEventListener('click', () => copyText(addrOf.get(li), btn, { doc, win, quiet: false, label: 'Address copied' }));
    act.append(btn);
    li.append(rank, tok, price, chg, vol, liq, act);
    addrOf.set(li, t.address);
    return li;
  }

  const applyNums = (li, t, first, i) => {
    const set = (sel, val, fmt, extra) => {
      const el = li.querySelector(sel);
      const prev = el._target;
      if (!Number.isFinite(val)) { el._cancel?.(); el._target = undefined; el.textContent = DASH; return; }
      if (prev === val) return;
      const f = extra ? (n) => extra(val, n) : fmt;
      countTo(el, val, f, { from: first || prev === undefined ? 0 : prev, duration: first ? 800 + i * 40 : 600, reduce });
      if (!first && prev !== undefined) flash(el, val > prev ? 1 : -1, reduce);
    };
    set('.c-price', t.price, fmtPrice);
    set('.c-vol', t.volume, fmtCompact);
    set('.c-liq', t.liquidity, fmtCompact);
    const chg = li.querySelector('.c-chg');
    const prevC = chg._target;
    if (!Number.isFinite(t.change)) { chg._cancel?.(); chg._target = undefined; chg.textContent = DASH; chg.classList.remove('up', 'down'); }
    else if (prevC !== t.change) {
      chg.classList.toggle('up', t.change > 0);
      chg.classList.toggle('down', t.change < 0);
      countTo(chg, t.change, (n) => arrow(t.change) + fmtPct(n), { from: first || prevC === undefined ? 0 : prevC, duration: first ? 800 + i * 40 : 600, reduce });
      if (!first && prevC !== undefined) flash(chg, t.change > prevC ? 1 : -1, reduce);
    }
  };

  function renderBoard(list) {
    if (!board) return;
    const first = !hasData;
    const live = new Set(list.map((t) => t.address));
    for (const [a, li] of rows) if (!live.has(a)) { li.remove(); rows.delete(a); }
    board.querySelectorAll('.row-sk, .row-dash').forEach((n) => n.remove());
    list.forEach((t, i) => {
      let li = rows.get(t.address);
      let fresh = false;
      if (!li) { li = buildRow(t, i); rows.set(t.address, li); fresh = true; }
      li.querySelector('.c-rank').textContent = String(i + 1);
      li.style.setProperty('--i', String(i));
      if (board.children[i] !== li) board.insertBefore(li, board.children[i] || null);
      applyNums(li, t, first || fresh, i);
      if (fresh) {
        if (reduce) li.classList.add('is-in');
        else win.requestAnimationFrame(() => win.requestAnimationFrame(() => li.classList.add('is-in')));
      }
    });
  }

  function renderDashRows() {
    if (!board || board.querySelector('.row-live')) return;
    board.innerHTML = '';
    for (let i = 0; i < ROWS; i++) {
      const li = doc.createElement('li');
      li.className = 'row row-dash';
      li.setAttribute('role', 'row');
      li.append(cell('c-rank'), cell('c-token'), cell('c-num c-price', 'Price'), cell('c-num c-chg', '24h'), cell('c-num c-vol', 'Volume'), cell('c-num c-liq', 'Liquidity'), cell('c-act'));
      li.querySelector('.c-rank').textContent = String(i + 1);
      li.querySelector('.c-token').textContent = DASH;
      li.querySelectorAll('.c-num').forEach((c) => { c.textContent = DASH; });
      board.append(li);
    }
  }

  function renderTicker(list) {
    if (!track) return;
    const sig = list.map((t) => t.address).join('|');
    const make = (t) => {
      const el = doc.createElement('span');
      el.className = 'tick';
      el.append(tileEl(t, true));
      const sym = doc.createElement('span'); sym.className = 'sym'; sym.textContent = t.symbol || t.name;
      const chg = doc.createElement('span'); chg.className = 'chg ' + (t.change > 0 ? 'up' : t.change < 0 ? 'down' : '');
      chg.textContent = Number.isFinite(t.change) ? arrow(t.change) + fmtPct(t.change) : DASH;
      el.append(sym, chg);
      return el;
    };
    if (track.dataset.sig === sig) {
      [...track.querySelectorAll('.tick')].forEach((el, k) => {
        const t = list[k % list.length];
        const c = el.querySelector('.chg');
        c.className = 'chg ' + (t.change > 0 ? 'up' : t.change < 0 ? 'down' : '');
        c.textContent = Number.isFinite(t.change) ? arrow(t.change) + fmtPct(t.change) : DASH;
      });
      return;
    }
    track.dataset.sig = sig;
    track.textContent = '';
    const half = (hidden) => { const g = doc.createElement('span'); g.style.display = 'contents'; if (hidden) g.setAttribute('aria-hidden', 'true'); list.forEach((t) => g.append(make(t))); return g; };
    const probe = half(false);
    track.append(probe);
    const setW = track.scrollWidth || 1;
    const cw = ticker?.clientWidth || 1200;
    const n = Math.min(8, Math.max(1, Math.ceil(cw / setW)));
    for (let i = 1; i < n; i++) track.append(half(true));
    const copies = [...track.children];
    copies.forEach((c) => track.append(c.cloneNode(true)));
    [...track.children].slice(copies.length).forEach((c) => c.setAttribute('aria-hidden', 'true'));
    // the ticker carries the same live list, so keep its rows out of the tab order and name it once
    const dur = Math.max(30, Math.round((setW * n) / 55));
    ticker.style.setProperty('--ticker-dur', `${dur}s`);
    ticker.dataset.loading = 'false';
  }

  function showError(msg) {
    if (!errEl) return;
    errEl.hidden = !msg;
    errEl.textContent = msg || '';
  }

  async function tick() {
    if (stopped || inflight) return;
    if (doc.visibilityState === 'hidden') { setStatus('paused'); return; }
    inflight = true;
    if (!hasData) setStatus('syncing');
    try {
      const list = await loadTop(fetchFn, record);
      data = list;
      failures = 0;
      renderBoard(list);
      renderTicker(list);
      hasData = true;
      showError('');
      setStatus('live', 'Ranked by 24h volume');
      schedule(POLL_MS);
    } catch (e) {
      failures += 1;
      setStatus('retrying');
      if (!hasData) {
        renderDashRows();
        if (ticker) ticker.dataset.loading = 'error';
        showError(`${DASH}  The market feed did not answer. Trying again soon.`);
        noteEls.forEach((n) => { n.textContent = DASH; });
      } else {
        noteEls.forEach((n) => { n.textContent = 'Showing the last good reading'; });
      }
      schedule(backoffDelay(failures, rand() * 0.25));
    } finally { inflight = false; }
  }

  function schedule(ms) {
    if (timer != null) T.clear(timer);
    timer = T.set(() => { timer = null; tick(); }, ms);
  }

  function onVisibility() {
    if (stopped) return;
    if (doc.visibilityState === 'hidden') {
      if (timer != null) { T.clear(timer); timer = null; }
      setStatus('paused');
    } else {
      tick();
    }
  }

  return {
    start() {
      if (!record || record.state !== 'stated') {
        setStatus('off', 'Feed disabled');
        renderDashRows();
        return;
      }
      doc.addEventListener('visibilitychange', onVisibility);
      tick();
    },
    stop() {
      stopped = true;
      doc.removeEventListener('visibilitychange', onVisibility);
      if (timer != null) T.clear(timer);
    },
    get state() { return { status, failures, hasData, count: data.length }; },
  };
}
