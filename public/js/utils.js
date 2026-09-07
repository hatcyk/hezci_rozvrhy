import { subjectAbbreviations, lessonTimes } from './constants.js';

// Function to abbreviate subject names
export function abbreviateSubject(subjectName) {
    if (!subjectName) return '';

    // Check if there's a direct mapping
    if (subjectAbbreviations[subjectName]) {
        return subjectAbbreviations[subjectName];
    }

    // If subject name is longer than 20 characters, try to shorten it
    if (subjectName.length > 20) {
        // Try to extract acronym from capital letters
        const capitals = subjectName.match(/[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g);
        if (capitals && capitals.length > 1) {
            return capitals.join('');
        }
        // Otherwise truncate with ellipsis
        return subjectName.substring(0, 18) + '...';
    }

    return subjectName;
}

// Function to standardize group names
export function standardizeGroupName(groupName) {
    if (!groupName) return '';

    // Convert to lowercase for easier matching
    const lower = groupName.toLowerCase().trim();

    // If it contains "celá", skip (we don't include in groups list)
    if (lower.includes('celá') || lower === 'cela') {
        return ''; // Empty string means skip
    }

    // Special groups (TV, etc.) - keep as-is
    // These start with letters followed by optional digits (TVk1, TVDi, TVCh, etc.)
    // Don't convert these to "1.sk" format
    if (/^[a-záčďéěíňóřšťúůýž]{2,}/i.test(lower)) {
        return groupName; // Return original (preserve case)
    }

    // Match patterns like "1. skupina", "1.skupina", "1 skupina", "skupina 1", etc.
    // IMPORTANT: Use ^ and $ to match whole string, not just part of it
    const groupMatch = lower.match(/^(\d+)[\.\s]*(?:skupina|sk)?$|^(?:skupina|sk)[\.\s]*(\d+)$/);
    if (groupMatch) {
        const groupNum = groupMatch[1] || groupMatch[2];
        return `${groupNum}.sk`;
    }

    // If the group name already contains ".sk", extract just the number part
    if (lower.includes('.sk')) {
        const numMatch = lower.match(/^(\d+)\.sk$/);
        if (numMatch) {
            return `${numMatch[1]}.sk`;
        }
    }

    // Return as-is if no pattern matches
    return groupName;
}

// Function to abbreviate teacher names to initials
// Helper: Remove titles from teacher name
function removeTeacherTitles(fullName) {
    if (!fullName) return '';

    // Remove titles from the beginning (handles multiple titles with spaces)
    // Example: "Ing. Bc. Jan Tesař" → "Jan Tesař"
    let cleaned = fullName.replace(/^(?:Mgr\.|Ing\.|Bc\.|Dr\.|Ph\.D\.|RNDr\.|PaedDr\.|MBA)\s+/gi, '');

    // Keep removing titles until no more are found at the start
    let prevCleaned = '';
    while (prevCleaned !== cleaned) {
        prevCleaned = cleaned;
        cleaned = cleaned.replace(/^(?:Mgr\.|Ing\.|Bc\.|Dr\.|Ph\.D\.|RNDr\.|PaedDr\.|MBA)\s+/gi, '');
    }

    // Remove titles from the end (after comma or space)
    cleaned = cleaned.replace(/,?\s*(?:Ph\.D\.|CSc\.|MBA)$/gi, '');

    return cleaned.trim();
}

// Detect if name is in reversed format (Surname First)
function isReversedName(firstPart, lastPart) {
    // Check if first part ends with common surname suffixes (mainly Czech)
    const surnameSuffixes = ['ová', 'ný', 'ná', 'ský', 'ská', 'ík', 'ek', 'ák'];
    const firstLower = firstPart.toLowerCase();

    for (const suffix of surnameSuffixes) {
        if (firstLower.endsWith(suffix)) {
            return true;
        }
    }

    return false;
}

// Create abbreviation with first initial and full surname
function createTeacherAbbreviation(firstName, lastName) {
    return `${firstName[0]}. ${lastName}`;
}

// Build abbreviation map with full surnames
export function buildTeacherAbbreviationMap(teachers) {
    const abbreviationMap = new Map(); // Map: fullName -> abbreviation

    if (!teachers || teachers.length === 0) return abbreviationMap;

    // Create abbreviation for each teacher: First initial + full surname
    for (const teacher of teachers) {
        const name = removeTeacherTitles(teacher.name);
        const parts = name.split(/\s+/).filter(p => p.length > 0);

        if (parts.length < 2) {
            // Single name: use first 2 chars
            abbreviationMap.set(teacher.name, parts[0].substring(0, 2).toUpperCase());
            continue;
        }

        let firstName, lastName;

        // Detect reversed format: "Rollová Jitka" vs "Jitka Rollová"
        if (isReversedName(parts[0], parts[parts.length - 1])) {
            // Reversed: "Surname FirstName" → swap them
            lastName = parts[0];
            firstName = parts[parts.length - 1];
        } else {
            // Normal: "FirstName Surname"
            firstName = parts[0];
            lastName = parts[parts.length - 1];
        }

        // Format: "J. Melena", "J. Melzoch"
        abbreviationMap.set(teacher.name, createTeacherAbbreviation(firstName, lastName));
    }

    return abbreviationMap;
}

export function abbreviateTeacherName(fullName, abbreviationMap = null) {
    if (!fullName) return '';

    // If map is provided and has the name, use it
    if (abbreviationMap && abbreviationMap.has(fullName)) {
        return abbreviationMap.get(fullName);
    }

    // Fallback to simple logic if no map available
    const withoutTitles = removeTeacherTitles(fullName);
    const parts = withoutTitles.split(/\s+/).filter(p => p.length > 0);

    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();

    let firstName, lastName;

    // Detect reversed format
    if (isReversedName(parts[0], parts[parts.length - 1])) {
        lastName = parts[0];
        firstName = parts[parts.length - 1];
    } else {
        firstName = parts[0];
        lastName = parts[parts.length - 1];
    }

    // Default: First initial + period + full surname
    return createTeacherAbbreviation(firstName, lastName);
}

// Utility funkce pro získání dnešního dne (0-4 = Po-Pá)
export function getTodayIndex(now = new Date()) {
    const day = now.getDay(); // 0=Neděle, 1=Po, ..., 5=Pá
    return day === 0 || day === 6 ? -1 : day - 1; // Vrátí -1 pro víkend
}

// Check if we should auto-switch to next week (Friday afternoon + weekend)
export function shouldAutoSwitchToNextWeek() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday, ..., 5=Friday, 6=Saturday
    const hour = now.getHours();

    // Auto-switch conditions:
    // 1. Friday after 14:00 (2 PM)
    // 2. Saturday (entire day)
    // 3. Sunday (entire day)
    const shouldSwitch = (dayOfWeek === 5 && hour >= 14) || dayOfWeek === 0 || dayOfWeek === 6;

    if (shouldSwitch) {
        const days = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
        console.log(`Auto-switching to next week: ${days[dayOfWeek]}, ${hour}:${now.getMinutes().toString().padStart(2, '0')}`);
    }

    return shouldSwitch;
}

