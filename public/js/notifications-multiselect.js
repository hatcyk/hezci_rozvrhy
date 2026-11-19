/**
 * Notifications Flat List Module
 * Handles the flat list with accordion categories and toggle switches for selecting watched timetables
 */

import { state, updateState } from './state.js';
import { saveWatchedTimetables, reportUnsavedChange } from './notifications-core.js';
import { renderSelectedTimetablesPreferences, getDefaultPreferences } from './notifications-preferences.js';
import { debug } from './debug.js';
import { esc } from './utils.js';

const GEAR_ICON = '<svg class="i" aria-hidden="true"><use href="icons.svg#settings"></use></svg>';

const CHEVRON_ICON = '<svg class="i flat-accordion-chevron" aria-hidden="true"><use href="icons.svg#chevron-down"></use></svg>';

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
        html += renderAccordion('Teacher', 'Vyučující', state.definitions.teachers);
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
            setAccordionOpen(accordion, !accordion.classList.contains('open'));
        });
    });
}

/**
 * Open/close one accordion. The collapsed body is only squeezed to 0 rows, so
 * it is made inert as well - otherwise Tab walked through dozens of invisible
 * toggles (WCAG 2.4.3).
 */
function setAccordionOpen(accordion, open) {
    if (!accordion) return;
    accordion.classList.toggle('open', open);
    const header = accordion.querySelector('.flat-accordion-header');
    const body = accordion.querySelector('.flat-accordion-body');
    if (header) header.setAttribute('aria-expanded', String(open));
    if (body) body.inert = !open;
}

function renderAccordion(type, label, items) {
    const watchedCount = items.filter(item => isItemWatched(type, item.id)).length;
    const countBadge = `<span class="flat-accordion-count g-count"${watchedCount > 0 ? '' : ' hidden'}>${watchedCount}</span>`;

    let itemsHtml = '';
    items.forEach(item => {
        itemsHtml += renderToggleItem(type, item.id, item.name, isItemWatched(type, item.id));
    });

    return `
        <div class="flat-accordion" data-category="${esc(type)}">
            <button type="button" class="flat-accordion-header" aria-expanded="false" aria-controls="flatAccordion-${esc(type)}">
                <span class="flat-accordion-label">${esc(label)}</span>
                ${countBadge}
                ${CHEVRON_ICON}
            </button>
            <div class="flat-accordion-body" id="flatAccordion-${esc(type)}" inert>
                <div class="flat-accordion-body-inner">
                    ${itemsHtml}
                </div>
            </div>
        </div>
    `;
}

function renderToggleItem(type, id, name, isWatched) {
    return `
        <div class="flat-list-item" data-type="${esc(type)}" data-id="${esc(id)}" data-name="${esc(name)}">
            <span class="flat-item-name">${esc(name)}</span>
            <button type="button" class="flat-item-settings${isWatched ? '' : ' hidden'}" aria-label="Nastavení upozornění: ${esc(name)}" title="Nastavení upozornění">
                ${GEAR_ICON}
            </button>
            <input type="checkbox" role="switch" class="flat-toggle-input g-switch"
                   data-type="${esc(type)}" data-id="${esc(id)}" data-name="${esc(name)}"
                   aria-label="Sledovat ${esc(name)}"
                   ${isWatched ? 'checked' : ''}>
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

    const previous = state.watchedTimetables;
    let watchedTimetables = [...previous];

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
        reportUnsavedChange(error);
        // Back to what the server has, unless a newer change is under way
        if (state.watchedTimetables !== watchedTimetables) return;
        input.checked = !input.checked;
        if (item) {
            const settingsBtn = item.querySelector('.flat-item-settings');
            if (settingsBtn) {
                settingsBtn.classList.toggle('hidden', !input.checked);
            }
        }
        updateState('watchedTimetables', previous);
        renderSelectedTimetablesPreferences();
        window.dispatchEvent(new CustomEvent('watchedTimetablesChanged'));
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
            countBadge.hidden = watchedCount === 0;
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
            setAccordionOpen(accordion, true);
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
