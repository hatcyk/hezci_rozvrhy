/**
 * Layout Registry
 * Central registry of all available timetable layouts (návrh G).
 *
 * "Den" is the real-time-scale timeline (it replaced the old "Agenda" and
 * "Denní zobrazení", see LEGACY_LAYOUTS). "Přehled" is not a layout: it is
 * the home screen of the timetable tab on phones (overview.js).
 */

/** `icon` is a sprite name (icons.svg#…); settings.js renders <svg class="i"><use …> from it. */
export const LAYOUT_REGISTRY = {
    'day': {
        id: 'day',
        name: 'Den',
        description: 'Časová osa dne ve skutečném měřítku, přestávky jako mezery',
        iconName: 'calendar',
        icon: 'calendar',
        renderer: 'renderDayLayout',
        requiresDaySelector: true,
        supportedOn: ['mobile', 'desktop']
    },
    'week-view': {
        id: 'week-view',
        name: 'Týden',
        description: 'Pět dní vedle sebe s časovou osou',
        iconName: 'columns-3',
        icon: 'columns-3',
        renderer: 'renderWeekLayout',
        requiresDaySelector: false,
        supportedOn: ['desktop']
    },
    'compact-list': {
        id: 'compact-list',
        name: 'Seznam',
        description: 'Hodiny dne jako řádky pod sebou',
        iconName: 'list',
        icon: 'list',
        renderer: 'renderCompactListLayout',
        requiresDaySelector: true,
        supportedOn: ['mobile']
    },
    'card-view': {
        id: 'card-view',
        name: 'Karty',
        description: 'Jedna hodina na kartu, listuje se do strany',
        iconName: 'rectangle-vertical',
        icon: 'rectangle-vertical',
        renderer: 'renderCardLayout',
        requiresDaySelector: true,
        supportedOn: ['mobile']
    }
};

/**
 * Saved `layoutMode` values of version 2.0 that no longer exist, and what
 * they became. Agenda and the single-day table were both "one day" views.
 */
export const LEGACY_LAYOUTS = {
    'agenda': 'day',
    'single-day': 'day'
};

/** Current id of a (possibly old) saved layout id, or null when unknown. */
export function migrateLayoutId(id) {
    if (!id) return null;
    if (id in LAYOUT_REGISTRY) return id;
    return LEGACY_LAYOUTS[id] || null;
}

/**
 * Get layout by ID
 * @param {string} id - Layout ID (old ids are migrated)
 * @returns {Object} Layout configuration (Den when unknown)
 */
export function getLayoutById(id) {
    return LAYOUT_REGISTRY[migrateLayoutId(id)] || LAYOUT_REGISTRY['day'];
}

/**
 * Get all available layouts for a platform
 * @param {string} platform - Platform ('mobile' or 'desktop')
 * @returns {Array} Array of layout configurations
 */
export function getAvailableLayouts(platform = 'mobile') {
    return Object.values(LAYOUT_REGISTRY).filter(
        layout => layout.supportedOn.includes(platform)
    );
}

/**
 * Check if a layout exists (old ids that migrate count as existing)
 * @param {string} id - Layout ID
 * @returns {boolean} True if layout exists
 */
export function layoutExists(id) {
    return migrateLayoutId(id) !== null;
}
