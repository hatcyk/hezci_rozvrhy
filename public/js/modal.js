/**
 * Detail hodiny (návrh G): na mobilu spodní panel, na počítači dialog vedle
 * bloku hodiny (jako bublina v Kalendáři). Obsah: předmět, stav (ikona +
 * slovo), den a čas, vyučující, učebna, skupina, téma, „Proti stálému
 * rozvrhu: původně → nyní“ a popis změny od Bakalářů.
 */
import { dom } from './dom.js';
import { lessonTimes } from './constants.js';
import { state } from './state.js';
import { parseChangeInfo, getChangeTypeInfo, esc, getMondayOfWeek, getTodayIndex, getCurrentHour } from './utils.js';
import { showToast } from './toast.js';
import { getDropdownValue, selectTimetable } from './dropdown.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';
import { fetchTimetable } from './api.js';
import { describeLessonChange } from './changes-core.js';
import { briefHtml, afterHtml } from './changes-render.js';
import { slotLessons, lessonKind, statusHtml, icon, KINDS, DAY_NAMES, czDate, addDays, weekMonday, hourRange, groupText } from './rozvrh-core.js';

let diffSeq = 0;
let anchorEl = null;

const isMobile = () => !!window.matchMedia && window.matchMedia('(max-width: 1079px)').matches;

/**
 * "Co je dnes jinak": for a changed / cancelled lesson show what the permanent
 * timetable has in the same slot (day, hour, group) next to what happens now.
 * The change note from Bakaláři alone often says only "Suplování" or
 * "Hodina odpadla" without the original lesson.
 */
async function showLessonDiff(lesson, data) {
    const box = document.getElementById('modalDiff');
    if (!box) return;
    const seq = ++diffSeq;
    box.classList.add('hidden');
    const flagged = lesson && (lesson.changed || lesson.type === 'removed' || lesson.type === 'absent');
    if (!flagged || state.selectedScheduleType === 'permanent' && data === state.currentTimetableData) return;

    let permanent = [];
    try {
        const monday = getMondayOfWeek(0).toISOString().split('T')[0];
        permanent = await fetchTimetable(state.selectedType, getDropdownValue(), 'permanent', monday);
    } catch {
        // offline without a cached permanent timetable: the change note may still tell the original
    }
    if (seq !== diffSeq) return; // another lesson was opened meanwhile

    const entry = describeLessonChange(lesson, data || state.currentTimetableData || [], permanent);
    if (!entry) return;
    document.getElementById('modalDiffBefore').innerHTML = entry.before
        ? briefHtml(entry.before, { strike: entry.kind === 'removed' || entry.kind === 'absent' })
        : '<span class="chg-none">Podle stálého rozvrhu tu hodina nebyla</span>';
    document.getElementById('modalDiffAfter').innerHTML = afterHtml(entry);
    box.classList.remove('hidden');
    positionNearAnchor();
}

/** Stav hodiny v kontextu jejího slotu (originál suplování ve stejné skupině). */
function kindIn(lesson, data) {
    const rows = (data || []).filter(l => l.day === lesson.day && l.hour === lesson.hour);
    const item = slotLessons(rows).find(it => it.lesson === lesson);
    return item ? item.kind : lessonKind(lesson);
}

function setRow(rowId, show) {
    const row = document.getElementById(rowId);
    if (row) row.hidden = !show;
}

/**
 * Open the detail of a lesson.
 * @param {Object} lesson
 * @param {{ data?: Array, anchor?: Element|null }} [opts] - data: the week the lesson belongs to
 *   (the overview always shows the current week); anchor: the clicked block (desktop placement)
 */
