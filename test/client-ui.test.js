/**
 * Small pure helpers of the frontend: platform detection, deep links and the
 * manifest shortcuts, the stale-data banner text (contract S4), initial theme,
 * and the accessibility helpers in utils.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
globalThis.window = { location: { search: '' }, addEventListener() {}, matchMedia: () => ({ matches: false }) };

const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    ipadOld: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
    ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    android: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
};

test('isIOSDevice: iPhone, old iPad UA and iPadOS posing as a Mac (touch points)', async () => {
    const { isIOSDevice } = await import('../public/js/platform.js');
    assert.equal(isIOSDevice(UA.iphone, 5), true);
    assert.equal(isIOSDevice(UA.ipadOld, 5), true);
    assert.equal(isIOSDevice(UA.ipadDesktopMode, 5), true, 'iPadOS 13+ Safari reports Macintosh');
    assert.equal(isIOSDevice(UA.ipadDesktopMode, 0), false, 'a real Mac has no touch screen');
    assert.equal(isIOSDevice(UA.ipadDesktopMode, 1), false);
    assert.equal(isIOSDevice(UA.android, 5), false);
    assert.equal(isIOSDevice('', 0), false);
});

test('deep links: manifest shortcut views fall back safely to the default view', async () => {
    const { parseDeepLinkParams, parseViewParam, CHANGED_SELECTOR } = await import('../public/js/deeplink.js');
    assert.equal(parseViewParam('?view=changes'), 'changes');
    assert.equal(parseViewParam('?view=rooms'), 'rooms');
    assert.equal(parseViewParam('?view=<script>'), null);
    assert.equal(parseViewParam(''), null);
    // A shortcut URL is not a timetable deep link → boot continues with the saved/default timetable
    assert.equal(parseDeepLinkParams('?view=changes'), null);
    assert.deepEqual(parseDeepLinkParams('?type=Class&id=ZL&schedule=Next&day=2&hl=change'),
        { type: 'Class', id: 'ZL', schedule: 'next', day: 2, highlight: true });
    assert.equal(parseDeepLinkParams('?type=Evil&id=1'), null);
    assert.equal(CHANGED_SELECTOR, '[data-changed="true"]');
});

test('outage banner text shows how old the data are (S4: dataAgeMin, lastSuccessAt)', async () => {
    const { outageBannerText } = await import('../public/js/offline.js');
    const now = new Date(2026, 10, 4, 10, 0);
    const today = new Date(2026, 10, 4, 7, 30).toISOString();
    assert.equal(outageBannerText({ dataAgeMin: 150, lastSuccessAt: today }, now),
        'Data z Bakalářů se teď nedaří aktualizovat – zobrazená data jsou z dnes v 7:30 (před 2 h).');
    const yesterday = new Date(2026, 10, 3, 15, 5).toISOString();
    assert.match(outageBannerText({ dataAgeMin: 1135, lastSuccessAt: yesterday }, now), /z 3\. 11\. v 15:05 \(před 18 h\)/);
    assert.match(outageBannerText({ dataAgeMin: 45 }, now), /stažena před 45 min/);
    assert.equal(outageBannerText({}, now), 'Data z Bakalářů se teď nedaří aktualizovat – zobrazuji poslední stažená.');
    assert.equal(outageBannerText({ dataAgeMin: null, lastSuccessAt: 'nonsense' }, now), outageBannerText({}, now));
});

test('first visit follows prefers-color-scheme, a saved choice wins', async () => {
    const { resolveInitialTheme } = await import('../public/js/theme.js');
    assert.equal(resolveInitialTheme(null, true), 'light');
    assert.equal(resolveInitialTheme(null, false), 'dark');
    assert.equal(resolveInitialTheme('dark', true), 'dark');
    assert.equal(resolveInitialTheme('light', false), 'light');
    assert.equal(resolveInitialTheme('garbage', true), 'light');
});

/** Element stand-in for the a11y helpers. */
function fakeEl() {
    const attrs = {};
    const handlers = {};
    const classes = new Set();
    return {
        attrs, tabIndex: -1,
        setAttribute: (k, v) => { attrs[k] = String(v); },
        addEventListener: (t, fn) => { (handlers[t] ||= []).push(fn); },
        fire: (t, ev) => (handlers[t] || []).forEach(fn => fn(ev)),
        classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c) },
    };
}

test('makeActivatable: role=button, focusable, Enter/Space activate, other keys do not', async () => {
    const { makeActivatable } = await import('../public/js/utils.js');
    const el = fakeEl();
    let n = 0;
    makeActivatable(el, () => n++);
    assert.equal(el.attrs.role, 'button');
    assert.equal(el.tabIndex, 0);
    let prevented = 0;
    const key = (k) => ({ key: k, preventDefault: () => prevented++ });
    el.fire('keydown', key('Enter'));
    el.fire('keydown', key(' '));
    el.fire('keydown', key('a'));
    el.fire('click', {});
    assert.equal(n, 3);
    assert.equal(prevented, 2, 'Space must not scroll the page');
});

test('setPressed: one active button, aria-pressed mirrors .active', async () => {
    const { setPressed } = await import('../public/js/utils.js');
    const btns = ['a', 'b', 'c'].map(id => Object.assign(fakeEl(), { id }));
    setPressed(btns, b => b.id === 'b');
    assert.deepEqual(btns.map(b => b.attrs['aria-pressed']), ['false', 'true', 'false']);
    assert.deepEqual(btns.map(b => b.classList.has('active')), [false, true, false]);
});

test('lesson name + status icon: change/cancellation is not conveyed by colour only', async () => {
    const { lessonAccessibleName, lessonStatusIcon } = await import('../public/js/utils.js');
    const base = { hour: 3, subject: 'Matematika', teacher: 'Ukázková Jana', room: 'U12', group: null, type: 'normal', changed: false };
    assert.equal(lessonAccessibleName(base), '3. hodina (9:45-10:30), Matematika, vyučující Ukázková Jana, učebna U12');
    assert.match(lessonAccessibleName({ ...base, changed: true }), /, změna$/);
    assert.match(lessonAccessibleName({ ...base, type: 'removed', changed: true }), /, zrušeno$/);
    assert.equal(lessonStatusIcon(base), '');
    assert.match(lessonStatusIcon({ ...base, changed: true }), /is-changed[^>]*aria-hidden="true"/);
    assert.match(lessonStatusIcon({ ...base, type: 'removed' }), /is-removed/);
});
