/**
 * Recovery from the switch to Subresource Integrity of the Firebase SDK.
 *
 * The first load after a deploy is still served by the service worker of the
 * previous version. A worker from before SRI answers the SDK requests with
 * opaque (no-cors) copies, which a script with integrity + crossorigin cannot
 * use, so that page starts without Firebase (the offline fallback). The new
 * worker installs during this load and takes the page over within moments;
 * from then on the SDK comes through it.
 *
 * So, when the SDK is missing, a worker served the page and another one has
 * taken it over since: reload once - but only in the first seconds after the
 * start and before the user did anything. Later, or after any input, the
 * "new version" notice offers the reload instead. The hallway screen
 * (`unattended`) has nobody to tap the notice, so it reloads whenever the
 * takeover comes (still once per tab session). Without a takeover (gstatic
 * down, a wrong hash) nothing changes: the app stays in its fallback mode.
 *
 * The inline <head> script of index.html notes the serving worker, a takeover
 * and the first input in window.__swBoot before this bundle runs.
 */

/** sessionStorage mark of the automatic reload: at most one per tab session. */
export const RELOAD_GUARD_KEY = 'sdkTakeoverReload';

/** Reload by itself only this long after the start of the page (performance.now()). */
export const AUTO_RELOAD_WINDOW_MS = 10_000;

/**
 * Loop guard: true when this tab session may reload by itself, and marks it.
 * Without a sessionStorage that keeps the mark there is no reload at all.
 */
export function claimReload(storage) {
    try {
        if (!storage || storage.getItem(RELOAD_GUARD_KEY)) return false;
        storage.setItem(RELOAD_GUARD_KEY, '1');
        return storage.getItem(RELOAD_GUARD_KEY) === '1';
    } catch {
        return false;
    }
}

/** The SDK is there: a later deploy may recover the same way again. */
export function releaseReload(storage) {
    try {
        if (storage) storage.removeItem(RELOAD_GUARD_KEY);
    } catch { /* storage blocked */ }
}

function sessionStorageOrNull() {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

/**
 * @param {object} deps
 * @param {() => boolean} deps.sdkLoaded   whether the Firebase SDK scripts ran
 * @param {() => void} [deps.showNotice]   offers the reload (#updateBanner)
 * @param {boolean} [deps.unattended]      kiosk: no time window, no input check
 */
export function initSdkRecovery({
    sdkLoaded,
    showNotice,
    unattended = false,
    boot = typeof window !== 'undefined' ? window.__swBoot : undefined,
    sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
    storage = sessionStorageOrNull(),
    now = () => performance.now(),
    reload = () => window.location.reload(),
} = {}) {
    if (sdkLoaded()) {
        releaseReload(storage);
        return;
    }
    // Only a page that a worker served can get the SDK from a newer one.
    if (!sw || !boot || !boot.controller) return;

    let decided = false;
    const recover = () => {
        if (decided) return;
        decided = true;
        const attendedOk = now() <= AUTO_RELOAD_WINDOW_MS && !boot.input;
        if ((unattended || attendedOk) && claimReload(storage)) {
            reload();
            return;
        }
        if (showNotice) showNotice();
    };

    if (boot.takeover || sw.controller !== boot.controller) {
        recover();
        return;
    }
    sw.addEventListener('controllerchange', recover);
}
