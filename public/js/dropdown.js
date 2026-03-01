import { dom } from './dom.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';

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
    dom.valueDropdownMenu.addEventListener('click', (e) => {
        if (e.target.classList.contains('custom-dropdown-option')) {
            const value = e.target.dataset.value;
            selectOption(value, e.target.textContent);
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
    return window.innerWidth <= 768;
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
    list.innerHTML = allOptions.map(item => `
        <button class="dropdown-sheet-option${item.value === currentValue ? ' selected' : ''}" data-value="${item.value}">
            <span>${item.label}</span>
            ${item.value === currentValue ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ''}
        </button>
    `).join('');

    list.querySelectorAll('.dropdown-sheet-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const value = btn.dataset.value;
            const label = btn.querySelector('span').textContent.trim();
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
            const text = btn.querySelector('span').textContent.toLowerCase();
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
        option.textContent = item.label;
        option.dataset.searchText = item.label.toLowerCase();

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
            dom.valueDropdownLabel.textContent = option.textContent;
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
            const label = option.textContent;
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
