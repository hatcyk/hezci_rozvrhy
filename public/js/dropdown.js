import { dom } from './dom.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';
import { isFavorite, toggleFavorite, HEART_FILLED_SVG, HEART_OUTLINE_SVG } from './favorites.js';
import { state } from './state.js';

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
                favBtn.title = isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených';
                favBtn.setAttribute('aria-label', isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených');
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
        sheet = document.createElement('div');
        sheet.className = 'bottom-sheet';
        sheet.id = 'dropdownMobileSheet';
        sheet.innerHTML = `
            <div class="bottom-sheet-handle"></div>
            <div class="modal-header">
                <h2 id="dropdownSheetTitle">Vyberte</h2>
                <button class="modal-close" id="dropdownSheetClose">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="dropdown-sheet-search-wrap">
                <input type="text" class="dropdown-sheet-search" id="dropdownSheetSearch" placeholder="Hledat...">
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
    list.innerHTML = allOptions.map(item => {
        const isFav = isFavorite(state.selectedType, item.value);
        return `
        <button class="dropdown-sheet-option${item.value === currentValue ? ' selected' : ''}" data-value="${item.value}">
            <span class="option-label">${item.label}</span>
            <span class="favorite-btn${isFav ? ' is-favorite' : ''}" data-fav-value="${item.value}" role="button" aria-label="${isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}">
                ${isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG}
            </span>
            ${item.value === currentValue ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ''}
        </button>
        `;
    }).join('');

    list.querySelectorAll('.dropdown-sheet-option').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            // Heart button
            const favSpan = e.target.closest('.favorite-btn');
            if (favSpan) {
                e.stopPropagation();
                const value = favSpan.dataset.favValue;
                try {
                    await toggleFavorite(state.selectedType, value);
                    const isFav = isFavorite(state.selectedType, value);
                    favSpan.classList.toggle('is-favorite', isFav);
                    favSpan.innerHTML = isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG;
                    favSpan.setAttribute('aria-label', isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených');
                    updateTriggerHeartIndicator();
                    updateFavoritesAccessBtn();
                } catch {
                    console.error('Failed to toggle favorite');
                }
                return;
            }
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
        list.querySelectorAll('.dropdown-sheet-option').forEach(btn => {
            const text = btn.querySelector('.option-label').textContent.toLowerCase();
            btn.style.display = text.includes(q) ? '' : 'none';
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
    dom.valueDropdownMenu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        if (opt.dataset.value === value) {
            opt.classList.add('selected');
        } else {
            opt.classList.remove('selected');
        }
    });
    updateTriggerHeartIndicator();
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
    searchInput.type = 'text';
    searchInput.className = 'custom-dropdown-search';
    searchInput.placeholder = 'Hledat...';

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
        option.innerHTML = `
            <span class="option-label">${item.label}</span>
            <button class="favorite-btn${isFav ? ' is-favorite' : ''}" data-fav-value="${item.value}" aria-label="${isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}" title="${isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}">
                ${isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG}
            </button>
        `;

        if (item.value === currentValue) {
            option.classList.add('selected');
        }

        dom.valueDropdownMenu.appendChild(option);
    });
}

// Filter options based on search text
function filterOptions(searchText) {
    const searchLower = searchText.toLowerCase();
    const options = dom.valueDropdownMenu.querySelectorAll('.custom-dropdown-option');

    options.forEach(option => {
        const text = option.dataset.searchText;
        if (text.includes(searchLower)) {
            option.style.display = 'block';
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
        const option = dom.valueDropdownMenu.querySelector(`[data-value="${value}"]`);
        if (option) {
            const labelEl = option.querySelector('.option-label');
            dom.valueDropdownLabel.textContent = labelEl ? labelEl.textContent : option.textContent;
        }
    }

    // Update selected state
    dom.valueDropdownMenu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        if (opt.dataset.value === value) {
            opt.classList.add('selected');
        } else {
            opt.classList.remove('selected');
        }
    });
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
