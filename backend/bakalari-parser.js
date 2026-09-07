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
 * Abbreviate a teacher name to "R. Kozakovič" from either
 * "Kozakovič Radko" (Bakaláři order) or "Radko Kozakovič".
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
function parseLessonDetail(detailRaw, dayIndex, dayName, hour) {
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

/**
 * Parse the embedded timetable model (Days → Hours → Atoms) into lessons.
 * The hour number comes from the raster (`Hours[].Caption` matched by begin
 * time); an hour or atom whose time is not in the raster is skipped.
 */
function parseEmbeddedTimetable(data) {
    const hourByStart = new Map();
    for (const h of data.Hours || []) {
        const mins = toMinutes(h.BeginTime);
        if (mins != null && /^\d+$/.test(String(h.Caption))) hourByStart.set(mins, Number(h.Caption));
    }

    const lessons = [];
    (data.Days || []).forEach((day, position) => {
        if (day.DayOff) return;
        const dayName = String(day.DayAbbrev || '').trim();
        const byName = DAY_NAMES.indexOf(dayName.toLowerCase());
        const dayIndex = byName >= 0 ? byName : position;

        for (const slot of day.Hours || []) {
            const hour = hourByStart.get(toMinutes(slot.Begin));
            if (hour === undefined) continue;

            const atoms = slot.Atoms && slot.Atoms.length ? slot.Atoms : (slot.TooltipDetails ? [slot] : []);
            for (const atom of atoms) {
                if (!atom.TooltipDetails) continue;
                const lesson = parseLessonDetail(atom.TooltipDetails, dayIndex, dayName, hour);
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
    return lessons;
}

/**
 * Parse a Bakaláři public timetable HTML page into a flat list of lessons.
 * Supports the current page (data embedded as `const timetableData = {...}`)
 * and the pre-2026 server-rendered markup (`.day-item-hover[data-detail]`).
 * @param {String} html - Response body of /Timetable/Public/{schedule}/{type}/{id}
 * @returns {Array<Object>}
 */
function parseTimetableHtml(html) {
    const embedded = extractEmbeddedTimetableData(html);
    if (embedded) return parseEmbeddedTimetable(embedded);
    return parseLegacyTimetableHtml(html);
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
 * Add lessons that exist in the permanent schedule but are missing from the
 * actual one as type="removed", so cancelled group lessons still render
 * (struck through). Existing "removed" entries in `actualLessons` are rebuilt.
 * @param {Array} actualLessons
 * @param {Array} permanentLessons
 * @returns {Array}
 */
function addRemovedLessonsFromPermanent(actualLessons, permanentLessons) {
    if (!permanentLessons || permanentLessons.length === 0) {
        return actualLessons;
    }

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
        .filter(permLesson => permLesson.type !== 'removed' && !actualKeys.has(keyOf(permLesson)))
        .map(permLesson => ({
            ...permLesson,
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
    addRemovedLessonsFromPermanent,
};
