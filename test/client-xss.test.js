/**
 * XSS hardening of the frontend: everything scraped from Bakaláři is escaped
 * before it reaches innerHTML (esc() in public/js/utils.js).
 *
 * The renderers are real ES modules; a minimal DOM stand-in (no jsdom) is
 * installed first, because a few modules touch window/localStorage when loaded.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// ---- minimal browser globals --------------------------------------------
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
const fakeEl = () => ({
    innerHTML: '', scrollTop: 0, scrollLeft: 0, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [],
});
const container = fakeEl();
const byId = { flatTimetableList: fakeEl() };
globalThis.window = { addEventListener() {}, location: { search: '' }, matchMedia: () => ({ matches: false }), innerWidth: 390 };
globalThis.document = {
    querySelector: (sel) => (sel.startsWith('.timetable-container') ? container : null),
    querySelectorAll: () => [],
    getElementById: (id) => byId[id] || null,
    addEventListener() {},
    documentElement: { setAttribute() {} },
};

const EVIL = '<img src=x onerror="alert(1)">';
const lesson = (extra = {}) => ({
    day: 0, hour: 1, subject: `Matematika${EVIL}`, teacher: `Nová${EVIL} Jana`, room: `U1<b>2</b>`,
    group: `9.Z 1.sk${EVIL}`, theme: null, type: 'normal', changed: true,
    changeInfo: { description: `Suplování: MAT${EVIL}, Nová Jana (FYZ, Eva)` }, ...extra,
});

/** No executable markup may survive; the text must still be there, escaped. */
function assertInert(html, label) {
    assert.ok(!/<img/i.test(html), `${label}: raw <img> in output`);
    assert.ok(!/<b>/i.test(html), `${label}: raw <b> in output`);
    // attribute values are blanked first: escaped text inside aria-label="…" is fine
    const tagsOnly = html.replace(/"[^"]*"/g, '""');
    assert.ok(!/<[^>]*\sonerror\s*=/i.test(tagsOnly), `${label}: element with an onerror attribute`);
    assert.ok(/&lt;img/.test(html), `${label}: escaped text missing`);
}

test('esc() escapes HTML-significant characters and handles null/numbers', async () => {
    const { esc } = await import('../public/js/utils.js');
    assert.equal(esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
    assert.equal(esc(7), '7');
    assert.equal(esc('Čeština – bez změny'), 'Čeština – bez změny');
    assert.equal(esc(EVIL), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('parseChangeInfo() escapes every part of a Bakaláři change note', async () => {
    const { parseChangeInfo } = await import('../public/js/utils.js');
    const cases = [
        `Suplování: MAT${EVIL}, Nová Jana (FYZ, Eva${EVIL})`,
        `Zrušeno - ${EVIL}`,
        `Vyjmuto z rozvrhu (MAT${EVIL}, Nová)`,
        `přednáška${EVIL} (ABC)`,
        `Něco jiného ${EVIL}`,
    ];
    for (const raw of cases) {
        const out = parseChangeInfo(raw);
        assertInert(out.formatted, raw.slice(0, 20));
    }
});

test('agenda / compact / card layouts render a <img onerror> subject as text', async () => {
    const { state } = await import('../public/js/state.js');
    const r = await import('../public/js/layout-renderers.js');
    state.currentTimetableData = [lesson(), lesson({ hour: 2, type: 'removed' }), lesson({ hour: 2, group: '9.Z 2.sk' })];
    state.selectedDayIndex = 0;
    state.selectedScheduleType = 'permanent';
    state.layoutPreferences = { 'card-view': { cardIndex: 0 } };

    r.renderAgendaLayout();
    assertInert(container.innerHTML, 'agenda');
    assert.match(container.innerHTML, /data-changed="true"/, 'changed slots are marked for the deep-link highlight');

    r.renderCompactListLayout();
    assertInert(container.innerHTML, 'compact');
    assert.match(container.innerHTML, /lesson-status-icon is-changed/, 'change has a shape icon, not only colour');

    r.renderCardLayout();
    assertInert(container.innerHTML, 'card');
});

test('notification list escapes timetable names from definitions', async () => {
    const { state } = await import('../public/js/state.js');
    const { populateFlatList } = await import('../public/js/notifications-multiselect.js');
    state.definitions = { classes: [{ id: 'X"1', name: `9.Z${EVIL}` }], teachers: [] };
    state.watchedTimetables = [];
    populateFlatList();
    const html = byId.flatTimetableList.innerHTML;
    assertInert(html, 'flat list');
    assert.ok(html.includes('data-id="X&quot;1"'), 'attribute value escaped');
    assert.match(html, /aria-label="Sledovat 9\.Z&lt;img/, 'toggle has an accessible name');
});
