/**
 * Layout Manager
 * Manages layout switching, persistence, and synchronization
 */

import { state, updateState } from './state.js';
import { LAYOUT_REGISTRY, getLayoutById, layoutExists, migrateLayoutId } from './layout-registry.js';

/** All "<id>-mode" classes a layout can leave on the container. */
const MODE_CLASSES = [...Object.keys(LAYOUT_REGISTRY).map(id => `${id}-mode`), 'only-changes-mode'];

/**
 * Initialize layout system
 * Load saved preferences and migrate old settings
 */
export function initLayoutSystem() {
    // Load saved layout preference from localStorage
    let savedLayout = null;
    let savedPreferences = null;
    try {
        savedLayout = localStorage.getItem('layoutMode');
        savedPreferences = localStorage.getItem('layoutPreferences');
    } catch { /* storage blocked: defaults */ }

    // Version 2.0 had "agenda" and "single-day"; both became "day" (Den).
    // The saved value is rewritten once, so Settings shows the new name.
    const migrated = migrateLayoutId(savedLayout);
    if (savedLayout && migrated && migrated !== savedLayout) {
        console.log(`Migrating layoutMode ${savedLayout} → ${migrated}`);
        try { localStorage.setItem('layoutMode', migrated); } catch { /* ignore */ }
        savedLayout = migrated;
    }

    // Set default layout mode
    const platform = getCurrentPlatform();
    if (savedLayout && layoutExists(savedLayout)) {
        const savedLayoutConfig = getLayoutById(savedLayout);
        // Only restore saved layout if it's supported on the current platform
        if (savedLayoutConfig.supportedOn.includes(platform)) {
            updateState('layoutMode', savedLayoutConfig.id);
        } else {
            updateState('layoutMode', getDefaultLayoutForPlatform(platform));
        }
    } else {
        updateState('layoutMode', getDefaultLayoutForPlatform(platform));
    }

    // Set default layout preferences
    const defaultPreferences = {
        'day': {},
        'week-view': {},
        'card-view': { cardIndex: 0 },
        'compact-list': {}
    };

    if (savedPreferences) {
        try {
            const parsed = JSON.parse(savedPreferences);
            delete parsed.agenda;
            delete parsed['single-day'];
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
    if (state.showWholeWeek === true && state.layoutMode === 'day' && getCurrentPlatform() === 'desktop') {
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
    layoutId = layout.id;

    console.log(`Switching to layout: ${layoutId}`);

    // Update state
    updateState('layoutMode', layoutId);

    // Reset card-view index when switching TO card-view
    if (layoutId === 'card-view') {
        updateLayoutPreference('card-view', { cardIndex: 0 });
    }

    // Save to localStorage
    saveLayoutPreference(layoutId);

    // Cleanup event listeners from previous layout
    const { cleanupLayoutEventListeners } = await import('./layout-renderers.js');
    cleanupLayoutEventListeners();

    // Reset scroll position when switching layouts
    const container = document.getElementById('timetable');
    if (container) {
        container.scrollLeft = 0;
        container.scrollTop = 0;
    }

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
    const target = document.getElementById('timetable');

    if (!container || !target) {
        console.warn('Timetable container not found');
        return;
    }

    console.log('Applying layout:', layout.id);

    // Remove all layout mode classes
    container.classList.remove(...MODE_CLASSES);
    document.documentElement.dataset.layout = layout.id;

    // "Jen změny": a list of the week's changes replaces every layout, so all
    // the places that re-render (load, day switch, layout switch) respect it.
    const tools = await import('./timetable-tools.js');
    if (tools.onlyChangesActive()) {
        container.classList.add('only-changes-mode');
        document.documentElement.dataset.layout = 'only-changes';
        const { cleanupLayoutEventListeners } = await import('./layout-renderers.js');
        cleanupLayoutEventListeners();
        const daySel = document.getElementById('daySelector');
        if (daySel) daySel.classList.add('hide-day-selector');
        await tools.renderOnlyChanges(target);
        tools.updateTimetableToolbar();
        notifyLayoutApplied(layout);
        return;
    }

    // Add current layout class
    container.classList.add(`${layout.id}-mode`);
    target.removeAttribute('tabindex'); // "Jen změny" made the list itself focusable

    // Show/hide the week strip (day selector) based on layout
    const daySelector = document.getElementById('daySelector');
    if (daySelector) daySelector.classList.toggle('hide-day-selector', !layout.requiresDaySelector);

    // Import and call appropriate renderer
    try {
        const renderers = await import('./layout-renderers.js');
        const renderer = renderers[layout.renderer];

        if (renderer) {
            await renderer();
        } else {
            console.error(`Renderer not found: ${layout.renderer}`);
        }
    } catch (error) {
        console.error('Failed to apply layout:', error);
    }
    tools.updateTimetableToolbar();
    notifyLayoutApplied(layout);
}

/** Shell (titles, Den / Týden switch, ‹ › buttons) follows every render. */
function notifyLayoutApplied(layout) {
    if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
    document.dispatchEvent(new CustomEvent('layoutapplied', { detail: { layout: layout.id } }));
}

/**
 * Save layout preference to localStorage
 * @param {string} layoutId - Layout ID to save
 */
function saveLayoutPreference(layoutId) {
    try {
        localStorage.setItem('layoutMode', layoutId);
        localStorage.setItem('layoutPreferences', JSON.stringify(state.layoutPreferences));
        // (layoutUpdatedAt was written here but never read - removed)
        localStorage.removeItem('layoutUpdatedAt');
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

/**
 * Get current platform based on window width
 * @returns {string} 'mobile' or 'desktop'
 */
export function getCurrentPlatform() {
    return window.innerWidth <= 1079 ? 'mobile' : 'desktop';
}

/**
 * Get default layout for platform
 * @param {string} platform - 'mobile' or 'desktop'
 * @returns {string} Default layout ID
 */
export function getDefaultLayoutForPlatform(platform) {
    return platform === 'mobile' ? 'day' : 'week-view';
}

/**
 * Handle window resize - switch layout if current layout is not supported on new platform
 */
let resizeTimeout;
async function handleResize() {
    // Debounce resize events
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(async () => {
        const currentPlatform = getCurrentPlatform();
        const currentLayout = getCurrentLayout();

        // Check if current layout is supported on current platform
        if (!currentLayout.supportedOn.includes(currentPlatform)) {
            console.log(`Layout ${currentLayout.id} not supported on ${currentPlatform}, switching to default layout`);
            const defaultLayout = getDefaultLayoutForPlatform(currentPlatform);
            await switchLayout(defaultLayout);
        }
    }, 300); // 300ms debounce
}

/**
 * Initialize resize listener
 */
export function initResizeListener() {
    window.addEventListener('resize', handleResize);
    console.log('Resize listener initialized');
}
