const test = require('node:test');
const assert = require('node:assert/strict');

const { filterChangesByPreferences, preferenceKeyForChange } = require('../backend/fcm');
const { createChangeSummary, createDetailedChangeSummary } = require('../backend/change-detector');

const change = (type, extra = {}) => ({
    type,
    day: 0,
    dayName: 'Po',
    hour: 3,
    lesson: { subject: 'Matematika', teacher: 'J. Ukázková', room: 'A102' },
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

const { findDeadTokens, buildChangeNotification, DEAD_TOKEN_ERRORS } = require('../backend/fcm');

test('token se maže jen u „neregistrován“, ne při messaging/invalid-argument (chyba zprávy)', () => {
    const tokens = ['ok', 'gone', 'bad-payload', 'malformed'];
    const result = {
        responses: [
            { success: true },
            { success: false, error: { code: 'messaging/registration-token-not-registered' } },
            { success: false, error: { code: 'messaging/invalid-argument' } },
            { success: false, error: { code: 'messaging/invalid-registration-token' } },
        ],
    };
    assert.deepEqual(findDeadTokens(tokens, result), ['gone', 'malformed']);
    assert.equal(DEAD_TOKEN_ERRORS.has('messaging/invalid-argument'), false);
    // A payload error for everyone must not wipe anyone's token.
    const allInvalid = { responses: tokens.map(() => ({ success: false, error: { code: 'messaging/invalid-argument' } })) };
    assert.deepEqual(findDeadTokens(tokens, allInvalid), []);
    assert.deepEqual(findDeadTokens(tokens, null), []);
});

test('notifikace o změně nese typ, id a druh rozvrhu (SW z nich skládá tag) jako řetězce', () => {
    const n = buildChangeNotification(
        { type: 'Class', id: 'ZL', name: 'ZL', scheduleType: 'Next' },
        [change('substitution', { day: 3 })]
    );
    assert.equal(n.title, 'ZL PŘÍŠTÍ: Změny v rozvrhu');
    assert.equal(n.data.type, 'timetable_change');
    assert.equal(n.data.timetableType, 'Class');
    assert.equal(n.data.timetableId, 'ZL');
    assert.equal(n.data.scheduleType, 'Next');
    assert.equal(n.data.day, '3');
    assert.equal(n.data.changeCount, '1');
    // FCM rejects non-string data values (that would be messaging/invalid-argument).
    for (const [k, v] of Object.entries(n.data)) assert.equal(typeof v, 'string', k);
    const tag = 'change_' + n.data.timetableType + '_' + n.data.timetableId + '_' + n.data.scheduleType;
    assert.equal(tag, 'change_Class_ZL_Next');

    const numericId = buildChangeNotification({ type: 'Room', id: 17, name: '17', scheduleType: 'Permanent' }, [change('room_change')]);
    assert.equal(numericId.data.timetableId, '17');
    assert.equal(numericId.title, '17 STÁLÝ: Změny v rozvrhu');
});
