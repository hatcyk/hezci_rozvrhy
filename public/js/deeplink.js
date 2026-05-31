/**
 * Deep linking
 *
 * Lets a push notification (or its in-app toast) open the exact timetable the
 * change is about — the right entity, schedule and day — and briefly highlight
 * the changed lesson(s), instead of dumping the user on the default view.
 *
 * Used in two places:
 *  - main.js on boot, parsing the URL the service worker opened (/?type=...&id=...)
 *  - notifications-core.js when a foreground message's toast is clicked
 */

import { state, updateState } from './state.js';
import { dom } from './dom.js';

const VALID_TYPES = ['Class', 'Teacher', 'Room'];
const VALID_SCHEDULES = ['actual', 'next', 'permanent'];

/**
 * Parse deep-link parameters from a URL search string.
 * @param {string} [search=window.location.search]
 * @returns {null | { type, id, schedule, day, highlight }}
 */
export function parseDeepLinkParams(search = window.location.search) {
    const params = new URLSearchParams(search);
    const type = params.get('type');
    const id = params.get('id');

    if (!type || !id || !VALID_TYPES.includes(type)) return null;

    const schedule = (params.get('schedule') || 'Actual').toLowerCase();
    const dayRaw = params.get('day');
    const day = dayRaw !== null && dayRaw !== '' ? parseInt(dayRaw, 10) : null;

    return {
        type,
        id,
        schedule: VALID_SCHEDULES.includes(schedule) ? schedule : 'actual',
        day: Number.isInteger(day) && day >= 0 && day <= 4 ? day : null,
        highlight: params.get('hl') === 'change',
    };
}

function setActiveButton(buttons, datasetKey, value) {
    if (!buttons) return;
    buttons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset[datasetKey] === value);
    });
}

/**
 * Briefly highlight changed lessons in the current view and scroll the first one
 * into view. Works across layouts because every renderer marks changed lessons
 * with the `.changed` class.
 */
function pulseChangedLessons() {
    requestAnimationFrame(() => {
        const changed = document.querySelectorAll('.lesson-card.changed');
        if (changed.length === 0) return;

        changed.forEach(el => el.classList.add('deep-highlight'));
        changed[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

        setTimeout(() => {
            changed.forEach(el => el.classList.remove('deep-highlight'));
        }, 4500);
    });
}

/**
 * Apply a deep link: select the timetable + schedule + day and load it.
 * @param {{ type, id, schedule, day, highlight }} link
 */
export async function applyDeepLink(link) {
    if (!link || !link.type || !link.id) return;

    const { populateValueSelect, loadTimetable, selectDay } = await import('./timetable.js');
    const { setDropdownValue } = await import('./dropdown.js');

    // Entity type (Class/Teacher/Room)
    updateState('selectedType', link.type);
    setActiveButton(dom.typeButtons, 'type', link.type);

    // Schedule type (actual/next/permanent)
    updateState('selectedScheduleType', link.schedule);
    setActiveButton(dom.scheduleTypeButtons, 'schedule', link.schedule);

    // Populate the dropdown for this type and select the entity
    populateValueSelect();
    setDropdownValue(link.id);

    // Pre-select the day so the right one shows after load (mobile single-day view)
    if (link.day !== null && link.day !== undefined) {
        updateState('selectedDayIndex', link.day);
    }

    await loadTimetable();

    // Re-apply day selection now that the layout exists, then highlight changes.
    if (link.day !== null && link.day !== undefined) {
        try { await selectDay(link.day); } catch (_) { /* layout may handle it */ }
    }

    if (link.highlight) pulseChangedLessons();
}
