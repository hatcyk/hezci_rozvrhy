import { dom } from './dom.js';
import { state, updateState } from './state.js';
import { days, daysShort, lessonTimes } from './constants.js';
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
async function selectDay(index) {
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
                                ${lesson.room ? `<span>${lesson.room}</span>` : ''}
                            </div>
                            ${className ? `<div class="lesson-group">${className}</div>` : ''}
                        `;
                    } else if (state.selectedType === 'Room') {
                        // Room view: Show Subject, Teacher, Class (no room)
                        cardContent = `
                            <div class="lesson-subject" title="${lesson.subject}">${displaySubject}</div>
                            <div class="lesson-details">
                                ${lesson.teacher ? `<span title="${lesson.teacher}">${displayTeacher}</span>` : ''}
                            </div>
                            ${className ? `<div class="lesson-group">${className}</div>` : ''}
                        `;
                    } else {
                        // Class view: Show Subject, Teacher, Room, Group (default)
                        cardContent = `
                            <div class="lesson-subject" title="${lesson.subject}">${displaySubject}</div>
                            <div class="lesson-details">
                                ${lesson.teacher ? `<span title="${lesson.teacher}">${displayTeacher}</span>` : ''}
                                ${lesson.room ? `<span>${lesson.room}</span>` : ''}
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

    dom.loading.classList.remove('hidden');
    dom.errorDiv.classList.add('hidden');
    dom.timetableGrid.innerHTML = '';

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
        createDaySelector();
        renderTimetable(filteredData);

        // Reset card view index when switching timetables
        const { applyLayout, updateLayoutPreference } = await import('./layout-manager.js');
        updateLayoutPreference('card-view', { cardIndex: 0 });

        // ✓ Aplikovat layout po vygenerování HTML
        await applyLayout();

    } catch (e) {
        dom.errorDiv.textContent = e.message;
        dom.errorDiv.classList.remove('hidden');
    } finally {
        dom.loading.classList.add('hidden');
    }
}
