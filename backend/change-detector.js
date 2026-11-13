/**
 * Change Detector Module
 * Compares timetable snapshots and detects changes for notifications
 */

const { standardizeGroupName, mondayOf } = require('./bakalari-parser');

const DAY_LABELS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

/**
 * FCM: "Maximum payload for both message types is 4096 bytes"
 * (https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type).
 * The docs do not say how the bytes are counted, and on the web the payload is
 * also wrapped by FCM and encrypted for Web Push, where 4096 octets of body
 * leave "at most 3993 octets of plaintext" (RFC 8291, section 4). So we keep a
 * 512 B margin under the documented limit for the serialized `data` object.
 */
const FCM_MAX_PAYLOAD_BYTES = 4096;
const FCM_SAFE_DATA_BYTES = FCM_MAX_PAYLOAD_BYTES - 512;
/** Default budget of the expandable text; title, body and ids fit into the rest. */
const DETAILED_BODY_MAX_BYTES = 2500;

/**
 * Create a SLOT key for a lesson.
 *
 * Matches lessons between old/new snapshots by their position in the timetable
 * (day + hour + group), NOT by their content. This is what lets us detect a
 * substitution as a substitution: when the teacher changes, the lesson stays in
 * the same slot, so we compare old vs. new in that slot and emit one clean
 * "Suplování X → Y" change instead of a misleading removed+added pair.
 *
 * Group is part of the slot because group-divided lessons (1.sk / 2.sk) genuinely
 * occupy separate, parallel slots in the same day/hour. Several lessons can still
 * share one slot (e.g. two lessons of the same group); `pairSlotLessons` sorts
 * those out by content.
 */
function createLessonKey(lesson) {
    return `${lesson.day}-${lesson.hour}-${standardizeSlotGroup(lesson.group)}`;
}

/**
 * Normalize a group name for slot matching so the same group spelled differently
 * ("1. sk", "skupina 1", "sk1 - 1. skupina", "1.sk") maps to one slot. Whole class → ''.
 * Reuses the parser's normalization (single source of truth), lowercased so that
 * special groups (TVk1 / tvk1) match regardless of case.
 */
function standardizeSlotGroup(groupName) {
    return standardizeGroupName(groupName).toLowerCase();
}

/** Normalize a string for comparison (trim + lowercase, null-safe). */
function norm(value) {
    return (value == null ? '' : String(value)).trim().toLowerCase();
}

/**
 * Week of a snapshot derived from the lesson dates (S2: `lesson.date`).
 * Null when no lesson carries a date (permanent schedule, pre-2026 markup, old snapshots).
 */
function inferWeekStart(lessons) {
    for (const lesson of lessons || []) {
        const monday = lesson && lesson.date ? mondayOf(lesson.date) : null;
        if (monday) return monday;
    }
    return null;
}

/**
 * S2: choose which previous snapshot a freshly downloaded one may be compared with.
 * Comparing two different weeks reports their differences as "changes" (every
 * Monday the whole previous week's substitutions came back reversed), so:
 *  - same `weekStart` → compare with it;
 *  - a new `Actual` week that was the `Next` week before → compare with the old
 *    `Next` snapshot (it is the same week, seen a week earlier);
 *  - anything else (new `Next` week, unknown week, snapshot saved before weeks
 *    were stored) → no baseline, nothing is reported.
 * `Permanent` has no week (null) and is compared with its previous version.
 *
 * @param {Object} args
 * @param {'Actual'|'Next'|'Permanent'} args.scheduleType
 * @param {String|null} args.newWeekStart
 * @param {{ lessons: Array, weekStart?: String|null }|null} args.previous - same document, previous run
 * @param {{ lessons: Array, weekStart?: String|null }|null} [args.previousNext] - Next document of the same entity, previous run
 * @returns {{ baseline: Object|null, source: 'same'|'previousNext'|null, reason: String }}
 */
function selectComparisonBaseline({ scheduleType, newWeekStart, previous = null, previousNext = null }) {
    const hasLessons = (snap) => !!(snap && Array.isArray(snap.lessons) && snap.lessons.length > 0);

    if (scheduleType === 'Permanent') {
        return hasLessons(previous)
            ? { baseline: previous, source: 'same', reason: 'permanent' }
            : { baseline: null, source: null, reason: 'no_previous' };
    }
    if (!newWeekStart) return { baseline: null, source: null, reason: 'unknown_week' };
    if (hasLessons(previous) && previous.weekStart === newWeekStart) {
        return { baseline: previous, source: 'same', reason: 'same_week' };
    }
    if (scheduleType === 'Actual' && hasLessons(previousNext) && previousNext.weekStart === newWeekStart) {
        return { baseline: previousNext, source: 'previousNext', reason: 'next_became_actual' };
    }
    if (hasLessons(previous) && !previous.weekStart) {
        return { baseline: null, source: null, reason: 'previous_without_week' };
    }
    return { baseline: null, source: null, reason: hasLessons(previous) ? 'week_changed' : 'no_previous' };
}

