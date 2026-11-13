/**
 * Firebase Messaging Service Worker
 * Required by Firebase Cloud Messaging for background notifications
 */

/* ────────────────────────────────────────────────────────────────────
 * Showing notifications
 *
 * iOS / iPadOS / Safari (WebKit) require every push to end in a visible
 * notification: the subscription is created with userVisibleOnly and WebKit
 * logs "Push event handling completed without showing any notification ...
 * This may trigger removal of the push subscription" when a push event ends
 * without showNotification() (WebKit ServiceWorkerThread.cpp; WebKit blog
 * "Meet Web Push": "Violations of the userVisibleOnly promise will result in a
 * push subscription being revoked").
 *
 * Firebase Messaging 9.22 does not show anything while a page of the app is
 * visible: its push handler posts the message to the page and returns
 * (firebase-messaging-compat.js, onPush: `if (clientList.some(c =>
 * c.visibilityState === 'visible')) return sendMessagePayloadInternalToWindows`).
 * On Apple's push service that silently counts against the subscription, so
 * there this worker shows every push itself (handlePushForWebKit below) and
 * onBackgroundMessage stays out of the way; the page skips its in-app toast
 * for the same push (notifications-core.js), so nothing is shown twice.
 * Other browsers keep the SDK behaviour (toast in the foreground, system
 * notification in the background).
 * ──────────────────────────────────────────────────────────────────── */

/** Push service of Apple (WebKit). Same rule as public/js/platform.js. */
function isApplePushEndpoint(endpoint) {
    if (!endpoint || typeof endpoint !== 'string') return false;
    try {
        const host = new URL(endpoint).hostname;
        return host === 'push.apple.com' || host.endsWith('.push.apple.com');
    } catch (_) {
        return false;
    }
}

async function usesApplePushService() {
    try {
        const sub = await self.registration.pushManager.getSubscription();
        return isApplePushEndpoint(sub && sub.endpoint);
    } catch (_) {
        return false;
    }
}

/**
 * One tag per timetable and week: a newer change notification for the same
 * timetable replaces the older one instead of piling up (data from
 * backend/fcm.js: timetableType, timetableId, scheduleType).
 */
function notificationTag(data = {}) {
    if (data.type === 'timetable_change' && data.timetableType && data.timetableId) {
        return `change_${data.timetableType}_${data.timetableId}_${data.scheduleType || 'Actual'}`;
    }
    return data.type || 'default';
}

function buildNotification(data = {}) {
    const title = data.title || 'Nová notifikace';
    const tag = notificationTag(data);
    return {
        title,
        options: {
            // Use detailed body if available (for expandable notifications on Android)
            body: data.detailedBody || data.body || '',
            icon: data.icon || '/icon-192.png',
            // Monochrome, transparent: Android draws the status-bar badge as a mask
            badge: '/badge-96.png',
            vibrate: [100, 50, 100],
            data,
            requireInteraction: true,
            tag,
            // A new change for the same timetable should alert again, not
            // replace the old notification silently
            renotify: tag.startsWith('change_'),
        },
    };
}

function showFromData(data) {
    const { title, options } = buildNotification(data);
    return self.registration.showNotification(title, options);
}

/** Parse the FCM web push body ({ data: {...}, notification?: {...}, from, ... }). */
function parsePushMessage(event) {
    if (!event || !event.data) return null;
    try {
        return event.data.json();
    } catch (_) {
        return null;
    }
}

async function handlePushForWebKit(event) {
    const message = parsePushMessage(event);
    // Messages with a `notification` part (Firebase console) are shown by the
    // SDK itself; this app's server only sends data messages.
    if (!message || message.notification) return;
    if (!(await usesApplePushService())) return;
    await showFromData(message.data || {});
}

// Registered before the Firebase SDK's own push listener; both run.
self.addEventListener('push', (event) => {
    event.waitUntil(handlePushForWebKit(event));
});

// Import Firebase scripts
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

