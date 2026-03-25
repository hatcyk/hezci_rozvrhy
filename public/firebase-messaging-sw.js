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

console.log('[firebase-messaging-sw.js] Service Worker loaded');
