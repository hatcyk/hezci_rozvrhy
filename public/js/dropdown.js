import { dom } from './dom.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';
import { isFavorite, toggleFavorite, HEART_FILLED_SVG, HEART_OUTLINE_SVG } from './favorites.js';
import { state } from './state.js';
import { esc } from './utils.js';

/** Attribute-selector-safe value (ids come from localStorage and deep links). */
const cssValue = (v) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&'));
const favLabel = (isFav) => (isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených');

// Will be replaced by real import once favorites-modal.js is available
let updateFavoritesAccessBtn = () => {};
export function setFavoritesAccessBtnUpdater(fn) { updateFavoritesAccessBtn = fn; }

// Custom dropdown state
let currentValue = '';
let isOpen = false;
let searchInput = null;
let allOptions = [];
let changeCallback = null;

// Initialize custom dropdown
export function initCustomDropdown(onChangeCallback) {
    if (!dom.valueDropdownTrigger || !dom.valueDropdownMenu) {
        console.error('Custom dropdown elements not found');
        return;
    }

    // Store callback for later use
    changeCallback = onChangeCallback;

    // Closed menu must be out of the tab order and the accessibility tree:
    // it is only faded out with opacity, so its search box and hearts used to
    // be reachable by Tab while invisible (WCAG 2.4.3).
    dom.valueDropdownMenu.inert = true;
    dom.valueDropdownTrigger.setAttribute('aria-expanded', 'false');
    dom.valueDropdownTrigger.setAttribute('aria-controls', dom.valueDropdownMenu.id);

    // Toggle dropdown on trigger click
    dom.valueDropdownTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
    });

    // Handle option selection
    dom.valueDropdownMenu.addEventListener('click', async (e) => {
        // Heart button click
        const favBtn = e.target.closest('.favorite-btn');
        if (favBtn) {
            e.stopPropagation();
            const value = favBtn.dataset.favValue;
            try {
                await toggleFavorite(state.selectedType, value);
                const isFav = isFavorite(state.selectedType, value);
                favBtn.classList.toggle('is-favorite', isFav);
                favBtn.innerHTML = isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG;
                favBtn.title = favLabel(isFav);
                favBtn.setAttribute('aria-label', favLabel(isFav));
                favBtn.setAttribute('aria-pressed', String(isFav));
                updateTriggerHeartIndicator();
                updateFavoritesAccessBtn();
            } catch {
                console.error('Failed to toggle favorite');
            }
            return;
        }
        // Option click – select schedule
        const option = e.target.closest('.custom-dropdown-option');
        if (option) {
            const value = option.dataset.value;
            const label = option.querySelector('.option-label').textContent;
            selectOption(value, label);
            closeDropdown();
            if (changeCallback) {
                changeCallback();
            }
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (isOpen && !dom.valueDropdown.contains(e.target)) {
            closeDropdown();
        }
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) {
            closeDropdown();
            dom.valueDropdownTrigger.focus(); // keep the keyboard user where they were
        }
    });
}

// Toggle dropdown open/close
function toggleDropdown() {
    if (isOpen) {
        closeDropdown();
    } else {
        openDropdown();
    }
}

function isMobile() {
    return window.innerWidth <= 1079;
}

// Open dropdown
export function openDropdown() {
    if (isMobile()) {
        openMobileSheet();
        return;
    }
    isOpen = true;
    dom.valueDropdownMenu.inert = false;
    dom.valueDropdownTrigger.setAttribute('aria-expanded', 'true');
    dom.valueDropdownTrigger.classList.add('open');
    dom.valueDropdownMenu.classList.add('open');

    if (searchInput) {
        setTimeout(() => searchInput.focus(), 0);
    }
}

// Close dropdown
function closeDropdown() {
    if (isMobile()) {
        closeBottomSheet('dropdownMobileSheet');
        return;
    }
    isOpen = false;
    // Focus inside the menu would be dropped to <body> once the menu turns
    // inert; bring it back to the trigger instead.
    const hadFocus = dom.valueDropdownMenu.contains(document.activeElement);
    dom.valueDropdownMenu.inert = true;
    if (hadFocus) dom.valueDropdownTrigger.focus();
    dom.valueDropdownTrigger.setAttribute('aria-expanded', 'false');
    dom.valueDropdownTrigger.classList.remove('open');
    dom.valueDropdownMenu.classList.remove('open');

    if (searchInput) {
        searchInput.value = '';
        filterOptions('');
    }
}

