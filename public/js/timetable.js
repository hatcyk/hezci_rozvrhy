import { dom } from './dom.js';
import { state, updateState } from './state.js';
import { days, daysShort, lessonTimes, SKELETON_METRICS } from './constants.js';
import {
    abbreviateSubject,
    abbreviateTeacherName,
    standardizeGroupName,
    getTodayIndex,
    getCurrentHour,
    getUpcomingHour,
    isPastLesson,
    parseGroupName
} from './utils.js';
import { showLessonModal } from './modal.js';
import { fetchTimetable } from './api.js';
import { getMondayOfWeek } from './utils.js';
import { populateDropdown, getDropdownValue } from './dropdown.js';
import { refreshNextLessonWidget } from './next-lesson.js';

// Loading skeleton shown while a timetable is being fetched. The skeleton
// mirrors the active layout (state.layoutMode) and is sized to fill the
// viewport. Counts are computed in JS and passed to CSS via inline custom
// props (--skel-rows / --skel-cols).

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const repeat = (n, fn) => Array.from({ length: n }).map((_, i) => fn(i)).join('');

// Ensure the skeleton container exists (some renderers wipe
// .timetable-container.innerHTML, so re-create it lazily as the first child).
function ensureSkeletonElement() {
    let el = document.getElementById('timetableSkeleton');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'timetableSkeleton';
    el.className = 'timetable-skeleton hidden';

    const container = document.querySelector('.timetable-container');
    if (container) {
        container.insertBefore(el, container.firstChild);
    } else {
        const grid = document.getElementById('timetable');
        if (grid && grid.parentNode) {
            grid.parentNode.insertBefore(el, grid);
        } else {
            document.body.appendChild(el);
        }
    }
    return el;
}

// Figure out how many rows/cols fit into the available box.
function computeSkeletonFit(el) {
    const m = SKELETON_METRICS;
    // The skeleton is display:none when measured, so its own box collapses to 0.
    // Measure the (visible) container instead, so available height excludes the
    // header/day-selector/widget chrome above it and we don't over-count rows.
    const box = el.parentElement || el;
    const rect = box.getBoundingClientRect();
    const top = rect.height > 0 ? rect.top : (el.getBoundingClientRect().top || rect.top);
    const availH = Math.max(rect.height, window.innerHeight - top);
    const availW = box.clientWidth || el.clientWidth || window.innerWidth;

    const rows = clamp(
        Math.floor((availH + m.GAP) / (m.ROW_HEIGHT + m.GAP)),
        m.MIN_ROWS,
        m.MAX_HOURS
    );
    const gridCols = clamp(
        Math.floor((availW - m.HOUR_COL_WIDTH) / m.COL_WIDTH),
        1,
        m.MAX_HOURS
    );
    const gridRows = m.MAX_DAYS; // always all weekdays

    return { availH, availW, rows, gridRows, gridCols };
}

function buildWeekSkeleton(fit) {
    const cols = fit.gridCols;
    const head =
        '<div class="skel-grid-head"><div class="skel-corner"></div>' +
        repeat(cols, () => '<div class="skel-dayhdr"></div>') +
        '</div>';
    const body =
        '<div class="skel-grid-body">' +
        repeat(fit.gridRows, () =>
            '<div class="skel-rowline"><div class="skel-timecell"></div>' +
            repeat(cols, () => '<div class="skel-cell"></div>') +
            '</div>'
        ) +
        '</div>';
    return '<div class="skel-grid">' + head + body + '</div>';
}

function buildSingleDaySkeleton(fit) {
    return repeat(fit.rows, () =>
        '<div class="skel-row"><div class="skel-timechip"></div><div class="skel-block"></div></div>'
    );
}

function buildCardSkeleton() {
    return (
        '<div class="skel-peek skel-peek-l"></div>' +
        '<div class="skel-bigcard">' +
            '<div class="skel-card-head"><div class="skel-line w35"></div><div class="skel-badge"></div></div>' +
            '<div class="skel-line w70"></div>' +
            '<div class="skel-line"></div>' +
            '<div class="skel-line w55"></div>' +
        '</div>' +
        '<div class="skel-peek skel-peek-r"></div>' +
        '<div class="skel-dots"><div class="skel-dot skel-dot-active"></div><div class="skel-dot"></div><div class="skel-dot"></div></div>'
    );
}