/**
 * Compare two lesson objects occupying the SAME slot and detect what changed.
 *
 * Because lessons are matched by slot (day-hour-group), the teacher/subject
 * branches actually fire — a substitution in a slot is reported as a substitution,
 * not as a removed+added pair. Changes are prioritized so we emit one clear
 * headline per slot instead of a pile of overlapping events.
 */
function detectLessonChanges(oldLesson, newLesson) {
    const changes = [];
    const oldType = oldLesson.type || 'normal';
    const newType = newLesson.type || 'normal';

    // Headline change: the lesson became cancelled or absent. This supersedes any
    // teacher/room churn on the same slot, so report it alone.
    if (oldType !== newType && (newType === 'removed' || newType === 'absent')) {
        changes.push({ field: 'type', oldValue: oldType, newValue: newType, type: 'type_change' });
        return changes;
    }

    // Already cancelled/absent and staying that way — nothing meaningful to report.
    if (newType === 'removed' || newType === 'absent') {
        return changes;
    }

    // Active lesson: a changed subject means the whole lesson was swapped, so report
    // that instead of also flagging the (implied) teacher change. Otherwise a changed
    // teacher on the same subject is a substitution.
    if (norm(oldLesson.subject) !== norm(newLesson.subject)) {
        changes.push({ field: 'subject', oldValue: oldLesson.subject, newValue: newLesson.subject, type: 'subject_change' });
    } else if (norm(oldLesson.teacher) !== norm(newLesson.teacher)) {
        changes.push({ field: 'teacher', oldValue: oldLesson.teacher, newValue: newLesson.teacher, type: 'substitution' });
    }

    // A room change is useful alongside a substitution (often happens together).
    if (norm(oldLesson.room) !== norm(newLesson.room)) {
        changes.push({ field: 'room', oldValue: oldLesson.room, newValue: newLesson.room, type: 'room_change' });
    }

    return changes;
}

/**
 * Pair the lessons of one slot between the old and new snapshot.
 * Comparing only the first lesson of each side (the old behaviour) missed a change
 * of the second lesson in the slot, and reported nonsense when Bakaláři swapped
 * their order. Pairing goes from the most to the least certain match, first among
 * lessons in the same state (both taking place / both cancelled), then across:
 *   - same subject, teacher and type,
 *   - same subject and teacher (room may differ),
 *   - same subject (→ substitution),
 *   - same teacher (→ subject change),
 *   - whatever is left, in page order;
 * then live ↔ cancelled by subject+teacher, subject, and finally anything (e.g. a
 * cancelled lesson whose subject is an abbreviation from `removedinfo`).
 * @returns {{ pairs: Array<[Object, Object]>, removed: Array, added: Array }}
 */
function pairSlotLessons(oldList, newList) {
    const olds = oldList.map(lesson => ({ lesson, used: false }));
    const news = newList.map(lesson => ({ lesson, used: false }));
    const pairs = [];

    const sameSubject = (a, b) => norm(a.subject) === norm(b.subject);
    const sameTeacher = (a, b) => norm(a.teacher) !== '' && norm(a.teacher) === norm(b.teacher);
    const sameLesson = (a, b) => sameSubject(a, b) && sameTeacher(a, b);
    // "Live" = taking place (normal or absent), as opposed to a cancelled ("removed") entry.
    // On a substitution the class timetable holds the substitute AND a struck-through copy
    // of the original lesson (addRemovedLessonsFromPermanent); the old lesson must pair
    // with the substitute (→ substitution), not with its own cancelled copy (→ "odpadla" + "přidána").
    const live = (l) => l.type !== 'removed';
    const sameState = (a, b) => live(a) === live(b);
    const passes = [
        (a, b) => sameLesson(a, b) && (a.type || 'normal') === (b.type || 'normal'),
        (a, b) => sameState(a, b) && sameLesson(a, b),
        (a, b) => sameState(a, b) && sameSubject(a, b),
        (a, b) => sameState(a, b) && sameTeacher(a, b),
        (a, b) => sameState(a, b),
        sameLesson,
        sameSubject,
        () => true,
    ];
    for (const matches of passes) {
        for (const o of olds) {
            if (o.used) continue;
            const n = news.find(candidate => !candidate.used && matches(o.lesson, candidate.lesson));
            if (!n) continue;
            o.used = true;
            n.used = true;
            pairs.push([o.lesson, n.lesson]);
        }
    }

    return {
        pairs,
        removed: olds.filter(o => !o.used).map(o => o.lesson),
        added: news.filter(n => !n.used).map(n => n.lesson),
    };
}

