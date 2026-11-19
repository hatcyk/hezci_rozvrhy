/**
 * "Změny" (?view=changes): the school-wide substitution board for today /
 * tomorrow, read from aggregates/changes_Actual|Next (S3) - two Firestore
 * reads instead of every class timetable, no request to Bakaláři.
 *
 * Design G: one sentence on top like Apple Weather ("Dnes 12 změn v 6 třídách:
 * 7 suplování, 3 jiné učebny a 2 odpadají."), quick days as a segmented
 * control, every class a content module (g-veil) with its rows.
 */

import { fetchAggregate, fetchBackendStatus } from './api.js';
import {
    boardDayOptions, pickBoardDate, boardEntries, filterEntries, groupByClass,
    teachersMatch, teachersInEntries, dayLabel, shortDayLabel, czPlural, freshnessText, isoDate, parseIso, addDaysIso,
} from './changes-core.js';
import { entriesTableHtml, safeId, icon } from './changes-render.js';
import { state } from './state.js';
import { esc, setPressed } from './utils.js';
import { updateViewParams, openTimetable } from './view-router.js';
import { timetableUrl } from './view-route.js';
import { shareLink } from './share.js';

let model = null;
let filters = { date: null, class: '', teacher: '' };
let wired = false;
let loadSeq = 0;

const $ = (id) => document.getElementById(id);
const ON_DAY = ['v neděli', 'v pondělí', 'v úterý', 've středu', 've čtvrtek', 'v pátek', 'v sobotu'];
const SHORT_DAY = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
const QUICK_DAYS = 4;

/** Kinds in the summary sentence, in this order, with Czech plural forms. */
const SUMMARY_KINDS = [
    ['substitution', ['suplování', 'suplování', 'suplování']],
    ['roomChange', ['jiná učebna', 'jiné učebny', 'jiných učeben']],
    ['removed', ['odpadá', 'odpadají', 'odpadá']],
    ['absent', ['akce', 'akce', 'akcí']],
    ['changed', ['jiná změna', 'jiné změny', 'jiných změn']],
];

/** "Dnes" / "Zítra" / "Ve čtvrtek 12. 11." for sentences. */
function onDayPhrase(iso, now) {
    const today = isoDate(now);
    if (iso === today) return 'Dnes';
    if (iso === addDaysIso(today, 1)) return 'Zítra';
    const d = parseIso(iso);
    const p = ON_DAY[d.getDay()];
    return `${p.charAt(0).toUpperCase()}${p.slice(1)} ${d.getDate()}. ${d.getMonth() + 1}.`;
}

