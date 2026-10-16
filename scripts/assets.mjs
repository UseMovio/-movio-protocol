// Asset pass: reads every file in brand/ and reference/, reports IHDR, alpha histogram and
// dominant pixels, derives the palette (k-means, snapped to real pixel coordinates),
// resizes the transparent logo with premultiplied alpha, and traces the favicon.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const genDir = path.join(root, 'src', 'generated');
fs.mkdirSync(genDir, { recursive: true });
fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true });

const FILES = {
  logoTransparent: 'brand/LOGO MOVIO PNG...png',
  logoDark: 'brand/LOGO MOVIO PNG.png',
  logoJpg: 'brand/LOGO MOVIO JPG.jpg.jpeg',
  banner: 'reference/SAMPUL MOVIO JPG.jpg.jpeg',
  slides: [1, 2, 3, 4, 5, 6].map((n) => `reference/MOVIO ${n}.jpg.jpeg`),
};

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function raw(file) {
  const { data, info } = await sharp(path.join(root, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function ihdr(file) {
  const b = fs.readFileSync(path.join(root, file));
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bitDepth: b[24], colourType: b[25], interlace: b[28] };
}

// deterministic PRNG so the palette is reproducible
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function kmeans({ data, w, h }, k, { step = 3, seed = 7, opaqueOnly = true } = {}) {
  const pts = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (opaqueOnly && data[i + 3] < 255) continue;
      pts.push([data[i], data[i + 1], data[i + 2], x, y]);
    }
  }
  const rand = rng(seed);
  const d2 = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  const cent = [pts[Math.floor(rand() * pts.length)].slice(0, 3)];
  while (cent.length < k) {
    const ds = pts.map((p) => Math.min(...cent.map((c) => d2(p, c))));
    const total = ds.reduce((a, b) => a + b, 0);
    let t = rand() * total;
    let idx = 0;
    for (; idx < ds.length - 1; idx++) { t -= ds[idx]; if (t <= 0) break; }
    cent.push(pts[idx].slice(0, 3));
  }
  const assign = new Array(pts.length).fill(0);
  for (let it = 0; it < 40; it++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = d2(pts[i], cent[c]); if (d < bd) { bd = d; best = c; } }
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    }
    const sum = cent.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => { const s = sum[assign[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    sum.forEach((s, c) => { if (s[3]) cent[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    if (!moved) break;
  }
  const counts = new Array(k).fill(0);
  assign.forEach((a) => counts[a]++);
  // snap every centroid to the nearest real pixel of its cluster, so each colour has a coordinate
  return cent.map((c, ci) => {
    let best = null, bd = Infinity;
    pts.forEach((p, i) => { if (assign[i] !== ci) return; const d = d2(p, c); if (d < bd) { bd = d; best = p; } });
    return best && { hex: hex(best[0], best[1], best[2]), x: best[3], y: best[4], share: counts[ci] / pts.length, rgb: best.slice(0, 3) };
  }).filter(Boolean).sort((a, b) => b.share - a.share);
}

function dominant(img, n = 6) {
  const m = new Map();
  for (let i = 0; i < img.data.length; i += 4 * 5) {
    if (img.data[i + 3] === 0) continue;
    const key = hex(img.data[i] & 0xf8, img.data[i + 1] & 0xf8, img.data[i + 2] & 0xf8);
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ bucket: k, count: v }));
}

function alphaHistogram(img) {
  const h = new Array(256).fill(0);
  for (let i = 3; i < img.data.length; i += 4) h[img.data[i]]++;
  return { transparent: h[0], opaque: h[255], partial: h.slice(1, 255).reduce((a, b) => a + b, 0) };
}

function pureBlackTransparent(img) {
  let n = 0, z = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) { z++; if (img.data[i] + img.data[i + 1] + img.data[i + 2] === 0) n++; }
  }
  return { transparentPx: z, pureBlack: n };
}

