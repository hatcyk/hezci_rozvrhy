/**
 * Notifications Modal Module
 * Handles notification modal UI and state management
 */

import { state, updateState } from './state.js';
import { dom } from './dom.js';
import { isIOS, isStandalone, requestNotificationPermission, disableNotifications, loadNotificationPreferences } from './notifications-core.js';
import { populateMultiselectOptions, updateMultiselectLabel, updateMultiselectCheckboxes, filterFlatList } from './notifications-multiselect.js';
import { renderSelectedTimetablesPreferences, renderTimetablePreferencesView } from './notifications-preferences.js';
import { debug } from './debug.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';

// Track which view is currently shown in the notification sheet
let currentNotifView = 'list';

/**
 * Update notification bell button UI
 */
export function updateNotificationBellUI() {
    if (!dom.notificationBell) return;

    if (state.notificationsEnabled) {
        dom.notificationBell.classList.remove('disabled');
        dom.notificationBell.setAttribute('title', 'Notifikace zapnuty');
    } else {
        dom.notificationBell.classList.add('disabled');
        dom.notificationBell.setAttribute('title', 'Notifikace vypnuty');
    }
}

/**
 * Show notification settings modal
 */
export function showNotificationModal() {
    if (!dom.notificationModal) return;

    // Always start at list view
    showNotifListView();

    // Load preferences and update UI
    initializeModal();

    openBottomSheet('notificationModal', { fullHeight: true });
}

/**
 * Close notification settings modal (context-aware: back in prefs view, close in list view)
 */
export function closeNotificationModal() {
    if (currentNotifView === 'preferences') {
        showNotifListView();
    } else {
        closeBottomSheet('notificationModal');
    }
}

/**
 * Navigate to list view
 */
export function showNotifListView() {
    currentNotifView = 'list';

    const views = document.getElementById('notifViews');
    const titleList = document.querySelector('.notif-title-list');
    const titlePrefs = document.querySelector('.notif-title-prefs');

    if (views) views.classList.remove('notif-prefs-open');
    if (titleList) titleList.style.display = '';
    if (titlePrefs) titlePrefs.style.display = 'none';

    const sheet = document.getElementById('notificationModal');
    if (sheet) sheet.scrollTop = 0;
}

/**
 * Navigate to per-timetable preferences view
 */
export function showNotifPreferencesView(type, id, name) {
    currentNotifView = 'preferences';

    const views = document.getElementById('notifViews');
    const titleList = document.querySelector('.notif-title-list');
    const titlePrefs = document.querySelector('.notif-title-prefs');
    const prefsContainer = document.getElementById('notifPreferencesContainer');

    // Render preferences before sliding in (so content is ready)
    if (prefsContainer) {
        renderTimetablePreferencesView(type, id, prefsContainer);
    }

    if (titleList) titleList.style.display = 'none';
    if (titlePrefs) {
        titlePrefs.textContent = name;
        titlePrefs.style.display = '';
    }

    // Slide to preferences view and scroll sheet to top
    if (views) views.classList.add('notif-prefs-open');
    const sheet = document.getElementById('notificationModal');
    if (sheet) sheet.scrollTop = 0;
}

/**
 * Initialize modal - ONLY called when modal is opened
 */
async function initializeModal() {
    // Show/hide iOS warning
    const isIosNotStandalone = isIOS() && !isStandalone();
    if (dom.iosWarning) {
        dom.iosWarning.style.display = isIosNotStandalone ? 'block' : 'none';
    }

    // Populate dropdown options
    populateMultiselectOptions();

    // Load preferences from server
    await loadNotificationPreferences();

    // Update UI based on loaded state
    updateMultiselectCheckboxes();
    updateMultiselectLabel();
    renderSelectedTimetablesPreferences();
    updateNotificationUIState();
}

/**
 * Update UI state based on notification enabled/disabled
 */