/** "a, b a c" */
function joinAnd(parts) {
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} a ${parts[parts.length - 1]}`;
}

/** "Dnes 12 změn v 6 třídách: 7 suplování, 3 jiné učebny a 2 odpadají." */
export function summarySentence(when, entries, classCount, scope = '') {
    const counts = new Map();
    for (const e of entries) counts.set(e.kind, (counts.get(e.kind) || 0) + 1);
    const parts = SUMMARY_KINDS.filter(([k]) => counts.get(k)).map(([k, forms]) => czPlural(counts.get(k), forms));
    const where = classCount > 1 ? ` v ${czPlural(classCount, ['třídě', 'třídách', 'třídách'])}` : '';
    return `${when} ${czPlural(entries.length, ['změna', 'změny', 'změn'])}${scope}${where}: ${joinAnd(parts)}.`;
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
    $('changesList').addEventListener('click', (e) => {
        // Empty states point somewhere: another day, or without the filter
        const go = e.target.closest('button[data-go-date]');
        if (go) {
            filters.date = go.dataset.goDate;
            render();
            const pressed = $('changesQuickDays').querySelector('[aria-pressed="true"]');
            if (pressed) pressed.focus();
            return;
        }
        if (e.target.closest('button[data-clear-filter]')) {
            filters.class = '';
            filters.teacher = '';
            render();
            $('changesClass').focus();
            return;
        }
        const link = e.target.closest('a[data-open-class]');
        if (link && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            openTimetable({ type: 'Class', id: link.dataset.openClass, schedule: link.dataset.week, day: Number(link.dataset.day) });
        }
    });
}

function skeletonHtml() {
    const mod = (rows) => `<div class="chg-class chg-skel g-veil g-mod" aria-hidden="true"><div class="g-skel chg-skel-head"></div>${'<div class="g-skel chg-skel-row"></div>'.repeat(rows)}</div>`;
    return mod(2) + mod(3) + mod(1);
}

function setBusy(busy) {
    const list = $('changesList');
    list.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (busy && !model) {
        $('changesSummary').textContent = 'Načítám změny…';
        list.innerHTML = skeletonHtml();
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

/** Quick days: today (if in the data) and the next school days, as a segmented control. */
function quickDates(options, now) {
    const today = isoDate(now);
    const quick = [];
    if (options.some(o => o.date === today)) quick.push(today);
    for (const o of options) {
        if (quick.length >= QUICK_DAYS) break;
        if (o.date > today) quick.push(o.date);
    }
    return quick;
}

/** "Dnes", "Zítra", otherwise "Pá 6. 11." (visible text = accessible name) */
function quickLabel(iso, now) {
    const label = shortDayLabel(iso, now);
    if (label === 'Dnes' || label === 'Zítra') return label;
    const d = parseIso(iso);
    return `${SHORT_DAY[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`;
}

function fillQuickDays(container, options, date, now) {
    const quick = quickDates(options, now);
    container.innerHTML = quick.map(d =>
        `<button type="button" data-date="${esc(d)}" aria-pressed="false">${esc(quickLabel(d, now))}</button>`).join('');
    container.hidden = quick.length === 0;
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

/** Empty state that says what to do next. */
function emptyHtml({ when, filtered, nextDate, now }) {
    const title = `${when} ${filtered ? 'pro tento výběr ' : ''}žádné změny`;
    let hint;
    let action = '';
    if (filtered) {
        hint = 'Ostatní třídy a vyučující změny mít můžou.';
        action = `<button type="button" class="g-btn g-btn--small" data-clear-filter>${icon('x')}Zrušit filtr</button>`;
    } else if (nextDate) {
        hint = 'Hodiny proběhnou podle rozvrhu.';
        const which = nextDate === addDaysIso(isoDate(now), 1) ? 'zítřek' : dayLabel(nextDate, now, { relative: false });
        action = `<button type="button" class="g-btn g-btn--small" data-go-date="${esc(nextDate)}">${icon('arrow-right')}Ukázat ${esc(which)}</button>`;
    } else {
        hint = 'Hodiny proběhnou podle rozvrhu.';
    }
    return `<div class="g-empty g-veil chg-empty">${icon('circle-check')}<strong>${esc(title)}.</strong><span>${esc(hint)}</span>${action}</div>`;
}

function classModuleHtml(g, option) {
    const id = safeId('chg-class', g.classId);
    const week = option.source === 'Next' ? 'next' : 'actual';
    const href = timetableUrl({ type: 'Class', id: g.classId, schedule: week, day: option.day });
    return `<section class="chg-class g-veil g-mod">
        <div class="chg-class-head">
            <h3 class="chg-class-title" id="${id}">${esc(g.className)} <span class="chg-count">${czPlural(g.entries.length, ['změna', 'změny', 'změn'])}</span></h3>
            <a class="chg-open g-btn g-btn--quiet g-btn--small" href="${esc(href)}" data-open-class="${esc(g.classId)}" data-week="${week}" data-day="${esc(option.day)}" aria-label="Otevřít rozvrh třídy ${esc(g.className)}">Rozvrh${icon('chevron-right')}</a>
        </div>
        ${entriesTableHtml(g.entries, id)}
    </section>`;
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
        $('changesQuickDays').hidden = true;
        summary.textContent = '';
        $('changesFreshness').textContent = freshnessText({ lastSuccessAt: model.status && model.status.lastSuccessAt }, now);
        list.innerHTML = `<div class="g-empty g-veil chg-empty">${icon('clock')}<strong>Přehled změn zatím není k dispozici.</strong>`
            + '<span>Vznikne po příštím stažení dat z Bakalářů – zkuste to prosím později.</span></div>';
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
        const nextDate = (options.find(o => o.date > date && o.items.length) || {}).date || null;
        list.innerHTML = emptyHtml({ when, filtered, nextDate, now });
    } else {
        const scope = [
            filters.class && groups[0] ? ` ve třídě ${groups[0].className}` : '',
            teacherDef ? ` u vyučujícího ${teacherDef.name}` : '',
        ].join('');
        summary.textContent = summarySentence(when, shown, groups.length, scope);
        list.innerHTML = groups.map(g => classModuleHtml(g, option)).join('');
    }

    // Shareable state: the explicitly chosen day and the filters
    updateViewParams({ date: filters.date && filters.date === date ? date : '', class: filters.class, teacher: filters.teacher });
}
