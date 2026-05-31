/**
 * "Next lesson" widget
 *
 * Shows the current and/or next lesson for today (current schedule only) with a
 * live countdown, so the user sees at a glance what's running and what's next
 * without scanning the grid. Reuses data already in state.currentTimetableData.
 */

import { state } from './state.js';
import { lessonTimes } from './constants.js';
import { getTodayIndex, abbreviateSubject } from './utils.js';

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

/** Build a map hour -> representative lesson for today's valid lessons. */
function todaysLessonsByHour() {
    const today = getTodayIndex();
    if (today < 0) return null; // weekend

    const map = new Map();
    (state.currentTimetableData || []).forEach(l => {
        if (l.day !== today) return;
        if (l.type === 'removed' || l.type === 'absent') return;
        if (!l.subject || !l.subject.trim()) return;
        if (!map.has(l.hour)) map.set(l.hour, l);
    });
    return map;
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
        if (now >= s && now <= e) current = { lesson: map.get(h), end: e };
        if (now < s && !next) next = { lesson: map.get(h), start: s };
    }

    // Nothing running and nothing left today → hide (school day over).
    if (!current && !next) { el.classList.add('hidden'); return; }

    let html = '';
    if (current) {
        const subj = esc(abbreviateSubject(current.lesson.subject));
        const room = esc(current.lesson.room || '?');
        const left = Math.max(0, current.end - now);
        html += `<div class="nlw-block">
            <span class="nlw-lbl">Teď</span>
            <span class="nlw-main">${subj}</span>
            <span class="nlw-sub">${room} · končí <span class="nlw-cd">${inText(left)}</span></span>
        </div>`;
    }
    if (next) {
        const subj = esc(abbreviateSubject(next.lesson.subject));
        const room = esc(next.lesson.room || '?');
        const until = Math.max(0, next.start - now);
        html += (current ? '<div class="nlw-sep"></div>' : '') + `<div class="nlw-block nlw-next">
            <span class="nlw-lbl">${current ? 'Další' : 'Začátek'}</span>
            <span class="nlw-main">${subj}</span>
            <span class="nlw-sub">${room} · <span class="nlw-cd">${inText(until)}</span></span>
        </div>`;
    }

    el.innerHTML = html;
    el.classList.remove('hidden');
}

/** Start the periodic refresh (every 30s). Safe to call once. */
export function initNextLessonWidget() {
    if (intervalId) return;
    intervalId = setInterval(refreshNextLessonWidget, 30 * 1000);
}
