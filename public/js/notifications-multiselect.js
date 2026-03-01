/**
 * Notifications Flat List Module
 * Handles the flat list with accordion categories and toggle switches for selecting watched timetables
 */

import { state, updateState } from './state.js';
import { saveWatchedTimetables } from './notifications-core.js';
import { renderSelectedTimetablesPreferences, getDefaultPreferences } from './notifications-preferences.js';
import { debug } from './debug.js';

const GEAR_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>`;

const CHEVRON_ICON = `<svg class="flat-accordion-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

/**
 * Populate flat list with accordion categories and toggle switches
 */
export function populateFlatList() {
    const container = document.getElementById('flatTimetableList');
    if (!container) return;

    if (!state.definitions) {
        debug.error('❌ state.definitions is not defined');
        return;
    }

    let html = '';

    if (state.definitions.classes && state.definitions.classes.length > 0) {
        html += renderAccordion('Class', 'Třídy', state.definitions.classes);
    }

    if (state.definitions.teachers && state.definitions.teachers.length > 0) {
        html += renderAccordion('Teacher', 'Učitelé', state.definitions.teachers);
    }

    container.innerHTML = html;

    // Attach toggle listeners
    container.querySelectorAll('.flat-toggle-input').forEach(input => {
        input.addEventListener('change', handleToggleChange);
    });

    // Attach settings button listeners
    container.querySelectorAll('.flat-item-settings').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = btn.closest('.flat-list-item');
            window.dispatchEvent(new CustomEvent('showNotifPreferences', {
                detail: {
                    type: item.dataset.type,
                    id: item.dataset.id,
                    name: item.dataset.name
                }
            }));
        });
    });

    // Attach accordion header listeners
    container.querySelectorAll('.flat-accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const accordion = header.closest('.flat-accordion');
            accordion.classList.toggle('open');
        });
    });
}

function renderAccordion(type, label, items) {
    const watchedCount = items.filter(item => isItemWatched(type, item.id)).length;
    const countBadge = watchedCount > 0
        ? `<span class="flat-accordion-count">${watchedCount}</span>`
        : `<span class="flat-accordion-count" style="display:none">0</span>`;

    let itemsHtml = '';
    items.forEach(item => {
        itemsHtml += renderToggleItem(type, item.id, item.name, isItemWatched(type, item.id));
    });

    return `
        <div class="flat-accordion" data-category="${type}">
            <div class="flat-accordion-header">
                <span class="flat-accordion-label">${label}</span>
                ${countBadge}
                ${CHEVRON_ICON}
            </div>
            <div class="flat-accordion-body">
                <div class="flat-accordion-body-inner">
                    ${itemsHtml}
                </div>
            </div>
        </div>
    `;
}

function renderToggleItem(type, id, name, isWatched) {
    return `
        <div class="flat-list-item" data-type="${type}" data-id="${id}" data-name="${name}">
            <span class="flat-item-name">${name}</span>
            <button class="flat-item-settings${isWatched ? '' : ' hidden'}" aria-label="Nastavení notifikací" title="Nastavení notifikací">
                ${GEAR_ICON}
            </button>
            <label class="flat-toggle">
                <input type="checkbox" class="flat-toggle-input"
                       data-type="${type}" data-id="${id}" data-name="${name}"
                       ${isWatched ? 'checked' : ''}>
                <span class="flat-toggle-track"></span>
            </label>
        </div>
    `;
}

function isItemWatched(type, id) {
    const hasActual = state.watchedTimetables.some(w => w.type === type && w.id === id && w.scheduleType === 'Actual');
    const hasNext = state.watchedTimetables.some(w => w.type === type && w.id === id && w.scheduleType === 'Next');
    return hasActual && hasNext;
}

