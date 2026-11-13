import { initDOM, dom } from './dom.js';
import { state, updateState } from './state.js';
import { initTheme, initThemeToggle } from './theme.js';
import { initModalListeners } from './modal.js';
import { loadTimetable, populateValueSelect } from './timetable.js';
import { fetchDefinitions, fetchBackendStatus } from './api.js';
import { initCustomDropdown, setDropdownValue, openDropdown } from './dropdown.js';
import { buildTeacherAbbreviationMap, shouldAutoSwitchToNextWeek, setPressed } from './utils.js';
import { initSunData } from './suntime.js';
import { initializeFirebase, authenticateWithFirebase, getLastUpdateTime, isFirebaseSdkLoaded, FIREBASE_UNAVAILABLE_MESSAGE } from './firebase-client.js';
import { registerServiceWorker, initializeMessaging, reconcileLessonReminderToken, initNotificationButton, closeNotificationModal, enableNotifications, disableNotificationsHandler } from './notifications.js';
import { initSettings } from './settings.js';
import { initRefresh } from './refresh.js';
import { loadFavorites } from './favorites.js';
import { initFavoritesModal } from './favorites-modal.js';
import { initLayoutSystem, initResizeListener } from './layout-manager.js';
import { initOfflineDetection, outageBannerText } from './offline.js';
import { parseDeepLinkParams, applyDeepLink } from './deeplink.js';
import { debug } from './debug.js';
import { initNextLessonWidget, refreshNextLessonWidget } from './next-lesson.js';
import { initLessonStatusUpdates } from './lesson-status.js';
import { parseRoute } from './view-route.js';
import { initViewRouter, onViewEnter, showView } from './view-router.js';
import { initTimetableTools } from './timetable-tools.js';
import { applyLayout } from './layout-manager.js';

/**
 * Register the views behind the navigation. They are imported on first use:
 * the code is in the same bundle, but nothing of it runs for a user who only
 * ever looks at the timetable.
 */
function initViews() {
    onViewEnter('timetable', async () => {
        // Back from another view: re-render (layouts measure the container,
        // which had no size while hidden) and catch up on the widget
        if (state.currentTimetableData && state.currentTimetableData.length) {
            await applyLayout();
            refreshNextLessonWidget();
        }
    });
    onViewEnter('changes', async (params) => (await import('./changes-view.js')).enterChangesView(params));
    onViewEnter('rooms', async (params) => (await import('./rooms-view.js')).enterRoomsView(params));
    onViewEnter('common', async (params) => (await import('./common-view.js')).enterCommonView(params));
    initViewRouter();
    initTimetableTools({ applyLayout });
}

/**
 * Hallway screen (?kiosk=changes): only what the board needs - sign-in for
 * Firestore and the service worker for offline start. No messaging, no
 * notification prompts, no favourites, no panels.
 */
async function initKiosk() {
    initDOM();
    initOfflineDetection();
    // Dark board on a TV: less glare in a corridor; not saved as the user's theme
    document.documentElement.setAttribute('data-theme', 'dark');
    try {
        await initializeFirebase(window.firebaseConfig);
        try { await authenticateWithFirebase(); } catch (err) { console.warn('Kiosk: auth failed, using cached data', err?.message || err); }
    } catch (err) {
        console.warn('Kiosk: Firebase unavailable, using cached data', err?.message || err);
    }
    registerServiceWorker().catch(err => console.error('Service Worker registration failed:', err));
    const { startKiosk } = await import('./kiosk.js');
    startKiosk();
}

/**
 * Listen for deep-link messages from the service worker (fallback for browsers
 * where client.navigate isn't available on notification click).
 */
function initServiceWorkerMessages() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data;
        if (data && data.kind === 'deep-link' && data.path) {
            const link = parseDeepLinkParams(new URL(data.path, location.origin).search);
            if (link) applyDeepLink(link).catch(err => console.error('Deep link failed:', err));
        }
    });
}

/**
 * Cleanup old Service Workers (especially sw.js)
 * Prevents duplicate notifications from multiple SW
 */
async function cleanupOldServiceWorkers() {
    try {
        if (!('serviceWorker' in navigator)) {
            return;
        }

        const registrations = await navigator.serviceWorker.getRegistrations();
        let cleanedCount = 0;
        const oldSWs = [];

        for (const registration of registrations) {
            const scriptURL = registration.active?.scriptURL || '';

            // Remove any SW that is NOT firebase-messaging-sw.js
            if (scriptURL && !scriptURL.includes('firebase-messaging-sw.js')) {
                console.log(`🗑️ Cleaning up old Service Worker: ${scriptURL}`);
                oldSWs.push(scriptURL);
                await registration.unregister();
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`✅ Cleaned up ${cleanedCount} old Service Worker(s):`, oldSWs);
            console.warn('⚠️ Stránka bude obnovena pro dokončení změn...');

            // Force reload after cleanup to ensure SW changes take effect
            setTimeout(() => {
                console.log('🔄 Reloading aplikace...');
                window.location.reload();
            }, 1000);
        }
    } catch (error) {
        console.error('❌ Failed to cleanup Service Workers:', error);
    }
}

