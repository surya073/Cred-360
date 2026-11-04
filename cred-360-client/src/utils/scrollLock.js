// Locks background scrolling whenever any modal / offcanvas overlay is mounted.
// Watches the DOM so every existing overlay is covered without per-component code.
// The lock is the `modal-open` class (see styles/modal.css) on <html> and <body>.

const OVERLAY_SELECTOR = [
  '.modal-overlay',
  '.sa-overlay',
  '.gs-modal-backdrop',
  '.eu-modal-backdrop',
  '.eu-offcanvas-backdrop',
  '.offcanvas-backdrop.open', // always mounted, only "open" when visible
].join(',');

export function initScrollLock() {
  if (typeof document === 'undefined' || window.__scrollLockInit) return;
  window.__scrollLockInit = true;

  const root = document.documentElement;
  let locked = false;

  const sync = () => {
    const shouldLock = !!document.querySelector(OVERLAY_SELECTOR);
    if (shouldLock === locked) return;
    locked = shouldLock;
    root.classList.toggle('modal-open', shouldLock);
    document.body.classList.toggle('modal-open', shouldLock);
  };

  new MutationObserver(sync).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  sync();
}
