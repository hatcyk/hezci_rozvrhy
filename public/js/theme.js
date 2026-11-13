import { dom } from './dom.js';
import { isNightTime } from './suntime.js';

/** Browser UI colour (status bar, task switcher) per theme = --bg-color. */
export const THEME_COLORS = { dark: '#071422', light: '#F8FAFC' };

/**
 * Theme for this visit: the user's saved choice, otherwise the system setting
 * (prefers-color-scheme). It used to fall back to dark for everybody.
 * @param {string|null} saved - localStorage 'theme'
 * @param {boolean} systemPrefersLight
 */
export function resolveInitialTheme(saved, systemPrefersLight) {
    if (saved === 'light' || saved === 'dark') return saved;
    return systemPrefersLight ? 'light' : 'dark';
}

function systemPrefersLight() {
    return typeof window !== 'undefined' && !!window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: light)').matches;
}

// Theme management
export function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch { /* storage blocked */ }
    // Not persisted here: until the user picks one, the system setting keeps applying
    setTheme(resolveInitialTheme(saved, systemPrefersLight()), { persist: false });
}

export function setTheme(theme, { persist = true } = {}) {
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) {
        try { localStorage.setItem('theme', theme); } catch { /* storage blocked */ }
    }

    // Both media-specific theme-color metas follow the chosen theme, so a user
    // who picked light on a dark-mode phone does not get a dark status bar.
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
        meta.setAttribute('content', THEME_COLORS[theme] || THEME_COLORS.dark);
    });

    if (!dom.themeToggle) return;

    const sunIcon = dom.themeToggle.querySelector('.sun-icon');
    const moonIcon = dom.themeToggle.querySelector('.moon-icon');

    if (theme === 'light') {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
    } else {
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
    }
    dom.themeToggle.setAttribute('aria-label', theme === 'light' ? 'Přepnout na tmavý režim' : 'Přepnout na světlý režim');
    dom.themeToggle.setAttribute('title', theme === 'light' ? 'Přepnout na tmavý režim' : 'Přepnout na světlý režim');
}

/**
 * "Switch to light at night?" confirmation. A native modal <dialog>: focus
 * starts on the safe choice (Zrušit), Esc cancels, the page behind is inert.
 */
function showNightWarning(callback) {
    const dialog = document.createElement('dialog');
    dialog.className = 'theme-warning-overlay';
    dialog.setAttribute('aria-labelledby', 'themeWarningTitle');
    dialog.setAttribute('aria-describedby', 'themeWarningBody');
    dialog.innerHTML = `
        <div class="theme-warning-dialog">
            <div class="theme-warning-header">
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <h3 id="themeWarningTitle">Přepnout na světlý režim?</h3>
            </div>
            <div class="theme-warning-body" id="themeWarningBody">
                <p>Venku je tma. Tmavý režim je šetrnější k očím a baterii.</p>
                <p>Opravdu chcete přepnout na světlý režim?</p>
            </div>
            <div class="theme-warning-actions">
                <button type="button" class="theme-warning-btn theme-warning-cancel" autofocus>Zrušit</button>
                <button type="button" class="theme-warning-btn theme-warning-confirm">Přepnout</button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);
    dialog.showModal();

    // Fade in
    requestAnimationFrame(() => {
        dialog.classList.add('visible');
    });

    const confirmBtn = dialog.querySelector('.theme-warning-confirm');
    const cancelBtn = dialog.querySelector('.theme-warning-cancel');
    let closed = false;

    const closeDialog = (confirmed) => {
        if (closed) return;
        closed = true;
        dialog.setAttribute('data-closing', '');
        dialog.classList.add('closing');
        dialog.classList.remove('visible');

        const finish = () => {
            if (dialog.open) dialog.close();
            dialog.remove();
        };
        dialog.addEventListener('animationend', finish, { once: true });
        setTimeout(finish, 700); // safety net (reduced motion, no animation)

        if (confirmed) {
            callback();
        }
    };

    confirmBtn.addEventListener('click', () => closeDialog(true));
    cancelBtn.addEventListener('click', () => closeDialog(false));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(false); });
    dialog.addEventListener('close', () => { if (!closed) { closed = true; dialog.remove(); } });
    // Click on the dimmed area outside the box
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) closeDialog(false);
    });
}

export function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    // Check if switching to light mode during nighttime
    if (newTheme === 'light' && isNightTime()) {
        showNightWarning(() => {
            setTheme(newTheme);
        });
    } else {
        setTheme(newTheme);
    }
}

export function initThemeToggle() {
    if (dom.themeToggle) {
        dom.themeToggle.addEventListener('click', toggleTheme);
    }
}
