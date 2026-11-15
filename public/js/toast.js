/**
 * In-app toast notifications.
 *
 * Used to surface push messages that arrive while the app is in the foreground
 * (FCM does not show a system notification in that case), and any other transient
 * feedback. Pure vanilla, no dependencies.
 *
 * Design G: a glass capsule (g-toast g-glass) above the floating tab bar on a
 * phone, bottom right on a computer, with an icon from the sprite.
 */

import { makeActivatable } from './utils.js';

let container = null;

/** Sprite icon per variant when the caller passes an emoji or nothing usable. */
const VARIANT_ICON = { change: 'repeat-2', reminder: 'clock', info: 'info' };
/** Emoji used by older callers → sprite icon of the same meaning. */
const EMOJI_ICON = { '⚠️': 'triangle-alert', 'ℹ️': 'info', '✅': 'circle-check', '❌': 'circle-x', '🔔': 'bell', '🔗': 'link', '📅': 'calendar-plus', '🔄': 'repeat-2', '⏰': 'clock', '⭐': 'star' };

function iconName(icon, variant) {
    if (typeof icon === 'string' && /^[a-z0-9-]+$/.test(icon)) return icon;
    return EMOJI_ICON[icon] || VARIANT_ICON[variant] || 'info';
}

/**
 * Where toasts must live: inside the topmost open modal <dialog>, if any.
 * showModal() makes everything outside the dialog inert, so a toast in <body>
 * would sit under the backdrop, its close button would not react and screen
 * readers would not announce it.
 */
function toastHost() {
    const open = [...document.querySelectorAll('dialog[open]:not([data-closing])')]
        .filter(d => { try { return d.matches(':modal'); } catch { return true; } })
        .sort((a, b) => (Number(a.dataset.openSeq) || 0) - (Number(b.dataset.openSeq) || 0));
    return open.pop() || document.body;
}

function ensureContainer() {
    if (!container) container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
    }
    const host = toastHost();
    if (container.parentNode !== host) host.appendChild(container);
    return container;
}

/**
 * Show a toast.
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {string} [opts.icon]            Sprite icon name (icons.svg), e.g. 'link'; emoji of older callers are mapped
 * @param {'change'|'reminder'|'info'} [opts.variant='info']
 * @param {number} [opts.timeout=7000]    Auto-dismiss ms (0 = sticky)
 * @param {Function} [opts.onClick]       Called when the toast body is clicked
 * @returns {HTMLElement} the toast element
 */
export function showToast({ title, body = '', icon = '', variant = 'info', timeout = 7000, onClick } = {}) {
    const root = ensureContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${variant} g-toast g-glass`;
    toast.setAttribute('role', 'status');

    const clickable = typeof onClick === 'function';
    const name = iconName(icon, variant);
    toast.innerHTML = `
        <span class="toast-icon" aria-hidden="true"><svg class="i"><use href="icons.svg#${name}"></use></svg></span>
        <div class="toast-content${clickable ? ' toast-clickable' : ''}">
            <div class="toast-title"></div>
            ${body ? '<div class="toast-body"></div>' : ''}
        </div>
        <button type="button" class="toast-close" aria-label="Zavřít oznámení"><svg class="i" aria-hidden="true"><use href="icons.svg#x"></use></svg></button>
    `;
    // Use textContent to avoid HTML injection from notification payloads.
    toast.querySelector('.toast-title').textContent = title || '';
    if (body) toast.querySelector('.toast-body').textContent = body;

    let dismissed = false;
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        toast.classList.add('toast-leaving');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
        // Safety net if animationend doesn't fire
        setTimeout(() => toast.remove(), 400);
    };

    toast.querySelector('.toast-close').addEventListener('click', (e) => {
        e.stopPropagation();
        dismiss();
    });

    if (clickable) {
        // Keyboard users can open the deep link too (Enter / Space)
        makeActivatable(toast.querySelector('.toast-content'), () => {
            try { onClick(); } finally { dismiss(); }
        });
    }

    root.appendChild(toast);
    // Trigger enter animation on next frame
    requestAnimationFrame(() => toast.classList.add('toast-in'));

    if (timeout > 0) {
        setTimeout(dismiss, timeout);
    }

    return toast;
}