async function resizePremultiplied(img, size) {
  // pure-black RGB under alpha 0 would bleed dark fringes into a straight-alpha resize,
  // so multiply colour by alpha first and let sharp divide it back out afterwards
  const pm = Buffer.from(img.data);
  for (let i = 0; i < pm.length; i += 4) {
    const a = pm[i + 3] / 255;
    pm[i] = Math.round(pm[i] * a); pm[i + 1] = Math.round(pm[i + 1] * a); pm[i + 2] = Math.round(pm[i + 2] * a);
  }
  return sharp(pm, { raw: { width: img.w, height: img.h, channels: 4, premultiplied: true } })
    .resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
}

// ---- favicon: boundary edges of the real mask, chained into loops, simplified ----
function traceMask(img, threshold) {
  const { data, w, h } = img;
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && lum(data[(y * w + x) * 4], data[(y * w + x) * 4 + 1], data[(y * w + x) * 4 + 2]) > threshold;
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const edges = new Map();
  const add = (x1, y1, x2, y2) => { const k = x1 + ',' + y1; if (!edges.has(k)) edges.set(k, []); edges.get(k).push([x2, y2]); };
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (!on(x, y)) continue;
    if (!on(x, y - 1)) add(x, y, x + 1, y);
    if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!on(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops = [];
  while (edges.size) {
    const [k0] = edges.entries().next().value;
    const [sx, sy] = k0.split(',').map(Number);
    const loop = [[sx, sy]];
    let cx = sx, cy = sy;
    for (;;) {
      const key = cx + ',' + cy;
      const list = edges.get(key);
      if (!list) break;
      const [nx, ny] = list.shift();
      if (!list.length) edges.delete(key);
      cx = nx; cy = ny;
      if (cx === sx && cy === sy) break;
      loop.push([cx, cy]);
    }
    loops.push(loop);
  }
  return { loops, bbox: [minX, minY, maxX + 1, maxY + 1] };
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const d = Math.abs(dy * x - dx * y + b[0] * a[1] - b[1] * a[0]) / (Math.hypot(dx, dy) || 1);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
  return [a, b];
}

function simplifyLoop(loop, eps) {
  const stride = Math.max(1, Math.floor(loop.length / 200));
  let i0 = 0, i1 = 0, best = -1;
  for (let i = 0; i < loop.length; i += stride)
    for (let j = i + 1; j < loop.length; j += stride) {
      const d = (loop[i][0] - loop[j][0]) ** 2 + (loop[i][1] - loop[j][1]) ** 2;
      if (d > best) { best = d; i0 = i; i1 = j; }
    }
  const rot = [...loop.slice(i0), ...loop.slice(0, i0)];
  const k = (i1 - i0 + loop.length) % loop.length;
  const A = rdp(rot.slice(0, k + 1), eps);
  const B = rdp([...rot.slice(k), rot[0]], eps);
  return [...A.slice(0, -1), ...B.slice(0, -1)];
}

function faviconSvg(img, fill, bg) {
  const { loops, bbox } = traceMask(img, 150);
  const [x0, y0, x1, y1] = bbox;
  const size = Math.max(x1 - x0, y1 - y0);
  const pad = 5, span = 32 - pad * 2;
  const sc = span / size;
  const ox = pad + (span - (x1 - x0) * sc) / 2, oy = pad + (span - (y1 - y0) * sc) / 2;
  const f = (n) => +n.toFixed(2);
  const d = loops
    .filter((l) => l.length > 40)
    .map((l) => simplifyLoop(l, size * 0.004))
    .map((l) => 'M' + l.map(([x, y]) => `${f(ox + (x - x0) * sc)} ${f(oy + (y - y0) * sc)}`).join('L') + 'Z')
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${bg}"/><path fill="${fill}" fill-rule="evenodd" d="${d}"/></svg>\n`;
}

// ---- run ----
const report = { files: {}, palette: {} };
const loaded = {};
for (const f of Object.values(FILES).flat()) {
  const img = await raw(f);
  loaded[f] = img;
  const meta = await sharp(path.join(root, f)).metadata();
  report.files[f] = {
    width: meta.width, height: meta.height, format: meta.format, channels: meta.channels, hasAlpha: meta.hasAlpha,
    ihdr: ihdr(f), alpha: alphaHistogram(img), blackUnderAlpha0: pureBlackTransparent(img), dominant: dominant(img),
  };
}

const kLogo = kmeans(loaded[FILES.logoDark], 3, { step: 4 });
const kBanner = kmeans(loaded[FILES.banner], 5, { step: 2 });
const kSlide = kmeans(loaded[FILES.slides[0]], 8, { step: 3 });
const kSlideText = kmeans(loaded[FILES.slides[0]], 12, { step: 2, seed: 11 });
const bright = (arr) => [...arr].sort((a, b) => lum(...b.rgb) - lum(...a.rgb));
const dark = (arr) => [...arr].sort((a, b) => lum(...a.rgb) - lum(...b.rgb));
const sat = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / (Math.max(r, g, b) || 1);

const pick = (c, file, role, method) => ({ role, hex: c.hex, source: file, x: c.x, y: c.y, method });
const named = (arr, h) => { const c = arr.find((x) => x.hex === h); if (!c) throw new Error('palette pick ' + h + ' is no longer a centroid'); return c; };
// roles are chosen from the centroid lists printed in asset-report.json; each pick is asserted to still be a centroid
const P = {
  lime: pick(named(kLogo, '#bff68c'), FILES.logoDark, 'brand mark fill', 'k-means k=3, snapped'),
  leaf: pick(named(kSlide, '#89d042'), FILES.slides[0], '3D mark lit face', 'k-means k=8, snapped'),
  forest: pick(named(kSlide, '#3a6f17'), FILES.slides[0], '3D mark shaded face', 'k-means k=8, snapped'),
  ink: pick(named(kBanner, '#02160a'), FILES.banner, 'page ground', 'k-means k=5, snapped'),
  surface: pick(named(kLogo, '#16211b'), FILES.logoDark, 'panel ground', 'k-means k=3, snapped'),
  line: pick(named(kBanner, '#142d18'), FILES.banner, 'maze stroke', 'k-means k=5, snapped'),
  text: pick(named(kSlideText, '#d4e0d6'), FILES.slides[0], 'body copy', 'k-means k=12, snapped'),
};
report.palette = P;
report.kmeans = { logo: kLogo, banner: kBanner, slide1: kSlide, slide1Text: kSlideText };

for (const [k, v] of Object.entries(P)) {
  const img = loaded[v.source];
  const i = (v.y * img.w + v.x) * 4;
  const got = hex(img.data[i], img.data[i + 1], img.data[i + 2]);
  if (got !== v.hex) throw new Error(`palette ${k} does not match pixel at ${v.x},${v.y}`);
}

const tr = loaded[FILES.logoTransparent];
report.premultiplied = pureBlackTransparent(tr).pureBlack > 0;
if (report.premultiplied) {
  for (const s of [128, 512]) fs.writeFileSync(path.join(genDir, `mark-${s}.png`), await resizePremultiplied(tr, s));
} else {
  for (const s of [128, 512]) await sharp(path.join(root, FILES.logoTransparent)).resize(s, s).png().toFile(path.join(genDir, `mark-${s}.png`));
}
await sharp(path.join(root, FILES.logoDark)).resize(180, 180, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(path.join(genDir, 'apple-touch-icon.png'));
await sharp(path.join(root, FILES.banner)).resize(1200, 630, { fit: 'cover', position: 'centre' }).jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(genDir, 'og.jpg'));
fs.writeFileSync(path.join(genDir, 'favicon.svg'), faviconSvg(loaded[FILES.logoDark], P.lime.hex, P.surface.hex));

fs.writeFileSync(path.join(root, 'src', 'data', 'asset-report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(root, 'src', 'data', 'palette.json'), JSON.stringify({ palette: P }, null, 2));

console.log(JSON.stringify({ palette: P, premultiplied: report.premultiplied, files: Object.fromEntries(Object.entries(report.files).map(([k, v]) => [k, { ihdr: v.ihdr, alpha: v.alpha, black0: v.blackUnderAlpha0.pureBlack, dominant: v.dominant.slice(0, 3) }])) }, null, 1));
