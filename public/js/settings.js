/**
 * Settings Modal Module (Mobile Only)
 * Handles the settings modal that shows notifications, layout, and theme options on mobile
 */

import { state } from './state.js';
import { switchLayout } from './layout-manager.js';
import { getAvailableLayouts, getLayoutById } from './layout-registry.js';

/**
 * Show settings modal
 */
export function showSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

/**
 * Close settings modal
 */
export function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;

    // Add closing animation class
    modal.classList.add('closing');

    const onAnimationEnd = () => {
        modal.classList.add('hidden');
        modal.classList.remove('closing');
        modal.style.display = 'none';
        modal.removeEventListener('animationend', onAnimationEnd);
    };

    modal.addEventListener('animationend', onAnimationEnd);
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

    // Close on overlay click
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                closeSettingsModal();
            }
        });
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
    const modal = document.getElementById('layoutModal');
    if (!modal) return;

    // Populate layout options
    populateLayoutOptions();

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

/**
 * Close layout modal
 */
export function closeLayoutModal() {
    const modal = document.getElementById('layoutModal');
    if (!modal) return;

    // Add closing animation class
    modal.classList.add('closing');

    const onAnimationEnd = () => {
        modal.classList.add('hidden');
        modal.classList.remove('closing');
        modal.style.display = 'none';
        modal.removeEventListener('animationend', onAnimationEnd);
    };

    modal.addEventListener('animationend', onAnimationEnd);
}

/**
 * Populate layout options in modal
 */
function populateLayoutOptions() {
    const container = document.getElementById('layoutOptionsContainer');
    if (!container) return;

    const layouts = getAvailableLayouts('mobile');
    const currentLayout = state.layoutMode;

    let html = '';

    layouts.forEach(layout => {
        const isActive = layout.id === currentLayout;

        html += `
            <div class="layout-option ${isActive ? 'active' : ''}" data-layout-id="${layout.id}">
                <div class="layout-option-icon">
                    ${layout.icon}
                </div>
                <div class="layout-option-content">
                    <div class="layout-option-title">${layout.name}</div>
                    <div class="layout-option-description">${layout.description}</div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Add click listeners
    container.querySelectorAll('.layout-option').forEach(option => {
        option.addEventListener('click', async () => {
            const layoutId = option.dataset.layoutId;
            await switchLayout(layoutId);

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
    const layoutModal = document.getElementById('layoutModal');

    if (layoutModalClose) {
        layoutModalClose.addEventListener('click', closeLayoutModal);
    }

    if (layoutModal) {
        layoutModal.addEventListener('click', (e) => {
            if (e.target === layoutModal) {
                closeLayoutModal();
            }
        });
    }
}
