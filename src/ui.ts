export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function svg(body: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

export const icons = {
  add: svg('<path d="M12 5v14M5 12h14"/>'),
  back: svg('<path d="M14.5 6.5 9 12l5.5 5.5"/>'),
  more: svg('<path d="M6 12h.01M12 12h.01M18 12h.01"/><circle cx="6" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1" fill="currentColor" stroke="none"/>'),
  play: svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<path d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z" fill="currentColor" stroke="none"/>'),
  back30: svg('<path d="M11 7.5 6 12l5 4.5"/><path d="M18 7.5 13 12l5 4.5"/>'),
  back15: svg('<path d="M14 7.5 8 12l6 4.5"/>'),
  fwd15: svg('<path d="M10 7.5 16 12l-6 4.5"/>'),
  fwd30: svg('<path d="M6 7.5 11 12l-5 4.5"/><path d="M13 7.5 18 12l-5 4.5"/>'),
  chapters: svg('<path d="M8 6h11M8 12h11M8 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  sleep: svg('<path d="M16 4.5a6.5 6.5 0 1 0 4 11.5A7.5 7.5 0 1 1 16 4.5z"/>'),
  close: svg('<path d="M7 7l10 10M17 7 7 17"/>'),
  check: svg('<path d="M5 12.5 9.2 17 19 7"/>'),
  pdf: svg('<path d="M7 3.5h7l5 5V20.5H7z"/><path d="M14 3.5v5h5"/>'),
  paste: svg('<path d="M9 6.5h6"/><path d="M9 4.5h6a1 1 0 0 1 1 1V7H8V5.5a1 1 0 0 1 1-1z"/><path d="M8 7H6.5A1.5 1.5 0 0 0 5 8.5v11A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 17.5 7H16"/>'),
  trash: svg('<path d="M5 7.5h14"/><path d="M9 7.5V5.8h6V7.5"/><path d="M7.5 7.5l.7 12h7.6l.7-12"/>'),
  download: svg('<path d="M12 4v11"/><path d="M7.5 11.5 12 16l4.5-4.5"/><path d="M5 19.5h14"/>'),
  voice: svg('<path d="M8 10v4M12 7v10M16 10v4"/><path d="M5 12h.01M19 12h.01"/>'),
  edit: svg('<path d="M4 20h4l11-11-4-4L4 16z"/><path d="m13 7 4 4"/>'),
  merge: svg('<path d="M7 7h4v4H7zM13 13h4v4h-4z"/><path d="M11 9h2a3 3 0 0 1 3 3v1"/>'),
  split: svg('<path d="M8 5v14M14 8l4 4-4 4"/>'),
  skip: svg('<path d="M6 7v10M10 12h8"/><path d="m15 9 3 3-3 3"/>'),
  book: svg('<path d="M5 5.5h6.2A2.3 2.3 0 0 1 13.5 7.8V19H7.3A2.3 2.3 0 0 0 5 21.3z"/><path d="M19 5.5h-6.2A2.3 2.3 0 0 0 10.5 7.8V19h6.2A2.3 2.3 0 0 1 19 21.3z"/>'),
  spark: svg('<path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9z"/>'),
  storage: svg('<path d="M5 7.5h14v9H5z"/><path d="M5 11.5h14"/><path d="M8 15h.01"/>'),
  summary: svg('<path d="M7 6h10M7 10h10M7 14h6"/>'),
};

export function iconButton(action: string, label: string, icon: string, attrs = ''): string {
  return `<button type="button" class="icon-btn" data-action="${escapeHtml(action)}" data-tip="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" ${attrs}>${icon}</button>`;
}

let tooltipEl: HTMLDivElement | null = null;
let longTimer = 0;
let suppressClick = false;

function place(target: Element) {
  if (!tooltipEl) return;
  const label = target.getAttribute('data-tip') || target.getAttribute('aria-label') || '';
  if (!label) return;
  tooltipEl.textContent = label;
  tooltipEl.hidden = false;
  const rect = target.getBoundingClientRect();
  const tip = tooltipEl.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tip.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tip.width - 8));
  let top = rect.top - tip.height - 8;
  if (top < 8) top = rect.bottom + 8;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function hideTip() {
  if (tooltipEl) tooltipEl.hidden = true;
}

export function installTooltips(root: ParentNode) {
  if (tooltipEl) return;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';
  tooltipEl.setAttribute('role', 'tooltip');
  tooltipEl.hidden = true;
  document.body.append(tooltipEl);

  root.addEventListener('pointerover', (event) => {
    const target = (event.target as Element | null)?.closest?.('[data-tip]');
    if (!target || (event as PointerEvent).pointerType === 'touch') return;
    place(target);
  });
  root.addEventListener('pointerout', (event) => {
    const target = (event.target as Element | null)?.closest?.('[data-tip]');
    if (target) hideTip();
  });
  root.addEventListener('focusin', (event) => {
    const target = (event.target as Element | null)?.closest?.('[data-tip]');
    if (target) place(target);
  });
  root.addEventListener('focusout', () => hideTip());
  root.addEventListener('pointerdown', (event) => {
    const target = (event.target as Element | null)?.closest?.('[data-tip]');
    if (!target) return;
    window.clearTimeout(longTimer);
    longTimer = window.setTimeout(() => {
      suppressClick = true;
      place(target);
    }, 480);
    const clear = () => {
      window.clearTimeout(longTimer);
      target.removeEventListener('pointerup', clear);
      target.removeEventListener('pointercancel', clear);
      target.removeEventListener('pointerleave', clear);
    };
    target.addEventListener('pointerup', clear);
    target.addEventListener('pointercancel', clear);
    target.addEventListener('pointerleave', clear);
  });
  root.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    },
    true,
  );
  window.addEventListener('scroll', hideTip, true);
}