// Firebase configuration (must match your project)
const firebaseConfig = {
  apiKey: "AIzaSyBEB_6eoR-4xVkyN7ap4MxYsLMS4azeF_0",
  authDomain: "barat-bakalari.firebaseapp.com",
  projectId: "barat-bakalari",
  storageBucket: "barat-bakalari.firebasestorage.app",
  messagingSenderId: "576497158390",
  appId: "1:576497158390:web:33a1349e14200d146a44d7",
  measurementId: "G-PH8HE2CJNQ",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firebase Messaging
const messaging = firebase.messaging();

// Handle background messages (no visible page). On Apple's push service the
// push listener above already showed this message.
messaging.onBackgroundMessage(async (payload) => {
    console.log('[firebase-messaging-sw.js] Received background message:', payload);
    if (await usesApplePushService()) return;
    return showFromData((payload && payload.data) || {});
});

// Build a deep-link path from a notification's data payload so clicking a change
// notification opens the relevant timetable (and day), not the default one.
function deepLinkPathFromData(data = {}) {
    if (data.type === 'timetable_change' && data.timetableType && data.timetableId) {
        const params = new URLSearchParams({
            type: data.timetableType,
            id: data.timetableId,
            schedule: data.scheduleType || 'Actual',
            hl: 'change',
        });
        if (data.day !== undefined && data.day !== null && data.day !== '') {
            params.set('day', String(data.day));
        }
        return `/?${params.toString()}`;
    }
    return '/';
}

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    console.log('[firebase-messaging-sw.js] Notification clicked:', event);

    event.notification.close();

    const path = deepLinkPathFromData(event.notification.data || {});

    event.waitUntil((async () => {
        try {
            const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });

            // If the app is already open, focus it and navigate to the deep link.
            for (const client of clientList) {
                if (client.url.includes(self.location.origin)) {
                    await client.focus();
                    if (path !== '/' && 'navigate' in client) {
                        try { await client.navigate(path); } catch (_) { /* cross-origin/aborted */ }
                    } else if (path !== '/') {
                        // Fallback for browsers without client.navigate
                        client.postMessage({ kind: 'deep-link', path });
                    }
                    return;
                }
            }

            // Otherwise open a new window at the deep link.
            if (clients.openWindow) {
                await clients.openWindow(path);
            }
        } catch (err) {
            console.error('[firebase-messaging-sw.js] notificationclick failed:', err);
        }
    })());
});

/* ────────────────────────────────────────────────────────────────────
 * App-shell caching (offline support)
 * Bump SHELL_CACHE version whenever the precache list changes.
 * ──────────────────────────────────────────────────────────────────── */
const SHELL_CACHE = 'bakalari-shell-c7e3004056-ca0926878d';

// Cross-origin scripts the app needs to boot. Cached as opaque responses
// (status 0) so that offline loads still have the Firebase SDK available.
const CROSS_ORIGIN_PRECACHE = [
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js',
];
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/manifest.webmanifest',
    '/favicon.png',
    '/icon-180.png',
    '/icon-192.png',
    '/icon-512.png',
    '/icon-maskable-512.png',
    '/badge-96.png',
    '/spsd_logo_dark.png',
    '/spsd_logo_white.png',
    '/spsd_long_dark.png',
    '/spsd_long_white.png',
    '/css/app.css?v=c7e3004056',
    '/js/app.js?v=ca0926878d',
];

self.addEventListener('install', (event) => {
    console.log('[firebase-messaging-sw.js] Install — precaching app shell');
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);

        // Same-origin precache (atomic, forces fresh network fetch)
        try {
            await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
        } catch (err) {
            console.warn('[sw] Same-origin precache failed:', err);
        }

        // Cross-origin precache (Firebase SDK). no-cors yields opaque responses
        // which cache.addAll rejects, so we put them one-by-one.
        await Promise.all(CROSS_ORIGIN_PRECACHE.map(async (url) => {
            try {
                const response = await fetch(url, { mode: 'no-cors', cache: 'reload' });
                await cache.put(url, response);
            } catch (err) {
                console.warn(`[sw] Cross-origin precache failed for ${url}:`, err);
            }
        }));

        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) => Promise.all(
            names
                .filter((n) => n.startsWith('bakalari-shell-') && n !== SHELL_CACHE)
                .map((n) => caches.delete(n))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Firebase SDK served from gstatic — cache-first so it boots offline.
    if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) {
        event.respondWith((async () => {
            const cache = await caches.open(SHELL_CACHE);
            const cached = await cache.match(request);
            if (cached) return cached;
            try {
                const response = await fetch(request, { mode: 'no-cors' });
                cache.put(request, response.clone()).catch(() => { /* ignore */ });
                return response;
            } catch (err) {
                return cached || Response.error();
            }
        })());
        return;
    }

    // Ignore other cross-origin requests (Firestore, analytics, etc.)
    if (url.origin !== self.location.origin) return;

    // Don't intercept backend API calls (auth, status) — these must be live.
    if (url.pathname.startsWith('/api/')) return;

    // Navigations (the app shell): network-first so a fresh deploy is picked up
    // on the very next load; the cached shell is only used when offline. The
    // query string (deep links like /?type=...&id=...) is ignored for the
    // cache lookup so the shell is still served offline.
    if (request.mode === 'navigate') {
        event.respondWith(
            caches.open(SHELL_CACHE).then(async (cache) => {
                try {
                    const response = await fetch(request);
                    if (response && response.status === 200 && response.type === 'basic') {
                        cache.put(request, response.clone()).catch(() => { /* ignore quota errors */ });
                    }
                    return response;
                } catch (err) {
                    const cached = await cache.match(request, { ignoreSearch: true });
                    return cached || Response.error();
                }
            })
        );
        return;
    }

    // Everything else (versioned bundles, icons): stale-while-revalidate.
    event.respondWith(
        caches.open(SHELL_CACHE).then(async (cache) => {
            const cached = await cache.match(request);
            const network = fetch(request).then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    cache.put(request, response.clone()).catch(() => { /* ignore quota errors */ });
                }
                return response;
            }).catch(() => cached);

            return cached || network;
        })
    );
});

console.log('[firebase-messaging-sw.js] Service Worker loaded');
