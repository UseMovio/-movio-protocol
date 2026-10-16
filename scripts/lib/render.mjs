// Static page renderer. Every external fact comes out of the register; nothing is hard-coded.
import { publicRegister, record } from './register.mjs';

export const X_PATH = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
export const GITHUB_PATH = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';

const ICON = {
  x: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="${X_PATH}"/></svg>`,
  github: `<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="${GITHUB_PATH}"/></svg>`,
  copy: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
export const ICONS = ICON;

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// seeded maze so the hero backdrop is identical on every build
function mazePath(cols, rows, cell, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  const open = new Set();
  const key = (a, b, c, d) => [a, b, c, d].join(',');
  const stack = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [cx + dx, cy + dy]).filter(([x, y]) => x >= 0 && y >= 0 && x < cols && y < rows && !seen[y][x]);
    if (!nb.length) { stack.pop(); continue; }
    const [nx, ny] = nb[Math.floor(rnd() * nb.length)];
    seen[ny][nx] = true;
    open.add(key(cx, cy, nx, ny)); open.add(key(nx, ny, cx, cy));
    stack.push([nx, ny]);
  }
  let d = '';
  for (let y = 0; y <= rows; y++) for (let x = 0; x < cols; x++) {
    if (y === 0 || y === rows || !open.has(key(x, y - 1, x, y))) d += `M${x * cell} ${y * cell}h${cell}`;
  }
  for (let x = 0; x <= cols; x++) for (let y = 0; y < rows; y++) {
    if (x === 0 || x === cols || !open.has(key(x - 1, y, x, y))) d += `M${x * cell} ${y * cell}v${cell}`;
  }
  return d;
}

const TILE_ORDER = ['chain', 'supply', 'holders', 'listing'];

function pendingChip() { return '<span class="chip chip-pending">pending</span>'; }

function renderSocial(r, id) {
  const handle = r.handle;
  if (r.state === 'stated' && r.url) {
    const label = `${r.label}${handle ? ' @' + handle : ''}`;
    return `<a class="social" data-social="${id}" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}" title="${esc(label)}">${ICON[id]}</a>`;
  }
  const label = `${r.label}, pending`;
  return `<span class="social is-inert" data-social="${id}" role="img" aria-disabled="true" aria-label="${esc(label)}" title="${esc(label)}">${ICON[id]}</span>`;
}

function renderCa(r) {
  if (r.state === 'stated' && r.value) {
    return `<div class="ca" id="ca" data-state="stated" data-record="contract">
      <span class="ca-label">${esc(r.label)}</span>
      <button class="ca-value" type="button" data-copy="${esc(r.value)}" aria-label="Copy mint address"><span class="ca-text">${esc(r.value)}</span></button>
      <button class="ca-copy copy" type="button" data-copy="${esc(r.value)}" aria-label="Copy mint address"><span class="copy-ico">${ICON.copy}</span><span class="copy-txt">Copy</span></button>
    </div>`;
  }
  return `<div class="ca is-inert" id="ca" data-state="${esc(r.state)}" data-record="contract">
      <span class="ca-label">${esc(r.label)}</span>
      <span class="ca-value ca-empty">${pendingChip()}</span>
    </div>`;
}

function renderTile(r) {
  const stated = r.state === 'stated' && r.value != null;
  const numeric = stated && /^\d[\d,]*(\.\d+)?$/.test(String(r.value));
  const val = stated
    ? `<b class="tile-v" ${numeric ? `data-count="${esc(String(r.value).replace(/,/g, ''))}"` : ''}>${esc(r.value)}</b>`
    : pendingChip();
  return `<li class="stat spot" data-reveal data-record="${esc(r.id)}" data-state="${esc(r.state)}"><span class="stat-k">${esc(r.label)}</span>${val}</li>`;
}

