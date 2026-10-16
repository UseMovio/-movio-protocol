// Gates: every claim in the brief, checked against the built output (dist/) and against rebuilt mutations.
// Mutation anchors are state-independent: a mutation reads the record's current state at runtime and flips it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { JSDOM } from 'jsdom';
import { build, root } from './build.mjs';
import { validateRegister, publicRegister, deriveHandle, record, BASE58_ADDRESS } from './lib/register.mjs';
import { scanAddresses } from './lib/scan.mjs';
import { visibleCopy, attributesOf, bigrams, vocabulary } from './lib/text.mjs';
import { X_PATH, GITHUB_PATH } from './lib/render.mjs';

const DIST = path.join(root, 'dist');
const TMP = path.join(root, '.gate-tmp');
const read = (p) => fs.readFileSync(p, 'utf8');
const list = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) list(p, out); else out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

const results = [];
const gate = (name, fn) => results.push({ name, fn });
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg ?? 'not equal'}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };
const ok = (c, msg) => { if (!c) throw new Error(msg); };

// ---------- shared fixtures ----------
const REG_PATH = path.join(root, 'src/data/register.json');
const baseReg = () => JSON.parse(read(REG_PATH));
const html = () => read(path.join(DIST, 'index.html'));
const dom = (h = html()) => new JSDOM(h, { pretendToBeVisual: true, url: 'https://movio.work/' });
const cssFile = () => list(path.join(DIST, 'assets')).find((f) => f.endsWith('.css'));
const jsFile = () => list(path.join(DIST, 'assets')).find((f) => f.endsWith('.js'));

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const fakeAddress = () => Array.from(crypto.randomBytes(44), (b) => B58[b % B58.length]).join('');

/** Flip a record from whatever it is right now. Never assumes the starting state. */
function flip(reg, id) {
  const copy = structuredClone(reg);
  const r = record(copy, id);
  if (r.state === 'stated') {
    for (const k of ['value', 'url', 'handle', 'rpc', 'boosts', 'pairs']) delete r[k];
    r.state = 'absent';
  } else {
    r.state = 'stated';
    if (r.kind === 'address') r.value = fakeAddress();
    else if (r.kind === 'social') r.url = id === 'github' ? 'https://github.com/movio-test' : 'https://x.com/movio_test';
    else if (r.kind === 'feed') { r.value = 'DexScreener'; r.boosts = 'https://api.dexscreener.com/token-boosts/top/v1'; r.pairs = 'https://api.dexscreener.com/tokens/v1/solana/'; }
    else r.value = '123456';
  }
  return copy;
}
const builtDirs = [];
async function buildTo(name, register) {
  const out = path.join(TMP, name);
  await build({ outDir: out, register });
  builtDirs.push(out);
  return { out, html: read(path.join(out, 'index.html')) };
}
const unconfirmed = (reg, id) => {
  const copy = structuredClone(reg);
  const r = record(copy, id);
  for (const k of ['value', 'url', 'handle']) delete r[k];
  r.state = 'unconfirmed';
  return copy;
};

// ---------- 1. structure ----------
gate('build output is present and self-consistent', () => {
  for (const f of ['index.html', 'favicon.svg', '_headers', 'robots.txt']) ok(fs.existsSync(path.join(DIST, f)), `dist/${f} missing`);
  const h = html();
  for (const m of h.matchAll(/(?:href|src)="(assets\/[^"]+|favicon\.svg)"/g)) ok(fs.existsSync(path.join(DIST, m[1])), `dist/${m[1]} referenced but missing`);
});

gate('dist holds deploy output only (no repo docs, no register, no maps)', () => {
  const bad = /(^|\/)(README|LICENSE|CLAUDE)(\.md)?$|(^|\/)docs\/|\.claude|register\.json|\.map$|node_modules|asset-report|reference-corpus|whitepaper/i;
  const files = list(DIST).map(rel).filter((f) => bad.test(f));
  eq(files.length, 0, `forbidden files in dist: ${files.join(', ')}`);
});

