/**
 * Visible area above the on-screen keyboard (phones).
 *
 * iOS Safari and the installed app do not shrink the layout viewport when the
 * keyboard opens: the keyboard covers the page, and iOS may pan the visible
 * part (the visual viewport) down to show the focused field. position: fixed
 * counts from the layout viewport, so a bottom sheet with a search field ended
 * behind the keyboard, slid under the status bar, or out of sight entirely
 * (photos 7805, 7807). Chrome on Android behaves the same by default.
 *
 * watchVisibleArea() keeps the visible area in CSS variables on <html>
 *   --vv-top  how far the visible area is panned from the top of the layout viewport
 *   --vv-h    its height
 * and sets data-keyboard while the keyboard is open; sheets.css and shell.css
 * use them. createScrollLock() keeps the page behind an open sheet in place.
 */

/** A visual viewport this much shorter than the layout viewport is a keyboard, not a toolbar. */
export const KEYBOARD_MIN_PX = 150;

/**
 * @param {{ innerHeight: number, clientHeight?: number, vvHeight?: number, vvTop?: number, scale?: number }} m
 *   window.innerHeight, document.documentElement.clientHeight (the installed iOS app reports
 *   it without the status bar) and the visualViewport height, offsetTop and scale
 * @returns {{ top: number, height: number, keyboard: boolean } | null} null = leave the layout alone
 *   (no visualViewport, or pinch zoom: then the visible area is not the keyboard's doing)
 */
export function visibleArea({ innerHeight, clientHeight = 0, vvHeight, vvTop = 0, scale = 1 }) {
    if (!(vvHeight > 0) || Math.abs(scale - 1) > 0.01) return null;
    const layout = Math.max(innerHeight || 0, clientHeight || 0);
    return { top: Math.max(0, vvTop || 0), height: vvHeight, keyboard: layout - vvHeight > KEYBOARD_MIN_PX };
}

/**
 * Follow visualViewport resize and scroll.
 * @param {Window} [win]
 * @param {HTMLElement} [root] - default document.documentElement
 * @returns {() => void} stop
 */
export function watchVisibleArea(win = globalThis.window, root = null) {
    const vv = win && win.visualViewport;
    if (!vv) return () => {};
    root = root || document.documentElement;
    const apply = () => {
        const area = visibleArea({ innerHeight: win.innerHeight, clientHeight: root.clientHeight, vvHeight: vv.height, vvTop: vv.offsetTop, scale: vv.scale });
        if (area) {
            root.style.setProperty('--vv-top', `${area.top}px`);
            root.style.setProperty('--vv-h', `${area.height}px`);
        } else {
            root.style.removeProperty('--vv-top');
            root.style.removeProperty('--vv-h');
        }
        if (area && area.keyboard) root.setAttribute('data-keyboard', '');
        else root.removeAttribute('data-keyboard');
    };
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    apply();
    return () => {
        vv.removeEventListener('resize', apply);
        vv.removeEventListener('scroll', apply);
    };
}

/**
 * Lock the page behind open sheets: the body is fixed at its current scroll
 * position, so nothing behind the sheet scrolls or jumps when iOS reveals the
 * focused field, and the page returns to the same place afterwards.
 * Counts nested locks (a sheet opened over another).
 * @param {Window} [win] - default window
 * @param {HTMLElement} [body] - default document.body
 */
export function createScrollLock(win = null, body = null) {
    let depth = 0;
    let y = 0;
    const w = () => win || window;
    const b = () => body || document.body;
    return {
        lock() {
            if (depth++ > 0) return;
            y = w().scrollY || 0;
            Object.assign(b().style, { position: 'fixed', top: `-${y}px`, left: '0px', right: '0px' });
        },
        unlock() {
            if (depth === 0 || --depth > 0) return;
            Object.assign(b().style, { position: '', top: '', left: '', right: '' });
            w().scrollTo({ top: y, left: 0, behavior: 'instant' });
        },
    };
}
