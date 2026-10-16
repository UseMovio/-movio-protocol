// Build: register -> static page + bundled css/js + assets, written to dist/ (or any outDir inside the project).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { renderPage } from './lib/render.mjs';
import { validateRegister } from './lib/register.mjs';

export const root = path.resolve(import.meta.dirname, '..');

const HEADERS = `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cdn.dexscreener.com; font-src 'self'; connect-src 'self' https://api.dexscreener.com; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/index.html
  Cache-Control: public, max-age=0, must-revalidate
`;

export async function build({ registerPath = path.join(root, 'src/data/register.json'), outDir = path.join(root, 'dist'), register } = {}) {
  const abs = path.resolve(outDir);
  if (!abs.startsWith(root + path.sep)) throw new Error('outDir must live inside the project');
  const reg = register ?? JSON.parse(fs.readFileSync(registerPath, 'utf8'));
  const errors = validateRegister(reg);
  if (errors.length) throw new Error('register invalid:\n  ' + errors.join('\n  '));

  fs.rmSync(abs, { recursive: true, force: true });
  fs.mkdirSync(path.join(abs, 'assets', 'fonts'), { recursive: true });

  const gen = path.join(root, 'src', 'generated');
  const palette = JSON.parse(fs.readFileSync(path.join(root, 'src/data/palette.json'), 'utf8')).palette;
  const tokens = Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, v.hex]));

  const out = await esbuild.build({
    entryPoints: { app: path.join(root, 'src/js/main.js') },
    bundle: true, minify: true, format: 'iife', target: 'es2022', outdir: path.join(abs, 'assets'),
    entryNames: '[name]-[hash]', write: true, metafile: true, logLevel: 'silent',
  });
  const css = await esbuild.build({
    entryPoints: { app: path.join(root, 'src/css/main.css') },
    bundle: true, minify: true, outdir: path.join(abs, 'assets'), entryNames: '[name]-[hash]',
    external: ['*.woff2'], write: true, metafile: true, logLevel: 'silent', target: ['chrome111', 'safari16.4', 'firefox113'],
  });
  const nameOf = (meta, ext) => 'assets/' + path.basename(Object.keys(meta.outputs).find((k) => k.endsWith(ext)));
  const assets = { js: nameOf(out.metafile, '.js'), css: nameOf(css.metafile, '.css') };

  fs.copyFileSync(path.join(root, 'node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2'), path.join(abs, 'assets/fonts/dm-sans.woff2'));
  fs.copyFileSync(path.join(root, 'node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2'), path.join(abs, 'assets/fonts/space-grotesk.woff2'));
  for (const f of ['mark-128.png', 'mark-512.png', 'apple-touch-icon.png', 'og.jpg']) fs.copyFileSync(path.join(gen, f), path.join(abs, 'assets', f));
  fs.copyFileSync(path.join(gen, 'favicon.svg'), path.join(abs, 'favicon.svg'));

  fs.writeFileSync(path.join(abs, 'index.html'), renderPage({ register: reg, tokens, assets }));
  fs.writeFileSync(path.join(abs, '_headers'), HEADERS);
  fs.writeFileSync(path.join(abs, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  return { outDir: abs, assets };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await build();
  console.log('built', path.relative(root, r.outDir), r.assets);
}