function buildListSkeleton(fit) {
    return repeat(fit.rows, () =>
        '<div class="skel-crow"><div class="skel-cbadge"></div><div class="skel-cbody"><div class="skel-line w55"></div><div class="skel-line w35"></div></div></div>'
    );
}

function buildAgendaSkeleton(fit) {
    return repeat(fit.rows, () =>
        '<div class="skel-arow"><div class="skel-atime"></div><div class="skel-acard"><div class="skel-line w55"></div><div class="skel-line w35"></div></div></div>'
    );
}

const SKELETON_BUILDERS = {
    'week-view': buildWeekSkeleton,
    'single-day': buildSingleDaySkeleton,
    'card-view': buildCardSkeleton,
    'compact-list': buildListSkeleton,
    'agenda': buildAgendaSkeleton
};

const SKELETON_MODIFIERS = {
    'week-view': 'skel-week',
    'single-day': 'skel-day',
    'card-view': 'skel-card-view',
    'compact-list': 'skel-compact',
    'agenda': 'skel-agenda'
};

function showSkeleton() {
    const el = ensureSkeletonElement();
    const fit = computeSkeletonFit(el);
    const mode = state.layoutMode;
    const builder = SKELETON_BUILDERS[mode] || buildListSkeleton;
    const modifier = SKELETON_MODIFIERS[mode] || 'skel-compact';

    const key = `${mode}|${fit.rows}|${fit.gridCols}`;

    if (el.dataset.skelKey === key && el.childElementCount > 0) {
        revealSkeleton(el);
        return;
    }

    el.className = `timetable-skeleton ${modifier}`;
    el.style.setProperty('--skel-rows', String(fit.rows));
    if (mode === 'week-view') {
        el.style.setProperty('--skel-cols', String(fit.gridCols));
    } else {
        el.style.removeProperty('--skel-cols');
    }
    el.innerHTML = builder(fit);
    el.dataset.skelKey = key;

    revealSkeleton(el);
}

// Show the skeleton with loading semantics for assistive tech. A *visible*
// indicator must not be aria-hidden, so we expose it as a polite status
// region while shown; `.hidden` (display:none) keeps it out of the a11y tree
// once loading finishes.
function revealSkeleton(el) {
    el.removeAttribute('aria-hidden');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-busy', 'true');
    el.setAttribute('aria-label', 'Načítání rozvrhu');
    el.classList.remove('hidden');
}

function hideSkeleton() {
    const el = document.getElementById('timetableSkeleton');
    if (el) {
        el.setAttribute('aria-busy', 'false');
        el.classList.add('hidden');
    }
}