function describeLessonChange(change, oldLesson, newLesson) {
    if (change.type === 'substitution') {
        return `Suplování: ${newLesson.subject} - ${oldLesson.teacher} → ${newLesson.teacher}`;
    }
    if (change.type === 'room_change') {
        return `Změna místnosti: ${newLesson.subject} - ${oldLesson.room || 'žádná'} → ${newLesson.room || 'žádná'}`;
    }
    if (change.type === 'subject_change') {
        return `Změna předmětu: ${oldLesson.subject} → ${newLesson.subject}`;
    }
    if (change.type === 'type_change') {
        return newLesson.type === 'absent'
            ? `Absence: ${newLesson.subject} (${newLesson.teacher})`
            : `Odpadla hodina: ${newLesson.subject} (${newLesson.teacher})`;
    }
    return '';
}

/** Chronological order (day, hour, group) so summaries read like the timetable. */
function compareChanges(a, b) {
    return (a.day ?? 99) - (b.day ?? 99)
        || (a.hour ?? 99) - (b.hour ?? 99)
        || standardizeSlotGroup(a.lesson && a.lesson.group).localeCompare(standardizeSlotGroup(b.lesson && b.lesson.group));
}

/**
 * Compare two timetable snapshots and detect all changes.
 *
 * Both snapshots must describe the same week (S2). The caller picks a matching
 * baseline with `selectComparisonBaseline`; as a second safety net, snapshots
 * whose lesson dates (or the given week starts) fall in different weeks are not
 * compared at all.
 *
 * The former 4th parameter `permanentData` (filter "revert to the permanent
 * schedule") is gone: that filter could never fire (it handled `lesson_removed`,
 * which only exists when the slot is EMPTY in the new snapshot, but required a
 * lesson in that slot), and the situation it targeted — last week's exception vs.
 * this week's normal lesson — is a cross-week comparison, now excluded above.
 * Within one week a return to the normal lesson is a real change and is reported.
 * An array passed as the 4th argument is ignored for backwards compatibility.
 *
 * @param {Array} oldData - Previous snapshot of lessons
 * @param {Array} newData - Current snapshot of lessons
 * @param {Object} metadata - Timetable metadata (type, id, name, scheduleType)
 * @param {{ oldWeekStart?: String|null, newWeekStart?: String|null }} [options]
 * @returns {Array} List of detected changes, in chronological order
 */
function detectTimetableChanges(oldData, newData, metadata, options = {}) {
    const opts = options && !Array.isArray(options) ? options : {};
    const oldWeek = opts.oldWeekStart !== undefined ? opts.oldWeekStart : inferWeekStart(oldData);
    const newWeek = opts.newWeekStart !== undefined ? opts.newWeekStart : inferWeekStart(newData);
    if (oldWeek && newWeek && oldWeek !== newWeek) {
        return [];
    }

    const changes = [];
    const timestamp = new Date().toISOString();
    const entry = (type, lesson, description, change) => ({
        type,
        timetable: metadata,
        lesson,
        day: lesson.day,
        dayName: lesson.dayName,
        hour: lesson.hour,
        ...(change ? { change } : {}),
        description,
        timestamp,
    });

    const bySlot = (lessons) => {
        const map = new Map();
        for (const lesson of lessons || []) {
            const key = createLessonKey(lesson);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(lesson);
        }
        return map;
    };
    const oldSlots = bySlot(oldData);
    const newSlots = bySlot(newData);

    for (const key of new Set([...oldSlots.keys(), ...newSlots.keys()])) {
        const { pairs, removed, added } = pairSlotLessons(oldSlots.get(key) || [], newSlots.get(key) || []);

        // A lesson that was already cancelled and has now disappeared is not news.
        for (const lesson of removed) {
            if (lesson.type === 'removed') continue;
            changes.push(entry('lesson_removed', lesson, `Odpadla hodina: ${lesson.subject} (${lesson.teacher})`));
        }
        // A cancelled lesson appearing is not a new lesson (it is reported as type_change when paired).
        for (const lesson of added) {
            if (lesson.type === 'removed') continue;
            changes.push(entry('lesson_added', lesson, `Přidána hodina: ${lesson.subject} (${lesson.teacher})`));
        }
        for (const [oldLesson, newLesson] of pairs) {
            for (const change of detectLessonChanges(oldLesson, newLesson)) {
                changes.push(entry(change.type, newLesson, describeLessonChange(change, oldLesson, newLesson), change));
            }
        }
    }

    return changes.sort(compareChanges);
}

