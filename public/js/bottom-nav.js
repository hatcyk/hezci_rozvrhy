/**
 * Bottom Navigation Bar (Mobile Only)
 */

import { showNotificationModal } from './notifications-modal.js';
import { showSettingsModal } from './settings.js';

export function initBottomNav() {
    const btnNotifications = document.getElementById('bottomNavNotifications');
    const btnSettings = document.getElementById('bottomNavSettings');

    if (btnNotifications) {
        btnNotifications.addEventListener('click', showNotificationModal);
    }

    if (btnSettings) {
        btnSettings.addEventListener('click', showSettingsModal);
    }
}

/**
 * Sync notification button disabled state with the bell in header
 */
export function updateBottomNavNotifState(enabled) {
    const btn = document.getElementById('bottomNavNotifications');
    if (btn) {
        btn.classList.toggle('disabled', !enabled);
        btn.title = enabled ? 'Notifikace zapnuty' : 'Notifikace vypnuty';
    }
}
