/**
 * Failed answers of /api/auth and /api/fcm/* reach the user as Czech text
 * (public/js/api-error.js): on 429 the server's own Czech message (routes/auth.js,
 * routes/fcm.js: { error, retryAfterSec }) and roughly when to try again;
 * otherwise a Czech fallback, never the English internals such as
 * "Failed to get auth token from backend". Firebase, fetch and the browser
 * APIs are fakes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.error = () => {};

const UID = 'anon-0b5f6c1e-7d3a-4c2b-9e8f-1a2b3c4d5e6f';
const store = new Map([['userId', UID]]);
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis;
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: false });
globalThis.PushManager = function PushManager() {};
globalThis.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        maxTouchPoints: 0,
        serviceWorker: {
            getRegistration: async () => ({ scope: '/' }),
            register: async () => ({ scope: '/' }),
            ready: Promise.resolve({}),
        },
    },
});
let user = { uid: UID, getIdToken: async () => 'id-token' };
globalThis.firebase = {
    initializeApp: () => ({}),
    firestore: () => ({}),
    auth: () => ({ get currentUser() { return user; }, async signInWithCustomToken() { user = { uid: UID, getIdToken: async () => 'id-token' }; } }),
    messaging: () => ({ getToken: async () => 'fcm-token-of-this-browser', onMessage() {}, deleteToken: async () => true }),
};
globalThis.setTimeout = ((orig) => (fn, ms, ...a) => orig(fn, Math.min(ms || 0, 5), ...a))(globalThis.setTimeout);

const AUTH_LIMIT = { error: 'Příliš mnoho nových přihlášení z této sítě, zkuste to později.', retryAfterSec: 120 };
const FCM_LIMIT = { error: 'Příliš mnoho změn nastavení upozornění, zkuste to později.', retryAfterSec: 300 };
let routes = {};
globalThis.fetch = async (url) => {
    const [status, body, headers = {}] = (routes[url] || routes['*'] || (() => [200, { success: true }]))();
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json', ...headers } });
};

const ENGLISH = /Failed|Server refused|backend|token/i;

test('apiError: 429 → the server\'s Czech text and when to try again; other answers → the Czech fallback', async () => {
    const { apiError } = await import('../public/js/api-error.js');
    const limited = await apiError(new Response(JSON.stringify(AUTH_LIMIT), { status: 429 }), 'Záložní text.');
    assert.equal(limited.message, 'Příliš mnoho nových přihlášení z této sítě, zkuste to později. Znovu to půjde zhruba za 2 min.');
    assert.equal(limited.status, 429);
    assert.equal(limited.retryAfterSec, 120);

    // no JSON body: Retry-After header and a Czech default
    const bare = await apiError(new Response('<html>Too Many Requests</html>', { status: 429, headers: { 'Retry-After': '30' } }), 'Záložní text.');
    assert.equal(bare.message, 'Příliš mnoho požadavků, zkuste to prosím později. Znovu to půjde zhruba za 1 min.');
    const noHint = await apiError(new Response('{}', { status: 429 }), 'Záložní text.');
    assert.equal(noHint.message, 'Příliš mnoho požadavků, zkuste to prosím později.');

    // other statuses: the server's English internals are not shown
    const failed = await apiError(new Response(JSON.stringify({ error: 'Failed to save token' }), { status: 500 }), 'Server upozornění neuložil.');
    assert.equal(failed.message, 'Server upozornění neuložil.');
    assert.equal(failed.status, 500);
});

test('429 from /api/auth: the sign-in fails with the Czech message, not "Failed to get auth token from backend"', async () => {
    const fc = await import('../public/js/firebase-client.js');
    user = null;
    routes = { '/api/auth': () => [429, AUTH_LIMIT, { 'Retry-After': '120' }] };
    await assert.rejects(fc.authenticateWithFirebase({ force: true }), (err) => {
        assert.equal(err.message, 'Příliš mnoho nových přihlášení z této sítě, zkuste to později. Znovu to půjde zhruba za 2 min.');
        assert.equal(err.status, 429);
        return true;
    });
    routes = { '/api/auth': () => [500, { error: 'Failed to generate auth token' }] };
    await assert.rejects(fc.authenticateWithFirebase({ force: true }), (err) => {
        assert.ok(!ENGLISH.test(err.message), err.message);
        assert.match(err.message, /přihlásit/);
        return true;
    });
    user = { uid: UID, getIdToken: async () => 'id-token' };
});

test('429 from /api/fcm/*: enabling, disabling and saving preferences fail with the Czech message', async () => {
    const core = await import('../public/js/notifications-core.js');
    routes = { '*': () => [429, FCM_LIMIT, { 'Retry-After': '300' }] };
    const expected = 'Příliš mnoho změn nastavení upozornění, zkuste to později. Znovu to půjde zhruba za 5 min.';
    // the toast of "Zapnout upozornění" shows error.message
    await assert.rejects(core.requestNotificationPermission(), (err) => { assert.equal(err.message, expected); return true; });
    await assert.rejects(core.disableNotifications(), (err) => { assert.equal(err.message, expected); return true; });
    await assert.rejects(core.saveWatchedTimetables([]), (err) => { assert.equal(err.message, expected); assert.equal(err.status, 429); return true; });

    routes = { '*': () => [503, '<html>Service Unavailable</html>'] };
    for (const call of [() => core.requestNotificationPermission(), () => core.disableNotifications(), () => core.saveWatchedTimetables([])]) {
        await assert.rejects(call(), (err) => { assert.ok(!ENGLISH.test(err.message), err.message); assert.equal(err.status, 503); return true; });
    }
});
