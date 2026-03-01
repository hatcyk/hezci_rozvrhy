/**
 * Settings Modal Module (Mobile Only)
 * Handles the settings modal that shows notifications, layout, and theme options on mobile
 */

import { state } from './state.js';
import { switchLayout } from './layout-manager.js';
import { getAvailableLayouts, getLayoutById } from './layout-registry.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';

/**
 * Show settings modal
 */
export function showSettingsModal() {
    openBottomSheet('settingsModal');
}

/**
 * Close settings modal
 */
export function closeSettingsModal() {
    closeBottomSheet('settingsModal');
}

/**
 * Initialize settings modal and event listeners
 */
export function initSettings() {
    const settingsToggle = document.getElementById('settingsToggle');
    const settingsModalClose = document.getElementById('settingsModalClose');
    const settingsModal = document.getElementById('settingsModal');

    // Open settings modal
    if (settingsToggle) {
        settingsToggle.addEventListener('click', showSettingsModal);
    }

    // Close settings modal
    if (settingsModalClose) {
        settingsModalClose.addEventListener('click', closeSettingsModal);
    }

    // Settings options handlers
    const settingsNotifications = document.getElementById('settingsNotifications');
    const settingsCalendar = document.getElementById('settingsCalendar');
    const settingsTheme = document.getElementById('settingsTheme');

    if (settingsNotifications) {
        settingsNotifications.addEventListener('click', () => {
            closeSettingsModal();
            // Trigger notification bell click
            const notificationBell = document.getElementById('notificationBell');
            if (notificationBell) {
                notificationBell.click();
            }
        });
    }

    const settingsLayout = document.getElementById('settingsLayout');
    if (settingsLayout) {
        settingsLayout.addEventListener('click', () => {
            closeSettingsModal();
            showLayoutModal();
        });
    }

    if (settingsTheme) {
        settingsTheme.addEventListener('click', () => {
            closeSettingsModal();
            // Trigger theme toggle
            const themeToggle = document.getElementById('themeToggle');
            if (themeToggle) {
                themeToggle.click();
            }
        });
    }

    // Initialize layout modal
    initLayoutModal();

    // Update layout description on page load
    updateLayoutDescription(state.layoutMode);
}

/**
 * Show layout selection modal
 */
export function showLayoutModal() {
    populateLayoutOptions();
    openBottomSheet('layoutModal');
}

/**
 * Close layout modal
 */
export function closeLayoutModal() {
    closeBottomSheet('layoutModal');
}

/**
 * Populate layout options in modal as a 2-column grid
 */
function populateLayoutOptions() {
    const container = document.getElementById('layoutOptionsContainer');
    if (!container) return;

    const layouts = getAvailableLayouts('mobile');
    const currentLayout = state.layoutMode;

    let cardsHtml = '';

    layouts.forEach(layout => {
        const isActive = layout.id === currentLayout;

        cardsHtml += `
            <button class="layout-option-card${isActive ? ' active' : ''}" data-layout-id="${layout.id}">
                <div class="layout-option-card-icon">${layout.icon}</div>
                <div class="layout-option-card-name">${layout.name}</div>
            </button>
        `;
    });

    container.innerHTML = `<div class="layout-options-grid">${cardsHtml}</div>`;

    // Add click listeners
    container.querySelectorAll('.layout-option-card').forEach(card => {
        card.addEventListener('click', async () => {
            const layoutId = card.dataset.layoutId;
            await switchLayout(layoutId);

            // Update active state in grid
            container.querySelectorAll('.layout-option-card').forEach(c => {
                c.classList.toggle('active', c.dataset.layoutId === layoutId);
            });

            // Update current layout description in settings modal
            updateLayoutDescription(layoutId);

            closeLayoutModal();
        });
    });
}

/**
 * Update layout description in settings modal
 */
export function updateLayoutDescription(layoutId) {
    const layout = getLayoutById(layoutId);
    const descElement = document.getElementById('currentLayoutDescription');

    if (descElement) {
        descElement.textContent = layout.name;
    }
}

/**
 * Initialize layout modal listeners
 */
function initLayoutModal() {
    const layoutModalClose = document.getElementById('layoutModalClose');

    if (layoutModalClose) {
        layoutModalClose.addEventListener('click', closeLayoutModal);
    }
}
