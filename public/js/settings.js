/**
 * Nastavení (#settingsModal, a g-sheet <dialog>): grouped lists like iOS.
 *  - Vzhled: Systém / Světlý / Tmavý (theme.js setThemeMode) and the
 *    "Omezit průhlednost" switch (localStorage 'transparency', <html data-transparency>;
 *    index.html applies it before the first paint, tokens.css does the rest),
 *  - Rozvržení: whatever layout-registry.js offers for this screen size,
 *  - Upozornění: opens the notification sheet on top,
 *  - O aplikaci: version, author, data source, API attribution.
 */

import { state } from './state.js';
import { switchLayout } from './layout-manager.js';
import { getAvailableLayouts, getLayoutById } from './layout-registry.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';
import { showNotificationModal } from './notifications-modal.js';
import { getThemeMode, setThemeMode } from './theme.js';
import { esc, setPressed } from './utils.js';

const TRANSPARENCY_KEY = 'transparency';
const $ = (id) => document.getElementById(id);

/**
 * Show settings modal
 */
export function showSettingsModal() {
    syncAppearance();
    updateLayoutDescription(state.layoutMode);
    if (isLayoutPanelOpen()) populateInlineLayoutOptions();
    openBottomSheet('settingsModal');
}

/**
 * Close settings modal
 */
export function closeSettingsModal() {
    closeBottomSheet('settingsModal');
}

/* ── Vzhled ──────────────────────────────────────────────────────────── */

const systemReducesTransparency = () =>
    !!(window.matchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches);

/** Is reduced transparency on: the user's choice, otherwise the system setting. */
function transparencyReduced() {
    const attr = document.documentElement.getAttribute('data-transparency');
    if (attr === 'reduced') return true;
    if (attr === 'normal') return false;
    return systemReducesTransparency();
}

function setTransparency(reduced) {
    const value = reduced ? 'reduced' : 'normal';
    document.documentElement.setAttribute('data-transparency', value);
    try { localStorage.setItem(TRANSPARENCY_KEY, value); } catch { /* storage blocked: this visit only */ }
}

function syncAppearance() {
    const mode = getThemeMode();
    const group = $('settingsThemeMode');
    if (group) setPressed(group.querySelectorAll('button[data-theme-mode]'), b => b.dataset.themeMode === mode);
    const sw = $('settingsTransparency');
    if (sw) sw.checked = transparencyReduced();
}

function initAppearance() {
    const group = $('settingsThemeMode');
    if (group) {
        group.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-theme-mode]');
            if (!btn) return;
            setThemeMode(btn.dataset.themeMode);
            syncAppearance();
        });
    }
    // The night warning may confirm later, the system may switch: keep the buttons true
    new MutationObserver(syncAppearance).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-transparency'] });
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
            if (getThemeMode() === 'system') setThemeMode('system');
        });
        window.matchMedia('(prefers-reduced-transparency: reduce)').addEventListener('change', syncAppearance);
    }

    const sw = $('settingsTransparency');
    if (sw) sw.addEventListener('change', () => setTransparency(sw.checked));
    syncAppearance();
}

/* ── Rozvržení ───────────────────────────────────────────────────────── */

const platform = () => (window.innerWidth <= 1079 ? 'mobile' : 'desktop');

function isLayoutPanelOpen() {
    const panel = $('settingsLayoutPanel');
    return !!panel && !panel.hidden;
}

/**
 * Toggle inline layout panel inside settings modal (stays open for the next visit)
 */
function toggleLayoutPanel() {
    const panel = $('settingsLayoutPanel');
    if (!panel) return;
    const open = !isLayoutPanelOpen();
    if (open) populateInlineLayoutOptions();
    panel.hidden = !open;
    panel.inert = !open;
    const toggle = $('settingsLayout');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
}

/** Layout icon from the registry: a sprite name or (older registry) inline SVG. */
function layoutIcon(layout) {
    const ic = String(layout.icon || '');
    if (/^[a-z0-9-]+$/.test(ic)) return `<svg class="i" aria-hidden="true"><use href="icons.svg#${ic}"></use></svg>`;
    return ic ? `<span class="layout-option-card-icon" aria-hidden="true">${ic}</span>` : '';
}

/**
 * Populate layout options inline inside settings modal
 */
function populateInlineLayoutOptions() {
    const container = $('settingsLayoutOptionsContainer');
    if (!container) return;

    const layouts = getAvailableLayouts(platform());
    const currentLayout = state.layoutMode;

    container.innerHTML = `<div class="layout-options" role="group" aria-labelledby="setLayoutTitle">${layouts.map(layout => {
        const isActive = layout.id === currentLayout;
        return `<button type="button" class="layout-option-card set-row${isActive ? ' active' : ''}" data-layout-id="${esc(layout.id)}" aria-pressed="${isActive}">
                ${layoutIcon(layout)}
                <span class="set-row-text"><span class="set-row-title layout-option-card-name">${esc(layout.name)}</span>${layout.description ? `<span class="set-row-desc">${esc(layout.description)}</span>` : ''}</span>
                <svg class="i set-check" aria-hidden="true"><use href="icons.svg#check"></use></svg>
            </button>`;
    }).join('')}</div>`;

    container.querySelectorAll('.layout-option-card').forEach(card => {
        card.addEventListener('click', async () => {
            const layoutId = card.dataset.layoutId;
            await switchLayout(layoutId);
            setPressed(container.querySelectorAll('.layout-option-card'), c => c.dataset.layoutId === layoutId);
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
    const descElement = $('currentLayoutDescription');
    if (descElement && layout) descElement.textContent = layout.name;
}

/**
 * Initialize settings modal and event listeners
 */
export function initSettings() {
    const settingsToggle = $('settingsToggle');
    if (settingsToggle) settingsToggle.addEventListener('click', showSettingsModal);

    const settingsModalClose = $('settingsModalClose');
    if (settingsModalClose) settingsModalClose.addEventListener('click', closeSettingsModal);

    const settingsNotifications = $('settingsNotifications');
    if (settingsNotifications) {
        settingsNotifications.addEventListener('click', () => {
            // Keep settings open - the notification sheet opens on top, so its
            // back / Esc reveals settings again. Called directly: the header bell
            // is inert while this dialog is modal.
            showNotificationModal();
        });
    }

    const settingsLayout = $('settingsLayout');
    if (settingsLayout) settingsLayout.addEventListener('click', toggleLayoutPanel);

    initAppearance();

    // Update layout description on page load
    updateLayoutDescription(state.layoutMode);
}
