import { dom } from './dom.js';
import { state, updateState } from './state.js';
import { days } from './constants.js';
import { getTodayIndex, getMondayOfWeek, setPressed } from './utils.js';
import { fetchTimetable } from './api.js';
import { populateDropdown, getDropdownValue } from './dropdown.js';
import { refreshNextLessonWidget } from './next-lesson.js';
import { DAY_SHORT, addDays, czDate, weekMonday, dayChangeEntries, isThisWeek } from './rozvrh-core.js';
import { czPlural } from './changes-core.js';

/* ── načítání: zástupné bloky (g-skel) podle rozvržení ─────────────────── */

const repeat = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('');

function skelDay() {
    return `<div class="sk-tl g-veil">${repeat(6, (i) => `<div class="sk-tl-row"><span class="g-skel sk-time"></span><span class="g-skel sk-block" style="--w:${[92, 80, 88, 74, 90, 84][i]}%"></span></div>`)}</div>`;
}
function skelWeek() {
    return `<div class="sk-cal g-veil"><div class="sk-cal-head">${repeat(5, () => '<span class="g-skel sk-dh"></span>')}</div>
        <div class="sk-cal-body">${repeat(5, () => `<div class="sk-col">${repeat(6, () => '<span class="g-skel sk-ev"></span>')}</div>`)}</div></div>`;
}
function skelList() {
    return `<div class="sk-list g-veil">${repeat(6, () => '<div class="sk-row"><span class="g-skel sk-time"></span><span class="sk-lines"><span class="g-skel sk-line" style="--w:55%"></span><span class="g-skel sk-line" style="--w:35%"></span></span></div>')}</div>`;
}
function skelCard() {
    return '<div class="sk-card g-veil"><span class="g-skel sk-line" style="--w:40%"></span><span class="g-skel sk-big"></span><span class="g-skel sk-line" style="--w:70%"></span><span class="g-skel sk-line" style="--w:55%"></span></div>';
}

const SKELETON_BUILDERS = {
    'week-view': skelWeek,
    'day': skelDay,
    'card-view': skelCard,
    'compact-list': skelList,
};

function ensureSkeletonElement() {
    let el = document.getElementById('timetableSkeleton');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'timetableSkeleton';
    el.className = 'timetable-skeleton hidden';
    const host = document.getElementById('timetableHost');
    if (host) host.insertBefore(el, host.firstChild);
    return el;
}

function showSkeleton() {
    const el = ensureSkeletonElement();
    if (!el) return;
    const mode = state.layoutMode;
    if (el.dataset.skelKey !== mode) {
        el.innerHTML = (SKELETON_BUILDERS[mode] || skelDay)();
        el.dataset.skelKey = mode;
    }
    // Viditelný indikátor nesmí být aria-hidden: dokud se načítá, je to stavová oblast
    el.removeAttribute('aria-hidden');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-busy', 'true');
    el.setAttribute('aria-label', 'Načítání rozvrhu');
    el.classList.remove('hidden');
    document.documentElement.dataset.loading = 'true';
}

function hideSkeleton() {
    const el = document.getElementById('timetableSkeleton');
    if (el) {
        el.setAttribute('aria-busy', 'false');
        el.classList.add('hidden');
    }
    delete document.documentElement.dataset.loading;
}

// Populate value selector (items of the selected type, for label lookups)
export function populateValueSelect() {
    let data = [];

    if (state.selectedType === 'Class') data = state.definitions.classes || [];
    else if (state.selectedType === 'Teacher') data = state.definitions.teachers || [];
    else if (state.selectedType === 'Room') data = state.definitions.rooms || [];

    if (data.length > 0) {
        data = [...data].sort((a, b) => a.name.localeCompare(b.name, 'cs', { numeric: true }));
    }

    const items = data
        .filter(item => item.id && item.id.trim() !== '' && item.name && item.name.trim() !== '')
        .map(item => ({ value: item.id, label: item.name }));

    populateDropdown(items);
}

/* ── týden zobrazeného rozvrhu ─────────────────────────────────────────── */

/** Pondělí zobrazeného týdne (Date) nebo null u stálého rozvrhu. */
export function shownMonday() {
    if (state.selectedScheduleType === 'permanent') return null;
    const fallback = getMondayOfWeek(state.selectedScheduleType === 'next' ? 1 : 0);
    return weekMonday(state.currentTimetableData, fallback);
}

/**
 * Je zobrazený den dnešek? Rozhoduje datum zobrazených dat: týden z minulého
 * týdne (výpadek sběru, stará kopie offline) dnešek nemá.
 */
export function isShownToday(dayIndex) {
    return dayIndex === getTodayIndex() && isThisWeek(shownMonday());
}

