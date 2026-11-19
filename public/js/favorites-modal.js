/**
 * Favorites Modal Module
 * Quick access sheet showing all favorite timetables as a flat list
 */

import { state, updateState } from './state.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';
import { setDropdownValue, refreshDropdownHeartIndicator, setFavoritesAccessBtnUpdater } from './dropdown.js';
import { esc, setPressed } from './utils.js';
import { getCurrentView, showView } from './view-router.js';

const TYPE_LABELS = {
    Class: 'třída',
    Teacher: 'vyučující',
    Room: 'učebna'
};
const TYPE_ICONS = { Class: 'users', Teacher: 'user', Room: 'door-open' };
const icon = (name, cls = '') => `<svg class="i${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="icons.svg#${name}"></use></svg>`;

/**
 * The header button (owned by the app shell) only gets its name and a
 * has-favorites class here; its icon stays whatever the shell drew.
 */
export function updateFavoritesAccessBtn() {
    const btn = document.getElementById('favoritesBtn');
    if (!btn) return;
    const count = state.favoriteTimetables.length;
    btn.classList.toggle('has-favorites', count > 0);
    btn.setAttribute('aria-label', count > 0 ? `Oblíbené rozvrhy (${count})` : 'Oblíbené rozvrhy');
}

function getLabelForFavorite(fav) {
    const TYPE_TO_DEF = { Class: 'classes', Teacher: 'teachers', Room: 'rooms' };
    const defKey = TYPE_TO_DEF[fav.type];
    if (!defKey || !state.definitions[defKey]) return fav.id;
    const def = state.definitions[defKey].find(d => d.id === fav.id);
    return def ? def.name : fav.id;
}

function populateFavoritesSheet() {
    const list = document.getElementById('favoritesSheetList');
    if (!list) return;

    const favs = state.favoriteTimetables;

    if (favs.length === 0) {
        list.innerHTML = `<div class="g-empty favorites-sheet-empty">${icon('star')}<strong>Zatím žádné oblíbené</strong>`
            + '<span>Přidáte je hvězdičkou u třídy, vyučujícího nebo učebny ve vyhledávání. Pak je tu otevřete jedním klepnutím.</span></div>';
        return;
    }

    list.innerHTML = `<div class="set-list">${favs.map(fav => `
        <button type="button" class="favorites-sheet-item set-row" data-type="${esc(fav.type)}" data-id="${esc(fav.id)}">
            ${icon(TYPE_ICONS[fav.type] || 'star', 'set-row-icon')}
            <span class="set-row-text"><span class="set-row-title">${esc(getLabelForFavorite(fav))}</span></span>
            <span class="set-row-value favorites-sheet-type-badge">${esc(TYPE_LABELS[fav.type] || fav.type)}</span>
            ${icon('chevron-right', 'set-row-chev')}
        </button>
    `).join('')}</div>`;

    list.querySelectorAll('.favorites-sheet-item').forEach(item => {
        item.addEventListener('click', async () => {
            const type = item.dataset.type;
            const id = item.dataset.id;
            closeBottomSheet('favoritesModal');
            // A favourite is a timetable: from another view go back to it
            if (getCurrentView() && getCurrentView() !== 'timetable') await showView('timetable', {}, { focus: false });

            if (state.selectedType !== type) {
                updateState('selectedType', type);
                setPressed(document.querySelectorAll('.type-btn'), btn => btn.dataset.type === type);
                const { populateValueSelect } = await import('./timetable.js');
                populateValueSelect();
            }

            setDropdownValue(id);
            refreshDropdownHeartIndicator();
            const { loadTimetable } = await import('./timetable.js');
            loadTimetable();
        });
    });
}

/** Open the favourites sheet (for any opener the app shell provides). */
export function openFavoritesSheet() {
    populateFavoritesSheet();
    openBottomSheet('favoritesModal');
}

export function initFavoritesModal() {
    // Wire up the access button updater into dropdown.js (breaks circular dependency)
    setFavoritesAccessBtnUpdater(updateFavoritesAccessBtn);

    const btn = document.getElementById('favoritesBtn');
    const closeBtn = document.getElementById('favoritesModalClose');

    if (btn) {
        btn.addEventListener('click', openFavoritesSheet);
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => closeBottomSheet('favoritesModal'));
    }

    updateFavoritesAccessBtn();
}
