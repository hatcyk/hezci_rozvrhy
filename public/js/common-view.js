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
import { days, lessonTimes } from './constants.js';
import { updateViewParams } from './view-router.js';
import { shareLink } from './share.js';
import { czPlural } from './changes-core.js';

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
    $('commonPick').innerHTML = '<option value="">Vyberte vyučujícího nebo třídu…</option>'
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
        return `<li class="chip"><span>${esc(full)}</span><button type="button" class="chip-remove" data-key="${esc(`${s.type}:${s.id}`)}" aria-label="Odebrat ${esc(full)}"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></li>`;
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
        result.innerHTML = '';
        return;
    }
    status.textContent = 'Počítám společné volno…';
    result.setAttribute('aria-busy', 'true');
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
            : rs.map(r => `<span class="common-range${r.ideal ? ' is-ideal' : ''}">${esc(rangeLabel(r))}${r.ideal ? ' – všichni ve škole' : ' – někdo z vybraných nemá okolo výuku'}</span>`).join('; ');
        return `<li><strong>${esc(days[day])}:</strong> ${text}</li>`;
    }).join('');
    return `<h3 class="common-subtitle">Kdy mají všichni volno</h3><ul class="common-summary">${items}</ul>`;
}

function gridHtml(res) {
    const head = res.hours.map(h => {
        const t = lessonTimes.find(x => x.hour === h);
        return `<th scope="col"><span class="cg-hour">${h}.</span><span class="cg-time">${t ? esc(t.label.replace('-', '–')) : ''}</span></th>`;
    }).join('');
    const rows = res.rows.map(row => `<tr><th scope="row">${esc(days[row.day])}</th>${row.cells.map(c => {
        if (c.ideal) return '<td class="cg-cell is-ideal"><span class="cg-mark" aria-hidden="true">✓</span> Volno</td>';
        if (c.free) return `<td class="cg-cell is-free">Volno*<span class="sr-only"> (mimo výuku: ${esc(c.away.join(', '))})</span></td>`;
        return `<td class="cg-cell is-busy"><span class="sr-only">Obsazeno: </span><span class="cg-busy">${esc(c.busy.join(', '))}</span></td>`;
    }).join('')}</tr>`).join('');
    return `<h3 class="common-subtitle" id="commonGridTitle">Týden po hodinách</h3>
        <div class="table-scroll" role="region" aria-labelledby="commonGridTitle" tabindex="0">
            <table class="common-grid" aria-labelledby="commonGridTitle">
                <thead><tr><th scope="col">Den</th>${head}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="common-legend"><strong>Volno</strong> – nikdo z vybraných nemá výuku a všichni ji mají před touto hodinou i po ní, jsou tedy ve škole.
        <strong>Volno*</strong> – nikdo nemá výuku, ale někdo z vybraných ten den v tuto dobu podle rozvrhu ve škole být nemusí.
        V buňkách s výukou jsou vypsáni ti, kdo učí nebo se učí. Zrušená hodina se počítá jako volno, akce třídy nebo nepřítomnost učitele jako obsazeno.</p>`;
}
