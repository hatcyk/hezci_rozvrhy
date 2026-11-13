/**
 * Platform detection helpers (pure functions, unit-tested in Node).
 */

/**
 * iPhone / iPod / iPad, including iPadOS 13+ which reports itself as a Mac
 * ("Macintosh") in Safari's default desktop mode. A real Mac has no
 * multi-touch screen, so maxTouchPoints > 1 tells the two apart.
 * Web push on these devices works only for a web app added to the Home Screen.
 * @param {string} [userAgent]
 * @param {number} [maxTouchPoints]
 */
export function isIOSDevice(
    userAgent = (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    maxTouchPoints = (typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0)
) {
    const ua = String(userAgent || '');
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    return /Macintosh/.test(ua) && Number(maxTouchPoints) > 1;
}

/**
 * Push subscription served by Apple's push service (Safari / WebKit on iOS,
 * iPadOS and macOS). There every push must end in a system notification, so
 * the service worker shows it even when the app is open (see
 * firebase-messaging-sw.js) and the page must not add a second, in-app toast.
 * Same rule as isApplePushEndpoint() in the service worker.
 * @param {string|null|undefined} endpoint - PushSubscription.endpoint
 */
export function isApplePushEndpoint(endpoint) {
    if (!endpoint || typeof endpoint !== 'string') return false;
    try {
        const host = new URL(endpoint).hostname;
        return host === 'push.apple.com' || host.endsWith('.push.apple.com');
    } catch {
        return false;
    }
}
