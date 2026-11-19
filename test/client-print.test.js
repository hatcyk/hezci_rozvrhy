/**
 * Print sheet of the week (print.js) and the calendar subscription URLs
 * (calendar-sheet.js): pure functions of the phase 2 timetable toolbar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.window = globalThis.window || { location: { search: '' }, addEventListener() {}, matchMedia: () => ({ matches: false }) };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

const L = (day, hour, extra = {}) => ({ day, hour, subject: 'Matematika', teacher: 'Mgr. Jana Ukázková', room: 'U12', group: null, type: 'atom', changed: false, ...extra });

test('print sheet: 5 days, hours of the week, changes as words (readable in black and white)', async () => {
    const { printSheetHtml } = await import('../public/js/print.js');
    const html = printSheetHtml([
        L(0, 1), L(0, 2, { changed: true, subject: 'Fyzika' }), L(2, 5, { type: 'removed', changed: true }),
        L(4, 3, { type: 'absent', changed: true, subject: 'Exkurze' }), L(1, 6, { group: '1.sk' }),
    ], { title: 'Rozvrh – třída 9.Z', subtitle: 'aktuální týden', dates: ['2. 11.', '3. 11.', '4. 11.', '5. 11.', '6. 11.'] });
    assert.equal((html.match(/<tr><th scope="row">/g) || []).length, 5);
    assert.equal((html.match(/<th scope="col">\d+\./g) || []).length, 6, 'hours 1–6');
    assert.match(html, /<span class="pl-flag">změna<\/span>/);
    assert.match(html, /<s><span class="pl-subject">MAT<\/span>/, 'cancelled lesson is struck through');
    assert.match(html, /<span class="pl-flag">odpadá<\/span>/);
    assert.match(html, /<span class="pl-flag">nekoná se<\/span>/);
    assert.match(html, /pl-group">1\.sk/);
    assert.match(html, /4\. 11\./);
    assert.match(html, /pg-legend/, 'legend explains the marks');
    assert.doesNotMatch(printSheetHtml([L(0, 1)], { title: 'x' }), /pg-legend/, 'no legend without changes');
});

test('print sheet escapes everything from Bakaláři', async () => {
    const { printSheetHtml } = await import('../public/js/print.js');
    const evil = '<img src=x onerror="alert(1)">';
    const html = printSheetHtml([L(0, 1, { subject: `X${evil}`, room: `<b>U1</b>`, teacher: `Nová${evil} Jana` })], { title: `T${evil}`, subtitle: evil });
    assert.ok(!/<img/i.test(html) && !/<b>/i.test(html));
    assert.match(html, /&lt;img/);
});

test('calendar: https + webcal URL of the iCal export, schedule and groups', async () => {
    const { calendarUrls, classGroups } = await import('../public/js/calendar-sheet.js');
    assert.deepEqual(calendarUrls({ origin: 'https://example.test', type: 'Class', id: 'ZL', schedule: 'actual,next' }), {
        https: 'https://example.test/api/ical/Class/ZL.ics?schedule=actual,next',
        webcal: 'webcal://example.test/api/ical/Class/ZL.ics?schedule=actual,next',
    });
    assert.equal(calendarUrls({ origin: 'http://127.0.0.1:3000', type: 'Class', id: 'ZL', schedule: 'permanent', groups: ['1.sk', 'TVk1'] }).webcal,
        'webcal://127.0.0.1:3000/api/ical/Class/ZL.ics?schedule=permanent&group=1.sk,TVk1');
    assert.equal(calendarUrls({ origin: 'https://e.test', type: 'Room', id: 'A/1', schedule: 'actual,next' }).https,
        'https://e.test/api/ical/Room/A%2F1.ics?schedule=actual,next', 'id is encoded');
    assert.deepEqual(classGroups([L(0, 1), L(0, 2, { group: '2.sk' }), L(0, 2, { group: '1.sk' }), L(1, 1, { group: 'celá třída' }), L(1, 1, { group: 'TVk1' })]),
        ['1.sk', '2.sk', 'TVk1']);
});
