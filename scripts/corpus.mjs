// Builds src/data/reference-corpus.txt: every human-readable string the reference site ships
// (html text, js string literals with spaces, css content). Used by the copy-distance gate.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const BASE = 'https://mazerunnerplay.com';
const seen = new Set();
const texts = [];

async function get(p) {
  if (seen.has(p)) return '';
  seen.add(p);
  const r = await fetch(BASE + p, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok) return '';
  return r.text();
}

const html = await get('/');
texts.push(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' '));

const queue = ['/assets/game-cBFpkdyC.js'];
const jsRefs = (src) => [...src.matchAll(/(?:\.\/|assets\/)([A-Za-z0-9_.-]+\.(?:js|css))/g)].map((m) => '/assets/' + m[1]);
while (queue.length) {
  const p = queue.shift();
  const src = await get(p);
  if (!src) continue;
  if (p.endsWith('.js')) {
    for (const m of src.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n]){6,300})\1/g)) {
      const s = m[2];
      if (/\s/.test(s) && /[A-Za-z]{3}/.test(s) && !/[{}();=<>]/.test(s.replace(/<[^>]+>/g, ' '))) texts.push(s);
    }
    for (const m of src.matchAll(/>([^<>{}]{4,200})</g)) if (/[A-Za-z]{3}/.test(m[1])) texts.push(m[1]);
    queue.push(...jsRefs(src).filter((x) => !seen.has(x)));
  } else {
    for (const m of src.matchAll(/content:\s*"([^"]+)"/g)) texts.push(m[1]);
  }
}
const extra = ['Maze Runner The Gardens', 'Take the long way. Explore the overgrown stone gardens of Maze Runner.', 'Welcome to the maze. Choose a character. Learn the controls. Then make your entrance. Choose your character. Practice as Alex. Sign in with X to collect drops and play. Enter Game. Entering the maze. Finding a way in. Controls. Local map. Active drop. Ghost preview. Your X identity. Your photo and linked handle appear above your character. Watch again. Sound off. Your next adventure. Your first run. Pick a runner, then learn the controls in a private practice garden. No account needed until you are ready.'];
const out = [...new Set([...texts, ...extra].map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean))].join('\n');
fs.writeFileSync(path.join(root, 'src/data/reference-corpus.txt'), out);
console.log(`corpus: ${out.split('\n').length} lines, ${out.length} chars, ${seen.size} files`);
