// Lesson reminders: Prague time / DST, notification windows, env config,
// the crontab schedule and the atomic claim (no double send).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Job logs go to stdout, which the test runner shares with its own binary
// messages; keep them out (see test/auth.test.js).
console.log = () => {};
const { createFakeFirestore, stubFirebase } = require('./helpers/fake-firestore');

const USER = 'anon-0b7f6c1e-8a1d-4c3b-9f2e-1a2b3c4d5e6f';
const db = createFakeFirestore({
    'system/migrations': { watchIndexV1: true },
    [`users/${USER}`]: {
        tokens: ['fcm-1'],
        hasReminders: true,
        watchedKeys: ['Class_ZL_Actual'],
        preferences: {
            watchedTimetables: [{
                type: 'Class', id: 'ZL', scheduleType: 'Actual', groupFilters: [],
                notificationTypes: { reminders: { next_lesson_room: true } },
            }],
        },
    },
    // Wednesday (day 2), hour 1 (8:00)
    'timetables/Class_ZL_Actual': {
        data: [
            { day: 2, hour: 1, subject: 'Matematika', teacher: 'J. Novák', room: 'A102', group: '' },
            { day: 2, hour: 2, subject: 'Fyzika', teacher: 'K. Malá', room: 'B1', group: '', type: 'removed' },
            // Snapshot of the previous week still stored as Actual (S2 date)
            { day: 2, hour: 3, subject: 'Chemie', teacher: 'L. Nová', room: 'C3', group: '', date: '2026-10-28' },
            { day: 2, hour: 4, subject: 'Dějepis', teacher: 'M. Dlouhá', room: 'D4', group: '', date: '2026-11-04' },
        ],
    },
});
const { sent } = stubFirebase(db);

const { calculateNotificationWindows, findLessonsToNotify, getNotificationConfig, intFromEnv } = require('../backend/schedule-calculator');
const { getPragueTimeInfo, isWeekend } = require('../backend/timezone-manager');
const { lessonTimes, sendLessonReminders, mapWithConcurrency } = require('../backend/lesson-reminder');
const { claimReminder, isAlreadyExists } = require('../backend/notification-tracker');

const CFG = { minutesBefore: 5, windowStartMinutes: 6, windowEndMinutes: 1 };
const at = (h, m) => h * 60 + m;
const toNotify = (h, m) => findLessonsToNotify(calculateNotificationWindows(at(h, m), lessonTimes, CFG)).map(w => w.hour);
const quiet = () => { const l = console.log, e = console.error; console.log = console.error = () => {}; return () => { console.log = l; console.error = e; }; };

function withEnv(vars, fn) {
    const saved = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return fn(); } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}

test('okno 1. hodiny (8:00) je 7:54–7:59 včetně krajů', () => {
    assert.deepEqual(toNotify(7, 53), []);
    assert.deepEqual(toNotify(7, 54), [1]);
    assert.deepEqual(toNotify(7, 59), [1]);
    assert.deepEqual(toNotify(8, 0), []);
});

test('okna se nepřekrývají: každá minuta dne spustí nejvýš jednu hodinu', () => {
    for (let m = 0; m < 24 * 60; m++) {
        assert.ok(findLessonsToNotify(calculateNotificationWindows(m, lessonTimes, CFG)).length <= 1, `minuta ${m}`);
    }
});

