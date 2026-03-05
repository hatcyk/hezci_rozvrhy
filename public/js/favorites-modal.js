/**
 * Favorites Modal Module
 * Quick access sheet showing all favorite timetables as a flat list
 */

import { state, updateState } from './state.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';
import { setDropdownValue, refreshDropdownHeartIndicator, setFavoritesAccessBtnUpdater } from './dropdown.js';
import { HEART_FILLED_SVG } from './favorites.js';

const TYPE_LABELS = {
    Class: 'Třída',
    Teacher: 'Učitel',
    Room: 'Učebna'
};

export function updateFavoritesAccessBtn() {
    const btn = document.getElementById('favoritesBtn');
    if (!btn) return;
    const hasFavs = state.favoriteTimetables.length > 0;
    btn.classList.toggle('has-favorites', hasFavs);
    if (hasFavs) {
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="favorites-modal-heart-icon"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    } else {
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    }
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
        list.innerHTML = `<p class="favorites-sheet-empty">Zatím žádné oblíbené.<br>Klikni na srdíčko u rozvrhu v seznamu.</p>`;
        return;
    }

    list.innerHTML = favs.map(fav => `
        <button class="favorites-sheet-item" data-type="${fav.type}" data-id="${fav.id}">
            ${HEART_FILLED_SVG}
            <span>${getLabelForFavorite(fav)}</span>
            <span class="favorites-sheet-type-badge">${TYPE_LABELS[fav.type] || fav.type}</span>
        </button>
    `).join('');

    list.querySelectorAll('.favorites-sheet-item').forEach(item => {
        item.addEventListener('click', async () => {
            const type = item.dataset.type;
            const id = item.dataset.id;
            closeBottomSheet('favoritesModal');

            if (state.selectedType !== type) {
                updateState('selectedType', type);
                document.querySelectorAll('.type-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.type === type);
                });
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

export function initFavoritesModal() {
    // Wire up the access button updater into dropdown.js (breaks circular dependency)
    setFavoritesAccessBtnUpdater(updateFavoritesAccessBtn);

    const btn = document.getElementById('favoritesBtn');
    const closeBtn = document.getElementById('favoritesModalClose');

    if (btn) {
        btn.addEventListener('click', () => {
            populateFavoritesSheet();
            openBottomSheet('favoritesModal');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => closeBottomSheet('favoritesModal'));
    }

    updateFavoritesAccessBtn();
}
