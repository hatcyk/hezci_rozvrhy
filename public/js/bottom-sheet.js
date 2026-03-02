/**
 * Bottom Sheet Utility
 * Provides slide-up sheet modal pattern for mobile UI
 */

const openSheets = new Set();

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
    // Do NOT subtract vv.offsetTop — body.sheet-open has overflow:hidden so page can't scroll,
    // and offsetTop skews the calculation causing a gap between sheet and keyboard.
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

/**
 * Open a bottom sheet by ID
 * @param {string} id - Element ID of the bottom sheet
 * @param {Object} options
 * @param {boolean} options.fullHeight - Whether to use full height (95vh)
 */
export function openBottomSheet(id, options = {}) {
    const sheet = document.getElementById(id);
    if (!sheet) {
        console.error(`Bottom sheet not found: ${id}`);
        return;
    }

    // Create or reuse overlay (inserted immediately before the sheet)
    let overlay = sheet.previousElementSibling;
    if (!overlay || !overlay.classList.contains('bottom-sheet-overlay')) {
        overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay';
        sheet.parentNode.insertBefore(overlay, sheet);
    }

    if (options.fullHeight) {
        sheet.classList.add('bottom-sheet-full');
    }

    // Stack z-index so newer sheets always appear above earlier ones
    const level = openSheets.size;
    overlay.style.zIndex = 901 + level * 2;
    sheet.style.zIndex = 902 + level * 2;

    overlay.classList.add('active');
    sheet.classList.add('active');
    openSheets.add(id);

    document.body.classList.add('sheet-open');

    overlay.onclick = () => closeBottomSheet(id);

    initSheetSwipe(sheet, id);

    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            closeBottomSheet(id);
            document.removeEventListener('keydown', onKeyDown);
        }
    };
    document.addEventListener('keydown', onKeyDown);
    sheet._keyDownHandler = onKeyDown;
}

/**
 * Close a bottom sheet by ID
 * @param {string} id - Element ID
 */
export function closeBottomSheet(id) {
    const sheet = document.getElementById(id);
    if (!sheet) return;

    const overlay = sheet.previousElementSibling;

    sheet.classList.remove('active');
    sheet.style.zIndex = '';
    sheet.style.bottom = '';
    sheet.style.maxHeight = '';
    if (overlay && overlay.classList.contains('bottom-sheet-overlay')) {
        overlay.classList.remove('active');
        overlay.style.zIndex = '';
    }

    openSheets.delete(id);

    if (openSheets.size === 0) {
        document.body.classList.remove('sheet-open');
    }

    if (sheet._keyDownHandler) {
        document.removeEventListener('keydown', sheet._keyDownHandler);
        sheet._keyDownHandler = null;
    }
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