// Utility funkce pro získání aktuální hodiny (0-12)
export function getCurrentHour(now = new Date()) {
    const hour = now.getHours();
    const minute = now.getMinutes();

    for (const lesson of lessonTimes) {
        const [startH, startM] = lesson.start;
        const [endH, endM] = lesson.end;
        if ((hour > startH || (hour === startH && minute >= startM)) &&
            (hour < endH || (hour === endH && minute <= endM))) {
            return lesson.hour;
        }
    }
    return -1; // Mimo vyučování
}

// Utility funkce pro získání nadcházející hodiny (následující hodina po aktuální nebo první hodina dne)
export function getUpcomingHour(now = new Date()) {
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentHour = getCurrentHour(now);

    // Pokud právě probíhá hodina, najdeme následující
    if (currentHour !== -1) {
        // Najdeme následující hodinu v lessonTimes
        for (const lesson of lessonTimes) {
            if (lesson.hour > currentHour) {
                return lesson.hour;
            }
        }
        return -1; // Žádná další hodina (konec vyučování)
    }

    // Pokud je mimo hodiny (přestávka nebo ráno), najdeme první budoucí hodinu
    for (const lesson of lessonTimes) {
        const [startH, startM] = lesson.start;
        // Pokud je čas před začátkem této hodiny
        if (hour < startH || (hour === startH && minute < startM)) {
            return lesson.hour;
        }
    }

    return -1; // Žádná nadcházející hodina (konec vyučování nebo večer)
}

// Utility funkce pro zjištění, zda hodina už proběhla
export function isPastLesson(dayIndex, hour, now = new Date()) {
    const todayIndex = getTodayIndex(now);

    // Pokud je víkend (todayIndex = -1), žádná hodina není proběhlá
    if (todayIndex === -1) return false;

    // Pokud je den v minulosti (pondělí když je úterý), hodina proběhla
    if (dayIndex < todayIndex) return true;

    // Pokud je den v budoucnosti (čtvrtek když je úterý), hodina neproběhla
    if (dayIndex > todayIndex) return false;

    // Pro dnešek kontrolujeme čas hodiny
    const lessonInfo = lessonTimes.find(l => l.hour === hour);
    if (!lessonInfo) return false;

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const [endH, endM] = lessonInfo.end;

    // Pokud je aktuální čas po konci hodiny, hodina proběhla
    return (currentHour > endH) || (currentHour === endH && currentMinute > endM);
}

