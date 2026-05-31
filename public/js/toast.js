/**
 * In-app toast notifications.
 *
 * Used to surface push messages that arrive while the app is in the foreground
 * (FCM does not show a system notification in that case), and any other transient
 * feedback. Pure vanilla, no dependencies.
 */

let container = null;

function ensureContainer() {
    if (container && document.body.contains(container)) return container;
    container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        document.body.appendChild(container);
    }
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
        <button class="toast-close" aria-label="Zavřít">&times;</button>
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
        toast.querySelector('.toast-content').addEventListener('click', () => {
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
