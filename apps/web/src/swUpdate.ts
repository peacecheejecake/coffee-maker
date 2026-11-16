/**
 * Keeps an open web app on the latest deploy (production web only; the native shell bundles its own copy).
 *
 * A new service worker waits while any tab of the old version is open, and an open tab never asks for one,
 * so without this people kept seeing the old screens until every window was closed. Here an open tab asks
 * for a new version every ten minutes and whenever it comes back to the foreground. Once one is installed, the
 * page switches to it and reloads at the first moment that loses nothing: no sheet open and nothing being
 * typed, or the app out of sight.
 */

// Phones mostly catch a deploy on coming back to the app; the timer is for screens left open (desktop tabs,
// /tv), where a few minutes late is fine. A check is one conditional request (304 when nothing changed).
const CHECK_EVERY_MS = 10 * 60_000;
const RETRY_SAFE_MS = 2_000;

/** True when reloading now would throw away what someone is doing on screen. */
export function busy(doc: Document = document): boolean {
  if (doc.visibilityState === 'hidden') return false;
  if (doc.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  const el = doc.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);
}

/** Runs `apply` as soon as `isBusy` says it is safe: right away, after a short wait, or when the page is hidden. */
export function whenSafe(apply: () => void, isBusy: () => boolean = busy, doc: Document = document): () => void {
  let done = false;
  const run = () => {
    if (done || isBusy()) return;
    done = true;
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', run);
    apply();
  };
  const timer = setInterval(run, RETRY_SAFE_MS);
  doc.addEventListener('visibilitychange', run);
  run();
  return () => {
    done = true;
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', run);
  };
}

export function registerServiceWorker() {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    let scheduled = false;
    const updateSW = registerSW({
      immediate: true,
      // A new version is installed and waiting: activate it (SKIP_WAITING) and reload once it controls the page.
      onNeedRefresh() {
        if (scheduled) return;
        scheduled = true;
        whenSafe(() => void updateSW(true));
      },
      onRegisteredSW(_url, registration) {
        if (!registration) return;
        const check = () => {
          if (document.visibilityState !== 'visible' || !navigator.onLine) return;
          registration.update().catch(() => {
            // Offline or the server is mid-deploy; the next check tries again.
          });
        };
        setInterval(check, CHECK_EVERY_MS);
        document.addEventListener('visibilitychange', check);
        addEventListener('online', check);
      },
    });
  });
}
