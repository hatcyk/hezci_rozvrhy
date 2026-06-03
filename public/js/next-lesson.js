/**
 * "Next lesson" widget
 *
 * Shows the current and/or next lesson for today (current schedule only) with a
 * live countdown, so the user sees at a glance what's running and what's next
 * without scanning the grid. Reuses data already in state.currentTimetableData.
 *
 * Split (group) hours are handled: when an hour is divided between groups
 * (e.g. 1.SK has a different subject/room than 2.SK), both groups are shown
 * side by side instead of silently picking only the first one.
 */

import { state } from './state.js';
import { lessonTimes } from './constants.js';
import { getTodayIndex, abbreviateSubject, standardizeGroupName } from './utils.js';

let intervalId = null;

function nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
}

function startMin(hour) {
    const l = lessonTimes.find(x => x.hour === hour);
    return l ? l.start[0] * 60 + l.start[1] : null;
}
function endMin(hour) {
    const l = lessonTimes.find(x => x.hour === hour);
    return l ? l.end[0] * 60 + l.end[1] : null;
}

function pluralMin(n) {
    if (n === 1) return 'minutu';
    if (n >= 2 && n <= 4) return 'minuty';
    return 'minut';
}
function inText(n) {
    return n <= 0 ? 'teď' : `za ${n} ${pluralMin(n)}`;
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Group number for sorting (whole-class first, then 1, 2, …). */
function groupNum(l) {
    const m = (l.group || '').match(/(\d+)\s*\.?\s*sk/i);
    if (m) return parseInt(m[1], 10);
    return l.group ? 998 : 0; // named special groups after numbers, whole-class first
}

/** Short uppercase group label like "1.SK" ('' for whole-class). */
function groupLabel(l) {
    const g = standardizeGroupName(l.group);
    return g ? g.toUpperCase() : '';
}

/** Drop exact duplicates (same group + subject + room). */
function dedupe(lessons) {
    const seen = new Set();
    const out = [];
    for (const l of lessons) {
        const key = `${l.group || ''}|${l.subject || ''}|${l.room || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(l);
    }
    return out;
}

/** Build a map hour -> array of today's valid lessons (all groups), sorted by group. */
function todaysLessonsByHour() {
    const today = getTodayIndex();
    if (today < 0) return null; // weekend

    const map = new Map();
    (state.currentTimetableData || []).forEach(l => {
        if (l.day !== today) return;
        if (l.type === 'removed' || l.type === 'absent') return;
        if (!l.subject || !l.subject.trim()) return;
        if (!map.has(l.hour)) map.set(l.hour, []);
        map.get(l.hour).push(l);
    });
    for (const arr of map.values()) arr.sort((a, b) => groupNum(a) - groupNum(b));
    return map;
}

/** Render one block ("Teď" / "Další"), splitting into groups when needed. */
function blockHTML(label, lessons, countdownHtml, isNext) {
    const items = dedupe(lessons);
    const cls = `nlw-block${isNext ? ' nlw-next' : ''}`;

    if (items.length <= 1) {
        const l = items[0];
        const subj = esc(abbreviateSubject(l.subject));
        const room = esc(l.room || '?');
        return `<div class="${cls}">
            <span class="nlw-lbl">${label}</span>
            <span class="nlw-main">${subj}</span>
            <span class="nlw-sub"><span class="nlw-room">${room}</span> · ${countdownHtml}</span>
        </div>`;
    }

    const groups = items.map(l => {
        const subj = esc(abbreviateSubject(l.subject));
        const room = esc(l.room || '?');
        const g = esc(groupLabel(l));
        return `<div class="nlw-group">
            ${g ? `<span class="nlw-gbadge">${g}</span>` : ''}
            <span class="nlw-main">${subj}</span>
            <span class="nlw-sub"><span class="nlw-room">${room}</span></span>
        </div>`;
    }).join('');

    return `<div class="${cls} nlw-split">
        <div class="nlw-head">
            <span class="nlw-lbl">${label}</span>
            <span class="nlw-sub">${countdownHtml}</span>
        </div>
        <div class="nlw-groups">${groups}</div>
    </div>`;
}

/**
 * Recompute and render the widget. Hidden unless we're viewing the current
 * week's schedule on a weekday with at least one upcoming/ongoing lesson.
 */
export function refreshNextLessonWidget() {
    const el = document.getElementById('nextLessonWidget');
    if (!el) return;

    if (state.selectedScheduleType !== 'actual') { el.classList.add('hidden'); return; }

    const map = todaysLessonsByHour();
    if (!map || map.size === 0) { el.classList.add('hidden'); return; }

    const now = nowMinutes();
    const hours = [...map.keys()].sort((a, b) => a - b);

    let current = null;
    let next = null;
    for (const h of hours) {
        const s = startMin(h), e = endMin(h);
        if (s == null) continue;
        if (now >= s && now <= e) current = { lessons: map.get(h), end: e };
        if (now < s && !next) next = { lessons: map.get(h), start: s };
    }

    // Nothing running and nothing left today → hide (school day over).
    if (!current && !next) { el.classList.add('hidden'); return; }

    let html = '';
    if (current) {
        const left = Math.max(0, current.end - now);
        const cd = `končí <span class="nlw-cd">${inText(left)}</span>`;
        html += blockHTML('Teď', current.lessons, cd, false);
    }
    if (next) {
        const until = Math.max(0, next.start - now);
        const cd = `<span class="nlw-cd">${inText(until)}</span>`;
        html += (current ? '<div class="nlw-sep"></div>' : '')
            + blockHTML(current ? 'Další' : 'Začátek', next.lessons, cd, true);
    }

    el.innerHTML = html;
    el.classList.remove('hidden');
}

/** Start the periodic refresh (every 30s). Safe to call once. */
export function initNextLessonWidget() {
    if (intervalId) return;
    intervalId = setInterval(refreshNextLessonWidget, 30 * 1000);
}
