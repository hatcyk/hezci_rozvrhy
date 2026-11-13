/**
 * Toolbar of the timetable view: "Jen změny" (only the changes of the week
 * against the permanent timetable), "Sdílet" and "Tisk".
 */

import { state, updateState } from './state.js';
import { fetchTimetable } from './api.js';
import { weekChangesAgainstPermanent, mergeChangeItems, czPlural, dayLabel, addDaysIso, isoDate, mondayIso, parseIso } from './changes-core.js';
import { entriesTableHtml } from './changes-render.js';
import { esc, getMondayOfWeek, setPressed } from './utils.js';
import { getDropdownValue } from './dropdown.js';
import { shareLink } from './share.js';
import { timetableUrl } from './view-route.js';
import { printSheetHtml } from './print.js';
import { getCurrentView } from './view-router.js';

const $ = (id) => document.getElementById(id);
const SCHEDULE_TEXT = { actual: 'aktuální týden', next: 'příští týden', permanent: 'stálý rozvrh' };
let renderSeq = 0;

/** "Jen změny" applies to the weeks with changes (actual / next), not the permanent timetable. */
export function onlyChangesActive() {
    return !!state.onlyChanges && state.selectedScheduleType !== 'permanent';
}

/** Monday of the shown week: from the lesson dates (S2) when present, else from the calendar. */
function shownWeekStart() {
    if (state.selectedScheduleType === 'permanent') return null;
    const dated = (state.currentTimetableData || []).find(l => l && l.date);
    if (dated) return mondayIso(parseIso(dated.date));
    return isoDate(getMondayOfWeek(state.selectedScheduleType === 'next' ? 1 : 0));
}

const currentLabel = () => ($('valueDropdownLabel') ? $('valueDropdownLabel').textContent.trim() : '');
const sessionMonday = () => getMondayOfWeek(0).toISOString().split('T')[0];

/**
 * Render the week's changes ("originally → now") in place of the layout.
 * @param {HTMLElement} container - .timetable-container
 */
export async function renderOnlyChanges(container) {
    const seq = ++renderSeq;
    const type = state.selectedType;
    const id = getDropdownValue();
    let permanent = [];
    try {
        permanent = await fetchTimetable(type, id, 'permanent', sessionMonday());
    } catch {
        // without the permanent timetable the list still shows what changed
    }
    if (seq !== renderSeq || !onlyChangesActive()) return;

    const perDay = weekChangesAgainstPermanent(state.currentTimetableData || [], permanent);
    const weekStart = shownWeekStart();
    const now = new Date();
    const title = `Změny proti stálému rozvrhu – ${SCHEDULE_TEXT[state.selectedScheduleType]}`;
    let html = `<div class="oc-wrapper"><h2 class="oc-title" id="ocTitle">${esc(title)}</h2>`;
    if (perDay.length === 0) {
        html += '<p class="view-empty">Tento týden se nic nemění – platí stálý rozvrh.</p>';
    } else {
        for (const { day, entries } of perDay) {
            const date = weekStart ? addDaysIso(weekStart, day) : null;
            const label = date ? dayLabel(date, now) : ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek'][day];
            const hid = `oc-day-${day}`;
            html += `<section class="oc-day"><h3 class="oc-day-title" id="${hid}">${esc(label.charAt(0).toUpperCase() + label.slice(1))}
                <span class="chg-count">${czPlural(entries.length, ['změna', 'změny', 'změn'])}</span></h3>
                ${entriesTableHtml(entries, hid)}</section>`;
        }
    }
    html += '</div>';
    container.innerHTML = html;
    // The list has no buttons: make the scrolling container itself reachable
    // by keyboard (WCAG 2.1.1; axe scrollable-region-focusable on phones)
    container.tabIndex = 0;
}

/** Number on the "Jen změny" button: changed slots of the shown week. */
function weekChangeCount() {
    const flagged = (state.currentTimetableData || []).filter(l => l.changed || l.type === 'removed' || l.type === 'absent');
    return mergeChangeItems(flagged, l => `${l.day}|${l.hour}`).length;
}

/** Sync the toolbar with the loaded timetable (called after every layout render). */
export function updateTimetableToolbar() {
    const btn = $('onlyChangesBtn');
    if (!btn) return;
    const permanent = state.selectedScheduleType === 'permanent';
    btn.hidden = permanent;
    setPressed([btn], () => onlyChangesActive());
    const n = permanent ? 0 : weekChangeCount();
    $('onlyChangesCount').textContent = n ? String(n) : '';
    $('onlyChangesCountSr').textContent = `, ${czPlural(n, ['změna', 'změny', 'změn'])}`;
}

function preparePrint() {
    if (getCurrentView() !== 'timetable') {
        document.documentElement.classList.remove('print-timetable');
        return;
    }
    const weekStart = shownWeekStart();
    const dates = weekStart ? [0, 1, 2, 3, 4].map(d => {
        const x = parseIso(addDaysIso(weekStart, d));
        return `${x.getDate()}. ${x.getMonth() + 1}.`;
    }) : [];
    const sub = [SCHEDULE_TEXT[state.selectedScheduleType],
        weekStart ? `${dates[0]} – ${dates[4]} ${parseIso(addDaysIso(weekStart, 4)).getFullYear()}` : '',
        `vytištěno ${new Date().toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })}`].filter(Boolean).join(' · ');
    const typeWord = { Class: 'třída', Teacher: 'vyučující', Room: 'učebna' }[state.selectedType] || '';
    $('printSheet').innerHTML = printSheetHtml(state.currentTimetableData || [], {
        title: `Rozvrh – ${typeWord} ${currentLabel()}`.trim(),
        subtitle: sub,
        type: state.selectedType,
        abbrMap: state.teacherAbbreviationMap,
        dates,
    });
    document.documentElement.classList.add('print-timetable');
}

/** Wire the toolbar buttons and the browser's own print (Ctrl+P). */
export function initTimetableTools({ applyLayout }) {
    const only = $('onlyChangesBtn');
    if (only) {
        only.addEventListener('click', async () => {
            updateState('onlyChanges', !state.onlyChanges);
            updateTimetableToolbar();
            await applyLayout();
        });
    }
    const share = $('shareBtn');
    if (share) {
        share.addEventListener('click', () => {
            const id = getDropdownValue();
            if (!id) return;
            const showsOneDay = window.matchMedia && window.matchMedia('(max-width: 1079px)').matches;
            const typeWord = { Class: 'Rozvrh třídy', Teacher: 'Rozvrh vyučujícího', Room: 'Rozvrh učebny' }[state.selectedType] || 'Rozvrh';
            shareLink({
                title: `${typeWord} ${currentLabel()}`,
                text: `${typeWord} ${currentLabel()} – ${SCHEDULE_TEXT[state.selectedScheduleType]}`,
                url: timetableUrl({
                    type: state.selectedType, id, schedule: state.selectedScheduleType,
                    day: showsOneDay && Number.isInteger(state.selectedDayIndex) ? state.selectedDayIndex : null,
                }),
            });
        });
    }
    const calendar = $('calendarBtn');
    if (calendar) {
        calendar.addEventListener('click', async () => {
            const { openCalendarSheet } = await import('./calendar-sheet.js');
            openCalendarSheet();
        });
    }
    const print = $('printBtn');
    if (print) {
        print.addEventListener('click', () => {
            preparePrint();
            window.print();
        });
    }
    window.addEventListener('beforeprint', preparePrint);
    window.addEventListener('afterprint', () => document.documentElement.classList.remove('print-timetable'));
}
