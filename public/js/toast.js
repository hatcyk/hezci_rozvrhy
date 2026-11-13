/**
 * In-app toast notifications.
 *
 * Used to surface push messages that arrive while the app is in the foreground
 * (FCM does not show a system notification in that case), and any other transient
 * feedback. Pure vanilla, no dependencies.
 */

import { makeActivatable } from './utils.js';

let container = null;

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
 * @param {string} [opts.icon]            Emoji or short string shown in the badge
 * @param {'change'|'reminder'|'info'} [opts.variant='info']
 * @param {number} [opts.timeout=7000]    Auto-dismiss ms (0 = sticky)
 * @param {Function} [opts.onClick]       Called when the toast body is clicked
 * @returns {HTMLElement} the toast element
 */
export function showToast({ title, body = '', icon = '🔔', variant = 'info', timeout = 7000, onClick } = {}) {
    const root = ensureContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${variant}`;
    toast.setAttribute('role', 'status');

    const clickable = typeof onClick === 'function';
    toast.innerHTML = `
        <div class="toast-icon" aria-hidden="true">${icon}</div>
        <div class="toast-content${clickable ? ' toast-clickable' : ''}">
            <div class="toast-title"></div>
            ${body ? '<div class="toast-body"></div>' : ''}
        </div>
        <button type="button" class="toast-close" aria-label="Zavřít oznámení">&times;</button>
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
