import { dom } from './dom.js';
import { isNightTime } from './suntime.js';

/** Browser UI colour (status bar, task switcher) per theme = --bg-color. */
export const THEME_COLORS = { dark: '#050A1A', light: '#14407D' };

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
 * "Switch to light at night?" confirmation. A native modal <dialog> styled as
 * a g-sheet (bottom sheet on phones, small dialog on desktop): focus starts on
 * the safe choice, Esc and a tap outside keep the dark theme, the page behind
 * is inert. The buttons say what happens.
 */
function showNightWarning(callback) {
    const dialog = document.createElement('dialog');
    dialog.className = 'g-sheet theme-warning';
    dialog.setAttribute('aria-labelledby', 'themeWarningTitle');
    dialog.setAttribute('aria-describedby', 'themeWarningBody');
    dialog.innerHTML = `
        <div class="g-sheet-handle" aria-hidden="true"></div>
        <div class="g-sheet-head theme-warning-head">
            <span class="theme-warning-icon" aria-hidden="true"><svg class="i"><use href="icons.svg#moon"></use></svg></span>
            <h2 id="themeWarningTitle">Přepnout na světlý režim?</h2>
        </div>
        <div class="g-sheet-body theme-warning-body" id="themeWarningBody">
            <p>Venku je tma. Noční obloha je šetrnější k očím i k baterii.</p>
        </div>
        <div class="theme-warning-actions">
            <button type="button" class="g-btn theme-warning-cancel" autofocus>Nechat tmavý</button>
            <button type="button" class="g-btn g-btn--primary theme-warning-confirm">Přepnout na světlý</button>
        </div>
    `;

    document.body.appendChild(dialog);
    dialog.showModal();

    const confirmBtn = dialog.querySelector('.theme-warning-confirm');
    const cancelBtn = dialog.querySelector('.theme-warning-cancel');
    let closed = false;

    const closeDialog = (confirmed) => {
        if (closed) return;
        closed = true;
        dialog.setAttribute('data-closing', '');

        const finish = () => {
            if (dialog.open) dialog.close();
            dialog.remove();
        };
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) finish();
        else {
            dialog.addEventListener('transitionend', (e) => { if (e.target === dialog) finish(); });
            setTimeout(finish, 400); // safety net (no transition)
        }

        if (confirmed) {
            callback();
        }
    };

    confirmBtn.addEventListener('click', () => closeDialog(true));
    cancelBtn.addEventListener('click', () => closeDialog(false));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(false); });
    dialog.addEventListener('close', () => { if (!closed) { closed = true; dialog.remove(); } });
    // Tap on the dimmed area outside the sheet
    dialog.addEventListener('click', (e) => {
        if (e.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog(false);
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

// agent V: režim vzhledu v Nastavení (Systém / Světlý / Tmavý), používá settings.js

/** Appearance mode: the saved 'light' / 'dark', or 'system' when nothing is saved. */
export function getThemeMode() {
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch { /* storage blocked */ }
    return saved === 'light' || saved === 'dark' ? saved : 'system';
}

/**
 * Set the appearance mode. 'system' forgets the saved choice and follows
 * prefers-color-scheme again; switching to light at night asks first (the same
 * warning as the old header toggle) and changes nothing when cancelled.
 * @param {'system'|'light'|'dark'} mode
 */
export function setThemeMode(mode) {
    if (mode === 'system') {
        try { localStorage.removeItem('theme'); } catch { /* storage blocked */ }
        setTheme(systemPrefersLight() ? 'light' : 'dark', { persist: false });
        return;
    }
    if (mode !== 'light' && mode !== 'dark') return;
    const current = document.documentElement.getAttribute('data-theme');
    if (mode === 'light' && current !== 'light' && isNightTime()) {
        showNightWarning(() => setTheme('light'));
        return;
    }
    setTheme(mode);
}