test('isDST a utcOffset podle Europe/Prague, ne podle zóny serveru', () => {
    const original = process.env.TZ;
    try {
        for (const tz of ['UTC', 'Europe/Prague', 'America/New_York', 'Asia/Tokyo']) {
            process.env.TZ = tz;
            const summer = getPragueTimeInfo(new Date('2026-07-01T10:00:00Z'));
            assert.equal(summer.isDST, true, tz);
            assert.equal(summer.utcOffset, 2, tz);
            assert.equal(summer.hour, 12, tz);
            const winter = getPragueTimeInfo(new Date('2026-01-15T10:00:00Z'));
            assert.equal(winter.isDST, false, tz);
            assert.equal(winter.utcOffset, 1, tz);
            assert.equal(winter.hour, 11, tz);
        }
    } finally {
        if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
});

test('přechody času 2026: hodina po přepnutí má už nový posun', () => {
    const info = (iso) => getPragueTimeInfo(new Date(iso));
    assert.deepEqual([info('2026-03-29T00:30:00Z').formattedTime, info('2026-03-29T00:30:00Z').utcOffset], ['01:30:00', 1]);
    // 2:00–3:00 does not exist; date-fns-tz getTimezoneOffset() still said +1 here
    assert.deepEqual([info('2026-03-29T01:30:00Z').formattedTime, info('2026-03-29T01:30:00Z').utcOffset], ['03:30:00', 2]);
    assert.deepEqual([info('2026-10-25T00:30:00Z').formattedTime, info('2026-10-25T00:30:00Z').utcOffset], ['02:30:00', 2]);
    // 2:00–3:00 happens twice; the second time is CET
    assert.deepEqual([info('2026-10-25T01:30:00Z').formattedTime, info('2026-10-25T01:30:00Z').utcOffset], ['02:30:00', 1]);
    assert.equal(info('2026-11-04T06:57:00Z').formattedTime, '07:57:00');
    assert.equal(info('2026-07-01T05:57:00Z').formattedTime, '07:57:00');
});

test('víkend a půlnoc se počítají v pražském čase, ne v UTC', () => {
    assert.equal(isWeekend(new Date('2026-11-07T10:00:00Z')), true);               // sobota
    assert.equal(getPragueTimeInfo(new Date('2026-11-08T23:30:00Z')).dayIndex, 0);  // v UTC neděle, v Praze pondělí 0:30
});

test('konfigurace z prostředí: 0 je platná hodnota, nesmysl dá výchozí', () => {
    withEnv({ LESSON_REMINDER_WINDOW_END: '0', LESSON_REMINDER_MINUTES_BEFORE: '0', LESSON_REMINDER_WINDOW_START: 'abc' }, () => {
        const cfg = getNotificationConfig();
        assert.equal(cfg.windowEndMinutes, 0, 'dřív parseInt("0") || 1 = 1');
        assert.equal(cfg.minutesBefore, 0);
        assert.equal(cfg.windowStartMinutes, 6);
    });
    withEnv({ X_TEST_INT: '-3' }, () => assert.equal(intFromEnv('X_TEST_INT', 7), 7));
    withEnv({ X_TEST_INT: ' ' }, () => assert.equal(intFromEnv('X_TEST_INT', 7), 7));
    withEnv({ LESSON_REMINDER_ENABLED: undefined }, () => assert.equal(getNotificationConfig().enabled, true));
    for (const off of ['false', 'FALSE', '0', 'off', 'no']) {
        withEnv({ LESSON_REMINDER_ENABLED: off }, () => assert.equal(getNotificationConfig().enabled, false, off));
    }
});

test('LESSON_REMINDER_ENABLED=false opravdu vypne upomínky (dřív se příznak jen načetl)', async () => {
    const reads = db._log.length;
    const result = await withEnv({ LESSON_REMINDER_ENABLED: 'false' }, () =>
        sendLessonReminders({ mockTime: new Date('2026-11-04T06:56:00Z') }));
    assert.deepEqual(result, { sent: 0, reason: 'disabled' });
    assert.equal(db._log.length, reads, 'Firestore se vůbec nečetl');
    assert.equal(sent.length, 0);
});

test('crontab upomínek pokryje okna všech hodin (dřív „7-15“, 11. a 12. hodina bez upomínky)', () => {
    const line = fs.readFileSync(path.join(__dirname, '../deploy/crontab.example'), 'utf8')
        .split('\n').find(l => l.includes('send-lesson-reminders') && !l.trim().startsWith('#'));
    const [from, to] = line.trim().split(/\s+/)[1].split('-').map(Number);
    for (const w of calculateNotificationWindows(0, lessonTimes, CFG)) {
        const hStart = Math.floor(w.windowStart / 60), hEnd = Math.floor(w.windowEnd / 60);
        assert.ok(hStart >= from && hEnd <= to, `hodina ${w.hour}: okno ${w.windowStartFormatted}–${w.windowEndFormatted} mimo ${from}–${to}`);
    }
});

test('zábor upomínky přes create(): ze souběžných pokusů vyhraje právě jeden', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => claimReminder('u-claim', '2026-11-04', 3)));
    assert.equal(results.filter(Boolean).length, 1);
    const doc = db._get('lesson_notifications_sent/u-claim_2026-11-04_3');
    assert.equal(doc.status, 'sending');
    assert.ok(doc.sentAt, 'sentAt nutné pro noční úklid');

    assert.equal(isAlreadyExists({ code: 6 }), true);
    assert.equal(isAlreadyExists(new Error('6 ALREADY_EXISTS: Document already exists')), true);
    assert.equal(isAlreadyExists(new Error('14 UNAVAILABLE')), false);
});

