const test = require('node:test');
const assert = require('node:assert/strict');

const { filterChangesByPreferences, preferenceKeyForChange } = require('../backend/fcm');
const { createChangeSummary, createDetailedChangeSummary } = require('../backend/change-detector');

const change = (type, extra = {}) => ({
    type,
    day: 0,
    dayName: 'Po',
    hour: 3,
    lesson: { subject: 'Matematika', teacher: 'J. Tužilová', room: 'A102' },
    change: { newValue: 'removed' },
    ...extra,
});

// Preferences as the app stores them for a watched timetable
const prefs = (changes) => ({ changes });
const ALL_OFF = prefs({ lesson_removed: false, substitution: false, room_change: false, lesson_added: false, subject_change: false });
const DEFAULTS = prefs({ lesson_removed: true, substitution: true, room_change: true, lesson_added: false, subject_change: false });

test('a cancelled lesson (type_change) is gated by the "odpadlé hodiny" switch', () => {
    // type_change has no switch of its own; it means "the lesson was cancelled"
    assert.equal(preferenceKeyForChange('type_change'), 'lesson_removed');
    assert.equal(preferenceKeyForChange('substitution'), 'substitution');

    const cancelled = change('type_change');

    // Used to be dropped here, which is why cancellations never notified anyone
    assert.deepEqual(filterChangesByPreferences([cancelled], DEFAULTS), [cancelled]);
    assert.deepEqual(filterChangesByPreferences([cancelled], ALL_OFF), []);

    // Older user docs that never stored the switch still get the important ones
    assert.deepEqual(filterChangesByPreferences([cancelled], prefs({})), [cancelled]);
    assert.deepEqual(filterChangesByPreferences([change('lesson_added')], prefs({})), []);
});

test('other change types keep their own switches', () => {
    const sub = change('substitution');
    const room = change('room_change');
    const added = change('lesson_added');

    assert.deepEqual(filterChangesByPreferences([sub, room, added], DEFAULTS), [sub, room]);
    assert.deepEqual(filterChangesByPreferences([sub, room, added], prefs({ ...DEFAULTS.changes, lesson_added: true })), [sub, room, added]);
    // No preferences stored at all → send everything (unchanged behaviour)
    assert.deepEqual(filterChangesByPreferences([added], null), [added]);
});

test('a cancelled lesson produces readable notification text', () => {
    const cancelled = change('type_change');
    const absent = change('type_change', { change: { newValue: 'absent' } });

    const summary = createChangeSummary([cancelled]);
    assert.match(summary, /Matematika/);
    assert.match(summary, /odpadla/);

    // Previously empty: the change matched no branch and was filtered out
    assert.notEqual(createChangeSummary([absent]).trim(), '');
    assert.match(createChangeSummary([absent]), /absence/);

    const detailed = createDetailedChangeSummary([cancelled]);
    assert.match(detailed, /Matematika/);
    assert.match(detailed, /odpadla/);
});
