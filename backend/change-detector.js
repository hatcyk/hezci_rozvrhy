/**
 * Change Detector Module
 * Compares timetable snapshots and detects changes for notifications
 */

/**
 * Create a unique key for a lesson
 * Used to match lessons between old and new snapshots
 * Includes group to properly detect changes for group-specific lessons
 */
function createLessonKey(lesson) {
    // Include group in key to distinguish between group-specific lessons
    // If no group, use empty string to ensure uniqueness
    const group = lesson.group || '';
    return `${lesson.day}-${lesson.hour}-${lesson.subject}-${lesson.teacher}-${group}`;
}

/**
 * Compare two lesson objects and detect what changed
 */
function detectLessonChanges(oldLesson, newLesson) {
    const changes = [];

    if (oldLesson.teacher !== newLesson.teacher) {
        changes.push({
            field: 'teacher',
            oldValue: oldLesson.teacher,
            newValue: newLesson.teacher,
            type: 'substitution'
        });
    }

    if (oldLesson.room !== newLesson.room) {
        changes.push({
            field: 'room',
            oldValue: oldLesson.room,
            newValue: newLesson.room,
            type: 'room_change'
        });
    }

    if (oldLesson.subject !== newLesson.subject) {
        changes.push({
            field: 'subject',
            oldValue: oldLesson.subject,
            newValue: newLesson.subject,
            type: 'subject_change'
        });
    }

    if (oldLesson.type !== newLesson.type) {
        changes.push({
            field: 'type',
            oldValue: oldLesson.type,
            newValue: newLesson.type,
            type: 'type_change'
        });
    }

    return changes;
}

/**
 * Check if a lesson_removed change is just a revert back to the permanent schedule.
 * E.g. week had German as exception, next week Czech (permanent) is back → not a real change.
 * @param {Object} change - The detected change (must be lesson_removed)
 * @param {Array} newData - Current snapshot of lessons
 * @param {Array} permanentData - Permanent schedule lessons
 * @returns {boolean} True if this removal is just a revert to normal (should be suppressed)
 */
function isRevertToNormal(change, newData, permanentData) {
    if (!permanentData || permanentData.length === 0) return false;

    const normalize = (s) => (s || '').trim().toLowerCase();
    const slotKey = (lesson) => `${lesson.day}-${lesson.hour}-${normalize(lesson.group || '')}`;

    const slot = slotKey(change.lesson);

    // Find what permanent schedule says for this slot
    const permanentLesson = permanentData.find(p => p.type !== 'removed' && slotKey(p) === slot);
    if (!permanentLesson) return false;

    // Find what the new data has at this slot
    const newLesson = newData.find(n => n.type !== 'removed' && slotKey(n) === slot);
    if (!newLesson) return false;

    // If new state matches permanent → this is just a revert, suppress the notification
    return normalize(newLesson.subject) === normalize(permanentLesson.subject) &&
           normalize(newLesson.teacher) === normalize(permanentLesson.teacher);
}

/**
 * Compare two timetable snapshots and detect all changes
 * @param {Array} oldData - Previous snapshot of lessons
 * @param {Array} newData - Current snapshot of lessons
 * @param {Object} metadata - Timetable metadata (type, id, name)
 * @param {Array|null} permanentData - Optional permanent schedule for revert-detection
 * @returns {Array} List of detected changes
 */
