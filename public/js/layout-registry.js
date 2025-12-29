/**
 * Layout Registry
 * Central registry of all available timetable layouts
 */

export const LAYOUT_REGISTRY = {
    'single-day': {
        id: 'single-day',
        name: 'Denní zobrazení',
        description: 'Zobrazení jednoho vybraného dne',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>`,
        renderer: 'renderSingleDayLayout',
        requiresDaySelector: true,
        supportedOn: ['mobile', 'desktop']
    },
    'week-view': {
        id: 'week-view',
        name: 'Celý týden',
        description: 'Zobrazení všech 5 pracovních dní v tabulce',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
            <path d="M8 14h.01"></path>
            <path d="M12 14h.01"></path>
            <path d="M16 14h.01"></path>
        </svg>`,
        renderer: 'renderWeekLayout',
        requiresDaySelector: false,
        supportedOn: ['mobile', 'desktop']
    },
    'card-view': {
        id: 'card-view',
        name: 'Karta',
        description: 'Každá lekce jako samostatná karta, kterou lze swipovat',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
        </svg>`,
        renderer: 'renderCardLayout',
        requiresDaySelector: true,
        supportedOn: ['mobile']
    },
    'compact-list': {
        id: 'compact-list',
        name: 'Kompaktní seznam',
        description: 'Seznam lekcí pod sebou místo tabulky',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <line x1="3" y1="6" x2="3.01" y2="6"></line>
            <line x1="3" y1="12" x2="3.01" y2="12"></line>
            <line x1="3" y1="18" x2="3.01" y2="18"></line>
        </svg>`,
        renderer: 'renderCompactListLayout',
        requiresDaySelector: true,
        supportedOn: ['mobile']
    }
};

/**
 * Get layout by ID
 * @param {string} id - Layout ID
 * @returns {Object|null} Layout configuration or null if not found
 */
export function getLayoutById(id) {
    return LAYOUT_REGISTRY[id] || LAYOUT_REGISTRY['single-day'];
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
 * Check if a layout exists
 * @param {string} id - Layout ID
 * @returns {boolean} True if layout exists
 */
export function layoutExists(id) {
    return id in LAYOUT_REGISTRY;
}
