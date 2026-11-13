/**
 * "Do kalendáře": subscribe to the shown timetable in Google / Apple / Outlook
 * calendar through the iCal export of the backend (adm2):
 *   /api/ical/{type}/{id}.ics?schedule=actual,next|permanent&group=1.sk,…
 * A subscribed calendar is refreshed by the calendar app on its own schedule
 * (Outlook about every 3 hours), so the sheet says that substitutions are
 * still announced by the push notifications.
 *
 * The <dialog> is built here on first use (same structure and behaviour as
 * the sheets in index.html, see bottom-sheet.js).
 */

import { state } from './state.js';
import { esc, standardizeGroupName } from './utils.js';
import { getDropdownValue } from './dropdown.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';
import { showToast } from './toast.js';

const ID = 'calendarModal';
const $ = (id) => document.getElementById(id);

/**
 * Calendar URLs of a timetable (pure; tested in Node).
 * @param {{ origin: string, type: string, id: string, schedule: 'actual,next'|'permanent', groups?: string[] }} p
 * @returns {{ https: string, webcal: string }}
 */
export function calendarUrls({ origin, type, id, schedule = 'actual,next', groups = [] }) {
    const q = new URLSearchParams({ schedule });
    if (groups.length) q.set('group', groups.join(','));
    // URLSearchParams encodes the comma; the backend splits on a literal one
    const query = q.toString().replace(/%2C/g, ',');
    const https = `${origin}/api/ical/${encodeURIComponent(type)}/${encodeURIComponent(id)}.ics?${query}`;
    return { https, webcal: https.replace(/^https?:/, 'webcal:') };
}

/** Groups of a class timetable worth filtering ("1.sk", "TVk1"); whole class is always in. */
export function classGroups(lessons) {
    const set = new Set();
    for (const l of lessons || []) {
        const g = standardizeGroupName(l.group || '');
        if (g) set.add(g);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'cs', { numeric: true }));
}

function ensureDialog() {
    let dialog = $(ID);
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'bottom-sheet';
    dialog.id = ID;
    dialog.setAttribute('aria-labelledby', 'calendarModalTitle');
    dialog.innerHTML = `
        <div class="bottom-sheet-handle" aria-hidden="true"></div>
        <div class="modal-header">
            <h2 id="calendarModalTitle">Přidat do kalendáře</h2>
            <button type="button" class="modal-close" id="calendarModalClose" aria-label="Zavřít přidání do kalendáře">
                <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
        <div class="modal-body cal-body">
            <p class="cal-intro" id="calendarIntro"></p>
            <fieldset class="cal-fieldset">
                <legend>Co odebírat</legend>
                <label class="cal-option"><input type="radio" name="calSchedule" value="actual,next" checked>
                    <span><strong>Tento a příští týden</strong> – se suplováním a zrušenými hodinami</span></label>
                <label class="cal-option"><input type="radio" name="calSchedule" value="permanent">
                    <span><strong>Stálý rozvrh</strong> – opakované hodiny do konce pololetí</span></label>
            </fieldset>
            <fieldset class="cal-fieldset" id="calendarGroupsBox" hidden>
                <legend>Jen moje skupiny <span class="cal-hint">(hodiny celé třídy jsou vždy)</span></legend>
                <div class="cal-groups" id="calendarGroups"></div>
            </fieldset>
            <div class="cal-actions">
                <a class="tt-tool tt-tool-primary" id="calendarSubscribe" href="#">Odebírat v kalendáři</a>
                <button type="button" class="tt-tool" id="calendarCopy">Kopírovat odkaz</button>
            </div>
            <p class="cal-help">Google Kalendář: zkopírujte odkaz a vložte ho v části <em>Další kalendáře → Z adresy URL</em>. Apple Kalendář a Outlook otevřou odebírání tlačítkem výše.</p>
            <p class="cal-note" role="note"><strong>Kalendář se neobnovuje hned.</strong> Aplikace kalendáře si odebíraný kalendář stahují se zpožděním (např. Outlook zhruba po 3 hodinách), takže o nečekaném suplování vás dál včas upozorní notifikace této aplikace.</p>
        </div>`;
    document.body.appendChild(dialog);

    $('calendarModalClose').addEventListener('click', () => closeBottomSheet(ID));
    dialog.addEventListener('change', updateLinks);
    $('calendarCopy').addEventListener('click', async () => {
        const url = currentUrls().https;
        try {
            await navigator.clipboard.writeText(url);
            showToast({ title: 'Odkaz na kalendář zkopírován', body: url, icon: '📅', timeout: 4000 });
        } catch {
            showToast({ title: 'Odkaz se nepodařilo zkopírovat – zkopírujte ho ručně:', body: url, icon: '📅', timeout: 0 });
        }
    });
    return dialog;
}

function currentUrls() {
    const schedule = (document.querySelector(`#${ID} input[name="calSchedule"]:checked`) || {}).value || 'actual,next';
    const groups = [...document.querySelectorAll(`#${ID} input[name="calGroup"]:checked`)].map(i => i.value);
    return calendarUrls({ origin: location.origin, type: state.selectedType, id: getDropdownValue(), schedule, groups });
}

function updateLinks() {
    $('calendarSubscribe').href = currentUrls().webcal;
}

/** Open the sheet for the timetable that is shown now. */
export function openCalendarSheet() {
    const id = getDropdownValue();
    if (!id) return;
    ensureDialog();
    const label = ($('valueDropdownLabel') || {}).textContent || id;
    const what = { Class: 'třídy', Teacher: 'vyučujícího', Room: 'učebny' }[state.selectedType] || '';
    $('calendarIntro').textContent = `Rozvrh ${what} ${label.trim()} se přidá jako odebíraný kalendář a bude se sám aktualizovat.`;
    const groups = state.selectedType === 'Class' ? classGroups(state.currentTimetableData) : [];
    $('calendarGroupsBox').hidden = groups.length === 0;
    $('calendarGroups').innerHTML = groups.map(g =>
        `<label class="cal-option cal-option-inline"><input type="checkbox" name="calGroup" value="${esc(g)}"> <span>${esc(g)}</span></label>`).join('');
    updateLinks();
    openBottomSheet(ID);
}
