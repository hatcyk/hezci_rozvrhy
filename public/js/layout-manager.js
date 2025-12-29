/**
 * Layout Manager
 * Manages layout switching, persistence, and synchronization
 */

import { state, updateState } from './state.js';
import { LAYOUT_REGISTRY, getLayoutById, layoutExists } from './layout-registry.js';

/**
 * Initialize layout system
 * Load saved preferences and migrate old settings
 */
export function initLayoutSystem() {
    // Load saved layout preference from localStorage
    const savedLayout = localStorage.getItem('layoutMode');
    const savedPreferences = localStorage.getItem('layoutPreferences');

    // Set default layout mode
    if (savedLayout && layoutExists(savedLayout)) {
        updateState('layoutMode', savedLayout);
    } else {
        updateState('layoutMode', 'single-day');
    }

    // Set default layout preferences
    const defaultPreferences = {
        'single-day': {},
        'week-view': {},
        'card-view': { cardIndex: 0 },
        'compact-list': { scrollPosition: 0 }
    };

    if (savedPreferences) {
        try {
            const parsed = JSON.parse(savedPreferences);
            updateState('layoutPreferences', { ...defaultPreferences, ...parsed });
        } catch (e) {
            console.error('Failed to parse layout preferences:', e);
            updateState('layoutPreferences', defaultPreferences);
        }
    } else {
        updateState('layoutPreferences', defaultPreferences);
    }

    // Migrate old showWholeWeek setting
    migrateOldShowWholeWeek();

    console.log('Layout system initialized:', state.layoutMode);
}

/**
 * Migrate old showWholeWeek boolean to new layoutMode
 */
function migrateOldShowWholeWeek() {
    // Check if showWholeWeek is true and we're on single-day mode
    if (state.showWholeWeek === true && state.layoutMode === 'single-day') {
        console.log('Migrating showWholeWeek=true to layoutMode=week-view');
        updateState('layoutMode', 'week-view');
        saveLayoutPreference('week-view');
    }
}

/**
 * Switch to a new layout
 * @param {string} layoutId - ID of the layout to switch to
 */
export async function switchLayout(layoutId) {
    const layout = getLayoutById(layoutId);

    if (!layout) {
        console.error(`Invalid layout ID: ${layoutId}`);
        return;
    }

    console.log(`Switching to layout: ${layoutId}`);

    // Update state
    updateState('layoutMode', layoutId);

    // Reset card-view index when switching TO card-view
    if (layoutId === 'card-view') {
        updateLayoutPreference('card-view', { cardIndex: 0 });
    }

    // Save to localStorage
    saveLayoutPreference(layoutId);

    // Apply layout to DOM
    await applyLayout();

    // TODO: Sync to Firestore (optional)
    // syncLayoutToFirestore(layoutId);
}

/**
 * Apply current layout to timetable view
 */
export async function applyLayout() {
    const layout = getLayoutById(state.layoutMode);
    const container = document.querySelector('.timetable-container');

    if (!container) {
        console.warn('Timetable container not found');
        return;
    }

    console.log('Applying layout:', layout.id);

    // Remove all layout mode classes
    container.classList.remove('single-day-mode', 'week-view-mode', 'card-view-mode', 'compact-list-mode');

    // Add current layout class
    container.classList.add(`${layout.id}-mode`);

    // Reset scroll position when switching layouts
    container.scrollLeft = 0;
    container.scrollTop = 0;

    // Show/hide day selector based on layout
    const daySelector = document.getElementById('daySelector');
    if (daySelector) {
        if (layout.requiresDaySelector) {
            daySelector.classList.remove('hide-day-selector');
            daySelector.classList.remove('hiding');
            daySelector.classList.add('showing');
            setTimeout(() => {
                daySelector.classList.remove('showing');
            }, 300);
        } else {
            daySelector.classList.add('hiding');
            setTimeout(() => {
                daySelector.classList.add('hide-day-selector');
                daySelector.classList.remove('hiding');
            }, 300);
        }
    }

    // Import and call appropriate renderer
    try {
        const {
            renderSingleDayLayout,
            renderWeekLayout,
            renderCardLayout,
            renderCompactListLayout
        } = await import('./layout-renderers.js');

        const rendererMap = {
            'renderSingleDayLayout': renderSingleDayLayout,
            'renderWeekLayout': renderWeekLayout,
            'renderCardLayout': renderCardLayout,
            'renderCompactListLayout': renderCompactListLayout
        };

        const renderer = rendererMap[layout.renderer];

        if (renderer) {
            await renderer();
        } else {
            console.error(`Renderer not found: ${layout.renderer}`);
        }
    } catch (error) {
        console.error('Failed to apply layout:', error);
    }
}

/**
 * Save layout preference to localStorage
 * @param {string} layoutId - Layout ID to save
 */
function saveLayoutPreference(layoutId) {
    try {
        localStorage.setItem('layoutMode', layoutId);
        localStorage.setItem('layoutPreferences', JSON.stringify(state.layoutPreferences));
        localStorage.setItem('layoutUpdatedAt', Date.now().toString());
        console.log('Layout preference saved to localStorage');
    } catch (error) {
        console.error('Failed to save layout preference:', error);
    }
}

/**
 * Update layout preference for specific layout
 * @param {string} layoutId - Layout ID
 * @param {Object} preferences - Preferences object to merge
 */
export function updateLayoutPreference(layoutId, preferences) {
    if (!state.layoutPreferences[layoutId]) {
        state.layoutPreferences[layoutId] = {};
    }

    state.layoutPreferences[layoutId] = {
        ...state.layoutPreferences[layoutId],
        ...preferences
    };

    // Save to localStorage
    localStorage.setItem('layoutPreferences', JSON.stringify(state.layoutPreferences));
}

/**
 * Get current layout configuration
 * @returns {Object} Current layout configuration
 */
export function getCurrentLayout() {
    return getLayoutById(state.layoutMode);
}

/**
 * Check if current layout requires day selector
 * @returns {boolean} True if day selector is required
 */
export function requiresDaySelector() {
    const layout = getCurrentLayout();
    return layout.requiresDaySelector;
}
