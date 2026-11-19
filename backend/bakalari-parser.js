/**
 * Bakaláři parser & normalization helpers
 *
 * Single source of truth for everything that turns raw Bakaláři data into the
 * lesson objects stored in Firestore and consumed by the client, the change
 * detector, FCM group filtering and lesson reminders.
 */

const cheerio = require('cheerio');

const DAY_NAMES = ['po', 'út', 'st', 'čt', 'pá'];

/**
 * Standardize a group name so the same group spelled differently maps to one value.
 *   "1. sk" / "skupina 1" / "1.skupina"  → "1.sk"
 *   "TVk1" / "TVDi"                        → kept as-is (special groups)
 *   "celá třída"                           → '' (whole class, treated like "no group")
 * @param {String} groupName
 * @returns {String}
 */
function standardizeGroupName(groupName) {
    if (!groupName) return '';

    // "sk1 - 1. skupina" (2026 Bakaláři format): keep the code, drop the description
    const code = String(groupName).split(' - ')[0].trim();
    const lower = code.toLowerCase();

    // Whole class – callers treat '' the same as "no group"
    if (lower.includes('celá') || lower === 'cela') {
        return '';
    }

    // Bakaláři group codes: sk1 → 1.sk, ak2 → 2.ak, tvk1 → TVk1
    const codeMatch = lower.match(/^(sk|ak|tvk)(\d+)$/);
    if (codeMatch) {
        return codeMatch[1] === 'tvk' ? `TVk${codeMatch[2]}` : `${codeMatch[2]}.${codeMatch[1]}`;
    }

    // Numbered groups: "1. sk", "1.sk", "skupina 1", "sk 2", "2.skupina"
    const groupMatch = lower.match(/^(\d+)[\.\s]*(?:skupina|sk)?$|^(?:skupina|sk)[\.\s]*(\d+)$/);
    if (groupMatch) {
        return `${groupMatch[1] || groupMatch[2]}.sk`;
    }

    // Anything else (TVk1, TVDi, xtvd, sem, ...) is kept verbatim (without a description)
    return code;
}

/**
 * True when `groupName` matches one of the user's group filters.
 * Filters are normalized too, so preferences saved under an older spelling
 * ("1. sk", "skupina 1") keep matching. Empty filters or "all" match everything;
 * whole-class lessons always match.
 * @param {String|null} groupName
 * @param {Array<String>} groupFilters
 */
function matchesGroupFilters(groupName, groupFilters) {
    if (!groupFilters || groupFilters.length === 0 || groupFilters.includes('all')) return true;
    const standardized = standardizeGroupName(groupName);
    if (standardized === '') return true;
    return groupFilters.some(filter => standardizeGroupName(filter) === standardized);
}

/**
 * Abbreviate a teacher name to "R. Příkladovič" from either
 * "Příkladovič Radim" (Bakaláři order) or "Radim Příkladovič".
 * @param {String} fullName
 * @returns {String}
 */
function abbreviateTeacherName(fullName) {
    if (!fullName) return '';

    const TITLE_PREFIX = /^(?:Mgr\.|Ing\.|Bc\.|Dr\.|Ph\.D\.|RNDr\.|PaedDr\.|MBA)\s+/i;
    let cleaned = fullName;
    let prev = '';
    while (prev !== cleaned) {
        prev = cleaned;
        cleaned = cleaned.replace(TITLE_PREFIX, '');
    }
    cleaned = cleaned.replace(/,?\s*(?:Ph\.D\.|CSc\.|MBA)$/i, '').trim();

    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();

    const surnameSuffixes = ['ová', 'ný', 'ná', 'ský', 'ská', 'ík', 'ek', 'ák', 'vič', 'ovič'];
    const isReversed = surnameSuffixes.some(suffix => parts[0].toLowerCase().endsWith(suffix));

    const firstName = isReversed ? parts[parts.length - 1] : parts[0];
    const lastName = isReversed ? parts[0] : parts[parts.length - 1];

    return `${firstName[0]}. ${lastName}`;
}

/**
 * Parse one `.day-item-hover` data-detail payload into a lesson object.
 * Returns null when the payload is not valid JSON.
 */
