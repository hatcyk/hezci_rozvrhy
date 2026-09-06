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

/** How far (0–100) we are through a lesson running from `start`..`end` (minutes). */
function progressPct(start, end) {
    const d = new Date();
    const nowFrac = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    const dur = end - start;
    if (dur <= 0) return 0;
    const pct = ((nowFrac - start) / dur) * 100;
    return Math.max(0, Math.min(100, pct)).toFixed(1);
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

/**
 * Build a map hour -> descriptor for today's lessons.
 *
 * Each descriptor is { survivors, cancelled, isSplit }:
 *  - survivors: live lessons (not removed/absent, non-empty subject), sorted by
 *    group and deduped.
 *  - isSplit:   true if any RAW row in the hour carries a group label, i.e. the
 *    hour is divided between groups (so we must label every group on screen).
 *  - cancelled: { lesson, cancelled:true } entries for groups whose lesson was
 *    removed/absent while a sibling group still has a live lesson, so the student
 *    can tell the surviving block isn't theirs. Only kept when survivors exist.
 *
 * Fully-cancelled hours (no survivors) are omitted entirely, preserving the
 * existing hide/skip behaviour.
 */
function todaysLessonsByHour() {
    const today = getTodayIndex();
    if (today < 0) return null; // weekend

    // Bucket ALL rows for today by hour, without dropping removed/absent first.
    const raw = new Map();
    (state.currentTimetableData || []).forEach(l => {
        if (l.day !== today) return;
        if (!raw.has(l.hour)) raw.set(l.hour, []);
        raw.get(l.hour).push(l);
    });

    const map = new Map();
    for (const [hour, rows] of raw) {
        const isCancelled = l => l.type === 'removed' || l.type === 'absent';

        let survivors = rows.filter(l => !isCancelled(l) && l.subject && l.subject.trim());
        survivors.sort((a, b) => groupNum(a) - groupNum(b));
        survivors = dedupe(survivors);
        if (survivors.length === 0) continue; // fully cancelled / empty hour → skip

        // Split only when the hour holds more than one distinct group, i.e. it's
        // genuinely divided. A lone stray group tag on an otherwise whole-class
        // hour is NOT a split (avoids a single badged column for a whole-class lesson).
        const isSplit = new Set(rows.map(groupLabel).filter(Boolean)).size > 1;

        // Cancelled sibling groups: removed/absent rows with a group label not
        // already covered by a survivor. Only meaningful when survivors exist.
        // Dedupe by group label so a group with several removed rows shows once.
        const survivorLabels = new Set(survivors.map(groupLabel));
        const seenCancelled = new Set();
        const cancelled = [];
        for (const l of rows) {
            const g = groupLabel(l);
            if (!isCancelled(l) || g === '' || survivorLabels.has(g) || seenCancelled.has(g)) continue;
            seenCancelled.add(g);
            cancelled.push({ lesson: l, cancelled: true });
        }

        map.set(hour, { survivors, cancelled, isSplit });
    }
    return map;
}

/**
 * Short group badge for a lesson: its real label, else derive "N.SK" from the
 * group number when it's a plain numbered group (1–4). Never invents an ordinal
 * for unnamed/special groups — returns '' so the badge is simply omitted.
 */
function groupBadge(l) {
    const real = groupLabel(l);
    if (real) return real;
    const n = groupNum(l);
    return n >= 1 && n <= 4 ? `${n}.SK` : '';
}

/** Render one group column (live or cancelled). */
function groupHTML(l, cancelled) {
    const subj = esc(abbreviateSubject(l.subject));
    const badge = esc(groupBadge(l));
    const badgeHtml = badge ? `<span class="nlw-gbadge">${badge}</span>` : '';
    if (cancelled) {
        const aria = badge ? `${badge}: odpadlo` : 'odpadlo';
        return `<div class="nlw-group nlw-cancelled" aria-label="${aria}">
            ${badgeHtml}
            <span class="nlw-main">${subj}</span>
            <span class="nlw-odpadlo">odpadlo</span>
        </div>`;
    }
    const room = esc(l.room || '?');
    return `<div class="nlw-group">
        ${badgeHtml}
        <span class="nlw-main">${subj}</span>
        <span class="nlw-sub"><span class="nlw-room">${room}</span></span>
    </div>`;
}

/** Render one block ("Teď" / "Další"), splitting into groups when needed. */
function blockHTML(label, descriptor, countdownHtml, isNext, live) {
    const { survivors, cancelled, isSplit } = descriptor;
    const cls = `nlw-block${isNext ? ' nlw-next' : ''}`;
    const dot = live ? '<span class="nlw-dot"></span>' : '';
    const lbl = `<span class="nlw-lbl">${dot}${label}</span>`;

    // Compact single-block only when the hour is NOT split and there's one lesson.
    if (!isSplit && survivors.length <= 1) {
        const l = survivors[0];
        const subj = esc(abbreviateSubject(l.subject));
        const room = esc(l.room || '?');
        return `<div class="${cls}">
            ${lbl}
            <span class="nlw-main">${subj}</span>
            <span class="nlw-sub"><span class="nlw-room">${room}</span> · ${countdownHtml}</span>
        </div>`;
    }

    // Group layout: each group carries its own badge (derived from its real group).
    const liveGroups = survivors.map(l => groupHTML(l, false)).join('');
    const cancelledGroups = cancelled.map(c => groupHTML(c.lesson, true)).join('');

    return `<div class="${cls} nlw-split">
        <div class="nlw-head">
            ${lbl}
            <span class="nlw-sub">${countdownHtml}</span>
        </div>
        <div class="nlw-groups">${liveGroups}${cancelledGroups}</div>
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
        if (now >= s && now <= e) current = { descriptor: map.get(h), start: s, end: e };
        if (now < s && !next) next = { descriptor: map.get(h), start: s };
    }

    // Nothing running and nothing left today → hide (school day over).
    if (!current && !next) { el.classList.add('hidden'); return; }

    let html = '';
    if (current) {
        const left = Math.max(0, current.end - now);
        const cd = `končí <span class="nlw-cd">${inText(left)}</span>`;
        html += blockHTML('Teď', current.descriptor, cd, false, true);
    }
    if (next) {
        const until = Math.max(0, next.start - now);
        const cd = `<span class="nlw-cd">${inText(until)}</span>`;
        html += (current ? '<div class="nlw-sep"></div>' : '')
            + blockHTML(current ? 'Další' : 'Začátek', next.descriptor, cd, true, false);
    }

    // Progress bar along the bottom: how much of the current lesson is already behind us.
    if (current) {
        const pct = progressPct(current.start, current.end);
        html += `<div class="nlw-progress" aria-hidden="true"><div class="nlw-progress-fill" style="width:${pct}%"></div></div>`;
    }

    el.innerHTML = html;
    el.classList.remove('hidden');
}

/** Start the periodic refresh (every 15s). Safe to call once. */
export function initNextLessonWidget() {
    if (intervalId) return;
    // Skip the re-render while the tab is hidden; the visibilitychange
    // listener below catches up as soon as it becomes visible again.
    intervalId = setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        refreshNextLessonWidget();
    }, 15 * 1000);

    // Re-render when the tab returns to the foreground: mobile browsers suspend
    // timers in the background, so finished lessons would otherwise linger.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshNextLessonWidget();
    });
    window.addEventListener('focus', refreshNextLessonWidget);
    window.addEventListener('pageshow', refreshNextLessonWidget);
    window.addEventListener('online', refreshNextLessonWidget);
}
