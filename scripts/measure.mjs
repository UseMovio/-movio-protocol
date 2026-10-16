// Measures the built page at 360 / 390 / 430 / 1366 / 1440 in a real Chromium (Edge) and prints the numbers.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { root } from './build.mjs';

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
const VIEWS = [[360, 740], [390, 844], [430, 932], [1366, 768], [1440, 900]];
const outDir = path.join(root, 'reports');
fs.mkdirSync(outDir, { recursive: true });

const server = await serve(path.join(root, 'dist'), 4811);
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const rows = [];
let bad = 0;
for (const [w, h] of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 700, isMobile: w < 700 });
  const page = await ctx.newPage();
  await page.route('https://api.dexscreener.com/**', (r) => r.abort()); // layout must hold with the feed down too
  await page.goto('http://127.0.0.1:4811/', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const m = await page.evaluate(() => {
    const R = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), r: +r.right.toFixed(1) }; };
    const vw = document.documentElement.clientWidth;
    const soc = [...document.querySelectorAll('.socials .social')].map((e) => ({ ...R(e), vis: getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' }));
    const ca = document.querySelector('#ca');
    const caVal = ca.querySelector('.ca-value');
    const tops = [...document.querySelectorAll('a[href], button, [role=tab], .social')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]') && !e.closest('.skip'); });
    const small = tops.map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width < 43.5 || r.height < 43.5).map(({ e, r }) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
    const over = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1 && !e.closest('.ticker') && !e.closest('.tablist') && !e.closest('.hero-bg') && !e.closest('.hero-art'); }).slice(0, 5).map((e) => e.tagName + '.' + e.className);
    const hud = document.querySelector('.hud');
    return {
      vw, scrollW: document.documentElement.scrollWidth, overflowX: document.documentElement.scrollWidth > vw + 1, over,
      socials: soc, topbar: R(document.querySelector('.topbar')), ca: R(ca), caFont: getComputedStyle(caVal).fontSize, caLabelFont: getComputedStyle(ca.querySelector('.ca-label')).fontSize,
      hudBottom: Math.round(hud.getBoundingClientRect().bottom), hudPos: getComputedStyle(hud).position,
      h1: getComputedStyle(document.querySelector('h1')).fontSize, small,
      pill: R(document.querySelector('.pill')), brand: R(document.querySelector('.brand')),
      dashRows: document.querySelectorAll('.row-dash').length,
    };
  });
  const s = m.socials;
  const checks = {
    'no horizontal overflow': !m.overflowX && m.over.length === 0,
    'both social icons visible, 44x44+': s.length === 2 && s.every((x) => x.vis && x.w >= 44 && x.h >= 44),
    'social icons top-right': s.every((x) => x.y < 100 && x.r > m.vw * 0.7) && s[1].r <= m.vw - 8 && s[1].r >= m.vw - 70,
    'every tap target >= 44x44': m.small.length === 0,
    'CA slot inside viewport': m.ca.x >= 0 && m.ca.r <= m.vw,
    'header fixed': m.hudPos === 'fixed',
  };
  for (const [k, v] of Object.entries(checks)) if (!v) bad++;
  rows.push({ w, h, ...m, checks });
  await page.screenshot({ path: path.join(outDir, `view-${w}-top.png`) });
  await page.evaluate(() => document.getElementById('board').scrollIntoView());
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, `view-${w}-board.png`) });
  await ctx.close();
}

// CA stated branch (large font + full address) measured on a rebuilt variant
const { build } = await import('./build.mjs');
const reg = JSON.parse(fs.readFileSync(path.join(root, 'src/data/register.json'), 'utf8'));
const c = reg.records.find((r) => r.id === 'contract');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const addr = Array.from({ length: 44 }, (_, i) => B58[(i * 7 + 3) % B58.length]).join('');
Object.assign(c, { state: 'stated', value: addr });
for (const k of ['x', 'github']) { const r = reg.records.find((x) => x.id === k); r.state = 'stated'; r.url = k === 'x' ? 'https://x.com/movio_test' : 'https://github.com/movio-test'; }
const variant = path.join(root, '.measure-stated');
await build({ outDir: variant, register: reg });
const vs = await serve(variant, 4812);
const stated = [];
for (const [w, h] of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 700, isMobile: w < 700 });
  const page = await ctx.newPage();
  await page.route('https://api.dexscreener.com/**', (r) => r.abort());
  await page.goto('http://127.0.0.1:4812/');
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const v = document.querySelector('.ca-value');
    const r = v.getBoundingClientRect();
    const t = v.querySelector('.ca-text');
    const lines = Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight));
    const btn = [...document.querySelectorAll('.ca button')].map((b) => { const q = b.getBoundingClientRect(); return `${q.width.toFixed(0)}x${q.height.toFixed(0)}`; });
    const soc = [...document.querySelectorAll('.socials a.social')].map((a) => { const q = a.getBoundingClientRect(); return { href: a.getAttribute('href'), w: q.width, h: q.height, r: q.right }; });
    return { font: getComputedStyle(v).fontSize, text: t.textContent.length, lines, wFits: r.right <= innerWidth, btn, soc, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  await page.screenshot({ path: path.join(outDir, `stated-${w}.png`) });
  stated.push({ w, ...m });
  if (m.overflow || !m.wFits || m.text !== 44 || m.soc.length !== 2) bad++;
  await ctx.close();
}
await browser.close();
server.close(); vs.close();
fs.rmSync(variant, { recursive: true, force: true });

console.log('\nBREAKPOINT MEASUREMENTS (absent branch, feed blocked)');
for (const r of rows) {
  console.log(`\n${r.w}x${r.h}  scrollWidth ${r.scrollW}/${r.vw}  hud bottom ${r.hudBottom}px  topbar h ${r.topbar.h}  ca ${r.ca.w}x${r.ca.h}  h1 ${r.h1}  CA font ${r.caFont}`);
  console.log(`  socials ${r.socials.map((s) => `${s.w}x${s.h}@${s.x},${s.y}`).join('  ')}  pill ${r.pill.w}x${r.pill.h}  brand ${r.brand.w}x${r.brand.h}`);
  for (const [k, v] of Object.entries(r.checks)) console.log(`  ${v ? 'ok  ' : 'FAIL'} ${k}`);
  if (r.small.length) console.log('  small targets:', r.small.join('; '));
  if (r.over.length) console.log('  overflowing:', r.over.join('; '));
}
console.log('\nSTATED BRANCH (full address, links live)');
for (const s of stated) console.log(`${s.w}: CA font ${s.font}, ${s.text} chars, ${s.lines} line(s), fits ${s.wFits}, controls ${s.btn.join(' ')}, socials ${s.soc.map((x) => `${x.w}x${x.h}`).join(' ')} overflow ${s.overflow}`);
console.log(bad ? `\nmeasure: ${bad} check(s) failed` : '\nmeasure: all checks passed');
process.exit(bad ? 1 : 0);