export function updateNotificationUIState() {
    const flatList = document.getElementById('flatTimetableList');

    if (state.notificationsEnabled) {
        // Notifications are ON - show disable button, disable list
        if (dom.notificationToggleEnable) dom.notificationToggleEnable.style.display = 'none';
        if (dom.notificationToggleDisable) dom.notificationToggleDisable.style.display = 'block';
        if (flatList) flatList.classList.add('disabled');
    } else {
        // Notifications are OFF - show enable button, enable list
        if (dom.notificationToggleEnable) dom.notificationToggleEnable.style.display = 'block';
        if (dom.notificationToggleDisable) dom.notificationToggleDisable.style.display = 'none';
        if (flatList) flatList.classList.remove('disabled');

        // Update enable button state based on selection
        updateEnableButtonState();
    }

    // Update bell icon
    updateNotificationBellUI();
}

/**
 * Update enable button state based on watched timetables
 */
export function updateEnableButtonState() {
    if (!dom.notificationToggleEnable) return;

    const hasSelection = state.watchedTimetables && state.watchedTimetables.length > 0;

    if (hasSelection) {
        dom.notificationToggleEnable.disabled = false;
    } else {
        dom.notificationToggleEnable.disabled = true;
    }
}

/**
 * Enable notifications handler
 */
export async function enableNotifications() {
    const button = dom.notificationToggleEnable;
    if (!button) return;

    // Prevent multiple simultaneous clicks
    if (button.disabled) return;

    // Check if at least one timetable is selected
    if (!state.watchedTimetables || state.watchedTimetables.length === 0) {
        alert('Nejdřív vyberte alespoň jeden rozvrh ke sledování.');
        return;
    }

    // Disable button during processing to prevent spam clicks
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Zpracovávám...';

    try {
        await requestNotificationPermission();

        // Wait 2 seconds before allowing next action
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Restore button state before updating UI (button will be hidden by updateNotificationUIState)
        button.disabled = false;
        button.textContent = originalText;

        // Update UI after successful enable
        updateNotificationUIState();
    } catch (error) {
        if (error.message === 'IOS_NOT_STANDALONE') {
            alert('Na iOS musíte nejdřív přidat web na plochu (Home Screen). Klikněte na tlačítko "Sdílet" a pak "Přidat na plochu".');
        } else {
            alert('Nepodařilo se zapnout notifikace: ' + error.message);
        }

        // Wait 2 seconds before allowing next action (even on error)
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Re-enable button on error
        button.disabled = false;
        button.textContent = originalText;
    }
}

/**
 * Disable notifications handler
 */
export async function disableNotificationsHandler() {
    const button = dom.notificationToggleDisable;
    if (!button) return;

    // Prevent multiple simultaneous clicks
    if (button.disabled) return;

    // Disable button during processing to prevent spam clicks
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Zpracovávám...';

    try {
        await disableNotifications();

        // Wait 2 seconds before allowing next action
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Update UI after successful disable
        updateNotificationUIState();
    } catch (error) {
        alert('Nepodařilo se vypnout notifikace: ' + error.message);

        // Wait 2 seconds before allowing next action (even on error)
        await new Promise(resolve => setTimeout(resolve, 2000));
    } finally {
        // Re-enable button
        button.disabled = false;
        button.textContent = originalText;
    }
}

/**
 * Populate debug timetable selector
 */
function populateDebugTimetableSelect() {
    const select = document.getElementById('debugTimetableSelect');
    if (!select || !state.definitions) return;

    const scheduleTypes = [
        { value: 'Actual', label: 'Aktuální' },
        { value: 'Next', label: 'Příští' }
    ];

    let html = '<option value="">-- Vyber rozvrh --</option>';

    // Add Classes
    if (state.definitions.classes && state.definitions.classes.length > 0) {
        html += '<optgroup label="Třídy">';
        state.definitions.classes.forEach(item => {
            scheduleTypes.forEach(schedule => {
                const value = JSON.stringify({
                    type: 'Class',
                    id: item.id,
                    name: item.name,
                    scheduleType: schedule.value
                });
                html += `<option value='${value}'>${item.name} - ${schedule.label}</option>`;
            });
        });
        html += '</optgroup>';
    }

    // Add Teachers
    if (state.definitions.teachers && state.definitions.teachers.length > 0) {
        html += '<optgroup label="Učitelé">';
        state.definitions.teachers.forEach(item => {
            scheduleTypes.forEach(schedule => {
                const value = JSON.stringify({
                    type: 'Teacher',
                    id: item.id,
                    name: item.name,
                    scheduleType: schedule.value
                });
                html += `<option value='${value}'>${item.name} - ${schedule.label}</option>`;
            });
        });
        html += '</optgroup>';
    }

    // Add Rooms
    if (state.definitions.rooms && state.definitions.rooms.length > 0) {
        html += '<optgroup label="Místnosti">';
        state.definitions.rooms.forEach(item => {
            scheduleTypes.forEach(schedule => {
                const value = JSON.stringify({
                    type: 'Room',
                    id: item.id,
                    name: item.name,
                    scheduleType: schedule.value
                });
                html += `<option value='${value}'>${item.name} - ${schedule.label}</option>`;
            });
        });
        html += '</optgroup>';
    }

    select.innerHTML = html;
}