export function showLessonModal(lesson, { data = null, anchor = null } = {}) {
    if (!dom.lessonModal) {
        console.error('Modal not initialized!');
        return;
    }
    const week = data || state.currentTimetableData || [];
    anchorEl = anchor;

    // Subject (full name)
    document.getElementById('modalSubject').textContent = lesson.subject || 'Neznámá hodina';

    // Status: icon + word (colour only on the icon)
    const status = document.getElementById('modalStatus');
    const kind = kindIn(lesson, week);
    // The overview passes the current week; the layouts pass the shown one
    const currentWeek = week === state.currentTimetableData ? state.selectedScheduleType === 'actual' : true;
    const cancelled = lesson.type === 'removed' || lesson.type === 'absent';
    const isNow = currentWeek && !cancelled && lesson.day === getTodayIndex() && lesson.hour === getCurrentHour();
    const statusParts = [];
    if (kind && KINDS[kind]) statusParts.push(statusHtml(kind));
    if (isNow) statusParts.push(statusHtml('', { now: true }));
    if (status) {
        status.innerHTML = statusParts.join('');
        status.hidden = !statusParts.length;
    }

    // Day, hour and time
    const monday = state.selectedScheduleType === 'permanent' && week === state.currentTimetableData
        ? null : weekMonday(week, getMondayOfWeek(state.selectedScheduleType === 'next' && week === state.currentTimetableData ? 1 : 0));
    const date = monday ? addDays(monday, lesson.day) : null;
    const dayEl = document.getElementById('modalDay');
    if (dayEl) dayEl.textContent = DAY_NAMES[lesson.day] ? `${DAY_NAMES[lesson.day]}${date ? ` ${czDate(date)}` : ''}` : '';
    setRow('modalDayRow', !!DAY_NAMES[lesson.day]);
    const timeInfo = lessonTimes.find(t => t.hour === lesson.hour);
    document.getElementById('modalHour').textContent = `${lesson.hour}.\u00a0hodina${timeInfo ? `, ${hourRange(lesson.hour)}` : ''}`;

    // Teacher (link to their timetable); hidden in a teacher's own timetable
    const teacherEl = document.getElementById('modalTeacher');
    if (state.selectedType === 'Teacher') {
        setRow('modalTeacherRow', false);
    } else {
        setRow('modalTeacherRow', true);
        teacherEl.innerHTML = lesson.teacher
            ? `<a href="#" class="modal-link" data-type="Teacher" data-name="${esc(lesson.teacher)}">${esc(lesson.teacher)}${icon('chevron-right', 'ld-go')}</a>`
            : '<span class="ld-none">Není zadáno</span>';
    }

    // Room (link) - in a room's own timetable just the text
    const roomEl = document.getElementById('modalRoom');
    if (lesson.type === 'absent' && !lesson.room) {
        setRow('modalRoomRow', false);
    } else {
        setRow('modalRoomRow', true);
        if (lesson.room && state.selectedType !== 'Room') {
            roomEl.innerHTML = `<a href="#" class="modal-link" data-type="Room" data-name="${esc(lesson.room)}">${esc(lesson.room)}${icon('chevron-right', 'ld-go')}</a>`;
        } else {
            roomEl.textContent = lesson.room || 'Není zadáno';
        }
    }

    // Group; in a teacher's / room's timetable the class is a link
    const groupEl = document.getElementById('modalGroup');
    if (lesson.group) {
        const groupMatch = lesson.group.match(/^([^\s]+)\s+/);
        const className = groupMatch ? groupMatch[1] : null;
        const pretty = groupText(lesson.group);
        if (className && state.selectedType !== 'Class') {
            groupEl.innerHTML = `<a href="#" class="modal-link" data-type="Class" data-name="${esc(className)}">${esc(className)}${pretty ? `, ${esc(pretty)}` : ''}${icon('chevron-right', 'ld-go')}</a>`;
        } else {
            groupEl.textContent = pretty || lesson.group;
        }
        setRow('modalGroupContainer', true);
    } else {
        setRow('modalGroupContainer', false);
    }

    // Theme
    if (lesson.theme) {
        document.getElementById('modalTheme').textContent = lesson.theme;
        setRow('modalThemeContainer', true);
    } else {
        setRow('modalThemeContainer', false);
    }

    // Description of the change from Bakaláři
    const modalChanges = document.getElementById('modalChanges');
    const modalChangesContent = document.getElementById('modalChangesContent');
    const modalChangesIcon = document.getElementById('modalChangesIcon');
    const modalChangesHeader = document.getElementById('modalChangesHeader');
    const flagged = lesson.changed || lesson.type === 'removed' || lesson.type === 'absent';
    if (flagged) {
        modalChanges.classList.remove('hidden');
        const raw = lesson.changeInfo && lesson.changeInfo.description;
        const parsed = raw ? parseChangeInfo(raw) : null;
        const typeInfo = getChangeTypeInfo(parsed?.type, raw);
        modalChanges.className = `ld-mod ld-changes type-${typeInfo.type}`;
        modalChangesIcon.innerHTML = icon(KINDS[kind] ? KINDS[kind].icon : 'info', KINDS[kind] ? `ico-${KINDS[kind].bar}` : '');
        modalChangesHeader.textContent = 'Popis změny';
        modalChangesContent.innerHTML = parsed && parsed.formatted
            ? parsed.formatted
            : '<div class="change-detail"><span class="change-value">Tato hodina byla změněna oproti stálému rozvrhu.</span></div>';
    } else {
        modalChanges.classList.add('hidden');
    }

    // Original vs. now from the permanent timetable (async, fills in when loaded)
    showLessonDiff(lesson, week);

    // Open as bottom sheet (phones) / dialog next to the block (desktop)
    dom.lessonModal.classList.remove('is-anchored');
    dom.lessonModal.style.left = '';
    dom.lessonModal.style.top = '';
    openBottomSheet('lessonModal');
    positionNearAnchor();

    // Add click listeners to modal links
    setupModalLinks();
}

