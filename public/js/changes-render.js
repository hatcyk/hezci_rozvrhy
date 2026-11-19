/**
 * HTML of "originally → now" change entries (changes-core.js), shared by the
 * changes board, the "only changes" timetable mode, the lesson detail and the kiosk.
 * Everything from Bakaláři goes through esc() (stored XSS, see utils.js).
 *
 * Design G: the state is always an icon + a word ("suplování", "jiná učebna",
 * "odpadá", "akce", "změna"); only the icon is coloured, the word stays white.
 */

import { esc, abbreviateTeacherName, standardizeGroupName } from './utils.js';
import { lessonTimes } from './constants.js';
import { state } from './state.js';

export const teacherShort = (name) => (name ? abbreviateTeacherName(name, state.teacherAbbreviationMap) : '');

/** Sprite icon (decorative; the word next to it carries the meaning). */
export const icon = (name, cls = '') => `<svg class="i${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="icons.svg#${name}"></use></svg>`;

/** Word, icon and accent of every kind of change (accent = g-st--… / g-bar--…). */
export const KIND_UI = {
    substitution: { word: 'suplování', icon: 'repeat-2', tone: 'sub' },
    roomChange: { word: 'jiná učebna', icon: 'door-open', tone: 'room' },
    changed: { word: 'změna', icon: 'arrow-left-right', tone: 'extra' },
    removed: { word: 'odpadá', icon: 'ban', tone: 'cancel' },
    absent: { word: 'akce', icon: 'flag', tone: 'extra' },
};
const uiOf = (kind) => KIND_UI[kind] || KIND_UI.changed;
export const kindTone = (kind) => uiOf(kind).tone;

const timeOf = (hour) => {
    const t = lessonTimes.find(x => x.hour === hour);
    return t ? t.label.replace('-', '–') : '';
};

/** "8:50–9:35" with both ends in their own span (a narrow row stacks them). */
const timeHtml = (hour) => {
    const [from, to] = timeOf(hour).split('–');
    return to ? `<span class="chg-t1">${esc(from)}</span><span class="chg-dash">–</span><span class="chg-t2">${esc(to)}</span>` : esc(from || '');
};

/** "Fyzika  E. Testová  U15" as HTML (separate spans, no "·" joins); a cancelled original is struck through. */
export function briefHtml(b, { strike = false } = {}) {
    if (!b) return '<span class="chg-none">—</span>';
    const teacher = teacherShort(b.teacher);
    const meta = [
        teacher ? `<span class="chg-teacher">${esc(teacher)}</span>` : '',
        b.room ? `<span class="chg-room">${esc(b.room)}</span>` : '',
    ].filter(Boolean).join(' ');
    const subject = `<span class="chg-subject">${esc(b.subject || 'bez předmětu')}</span>`;
    const body = `${subject}${meta ? ` <span class="chg-meta">${meta}</span>` : ''}`;
    return strike ? `<s class="chg-struck">${body}</s>` : body;
}

/** Plain text of the same, for aria / share texts. */
export function briefText(b) {
    if (!b) return '';
    return [b.subject, teacherShort(b.teacher), b.room].filter(Boolean).join(', ');
}

/** State of a change: coloured icon + white word. */
export function kindBadge(kind) {
    const ui = uiOf(kind);
    return `<span class="chg-kind g-st g-st--${ui.tone}">${icon(ui.icon)}${esc(ui.word)}</span>`;
}

/** Contents of the "now" cell: state + new lesson + note. */
export function afterHtml(entry) {
    let main = '';
    if (entry.kind === 'absent' && entry.event && entry.event !== entry.note) {
        main = `<span class="chg-subject">${esc(entry.event)}</span>`;
    } else if (entry.after) {
        main = briefHtml(entry.after);
    }
    let html = kindBadge(entry.kind);
    if (main) html += ` <span class="chg-now">${main}</span>`;
    if (entry.note) html += ` <span class="chg-note">${esc(entry.note)}</span>`;
    return html;
}

export function hourHtml(entry) {
    const group = entry.group ? standardizeGroupName(entry.group) || entry.group : '';
    return `<span class="chg-hour">${esc(entry.hour)}.</span>`
        + ` <span class="chg-time">${timeHtml(entry.hour)}</span>`
        + (group ? ` <span class="chg-group">${esc(group)}</span>` : '');
}

/**
 * Table of entries: Hodina | Původně | Nyní. Row headers are the lesson
 * numbers, so a screen reader announces "3. 9:45–10:30" with every cell.
 * On a phone the row becomes two lines (now, then "původně …") by CSS only.
 * @param {Array} entries
 * @param {string} labelledBy - id of the heading that names the table
 */
export function entriesTableHtml(entries, labelledBy) {
    const rows = entries.map(e => {
        const struck = e.kind === 'removed' || e.kind === 'absent';
        const before = e.before
            ? `<td class="chg-before"><span class="chg-lbl" aria-hidden="true">původně</span> ${briefHtml(e.before, { strike: struck })}</td>`
            : '<td class="chg-before is-empty"><span class="chg-none">—</span></td>';
        return `
        <tr class="chg-row chg-row--${esc(e.kind)}">
            <th scope="row" class="chg-h g-bar g-bar--${kindTone(e.kind)}">${hourHtml(e)}</th>
            ${before}
            <td class="chg-after">${afterHtml(e)}</td>
        </tr>`;
    }).join('');
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
