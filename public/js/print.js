/**
 * Printable week grid (A4 landscape, see css/print.css). Built as a plain
 * <table> from the loaded lessons, independent of the on-screen layout - a
 * phone in the agenda layout prints the whole week as well.
 * Changes are marked with words and line styles, not colour only, so they
 * stay readable on a black-and-white printer.
 */

import { esc, abbreviateSubject, abbreviateTeacherName, standardizeGroupName, parseGroupName } from './utils.js';
import { days, lessonTimes } from './constants.js';

const FLAG = { changed: 'změna', removed: 'odpadá', absent: 'nekoná se' };

function flagOf(lesson) {
    if (lesson.type === 'removed') return 'removed';
    if (lesson.type === 'absent') return 'absent';
    return lesson.changed ? 'changed' : '';
}

function groupNo(g) {
    const m = /(\d+)\.\s*sk/i.exec(g || '');
    return m ? Number(m[1]) : 999;
}

function lessonHtml(lesson, type, abbrMap) {
    const flag = flagOf(lesson);
    const subject = esc(abbreviateSubject(lesson.subject) || lesson.subject || '');
    const parsed = parseGroupName(lesson.group);
    const classId = parsed ? parsed.classId : '';
    const teacher = abbreviateTeacherName(lesson.teacher, abbrMap);
    const meta = type === 'Teacher' ? [classId, lesson.room]
        : type === 'Room' ? [teacher, classId]
            : [teacher, lesson.room];
    const group = type === 'Class' && lesson.group ? standardizeGroupName(lesson.group) : '';
    const body = `<span class="pl-subject">${subject}</span>${group ? ` <span class="pl-group">${esc(group)}</span>` : ''}`
        + `<span class="pl-meta">${meta.filter(Boolean).map(esc).join(' · ')}</span>`;
    return `<div class="pl${flag ? ` pl--${flag}` : ''}">${flag === 'removed' ? `<s>${body}</s>` : body}`
        + `${flag ? `<span class="pl-flag">${FLAG[flag]}</span>` : ''}</div>`;
}

/**
 * @param {Array} lessons - lessons of the shown week (state.currentTimetableData)
 * @param {{ title: string, subtitle?: string, type?: 'Class'|'Teacher'|'Room', abbrMap?: Map, dates?: string[] }} opts
 *        dates: labels under the day names ("2. 11.") - none for the permanent timetable
 * @returns {string} HTML
 */
export function printSheetHtml(lessons, { title, subtitle = '', type = 'Class', abbrMap = null, dates = [] } = {}) {
    const list = Array.isArray(lessons) ? lessons : [];
    const seen = list.map(l => l.hour).filter(Number.isInteger);
    const min = seen.length ? Math.min(...seen) : 1;
    const max = seen.length ? Math.max(...seen) : 6;
    const hours = lessonTimes.map(t => t.hour).filter(h => h >= min && h <= max);
    const anyChange = list.some(l => flagOf(l));

    const head = hours.map(h => {
        const t = lessonTimes.find(x => x.hour === h);
        return `<th scope="col">${h}.<span class="pg-time">${t ? esc(t.label.replace('-', '–')) : ''}</span></th>`;
    }).join('');

    const rows = days.map((name, d) => {
        const cells = hours.map(h => {
            const inSlot = list.filter(l => l.day === d && l.hour === h)
                .sort((a, b) => groupNo(a.group) - groupNo(b.group));
            return `<td>${inSlot.map(l => lessonHtml(l, type, abbrMap)).join('')}</td>`;
        }).join('');
        const date = dates[d] ? `<span class="pg-date">${esc(dates[d])}</span>` : '';
        return `<tr><th scope="row">${esc(name)}${date}</th>${cells}</tr>`;
    }).join('');

    return `<h1 class="pg-title">${esc(title)}</h1>
        ${subtitle ? `<p class="pg-sub">${esc(subtitle)}</p>` : ''}
        <table class="print-grid">
            <thead><tr><th scope="col">Den</th>${head}</tr></thead>
            <tbody>${rows}</tbody>
        </table>
        ${anyChange ? '<p class="pg-legend"><span class="pl pl--changed pl-sample">změna</span> suplování nebo jiná změna · <span class="pl pl--removed pl-sample"><s>předmět</s> odpadá</span> hodina se nekoná</p>' : ''}`;
}