function parseLessonDetail(detailRaw, dayIndex, dayName, hour, date = null) {
    let data;
    try {
        data = JSON.parse(detailRaw);
    } catch {
        return null;
    }

    let subject = '';
    let teacher = data.teacher || '';
    let changeInfo = data.changeinfo
        ? { raw: data.changeinfo, description: data.changeinfo }
        : null;

    if (data.type === 'removed' && data.removedinfo) {
        // "Vyjmuto z rozvrhu (PŘEDMĚT, UČITEL)" / "Zrušeno (PŘEDMĚT, UČITEL)"
        const match = data.removedinfo.match(/\(([^,]+),\s*([^)]+)\)/);
        if (match) {
            subject = match[1].trim();
            teacher = abbreviateTeacherName(match[2].trim());
        } else {
            subject = data.subjecttext ? data.subjecttext.split('|')[0].trim() : '';
        }
        changeInfo = { raw: data.removedinfo, description: data.removedinfo };
    } else if (data.type === 'absent' && data.InfoAbsentName) {
        subject = data.InfoAbsentName.charAt(0).toUpperCase() + data.InfoAbsentName.slice(1);
        changeInfo = {
            raw: data.absentinfo || 'Absence',
            description: data.absentinfo ? `${data.InfoAbsentName} (${data.absentinfo})` : data.InfoAbsentName,
        };
    } else {
        subject = data.subjecttext ? data.subjecttext.split('|')[0].trim() : '';
    }

    return {
        day: dayIndex,
        dayName,
        // Calendar date of the lesson. Without it two different weeks look the
        // same to the change detector (false "changes" every Monday).
        date: date || null,
        hour,
        subject: subject || '',
        teacher: teacher || '',
        room: data.room || null,
        group: data.group || null,
        theme: data.theme || null,
        type: data.type || 'normal',
        changed: !!changeInfo,
        changeInfo: changeInfo || null,
    };
}

/**
 * Normalize a Bakaláři group reference to the app's canonical form.
 *   class pages:   "sk1 - 1. skupina" → "1.sk", "tvk1 - …" → "TVk1", "" → null
 *   teacher/room:  "2.A sk1 - 1. skupina" → "2.A 1.sk", "2.D celá - celá třída" / "2.D" → "2.D celá"
 * @param {String|null} groupsNames - Atom.GroupsNames ("sk1", "2.A sk1", "2.D")
 * @param {String|null} tooltipGroup - TooltipDetails.group (fallback)
 * @returns {String|null}
 */
function normalizeGroup(groupsNames, tooltipGroup) {
    const raw = String(groupsNames || tooltipGroup || '').split(' - ')[0].trim();
    if (!raw) return null;

    const parts = raw.split(/\s+/);
    const classMatch = parts[0].match(/^\d+\.[A-Za-z]+$/);
    const className = classMatch ? parts[0] : null;
    const code = (className ? parts.slice(1).join(' ') : raw).trim();
    const normalized = code ? (standardizeGroupName(code) || 'celá') : 'celá';

    if (className) return `${className} ${normalized}`;
    return normalized === 'celá' ? null : normalized;
}

/**
 * Extract the JSON object assigned to `const timetableData = {...}` in the
 * page's inline script (Bakaláři timetable since 2026-08). Returns null when
 * the marker is missing.
 */