/**
 * Simulate timetable change (DEBUG only)
 */
async function simulateTimetableChange() {
    const button = document.getElementById('debugSimulateChange');
    const select = document.getElementById('debugTimetableSelect');
    if (!button || !select) return;

    // Get selected timetable from dropdown
    const selectedValue = select.value;
    if (!selectedValue) {
        alert('Nejdřív vyber rozvrh z dropdownu!');
        return;
    }

    const timetable = JSON.parse(selectedValue);

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = '⏳ Vytvářím změnu...';

    try {
        const response = await fetch('/api/debug/simulate-change', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                timetableType: timetable.type,
                timetableId: timetable.id,
                timetableName: timetable.name,
                scheduleType: timetable.scheduleType
            })
        });

        if (!response.ok) {
            throw new Error('Failed to simulate change');
        }

        const result = await response.json();

        console.log('✅ Simulated change result:', result);

        alert(`✅ Hotovo!\n\n` +
            `Změna vytvořena pro: ${timetable.name}\n` +
            `Notifikace poslány: ${result.notificationResult?.sentCount || 0}x\n` +
            `Zpracováno změn: ${result.notificationResult?.processedCount || 0}`);

    } catch (error) {
        console.error('Failed to simulate change:', error);
        alert('❌ Chyba při simulaci změny: ' + error.message);
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
}

/**
 * Show/hide debug section based on DEBUG mode
 */
function updateDebugSectionVisibility() {
    const debugSection = document.getElementById('debugSimulateSection');
    if (!debugSection) return;

    // Check if in debug mode by checking debug status endpoint
    fetch('/api/debug/status')
        .then(response => response.json())
        .then(data => {
            if (data.debugMode) {
                debugSection.style.display = 'block';
                populateDebugTimetableSelect();
            } else {
                debugSection.style.display = 'none';
            }
        })
        .catch(() => {
            // Network error or other issue - hide debug section
            debugSection.style.display = 'none';
        });
}

/**
 * Initialize event listeners and load notification state
 */
export async function initNotificationButton() {
    if (dom.notificationBell) {
        dom.notificationBell.addEventListener('click', showNotificationModal);
    }

    // Flat list search
    const flatListSearch = document.getElementById('flatListSearch');
    if (flatListSearch) {
        flatListSearch.addEventListener('input', (e) => filterFlatList(e.target.value));
    }

    // Navigate to preferences view when settings gear is clicked on a flat list item
    window.addEventListener('showNotifPreferences', (e) => {
        const { type, id, name } = e.detail;
        showNotifPreferencesView(type, id, name);
    });

    // Listen for changes in watched timetables to update button state
    window.addEventListener('watchedTimetablesChanged', () => {
        updateEnableButtonState();
    });

    // Initialize debug simulate button
    const debugButton = document.getElementById('debugSimulateChange');
    if (debugButton) {
        debugButton.addEventListener('click', simulateTimetableChange);
    }

    // Check debug mode and show/hide debug section
    updateDebugSectionVisibility();

    // Load notification preferences and update bell UI on startup
    await loadNotificationPreferences();
    updateNotificationBellUI();
}