// ───────────────────────────────────────────────────────────────────────────
// Notification texts
// ───────────────────────────────────────────────────────────────────────────

function dayLabelOf(change) {
    if (change.dayName) return change.dayName;
    return DAY_LABELS[change.day] || String(change.day ?? '');
}

/** "1 další změna", "3 další změny", "5 dalších změn" (Czech plural). */
function moreChangesText(count) {
    if (count === 1) return '1 další změna';
    if (count >= 2 && count <= 4) return `${count} další změny`;
    return `${count} dalších změn`;
}

/** One-line text of a change for the notification body (without the time prefix). */
function shortChangeText(change) {
    const subject = change.lesson ? change.lesson.subject : '';
    switch (change.type) {
        case 'lesson_removed':
            return `${subject} odpadla`;
        case 'type_change':
            // A lesson in the slot turned into cancelled / absent.
            return change.change?.newValue === 'absent' ? `${subject} - absence` : `${subject} odpadla`;
        case 'substitution':
            return `${subject} - supluje ${change.change?.newValue || change.lesson.teacher}`;
        case 'room_change':
            return `${subject} - učebna ${change.change?.newValue || change.lesson.room}`;
        case 'lesson_added':
            return `Přidána ${subject}`;
        case 'subject_change':
            return `Změna na ${change.change?.newValue || subject}`;
        default:
            return '';
    }
}

/** Detailed line (with old → new values) for the expandable notification. */
function detailedChangeText(change) {
    const lesson = change.lesson || {};
    switch (change.type) {
        case 'type_change':
            return change.change?.newValue === 'absent' ? `${lesson.subject} - absence` : `${lesson.subject} odpadla`;
        case 'lesson_removed':
            return `${lesson.subject} odpadla`;
        case 'substitution':
            return `${lesson.subject} - ${change.change?.oldValue || ''} → ${change.change?.newValue || lesson.teacher}`;
        case 'room_change':
            return `${lesson.subject} - učebna ${change.change?.oldValue || 'žádná'} → ${change.change?.newValue || lesson.room}`;
        case 'lesson_added':
            return `Přidána ${lesson.subject} (${lesson.teacher})`;
        case 'subject_change':
            return `${change.change?.oldValue || ''} → ${change.change?.newValue || lesson.subject}`;
        default:
            return '';
    }
}

/** Changes grouped by day in chronological order: [{ label, date, changes }] */
function groupByDay(changes) {
    const groups = new Map();
    for (const change of [...changes].sort(compareChanges)) {
        const key = change.day ?? dayLabelOf(change);
        if (!groups.has(key)) {
            groups.set(key, { label: dayLabelOf(change), date: change.lesson && change.lesson.date, changes: [] });
        }
        groups.get(key).changes.push(change);
    }
    return [...groups.values()];
}

/**
 * Create human-readable summary of changes for notification.
 * At most 2 changes per day and 3 in total are written out; the rest is
 * summarized as "a N další(ch) změn(y)" where N is exactly the number of
 * changes that are not shown (the old code counted text fragments instead).
 * @param {Array} changes - List of changes for a timetable
 * @returns {String} e.g. "Po 3.h: Matematika odpadla; Út 1.h: Fyzika - supluje J. Nová; a 2 další změny"
 */
function createChangeSummary(changes) {
    const MAX_PER_DAY = 2;
    const MAX_TOTAL = 3;
    const shown = [];
    let describable = 0;

    for (const group of groupByDay(changes)) {
        let shownToday = 0;
        for (const change of group.changes) {
            const text = shortChangeText(change);
            if (!text) continue;
            describable++;
            if (shownToday < MAX_PER_DAY && shown.length < MAX_TOTAL) {
                shown.push(`${group.label} ${change.hour}.h: ${text}`);
                shownToday++;
            }
        }
    }

    const hidden = describable - shown.length;
    return hidden > 0 ? `${shown.join('; ')}; a ${moreChangesText(hidden)}` : shown.join('; ');
}

const utf8Bytes = (text) => Buffer.byteLength(text, 'utf8');

/**
 * Cut `text` so that `measure(result) <= maxBytes`, on a code-point boundary,
 * preferably at a line break, ending with "…".
 */
