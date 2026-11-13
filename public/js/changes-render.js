/**
 * HTML of "originally → now" change entries (changes-core.js), shared by the
 * changes board, the "only changes" timetable mode and the kiosk.
 * Everything from Bakaláři goes through esc() (stored XSS, see utils.js).
 */

import { esc, abbreviateTeacherName, standardizeGroupName } from './utils.js';
import { lessonTimes } from './constants.js';
import { KIND_LABELS } from './changes-core.js';
import { state } from './state.js';

export const teacherShort = (name) => (name ? abbreviateTeacherName(name, state.teacherAbbreviationMap) : '');

const timeOf = (hour) => {
    const t = lessonTimes.find(x => x.hour === hour);
    return t ? t.label.replace('-', '–') : '';
};

/** "Fyzika · E. Testová · U15" as HTML; the original of a cancellation is struck through. */
export function briefHtml(b, { strike = false } = {}) {
    if (!b) return '<span class="chg-none">—</span>';
    const meta = [teacherShort(b.teacher), b.room].filter(Boolean).map(esc).join(' · ');
    const subject = `<span class="chg-subject">${esc(b.subject || 'bez předmětu')}</span>`;
    const body = `${subject}${meta ? ` <span class="chg-meta">${meta}</span>` : ''}`;
    return strike ? `<s class="chg-struck">${body}</s>` : body;
}

/** Plain text of the same, for aria / share texts. */
export function briefText(b) {
    if (!b) return '';
    return [b.subject, teacherShort(b.teacher), b.room].filter(Boolean).join(', ');
}

export function kindBadge(kind) {
    return `<span class="chg-kind chg-kind--${esc(kind)}">${esc(KIND_LABELS[kind] || 'Změna')}</span>`;
}

/** Contents of the "now" cell: kind word + new lesson + note. */
export function afterHtml(entry) {
    let html = kindBadge(entry.kind);
    if (entry.kind === 'absent' && entry.event && entry.event !== entry.note) {
        html += ` <span class="chg-subject">${esc(entry.event)}</span>`;
    } else if (entry.after) {
        html += ` ${briefHtml(entry.after)}`;
    }
    if (entry.note) html += ` <span class="chg-note">${esc(entry.note)}</span>`;
    return html;
}

export function hourHtml(entry) {
    const group = entry.group ? standardizeGroupName(entry.group) || entry.group : '';
    return `<span class="chg-hour">${esc(entry.hour)}.</span>`
        + ` <span class="chg-time">${esc(timeOf(entry.hour))}</span>`
        + (group ? ` <span class="chg-group">${esc(group)}</span>` : '');
}

/**
 * Table of entries: Hodina | Původně | Nyní. Row headers are the lesson
 * numbers, so a screen reader announces "3. 9:45–10:30" with every cell.
 * @param {Array} entries
 * @param {string} labelledBy - id of the heading that names the table
 */
export function entriesTableHtml(entries, labelledBy) {
    const rows = entries.map(e => `
        <tr class="chg-row chg-row--${esc(e.kind)}">
            <th scope="row">${hourHtml(e)}</th>
            <td class="chg-before">${briefHtml(e.before, { strike: e.kind === 'removed' || e.kind === 'absent' })}</td>
            <td class="chg-after">${afterHtml(e)}</td>
        </tr>`).join('');
    return `
        <table class="chg-table" aria-labelledby="${esc(labelledBy)}">
            <thead><tr><th scope="col">Hodina</th><th scope="col">Původně</th><th scope="col">Nyní</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

/** Ids for headings: only [A-Za-z0-9_-] (class ids come from Bakaláři). */
export function safeId(prefix, raw) {
    return `${prefix}-${String(raw).replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.codePointAt(0).toString(16)}`)}`;
}