function detectTimetableChanges(oldData, newData, metadata, permanentData = null) {
    const changes = [];

    // Create maps for efficient lookup
    const oldLessons = new Map();
    const newLessons = new Map();

    // Index old lessons
    oldData.forEach(lesson => {
        const key = createLessonKey(lesson);
        if (!oldLessons.has(key)) {
            oldLessons.set(key, []);
        }
        oldLessons.get(key).push(lesson);
    });

    // Index new lessons
    newData.forEach(lesson => {
        const key = createLessonKey(lesson);
        if (!newLessons.has(key)) {
            newLessons.set(key, []);
        }
        newLessons.get(key).push(lesson);
    });

    // Detect removed lessons
    oldLessons.forEach((lessons, key) => {
        if (!newLessons.has(key)) {
            lessons.forEach(lesson => {
                // Skip if lesson was already marked as removed in old data
                if (lesson.type === 'removed') return;

                changes.push({
                    type: 'lesson_removed',
                    timetable: metadata,
                    lesson: lesson,
                    day: lesson.day,
                    dayName: lesson.dayName,
                    hour: lesson.hour,
                    description: `Odpadla hodina: ${lesson.subject} (${lesson.teacher})`,
                    timestamp: new Date().toISOString()
                });
            });
        }
    });

    // Detect added lessons
    newLessons.forEach((lessons, key) => {
        if (!oldLessons.has(key)) {
            lessons.forEach(lesson => {
                // Skip if it's a removed lesson (shouldn't notify about cancellations as new)
                if (lesson.type === 'removed') return;

                changes.push({
                    type: 'lesson_added',
                    timetable: metadata,
                    lesson: lesson,
                    day: lesson.day,
                    dayName: lesson.dayName,
                    hour: lesson.hour,
                    description: `Přidána hodina: ${lesson.subject} (${lesson.teacher})`,
                    timestamp: new Date().toISOString()
                });
            });
        }
    });

    // Detect modified lessons
    oldLessons.forEach((oldLessonsList, key) => {
        if (newLessons.has(key)) {
            const newLessonsList = newLessons.get(key);

            // Compare first lessons in each group (most common case)
            if (oldLessonsList.length > 0 && newLessonsList.length > 0) {
                const oldLesson = oldLessonsList[0];
                const newLesson = newLessonsList[0];

                const lessonChanges = detectLessonChanges(oldLesson, newLesson);

                if (lessonChanges.length > 0) {
                    lessonChanges.forEach(change => {
                        let description = '';

                        if (change.type === 'substitution') {
                            description = `Suplování: ${newLesson.subject} - ${oldLesson.teacher} → ${newLesson.teacher}`;
                        } else if (change.type === 'room_change') {
                            description = `Změna místnosti: ${newLesson.subject} - ${oldLesson.room || 'žádná'} → ${newLesson.room || 'žádná'}`;
                        } else if (change.type === 'subject_change') {
                            description = `Změna předmětu: ${oldLesson.subject} → ${newLesson.subject}`;
                        } else if (change.type === 'type_change') {
                            if (newLesson.type === 'removed') {
                                description = `Odpadla hodina: ${newLesson.subject} (${newLesson.teacher})`;
                            } else if (newLesson.type === 'absent') {
                                description = `Absence: ${newLesson.subject} (${newLesson.teacher})`;
                            }
                        }

                        changes.push({
                            type: change.type,
                            timetable: metadata,
                            lesson: newLesson,
                            day: newLesson.day,
                            dayName: newLesson.dayName,
                            hour: newLesson.hour,
                            change: change,
                            description: description,
                            timestamp: new Date().toISOString()
                        });
                    });
                }
            }
        }
    });

    // Filter out changes that are just reverting back to the permanent schedule.
    // E.g. last week had German (exception), this week Czech is back (permanent) →
    // don't send "German removed" notification.
    if (permanentData && permanentData.length > 0) {
        return changes.filter(change => {
            if (change.type === 'lesson_removed') {
                return !isRevertToNormal(change, newData, permanentData);
            }
            return true;
        });
    }

    return changes;
}

/**
 * Group changes by timetable for efficient notification batching
 * @param {Array} changes - List of all detected changes
 * @returns {Map} Changes grouped by timetable key
 */
function groupChangesByTimetable(changes) {
    const grouped = new Map();

    changes.forEach(change => {
        const key = `${change.timetable.type}_${change.timetable.id}_${change.timetable.scheduleType}`;

        if (!grouped.has(key)) {
            grouped.set(key, {
                timetable: change.timetable,
                changes: []
            });
        }

        grouped.get(key).changes.push(change);
    });

    return grouped;
}

/**
 * Create human-readable summary of changes for notification
 * @param {Array} changes - List of changes for a timetable
 * @returns {String} Summary text with day and specific details
 */