// ---- Mobile bottom sheet dropdown ----

function getActiveTypeLabel() {
    const activeBtn = document.querySelector('.type-btn.active');
    return activeBtn ? activeBtn.textContent.trim() : 'Vyberte';
}

function openMobileSheet() {
    let sheet = document.getElementById('dropdownMobileSheet');
    if (!sheet) {
        // Native modal <dialog>: focus containment, inert page and Esc for free
        sheet = document.createElement('dialog');
        sheet.className = 'bottom-sheet';
        sheet.id = 'dropdownMobileSheet';
        sheet.setAttribute('aria-labelledby', 'dropdownSheetTitle');
        sheet.innerHTML = `
            <div class="bottom-sheet-handle" aria-hidden="true"></div>
            <div class="modal-header">
                <h2 id="dropdownSheetTitle">Vyberte</h2>
                <button type="button" class="modal-close" id="dropdownSheetClose" aria-label="Zavřít">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="dropdown-sheet-search-wrap">
                <input type="search" class="dropdown-sheet-search" id="dropdownSheetSearch" placeholder="Hledat..." aria-label="Hledat v seznamu" autocomplete="off">
            </div>
            <div class="dropdown-sheet-list" id="dropdownSheetList"></div>
        `;
        document.body.appendChild(sheet);
        document.getElementById('dropdownSheetClose').addEventListener('click', () => {
            closeBottomSheet('dropdownMobileSheet');
        });
    }

    // Update title
    const title = sheet.querySelector('#dropdownSheetTitle');
    if (title) title.textContent = getActiveTypeLabel();

    // Populate list
    const list = sheet.querySelector('#dropdownSheetList');
    // Select button and heart button are siblings in a row: a button nested in a
    // button is invalid and unreachable for keyboard / screen reader users.
    list.innerHTML = allOptions.map(item => {
        const isFav = isFavorite(state.selectedType, item.value);
        const selected = item.value === currentValue;
        return `
        <div class="dropdown-sheet-row" data-row-value="${esc(item.value)}">
            <button type="button" class="dropdown-sheet-option${selected ? ' selected' : ''}" data-value="${esc(item.value)}"${selected ? ' aria-current="true"' : ''}>
                <span class="option-label">${esc(item.label)}</span>
                ${selected ? `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ''}
            </button>
            <button type="button" class="favorite-btn${isFav ? ' is-favorite' : ''}" data-fav-value="${esc(item.value)}" aria-pressed="${isFav}" aria-label="${favLabel(isFav)}: ${esc(item.label)}">
                ${isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG}
            </button>
        </div>
        `;
    }).join('');

    list.querySelectorAll('.dropdown-sheet-row .favorite-btn').forEach(favBtn => {
        favBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const value = favBtn.dataset.favValue;
            const label = favBtn.closest('.dropdown-sheet-row')?.querySelector('.option-label')?.textContent || '';
            try {
                await toggleFavorite(state.selectedType, value);
                const isFav = isFavorite(state.selectedType, value);
                favBtn.classList.toggle('is-favorite', isFav);
                favBtn.innerHTML = isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG;
                favBtn.setAttribute('aria-pressed', String(isFav));
                favBtn.setAttribute('aria-label', `${favLabel(isFav)}: ${label}`);
                updateTriggerHeartIndicator();
                updateFavoritesAccessBtn();
            } catch {
                console.error('Failed to toggle favorite');
            }
        });
    });

    list.querySelectorAll('.dropdown-sheet-option').forEach(btn => {
        btn.addEventListener('click', () => {
            // Option select
            const value = btn.dataset.value;
            const label = btn.querySelector('.option-label').textContent.trim();
            selectOption(value, label);
            closeBottomSheet('dropdownMobileSheet');
            if (changeCallback) changeCallback();
        });
    });

    // Search
    const searchEl = sheet.querySelector('#dropdownSheetSearch');
    searchEl.value = '';
    searchEl.oninput = () => {
        const q = searchEl.value.toLowerCase();
        list.querySelectorAll('.dropdown-sheet-row').forEach(row => {
            const text = row.querySelector('.option-label').textContent.toLowerCase();
            row.hidden = !text.includes(q);
        });
    };

    openBottomSheet('dropdownMobileSheet', { fullHeight: true });
    setTimeout(() => searchEl.focus(), 350);
}

// Select an option
function selectOption(value, label) {
    currentValue = value;
    dom.valueDropdownLabel.textContent = label;

    // Update selected state in menu
    markSelected(value);
    updateTriggerHeartIndicator();
}

/** Visual + AT "selected" state of desktop options. */
function markSelected(value) {
    dom.valueDropdownMenu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        const on = opt.dataset.value === value;
        opt.classList.toggle('selected', on);
        const label = opt.querySelector('.option-label');
        if (label) {
            if (on) label.setAttribute('aria-current', 'true');
            else label.removeAttribute('aria-current');
        }
    });
}

function updateTriggerHeartIndicator() {
    const heartEl = document.getElementById('dropdownTriggerHeart');
    if (!heartEl) return;
    const fav = currentValue && isFavorite(state.selectedType, currentValue);
    heartEl.classList.toggle('visible', !!fav);
}

export function refreshDropdownHeartIndicator() {
    updateTriggerHeartIndicator();
}

// Populate dropdown options
export function populateDropdown(items) {
    if (!dom.valueDropdownMenu) return;

    dom.valueDropdownMenu.innerHTML = '';

    // Store all options for filtering
    allOptions = items;

    // Create search input
    searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'custom-dropdown-search';
    searchInput.placeholder = 'Hledat...';
    searchInput.setAttribute('aria-label', 'Hledat v seznamu');
    searchInput.autocomplete = 'off';

    // Add search event listener
    searchInput.addEventListener('input', (e) => {
        filterOptions(e.target.value);
    });

    // Handle Enter key to select first visible option
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            selectFirstVisibleOption();
        }
    });

    // Prevent dropdown from closing when clicking on search input
    searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    dom.valueDropdownMenu.appendChild(searchInput);

    // Create all option elements
    items.forEach(item => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option';
        option.dataset.value = item.value;
        option.dataset.searchText = item.label.toLowerCase();

        const isFav = isFavorite(state.selectedType, item.value);
        // The label is a real <button> so the option is reachable by Tab and
        // Enter/Space; the row stays a plain container (no nested controls).
        option.innerHTML = `
            <button type="button" class="option-label">${esc(item.label)}</button>
            <button type="button" class="favorite-btn${isFav ? ' is-favorite' : ''}" data-fav-value="${esc(item.value)}" aria-pressed="${isFav}" aria-label="${favLabel(isFav)}" title="${favLabel(isFav)}">
                ${isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG}
            </button>
        `;

        dom.valueDropdownMenu.appendChild(option);
    });
    markSelected(currentValue);
}

// Filter options based on search text
function filterOptions(searchText) {
    const searchLower = searchText.toLowerCase();
    const options = dom.valueDropdownMenu.querySelectorAll('.custom-dropdown-option');

    options.forEach(option => {
        const text = option.dataset.searchText;
        if (text.includes(searchLower)) {
            option.style.display = '';
        } else {
            option.style.display = 'none';
        }
    });
}

// Set dropdown value programmatically
export function setDropdownValue(value, label) {
    currentValue = value;
    if (label) {
        dom.valueDropdownLabel.textContent = label;
    } else {
        // Find the label from the options
        const option = dom.valueDropdownMenu.querySelector(`[data-value="${cssValue(value)}"]`);
        if (option) {
            const labelEl = option.querySelector('.option-label');
            dom.valueDropdownLabel.textContent = labelEl ? labelEl.textContent : option.textContent;
        }
    }

    // Update selected state
    markSelected(value);
    updateTriggerHeartIndicator();
}

// Get current dropdown value
export function getDropdownValue() {
    return currentValue;
}

// Select first visible option
function selectFirstVisibleOption() {
    const options = dom.valueDropdownMenu.querySelectorAll('.custom-dropdown-option');

    for (const option of options) {
        if (option.style.display !== 'none') {
            const value = option.dataset.value;
            const labelEl = option.querySelector('.option-label');
            const label = labelEl ? labelEl.textContent : option.textContent;
            selectOption(value, label);
            closeDropdown();

            // Trigger the change callback
            if (changeCallback) {
                changeCallback();
            }
            break;
        }
    }
}