test('dva souběžné běhy upomínek pošlou upomínku jen jednou', async () => {
    const restore = quiet();
    try {
        // Wednesday 2026-11-04 07:56 Prague (CET) → hour 1 (8:00) is in its window
        const mockTime = new Date('2026-11-04T06:56:00Z');
        const [a, b] = await Promise.all([sendLessonReminders({ mockTime }), sendLessonReminders({ mockTime })]);
        assert.equal(sent.length, 1, 'FCM zavoláno jednou');
        assert.equal(a.sent + b.sent, 1);
        assert.equal(a.skipped + b.skipped, 1);
        assert.match(sent[0].data.title, /Za 4 minuty: MAT/);

        const record = db._get(`lesson_notifications_sent/${USER}_2026-11-04_1`);
        assert.equal(record.status, 'sent');
        assert.equal(record.timetableId, 'Class_ZL_Actual');

        // A minute later, still in the window: nothing new.
        const later = await sendLessonReminders({ mockTime: new Date('2026-11-04T06:57:00Z') });
        assert.equal(later.sent, 0);
        assert.equal(later.skipped, 1);
        assert.equal(sent.length, 1);

        // Hour 2 is cancelled → no reminder, no claim.
        const cancelled = await sendLessonReminders({ mockTime: new Date('2026-11-04T07:46:00Z') });
        assert.equal(cancelled.sent, 0);
        assert.equal(db._get(`lesson_notifications_sent/${USER}_2026-11-04_2`), undefined);

        // Hour 3 (9:45) belongs to last week's snapshot → no reminder.
        const staleWeek = await sendLessonReminders({ mockTime: new Date('2026-11-04T08:40:00Z') });
        assert.equal(staleWeek.sent, 0);
        // Hour 4 (10:50) is dated today → reminder.
        const today = await sendLessonReminders({ mockTime: new Date('2026-11-04T09:45:00Z') });
        assert.equal(today.sent, 1);
        assert.match(sent[1].data.title, /DEJ/);
    } finally {
        restore();
    }
});

test('mapWithConcurrency drží limit souběhu a pořadí výsledků', async () => {
    let inFlight = 0, peak = 0;
    const out = await mapWithConcurrency([5, 1, 3, 2, 4], 2, async (x) => {
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, x));
        inFlight--;
        return x * 10;
    });
    assert.deepEqual(out, [50, 10, 30, 20, 40]);
    assert.equal(peak, 2);
    assert.deepEqual(await mapWithConcurrency([], 3, async () => 1), []);
});

const { isDayOff } = require('../backend/lesson-reminder');

test('isDayOff: den volna platí jen ve svém datu', () => {
    const off = [{ day: 3, date: '2026-11-05', name: 'ředitelské volno' }];
    assert.equal(isDayOff(off, 3, '2026-11-05'), true);
    assert.equal(isDayOff(off, 3, '2026-11-12'), false, "last week's holiday in a stale snapshot");
    assert.equal(isDayOff(off, 2, '2026-11-04'), false);
    assert.equal(isDayOff([{ day: 3, date: null }], 3, '2026-11-12'), true);
    assert.equal(isDayOff(undefined, 3, '2026-11-05'), false);
});

test('upomínky přeskočí den volna, i kdyby snímek ten den nějakou hodinu měl', async () => {
    const restore = quiet();
    try {
        db._store.set('timetables/Class_ZL_Actual', {
            weekStart: '2026-11-02',
            daysOff: [{ day: 3, date: '2026-11-05', name: 'ředitelské volno' }],
            data: [
                { day: 3, hour: 1, subject: 'Matematika', teacher: 'J. Ukázková', room: 'A102', group: '', date: '2026-11-05' },
                { day: 4, hour: 1, subject: 'Fyzika', teacher: 'K. Vzorová', room: 'B1', group: '', date: '2026-11-06' },
            ],
        });
        const before = sent.length;
        // Thursday 5. 11. 07:56 Prague → hour 1 is in its window, but the day is off.
        const thursday = await sendLessonReminders({ mockTime: new Date('2026-11-05T06:56:00Z') });
        assert.equal(thursday.sent, 0);
        assert.equal(db._get(`lesson_notifications_sent/${USER}_2026-11-05_1`), undefined, 'no claim written');
        // Friday is a normal day.
        const friday = await sendLessonReminders({ mockTime: new Date('2026-11-06T06:56:00Z') });
        assert.equal(friday.sent, 1);
        assert.equal(sent.length, before + 1);
    } finally {
        restore();
    }
});
