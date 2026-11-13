/**
 * Bottom Sheet Utility
 *
 * Every sheet is a native <dialog> opened with showModal(): the browser makes
 * the page behind it inert, keeps focus inside, closes it on Esc / the Android
 * back gesture and returns focus to the control that opened it (WCAG 2.1.2,
 * 2.4.3, 4.1.2). The old <div> sheets had none of that - Tab walked out into
 * the page behind and focus was lost on close.
 *
 * Kept from the old implementation: slide-up animation (.active class),
 * swipe-down on the handle, tap on the backdrop to close, keyboard offset.
 */

const openSheets = new Set();
let openSeq = 0;

// Disable CSS transitions during viewport resize to prevent cross-breakpoint sliding
let resizeTimer = null;
window.addEventListener('resize', () => {
    document.body.classList.add('no-transitions');
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        document.body.classList.remove('no-transitions');
    }, 150);
}, { passive: true });

// Reposition active sheets when virtual keyboard appears/disappears (mobile)
function adjustSheetsForViewport() {
    if (!window.visualViewport || openSheets.size === 0) return;

    const vv = window.visualViewport;
    // Keyboard height = how much the visual viewport shrank from the layout viewport
    const keyboardOffset = Math.max(0, window.innerHeight - vv.height);

    openSheets.forEach(id => {
        const sheet = document.getElementById(id);
        if (!sheet || !sheet.classList.contains('active')) return;
        sheet.style.bottom = keyboardOffset + 'px';
        sheet.style.maxHeight = (vv.height * 0.95) + 'px';
    });
}

if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', adjustSheetsForViewport, { passive: true });
    window.visualViewport.addEventListener('scroll', adjustSheetsForViewport, { passive: true });
}

const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Was the pointer outside the dialog box (i.e. on its ::backdrop)? */
function isOutside(e, dialog) {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

/** One-time wiring of a sheet <dialog>: Esc, backdrop tap and cleanup on close. */
function wireDialog(sheet, id) {
    if (sheet._sheetWired) return;
    sheet._sheetWired = true;

    // Esc / back gesture: run our animated close instead of the instant one.
    // If the browser ignores preventDefault (repeated Esc without user
    // activation), the dialog closes directly and 'close' below cleans up.
    sheet.addEventListener('cancel', (e) => {
        e.preventDefault();
        closeBottomSheet(id);
    });

    // Light dismiss: tap on the backdrop. Pointer position is tested, not the
    // event target - the <dialog> itself is the target for its own padding.
    // Press and release must both be outside, so a drag that ends on the
    // backdrop (text selection, swipe) does not close it.
    let pressedOutside = false;
    sheet.addEventListener('pointerdown', (e) => { pressedOutside = isOutside(e, sheet); });
    sheet.addEventListener('pointerup', (e) => {
        if (pressedOutside && isOutside(e, sheet)) closeBottomSheet(id);
        pressedOutside = false;
    });

    sheet.addEventListener('close', () => cleanup(sheet, id));
}

function cleanup(sheet, id) {
    clearTimeout(sheet._closeTimer);
    sheet.classList.remove('active');
    sheet.removeAttribute('data-closing');
    sheet.style.bottom = '';
    sheet.style.maxHeight = '';
    sheet.style.transform = '';
    openSheets.delete(id);
    if (openSheets.size === 0) {
        document.body.classList.remove('sheet-open');
    }
}

/**
 * Open a bottom sheet by ID
 * @param {string} id - Element ID of the bottom sheet (<dialog class="bottom-sheet">)
 * @param {Object} options
 * @param {boolean} options.fullHeight - Whether to use full height (95vh)
 */
export function openBottomSheet(id, options = {}) {
    const sheet = document.getElementById(id);
    if (!sheet) {
        console.error(`Bottom sheet not found: ${id}`);
        return;
    }

    if (options.fullHeight) {
        sheet.classList.add('bottom-sheet-full');
    }

    wireDialog(sheet, id);
    clearTimeout(sheet._closeTimer);
    sheet.removeAttribute('data-closing');

    if (!sheet.open) {
        if (typeof sheet.showModal === 'function') {
            sheet.showModal();
        } else {
            sheet.setAttribute('open', ''); // very old browsers: at least visible
        }
        // Commit the closed (off-screen) position before adding .active so the
        // slide-in transition runs instead of jumping.
        void sheet.offsetHeight;
    }
    sheet.dataset.openSeq = String(++openSeq);

    sheet.classList.add('active');
    openSheets.add(id);
    document.body.classList.add('sheet-open');

    initSheetSwipe(sheet, id);
}

/**
 * Close a bottom sheet by ID (animated; the <dialog> closes when the slide-out ends)
 * @param {string} id - Element ID
 */
export function closeBottomSheet(id) {
    const sheet = document.getElementById(id);
    if (!sheet) return;

    if (!sheet.open) {
        cleanup(sheet, id);
        return;
    }
    if (sheet.hasAttribute('data-closing')) return;

    sheet.setAttribute('data-closing', '');
    sheet.classList.remove('active');

    const finish = () => {
        if (!sheet.hasAttribute('data-closing')) return; // reopened meanwhile
        if (sheet.open && typeof sheet.close === 'function') sheet.close();
        else sheet.removeAttribute('open');
        cleanup(sheet, id);
    };

    if (prefersReducedMotion() || document.body.classList.contains('no-transitions')) {
        finish();
        return;
    }
    const onEnd = (e) => {
        if (e.target !== sheet) return;
        sheet.removeEventListener('transitionend', onEnd);
        finish();
    };
    sheet.addEventListener('transitionend', onEnd);
    // Safety net when no transition runs (display changes, interrupted swipe)
    sheet._closeTimer = setTimeout(() => {
        sheet.removeEventListener('transitionend', onEnd);
        finish();
    }, 450);
}

/**
 * Initialize swipe-down-to-dismiss gesture
 */
function initSheetSwipe(sheet, id) {
    const handle = sheet.querySelector('.bottom-sheet-handle');
    const dragTarget = handle || sheet;

    if (dragTarget._sheetAbortController) {
        dragTarget._sheetAbortController.abort();
    }

    const controller = new AbortController();
    dragTarget._sheetAbortController = controller;
    const signal = controller.signal;

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    dragTarget.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        currentY = startY;
        isDragging = true;
        sheet.style.transition = 'none';
    }, { passive: true, signal });

    dragTarget.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        const diff = currentY - startY;
        if (diff > 0) {
            sheet.style.transform = `translateY(${diff}px)`;
        }
    }, { passive: true, signal });

    dragTarget.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        sheet.style.transition = '';

        if (currentY - startY > 100) {
            sheet.style.transform = '';
            closeBottomSheet(id);
        } else {
            sheet.style.transform = '';
        }
    }, { passive: true, signal });
}