function createChangeSummary(changes) {
    // Group changes by day
    const changesByDay = new Map();

    changes.forEach(change => {
        const dayKey = change.dayName || change.day;
        if (!changesByDay.has(dayKey)) {
            changesByDay.set(dayKey, []);
        }
        changesByDay.get(dayKey).push(change);
    });

    // Create detailed summary with days
    const summaryParts = [];

    changesByDay.forEach((dayChanges, dayName) => {
        // Limit to 2 changes per day in notification to keep it readable
        const displayChanges = dayChanges.slice(0, 2);

        displayChanges.forEach(change => {
            let changeText = '';

            // Format: "Po 3.h: Matematika odpadla"
            const timePrefix = `${dayName} ${change.hour}.h`;

            if (change.type === 'lesson_removed') {
                changeText = `${timePrefix}: ${change.lesson.subject} odpadla`;
            } else if (change.type === 'substitution') {
                const newTeacher = change.change?.newValue || change.lesson.teacher;
                changeText = `${timePrefix}: ${change.lesson.subject} - supluje ${newTeacher}`;
            } else if (change.type === 'room_change') {
                const newRoom = change.change?.newValue || change.lesson.room;
                changeText = `${timePrefix}: ${change.lesson.subject} - učebna ${newRoom}`;
            } else if (change.type === 'lesson_added') {
                changeText = `${timePrefix}: Přidána ${change.lesson.subject}`;
            } else if (change.type === 'subject_change') {
                const newSubject = change.change?.newValue || change.lesson.subject;
                changeText = `${timePrefix}: Změna na ${newSubject}`;
            }

            if (changeText) {
                summaryParts.push(changeText);
            }
        });

        // If more changes on this day, add "a další..."
        if (dayChanges.length > 2) {
            summaryParts.push(`... a ${dayChanges.length - 2} dalších změn`);
        }
    });

    // Join with semicolons or newlines depending on length
    if (summaryParts.length <= 3) {
        return summaryParts.join('; ');
    } else {
        // Show first 3 and add "a další"
        const total = changes.length;
        return summaryParts.slice(0, 3).join('; ') + `; a ${total - 3} dalších...`;
    }
}

/**
 * Create detailed text for expandable notification
 * @param {Array} changes - List of changes for a timetable
 * @returns {String} Full detailed text with all changes
 */
function createDetailedChangeSummary(changes) {
    // Group changes by day
    const changesByDay = new Map();

    changes.forEach(change => {
        const dayKey = change.dayName || change.day;
        if (!changesByDay.has(dayKey)) {
            changesByDay.set(dayKey, []);
        }
        changesByDay.get(dayKey).push(change);
    });

    // Create full detailed text
    const dayParts = [];

    changesByDay.forEach((dayChanges, dayName) => {
        const changeTexts = dayChanges.map(change => {
            const timePrefix = `  ${change.hour}.h`;

            if (change.type === 'lesson_removed') {
                return `${timePrefix}: ${change.lesson.subject} odpadla`;
            } else if (change.type === 'substitution') {
                const oldTeacher = change.change?.oldValue || '';
                const newTeacher = change.change?.newValue || change.lesson.teacher;
                return `${timePrefix}: ${change.lesson.subject} - ${oldTeacher} → ${newTeacher}`;
            } else if (change.type === 'room_change') {
                const oldRoom = change.change?.oldValue || 'žádná';
                const newRoom = change.change?.newValue || change.lesson.room;
                return `${timePrefix}: ${change.lesson.subject} - učebna ${oldRoom} → ${newRoom}`;
            } else if (change.type === 'lesson_added') {
                return `${timePrefix}: Přidána ${change.lesson.subject} (${change.lesson.teacher})`;
            } else if (change.type === 'subject_change') {
                const oldSubject = change.change?.oldValue || '';
                const newSubject = change.change?.newValue || change.lesson.subject;
                return `${timePrefix}: ${oldSubject} → ${newSubject}`;
            }
            return '';
        }).filter(text => text);

        if (changeTexts.length > 0) {
            dayParts.push(`${dayName}:\n${changeTexts.join('\n')}`);
        }
    });

    return dayParts.join('\n\n');
}

module.exports = {
    detectTimetableChanges,
    groupChangesByTimetable,
    createChangeSummary,
    createDetailedChangeSummary,
};