function truncateToBytes(text, maxBytes, measure = utf8Bytes) {
    if (measure(text) <= maxBytes) return text;
    const chars = Array.from(text);
    const ELLIPSIS = '…';
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) { // longest prefix that still fits together with the ellipsis
        const mid = Math.ceil((lo + hi) / 2);
        if (measure(chars.slice(0, mid).join('') + ELLIPSIS) <= maxBytes) lo = mid;
        else hi = mid - 1;
    }
    if (lo === 0) return measure(ELLIPSIS) <= maxBytes ? ELLIPSIS : '';
    let prefix = chars.slice(0, lo).join('');
    const lastBreak = prefix.lastIndexOf('\n');
    if (lastBreak > prefix.length / 2) prefix = prefix.slice(0, lastBreak + 1);
    return prefix + ELLIPSIS;
}

/** "Po 9. 11." from dayName + 'YYYY-MM-DD' */
function dayHeader(group) {
    const m = String(group.date || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
    return m ? `${group.label} ${Number(m[2])}. ${Number(m[1])}.` : group.label;
}

/**
 * Create detailed text for expandable notification.
 * The text is limited to `maxBytes` (UTF-8) so the FCM data message stays under
 * its size limit: whole lines are kept and the rest is summarized as
 * "… a N dalších změn" with N = changes that did not fit.
 * @param {Array} changes - List of changes for a timetable
 * @param {{ maxBytes?: Number }} [options]
 * @returns {String} Detailed text grouped by day
 */
function createDetailedChangeSummary(changes, { maxBytes = DETAILED_BODY_MAX_BYTES } = {}) {
    const days = groupByDay(changes)
        .map(group => ({
            header: `${dayHeader(group)}:`,
            lines: group.changes.map(change => {
                const text = detailedChangeText(change);
                return text ? `  ${change.hour}.h: ${text}` : '';
            }).filter(Boolean),
        }))
        .filter(day => day.lines.length > 0);

    const full = days.map(day => `${day.header}\n${day.lines.join('\n')}`).join('\n\n');
    if (utf8Bytes(full) <= maxBytes) return full;

    const total = days.reduce((sum, day) => sum + day.lines.length, 0);
    const footerFor = (hidden) => `\n\n… a ${moreChangesText(hidden)}`;
    const budget = maxBytes - utf8Bytes(footerFor(total)); // the longest possible footer
    const parts = [];
    let used = 0;
    let shown = 0;
    outer:
    for (const day of days) {
        for (let i = 0; i < day.lines.length; i++) {
            const piece = (i === 0 ? `${parts.length ? '\n\n' : ''}${day.header}\n` : '\n') + day.lines[i];
            if (used + utf8Bytes(piece) > budget) break outer;
            parts.push(piece);
            used += utf8Bytes(piece);
            shown++;
        }
    }

    const text = parts.join('') + footerFor(total - shown);
    // Safety net for absurdly small budgets or a single gigantic line.
    return truncateToBytes(text, maxBytes);
}

/**
 * Make an FCM data payload (string values) fit the size limit by shortening
 * `detailedBody` first and, only if that is not enough, `body`.
 * Size = UTF-8 bytes of the JSON-serialized object (keys included, JSON escaping
 * of "\n" counted), which is at least what FCM sends.
 * @param {Object<string,string>} data
 * @param {{ maxBytes?: Number }} [options]
 * @returns {Object<string,string>} a copy that fits (or the same object if it already fits)
 */
function fitFcmDataPayload(data, { maxBytes = FCM_SAFE_DATA_BYTES } = {}) {
    const size = (obj) => utf8Bytes(JSON.stringify(obj));
    if (size(data) <= maxBytes) return data;

    const fitted = { ...data };
    for (const field of ['detailedBody', 'body']) {
        if (typeof fitted[field] !== 'string' || fitted[field] === '') continue;
        const overhead = size({ ...fitted, [field]: '' });
        const available = maxBytes - overhead;
        // measure as a JSON string literal without its two quotes
        fitted[field] = truncateToBytes(fitted[field], Math.max(available, 0), (s) => utf8Bytes(JSON.stringify(s)) - 2);
        if (size(fitted) <= maxBytes) return fitted;
    }
    return fitted;
}

module.exports = {
    detectTimetableChanges,
    selectComparisonBaseline,
    inferWeekStart,
    createChangeSummary,
    createDetailedChangeSummary,
    fitFcmDataPayload,
    truncateToBytes,
    FCM_MAX_PAYLOAD_BYTES,
    FCM_SAFE_DATA_BYTES,
    DETAILED_BODY_MAX_BYTES,
};
