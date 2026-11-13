// Application state
export const state = {
    definitions: {},
    currentTimetableData: [],
    selectedDayIndex: null,
    selectedType: 'Class',
    selectedScheduleType: 'actual',
    teacherAbbreviationMap: null,
    showWholeWeek: false, // DEPRECATED - use layoutMode instead
    notificationsEnabled: false,
    // Lesson reminders are enabled in preferences but can't be delivered (no
    // browser permission / no FCM token) — drives a warning in the notif modal.
    remindersNeedAttention: false,
    watchedTimetables: [],
    favoriteTimetables: [],
    layoutMode: 'single-day',
    // "Jen změny" toolbar toggle: list the week's changes instead of the layout
    // (session only - a returning user should see the normal timetable)
    onlyChanges: false,
    layoutPreferences: {
        'single-day': {},
        'week-view': {},
        'card-view': { cardIndex: 0 },
        'compact-list': {}
    }
};

export function updateState(key, value) {
    state[key] = value;
}