/**
 * Desktop: put the dialog next to the clicked block (right of it, or left
 * when there is no room), clamped to the window. Phones keep the bottom sheet.
 */
function positionNearAnchor() {
    const dlg = dom.lessonModal;
    if (!dlg || !dlg.open) return;
    if (isMobile() || !anchorEl || !anchorEl.isConnected) {
        dlg.classList.remove('is-anchored');
        return;
    }
    const a = anchorEl.getBoundingClientRect();
    dlg.classList.add('is-anchored');
    const w = dlg.offsetWidth;
    const h = dlg.offsetHeight;
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = a.right + gap;
    if (left + w > vw - 16) left = a.left - gap - w;
    if (left < 16) left = Math.max(16, Math.min(vw - w - 16, a.left + (a.width - w) / 2));
    const top = Math.max(16, Math.min(vh - h - 16, a.top - 8));
    dlg.style.left = `${Math.round(left)}px`;
    dlg.style.top = `${Math.round(top)}px`;
}

export function closeLessonModal() {
    closeBottomSheet('lessonModal');
}

// Helper function to normalize teacher names for matching
function normalizeTeacherName(name) {
    if (!name) return '';

    // Remove titles
    const normalized = name.replace(/^(Mgr\.|Ing\.|Bc\.|Dr\.|Ph\.D\.|RNDr\.|PaedDr\.)\s*/gi, '')
        .replace(/,?\s*(Ph\.D\.|CSc\.)$/gi, '')
        .trim();

    // Split into parts and sort alphabetically to handle different orders
    const parts = normalized.split(/\s+/).filter(p => p.length > 0);
    return parts.sort().join(' ').toLowerCase();
}

/** Teacher id for a name as written in the lesson (titles, order and initials may differ). */
function findTeacherId(name) {
    const teachers = state.definitions.teachers || [];
    const normalizedSearchName = normalizeTeacherName(name);
    let teacher = teachers.find(t => t.name === name)
        || teachers.find(t => normalizeTeacherName(t.name) === normalizedSearchName);
    if (!teacher) {
        const searchParts = normalizedSearchName.split(/\s+/);
        teacher = teachers.find(t => {
            const defParts = normalizeTeacherName(t.name).split(/\s+/);
            if (searchParts.length !== defParts.length) return false;
            return searchParts.every((searchPart, i) => {
                const cleanSearch = searchPart.replace(/\./g, '');
                const cleanDef = defParts[i].replace(/\./g, '');
                if (cleanSearch.length < cleanDef.length) return cleanDef.startsWith(cleanSearch);
                if (cleanDef.length < cleanSearch.length) return cleanSearch.startsWith(cleanDef);
                return cleanSearch === cleanDef;
            });
        });
    }
    if (!teacher) teacher = teachers.find(t => t.id === name);
    if (!teacher) teacher = teachers.find(t => t.name.includes(name) || name.includes(t.name) || t.id.includes(name));
    return teacher ? teacher.id : null;
}

// Setup click listeners for modal links (teacher, room, class)
function setupModalLinks() {
    const links = dom.lessonModal.querySelectorAll('.modal-link');
    links.forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const type = link.dataset.type;
            const name = link.dataset.name;

            closeLessonModal();

            const definitions = state.definitions;
            let targetId = null;
            if (type === 'Teacher') targetId = findTeacherId(name);
            else if (type === 'Room') targetId = definitions.rooms?.find(r => r.name === name)?.id;
            else if (type === 'Class') targetId = definitions.classes?.find(c => c.name === name)?.id;

            if (targetId) {
                selectTimetable(type, targetId);
            } else {
                console.error(`Failed to find ${type} with name: "${name}"`);
                // Non-blocking message instead of alert()
                showToast({
                    title: `Rozvrh pro ${type === 'Teacher' ? 'vyučujícího' : type === 'Room' ? 'učebnu' : 'třídu'} „${name}“ se nepodařilo najít.`,
                    body: 'Vyhledejte ho prosím ručně.',
                    icon: '⚠️',
                    variant: 'info',
                });
            }
        }, { once: true });
    });
}

// Initialize modal event listeners
export function initModalListeners() {
    if (!dom.lessonModal || !dom.modalClose) {
        console.error('Modal elements not found during initialization');
        return;
    }

    // Close button
    dom.modalClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeLessonModal();
    });

    window.addEventListener('resize', () => positionNearAnchor(), { passive: true });

    // Overlay click + Escape key are handled by bottom-sheet.js
}