gate('repo content files exist with the required parts', () => {
  const readme = read(path.join(root, 'README.md'));
  for (const w of ['Movio', 'movio.work', 'Solana', 'Overview', 'Features', 'Links']) ok(readme.includes(w), `README missing ${w}`);
  ok(/badge|shields\.io/i.test(readme), 'README needs a live site badge');
  ok(/CA/.test(readme) && /pending|TBA|placeholder/i.test(readme), 'README needs a CA placeholder');
  const wp = read(path.join(root, 'docs/whitepaper.md'));
  for (const w of [/vision/i, /mission/i, /tokenomics/i, /roadmap/i, /team/i]) ok(w.test(wp), `whitepaper missing ${w}`);
  const phases = (wp.match(/^#+\s*Phase \d/gim) || []).length;
  ok(phases >= 3 && phases <= 4, `whitepaper needs 3-4 phases, has ${phases}`);
  const lic = read(path.join(root, 'LICENSE'));
  ok(/MIT License/.test(lic) && /Copyright \(c\) 2026 Movio/.test(lic), 'LICENSE must be MIT, Movio, 2026');
});

gate('repo hygiene: no CLAUDE.md, no .claude, no AI attribution', () => {
  const skipDir = /(^|\/)(node_modules|brand|reference|dist|\.gate-tmp|reports)(\/|$)/;
  const names = list(root).map(rel).filter((f) => !skipDir.test(f));
  const badName = names.filter((f) => /(^|\/)CLAUDE\.md$/i.test(f) || /(^|\/)\.claude(\/|$)/.test(f));
  eq(badName.length, 0, `forbidden paths: ${badName.join(', ')}`);
  ok(!fs.existsSync(path.join(root, '.claude')), '.claude directory present');
  const words = ['clau' + 'de', 'anthr' + 'opic', 'chat' + 'gpt', 'open' + 'ai', 'copi' + 'lot', 'co-authored-by', 'generated (?:by|with)', 'ai-generated', 'large language'];
  const re = new RegExp(`\\b(?:${words.join('|')})\\b|\\bA\\.?I\\b(?! ?\\w*\\d)`, 'i');
  const text = names.filter((f) => /\.(md|json|mjs|js|css|html|txt|svg|yml|yaml)$/.test(f) && !/package-lock|reference-corpus|asset-report|scripts\/gates\.mjs/.test(f));
  const hits = text.filter((f) => re.test(read(path.join(root, f))));
  eq(hits.length, 0, `attribution-like text in: ${hits.join(', ')}`);
  for (const f of list(DIST)) if (/\.(html|css|js|svg|txt)$/.test(f)) ok(!re.test(read(f)), `${rel(f)} carries attribution-like text`);
});

// ---------- 2. register ----------
gate('register schema holds; inert records carry no value or url', () => {
  const reg = baseReg();
  eq(validateRegister(reg).join('; '), '', 'real register invalid');
  for (const r of reg.records) if (r.state !== 'stated') for (const k of ['value', 'url', 'handle']) ok(!(k in r), `${r.id} inert but has ${k}`);
  const dirty = structuredClone(reg);
  record(dirty, 'contract').value = fakeAddress();
  ok(validateRegister(dirty).length > 0, 'validator accepted an inert record with a value');
  const dirty2 = unconfirmed(reg, 'x'); record(dirty2, 'x').url = 'https://x.com/a';
  ok(validateRegister(dirty2).length > 0, 'validator accepted an unconfirmed record with a url');
  const dirty3 = flip(reg, 'x'); record(dirty3, 'x').handle = 'stored';
  ok(validateRegister(dirty3).length > 0, 'validator accepted a stored handle');
});

gate('link rule: handle is derived from the stored url, hosts are checked', () => {
  eq(deriveHandle('x', 'https://x.com/movio_test'), 'movio_test');
  eq(deriveHandle('x', 'https://twitter.com/movio_test/status/1'), 'movio_test');
  eq(deriveHandle('github', 'https://github.com/movio-test/repo'), 'movio-test');
  eq(deriveHandle('x', 'https://evil.example/movio'), null);
  eq(deriveHandle('github', 'http://github.com/a'), null);
  eq(deriveHandle('x', 'https://x.com/'), null);
});

gate('the page receives a public register without dates or provenance', () => {
  const d = dom();
  const pub = JSON.parse(d.window.document.getElementById('register').textContent);
  eq(JSON.stringify(pub), JSON.stringify(publicRegister(baseReg())), 'inline register differs from the public view');
  for (const r of pub.records) for (const k of Object.keys(r)) ok(!['checked', 'source', 'scope'].includes(k), `inline register leaks ${k}`);
  ok(!/\b(19|20)\d{2}\b/.test(JSON.stringify(pub)), 'inline register carries a year');
});

// ---------- 3. no dates ----------
const DATE_RES = [
  /\b(19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/, /\b\d{1,2}[-/.]\d{1,2}[-/.](19|20)?\d{2}\b/,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i,
  /\b(19|20)\d{2}\b/, /\b\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?\b/i, /\bas of\b/i, /\bchecked\b/i, /\blast updated\b|\bupdated\b/i, /\b\d+\s?(s|sec|secs|seconds?|mins?|minutes?|hours?|days?)\s+ago\b/i, /\bago\b/i, /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
];
const dateHits = (s) => DATE_RES.filter((re) => re.test(s)).map(String);

gate('no dates, timestamps, "as of" or clocks anywhere on the page', () => {
  const h = html();
  const bad = [];
  for (const line of visibleCopy(h)) if (dateHits(line).length) bad.push(`copy: ${line}`);
  for (const a of attributesOf(h)) {
    if (['href', 'src', 'content'].includes(a.name) && !/^(?!https?:)/.test(a.value) && a.name !== 'content') continue;
    if (['class', 'id', 'd', 'viewbox', 'rel', 'type', 'data-feed-pill'].includes(a.name)) continue;
    if (dateHits(a.value).length) bad.push(`attr ${a.tag}[${a.name}]=${a.value}`);
  }
  eq(bad.length, 0, bad.join('\n'));
});

gate('no date or clock formatting code ships in the source', () => {
  const re = /new Date|Date\(|toLocale(Date|Time)String|toISOString|toUTCString|toDateString|toTimeString|getFullYear|getMonth|getHours|getMinutes|DateTimeFormat|RelativeTimeFormat|timeAgo|moment|dayjs/;
  for (const f of list(path.join(root, 'src/js'))) ok(!re.test(read(f)), `${rel(f)} touches date formatting`);
  ok(!re.test(read(jsFile())), 'bundle touches date formatting');
});

// ---------- 4. palette ----------
gate('palette rule: colour literals live in src/tokens.css only', () => {
  const lit = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bhwb\(/;
  const bad = [];
  for (const f of list(path.join(root, 'src'))) {
    const r = rel(f);
    if (r === 'src/tokens.css' || r.startsWith('src/data/') || r.startsWith('src/generated/')) continue;
    if (/\.(css|js|html|mjs)$/.test(r) && lit.test(read(f))) bad.push(r);
  }
  for (const f of list(path.join(root, 'scripts'))) if (/lib\/(render|register|scan|text)\.mjs$|build\.mjs$/.test(f) && lit.test(read(f))) bad.push(rel(f));
  eq(bad.length, 0, `literals outside tokens: ${bad.join(', ')}`);
  ok(!lit.test(read(jsFile())), 'bundled js has colour literals');
});

gate('palette provenance: every token equals the real pixel it cites', async () => {
  const pal = JSON.parse(read(path.join(root, 'src/data/palette.json'))).palette;
  const tokensCss = read(path.join(root, 'src/tokens.css'));
  for (const [k, v] of Object.entries(pal)) {
    const { data, info } = await sharp(path.join(root, v.source)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (v.y * info.width + v.x) * 4;
    const hex = '#' + [data[i], data[i + 1], data[i + 2]].map((n) => n.toString(16).padStart(2, '0')).join('');
    eq(hex, v.hex, `${k} pixel ${v.x},${v.y} in ${v.source}`);
    ok(tokensCss.includes(`--c-${k}: ${v.hex};`), `tokens.css lacks --c-${k}: ${v.hex}`);
    ok(tokensCss.includes(`x=${v.x}`) || tokensCss.includes(`x=${String(v.x).padEnd(4)}`) || new RegExp(`x=${v.x}\\s+y=${v.y}`).test(tokensCss), `tokens.css provenance comment missing for ${k}`);
  }
  const set = new Set(Object.values(pal).map((v) => v.hex));
  const found = new Set((read(cssFile()).match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((s) => s.toLowerCase()));
  for (const f of found) ok(set.has(f) || set.has(f.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3')), `dist css holds an unsampled colour ${f}`);
  const fav = read(path.join(DIST, 'favicon.svg'));
  for (const f of fav.match(/#[0-9a-fA-F]{6}\b/g) || []) ok(set.has(f), `favicon colour ${f} is not a token`);
  const theme = html().match(/name="theme-color" content="(#[0-9a-f]{6})"/)?.[1];
  ok(set.has(theme), 'theme-color is not a token');
});

// ---------- 5. favicon ----------
gate('favicon is a 32x32 SVG traced from the logo pixel grid, no double hyphens', async () => {
  const svg = read(path.join(DIST, 'favicon.svg'));
  ok(!/--/.test(svg), 'favicon contains a double hyphen');
  ok(!/<!--/.test(svg), 'favicon contains a comment');
  const d = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document.documentElement;
  eq(d.getAttribute('width'), '32'); eq(d.getAttribute('height'), '32'); eq(d.getAttribute('viewBox'), '0 0 32 32');
  ok(d.querySelectorAll('path').length === 1 && !/[a-df-z]/i.test('') , 'one path expected');
  const rend = await sharp(Buffer.from(svg), { density: 384 }).resize(128, 128).removeAlpha().greyscale().raw().toBuffer();
  const full = await sharp(path.join(root, 'brand/LOGO MOVIO PNG.png')).greyscale().raw().toBuffer({ resolveWithObject: true });
  let bx0 = 1e9, by0 = 1e9, bx1 = 0, by1 = 0;
  for (let y = 0; y < full.info.height; y++) for (let x = 0; x < full.info.width; x++) if (full.data[y * full.info.width + x] > 150) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const logo = await sharp(path.join(root, 'brand/LOGO MOVIO PNG.png')).extract({ left: bx0, top: by0, width: bw, height: bh }).resize(160, Math.round(160 * bh / bw), { fit: 'fill' }).greyscale().raw().toBuffer();
  const LH = Math.round(160 * bh / bw);
  // favicon geometry: mark spans x 5..27, height scaled by 740/805 and centred in 32
  let inter = 0, uni = 0;
  const hUnits = 22 * bh / bw, y0 = 5 + (22 - hUnits) / 2;
  for (let y = 0; y < LH; y++) for (let x = 0; x < 160; x++) {
    const a = logo[y * 160 + x] > 150;
    const rx = Math.min(127, Math.round((5 + (x / 160) * 22) * 4)), ry = Math.min(127, Math.round((y0 + (y / LH) * hUnits) * 4));
    const b = rend[ry * 128 + rx] > 150;
    if (a && b) inter++; if (a || b) uni++;
  }
  ok(inter / uni > 0.8, `favicon silhouette overlap with the logo only ${(inter / uni).toFixed(2)}`);
});

// ---------- 6. social ----------
const socials = (h) => [...new JSDOM(h).window.document.querySelectorAll('.topbar .socials .social')];
gate('social: X and GitHub icons present, official marks, icon only, last in the topbar', () => {
  const d = dom().window.document;
  const el = socials(html());
  eq(el.length, 2, 'two icons');
  eq(el[0].dataset.social, 'x'); eq(el[1].dataset.social, 'github');
  eq(el[0].querySelector('path').getAttribute('d'), X_PATH, 'X path');
  eq(el[1].querySelector('path').getAttribute('d'), GITHUB_PATH, 'Octicon path');
  for (const e of el) eq(e.textContent.trim(), '', 'icons carry no text label');
  eq(d.querySelector('.topbar').lastElementChild.className, 'socials', 'socials sit last in the topbar');
  const css = read(cssFile());
  ok(/\.socials\{[^}]*margin-left:auto/.test(css), 'socials are pushed to the right edge');
});

gate('social: never hidden at any breakpoint', () => {
  const css = read(path.join(root, 'src/css/main.css'));
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/\.social|\.topbar|\.brand\b/.test(m[1]) && /display:\s*none|visibility:\s*hidden|opacity:\s*0\b/.test(m[2]) && /\.social/.test(m[1])) throw new Error(`rule hides social: ${m[1].trim()}`);
  }
});

gate('social branches: absent is inert with no href; stated links out with a derived handle', async () => {
  const reg = baseReg();
  for (const id of ['x', 'github']) {
    const cur = record(reg, id);
    const before = socials(html()).find((e) => e.dataset.social === id);
    const a = await buildTo(`soc-a-${id}`, reg);
    const b = await buildTo(`soc-b-${id}`, flip(reg, id));
    const flipped = record(flip(reg, id), id);
    for (const [h, rec] of [[a.html, cur], [b.html, flipped]]) {
      const el = socials(h).find((e) => e.dataset.social === id);
      eq(el.querySelectorAll('svg').length, 1, 'icon rendered in both branches');
      if (rec.state === 'stated') {
        eq(el.tagName, 'A'); eq(el.getAttribute('href'), rec.url);
        ok(/noopener/.test(el.rel), 'rel noopener');
        ok(el.getAttribute('aria-label').includes('@' + deriveHandle(id, rec.url)), 'aria-label carries derived handle');
      } else {
        eq(el.hasAttribute('href'), false, 'inert has no href');
        eq(el.getAttribute('aria-disabled'), 'true');
        ok(el.classList.contains('is-inert'));
        ok(/pending/.test(el.getAttribute('aria-label')), 'inert label says pending');
      }
    }
    void before;
  }
  const un = await buildTo('soc-un', unconfirmed(reg, 'x'));
  eq(socials(un.html)[0].hasAttribute('href'), false, 'unconfirmed record has no href');
  const none = (await buildTo('soc-none', reg)).html;
  ok(!/href="https?:\/\/(x|twitter|github)\.com/i.test(none) || record(reg, 'x').state === 'stated' || record(reg, 'github').state === 'stated', 'no href for unstated records anywhere');
});

// ---------- 7. contract slot ----------
const caOf = (h) => new JSDOM(h).window.document.querySelector('#ca');
gate('contract slot sits first in the page, fixed, and is inert until stated', async () => {
  const d = dom().window.document;
  const hud = d.querySelector('.hud');
  ok(hud.querySelector('#ca'), 'ca lives in the fixed header');
  ok(hud.compareDocumentPosition(d.querySelector('main')) & 4, 'header precedes main');
  ok(/\.hud\{[^}]*position:fixed/.test(read(cssFile())), 'header is fixed');
  const reg = baseReg();
  const cur = record(reg, 'contract');
  const flipped = flip(reg, 'contract');
  const a = await buildTo('ca-a', reg);
  const b = await buildTo('ca-b', flipped);
  const fl = record(flipped, 'contract');
  for (const [h, rec] of [[a.html, cur], [b.html, fl]]) {
    const ca = caOf(h);
    eq(ca.dataset.state, rec.state);
    if (rec.state === 'stated') {
      eq(ca.querySelector('.ca-text').textContent, rec.value, 'full address shown untruncated');
      for (const c of ca.querySelectorAll('[data-copy]')) eq(c.dataset.copy, rec.value, 'copy payload');
      ok(ca.querySelectorAll('button').length >= 1, 'copy control exists');
    } else {
      eq(ca.querySelectorAll('[data-copy]').length, 0, 'inert slot has no copy payload');
      eq(ca.querySelectorAll('button, a').length, 0, 'inert slot has no controls');
      eq(ca.textContent.replace(/\s+/g, ' ').trim().toLowerCase(), `${rec.label.toLowerCase()} pending`, 'inert slot shows label and pending only');
      ok(!scanAddresses(ca.textContent, reg).found.length, 'inert slot holds no address-shaped text');
    }
  }
  const un = await buildTo('ca-un', unconfirmed(reg, 'contract'));
  eq(caOf(un.html).querySelectorAll('[data-copy]').length, 0);
});

gate('contract copy: click copies the stated address and shows feedback', async () => {
  const reg = flip(baseReg(), 'contract'); // forced into a state where a value exists only if it was absent
  const stated = record(reg, 'contract').state === 'stated' ? reg : flip(reg, 'contract');
  const { html: h } = await buildTo('ca-copy', stated);
  const win = new JSDOM(h, { pretendToBeVisual: true, url: 'https://movio.work/' }).window;
  const copied = [];
  Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async (t) => { copied.push(t); } }, configurable: true });
  const { initCopy } = await import('../src/js/copy.js');
  initCopy(win.document, win);
  win.document.querySelector('.ca-value').click();
  await new Promise((r) => setTimeout(r, 20));
  eq(copied[0], record(stated, 'contract').value, 'clipboard payload');
  ok(win.document.querySelector('[data-toast]').classList.contains('is-on'), 'toast shown');
  ok(win.document.querySelector('.ca-copy').classList.contains('is-done'), 'button shows done state');
});

// ---------- 8. address scanner ----------
gate('gate warning: address-shaped strings are matched to the stated registry, never blanket-rejected', () => {
  const absent = baseReg();
  const evm = '0x' + 'ab12'.repeat(10);
  const sol = fakeAddress();
  ok(scanAddresses(`value ${evm}`, absent).unregistered.includes(evm), 'unregistered 0x address flagged');
  ok(scanAddresses(`value ${sol}`, absent).unregistered.includes(sol), 'unregistered base58 address flagged');
  eq(scanAddresses('colors 0x1f 0xFF00 0xdeadbeef and 0x', absent).found.length, 0, 'short 0x hex is not address-shaped');
  const stated = flip(absent, 'contract');
  const mine = record(stated, 'contract').value;
  eq(scanAddresses(`CA ${mine}`, stated).unregistered.length, 0, 'stated address passes');
  ok(scanAddresses(`CA ${mine}`, absent).unregistered.length === 1, 'same string is flagged when the record is absent');
  const evmReg = structuredClone(absent); Object.assign(record(evmReg, 'contract'), { state: 'stated', value: evm });
  eq(scanAddresses(`CA ${evm}`, evmReg).unregistered.length, 0, 'registered 0x passes');
});

gate('gate warning: built pages carry no unregistered address-shaped string (both branches)', async () => {
  const reg = baseReg();
  for (const f of list(DIST).filter((x) => /\.(html|js|css|txt|svg)$/.test(x))) eq(scanAddresses(read(f), reg).unregistered.length, 0, `dist ${rel(f)} holds an unregistered address`);
  for (const [name, r] of [['scan-a', reg], ['scan-b', flip(reg, 'contract')]]) {
    const dir = (await buildTo(name, r)).out;
    for (const f of list(dir).filter((x) => /\.(html|js|css|txt|svg)$/.test(x))) {
      const s = scanAddresses(read(f), r);
      eq(s.unregistered.length, 0, `${rel(f)} holds ${s.unregistered.join(', ')}`);
    }
  }
});

// ---------- 9. round trips ----------
gate('every record flips both ways and comes back byte-identical', async () => {
  const reg = baseReg();
  const base = (await buildTo('rt-base', reg)).html;
  for (const id of ['contract', 'x', 'github', 'supply', 'holders', 'listing']) {
    const once = flip(reg, id);
    const mid = (await buildTo(`rt-${id}`, once)).html;
    ok(mid !== base, `flipping ${id} changed nothing`);
    const back = (await buildTo(`rt-${id}-back`, flip(once, id))).html;
    eq(back === base, true, `${id} did not restore to the same page`);
  }
  eq(html() === base, true, 'dist is stale against the register, rebuild');
});

// ---------- 10. market ----------
const sec = (h, sel) => new JSDOM(h).window.document.querySelector(sel)?.outerHTML;
gate('market ignores contract state; follows only the market-source record', async () => {
  const reg = baseReg();
  const a = await buildTo('mk-a', reg);
  const b = await buildTo('mk-b', flip(reg, 'contract'));
  for (const sel of ['#board', '.ticker-band', '[data-feed-pill]']) eq(sec(a.html, sel), sec(b.html, sel), `${sel} changed with the contract`);
  const pubA = JSON.parse(new JSDOM(a.html).window.document.getElementById('register').textContent).records.find((r) => r.id === 'market-source');
  const pubB = JSON.parse(new JSDOM(b.html).window.document.getElementById('register').textContent).records.find((r) => r.id === 'market-source');
  eq(JSON.stringify(pubA), JSON.stringify(pubB));
  const src = read(path.join(root, 'src/js/market.js'));
  ok(!/contract|\bca\b|mint/i.test(src.replace(/\/\/.*$/gm, '')), 'market.js must not read contract state');
  const off = await buildTo('mk-off', flip(reg, 'market-source'));
  const d = new JSDOM(off.html).window.document;
  eq(record(flip(reg, 'market-source'), 'market-source').state, 'absent', 'market-source flipped off');
  eq(d.body.dataset.market, 'off'); eq(d.querySelector('[data-feed-label]').textContent, 'Offline');
});

// ---- market runtime harness ----
function fakeFeed({ solanaCount = 14, volumes, failFirst = 0, noImage = [], mode = 'ok' } = {}) {
  const calls = [];
  let fails = failFirst;
  const addrs = Array.from({ length: solanaCount }, (_, i) => `So${String(i).padStart(2, '0')}${'x'.repeat(36)}${i}`);
  const fn = async (url) => {
    calls.push(url);
    if (mode === 'down' || fails > 0) { if (fails > 0) fails--; return { ok: false, status: 503, json: async () => ({}) }; }
    if (url.includes('token-boosts')) {
      return { ok: true, status: 200, json: async () => [
        ...addrs.map((a) => ({ chainId: 'solana', tokenAddress: a })),
        { chainId: 'solana', tokenAddress: addrs[0] },
        { chainId: 'ethereum', tokenAddress: '0xEthToken' + 'f'.repeat(30) },
        { chainId: 'base', tokenAddress: 'BaseToken' },
      ] };
    }
    const asked = url.split('/tokens/v1/solana/')[1].split(',');
    const pairs = [];
    asked.forEach((a) => {
      const i = addrs.indexOf(a);
      const vol = volumes ? volumes[i] : (i + 1) * 1000;
      pairs.push({ chainId: 'solana', baseToken: { address: a, name: `Token ${i}`, symbol: `T${i}` }, priceUsd: String(0.5 + i), priceChange: { h24: i % 2 ? 4.5 : -3.25 }, volume: { h24: vol }, liquidity: { usd: vol * 2 }, info: noImage.includes(i) ? undefined : { imageUrl: `https://cdn.dexscreener.com/cms/images/img${i}?width=800&height=800&quality=95&format=auto` } });
      pairs.push({ chainId: 'solana', baseToken: { address: a, name: `Token ${i}`, symbol: `T${i}` }, priceUsd: String(9), priceChange: { h24: 99 }, volume: { h24: 1 }, liquidity: { usd: 1 } });
    });
    pairs.push({ chainId: 'ethereum', baseToken: { address: '0xEthToken' + 'f'.repeat(30), name: 'Eth', symbol: 'ETH' }, priceUsd: '1', volume: { h24: 9e12 }, liquidity: { usd: 1e12 } });
    return { ok: true, status: 200, json: async () => pairs };
  };
  return { fn, calls, addrs };
}

function harness(opts = {}, domOpts = {}) {
  const d = dom();
  const win = d.window;
  const doc = win.document;
  let vis = 'visible';
  Object.defineProperty(doc, 'visibilityState', { get: () => vis, configurable: true });
  const feed = fakeFeed(opts);
  const timers = { scheduled: [], cleared: 0, set(f, ms) { const id = timers.scheduled.length + 1; timers.scheduled.push({ id, f, ms, live: true }); return id; }, clear(id) { const t = timers.scheduled.find((x) => x.id === id); if (t?.live) { t.live = false; timers.cleared++; } } };
  const imgs = [];
  const orig = doc.createElement.bind(doc);
  doc.createElement = (tag, o) => { const el = orig(tag, o); if (tag === 'img') imgs.push(el); return el; };
  const regRec = JSON.parse(doc.getElementById('register').textContent).records.find((r) => r.id === 'market-source');
  return { d, win, doc, feed, timers, imgs, regRec, setVis: (v) => { vis = v; doc.dispatchEvent(new win.Event('visibilitychange')); }, domOpts };
}
const flush = () => new Promise((r) => setTimeout(r, 15));
const liveTimer = (t) => t.scheduled.filter((x) => x.live).at(-1);

gate('market: solana only, top ten by 24h volume, every field rendered, letter fallback, per-row copy', async () => {
  const { createMarket } = await import('../src/js/market.js');
  const h = harness({ solanaCount: 14, noImage: [13], volumes: [5, 900, 40, 7000, 60, 20, 800, 100, 3, 650000, 15, 70, 99999, 120000] });
  const m = createMarket({ doc: h.doc, win: h.win, record: h.regRec, fetchFn: h.feed.fn, reduce: true, rand: () => 0, timers: h.timers });
  m.start(); await flush();
  const pairCalls = h.feed.calls.filter((u) => u.includes('/tokens/v1/solana/'));
  ok(pairCalls.length >= 1, 'pairs endpoint called');
  ok(!pairCalls.join().includes('0xEthToken') && !pairCalls.join().includes('BaseToken'), 'non-solana addresses never requested');
  ok(pairCalls.every((u) => u.split('/solana/')[1].split(',').length <= 30), 'chunks of at most 30');
  const rows = [...h.doc.querySelectorAll('[data-board] .row-live')];
  eq(rows.length, 10, 'ten rows');
  eq(h.doc.querySelectorAll('[data-board] .row-sk').length, 0, 'skeletons replaced');
  const syms = rows.map((r) => r.querySelector('.tname i').textContent);
  // volume order: values in the fake are known
  const volByIdx = [5, 900, 40, 7000, 60, 20, 800, 100, 3, 650000, 15, 70, 99999, 120000];
  const want = volByIdx.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 10).map(([, i]) => `T${i}`);
  eq(syms.join(','), want.join(','), 'top ten by 24h volume, descending');
  for (const r of rows) {
    for (const c of ['.c-price', '.c-chg', '.c-vol', '.c-liq']) ok(r.querySelector(c).textContent.trim().length > 0 && r.querySelector(c).textContent !== '', `${c} filled`);
    ok(r.querySelector('button.copy'), 'copy button per row');
    ok(r.querySelector('.tile').textContent.length >= 1, 'tile has a letter until the logo loads');
  }
  // logo present for rows with imageUrl, letter tile for the one without
  const withImg = h.imgs.length;
  ok(withImg >= 9, 'nine board rows carry an imageUrl (one top-ten token has none)');
  h.imgs[0].dispatchEvent(new h.win.Event('load'));
  ok(h.imgs[0].parentElement?.classList.contains('tile'), 'logo swaps in on load');
  const bad = h.imgs[1];
  bad.dispatchEvent(new h.win.Event('error')); // first error retries with the raw url
  bad.dispatchEvent(new h.win.Event('error')); // second error drops the image
  ok(!bad.isConnected, 'failed logo is removed');
  const tile = [...h.doc.querySelectorAll('.row-live .tile')].find((t) => !t.querySelector('img') && t.textContent.length === 1);
  ok(tile, 'letter tile remains');
  // copy per address
  const copied = [];
  Object.defineProperty(h.win.navigator, 'clipboard', { value: { writeText: async (t) => { copied.push(t); } }, configurable: true });
  rows[0].querySelector('button.copy').click(); await flush();
  eq(copied[0], h.feed.addrs[9], 'row copy payload is the token address of the top-ranked row');
  // ticker uses the same live data
  const ticks = [...h.doc.querySelectorAll('.ticker-track .tick:not(.tick-sk) .sym')].map((e) => e.textContent);
  ok(ticks.length >= 20 && ticks.slice(0, 10).join() === syms.join(), 'ticker mirrors the board, duplicated for a seamless loop');
  eq(h.doc.querySelector('[data-feed-label]').textContent, 'Live');
  // market addresses never appear as visible text
  ok(!scanAddresses(h.doc.body.textContent, baseReg()).found.some((a) => h.feed.addrs.includes(a)), 'token addresses stay out of visible text');
  // still no dates after the data is in
  for (const line of h.doc.body.textContent.split(/\s{2,}|\n/)) ok(!dateHits(line).length, `date-like text after load: ${line}`);
  m.stop();
});

gate('market: failure shows dashes and an error, backs off exponentially, keeps the last good data', async () => {
  const { createMarket, backoffDelay } = await import('../src/js/market.js');
  eq([1, 2, 3, 4, 5, 6, 7, 9].map((n) => backoffDelay(n)).join(','), '2000,4000,8000,16000,32000,60000,60000,60000', 'backoff curve');
  const h = harness({ mode: 'down' });
  const m = createMarket({ doc: h.doc, win: h.win, record: h.regRec, fetchFn: h.feed.fn, reduce: true, rand: () => 0, timers: h.timers });
  m.start(); await flush();
  eq(h.doc.querySelectorAll('.row-dash').length, 10, 'dash rows on first failure');
  ok(h.doc.querySelector('.row-dash .c-vol').textContent === '—', 'dash in numeric cells');
  const err = h.doc.querySelector('[data-feed-error]');
  ok(!err.hidden && err.textContent.length > 8, 'error message visible');
  eq(h.doc.querySelector('[data-feed-label]').textContent, 'Retrying');
  eq(liveTimer(h.timers).ms, 2000, 'first retry after 2s');
  const seen = [liveTimer(h.timers).ms];
  for (let i = 0; i < 4; i++) { liveTimer(h.timers).f(); await flush(); seen.push(liveTimer(h.timers).ms); }
  eq(seen.join(','), '2000,4000,8000,16000,32000');
  m.stop();
  // recovery then a later failure keeps the earlier rows
  const h2 = harness({ failFirst: 2 });
  const m2 = createMarket({ doc: h2.doc, win: h2.win, record: h2.regRec, fetchFn: h2.feed.fn, reduce: true, rand: () => 0, timers: h2.timers });
  m2.start(); await flush();
  eq(liveTimer(h2.timers).ms, 2000);
  liveTimer(h2.timers).f(); await flush();   // boosts ok? failFirst counts calls, second call fails too
  liveTimer(h2.timers).f(); await flush();
  liveTimer(h2.timers).f(); await flush();
  eq(m2.state.hasData, true, 'recovered');
  eq(m2.state.failures, 0, 'failure counter reset');
  eq(liveTimer(h2.timers).ms, 60000, 'poll interval after recovery');
  const before = [...h2.doc.querySelectorAll('.row-live .tname b')].map((e) => e.textContent).join();
  h2.feed.calls.length = 0;
  const failing = fakeFeed({ mode: 'down' });
  const m3 = createMarket({ doc: h2.doc, win: h2.win, record: h2.regRec, fetchFn: failing.fn, reduce: true, rand: () => 0, timers: h2.timers });
  void m3;
  // drive the original market into a failure by swapping the feed mode
  const h4 = harness({});
  let down = false;
  const wrap = async (u) => (down ? { ok: false, status: 500, json: async () => ({}) } : h4.feed.fn(u));
  const m4 = createMarket({ doc: h4.doc, win: h4.win, record: h4.regRec, fetchFn: wrap, reduce: true, rand: () => 0, timers: h4.timers });
  m4.start(); await flush();
  const good = [...h4.doc.querySelectorAll('.row-live .tname b')].map((e) => e.textContent).join();
  eq(good.length > 0, true);
  down = true;
  liveTimer(h4.timers).f(); await flush();
  eq([...h4.doc.querySelectorAll('.row-live .tname b')].map((e) => e.textContent).join(), good, 'last good rows survive a failed refresh');
  eq(h4.doc.querySelectorAll('.row-dash').length, 0, 'no dash rows once data exists');
  eq(h4.doc.querySelector('[data-feed-label]').textContent, 'Retrying');
  void before; m4.stop(); m2.stop();
});

gate('market: polls every 60s, pauses while hidden, fetches immediately when visible again', async () => {
  const { createMarket, POLL_MS } = await import('../src/js/market.js');
  eq(POLL_MS, 60000);
  const h = harness({});
  const m = createMarket({ doc: h.doc, win: h.win, record: h.regRec, fetchFn: h.feed.fn, reduce: true, rand: () => 0, timers: h.timers });
  m.start(); await flush();
  eq(liveTimer(h.timers).ms, 60000, 'next poll in 60s');
  const n = h.feed.calls.length;
  h.setVis('hidden'); await flush();
  ok(!h.timers.scheduled.some((t) => t.live), 'timer cleared while hidden');
  eq(h.doc.querySelector('[data-feed-label]').textContent, 'Paused');
  eq(h.feed.calls.length, n, 'no request while hidden');
  h.setVis('visible'); await flush();
  ok(h.feed.calls.length > n, 'immediate fetch on visible');
  eq(liveTimer(h.timers).ms, 60000, 'polling resumed');
  // starting while hidden never fetches
  const hh = harness({});
  hh.setVis('hidden');
  const mm = createMarket({ doc: hh.doc, win: hh.win, record: hh.regRec, fetchFn: hh.feed.fn, reduce: true, rand: () => 0, timers: hh.timers });
  mm.start(); await flush();
  eq(hh.feed.calls.length, 0, 'hidden start makes no request');
  m.stop(); mm.stop();
});

gate('market: off record means zero requests and an inert board', async () => {
  const { createMarket } = await import('../src/js/market.js');
  const h = harness({});
  const m = createMarket({ doc: h.doc, win: h.win, record: { id: 'market-source', state: 'absent' }, fetchFn: h.feed.fn, reduce: true, timers: h.timers });
  m.start(); await flush();
  eq(h.feed.calls.length, 0);
  eq(h.doc.querySelector('[data-feed-label]').textContent, 'Offline');
});

gate('market: count-up animates to the target and flashes on a changed value', async () => {
  const { countTo, flash } = await import('../src/js/motion.js');
  const d = dom();
  const win = d.window;
  globalThis.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 8);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  const el = win.document.createElement('span');
  const seen = [];
  countTo(el, 100, (n) => { const t = String(Math.round(n)); seen.push(t); return t; }, { duration: 120, reduce: false });
  await new Promise((r) => setTimeout(r, 300));
  ok(seen.length > 3 && seen[0] !== '100' && el.textContent === '100', 'intermediate frames then the final value');
  const el2 = win.document.createElement('span');
  flash(el2, 1, false);
  ok(el2.classList.contains('flash-up'), 'flash class applied');
  flash(el2, -1, false);
  ok(el2.classList.contains('flash-down') && !el2.classList.contains('flash-up'), 'direction swaps the flash');
  const el3 = win.document.createElement('span');
  flash(el3, 1, true);
  eq(el3.className, '', 'reduced motion skips the flash');
  delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame;
});

// ---------- 11. motion ----------
gate('reduced motion: CSS collapses every animation, JS jumps to the end state', async () => {
  const css = read(cssFile());
  const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^]*)/);
  ok(block, 'reduced-motion media block present');
  ok(/animation:none!important/.test(block[1]) && /transition:none!important/.test(block[1]), 'blanket animation and transition kill');
  ok(/scroll-behavior:auto/.test(block[1]), 'smooth scroll off');
  ok(/data-reveal[^}]*opacity:1/.test(block[1]), 'reveal elements rest visible');
  const { spring, initReveal, initParallax, countTo, prefersReduced } = await import('../src/js/motion.js');
  const win = new JSDOM(html(), { pretendToBeVisual: true }).window;
  win.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q });
  ok(prefersReduced(win), 'matchMedia honoured');
  let rafCalls = 0;
  const vals = [];
  spring({ from: 0, to: 1, onUpdate: (v) => vals.push(v), reduce: true, raf: () => { rafCalls++; return 0; } });
  eq(vals.join(), '1', 'spring lands on the target at once'); eq(rafCalls, 0, 'no frames requested');
  initReveal(win.document, win);
  eq(win.document.querySelectorAll('[data-reveal]:not(.is-in)').length, 0, 'every reveal element is shown at once');
  let listeners = 0;
  const w2 = { matchMedia: win.matchMedia, addEventListener: () => { listeners++; } };
  initParallax(win.document.getElementById('hero'), w2);
  eq(listeners, 0, 'parallax attaches nothing');
  const sp = win.document.createElement('span');
  countTo(sp, 5, String, { reduce: true });
  eq(sp.textContent, '5');
});

