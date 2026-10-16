// Register helpers shared by the build and the gates.
export const STATES = ['stated', 'absent', 'unconfirmed'];

export const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const SOCIAL_HOSTS = {
  x: ['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com', 'mobile.twitter.com'],
  github: ['github.com', 'www.github.com'],
};

/** Handle is derived from the stored URL, never stored itself. */
export function deriveHandle(id, url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (!SOCIAL_HOSTS[id]?.includes(u.hostname.toLowerCase())) return null;
  const seg = u.pathname.split('/').filter(Boolean)[0];
  return seg && /^[A-Za-z0-9_-]{1,39}$/.test(seg) ? seg : null;
}

export function validateRegister(reg) {
  const errors = [];
  const ids = new Set();
  for (const r of reg.records ?? []) {
    if (!r.id || ids.has(r.id)) errors.push(`duplicate or missing id: ${r.id}`);
    ids.add(r.id);
    if (!STATES.includes(r.state)) errors.push(`${r.id}: bad state ${r.state}`);
    if (!r.label) errors.push(`${r.id}: label missing`);
    if (r.state !== 'stated') {
      for (const k of Object.keys(r)) {
        if (['value', 'url', 'handle', 'rpc', 'boosts', 'pairs'].includes(k)) errors.push(`${r.id}: inert record carries ${k}`);
      }
    } else {
      if (!r.source) errors.push(`${r.id}: stated record needs a source`);
      if (r.kind === 'address' && !(BASE58_ADDRESS.test(r.value ?? '') || EVM_ADDRESS.test(r.value ?? ''))) errors.push(`${r.id}: stated address is not address-shaped`);
      if (r.kind === 'social') {
        if (!r.url) errors.push(`${r.id}: stated social needs url`);
        else if (!deriveHandle(r.id, r.url)) errors.push(`${r.id}: url has no derivable handle`);
        if ('handle' in r) errors.push(`${r.id}: handle must be derived, not stored`);
      }
      if (r.kind === 'text' && !r.value) errors.push(`${r.id}: stated text needs value`);
    }
  }
  return errors;
}

/** What the page may know: no dates, no provenance noise, inert records stripped to label + state. */
export function publicRegister(reg) {
  return {
    records: reg.records.map((r) => {
      const out = { id: r.id, label: r.label, kind: r.kind, state: r.state };
      if (r.state === 'stated') {
        for (const k of ['value', 'url', 'boosts', 'pairs']) if (r[k] != null) out[k] = r[k];
        if (r.kind === 'social') out.handle = deriveHandle(r.id, r.url);
      }
      return out;
    }),
  };
}

export const record = (reg, id) => reg.records.find((r) => r.id === id);