/**
 * CSS classes for each time status, per layout variant. The variant is stored
 * on the element as data-time-status so lesson-status.js can update it later.
 */
export const TIME_STATUS_CLASSES = {
    '': { current: 'current-time', upcoming: 'upcoming', past: 'past' },
    agenda: { current: 'agenda-current', upcoming: 'agenda-upcoming', past: 'agenda-past' },
};

/**
 * Time status of a slot: 'current' | 'upcoming' | 'past' | ''.
 * Callers decide whether a slot tracks time at all (only the actual week,
 * never removed/absent lessons).
 */
export function getLessonTimeStatus(dayIndex, hour, now = new Date()) {
    const todayIndex = getTodayIndex(now);
    if (dayIndex === todayIndex) {
        if (hour === getCurrentHour(now)) return 'current';
        if (hour === getUpcomingHour(now)) return 'upcoming';
    }
    return isPastLesson(dayIndex, hour, now) ? 'past' : '';
}

/** CSS class for the slot's current time status ('' when none). */
export function getLessonTimeClass(dayIndex, hour, now = new Date(), variant = '') {
    const status = getLessonTimeStatus(dayIndex, hour, now);
    return status ? TIME_STATUS_CLASSES[variant][status] : '';
}

// Parse group name to extract class and group number
export function parseGroupName(groupName) {
    if (!groupName) return null;

    // Match pattern: "CLASS_ID GROUP_NAME" (e.g., "4.D 1.sk", "2.A celá")
    const match = groupName.match(/^([^\s]+)\s+(.+)$/);
    if (match) {
        return {
            classId: match[1],
            groupName: match[2]
        };
    }
    return null;
}

// Get Monday of a given week offset (0 = this week, -1 = last week, +1 = next week)
export function getMondayOfWeek(offset = 0) {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    const daysFromMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Calculate offset to Monday

    const monday = new Date(now);
    monday.setDate(now.getDate() + daysFromMonday + (offset * 7));
    monday.setHours(0, 0, 0, 0);

    return monday;
}

