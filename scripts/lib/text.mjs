// Visible-copy extraction and n-gram helpers shared by gates.
import { JSDOM } from 'jsdom';

const words = (s) => s.toLowerCase().replace(/[\u2019']/g, '').split(/[^a-z0-9]+/).filter(Boolean);

export function bigrams(text) {
  const out = new Set();
  // bigrams never span a line, so every string is its own run
  for (const line of text.split('\n')) {
    const w = words(line);
    for (let i = 0; i < w.length - 1; i++) out.add(w[i] + ' ' + w[i + 1]);
  }
  return out;
}

export const vocabulary = (text) => new Set(words(text));

/** Everything a visitor can read or hear: text nodes, alt, title, aria-label, placeholder, meta description. */
export function visibleCopy(html) {
  const dom = new JSDOM(html);
  const d = dom.window.document;
  d.querySelectorAll('script, style, noscript').forEach((n) => n.remove());
  const lines = [];
  const walk = (n) => {
    if (n.nodeType === 3) { const t = n.textContent.replace(/\s+/g, ' ').trim(); if (t) lines.push(t); return; }
    if (n.nodeType !== 1) return;
    for (const a of ['alt', 'title', 'aria-label', 'placeholder']) { const v = n.getAttribute(a); if (v) lines.push(v); }
    n.childNodes.forEach(walk);
  };
  walk(d.body);
  const t = d.querySelector('title')?.textContent; if (t) lines.push(t);
  d.querySelectorAll('meta[name=description], meta[property="og:description"], meta[property="og:title"]').forEach((m) => lines.push(m.getAttribute('content')));
  return lines;
}

export function attributesOf(html) {
  const dom = new JSDOM(html);
  const out = [];
  dom.window.document.querySelectorAll('*').forEach((n) => { for (const a of n.attributes) out.push({ tag: n.tagName.toLowerCase(), name: a.name, value: a.value }); });
  return out;
}
