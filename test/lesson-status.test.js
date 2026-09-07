const test = require('node:test');
const assert = require('node:assert/strict');

// Frontend modules are ESM; load them dynamically. utils.js only depends on constants.js.
const utilsP = import('../public/js/utils.js');
const statusP = import('../public/js/lesson-status.js');

// Monday 2026-09-07 (school week), local time
const at = (h, m) => new Date(2026, 8, 7, h, m, 0);

/** Minimal Element stand-in: dataset + classList */
function fakeEl(day, hour, prefix = '', classes = []) {
    const set = new Set(classes);
    return {
        dataset: { day: String(day), hour: String(hour), timeStatus: prefix },
        classList: {
            contains: (c) => set.has(c),
            toggle: (c, force) => { force ? set.add(c) : set.delete(c); return force; },
        },
        classes: () => [...set].sort(),
    };
}

test('getLessonTimeClass: current / upcoming / past / none on a school day', async () => {
    const { getLessonTimeClass, getLessonTimeStatus } = await utilsP;
    assert.equal(getLessonTimeStatus(0, 1, at(8, 10)), 'current');
    assert.equal(getLessonTimeClass(0, 1, at(8, 10), 'agenda'), 'agenda-current');
    assert.equal(getLessonTimeClass(0, 0, at(8, 10), 'agenda'), 'agenda-past');
    // 08:10 → hour 1 (8:00-8:45) is current, hour 2 upcoming, hour 0 past, hour 3 nothing
    assert.equal(getLessonTimeClass(0, 1, at(8, 10)), 'current-time');
    assert.equal(getLessonTimeClass(0, 2, at(8, 10)), 'upcoming');
    assert.equal(getLessonTimeClass(0, 0, at(8, 10)), 'past');
    assert.equal(getLessonTimeClass(0, 3, at(8, 10)), '');
    // during the break 8:46-8:49: no current hour, hour 2 is upcoming, hour 1 past
    assert.equal(getLessonTimeClass(0, 1, at(8, 47)), 'past');
    assert.equal(getLessonTimeClass(0, 2, at(8, 47)), 'upcoming');
    // other days: yesterday's lessons past, tomorrow's untouched
    assert.equal(getLessonTimeClass(1, 1, at(8, 10)), '', 'Tuesday while it is Monday');
    assert.equal(getLessonTimeClass(0, 5, new Date(2026, 8, 8, 8, 10)), 'past', 'Monday while it is Tuesday');
    // weekend: nothing is highlighted
    assert.equal(getLessonTimeClass(0, 1, new Date(2026, 8, 5, 8, 10)), '');
});

test('applyLessonTimeClasses toggles only what changed and respects the prefix', async () => {
    const { applyLessonTimeClasses } = await statusP;

    const h0 = fakeEl(0, 0, '', ['lesson-card', 'current-time']);   // was current, is now past
    const h1 = fakeEl(0, 1, '', ['lesson-card', 'upcoming']);       // was upcoming, is now current
    const h2 = fakeEl(0, 2, '', ['lesson-card']);                   // becomes upcoming
    const h3 = fakeEl(0, 3, '', ['lesson-card']);                   // unchanged
    const ag = fakeEl(0, 1, 'agenda', ['agenda-row', 'agenda-upcoming']);
    const tue = fakeEl(1, 1, '', ['lesson-card', 'past']);          // stale class from another day must go

    const changed = applyLessonTimeClasses([h0, h1, h2, h3, ag, tue], at(8, 10));

    assert.equal(changed, 5);
    assert.deepEqual(h0.classes(), ['lesson-card', 'past']);
    assert.deepEqual(h1.classes(), ['current-time', 'lesson-card']);
    assert.deepEqual(h2.classes(), ['lesson-card', 'upcoming']);
    assert.deepEqual(h3.classes(), ['lesson-card']);
    assert.deepEqual(ag.classes(), ['agenda-current', 'agenda-row']);
    assert.deepEqual(tue.classes(), ['lesson-card']);

    // Second pass at the same time is a no-op
    assert.equal(applyLessonTimeClasses([h0, h1, h2, h3, ag, tue], at(8, 10)), 0);

    // Elements without usable data attributes are skipped
    assert.equal(applyLessonTimeClasses([{ dataset: {}, classList: { contains: () => false, toggle: () => {} } }], at(8, 10)), 0);
});
