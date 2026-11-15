/**
 * "Společné volno" (?view=common): pick 2–6 teachers and/or classes and see
 * the lessons of the week in which none of them is taught - for agreeing on a
 * consultation, a meeting or a make-up test. Reads only the stored timetables
 * timetables/{Type}_{id}_{Actual|Next|Permanent}.
 */

import { fetchTimetable } from './api.js';
import { commonFreeSlots, freeRanges, rangeLabel, parseEntityList, formatEntityList, MIN_ENTITIES, MAX_ENTITIES } from './common-free-core.js';
import { state } from './state.js';
import { esc, setPressed, abbreviateTeacherName, getMondayOfWeek } from './utils.js';
import { days, daysShort, lessonTimes } from './constants.js';
import { updateViewParams } from './view-router.js';
import { shareLink } from './share.js';
import { czPlural } from './changes-core.js';
import { icon } from './changes-render.js';

const WEEK_TEXT = { actual: 'tento týden', next: 'příští týden', permanent: 'podle stálého rozvrhu' };

let selection = [];
let week = 'actual';
let wired = false;
let runSeq = 0;
const $ = (id) => document.getElementById(id);

function definitionOf({ type, id }) {
    const list = type === 'Teacher' ? state.definitions.teachers : state.definitions.classes;
    return (list || []).find(x => x.id === id) || null;
}

/** Full name for the chips, short one for the grid. */
function labels(entity) {
    const def = definitionOf(entity);
    const name = def ? def.name : entity.id;
    if (entity.type === 'Teacher') return { full: name, short: abbreviateTeacherName(name, state.teacherAbbreviationMap) || name };
    return { full: `třída ${name}`, short: name };
}

function wire() {
    if (wired) return;
    wired = true;
    $('commonAdd').addEventListener('click', addPicked);
    $('commonPick').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPicked(); } });
    $('commonChosen').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-key]');
        if (!btn) return;
        const idx = selection.findIndex(s => `${s.type}:${s.id}` === btn.dataset.key);
        if (idx === -1) return;
        selection.splice(idx, 1);
        update();
        // the chip is gone: continue from the picker
        $('commonPick').focus();
    });
    $('commonWeek').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-week]');
        if (!btn) return;
        week = btn.dataset.week;
        update();
    });
    $('commonShare').addEventListener('click', () => {
        shareLink({ title: 'Společné volno', text: $('commonStatus').textContent.trim(), url: location.href });
    });
}

function addPicked() {
    const value = $('commonPick').value;
    if (!value) return;
    const [type, ...rest] = value.split(':');
    const id = rest.join(':');
    if (selection.length >= MAX_ENTITIES) return;
    if (!selection.some(s => s.type === type && s.id === id)) selection.push({ type, id });
    update();
    $('commonPick').focus();
}

/** Show the view. Params from the URL: with (Teacher:T1,Class:XX) and week. */
export async function enterCommonView(params = {}) {
    wire();
    selection = parseEntityList(params.with).filter(e => definitionOf(e));
    week = params.week || 'actual';
    update();
}

function fillPicker() {
    const taken = new Set(selection.map(s => `${s.type}:${s.id}`));
    const opt = (type, x) => (taken.has(`${type}:${x.id}`) ? '' : `<option value="${esc(type)}:${esc(x.id)}">${esc(x.name)}</option>`);
    const teachers = [...(state.definitions.teachers || [])].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    const classes = [...(state.definitions.classes || [])].sort((a, b) => a.name.localeCompare(b.name, 'cs', { numeric: true }));
    $('commonPick').innerHTML = '<option value="">Vyberte ze seznamu…</option>'
        + `<optgroup label="Vyučující">${teachers.map(t => opt('Teacher', t)).join('')}</optgroup>`
        + `<optgroup label="Třídy">${classes.map(c => opt('Class', c)).join('')}</optgroup>`;
    const full = selection.length >= MAX_ENTITIES;
    $('commonPick').disabled = full;
    $('commonAdd').disabled = full;
}

function update() {
    fillPicker();
    $('commonChosen').innerHTML = selection.map(s => {
        const { full } = labels(s);
        return `<li class="chip">${icon(s.type === 'Teacher' ? 'user' : 'users')}<span class="chip-name">${esc(full)}</span><button type="button" class="chip-remove" data-key="${esc(`${s.type}:${s.id}`)}" aria-label="Odebrat ${esc(full)}">${icon('x')}</button></li>`;
    }).join('');
    $('commonChosen').hidden = selection.length === 0;
    setPressed($('commonWeek').querySelectorAll('button'), b => b.dataset.week === week);
    updateViewParams({ with: formatEntityList(selection), week: week === 'actual' ? '' : week });
    compute();
}

