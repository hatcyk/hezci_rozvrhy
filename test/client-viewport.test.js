/**
 * Visible area above the on-screen keyboard (public/js/viewport.js).
 * iOS Safari and the installed app do not shrink the layout viewport for the
 * keyboard: it covers the page, and iOS may pan the visible part down to show
 * the focused field. position: fixed counts from the layout viewport, so a
 * bottom sheet ended behind the keyboard or under the status bar (photos
 * 7805, 7807). viewport.js keeps the visible area in CSS variables, flags an
 * open keyboard and locks the page behind a sheet. Fake visualViewport and
 * document, numbers from the iOS 26.5 simulator (iPhone 17, web app).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const mod = () => import('../public/js/viewport.js');

function fakeRoot(clientHeight) {
    const props = new Map();
    const attrs = new Map();
    return {
        clientHeight,
        props, attrs,
        style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) },
        setAttribute: (k, v) => attrs.set(k, v),
        removeAttribute: (k) => attrs.delete(k),
    };
}

function fakeWindow({ innerHeight, vv }) {
    const target = new EventTarget();
    const visualViewport = Object.assign(target, vv);
    return { innerHeight, visualViewport };
}

test('visibleArea: keyboard closed, keyboard open, panned by iOS, pinch zoom, no visualViewport', async () => {
    const { visibleArea } = await mod();
    // web app on the home screen: innerHeight 874, clientHeight 812 (without the status bar)
    assert.deepEqual(visibleArea({ innerHeight: 874, clientHeight: 812, vvHeight: 874, vvTop: 0, scale: 1 }),
        { top: 0, height: 874, keyboard: false });
    assert.deepEqual(visibleArea({ innerHeight: 874, clientHeight: 812, vvHeight: 471, vvTop: 0, scale: 1 }),
        { top: 0, height: 471, keyboard: true }, 'Czech keyboard with the bar above it: 403 px');
    assert.deepEqual(visibleArea({ innerHeight: 874, clientHeight: 812, vvHeight: 471, vvTop: 350, scale: 1 }),
        { top: 350, height: 471, keyboard: true }, 'iOS panned the visible part down (7807)');
    assert.deepEqual(visibleArea({ innerHeight: 844, clientHeight: 844, vvHeight: 780, vvTop: 0, scale: 1 }),
        { top: 0, height: 780, keyboard: false }, 'Safari toolbar or a small change is not a keyboard');
    assert.equal(visibleArea({ innerHeight: 874, clientHeight: 812, vvHeight: 437, vvTop: 120, scale: 2 }), null,
        'pinch zoom: the page keeps its layout');
    assert.equal(visibleArea({ innerHeight: 874, clientHeight: 812, vvHeight: undefined, vvTop: 0, scale: 1 }), null);
});

test('watchVisibleArea: CSS variables and data-keyboard follow visualViewport resize and scroll', async () => {
    const { watchVisibleArea } = await mod();
    const root = fakeRoot(812);
    const win = fakeWindow({ innerHeight: 874, vv: { height: 874, offsetTop: 0, scale: 1 } });
    const stop = watchVisibleArea(win, root);
    assert.equal(root.props.get('--vv-top'), '0px');
    assert.equal(root.props.get('--vv-h'), '874px');
    assert.equal(root.attrs.has('data-keyboard'), false);

    win.visualViewport.height = 471;
    win.visualViewport.dispatchEvent(new Event('resize'));
    assert.equal(root.props.get('--vv-h'), '471px');
    assert.equal(root.attrs.has('data-keyboard'), true);

    win.visualViewport.offsetTop = 350;
    win.visualViewport.dispatchEvent(new Event('scroll'));
    assert.equal(root.props.get('--vv-top'), '350px');

    win.visualViewport.height = 874;
    win.visualViewport.offsetTop = 0;
    win.visualViewport.dispatchEvent(new Event('resize'));
    assert.equal(root.attrs.has('data-keyboard'), false);
    assert.equal(root.props.get('--vv-h'), '874px');

    win.visualViewport.scale = 2;
    win.visualViewport.dispatchEvent(new Event('resize'));
    assert.equal(root.props.has('--vv-h'), false, 'pinch zoom drops the variables (CSS falls back to the layout)');

    stop();
    win.visualViewport.scale = 1;
    win.visualViewport.height = 400;
    win.visualViewport.dispatchEvent(new Event('resize'));
    assert.equal(root.attrs.has('data-keyboard'), false, 'stopped');
    assert.equal(typeof watchVisibleArea({ innerHeight: 800 }, fakeRoot(800)), 'function', 'no visualViewport: no-op');
});

test('scroll lock: the page behind a sheet keeps its place and returns to it, nested locks count', async () => {
    const { createScrollLock } = await mod();
    const body = { style: {} };
    const scrolls = [];
    const win = { scrollY: 640, scrollTo: (o) => { scrolls.push(o); win.scrollY = o.top; } };
    const lock = createScrollLock(win, body);
    lock.lock();
    assert.deepEqual({ ...body.style }, { position: 'fixed', top: '-640px', left: '0px', right: '0px' });
    win.scrollY = 0; // a fixed body has nothing to scroll
    lock.lock(); // a second sheet on top
    lock.unlock();
    assert.equal(body.style.position, 'fixed', 'still one sheet open');
    lock.unlock();
    assert.deepEqual({ ...body.style }, { position: '', top: '', left: '', right: '' });
    assert.deepEqual(scrolls, [{ top: 640, left: 0, behavior: 'instant' }]);
    lock.unlock(); // extra unlock is harmless
    assert.equal(scrolls.length, 1);
});