gate('spring solver is a damped oscillator: settles on target, bounded overshoot', async () => {
  const { spring } = await import('../src/js/motion.js');
  let t = 0; const q = [];
  const raf = (f) => { q.push(f); return q.length; };
  const xs = [];
  let done = false;
  spring({ from: 0, to: 1, k: 150, c: 19, reduce: false, raf, caf: () => {}, onUpdate: (x) => xs.push(x), onDone: () => { done = true; } });
  const realNow = performance.now.bind(performance);
  const base = realNow();
  for (let i = 0; i < 400 && !done; i++) { t += 16.7; q.shift()(base + t); }
  ok(done, 'settles');
  ok(Math.max(...xs) < 1.25, `overshoot bounded (${Math.max(...xs).toFixed(3)})`);
  ok(Math.abs(xs.at(-1) - 1) < 1e-9, 'ends exactly on target');
  ok(xs.some((x) => x > 1), 'under-damped settle is visible');
});

gate('visual systems are wired: progress bar, reveal, parallax layers, mesh, spotlight, pill, skeletons', () => {
  const d = dom().window.document;
  ok(d.querySelector('.progress i'), 'progress bar');
  ok(d.querySelectorAll('[data-reveal]').length >= 15, 'reveal targets');
  ok(d.querySelectorAll('.hero [data-depth]').length >= 6, 'parallax layers');
  ok(d.querySelectorAll('.mesh').length >= 3, 'gradient mesh blobs');
  ok(d.querySelectorAll('.spot').length >= 10, 'spotlight hosts');
  ok(d.querySelector('.pill .dot'), 'status pill with a live dot');
  eq(d.querySelectorAll('[data-board] .row-sk').length, 10, 'ten skeleton rows');
  eq(d.querySelectorAll('.ticker .tick-sk').length, 8, 'ticker skeleton chips');
  const css = read(cssFile());
  ok(/@keyframes pulse/.test(css) && /@keyframes shimmer/.test(css) && /@keyframes marquee/.test(css) && /@keyframes drift/.test(css), 'keyframes present');
  ok(/\.spot:hover:before/.test(css) && /radial-gradient\(260px circle at var\(--mx/.test(css), 'spotlight hover');
  ok(/flash-up/.test(css) && /flash-down/.test(css), 'flash on change');
});

// ---------- 12. mobile + units ----------
gate('no ch units anywhere; tap target token is 44px', () => {
  for (const f of [...list(path.join(root, 'src')).filter((x) => /\.(css|js)$/.test(x)), cssFile(), jsFile()]) ok(!/\b\d*\.?\d+ch\b/.test(read(f)), `${rel(f)} uses ch units`);
  ok(/--tap:\s*44px/.test(read(path.join(root, 'src/tokens.css'))), 'tap token');
  const css = read(path.join(root, 'src/css/main.css'));
  ok(/\.btn\{[^}]*min-height:\s*48px/.test(css.replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/\{ /g, '{').replace(/; \}/g, ';}') ) || /\.btn \{[^}]*min-height: 48px/.test(css), 'buttons at least 44');
});

gate('hosts: only the market source and same-origin assets are referenced', () => {
  const allow = [/^https:\/\/api\.dexscreener\.com\//, /^https:\/\/cdn\.dexscreener\.com/, /^https:\/\/movio\.work\//, /^http:\/\/www\.w3\.org\/2000\/svg$/];
  const bad = [];
  for (const f of list(DIST).filter((x) => /\.(html|css|js|svg|txt)$/.test(x))) {
    for (const u of read(f).match(/https?:\/\/[^\s"'<>)\\]+/g) || []) if (!allow.some((re) => re.test(u))) bad.push(`${rel(f)}: ${u}`);
  }
  eq(bad.length, 0, bad.join('\n'));
});

gate('CSP-clean markup: no inline script, style attribute or event handler; headers file present', () => {
  const h = html();
  const d = dom(h).window.document;
  for (const s of d.querySelectorAll('script')) ok(s.src || s.type === 'application/json', 'inline executable script');
  ok(!/\sstyle=/.test(h), 'inline style attribute');
  ok(!/\son[a-z]+=/i.test(h), 'inline event handler');
  const hd = read(path.join(DIST, '_headers'));
  ok(/Content-Security-Policy:/.test(hd) && /connect-src 'self' https:\/\/api\.dexscreener\.com/.test(hd));
});

gate('copy distance: zero shared two-word runs with the reference corpus', () => {
  const ref = bigrams(read(path.join(root, 'src/data/reference-corpus.txt')));
  const lines = visibleCopy(html());
  for (const f of ['market.js', 'copy.js', 'main.js']) {
    const src = read(path.join(root, 'src/js', f));
    for (const m of src.matchAll(/(['`])((?:\\.|(?!\1)[^\\\n]){4,200})\1/g)) {
      if (/\s/.test(m[2]) && !/[{}()=<>;]/.test(m[2]) && !/Error\($/.test(src.slice(Math.max(0, m.index - 7), m.index))) lines.push(m[2]);
    }
  }
  const hits = lines.flatMap((l) => [...bigrams(l)].filter((b) => ref.has(b)).map((b) => `${b}  <- ${l}`));
  eq(hits.length, 0, hits.join('\n'));
  const mine = vocabulary(lines.join('\n'));
  const shared = [...mine].filter((w) => vocabulary(read(path.join(root, 'src/data/reference-corpus.txt'))).has(w));
  console.log(`      info: ${shared.length} of ${mine.size} single words overlap (common vocabulary); phrases overlap: 0`);
});

gate('semantics: tabs are wired, every image has alt, every control has a name', () => {
  const d = dom().window.document;
  const tabs = [...d.querySelectorAll('[role=tab]')];
  eq(tabs.length, 4);
  eq(tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length, 1);
  for (const t of tabs) { const p = d.getElementById(t.getAttribute('aria-controls')); ok(p && p.getAttribute('aria-labelledby') === t.id, 'tab/panel pair'); eq(p.hidden, t.getAttribute('aria-selected') !== 'true'); }
  for (const i of d.querySelectorAll('img')) ok(i.hasAttribute('alt'), 'img alt');
  for (const b of d.querySelectorAll('button, a[href]')) ok((b.textContent.trim() || b.getAttribute('aria-label')), `unnamed control ${b.outerHTML.slice(0, 60)}`);
  ok(d.querySelector('html').lang === 'en');
});

// ---------- run ----------
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
ok(fs.existsSync(path.join(DIST, 'index.html')), 'run npm run build first');
let failed = 0;
for (const [i, g] of results.entries()) {
  try { await g.fn(); console.log(`PASS ${String(i + 1).padStart(2, '0')}  ${g.name}`); }
  catch (e) { failed++; console.log(`FAIL ${String(i + 1).padStart(2, '0')}  ${g.name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\ngates: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