async function handleToggleChange(event) {
    const input = event.target;
    const type = input.dataset.type;
    const id = input.dataset.id;
    const name = input.dataset.name;

    let watchedTimetables = [...state.watchedTimetables];

    if (input.checked) {
        ['Actual', 'Next'].forEach(scheduleType => {
            const exists = watchedTimetables.some(t => t.type === type && t.id === id && t.scheduleType === scheduleType);
            if (!exists) {
                watchedTimetables.push({
                    type, id, name, scheduleType,
                    notificationTypes: getDefaultPreferences(),
                    groupFilters: []
                });
            }
        });
    } else {
        watchedTimetables = watchedTimetables.filter(t => !(t.type === type && t.id === id));
    }

    updateState('watchedTimetables', watchedTimetables);
    renderSelectedTimetablesPreferences();
    window.dispatchEvent(new CustomEvent('watchedTimetablesChanged'));

    // Update settings button visibility for this item
    const item = input.closest('.flat-list-item');
    if (item) {
        const settingsBtn = item.querySelector('.flat-item-settings');
        if (settingsBtn) {
            settingsBtn.classList.toggle('hidden', !input.checked);
        }
    }

    // Update accordion count badges
    updateAccordionCounts();

    try {
        await saveWatchedTimetables(watchedTimetables);
        debug.log('Watched timetables updated:', watchedTimetables);
    } catch (error) {
        debug.error('Failed to save watched timetables:', error);
        input.checked = !input.checked;
        if (item) {
            const settingsBtn = item.querySelector('.flat-item-settings');
            if (settingsBtn) {
                settingsBtn.classList.toggle('hidden', !input.checked);
            }
        }
        updateState('watchedTimetables', state.watchedTimetables);
        renderSelectedTimetablesPreferences();
        updateAccordionCounts();
    }
}

function updateAccordionCounts() {
    const container = document.getElementById('flatTimetableList');
    if (!container) return;

    container.querySelectorAll('.flat-accordion').forEach(accordion => {
        const countBadge = accordion.querySelector('.flat-accordion-count');
        const watchedCount = accordion.querySelectorAll('.flat-toggle-input:checked').length;

        if (countBadge) {
            countBadge.textContent = watchedCount;
            countBadge.style.display = watchedCount > 0 ? '' : 'none';
        }
    });
}

/**
 * Update toggle states based on current state
 */
export function updateFlatList() {
    const container = document.getElementById('flatTimetableList');
    if (!container) return;

    container.querySelectorAll('.flat-toggle-input').forEach(input => {
        const isWatched = isItemWatched(input.dataset.type, input.dataset.id);
        input.checked = isWatched;

        const item = input.closest('.flat-list-item');
        if (item) {
            const settingsBtn = item.querySelector('.flat-item-settings');
            if (settingsBtn) {
                settingsBtn.classList.toggle('hidden', !isWatched);
            }
        }
    });

    updateAccordionCounts();
}

/**
 * Filter flat list items by search term
 */
export function filterFlatList(searchTerm) {
    const container = document.getElementById('flatTimetableList');
    if (!container) return;

    const term = searchTerm.toLowerCase();

    container.querySelectorAll('.flat-accordion').forEach(accordion => {
        const items = accordion.querySelectorAll('.flat-list-item');
        let hasVisible = false;

        items.forEach(item => {
            const name = item.dataset.name.toLowerCase();
            const visible = term === '' || name.includes(term);
            item.style.display = visible ? '' : 'none';
            if (visible) hasVisible = true;
        });

        accordion.style.display = (hasVisible || term === '') ? '' : 'none';

        // Auto-open accordion when search has results
        if (term !== '' && hasVisible) {
            accordion.classList.add('open');
        }
    });
}

// Backward-compatible aliases for existing callers
export const populateMultiselectOptions = populateFlatList;
export const updateMultiselectCheckboxes = updateFlatList;
export const filterMultiselectOptions = filterFlatList;
export function updateMultiselectLabel() { /* no-op */ }
export function toggleMultiselect() { /* no-op */ }
export function setupMultiselectGlobalListeners() { /* no-op */ }
