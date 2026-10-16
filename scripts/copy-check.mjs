import fs from 'node:fs';
import { visibleCopy, bigrams, vocabulary } from './lib/text.mjs';
const html = fs.readFileSync(process.argv[2] || 'dist/index.html', 'utf8');
const ref = bigrams(fs.readFileSync('src/data/reference-corpus.txt', 'utf8'));
let n = 0;
for (const line of new Set(visibleCopy(html))) {
  const hit = [...bigrams(line)].filter((b) => ref.has(b));
  if (hit.length) { n += hit.length; console.log(`[${hit.join(' | ')}]  <- ${line}`); }
}
console.log('shared bigrams:', n);
