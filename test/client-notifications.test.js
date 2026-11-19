/**
 * Boot-time token reconcile (public/js/notifications-core.js): a user whose
 * notifications are ON but whose document holds no device token gets the
 * token registered again silently. That is the case after a 1.x ID is
 * migrated (the server does not move device tokens) and after a dead token
 * was pruned. Firebase, fetch and the browser APIs are fakes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};

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
globalThis.Notification = { permission: 'granted' };
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
globalThis.firebase = {
    initializeApp: () => ({}),
    firestore: () => ({}),
    auth: () => ({ currentUser: { uid: UID, getIdToken: async () => 'id-token' } }),
    messaging: () => ({ getToken: async () => 'fcm-token-of-this-browser', onMessage() {} }),
};

const calls = [];
let preferences = {};
globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    const body = url.startsWith('/api/fcm/preferences/') ? preferences : { success: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const CHANGES_ONLY = [{
    type: 'Class', id: 'ZL', scheduleType: 'Actual', groupFilters: ['all'],
    notificationTypes: {
        changes: { lesson_removed: true, substitution: true, room_change: true, lesson_added: false, subject_change: false },
        reminders: { next_lesson_room: false, next_lesson_teacher: false, next_lesson_subject: false },
    },
}];
const subscribes = () => calls.filter(c => c.url === '/api/fcm/subscribe');

let starts = 0;
/** One app start: a fresh module instance (the start-up preferences are read once per start). */
async function reconcile(prefs) {
    const core = await import(`../public/js/notifications-core.js?start=${++starts}`);
    const { state } = await import('../public/js/state.js');
    preferences = prefs;
    calls.length = 0;
    await core.reconcileLessonReminderToken();
    return state;
}

test('zapnutá upozornění bez tokenu na serveru (po migraci ID z 1.x): token se při startu tiše zaregistruje znovu', async () => {
    const state = await reconcile({ watchedTimetables: CHANGES_ONLY, hasTokens: false, notificationsEnabled: true });
    assert.equal(subscribes().length, 1, 'used to happen only with lesson reminders switched on');
    assert.deepEqual(subscribes()[0].body, { userId: UID, token: 'fcm-token-of-this-browser' });
    assert.equal(state.notificationsEnabled, true);
    assert.equal(state.remindersNeedAttention, false);
});

test('token na serveru je: při startu se nic neposílá', async () => {
    await reconcile({ watchedTimetables: CHANGES_ONLY, hasTokens: true, notificationsEnabled: true });
    assert.deepEqual(subscribes(), []);
});

test('vypnutá upozornění se sama znovu nezapnou', async () => {
    const state = await reconcile({ watchedTimetables: CHANGES_ONLY, hasTokens: false, notificationsEnabled: false });
    assert.deepEqual(subscribes(), []);
    assert.equal(state.notificationsEnabled, false);
});

test('bez povolení prohlížeče se token nežádá (žádný dialog)', async () => {
    globalThis.Notification = { permission: 'default' };
    try {
        await reconcile({ watchedTimetables: CHANGES_ONLY, hasTokens: false, notificationsEnabled: true });
        assert.deepEqual(subscribes(), []);
    } finally {
        globalThis.Notification = { permission: 'granted' };
    }
});

test('při startu se nastavení upozornění načte jedním požadavkem pro kontrolu tokenu i pro zvonek', async () => {
    const core = await import(`../public/js/notifications-core.js?start=${++starts}`);
    preferences = { watchedTimetables: CHANGES_ONLY, hasTokens: true, notificationsEnabled: true };
    calls.length = 0;
    const [, data] = await Promise.all([core.reconcileLessonReminderToken(), core.loadStartupNotificationPreferences()]);
    await core.loadStartupNotificationPreferences();
    assert.equal(calls.filter(c => c.url.startsWith('/api/fcm/preferences/')).length, 1);
    assert.equal(data.hasTokens, true);
    // otevření panelu se ptá serveru znovu
    await core.loadNotificationPreferences();
    assert.equal(calls.filter(c => c.url.startsWith('/api/fcm/preferences/')).length, 2);
});