function extractEmbeddedTimetableData(html) {
    const marker = 'const timetableData = ';
    const start = String(html).indexOf(marker);
    if (start < 0) return null;

    let i = start + marker.length;
    let depth = 0;
    let inString = false;
    let escaped = false;
    const from = i;
    for (; i < html.length; i++) {
        const c = html[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') inString = false;
        } else if (c === '"') {
            inString = true;
        } else if (c === '{') {
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(html.slice(from, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

/** "7:10" / "07:10:00" → minutes since midnight */
function toMinutes(time) {
    const m = String(time || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Date.UTC(...) → 'YYYY-MM-DD' (calendar arithmetic only, no time zone involved). */
function utcToIso(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 'YYYY-MM-DD' → ms of its UTC midnight, or null for anything else. */
function isoToUtc(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return utcToIso(ms) === iso ? ms : null;
}

/**
 * Turn Bakaláři's "D.M." day label (`Days[].Date`, e.g. "7.9." — the page has
 * no year) into 'YYYY-MM-DD'. The year is the one of Y−1, Y, Y+1 (Y = year of
 * `now`, i.e. when the page was downloaded) that puts the date closest to
 * `now`, so the week across New Year resolves correctly ("4.1." fetched on
 * 30.12.2026 → 2027-01-04). An explicit year ("7.9.2026") is used as is.
 * @param {String} label
 * @param {Date} [now] - injectable for tests
 * @returns {String|null}
 */
function inferIsoDate(label, now = new Date()) {
    const m = String(label || '').trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{4})?$/);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const valid = (y) => {
        const ms = Date.UTC(y, month - 1, day);
        const d = new Date(ms);
        return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? ms : null; // rejects 31.4., 29.2.2027
    };
    if (m[3]) {
        const ms = valid(Number(m[3]));
        return ms == null ? null : utcToIso(ms);
    }

    const ref = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const year = ref.getUTCFullYear();
    let best = null;
    for (const y of [year - 1, year, year + 1]) {
        const ms = valid(y);
        if (ms == null) continue;
        if (best == null || Math.abs(ms - ref.getTime()) < Math.abs(best - ref.getTime())) best = ms;
    }
    return best == null ? null : utcToIso(best);
}

/** Monday of the ISO week containing `iso` ('YYYY-MM-DD'), or null. */
function mondayOf(iso) {
    const ms = isoToUtc(iso);
    if (ms == null) return null;
    const weekday = (new Date(ms).getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    return utcToIso(ms - weekday * 86400000);
}

/** `iso` + `days` calendar days ('YYYY-MM-DD'), or null. */
function addDaysIso(iso, days) {
    const ms = isoToUtc(iso);
    return ms == null ? null : utcToIso(ms + days * 86400000);
}

/**
 * Parse the embedded timetable model (Days → Hours → Atoms).
 * The hour number comes from the raster (`Hours[].Caption` matched by begin
 * time); an hour or atom whose time is not in the raster is skipped.
 * @returns {{ lessons: Array, weekStart: String|null, allDaysOff: Boolean,
 *            daysOff: Array<{day: Number, date: String|null, name: String}>, hours: Array<Number> }}
 */
function parseEmbeddedTimetable(data, { now } = {}) {
    const hourByStart = new Map();
    for (const h of data.Hours || []) {
        const mins = toMinutes(h.BeginTime);
        if (mins != null && /^\d+$/.test(String(h.Caption))) hourByStart.set(mins, Number(h.Caption));
    }

    const days = Array.isArray(data.Days) ? data.Days : [];
    const lessons = [];
    const daysOff = [];
    let weekStart = null;
    days.forEach((day, position) => {
        const date = inferIsoDate(day.Date, now);
        // Day-off days still carry a date, so a week that is entirely off gets a weekStart too.
        if (!weekStart && date) weekStart = mondayOf(date);
        const dayName = String(day.DayAbbrev || '').trim();
        const byName = DAY_NAMES.indexOf(dayName.toLowerCase());
        const dayIndex = byName >= 0 ? byName : position;
        if (day.DayOff) {
            // Kept so later steps know the day is a holiday, not a day whose
            // lessons all disappeared (see addRemovedLessonsFromPermanent).
            daysOff.push({ day: dayIndex, date: date || null, name: String(day.DayOffName || '').trim() });
            return;
        }

        for (const slot of day.Hours || []) {
            const hour = hourByStart.get(toMinutes(slot.Begin));
            if (hour === undefined) continue;

            const atoms = slot.Atoms && slot.Atoms.length ? slot.Atoms : (slot.TooltipDetails ? [slot] : []);
            for (const atom of atoms) {
                if (!atom.TooltipDetails) continue;
                const lesson = parseLessonDetail(atom.TooltipDetails, dayIndex, dayName, hour, date);
                if (!lesson) continue;
                let detail = {};
                try { detail = JSON.parse(atom.TooltipDetails); } catch { /* handled above */ }
                lesson.room = atom.Room || (lesson.room ? String(lesson.room).split(' - ')[0].trim() : null) || null;
                lesson.group = normalizeGroup(atom.GroupsNames, detail.group);
                if (!lesson.teacher && atom.TeacherFullname) lesson.teacher = atom.TeacherFullname;
                lessons.push(lesson);
            }
        }
    });

    return {
        lessons,
        weekStart,
        // "Nothing to show because the whole week is off" (holidays) is a legitimate
        // empty timetable; an empty Days list is not (prefetch keeps the old snapshot then).
        allDaysOff: days.length > 0 && days.every(day => !!day.DayOff),
        daysOff,
        hours: [...new Set(hourByStart.values())].sort((a, b) => a - b),
    };
}

/**
 * Parse a Bakaláři public timetable page with everything prefetch needs.
 * @param {String} html - Response body of /Timetable/Public/{schedule}/{type}/{id}
 * @param {{ now?: Date }} [options] - `now` = download time, used to infer the year of "D.M." dates
 * @returns {{ lessons: Array, weekStart: String|null, allDaysOff: Boolean, daysOff: Array, hours: Array<Number>, format: 'embedded'|'legacy' }}
 */
function parseTimetablePage(html, options = {}) {
    const embedded = extractEmbeddedTimetableData(html);
    if (embedded) return { ...parseEmbeddedTimetable(embedded, options), format: 'embedded' };
    // The pre-2026 markup has no dates in its cells, so its week is unknown (null):
    // the change detector then does not compare it rather than guess.
    return { lessons: parseLegacyTimetableHtml(html), weekStart: null, allDaysOff: false, daysOff: [], hours: [], format: 'legacy' };
}

/**
 * Parse a Bakaláři public timetable HTML page into a flat list of lessons.
 * Supports the current page (data embedded as `const timetableData = {...}`)
 * and the pre-2026 server-rendered markup (`.day-item-hover[data-detail]`).
 * @param {String} html - Response body of /Timetable/Public/{schedule}/{type}/{id}
 * @param {{ now?: Date }} [options]
 * @returns {Array<Object>}
 */
function parseTimetableHtml(html, options = {}) {
    return parseTimetablePage(html, options).lessons;
}

/** Pre-2026 markup: one .bk-timetable-cell per hour, lessons in data-detail. */
function parseLegacyTimetableHtml(html) {
    const $ = cheerio.load(html);
    const lessons = [];

    $('.bk-timetable-row').each((_, row) => {
        const dayName = $(row).find('.bk-day-day').text().trim();
        const dayIndex = DAY_NAMES.indexOf(dayName.toLowerCase());

        $(row).find('.bk-timetable-cell').each((hour, cell) => {
            $(cell).find('.day-item-hover').each((__, item) => {
                const detailRaw = $(item).attr('data-detail');
                if (!detailRaw) return;
                const lesson = parseLessonDetail(detailRaw, dayIndex, dayName, hour);
                if (lesson) lessons.push(lesson);
            });
        });
    });

    return lessons;
}

/**
 * Day indexes (0-4) of the days off of a page: accepts the `daysOff` objects of
 * parseTimetablePage() or plain numbers.
 */
function dayOffIndexes(daysOff) {
    const set = new Set();
    for (const entry of Array.isArray(daysOff) ? daysOff : []) {
        const day = typeof entry === 'number' ? entry : entry && entry.day;
        if (Number.isInteger(day)) set.add(day);
    }
    return set;
}

/**
 * Add lessons that exist in the permanent schedule but are missing from the
 * actual one as type="removed", so cancelled group lessons still render
 * (struck through). Existing "removed" entries in `actualLessons` are rebuilt.
 * Days off (holidays, "ředitelské volno") are skipped: their lessons are not
 * cancelled one by one, the whole day is free. Copying them used to put a
 * struck-through "Hodina odpadla" into every hour of a holiday and send a
 * "lesson cancelled" notification and a changes-board row for each of them.
 * @param {Array} actualLessons
 * @param {Array} permanentLessons
 * @param {{ weekStart?: String|null, daysOff?: Array }} [options] - week of `actualLessons`; the copied
 *        lessons get the date of their day in that week (the permanent ones have none).
 *        `daysOff` = parseTimetablePage().daysOff of the same week.
 * @returns {Array}
 */
function addRemovedLessonsFromPermanent(actualLessons, permanentLessons, { weekStart = null, daysOff = [] } = {}) {
    if (!permanentLessons || permanentLessons.length === 0) {
        return actualLessons;
    }
    const offDays = dayOffIndexes(daysOff);

    const keyOf = (lesson) => [
        lesson.day,
        lesson.hour,
        (lesson.subject || '').trim().toLowerCase(),
        (lesson.teacher || '').trim().toLowerCase(),
        standardizeGroupName(lesson.group || ''),
    ].join('-');

    const actualNonRemoved = actualLessons.filter(lesson => lesson.type !== 'removed');
    const actualKeys = new Set(actualNonRemoved.map(keyOf));

    const removedLessons = permanentLessons
        .filter(permLesson => permLesson.type !== 'removed' && !offDays.has(permLesson.day) && !actualKeys.has(keyOf(permLesson)))
        .map(permLesson => ({
            ...permLesson,
            date: weekStart && Number.isInteger(permLesson.day) && permLesson.day >= 0
                ? addDaysIso(weekStart, permLesson.day)
                : null,
            type: 'removed',
            changed: true,
            changeInfo: { raw: 'Hodina odpadla', description: 'Hodina odpadla' },
        }));

    if (removedLessons.length > 0) {
        console.log(`   📍 Added ${removedLessons.length} removed lessons from permanent schedule`);
    }

    return [...actualNonRemoved, ...removedLessons];
}

module.exports = {
    standardizeGroupName,
    normalizeGroup,
    matchesGroupFilters,
    abbreviateTeacherName,
    parseTimetableHtml,
    parseTimetablePage,
    addRemovedLessonsFromPermanent,
    dayOffIndexes,
    inferIsoDate,
    mondayOf,
    addDaysIso,
};