// Populate value selector
export function populateValueSelect() {
    let data = [];

    if (state.selectedType === 'Class') data = state.definitions.classes || [];
    else if (state.selectedType === 'Teacher') data = state.definitions.teachers || [];
    else if (state.selectedType === 'Room') data = state.definitions.rooms || [];

    // Sort alphabetically (only if data is not empty)
    if (data.length > 0) {
        data.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Convert to dropdown format and filter out empty values
    const items = data
        .filter(item => item.id && item.id.trim() !== '' && item.name && item.name.trim() !== '')
        .map(item => ({
            value: item.id,
            label: item.name
        }));

    // Populate custom dropdown
    populateDropdown(items);
}

// Initialize week view toggle button
export function initWeekViewToggle() {
    if (!dom.weekViewToggle) return;

    dom.weekViewToggle.addEventListener('click', async () => {
        // ✓ Měnit layoutMode, ne showWholeWeek (deprecated)
        const newMode = state.layoutMode === 'single-day' ? 'week-view' : 'single-day';

        // Update button appearance
        if (newMode === 'week-view') {
            dom.weekViewToggle.classList.add('active');
        } else {
            dom.weekViewToggle.classList.remove('active');
        }

        // Switch layout (volá applyLayout interně)
        const { switchLayout } = await import('./layout-manager.js');
        await switchLayout(newMode);
    });
}

// Create day selector for mobile
export function createDaySelector() {
    if (!dom.daySelector) return;

    const todayIndex = getTodayIndex();

    // Výchozí vybraný den je dnes, nebo pondělí pokud je víkend
    if (state.selectedDayIndex === null) {
        updateState('selectedDayIndex', todayIndex >= 0 ? todayIndex : 0);
    }

    dom.daySelector.innerHTML = '';

    daysShort.forEach((day, index) => {
        const btn = document.createElement('button');
        btn.textContent = day;
        btn.className = index === state.selectedDayIndex ? 'active' : '';
        if (index === todayIndex && state.selectedScheduleType === 'actual') {
            btn.classList.add('today-btn');
        }
        btn.addEventListener('click', () => selectDay(index));
        dom.daySelector.appendChild(btn);
    });

    // Set visibility based on showWholeWeek state using CSS class
    // Don't show day selector if whole week is being displayed
    if (state.showWholeWeek) {
        dom.daySelector.classList.add('hide-day-selector');
    } else {
        dom.daySelector.classList.remove('hide-day-selector');
    }
}

// Update active day button without rebuilding DOM
function updateActiveDayButton() {
    if (!dom.daySelector) return;

    const buttons = dom.daySelector.querySelectorAll('button');
    buttons.forEach((btn, index) => {
        if (index === state.selectedDayIndex) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Select day on mobile
export async function selectDay(index) {
    updateState('selectedDayIndex', index);
    updateActiveDayButton();

    // Reset card view index when switching days
    const { updateLayoutPreference } = await import('./layout-manager.js');
    updateLayoutPreference('card-view', { cardIndex: 0 });

    await updateMobileDayView();
}

// Update mobile day view
// DEPRECATED - now handled by layout-manager.js
async function updateMobileDayView() {
    // Delegate to layout manager
    const { applyLayout } = await import('./layout-manager.js');
    await applyLayout();
}

// Render timetable
export function renderTimetable(data) {
    if (!dom.timetableGrid) return;

    const todayIndex = getTodayIndex();
    const currentHour = getCurrentHour();
    const upcomingHour = getUpcomingHour();

    // Zjistíme všechny hodiny, které se vyskytují v rozvrhu
    const allHours = [...new Set(data.map(d => d.hour))].sort((a, b) => a - b);
    const maxHour = Math.max(...allHours, -1);

    // Check if timetable is completely empty (no lessons at all)
    const isCompletelyEmpty = data.length === 0 || maxHour < 0;

    // Vytvoříme hlavičku tabulky s hodinami
    const headerRow = document.createElement('div');
    headerRow.className = 'timetable-header';

    // První buňka - prázdná (roh)
    const cornerCell = document.createElement('div');
    cornerCell.className = 'timetable-header-cell';
    cornerCell.textContent = '';
    headerRow.appendChild(cornerCell);

    // Hlavičky pro hodiny - pokud je rozvrh úplně prázdný, zobrazíme jen jeden sloupec
    if (isCompletelyEmpty) {
        const headerCell = document.createElement('div');
        headerCell.className = 'timetable-header-cell';
        const timeInfo = lessonTimes.find(t => t.hour === 0);
        headerCell.innerHTML = `
            <div style="font-size: 0.85rem;">0.</div>
            <div style="font-size: 0.65rem; font-weight: 400; margin-top: 2px; opacity: 0.8;">${timeInfo ? timeInfo.label : ''}</div>
        `;
        headerRow.appendChild(headerCell);
    } else {
        // Zobrazíme všechny hodiny
        for (let hour = 0; hour <= maxHour; hour++) {
            const headerCell = document.createElement('div');
            headerCell.className = 'timetable-header-cell';

            const timeInfo = lessonTimes.find(t => t.hour === hour);
            headerCell.innerHTML = `
                <div style="font-size: 0.85rem;">${hour}.</div>
                <div style="font-size: 0.65rem; font-weight: 400; margin-top: 2px; opacity: 0.8;">${timeInfo ? timeInfo.label : ''}</div>
            `;

            headerRow.appendChild(headerCell);
        }
    }

    dom.timetableGrid.appendChild(headerRow);

    // Vytvoříme řádky pro každý den
    days.forEach((day, dayIndex) => {
        const row = document.createElement('div');
        row.className = 'timetable-row';

        // Zvýraznění dnešního řádku (pouze v aktuálním rozvrhu)
        if (dayIndex === todayIndex && state.selectedScheduleType === 'actual') {
            row.classList.add('today-row');
        }

        // Check if day has any lessons
        const dayLessons = data.filter(d => d.day === dayIndex);
        const hasDayLessons = dayLessons.length > 0;

        // Calculate date for this day based on schedule type
        let dateStr = '';

        if (state.selectedScheduleType === 'permanent') {
            // Stálý týden - NO dates
            dateStr = '';
        } else if (state.selectedScheduleType === 'actual') {
            // Aktuální týden - show CURRENT dates
            const monday = getMondayOfWeek(0);  // Current week
            const currentDate = new Date(monday);
            currentDate.setDate(monday.getDate() + dayIndex);
            dateStr = `${currentDate.getDate()}.${currentDate.getMonth() + 1}.`;
        } else if (state.selectedScheduleType === 'next') {
            // Příští týden - show dates +7 days
            const monday = getMondayOfWeek(1);  // Next week (offset +1)
            const currentDate = new Date(monday);
            currentDate.setDate(monday.getDate() + dayIndex);
            dateStr = `${currentDate.getDate()}.${currentDate.getMonth() + 1}.`;
        }

        // První buňka - název dne
        const dayCell = document.createElement('div');
        dayCell.className = 'hour-cell';
        dayCell.innerHTML = `
            <div class="day-name-container">
                <div style="font-weight: 700;">${day}</div>
                ${dateStr ? `<div style="font-size: 0.7rem; opacity: 0.7; margin-top: 2px;">${dateStr}</div>` : ''}
                ${dayIndex === todayIndex && state.selectedScheduleType === 'actual' ? '<div class="today-badge">DNES</div>' : ''}
            </div>
        `;
        row.appendChild(dayCell);

        // If no lessons for this day, show empty cells with message in first cell
        if (!hasDayLessons && (maxHour >= 0 || isCompletelyEmpty)) {
            row.classList.add('empty-day');

            // Determine reason for no lessons
            let message = 'Žádná výuka';
            if (dayIndex === 5 || dayIndex === 6) {
                message = 'Víkend';
            }

            // Create cells for each hour
            const hoursToShow = isCompletelyEmpty ? 1 : (maxHour + 1);

            for (let hour = 0; hour < hoursToShow; hour++) {
                const emptyCell = document.createElement('div');
                emptyCell.className = 'lesson-cell empty-lesson-cell';

                // Only show message in first cell
                if (hour === 0) {
                    emptyCell.classList.add('has-message');
                    emptyCell.innerHTML = `
                        <div class="empty-day-content">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="16" y1="2" x2="16" y2="6"></line>
                                <line x1="8" y1="2" x2="8" y2="6"></line>
                                <line x1="3" y1="10" x2="21" y2="10"></line>
                            </svg>
                            <span>${message}</span>
                        </div>
                    `;
                }

                row.appendChild(emptyCell);
            }
        } else if (hasDayLessons) {
            // Buňky pro jednotlivé hodiny (only if there are lessons)
            for (let hour = 0; hour <= maxHour; hour++) {
                const lessonCell = document.createElement('div');
                lessonCell.className = 'lesson-cell';

                if (dayIndex === todayIndex && state.selectedScheduleType === 'actual') {
                    lessonCell.classList.add('today');
                }

                // Najdeme všechny hodiny pro tento den a hodinu
                let lessons = data.filter(d => d.day === dayIndex && d.hour === hour);

                // Skrýt removed hodiny, pokud existuje náhradní hodina pro stejnou skupinu
                lessons = lessons.filter(lesson => {
                    // Ponechat všechny ne-removed hodiny
                    if (lesson.type !== 'removed') return true;

                    // Pro removed hodiny zkontrolovat, jestli existuje náhrada
                    const groupToMatch = lesson.group || ''; // Prázdná skupina = celá třída

                    // Najít jinou hodinu ve stejném slotu se stejnou skupinou, která není removed/absent
                    const hasReplacement = lessons.some(other =>
                        other !== lesson && // Jiná hodina
                        (other.group || '') === groupToMatch && // Stejná skupina
                        other.type !== 'removed' && // Není removed
                        other.type !== 'absent' // Není absent
                    );

                    // Skrýt removed hodinu pokud má náhradu, jinak zobrazit
                    return !hasReplacement;
                });

                // Seřadit hodiny podle skupiny (1. sk., 2. sk., atd.)
                lessons.sort((a, b) => {
                    // Pokud jedna hodina nemá skupinu, ta půjde první
                    if (!a.group && b.group) return -1;
                    if (a.group && !b.group) return 1;
                    if (!a.group && !b.group) return 0;

                    // Extrahovat číslo skupiny z textu (např. "1. sk." -> 1, "2. sk." -> 2)
                    const extractGroupNumber = (groupStr) => {
                        const match = groupStr.match(/(\d+)\.\s*sk/i);
                        return match ? parseInt(match[1], 10) : 999;
                    };

                    const groupA = extractGroupNumber(a.group);
                    const groupB = extractGroupNumber(b.group);

                    // Seřadit podle čísla skupiny
                    if (groupA !== groupB) {
                        return groupA - groupB;
                    }

                    // Pokud mají stejné číslo skupiny nebo nemají číslo, seřadit abecedně
                    return a.group.localeCompare(b.group);
                });

                lessons.forEach(lesson => {
                    const card = document.createElement('div');
                    let cardClass = 'lesson-card';
                    if (lesson.changed) cardClass += ' changed';

                    // Add specific classes for removed/absent lessons
                    const isRemovedOrAbsent = lesson.type === 'removed' || lesson.type === 'absent';
                    if (lesson.type === 'removed') cardClass += ' removed';
                    if (lesson.type === 'absent') cardClass += ' absent';

                    // Zvýraznění aktuální hodiny (pouze v aktuálním rozvrhu a ne pro zrušené hodiny)
                    if (!isRemovedOrAbsent && state.selectedScheduleType === 'actual' && dayIndex === todayIndex && hour === currentHour) {
                        cardClass += ' current-time';
                    }

                    // Zvýraznění nadcházející hodiny (pouze v aktuálním rozvrhu a ne pro zrušené hodiny)
                    if (!isRemovedOrAbsent && state.selectedScheduleType === 'actual' && dayIndex === todayIndex && hour === upcomingHour && hour !== currentHour) {
                        cardClass += ' upcoming';
                    }

                    // Označení proběhlých hodin (pouze v aktuálním rozvrhu a ne pro zrušené hodiny)
                    if (!isRemovedOrAbsent && state.selectedScheduleType === 'actual' && isPastLesson(dayIndex, hour)) {
                        cardClass += ' past';
                    }

                    card.className = cardClass;

                    const displaySubject = abbreviateSubject(lesson.subject);
                    const displayTeacher = abbreviateTeacherName(lesson.teacher, state.teacherAbbreviationMap);
                    const displayGroup = standardizeGroupName(lesson.group);

                    // Extract class name from group for Teacher/Room views
                    const parsedGroup = parseGroupName(lesson.group);
                    const className = parsedGroup ? parsedGroup.classId : '';

                    // Render different content based on timetable type
                    let cardContent = '';

                    if (state.selectedType === 'Teacher') {
                        // Teacher view: Show Subject, Room, Class (no teacher)
                        cardContent = `
                            <div class="lesson-subject" title="${lesson.subject}">${displaySubject}</div>
                            <div class="lesson-details">
                                ${lesson.room ? `
                                    <span class="lesson-detail-item">
                                        <svg class="lesson-detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M11 20H2"/>
                                            <path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z"/>
                                            <path d="M11 4H8a2 2 0 0 0-2 2v14"/>
                                            <path d="M14 12h.01"/>
                                            <path d="M22 20h-3"/>
                                        </svg>
                                        ${lesson.room}
                                    </span>
                                ` : ''}
                            </div>
                            ${className ? `<div class="lesson-group">${className}</div>` : ''}
                        `;
                    } else if (state.selectedType === 'Room') {
                        // Room view: Show Subject, Teacher, Class (no room)
                        cardContent = `
                            <div class="lesson-subject" title="${lesson.subject}">${displaySubject}</div>
                            <div class="lesson-details">
                                ${lesson.teacher ? `
                                    <span class="lesson-detail-item" title="${lesson.teacher}">
                                        <svg class="lesson-detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                            <circle cx="12" cy="7" r="4"/>
                                        </svg>
                                        ${displayTeacher}
                                    </span>
                                ` : ''}
                            </div>
                            ${className ? `<div class="lesson-group">${className}</div>` : ''}
                        `;
                    } else {
                        // Class view: Show Subject, Teacher, Room, Group (default)
                        cardContent = `
                            <div class="lesson-subject" title="${lesson.subject}">${displaySubject}</div>
                            <div class="lesson-details">
                                ${lesson.teacher ? `
                                    <span class="lesson-detail-item" title="${lesson.teacher}">
                                        <svg class="lesson-detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                            <circle cx="12" cy="7" r="4"/>
                                        </svg>
                                        ${displayTeacher}
                                    </span>
                                ` : ''}
                                ${lesson.room ? `
                                    <span class="lesson-detail-item">
                                        <svg class="lesson-detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M11 20H2"/>
                                            <path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z"/>
                                            <path d="M11 4H8a2 2 0 0 0-2 2v14"/>
                                            <path d="M14 12h.01"/>
                                            <path d="M22 20h-3"/>
                                        </svg>
                                        ${lesson.room}
                                    </span>
                                ` : ''}
                            </div>
                            ${lesson.group ? `<div class="lesson-group">${displayGroup}</div>` : ''}
                        `;
                    }

                    card.innerHTML = cardContent;

                    // Add click event to show modal
                    card.style.cursor = 'pointer';
                    card.addEventListener('click', () => showLessonModal(lesson));

                    lessonCell.appendChild(card);
                });

                row.appendChild(lessonCell);
            }
        }

        dom.timetableGrid.appendChild(row);
    });

    // Aktualizovat viditelnost dnů na mobilu
    // REMOVED: updateMobileDayView() - způsobovalo nekonečný loop
    // Layout se aplikuje v layout-manager.js přes applyLayout()
}

// Load timetable
export async function loadTimetable() {
    if (!dom.loading || !dom.errorDiv || !dom.timetableGrid) {
        console.error('Required DOM elements not found');
        return;
    }

    const id = getDropdownValue();

    if (!id) return;

    // Uložit do paměti pro příště
    localStorage.setItem('selectedType', state.selectedType);
    localStorage.setItem('selectedValue', id);

    dom.errorDiv.classList.add('hidden');
    dom.timetableGrid.innerHTML = '';
    showSkeleton();

    try {
        // Calculate the Monday of the selected week for the API
        const monday = getMondayOfWeek(state.weekOffset);
        const dateParam = monday.toISOString().split('T')[0]; // Format: YYYY-MM-DD

        const data = await fetchTimetable(state.selectedType, id, state.selectedScheduleType, dateParam);

        // Filter out "empty" absent lessons (placeholders)
        // These usually have the date as the subject and no teacher
        const filteredData = data.filter(lesson => {
            if (lesson.type === 'absent') {
                // Check if subject looks like a date (e.g., "st 19.11.")
                // and there is no teacher assigned
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
        renderTimetable(filteredData);

        // Reset card view index when switching timetables
        const { applyLayout, updateLayoutPreference } = await import('./layout-manager.js');
        updateLayoutPreference('card-view', { cardIndex: 0 });

        // ✓ Aplikovat layout po vygenerování HTML
        await applyLayout();

        // Update the "next lesson" widget for the freshly loaded timetable
        refreshNextLessonWidget();

    } catch (e) {
        dom.errorDiv.textContent = e.message;
        dom.errorDiv.classList.remove('hidden');
    } finally {
        hideSkeleton();
    }
}
