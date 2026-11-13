/**
 * Aggregates (S3)
 *
 * Small summary documents computed by prefetch from the timetables it already
 * holds in memory — no extra request to Bakaláři, and the client reads one
 * document instead of 16 class or 28 room timetables:
 *   aggregates/changes_Actual|Next    — all changed / cancelled / absent lessons of all classes
 *   aggregates/freeRooms_Actual|Next  — for every day × hour the rooms without a lesson
 */

const { addDaysIso } = require('./bakalari-parser');

const WEEK_DAYS = [0, 1, 2, 3, 4];
const collator = new Intl.Collator('cs', { numeric: true });

/** Room/class names like "2.A" or "A104" in natural order (2.A < 10.A, A20 < A104). */
const byName = (a, b) => collator.compare(String(a || ''), String(b || ''));

/**
 * The week the aggregate describes: the most common `weekStart` of the snapshots.
 * A snapshot from another week (e.g. its download failed and an old one is kept)
 * would put another week's lessons on the board, so such snapshots are left out.
 * @param {Array<{weekStart?: String|null}>} snapshots
 * @returns {String|null}
 */
function dominantWeekStart(snapshots) {
    const counts = new Map();
    for (const snap of snapshots) {
        const week = snap.weekStart || null;
        counts.set(week, (counts.get(week) || 0) + 1);
    }
    let best = null;
    let bestCount = -1;
    for (const [week, count] of counts) {
        // prefer a known week on a tie
        if (count > bestCount || (count === bestCount && best === null && week !== null)) {
            best = week;
            bestCount = count;
        }
    }
    return best;
}

function kindOf(lesson) {
    if (lesson.type === 'removed') return 'removed';
    if (lesson.type === 'absent') return 'absent';
    return 'changed';
}

/**
 * aggregates/changes_{Actual|Next}
 * @param {Array<{ id: String, name: String, lessons: Array, weekStart?: String|null }>} classSnapshots
 * @param {{ generatedAt: String }} options
 * @returns {{ weekStart, generatedAt, days: Array<{ day, date, items: Array }> }}
 */
function buildChangesAggregate(classSnapshots, { generatedAt }) {
    const snapshots = (classSnapshots || []).filter(snap => snap && Array.isArray(snap.lessons));
    const weekStart = dominantWeekStart(snapshots);
    const days = WEEK_DAYS.map(day => ({ day, date: weekStart ? addDaysIso(weekStart, day) : null, items: [] }));

    for (const snap of snapshots) {
        if ((snap.weekStart || null) !== weekStart) continue;
        for (const lesson of snap.lessons) {
            if (!(lesson.changed || lesson.type === 'removed' || lesson.type === 'absent')) continue;
            const bucket = days[lesson.day];
            if (!bucket) continue; // weekend / unknown day index
            bucket.items.push({
                classId: String(snap.id),
                className: String(snap.name || snap.id),
                hour: lesson.hour,
                group: lesson.group || null,
                subject: lesson.subject || '',
                teacher: lesson.teacher || '',
                room: lesson.room || null,
                kind: kindOf(lesson),
                description: (lesson.changeInfo && lesson.changeInfo.description) || '',
            });
        }
    }

    for (const bucket of days) {
        bucket.items.sort((a, b) => byName(a.className, b.className)
            || a.hour - b.hour
            || byName(a.group || '', b.group || ''));
    }

    return { weekStart, generatedAt, days };
}

/**
 * aggregates/freeRooms_{Actual|Next}
 * A room is free in (day, hour) when its timetable has no lesson there that is
 * not `removed` (a cancelled lesson frees the room). Rooms without a usable
 * timetable for the week are left out of `rooms` and `free` entirely — "we
 * don't know" must not look like "free".
 * @param {Array<{ id: String, name: String, lessons: Array, weekStart?: String|null }>} roomSnapshots
 * @param {{ generatedAt: String, hours: Array<Number> }} options - hours = lesson numbers of the raster
 * @returns {{ weekStart, generatedAt, rooms: Array<{id,name}>, free: Object<String, Array<String>> }}
 */
function buildFreeRoomsAggregate(roomSnapshots, { generatedAt, hours }) {
    const snapshots = (roomSnapshots || []).filter(snap => snap && Array.isArray(snap.lessons));
    const weekStart = dominantWeekStart(snapshots);
    const known = snapshots
        .filter(snap => (snap.weekStart || null) === weekStart)
        .sort((a, b) => byName(a.name, b.name));

    const hourList = hours && hours.length ? [...hours] : inferHours(known);
    const busy = new Map(known.map(snap => [snap.id, new Set(
        snap.lessons.filter(l => l.type !== 'removed').map(l => `${l.day}-${l.hour}`),
    )]));

    const free = {};
    for (const day of WEEK_DAYS) {
        for (const hour of hourList) {
            const slot = `${day}-${hour}`;
            free[slot] = known.filter(snap => !busy.get(snap.id).has(slot)).map(snap => String(snap.id));
        }
    }

    return {
        weekStart,
        generatedAt,
        rooms: known.map(snap => ({ id: String(snap.id), name: String(snap.name || snap.id) })),
        free,
    };
}

/** Fallback raster (pre-2026 pages have none): every hour between the first and last lesson seen. */
function inferHours(snapshots) {
    const seen = snapshots.flatMap(snap => snap.lessons.map(l => l.hour)).filter(Number.isInteger);
    if (seen.length === 0) return [];
    const min = Math.min(...seen);
    const max = Math.max(...seen);
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** JSON with sorted object keys — Firestore does not promise to return map keys in insertion order. */
function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

/** Same content apart from `generatedAt` → no write needed. */
function sameAggregateContent(a, b) {
    if (!a || !b) return false;
    const { generatedAt: _a, ...restA } = a;
    const { generatedAt: _b, ...restB } = b;
    return stableStringify(restA) === stableStringify(restB);
}

module.exports = {
    buildChangesAggregate,
    buildFreeRoomsAggregate,
    dominantWeekStart,
    stableStringify,
    sameAggregateContent,
};
