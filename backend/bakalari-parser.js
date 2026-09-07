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

    const lower = String(groupName).toLowerCase().trim();

    // Whole class – callers treat '' the same as "no group"
    if (lower.includes('celá') || lower === 'cela') {
        return '';
    }

    // Numbered groups: "1. sk", "1.sk", "skupina 1", "sk 2", "2.skupina"
    const groupMatch = lower.match(/^(\d+)[\.\s]*(?:skupina|sk)?$|^(?:skupina|sk)[\.\s]*(\d+)$/);
    if (groupMatch) {
        return `${groupMatch[1] || groupMatch[2]}.sk`;
    }

    // Anything else (TVk1, TVDi, TVCh, ...) is kept verbatim
    return groupName;
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
 * Parse a Bakaláři public timetable HTML page into a flat list of lessons.
 * @param {String} html - Response body of /Timetable/Public/{schedule}/{type}/{id}
 * @returns {Array<Object>}
 */
function parseTimetableHtml(html) {
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
    matchesGroupFilters,
    abbreviateTeacherName,
    parseTimetableHtml,
    addRemovedLessonsFromPermanent,
};
