/**
 * "A new version is available" notice.
 *
 * A deploy reaches an open page only half-way: the new service worker installs,
 * takes the page over and removes the old shell cache, but the page keeps
 * running the old bundle until it is loaded again - for an installed app that
 * is resumed from memory that can be days. The page is never reloaded on its
 * own (the user may be in the middle of something); it only offers a reload.
 */

/** Prefix of the shell cache names (public/firebase-messaging-sw.js, tools/build.js). */
const SHELL_PREFIX = 'bakalari-shell-';

/** A visible page asks the server for a newer worker at most this often. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Name of the shell cache that belongs to the bundles this page runs:
 * bakalari-shell-<css hash>-<js hash>, from the ?v= of the two bundles.
 * @returns {string|null} null when the page has no versioned bundles
 */
export function pageShellCache(doc = document) {
    const version = (selector, attr) => {
        const el = doc.querySelector(selector);
        const match = el && /[?&]v=([a-f0-9]+)/.exec(el.getAttribute(attr) || '');
        return match ? match[1] : null;
    };
    const css = version('link[rel="stylesheet"][href*="css/app.css"]', 'href');
    const js = version('script[src*="js/app.js"]', 'src');
    return css && js ? `${SHELL_PREFIX}${css}-${js}` : null;
}

/**
 * The active worker keeps exactly one shell cache, named after its version.
 * When shell caches exist and none is this page's, a newer version took over.
 */
export function isNewerVersionActive(cacheNames, ownCache) {
    if (!ownCache) return false;
    const shells = (cacheNames || []).filter((name) => name.startsWith(SHELL_PREFIX));
    return shells.length > 0 && !shells.includes(ownCache);
}

/**
 * Show #updateBanner once a newer version is active. Checked when the worker
 * that controls the page changes and whenever the page becomes visible again.
 */
export function initUpdateNotice({
    sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
    cacheStorage = typeof caches !== 'undefined' ? caches : undefined,
    doc = document,
    reload = () => window.location.reload(),
    now = () => Date.now(),
} = {}) {
    const banner = doc.getElementById('updateBanner');
    const button = doc.getElementById('updateReload');
    const ownCache = pageShellCache(doc);
    if (!sw || !cacheStorage || !banner || !ownCache) return;

    if (button) button.addEventListener('click', () => reload());

    const check = async () => {
        try {
            if (isNewerVersionActive(await cacheStorage.keys(), ownCache)) banner.classList.remove('hidden');
        } catch (_) { /* cache storage unavailable (private mode): no notice */ }
    };

    let lastUpdateCheck = now();
    const askForUpdate = async () => {
        if (now() - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
        lastUpdateCheck = now();
        try {
            const registration = await sw.getRegistration();
            if (registration) await registration.update();
        } catch (_) { /* offline: next time */ }
    };

    // The new worker controls the page before its activation has finished,
    // i.e. before it removed the older caches - wait for that.
    sw.addEventListener('controllerchange', () => {
        const worker = sw.controller;
        if (!worker || worker.state === 'activated') { check(); return; }
        const onStateChange = () => {
            if (worker.state !== 'activated' && worker.state !== 'redundant') return;
            worker.removeEventListener('statechange', onStateChange);
            check();
        };
        worker.addEventListener('statechange', onStateChange);
    });
    doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState !== 'visible') return;
        check();
        askForUpdate();
    });
}