/**
 * Show or hide the "data are stale" banner from /api/status (contract S4:
 * isHealthy + dataAgeMin + lastSuccessAt). An older backend without those
 * fields falls back to the metadata/lastPrefetch timestamp in Firestore.
 */
async function applyBackendStatus(status) {
    if (!dom.outageBanner) return;
    if (status.isHealthy) {
        if (!dom.outageBanner.classList.contains('hidden')) console.log('✅ Data are fresh again - hiding outage banner');
        dom.outageBanner.classList.add('hidden');
        return;
    }

    let info = status;
    if (status.dataAgeMin === null && !status.lastSuccessAt) {
        try {
            const lastUpdate = await getLastUpdateTime();
            if (lastUpdate && lastUpdate.seconds) {
                info = { ...status, lastSuccessAt: new Date(lastUpdate.seconds * 1000).toISOString() };
            }
        } catch (error) {
            console.error('Failed to get last update time:', error);
        }
    }
    const textElement = document.getElementById('outageBannerText');
    if (textElement) textElement.textContent = outageBannerText(info);
    dom.outageBanner.classList.remove('hidden');
}

// Type button handlers
function updateTypeButtons() {
    setPressed(dom.typeButtons, btn => btn.dataset.type === state.selectedType);
}

function initTypeButtons() {
    if (!dom.typeButtons) return;

    dom.typeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const wasTypeChanged = state.selectedType !== btn.dataset.type;

            updateState('selectedType', btn.dataset.type);
            updateTypeButtons();
            populateValueSelect();

            // Clear dropdown display when switching types
            setDropdownValue('', 'Vyberte...');

            // Auto-open dropdown only when switching types manually (clicking the button)
            // Don't open when coming from modal where value is already pre-selected
            if (wasTypeChanged) {
                setTimeout(() => openDropdown(), 100);
            }
        });
    });
}

// Schedule type button handlers
function updateScheduleTypeButtons() {
    setPressed(dom.scheduleTypeButtons, btn => btn.dataset.schedule === state.selectedScheduleType);
}

function initScheduleTypeButtons() {
    if (!dom.scheduleTypeButtons) return;

    dom.scheduleTypeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            updateState('selectedScheduleType', btn.dataset.schedule);
            updateScheduleTypeButtons();
            loadTimetable();
        });
    });
}

// Value select handler (now handled by custom dropdown)
// The custom dropdown will call loadTimetable on selection

