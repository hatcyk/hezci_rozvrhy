/**
 * "Změny" (?view=changes): the school-wide substitution board for today /
 * tomorrow, read from aggregates/changes_Actual|Next (S3) - two Firestore
 * reads instead of every class timetable, no request to Bakaláři.
 */

import { fetchAggregate, fetchBackendStatus } from './api.js';
import {
    boardDayOptions, pickBoardDate, boardEntries, filterEntries, groupByClass,
    teachersMatch, teachersInEntries, dayLabel, shortDayLabel, czPlural, freshnessText, isoDate, parseIso, addDaysIso,
} from './changes-core.js';
import { entriesTableHtml, safeId } from './changes-render.js';
import { state } from './state.js';
import { esc, setPressed } from './utils.js';
import { updateViewParams } from './view-router.js';
import { shareLink } from './share.js';

let model = null;
let filters = { date: null, class: '', teacher: '' };
let wired = false;
let loadSeq = 0;

const $ = (id) => document.getElementById(id);
const ON_DAY = ['v neděli', 'v pondělí', 'v úterý', 've středu', 've čtvrtek', 'v pátek', 'v sobotu'];

/** "Dnes" / "Zítra" / "Ve čtvrtek 12. 11." for sentences. */
function onDayPhrase(iso, now) {
    const today = isoDate(now);
    if (iso === today) return 'Dnes';
    if (iso === addDaysIso(today, 1)) return 'Zítra';
    const d = parseIso(iso);
    const p = ON_DAY[d.getDay()];
    return `${p.charAt(0).toUpperCase()}${p.slice(1)} ${d.getDate()}. ${d.getMonth() + 1}.`;
}

function wire() {
    if (wired) return;
    wired = true;
    $('changesDay').addEventListener('change', (e) => { filters.date = e.target.value || null; render(); });
    $('changesClass').addEventListener('change', (e) => { filters.class = e.target.value; render(); });
    $('changesTeacher').addEventListener('change', (e) => { filters.teacher = e.target.value; render(); });
    $('changesQuickDays').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-date]');
        if (!btn) return;
        filters.date = btn.dataset.date;
        render();
    });
    $('changesShare').addEventListener('click', () => {
        shareLink({
            title: 'Změny v rozvrhu',
            text: $('changesSummary').textContent.trim(),
            url: location.href,
        });
    });
}

function setBusy(busy) {
    const list = $('changesList');
    list.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (busy && !model) {
        $('changesSummary').textContent = 'Načítám změny…';
        list.innerHTML = '<div class="view-loading" aria-hidden="true"><span></span><span></span><span></span></div>';
    }
}

/**
 * Show the board. Called by the router with the URL parameters.
 * @param {{ date?: string, class?: string, teacher?: string }} params
 */
export async function enterChangesView(params = {}) {
    wire();
    filters = { date: params.date || null, class: params.class || '', teacher: params.teacher || '' };
    const seq = ++loadSeq;
    setBusy(true);
    const [actual, next, status] = await Promise.all([
        fetchAggregate('changes_Actual').catch(() => null),
        fetchAggregate('changes_Next').catch(() => null),
        fetchBackendStatus(),
    ]);
    if (seq !== loadSeq) return; // a newer load replaced this one
    model = {
        actual, next, status,
        options: boardDayOptions({ Actual: actual && actual.data, Next: next && next.data }),
    };
    setBusy(false);
    render();
}

function fillDaySelect(select, options, date, now) {
    const groups = [['Actual', 'Tento týden'], ['Next', 'Příští týden']];
    select.innerHTML = groups.map(([source, label]) => {
        const opts = options.filter(o => o.source === source);
        if (!opts.length) return '';
        return `<optgroup label="${label}">${opts.map(o =>
            `<option value="${esc(o.date)}"${o.date === date ? ' selected' : ''}>${esc(dayLabel(o.date, now))}${o.items.length ? '' : ' – bez změn'}</option>`).join('')}</optgroup>`;
    }).join('');
}

function fillQuickDays(container, options, date, now) {
    const today = isoDate(now);
    const quick = [];
    if (options.some(o => o.date === today)) quick.push(today);
    const next = options.find(o => o.date > today);
    if (next) quick.push(next.date);
    container.innerHTML = quick.map(d =>
        `<button type="button" class="seg-btn" data-date="${esc(d)}" aria-pressed="false">${esc(shortDayLabel(d, now))}</button>`).join('');
    setPressed(container.querySelectorAll('button'), b => b.dataset.date === date);
}

