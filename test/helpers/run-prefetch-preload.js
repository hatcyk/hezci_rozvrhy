/**
 * Preload (node -r) for test/run-prefetch.test.js: lets scripts/run-prefetch.js
 * run as a real process without Firebase, Bakaláři or a .env file.
 *
 * First of all it cuts the network off (anything but localhost throws), then it
 * puts stand-ins for dotenv, Firebase Admin and the prefetch job into
 * require.cache. The outcome of the "run" comes from FAKE_RUN_STATUS.
 *
 * Not a test file itself (no .test.js suffix), so `npm test` does not run it.
 */
const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const LOCAL = new Set(['127.0.0.1', 'localhost', '::1']);
const refuse = (what) => { throw new Error(`network blocked in tests: ${what}`); };
const hostOf = (args) => {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (first && typeof first === 'object') return first.path ? 'localhost' : (first.host || first.hostname || 'localhost');
    if (typeof first === 'string' && !/^\d+$/.test(first)) {
        try { return new URL(first).hostname; } catch { return 'localhost'; } // a unix socket path
    }
    return typeof args[1] === 'string' ? args[1] : 'localhost';
};
const guard = (object, name) => {
    const original = object[name];
    object[name] = function (...args) {
        const host = String(hostOf(args)).replace(/^\[|\]$/g, '');
        if (!LOCAL.has(host)) refuse(`${name} ${host}`);
        return original.apply(this, args);
    };
};
guard(net.Socket.prototype, 'connect');
guard(tls, 'connect');
for (const mod of [http, https]) for (const name of ['request', 'get']) guard(mod, name);
globalThis.fetch = () => refuse('fetch');

const ROOT = path.join(__dirname, '..', '..');
const stub = (file, exportsObj) => {
    require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
};
stub(require.resolve('dotenv'), { config: () => ({}) });
stub(path.join(ROOT, 'backend', 'firebase-admin-init.js'), {
    initializeFirebaseAdmin: () => {
        if (process.env.FAKE_INIT_FAILS) throw new Error('FIREBASE_SERVICE_ACCOUNT missing (synthetic)');
        return {};
    },
});
stub(path.join(ROOT, 'backend', 'cron.js'), {
    runPrefetchJob: async () => {
        const status = process.env.FAKE_RUN_STATUS;
        if (status === 'throws') throw new Error('unexpected (synthetic)');
        return {
            run: { status, trigger: 'manual', durationMs: 1200, error: status === 'ok' ? null : `${status} (synthetic)` },
            result: { totalRequests: 8, successCount: 2, errorCount: 6, definitionsCount: 4 },
            error: null,
        };
    },
});
