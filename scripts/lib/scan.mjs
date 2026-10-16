// Address-shaped string scanner (gate warning). It matches candidates against the stated registry
// instead of rejecting every 0x hex string on sight.
import { record } from './register.mjs';

export const EVM_RUN = /\b0x[a-fA-F0-9]{40}\b/g;
export const B58_RUN = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

export const statedAddresses = (reg) =>
  new Set(reg.records.filter((r) => r.kind === 'address' && r.state === 'stated' && r.value).map((r) => r.value));

export function scanAddresses(text, reg) {
  const ok = statedAddresses(reg);
  const found = [...(text.match(EVM_RUN) || []), ...(text.match(B58_RUN) || [])];
  return { found, unregistered: found.filter((a) => !ok.has(a)) };
}

export { record };