// Week strip ("pás týdne"): circles with the dates, today in gold
export function createDaySelector() {
    if (!dom.daySelector) return;

    const todayIndex = getTodayIndex();

    // Výchozí vybraný den je dnes, nebo pondělí pokud je víkend
    if (state.selectedDayIndex === null) {
        updateState('selectedDayIndex', todayIndex >= 0 ? todayIndex : 0);
    }

    const monday = shownMonday();
    const data = state.currentTimetableData || [];
    dom.daySelector.innerHTML = '';

    DAY_SHORT.forEach((short, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wk-day';
        const date = monday ? addDays(monday, index) : null;
        const changes = dayChangeEntries(data.filter(l => l.day === index)).length;
        // Viditelný text je jméno (WCAG 2.5.3): „St 4“; celé datum a změny jako popis
        btn.innerHTML = `<span class="wk-dn">${short}</span><span class="wk-num">${date ? date.getDate() : short}</span>`
            + `<span class="wk-dot${changes ? ' on' : ''}" aria-hidden="true"></span>`
            + (changes ? `<span class="vh">, ${czPlural(changes, ['změna', 'změny', 'změn'])}</span>` : '');
        if (!date) btn.classList.add('no-date');
        btn.title = date ? `${days[index]} ${czDate(date)}` : days[index];
        if (isShownToday(index)) {
            btn.classList.add('today-btn');
            btn.setAttribute('aria-current', 'date');
        }
        btn.addEventListener('click', () => selectDay(index));
        dom.daySelector.appendChild(btn);
    });
    updateActiveDayButton();
}

// Update active day button without rebuilding DOM
function updateActiveDayButton() {
    if (!dom.daySelector) return;

    const buttons = [...dom.daySelector.querySelectorAll('button')];
    setPressed(buttons, (btn) => buttons.indexOf(btn) === state.selectedDayIndex);
}

// Select a day (week strip, swipe, ‹ ›, week row of the overview)
export async function selectDay(index) {
    updateState('selectedDayIndex', index);
    updateActiveDayButton();

    // Reset card view index when switching days
    const { updateLayoutPreference, applyLayout } = await import('./layout-manager.js');
    updateLayoutPreference('card-view', { cardIndex: 0 });

    await applyLayout();
}

/**
 * Kept for compatibility: the layouts render themselves (layout-renderers.js).
 * @deprecated
 */
export function renderTimetable() {}

// Load timetable
export async function loadTimetable() {
    if (!dom.errorDiv || !dom.timetableGrid) {
        console.error('Required DOM elements not found');
        return;
    }

    const id = getDropdownValue();

    if (!id) return;

    // Uložit do paměti pro příště
    try {
        localStorage.setItem('selectedType', state.selectedType);
        localStorage.setItem('selectedValue', id);
    } catch { /* storage blocked */ }

    dom.errorDiv.classList.add('hidden');
    dom.timetableGrid.innerHTML = '';
    showSkeleton();
    document.dispatchEvent(new CustomEvent('timetableloading'));

    try {
        // The current Monday is only part of the session-cache key, so a tab left
        // open over a weekend does not keep serving last week's timetable.
        const monday = getMondayOfWeek(0);
        const dateParam = monday.toISOString().split('T')[0]; // Format: YYYY-MM-DD

        const data = await fetchTimetable(state.selectedType, id, state.selectedScheduleType, dateParam);

        // Filter out "empty" absent lessons (placeholders)
        // These usually have the date as the subject and no teacher
        const filteredData = data.filter(lesson => {
            if (lesson.type === 'absent') {
                const isDatePlaceholder = /^[a-zá-ž]{2,3}\s\d{1,2}\.\d{1,2}\.?$/i.test(lesson.subject);
                if (isDatePlaceholder && !lesson.teacher) {
                    return false;
                }
            }
            return true;
        });

        updateState('currentTimetableData', filteredData);
        hideSkeleton();
        createDaySelector();

        // Reset card view index when switching timetables
        const { applyLayout, updateLayoutPreference } = await import('./layout-manager.js');
        updateLayoutPreference('card-view', { cardIndex: 0 });

        await applyLayout();

        // Overview, "now" card and the counts for the freshly loaded timetable
        refreshNextLessonWidget();
        document.dispatchEvent(new CustomEvent('timetableloaded'));

    } catch (e) {
        dom.errorDiv.textContent = e.message;
        dom.errorDiv.classList.remove('hidden');
        document.dispatchEvent(new CustomEvent('timetableloaded', { detail: { error: e.message } }));
    } finally {
        hideSkeleton();
    }
}
