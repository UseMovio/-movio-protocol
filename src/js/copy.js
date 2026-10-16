// Click-to-copy with visible feedback (button state plus a live-region toast).
let toastTimer = 0;

export async function copyText(text, trigger, { doc = document, win = window, label = 'Copied' } = {}) {
  if (!text) return false;
  let ok = false;
  try {
    await win.navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    try {
      const ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      doc.body.append(ta);
      ta.select();
      ok = doc.execCommand('copy');
      ta.remove();
    } catch { ok = false; }
  }
  const toast = doc.querySelector('[data-toast]');
  if (toast) {
    toast.textContent = ok ? label : 'Copy failed, select the text instead';
    toast.classList.add('is-on');
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => toast.classList.remove('is-on'), 1800);
  }
  if (trigger) {
    const txt = trigger.querySelector('.copy-txt');
    const ico = trigger.querySelector('.copy-ico');
    const prevTxt = txt?.textContent;
    const prevIco = ico?.innerHTML;
    trigger.classList.toggle('is-done', ok);
    if (txt && ok) txt.textContent = 'Copied';
    if (ico && ok) ico.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    win.setTimeout(() => {
      trigger.classList.remove('is-done');
      if (txt && prevTxt != null) txt.textContent = prevTxt;
      if (ico && prevIco != null) ico.innerHTML = prevIco;
    }, 1600);
  }
  return ok;
}

/** The contract slot: any element carrying data-copy copies its own value. */
export function initCopy(doc = document, win = window) {
  doc.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-copy]');
    if (!el) return;
    const slot = el.closest('.ca');
    copyText(el.dataset.copy, slot?.querySelector('.ca-copy') ?? el, { doc, win, label: 'Mint copied' });
  });
}