function renderChannel(r) {
  const handle = r.handle;
  if (r.state === 'stated' && r.url) {
    return `<li class="channel spot" data-reveal data-record="${esc(r.id)}" data-state="stated"><a class="channel-a" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer"><span class="channel-ico">${ICON[r.id]}</span><span class="channel-t"><b>${esc(r.label)}</b><i>${handle ? '@' + esc(handle) : ''}</i></span><span class="channel-go">${ICON.arrow}</span></a></li>`;
  }
  const ico = r.id === 'contract' ? '' : `<span class="channel-ico">${ICON[r.id]}</span>`;
  const mark = r.id === 'contract' ? '<span class="channel-ico channel-ca" aria-hidden="true">CA</span>' : ico;
  return `<li class="channel spot is-inert" data-reveal data-record="${esc(r.id)}" data-state="${esc(r.state)}"><span class="channel-a">${mark}<span class="channel-t"><b>${esc(r.label)}</b></span>${pendingChip()}</span></li>`;
}

const TABS = [
  { id: 'concept', label: 'Concept', cards: [
    ['Motion first', 'Controls aim to vanish, so your very first minute already feels like play.'],
    ['Faces with habits', 'Every persona strolls, hesitates and reacts with its own rhythm, so choosing one feels personal.'],
    ['Slow or fast, you decide', 'Nobody rushes you. Roam, dash, or stand still and let the scenery breathe around you.'],
  ] },
  { id: 'cast', label: 'Cast', cards: [
    ['A roster to pick from', 'Choose one persona matching your mood, then swap whenever that mood shifts.'],
    ['Quirks that show', 'Idle poses, gestures and tiny tells give every figure a voice with zero dialogue.'],
    ['Space for newcomers', 'The cast is designed to widen, so fresh arrivals join beside familiar faces.'],
  ] },
  { id: 'terrain', label: 'Terrain', cards: [
    ['Stages that answer back', 'Floors, walls and props react when touched, so poking around pays off in small surprises.'],
    ['Corners worth finding', 'Side paths and quiet nooks reward anyone who drifts off the obvious route.'],
    ['Shared ground', 'Fellow visitors cross your space, which makes an empty hallway feel like a meeting point.'],
  ] },
  { id: 'toolkit', label: 'Toolkit', cards: [
    ['Wallet ready', 'Connect whichever signing app suits, and remain anonymous until that moment.'],
    ['Open when it counts', 'Source plus documents arrive following official repository verification.'],
    ['Plain explanations', 'Supply, links and addresses surface here following confirmation, never any earlier.'],
  ] },
];

const PHASES = [
  ['Phase 01', 'Groundwork', 'Settle the identity, publish the mint and activate official channels.'],
  ['Phase 02', 'First stages', 'Release the opening worlds alongside a starter cast eager to roam.'],
  ['Phase 03', 'Wider roster', 'Add new personas and let the crowd steer which ones arrive next.'],
  ['Phase 04', 'Shared steering', 'Hand further decisions over to holders while the ecosystem finds its rhythm.'],
];

const SKELETON_ROWS = Array.from({ length: 10 }, (_, i) => `<li class="row row-sk" role="row" aria-hidden="true" data-skeleton="${i}"><span class="c-rank"><i class="sk sk-s"></i></span><span class="c-token"><i class="sk sk-tile"></i><span class="tname"><i class="sk sk-m"></i><i class="sk sk-s"></i></span></span><span class="c-num"><i class="sk sk-m"></i></span><span class="c-num"><i class="sk sk-s"></i></span><span class="c-num"><i class="sk sk-m"></i></span><span class="c-num"><i class="sk sk-m"></i></span><span class="c-act"><i class="sk sk-tile"></i></span></li>`).join('');

const SKELETON_CHIPS = Array.from({ length: 8 }, () => '<span class="tick tick-sk"><i class="sk sk-tile"></i><i class="sk sk-m"></i><i class="sk sk-s"></i></span>').join('');