// Initialize application
async function init() {
    const route = parseRoute();
    if (route.kiosk) {
        try { await initKiosk(); } catch (e) { console.error('Kiosk initialization error:', e); }
        return;
    }
    try {
        // Initialize DOM references first
        initDOM();

        // Initialize offline detection early so the banner can show during boot
        initOfflineDetection();

        // Initialize theme
        initTheme();
        initThemeToggle();

        // Initialize layout system
        initLayoutSystem();
        initResizeListener();

        // Initialize Firebase. Both SDK init and auth require network; if they
        // fail (e.g. offline, Firebase SDK script not in SW cache), the app
        // still boots and falls back to localStorage cache.
        console.log('Initializing Firebase...');
        try {
            await initializeFirebase(window.firebaseConfig);
            try {
                // Before any Firestore read or per-user API call (contract S1)
                await authenticateWithFirebase();
                console.log('Firebase ready!');
            } catch (authErr) {
                console.warn('⚠️ Firebase auth failed — offline fallback mode:', authErr?.message || authErr);
            }
        } catch (initErr) {
            console.warn('⚠️ Firebase init failed — offline fallback mode:', initErr?.message || initErr);
        }

        // Cleanup old Service Workers before initializing new ones
        await cleanupOldServiceWorkers();

        // Initialize Service Worker and Notifications
        registerServiceWorker().catch(err => console.error('Service Worker registration failed:', err));
        initializeMessaging().catch(err => console.error('Firebase Messaging initialization failed:', err));

        // Re-sync the FCM token for users who have lesson reminders enabled but
        // lost (or never saved) their token — and flag the case the modal warns
        // about. Non-blocking; runs after messaging init has had a chance to set up.
        reconcileLessonReminderToken().catch(err => console.error('Reminder token reconcile failed:', err));

        // Initialize sun data (async, doesn't block)
        initSunData().catch(err => console.error('Failed to load sun data:', err));

        // Initialize modal listeners with error handling
        initModalListeners();

        // Initialize custom dropdown
        initCustomDropdown(loadTimetable);

        // Fetch definitions and check data freshness in parallel
        const [definitions, backendStatus] = await Promise.all([
            fetchDefinitions(),
            fetchBackendStatus(),
            loadFavorites()
        ]);

        updateState('definitions', definitions);

        await applyBackendStatus(backendStatus);

        // Periodically check data freshness (every 2 minutes)
        setInterval(async () => {
            if (document.visibilityState === 'hidden') return; // no point polling a hidden tab
            await applyBackendStatus(await fetchBackendStatus());
        }, 2 * 60 * 1000); // Check every 2 minutes

        // Expose state and dom to window for debugging (only in debug mode)
        if (typeof window !== 'undefined' && debug.isEnabled()) {
            window.debugState = state;
            window.debugDom = dom;
        }

        // Build teacher abbreviation map with collision detection
        const abbreviationMap = buildTeacherAbbreviationMap(definitions.teachers || []);
        updateState('teacherAbbreviationMap', abbreviationMap);

        // Populate value select
        populateValueSelect();

        // Initialize event listeners
        initTypeButtons();
        initScheduleTypeButtons();
        initNotificationButton();
        initSettings();
        initFavoritesModal();
        initRefresh();
        initNextLessonWidget();
        initLessonStatusUpdates();

        // Initialize notification modal listeners
        if (dom.notificationModalClose) {
            dom.notificationModalClose.addEventListener('click', closeNotificationModal);
        }
        if (dom.notificationToggleEnable) {
            dom.notificationToggleEnable.addEventListener('click', enableNotifications);
        }
        if (dom.notificationToggleDisable) {
            dom.notificationToggleDisable.addEventListener('click', disableNotificationsHandler);
        }
        if (dom.reminderWarningEnableBtn) {
            dom.reminderWarningEnableBtn.addEventListener('click', enableNotifications);
        }

        // React to deep-link navigations sent by the SW after this page is loaded
        initServiceWorkerMessages();

        // Views (changes, free rooms, common free time) + timetable toolbar
        initViews();

        // If we were opened from a notification deep link (/?type=...&id=...),
        // honor it instead of the saved/default selection.
        const deepLink = parseDeepLinkParams();
        if (deepLink) {
            console.log('🔗 Opening from notification deep link:', deepLink);
            await showView('timetable', {}, { history: 'none', focus: false });
            await applyDeepLink(deepLink);
            // Clean the URL so a refresh doesn't re-trigger the deep link.
            history.replaceState(null, '', location.pathname);
            return;
        }

        // /?view=changes|rooms|common (manifest shortcuts, shared links): show
        // that view right away; the saved timetable still loads below so the
        // "Rozvrh" tab is ready when the user switches to it.
        await showView(route.view, route.params, { history: route.view === 'timetable' ? 'none' : 'replace', focus: false });

        // Restore saved selection
        const savedType = localStorage.getItem('selectedType');
        const savedValue = localStorage.getItem('selectedValue');

        // Check if we should auto-switch to next week (Friday afternoon)
        if (shouldAutoSwitchToNextWeek() && state.selectedScheduleType === 'actual') {
            console.log('Friday afternoon detected - auto-switching to next week');
            updateState('selectedScheduleType', 'next');
            updateScheduleTypeButtons();
        }

        if (savedType && savedValue) {
            updateState('selectedType', savedType);
            updateTypeButtons();
            populateValueSelect();
            setDropdownValue(savedValue);
            await loadTimetable();
        } else {
            // Default to class ZL
            updateState('selectedType', 'Class');
            updateTypeButtons();
            populateValueSelect();
            setDropdownValue('ZL');
            await loadTimetable();
        }

    } catch (e) {
        console.error('Initialization error:', e);
        if (dom.errorDiv) {
            // Without the Firebase SDK (blocked script, no connection on first
            // visit) say what to do instead of a generic failure
            dom.errorDiv.textContent = isFirebaseSdkLoaded()
                ? 'Nepodařilo se načíst rozvrhy. Zkuste stránku obnovit.'
                : FIREBASE_UNAVAILABLE_MESSAGE;
            dom.errorDiv.classList.remove('hidden');
        }
    }
}

// Mark the requested view on <html> as soon as the bundle runs - before the
// awaits in init() - so CSS hides the timetable controls of a /?view= link
// instead of flashing them. (Not in the inline <head> script: its CSP hash
// lives in vercel.json, see tools/csp-hashes.js.)
(function markInitialView() {
    const route = parseRoute();
    document.documentElement.dataset.view = route.view;
    if (route.kiosk) {
        document.documentElement.dataset.kiosk = route.kiosk;
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();

// Start application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
