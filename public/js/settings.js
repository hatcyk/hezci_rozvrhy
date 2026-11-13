/**
 * Settings Modal Module (Mobile Only)
 * Handles the settings modal that shows notifications, layout, and theme options on mobile
 */

import { state } from './state.js';
import { switchLayout } from './layout-manager.js';
import { getAvailableLayouts, getLayoutById } from './layout-registry.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';
import { showNotificationModal } from './notifications-modal.js';
import { toggleTheme } from './theme.js';
import { esc } from './utils.js';

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
            // Keep settings open - notification modal opens on top
            // so back button in notification modal will reveal settings again.
            // Called directly: the header bell is inert while this dialog is modal.
            showNotificationModal();
        });
    }

    const settingsLayout = document.getElementById('settingsLayout');
    if (settingsLayout) {
        settingsLayout.addEventListener('click', () => {
            toggleLayoutPanel();
        });
    }

    if (settingsTheme) {
        settingsTheme.addEventListener('click', () => {
            closeSettingsModal();
            toggleTheme();
        });
    }

    // Update layout description on page load
    updateLayoutDescription(state.layoutMode);
}

/**
 * Toggle inline layout panel inside settings modal
 */
function toggleLayoutPanel() {
    const panel = document.getElementById('settingsLayoutPanel');
    const arrow = document.getElementById('settingsLayoutArrow');
    if (!panel) return;

    const isOpen = panel.classList.contains('expanded');
    if (!isOpen) {
        populateInlineLayoutOptions();
    }
    panel.classList.toggle('expanded');
    if (arrow) arrow.classList.toggle('rotated', !isOpen);
    // Collapsed panel is only squeezed to 0 height: keep it out of Tab order
    panel.inert = isOpen;
    const toggle = document.getElementById('settingsLayout');
    if (toggle) toggle.setAttribute('aria-expanded', String(!isOpen));
}

/**
 * Populate layout options inline inside settings modal
 */
function populateInlineLayoutOptions() {
    const container = document.getElementById('settingsLayoutOptionsContainer');
    if (!container) return;

    const layouts = getAvailableLayouts('mobile');
    const currentLayout = state.layoutMode;

    let cardsHtml = '';
    layouts.forEach(layout => {
        const isActive = layout.id === currentLayout;
        cardsHtml += `
            <button type="button" class="layout-option-card${isActive ? ' active' : ''}" data-layout-id="${esc(layout.id)}" aria-pressed="${isActive}">
                <span class="layout-option-card-icon" aria-hidden="true">${layout.icon}</span>
                <span class="layout-option-card-name">${esc(layout.name)}</span>
            </button>
        `;
    });

    container.innerHTML = `<div class="layout-options-grid">${cardsHtml}</div>`;

    container.querySelectorAll('.layout-option-card').forEach(card => {
        card.addEventListener('click', async () => {
            const layoutId = card.dataset.layoutId;
            await switchLayout(layoutId);

            container.querySelectorAll('.layout-option-card').forEach(c => {
                const on = c.dataset.layoutId === layoutId;
                c.classList.toggle('active', on);
                c.setAttribute('aria-pressed', String(on));
            });

            updateLayoutDescription(layoutId);

            // Close the whole settings sheet, keep panel expanded for next open
            closeSettingsModal();
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

