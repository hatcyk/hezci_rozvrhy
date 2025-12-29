// Application state
export const state = {
    definitions: {},
    currentTimetableData: [],
    selectedDayIndex: null,
    selectedType: 'Class',
    selectedScheduleType: 'actual',
    weekOffset: 0,
    teacherAbbreviationMap: null,
    showWholeWeek: false, // DEPRECATED - use layoutMode instead
    notificationsEnabled: false,
    watchedTimetables: [],
    layoutMode: 'single-day',
    layoutPreferences: {
        'single-day': {},
        'week-view': {},
        'card-view': { cardIndex: 0 },
        'compact-list': { scrollPosition: 0 }
    }
};

export function updateState(key, value) {
    state[key] = value;
}

export function getState(key) {
    return state[key];
}
