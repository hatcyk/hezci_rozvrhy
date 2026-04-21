/**
 * Firebase Messaging Service Worker
 * Required by Firebase Cloud Messaging for background notifications
 */

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

// Handle background messages
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message:', payload);

    const notificationTitle = payload.data?.title || 'Nová notifikace';

    // Use detailed body if available (for expandable notifications on Android)
    const body = payload.data?.detailedBody || payload.data?.body || '';

    const notificationOptions = {
        body: body,
        icon: payload.data?.icon || '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [100, 50, 100],
        data: payload.data || {},
        requireInteraction: true,
        tag: payload.data?.type || 'default',
        // Android will automatically make long text expandable
        // iOS shows first ~2 lines, expandable on long press
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    console.log('[firebase-messaging-sw.js] Notification clicked:', event);

    event.notification.close();

    // Open or focus the app
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // If app is already open, focus it
                for (const client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        return client.focus();
                    }
                }

                // Otherwise, open new window
                if (clients.openWindow) {
                    return clients.openWindow('/');
                }
            })
    );
});

/* ────────────────────────────────────────────────────────────────────
 * App-shell caching (offline support)
 * Bump SHELL_CACHE version whenever the precache list changes.
 * ──────────────────────────────────────────────────────────────────── */
const SHELL_CACHE = 'bakalari-shell-v1';
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/manifest.webmanifest',
    '/favicon.ico',
    '/icon-180.png',
    '/icon-192.png',
    '/icon-512.png',
    '/spsd_logo_dark.png',
    '/spsd_logo_white.png',
    '/spsd_long_dark.png',
    '/spsd_long_white.png',
    '/css/main.css',
    '/css/theme-warning.css',
    '/css/notifications.css',
    '/css/settings.css',
    '/css/layout-modal.css',
    '/css/layout-card-view.css',
    '/css/layout-compact-list.css',
    '/css/outage.css',
    '/css/footer.css',
    '/css/favorites.css',
    '/css/variables.css',
    '/css/base.css',
    '/css/header.css',
    '/css/timetable.css',
    '/css/lesson-card.css',
    '/css/modal.css',
    '/css/offline.css',
    '/css/mobile.css',
    '/css/bottom-sheet.css',
    '/css/agenda-layout.css',
    '/css/bottom-nav.css',
    '/css/navigation.css',
    '/js/main.js',
    '/js/api.js',
    '/js/bottom-nav.js',
    '/js/bottom-sheet.js',
    '/js/cache.js',
    '/js/constants.js',
    '/js/debug.js',
    '/js/dom.js',
    '/js/dropdown.js',
    '/js/favorites-modal.js',
    '/js/favorites.js',
    '/js/firebase-client.js',
    '/js/layout-manager.js',
    '/js/layout-registry.js',
    '/js/layout-renderers.js',
    '/js/modal.js',
    '/js/navigation.js',
    '/js/notifications-core.js',
    '/js/notifications-modal.js',
    '/js/notifications-multiselect.js',
    '/js/notifications-preferences.js',
    '/js/notifications.js',
    '/js/offline.js',
    '/js/refresh.js',
    '/js/settings.js',
    '/js/state.js',
    '/js/suntime.js',
    '/js/theme.js',
    '/js/timetable.js',
    '/js/utils.js',
];

self.addEventListener('install', (event) => {
    console.log('[firebase-messaging-sw.js] Install — precaching app shell');
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' }))))
            .catch((err) => console.warn('[sw] Precache failed:', err))
            .then(() => self.skipWaiting())
    );
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

    // Only handle same-origin GETs. Let Firebase SDK, Firestore, analytics, etc. pass through.
    if (url.origin !== self.location.origin) return;

    // Don't intercept backend API calls (auth, status) — these must be live.
    if (url.pathname.startsWith('/api/')) return;

    // Stale-while-revalidate: respond from cache, update cache in background.
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