function fillClassSelect(select, entries) {
    const seen = new Map();
    for (const e of entries) if (!seen.has(e.classId)) seen.set(e.classId, e.className);
    if (filters.class && !seen.has(filters.class)) {
        const def = (state.definitions.classes || []).find(c => c.id === filters.class);
        seen.set(filters.class, def ? def.name : filters.class);
    }
    select.innerHTML = '<option value="">Všechny třídy</option>'
        + [...seen].map(([id, name]) => `<option value="${esc(id)}"${id === filters.class ? ' selected' : ''}>${esc(name)}</option>`).join('');
}

function fillTeacherSelect(select, entries) {
    const names = teachersInEntries(entries);
    const defs = (state.definitions.teachers || [])
        .filter(t => t.id === filters.teacher || names.some(n => teachersMatch(n, t.name)))
        .sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    select.innerHTML = '<option value="">Všichni vyučující</option>'
        + defs.map(t => `<option value="${esc(t.id)}"${t.id === filters.teacher ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
    select.disabled = defs.length === 0;
}

function render() {
    if (!model) return;
    const now = new Date();
    const list = $('changesList');
    const summary = $('changesSummary');
    const { options } = model;

    if (options.length === 0) {
        ['changesDay', 'changesClass', 'changesTeacher'].forEach(id => { $(id).disabled = true; });
        $('changesQuickDays').innerHTML = '';
        summary.textContent = '';
        $('changesFreshness').textContent = freshnessText({ lastSuccessAt: model.status && model.status.lastSuccessAt }, now);
        list.innerHTML = `<p class="view-empty">Přehled změn zatím není k dispozici. Vznikne po příštím stažení dat z Bakalářů – zkuste to prosím později.</p>`;
        return;
    }
    ['changesDay', 'changesClass'].forEach(id => { $(id).disabled = false; });

    const date = options.some(o => o.date === filters.date) ? filters.date : pickBoardDate(options, now);
    const option = options.find(o => o.date === date);
    const entries = boardEntries(option);

    fillDaySelect($('changesDay'), options, date, now);
    fillQuickDays($('changesQuickDays'), options, date, now);
    fillClassSelect($('changesClass'), entries);
    fillTeacherSelect($('changesTeacher'), entries);

    const teacherDef = (state.definitions.teachers || []).find(t => t.id === filters.teacher);
    const shown = filterEntries(entries, { classId: filters.class, teacher: teacherDef ? teacherDef.name : '' });
    const groups = groupByClass(shown);

    const src = option.source === 'Next' ? model.next : model.actual;
    $('changesFreshness').textContent = freshnessText({
        lastSuccessAt: model.status && model.status.lastSuccessAt,
        generatedAt: src && src.data && src.data.generatedAt,
        fromCache: !!(src && src.fromCache),
        cacheAgeMs: src && src.cacheAgeMs,
    }, now);

    const when = onDayPhrase(date, now);
    const filtered = !!(filters.class || filters.teacher);
    if (shown.length === 0) {
        summary.textContent = '';
        list.innerHTML = `<p class="view-empty"><svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
            + `${esc(when)} ${filtered ? 'pro tento výběr ' : ''}žádné změny.</p>`;
    } else {
        summary.textContent = `${when}: ${czPlural(shown.length, ['změna', 'změny', 'změn'])}`
            + (groups.length > 1 ? ` v ${czPlural(groups.length, ['třídě', 'třídách', 'třídách'])}` : '')
            + (filtered ? ' (filtr)' : '');
        list.innerHTML = groups.map(g => {
            const id = safeId('chg-class', g.classId);
            return `<section class="chg-class">
                <h3 class="chg-class-title" id="${id}">${esc(g.className)} <span class="chg-count">${czPlural(g.entries.length, ['změna', 'změny', 'změn'])}</span></h3>
                ${entriesTableHtml(g.entries, id)}
            </section>`;
        }).join('');
    }

    // Shareable state: the explicitly chosen day and the filters
    updateViewParams({ date: filters.date && filters.date === date ? date : '', class: filters.class, teacher: filters.teacher });
}