export function renderPage({ register, tokens, assets }) {
  const reg = publicRegister(register);
  const R = (id) => record(reg, id);
  const contract = R('contract'), x = R('x'), github = R('github'), market = R('market-source');
  const maze = mazePath(26, 14, 40, 20240611);
  const tabsNav = TABS.map((t, i) => `<button class="tab" role="tab" type="button" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${t.label}</button>`).join('');
  const panels = TABS.map((t, i) => `<div class="tabpanel" role="tabpanel" id="panel-${t.id}" aria-labelledby="tab-${t.id}" ${i === 0 ? '' : 'hidden'}><ul class="cards">${t.cards.map(([h, p], n) => `<li class="card spot" data-reveal><span class="card-n">${String(n + 1).padStart(2, '0')}</span><h3>${h}</h3><p>${p}</p></li>`).join('')}</ul></div>`).join('');
  const phases = PHASES.map(([k, h, p]) => `<li class="phase spot" data-reveal><span class="phase-k">${k}</span><h3>${h}</h3><p>${p}</p><span class="chip">Planned</span></li>`).join('');
  const marketOn = market && market.state === 'stated';

  const registerJson = JSON.stringify(reg).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${tokens.ink}">
<title>Movio | Characters in motion on Solana</title>
<meta name="description" content="Movio blends playable personas, reactive stages and live Solana market readings.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Movio">
<meta property="og:title" content="Movio | Characters in motion on Solana">
<meta property="og:description" content="Playable personas, reactive stages and live Solana market readings.">
<meta property="og:url" content="https://movio.work/">
<meta property="og:image" content="https://movio.work/assets/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="preload" href="assets/fonts/dm-sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${assets.css}">
<script defer src="${assets.js}"></script>
</head>
<body data-contract="${esc(contract.state)}" data-market="${marketOn ? 'on' : 'off'}">
<a class="skip" href="#main">Skip to content</a>
<div class="progress" aria-hidden="true"><i></i></div>
<header class="hud" id="top">
  <div class="topbar">
    <a class="brand" href="#top" aria-label="Movio, return upward"><img src="assets/mark-128.png" width="36" height="36" alt=""><span class="brand-t">MOVIO</span></a>
    <div class="pill" data-feed-pill data-state="${marketOn ? 'syncing' : 'off'}" role="status" aria-live="polite"><i class="dot" aria-hidden="true"></i><span data-feed-label>${marketOn ? 'Syncing' : 'Offline'}</span></div>
    <nav class="topnav" aria-label="Sections"><a href="#explore">Explore</a><a href="#board">Board</a><a href="#channels">Channels</a><a href="#roadmap">Roadmap</a></nav>
    <div class="socials">${renderSocial(x, 'x')}${renderSocial(github, 'github')}</div>
  </div>
  ${renderCa(contract)}
</header>

<main id="main">
<section class="hero" id="hero">
  <div class="hero-bg" aria-hidden="true">
    <div class="mesh mesh-a" data-depth="0.1"></div>
    <div class="mesh mesh-b" data-depth="0.18"></div>
    <div class="mesh mesh-c" data-depth="0.26"></div>
    <svg class="maze" data-depth="0.34" viewBox="0 0 1040 560" preserveAspectRatio="xMidYMid slice"><path d="${maze}" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="square"/></svg>
    <div class="grain"></div>
  </div>
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <span class="eyebrow" data-reveal><i class="dot" aria-hidden="true"></i>Built on ${esc(R('chain').value || 'Solana')}</span>
      <h1 data-reveal>Wander worlds whenever your mood says go.</h1>
      <p class="lede" data-reveal>Movio gathers animated personas, reactive scenery plus a crowd that picks which way the path bends.</p>
      <div class="cta" data-reveal>
        <a class="btn btn-primary" href="#board"><span>Launch the live board</span>${ICON.arrow}</a>
        <a class="btn btn-ghost" href="#explore"><span>Browse the cast</span></a>
      </div>
    </div>
    <div class="hero-art" aria-hidden="true">
      <div class="art-layer" data-depth="0.5"><div class="ring ring-a"></div><div class="ring ring-b"></div></div>
      <div class="art-layer" data-depth="0.9"><img class="art-mark" src="assets/mark-512.png" width="512" height="512" alt=""></div>
      <div class="art-layer" data-depth="1.4"><span class="spark s1"></span><span class="spark s2"></span><span class="spark s3"></span><span class="spark s4"></span></div>
    </div>
  </div>
  <div class="wrap">
    <ul class="stats" aria-label="Project facts">${TILE_ORDER.map((id) => renderTile(R(id))).join('')}</ul>
  </div>
</section>

<section class="ticker-band" aria-label="Live token ticker">
  <div class="ticker" data-ticker data-loading="true"><div class="ticker-track" data-ticker-track>${SKELETON_CHIPS}</div></div>
</section>

<section class="section" id="explore">
  <div class="wrap">
    <header class="sec-head" data-reveal><span class="kicker">Inside Movio</span><h2>Tiny worlds, strong gravity</h2><p>Four angles upon the build. Flip through them and see pieces click together.</p></header>
    <div class="panel tabs" data-reveal>
      <div class="tablist" role="tablist" aria-label="Project lenses">${tabsNav}</div>
      ${panels}
    </div>
  </div>
</section>

<section class="section" id="board" data-market="${marketOn ? 'on' : 'off'}">
  <div class="wrap">
    <header class="sec-head" data-reveal><span class="kicker">Solana pulse</span><h2>Which coins are moving this minute</h2><p>Live readings pulled off the busiest Solana tokens, refreshed automatically. Consider it a window onto the wider market, never a Movio roster.</p></header>
    <div class="panel board" data-reveal>
      <div class="board-bar">
        <div class="pill" data-feed-pill data-state="${marketOn ? 'syncing' : 'off'}"><i class="dot" aria-hidden="true"></i><span data-feed-label>${marketOn ? 'Syncing' : 'Offline'}</span></div>
        <span class="board-note" data-feed-note>${marketOn ? 'Ranked by 24h volume' : 'Feed disabled'}</span>
      </div>
      <div class="table" role="table" aria-label="Top Solana tokens by 24 hour volume">
        <div class="thead" role="row"><span role="columnheader">#</span><span role="columnheader">Token</span><span role="columnheader" class="num">Price</span><span role="columnheader" class="num">24h</span><span role="columnheader" class="num">Volume</span><span role="columnheader" class="num">Liquidity</span><span role="columnheader" class="act"><span class="sr">Copy</span></span></div>
        <ul class="tbody" role="rowgroup" data-board>${SKELETON_ROWS}</ul>
      </div>
      <p class="board-error" data-feed-error hidden role="alert"></p>
    </div>
    <p class="fine">Figures shown are for information alone and offer no guidance whatsoever.</p>
  </div>
</section>

<section class="section" id="channels">
  <div class="wrap">
    <header class="sec-head" data-reveal><span class="kicker">Official channels</span><h2>Only verified doors earn a handle</h2><p>Every channel sleeps until verification. Nothing below points anywhere before that happens.</p></header>
    <ul class="channels">${[contract, x, github].map(renderChannel).join('')}</ul>
  </div>
</section>

<section class="section" id="roadmap">
  <div class="wrap">
    <header class="sec-head" data-reveal><span class="kicker">The road ahead</span><h2>Four stretches, one direction</h2><p>Sequence beats speed. Every stretch unlocks whatever follows.</p></header>
    <ol class="phases">${phases}</ol>
  </div>
</section>
</main>

<footer class="foot">
  <div class="wrap foot-in">
    <a class="brand" href="#top" aria-label="Movio, return upward"><img src="assets/mark-128.png" width="32" height="32" alt=""><span class="brand-t">MOVIO</span></a>
    <p>Movio lives on ${esc(R('chain').value || 'Solana')}. Nothing printed here counts as financial guidance.</p>
    <nav aria-label="Footer"><a href="#explore">Explore</a><a href="#board">Board</a><a href="#channels">Channels</a><a href="#roadmap">Roadmap</a></nav>
  </div>
</footer>
<div class="toast" data-toast role="status" aria-live="polite"></div>
<script type="application/json" id="register">${registerJson}</script>
</body>
</html>
`;
}
