/**
 * Notifications Module - Main Entry Point
 * Re-exports all notification functionality from submodules
 */

// Core functionality
export {
    isNotificationSupported,
    initializeMessaging,
    registerServiceWorker,
    requestNotificationPermission,
    disableNotifications,
    loadNotificationPreferences,
    ensureTokenRegistered,
    reconcileLessonReminderToken,
    saveWatchedTimetables
} from './notifications-core.js';

// Modal and UI
export {
    updateNotificationBellUI,
    showNotificationModal,
    closeNotificationModal,
    updateNotificationUIState,
    updateEnableButtonState,
    enableNotifications,
    disableNotificationsHandler,
    initNotificationButton
} from './notifications-modal.js';

// Multiselect dropdown
export {
    populateMultiselectOptions,
    updateMultiselectLabel,
    updateMultiselectCheckboxes,
    toggleMultiselect,
    filterMultiselectOptions,
    setupMultiselectGlobalListeners
} from './notifications-multiselect.js';