async function compute() {
    const status = $('commonStatus');
    const result = $('commonResult');
    const seq = ++runSeq;
    if (selection.length < MIN_ENTITIES) {
        status.textContent = selection.length === 0
            ? `Vyberte aspoň ${MIN_ENTITIES} vyučující nebo třídy (nejvýš ${MAX_ENTITIES}).`
            : 'Přidejte ještě aspoň jednoho vyučujícího nebo třídu.';
        result.innerHTML = selection.length === 0
            ? `<div class="g-empty g-veil common-empty">${icon('users')}<strong>Kdo se má sejít?</strong>`
                + '<span>Třeba vyučující a třída na konzultaci, nebo několik vyučujících na poradu. Ukážeme hodiny, kdy mají všichni volno.</span></div>'
            : '';
        return;
    }
    status.textContent = 'Počítám společné volno…';
    result.setAttribute('aria-busy', 'true');
    if (!result.firstElementChild) result.innerHTML = '<div class="g-veil g-mod common-skel" aria-hidden="true"><div class="g-skel"></div><div class="g-skel"></div><div class="g-skel"></div></div>';
    const monday = getMondayOfWeek(0).toISOString().split('T')[0];
    const loaded = await Promise.all(selection.map(async (s) => {
        try {
            return { ok: true, lessons: await fetchTimetable(s.type, s.id, week, monday) };
        } catch (err) {
            return { ok: false, error: err };
        }
    }));
    if (seq !== runSeq) return;
    result.setAttribute('aria-busy', 'false');

    const failed = selection.filter((_, i) => !loaded[i].ok);
    if (failed.length) {
        // Without every timetable a slot cannot be called free for everybody
        status.textContent = `Rozvrh ${failed.map(f => labels(f).short).join(', ')} se nepodařilo načíst, společné volno proto nelze spočítat.`;
        result.innerHTML = '';
        return;
    }

    const entities = selection.map((s, i) => ({ id: `${s.type}:${s.id}`, label: labels(s).short, lessons: loaded[i].lessons }));
    const res = commonFreeSlots(entities);
    const ranges = freeRanges(res);
    const freeCount = res.rows.reduce((n, r) => n + r.cells.filter(c => c.free).length, 0);
    const idealCount = res.rows.reduce((n, r) => n + r.cells.filter(c => c.ideal).length, 0);
    status.textContent = freeCount === 0
        ? `Vybraní nemají ${WEEK_TEXT[week]} žádnou společnou volnou hodinu.`
        : `${WEEK_TEXT[week].charAt(0).toUpperCase()}${WEEK_TEXT[week].slice(1)}: ${czPlural(freeCount, ['společně volná hodina', 'společně volné hodiny', 'společně volných hodin'])}, z toho ${idealCount}, kdy jsou všichni ve škole.`;
    result.innerHTML = summaryHtml(ranges) + gridHtml(res);
}

function summaryHtml(ranges) {
    const items = ranges.map(({ day, ranges: rs }) => {
        const text = rs.length === 0
            ? '<span class="common-none">žádné společné volno</span>'
            : rs.map(r => `<span class="common-range${r.ideal ? ' is-ideal' : ''}">${icon(r.ideal ? 'circle-check' : 'circle-alert')}<span>${esc(rangeLabel(r))}${r.ideal ? ', všichni ve škole' : ', někdo z vybraných okolo nemá výuku'}</span></span>`).join('');
        return `<li><strong class="common-day">${esc(days[day])}</strong><span class="common-ranges">${text}</span></li>`;
    }).join('');
    return `<section class="g-veil g-mod common-mod" aria-labelledby="commonSumTitle">
        <h3 class="common-subtitle g-mod-head" id="commonSumTitle">${icon('calendar-range')}Kdy mají všichni volno</h3>
        <ul class="common-summary" role="list">${items}</ul>
    </section>`;
}

/** Week grid: hours down, days across (like the week view); free = filled + word, busy = muted. */
function gridHtml(res) {
    const head = res.days.map(d => `<th scope="col"><span aria-hidden="true">${esc(daysShort[d])}</span><span class="vh">${esc(days[d])}</span></th>`).join('');
    const byDay = new Map(res.rows.map(r => [r.day, r]));
    const rows = res.hours.map((h, i) => {
        const t = lessonTimes.find(x => x.hour === h);
        const cells = res.days.map(d => {
            const c = byDay.get(d).cells[i];
            if (c.ideal) return `<td class="cg-cell is-ideal">${icon('check')}<span>volno</span></td>`;
            if (c.free) return `<td class="cg-cell is-free"><span>volno*</span><span class="vh"> (mimo výuku: ${esc(c.away.join(', '))})</span></td>`;
            return `<td class="cg-cell is-busy"><span class="vh">Obsazeno: </span><span class="cg-busy">${esc(c.busy.join(', '))}</span><span class="cg-busy-n" aria-hidden="true">${icon('user')}${c.busy.length}</span></td>`;
        }).join('');
        const [from, to] = t ? t.label.split('-') : ['', ''];
        const time = t ? `<span class="cg-t1">${esc(from)}</span><span class="cg-dash">–</span><span class="cg-t2">${esc(to)}</span>` : '';
        return `<tr><th scope="row"><span class="cg-hour">${h}.</span><span class="cg-time">${time}</span></th>${cells}</tr>`;
    }).join('');
    return `<section class="g-veil g-mod common-mod" aria-labelledby="commonGridTitle">
        <h3 class="common-subtitle g-mod-head" id="commonGridTitle">${icon('calendar-days')}Týden po hodinách</h3>
        <div class="table-scroll" role="region" aria-labelledby="commonGridTitle" tabindex="0">
            <table class="common-grid">
                <thead><tr><th scope="col"><span class="vh">Hodina</span></th>${head}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <ul class="common-legend" role="list">
            <li><span class="cg-sample is-ideal" aria-hidden="true">volno</span><span><strong>Volno</strong>: nikdo z vybraných nemá výuku a všichni jsou ten den ve škole před touto hodinou i po ní.</span></li>
            <li><span class="cg-sample is-free" aria-hidden="true">volno*</span><span><strong>Volno*</strong>: nikdo nemá výuku, ale někdo z vybraných v tu dobu ve škole být nemusí.</span></li>
            <li><span class="cg-sample is-busy" aria-hidden="true">obsazeno</span><span><strong>Obsazeno</strong>: někdo z vybraných učí nebo se učí. V buňce jsou jejich jména, na úzké obrazovce jen jejich počet. Zrušená hodina se počítá jako volno, akce třídy nebo nepřítomnost učitele jako obsazeno.</span></li>
        </ul>
    </section>`;
}