// SVG ikony z Lucide pro různé typy změn
export function getChangeIcon(changeType) {
    const icons = {
        'Suplování': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,

        'Zrušeno': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,

        'Vyjmuto': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>`,

        'Přednáška': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,

        'Spojení': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/></svg>`,

        'Default': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`
    };

    return icons[changeType] || icons['Default'];
}

// Určit typ změny a CSS třídu
export function getChangeTypeInfo(changeType, changeInfoRaw) {
    if (!changeType && !changeInfoRaw) {
        return { type: 'obecna', icon: 'Default', header: 'Změna v rozvrhu' };
    }

    const type = (changeType || '').toLowerCase();
    const rawLower = (changeInfoRaw || '').toLowerCase();

    if (type.includes('suplování') || rawLower.includes('suplování')) {
        return { type: 'suplovani', icon: 'Suplování', header: 'Suplování hodiny' };
    } else if (type.includes('zrušeno') || rawLower.includes('zrušeno')) {
        return { type: 'zruseno', icon: 'Zrušeno', header: 'Hodina byla zrušena' };
    } else if (type.includes('vyjmuto') || rawLower.includes('vyjmuto')) {
        return { type: 'vyjmuto', icon: 'Vyjmuto', header: 'Hodina byla vyjmuta z rozvrhu' };
    } else if (type.includes('přednáška') || rawLower.includes('přednáška')) {
        return { type: 'prednaska', icon: 'Přednáška', header: 'Přednáška' };
    } else if (type.includes('spojen') || rawLower.includes('spojen')) {
        return { type: 'spojeni', icon: 'Spojení', header: 'Spojení hodin' };
    } else {
        return { type: 'obecna', icon: 'Default', header: 'Změna v rozvrhu' };
    }
}

// Parse change info to make it more understandable
// Examples:
// - "Suplování: CJL, Lichtágová Denisa (ZP, VT)"
// - "Zrušeno - Nemoc učitele"
// - "Vyjmuto"
export function parseChangeInfo(changeInfoRaw) {
    if (!changeInfoRaw) return null;

    const result = {
        type: null,
        newSubject: null,
        newTeacher: null,
        originalInfo: null,
        reason: null,
        formatted: changeInfoRaw
    };

    // Check for removed/vyjmuto patterns with subject and teacher: "Vyjmuto z rozvrhu (PŘEDMĚT, UČITEL)"
    const removedMatch = changeInfoRaw.match(/^(Vyjmuto z rozvrhu|Zrušeno)\s*\(([^,]+),\s*([^)]+)\)/i);
    if (removedMatch) {
        result.type = removedMatch[1].trim();  // "Vyjmuto z rozvrhu" nebo "Zrušeno"
        const subject = removedMatch[2].trim();
        const teacher = removedMatch[3].trim();

        const lines = [];
        lines.push(`<div class="change-detail"><span class="change-label">Předmět:</span> <span class="change-value">${subject}</span></div>`);
        lines.push(`<div class="change-detail"><span class="change-label">Učitel:</span> <span class="change-value">${teacher}</span></div>`);

        result.formatted = lines.join('');
        return result;
    }

    // Check for absent patterns: "přednáška (PŘED)" or just the name
    const absentMatch = changeInfoRaw.match(/^([^(]+)\s*\(([^)]+)\)$/);
    if (absentMatch) {
        const reason = absentMatch[1].trim();
        const code = absentMatch[2].trim();

        // Only handle if it looks like an absence reason
        if (reason.toLowerCase().includes('přednáška') || reason.toLowerCase().includes('absence') ||
            code.match(/^[A-Z]{2,5}$/)) {  // Code like "PŘED", "ABS", etc.
            const lines = [];
            lines.push(`<div class="change-detail"><span class="change-value">${reason}</span></div>`);
            if (code && code !== reason) {
                lines.push(`<div class="change-detail"><span class="change-label">Kód:</span> <span class="change-value">${code}</span></div>`);
            }

            result.formatted = lines.join('');
            return result;
        }
    }

    // Check for cancellation/removal patterns: "Zrušeno - Důvod" or "Vyjmuto - Důvod"
    const cancelMatch = changeInfoRaw.match(/^(Zrušeno|Vyjmuto)(?:\s*-\s*(.+))?$/i);
    if (cancelMatch) {
        result.type = cancelMatch[1].trim();
        result.reason = cancelMatch[2] ? cancelMatch[2].trim() : null;

        const lines = [];

        if (result.reason) {
            lines.push(`<div class="change-detail"><span class="change-label">Důvod:</span> <span class="change-value">${result.reason}</span></div>`);
        }

        result.formatted = lines.join('');
        return result;
    }

    // Match pattern for substitution: "Type: Subject, Teacher (Original)"
    const match = changeInfoRaw.match(/^([^:]+):\s*([^,]+),\s*([^(]+)\s*\(([^)]+)\)/);

    if (match) {
        result.type = match[1].trim(); // "Suplování"
        result.newSubject = match[2].trim(); // "CJL"
        result.newTeacher = match[3].trim(); // "Lichtágová Denisa"
        result.originalInfo = match[4].trim(); // "ZP, VT"

        // Format nicely
        const lines = [];

        if (result.type === 'Suplování') {
            lines.push(`<div class="change-detail"><span class="change-label">Nahrazující předmět:</span> <span class="change-value">${result.newSubject}</span></div>`);
            lines.push(`<div class="change-detail"><span class="change-label">Suplující učitel:</span> <span class="change-value">${result.newTeacher}</span></div>`);

            // Original info could be "subject, teacher" or just "subject"
            const origParts = result.originalInfo.split(',').map(p => p.trim());
            if (origParts.length === 2) {
                lines.push(`<div class="change-detail"><span class="change-label">Původně:</span> <span class="change-value">${origParts[0]} (${origParts[1]})</span></div>`);
            } else {
                lines.push(`<div class="change-detail"><span class="change-label">Původně:</span> <span class="change-value">${result.originalInfo}</span></div>`);
            }
        } else {
            lines.push(`<div class="change-detail"><span class="change-label">Nové:</span> <span class="change-value">${result.newSubject} - ${result.newTeacher}</span></div>`);
            lines.push(`<div class="change-detail"><span class="change-label">Původně:</span> <span class="change-value">${result.originalInfo}</span></div>`);
        }

        result.formatted = lines.join('');
    } else {
        // Check if it's just a date (DD.MM.YYYY or similar)
        const dateMatch = changeInfoRaw.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/);
        if (dateMatch) {
            // Don't show just a date, show it as "Změněno"
            result.formatted = `<div class="change-detail"><span class="change-value">Změněno (${changeInfoRaw})</span></div>`;
        } else {
            // Fallback for other formats
            result.formatted = `<div class="change-detail"><span class="change-value">${changeInfoRaw}</span></div>`;
        }
    }

    return result;
}
