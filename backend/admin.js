/**
 * Admin data layer (contract S5): read-only overviews of the operational
 * records (system/health, runs, changes), aggregated statistics, the audit
 * trail and the "run prefetch now" GitHub dispatch.
 *
 * Everything here works on a Firestore handle passed in (tests use the
 * in-memory fake) and returns plain JSON for routes/admin.js. No function
 * returns anything that identifies a user: statistics are counts only.
 */

const crypto = require('crypto');
const { getFirestore } = require('./firebase-admin-init');
const { getStatus } = require('./cron');

const JOBS = ['prefetch', 'notify', 'reminders', 'cleanup'];
const TIMETABLE_TYPES = ['Class', 'Teacher', 'Room'];

const RUNS_MAX_LIMIT = 100;
const CHANGES_MAX_LIMIT = 100;
const AUDIT_MAX_LIMIT = 200;
const INTERVAL_MAX_DAYS = 14;
const INTERVAL_MAX_RUNS = 3000;
// Without the composite index (job, startedAt) we read the newest runs of all
// jobs and filter in memory. Reminders run every minute, so this many docs
// cover roughly half a school day - enough to keep the page usable until the
// index is deployed, and it is reported as `indexMissing`.
const FALLBACK_SCAN = 500;

const AUDIT_COLLECTION = 'audit';
const AUDIT_KEEP_DAYS = 90;
const DISPATCH_DOC = ['system', 'adminDispatch'];
// One manual prefetch per 10 minutes: a run takes a few minutes and downloads
// ~220 pages from the school's Bakaláři server; repeated clicks must not
// multiply that load.
const DISPATCH_MIN_INTERVAL_MS = 10 * 60 * 1000;
const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const GITHUB_TIMEOUT_MS = 10000;

const clampInt = (value, fallback, min, max) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};

/** Firestore error that means "this query needs a composite index". */
function isMissingIndex(error) {
    if (!error) return false;
    return error.code === 9 || error.code === 'failed-precondition'
        || /FAILED_PRECONDITION|requires an index/i.test(String(error.message || ''));
}

const docToObject = (doc) => ({ id: doc.id, ...doc.data() });

// ───────────────────────────────────────────────────────────────────────────
// runs
// ───────────────────────────────────────────────────────────────────────────

/**
 * Newest runs, optionally of one job and since a time.
 * Uses the composite index runs(job ASC, startedAt DESC) from
 * firestore.indexes.json; until it exists, falls back to scanning the newest
 * runs and says so (`indexMissing: true`).
 * @returns {Promise<{ runs: Array, indexMissing: boolean, truncated: boolean }>}
 */
async function queryRuns({ db, job = null, limit = RUNS_MAX_LIMIT, since = null }) {
    const base = () => {
        let q = db.collection('runs');
        if (since) q = q.where('startedAt', '>=', since);
        return q;
    };
    if (!job) {
        const snap = await base().orderBy('startedAt', 'desc').limit(limit).get();
        return { runs: snap.docs.map(docToObject), indexMissing: false, truncated: snap.docs.length >= limit };
    }
    try {
        const snap = await base().where('job', '==', job).orderBy('startedAt', 'desc').limit(limit).get();
        return { runs: snap.docs.map(docToObject), indexMissing: false, truncated: snap.docs.length >= limit };
    } catch (error) {
        if (!isMissingIndex(error)) throw error;
        const scan = Math.max(FALLBACK_SCAN, limit);
        const snap = await base().orderBy('startedAt', 'desc').limit(scan).get();
        const runs = snap.docs.map(docToObject).filter(r => r.job === job).slice(0, limit);
        return { runs, indexMissing: true, truncated: snap.docs.length >= scan || runs.length >= limit };
    }
}

async function getLastRuns(db) {
    const lastRuns = {};
    let indexMissing = false;
    for (const job of JOBS) {
        const result = await queryRuns({ db, job, limit: 1 });
        lastRuns[job] = result.runs[0] || null;
        indexMissing = indexMissing || result.indexMissing;
    }
    return { lastRuns, indexMissing };
}

/**
 * GET /api/admin/health: public status (S4) + the raw health document + the
 * last run of every job.
 */
async function getHealthOverview({ db = getFirestore(), now = new Date() } = {}) {
    const [status, healthSnap, last] = await Promise.all([
        getStatus({ db, now }),
        db.collection('system').doc('health').get(),
        getLastRuns(db),
    ]);
    return {
        now: now.toISOString(),
        status,
        health: healthSnap.exists ? healthSnap.data() : null,
        lastRuns: last.lastRuns,
        indexMissing: last.indexMissing,
    };
}

async function listRuns({ db = getFirestore(), job = null, limit } = {}) {
    if (job !== null && !JOBS.includes(job)) {
        const error = new Error(`Unknown job (allowed: ${JOBS.join(', ')})`);
        error.status = 400;
        throw error;
    }
    const n = clampInt(limit, RUNS_MAX_LIMIT, 1, RUNS_MAX_LIMIT);
    const { runs, indexMissing } = await queryRuns({ db, job, limit: n });
    return { job, limit: n, runs, indexMissing };
}

const quantile = (sorted, q) => {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/**
 * Gaps between consecutive runs (minutes), for the "how regular is the
 * scheduler" chart: GitHub's own cron is best effort, cron-job.org dispatch
 * should give ~15 min on school days.
 * @param {Array<{startedAt: string}>} runs - ascending by startedAt
 */
function intervalStats(runs) {
    const gaps = [];
    for (let i = 1; i < runs.length; i++) {
        const a = Date.parse(runs[i - 1].startedAt);
        const b = Date.parse(runs[i].startedAt);
        if (Number.isFinite(a) && Number.isFinite(b)) gaps.push({ from: runs[i - 1].startedAt, to: runs[i].startedAt, minutes: (b - a) / 60000 });
    }
    const sorted = gaps.map(g => g.minutes).sort((x, y) => x - y);
    const longest = gaps.reduce((best, g) => (!best || g.minutes > best.minutes ? g : best), null);
    return {
        count: gaps.length,
        medianMin: round1(quantile(sorted, 0.5)),
        p95Min: round1(quantile(sorted, 0.95)),
        maxMin: round1(sorted.length ? sorted[sorted.length - 1] : null),
        longestGap: longest ? { from: longest.from, to: longest.to, minutes: round1(longest.minutes) } : null,
    };
}

/**
 * GET /api/admin/runs/intervals?days=7: prefetch runs of the last N days,
 * reduced to the fields the chart needs, plus gap statistics.
 */
async function getPrefetchIntervals({ db = getFirestore(), now = new Date(), days } = {}) {
    const d = clampInt(days, 7, 1, INTERVAL_MAX_DAYS);
    const since = new Date(now.getTime() - d * 24 * 3600 * 1000).toISOString();
    const { runs, indexMissing, truncated } = await queryRuns({ db, job: 'prefetch', limit: INTERVAL_MAX_RUNS, since });
    const points = runs
        .map(r => ({ startedAt: r.startedAt, trigger: r.trigger || null, status: r.status || null, durationMs: r.durationMs ?? null }))
        .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
    return { days: d, since, now: now.toISOString(), runs: points, stats: intervalStats(points), indexMissing, truncated };
}

// ───────────────────────────────────────────────────────────────────────────
// changes
// ───────────────────────────────────────────────────────────────────────────

function deliveryState(data) {
    if (!data.sent) return 'pending';
    if (data.sentToUsers === undefined) return 'sending';
    if (!data.sentToUsers) return 'no_watchers';
    return 'sent';
}

/**
 * GET /api/admin/changes: detected change documents with their delivery
 * state. Timetable data only (public on Bakaláři), no user data.
 */
async function listChanges({ db = getFirestore(), limit } = {}) {
    const n = clampInt(limit, 50, 1, CHANGES_MAX_LIMIT);
    const snap = await db.collection('changes').orderBy('timestamp', 'desc').limit(n).get();
    const items = snap.docs.map(doc => {
        const data = doc.data() || {};
        const changes = Array.isArray(data.changes) ? data.changes : [];
        const types = {};
        for (const c of changes) types[c.type || 'unknown'] = (types[c.type || 'unknown'] || 0) + 1;
        return {
            id: doc.id,
            timetable: data.timetable || null,
            weekStart: data.weekStart ?? null,
            timestamp: data.timestamp || null,
            changeCount: changes.length,
            types,
            preview: changes.slice(0, 3).map(c => ({
                day: c.day ?? null, hour: c.hour ?? null, type: c.type || null,
                description: String(c.description || '').slice(0, 200),
            })),
            sent: !!data.sent,
            sentAt: data.sentAt || null,
            sentToUsers: data.sentToUsers ?? null,
            sentToDevices: data.sentToDevices ?? null,
            delivery: deliveryState(data),
        };
    });
    return { limit: n, items };
}

// ───────────────────────────────────────────────────────────────────────────
// stats (aggregated counts only)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Run one statistic; a failure (e.g. missing index) makes only that value null.
 */
async function safeStat(fn, problems, label) {
    try {
        return await fn();
    } catch (error) {
        problems.push({ stat: label, indexMissing: isMissingIndex(error), error: String(error.message || error).slice(0, 300) });
        return null;
    }
}

/**
 * GET /api/admin/stats. Every number is a server-side Firestore aggregation
 * (count() / sum()), billed per 1000 index entries instead of per document,
 * and nothing but counts leaves the server.
 */
async function getStats({ db = getFirestore(), now = new Date(), days = 7 } = {}) {
    // Loaded lazily: only this endpoint needs it.
    const { AggregateField } = require('firebase-admin/firestore');
    const users = db.collection('users');
    const count = async (q) => (await q.count().get()).data().count;
    const since = new Date(now.getTime() - days * 24 * 3600 * 1000).toISOString();
    const problems = [];

    const jobTotals = async (job, field) => {
        const snap = await db.collection('runs')
            .where('job', '==', job)
            .where('startedAt', '>=', since)
            .orderBy('startedAt', 'desc')
            .aggregate({ runs: AggregateField.count(), total: AggregateField.sum(field) })
            .get();
        return snap.data();
    };

    const watchingByType = {};
    for (const type of TIMETABLE_TYPES) {
        watchingByType[type] = await safeStat(() => count(users.where('watchedTypes', 'array-contains', type)), problems, `watching_${type}`);
    }

    return {
        generatedAt: now.toISOString(),
        days,
        since,
        users: {
            // Browsers (anonymous identities) that turned push notifications on.
            pushEnabled: await safeStat(() => count(users.where('notificationsEnabled', '==', true)), problems, 'pushEnabled'),
            withReminders: await safeStat(() => count(users.where('hasReminders', '==', true)), problems, 'withReminders'),
            // Users watching at least one timetable of the type (watchedTypes index, fcm.js).
            watchingByType,
        },
        lastDays: {
            changeNotifications: await safeStat(() => jobTotals('notify', 'counts.sent'), problems, 'notify'),
            reminders: await safeStat(() => jobTotals('reminders', 'counts.sent'), problems, 'reminders'),
            prefetch: await safeStat(() => jobTotals('prefetch', 'counts.changesDetected'), problems, 'prefetch'),
        },
        problems,
    };
}

// ───────────────────────────────────────────────────────────────────────────
// audit
// ───────────────────────────────────────────────────────────────────────────

/**
 * Keyed hash of the client IP: lets the audit tell "same address as before"
 * apart without storing the address. A plain SHA-256 of an IPv4 address can
 * be reversed by trying all 2^32 of them, the HMAC key (derived from
 * ADMIN_SECRET) prevents that.
 */
function hashIp(ip, secret) {
    if (!ip || !secret) return null;
    return crypto.createHmac('sha256', `audit-ip:${secret}`).update(String(ip)).digest('hex').slice(0, 16);
}

/**
 * Append one audit record. Never throws (the admin action itself already
 * happened or was refused; losing a log line must not change the answer).
 */
async function writeAudit({ db = getFirestore(), action, target = null, details = null, ip = null, secret = null, now = new Date() }) {
    const record = {
        at: now.toISOString(),
        action: String(action),
        target: target == null ? null : String(target).slice(0, 200),
        details: details || null,
    };
    const ipHash = hashIp(ip, secret);
    if (ipHash) record.ipHash = ipHash;
    try {
        await db.collection(AUDIT_COLLECTION).add(record);
    } catch (error) {
        console.error('⚠️  Failed to write audit record:', error.message);
    }
    return record;
}

async function listAudit({ db = getFirestore(), limit } = {}) {
    const n = clampInt(limit, 50, 1, AUDIT_MAX_LIMIT);
    const snap = await db.collection(AUDIT_COLLECTION).orderBy('at', 'desc').limit(n).get();
    return { limit: n, items: snap.docs.map(docToObject) };
}

/** Delete audit records older than `daysToKeep` (run by the nightly cleanup). */
async function cleanupOldAudit(daysToKeep = AUDIT_KEEP_DAYS, { db = null, now = new Date() } = {}) {
    try {
        const firestore = db || getFirestore();
        const cutoff = new Date(now.getTime() - daysToKeep * 24 * 3600 * 1000).toISOString();
        const snap = await firestore.collection(AUDIT_COLLECTION).where('at', '<', cutoff).get();
        let deleted = 0;
        for (let i = 0; i < snap.docs.length; i += 500) {
            const batch = firestore.batch();
            snap.docs.slice(i, i + 500).forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            deleted += Math.min(500, snap.docs.length - i);
        }
        return { deleted, errors: 0 };
    } catch (error) {
        console.error('❌ [CLEANUP AUDIT ERROR]', error.message);
        return { deleted: 0, errors: 1, error: error.message };
    }
}

// ───────────────────────────────────────────────────────────────────────────
// prefetch dispatch (GitHub Actions workflow_dispatch)
// ───────────────────────────────────────────────────────────────────────────

const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const WORKFLOW_RE = /^[A-Za-z0-9._-]{1,100}\.ya?ml$/;

function dispatchConfig(env = process.env) {
    const config = {
        token: env.GITHUB_DISPATCH_TOKEN || '',
        repo: env.GITHUB_REPO || '',
        ref: env.GITHUB_DISPATCH_REF || 'main',
        workflow: env.GITHUB_DISPATCH_WORKFLOW || 'prefetch.yml',
    };
    const missing = [];
    if (!config.token) missing.push('GITHUB_DISPATCH_TOKEN');
    if (!REPO_RE.test(config.repo)) missing.push('GITHUB_REPO');
    if (!WORKFLOW_RE.test(config.workflow)) missing.push('GITHUB_DISPATCH_WORKFLOW');
    return { ...config, missing };
}

/**
 * Claim the dispatch slot: at most one dispatch per DISPATCH_MIN_INTERVAL_MS,
 * kept in Firestore because serverless instances share no memory.
 * @returns {Promise<{ ok: boolean, previous: string|null, retryAfterSec?: number }>}
 */
async function claimDispatchSlot(db, now, minIntervalMs) {
    const ref = db.collection(DISPATCH_DOC[0]).doc(DISPATCH_DOC[1]);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const previous = snap.exists ? snap.data().lastDispatchAt || null : null;
        const lastMs = previous ? Date.parse(previous) : NaN;
        if (Number.isFinite(lastMs) && now.getTime() - lastMs < minIntervalMs) {
            return { ok: false, previous, retryAfterSec: Math.ceil((minIntervalMs - (now.getTime() - lastMs)) / 1000) };
        }
        tx.set(ref, { lastDispatchAt: now.toISOString() }, { merge: true });
        return { ok: true, previous };
    });
}

/**
 * Start prefetch.yml now via the GitHub REST API
 * (POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches,
 * body { ref }). API version 2026-03-10 answers 200 with workflow_run_id,
 * run_url and html_url; older versions answer 204 without a body - both are
 * success. The token needs the fine-grained permission "Actions: write".
 * @returns {Promise<{ result: 'ok'|'rate_limited'|'not_configured'|'github_error', httpStatus: number, ... }>}
 */
async function dispatchPrefetch({
    db = getFirestore(),
    now = new Date(),
    env = process.env,
    fetchImpl = globalThis.fetch,
    minIntervalMs = DISPATCH_MIN_INTERVAL_MS,
} = {}) {
    const config = dispatchConfig(env);
    if (config.missing.length) {
        return { result: 'not_configured', httpStatus: 503, missing: config.missing };
    }

    const slot = await claimDispatchSlot(db, now, minIntervalMs);
    if (!slot.ok) {
        return { result: 'rate_limited', httpStatus: 429, retryAfterSec: slot.retryAfterSec, lastDispatchAt: slot.previous };
    }

    const url = `${GITHUB_API}/repos/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`;
    let response;
    let body = null;
    try {
        response = await fetchImpl(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': GITHUB_API_VERSION,
                'User-Agent': 'lepsi-rozvrh-admin',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ref: config.ref }),
            signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
        });
        const text = await response.text();
        if (text) {
            try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 300) }; }
        }
    } catch (error) {
        await releaseDispatchSlot(db, slot.previous);
        return { result: 'github_error', httpStatus: 502, githubStatus: null, message: String(error.message || error).slice(0, 300) };
    }

    if (response.status === 200 || response.status === 204) {
        return {
            result: 'ok',
            httpStatus: 200,
            githubStatus: response.status,
            ref: config.ref,
            workflowRunId: body && body.workflow_run_id ? body.workflow_run_id : null,
            htmlUrl: body && typeof body.html_url === 'string' ? body.html_url : null,
        };
    }

    // No run was started, so the slot is given back for a corrected retry.
    await releaseDispatchSlot(db, slot.previous);
    return {
        result: 'github_error',
        httpStatus: 502,
        githubStatus: response.status,
        message: String((body && body.message) || '').slice(0, 300),
    };
}

async function releaseDispatchSlot(db, previous) {
    try {
        await db.collection(DISPATCH_DOC[0]).doc(DISPATCH_DOC[1]).set({ lastDispatchAt: previous || null }, { merge: true });
    } catch (error) {
        console.error('⚠️  Failed to release the dispatch slot:', error.message);
    }
}

// ───────────────────────────────────────────────────────────────────────────
// brute-force limiter for the admin secret
// ───────────────────────────────────────────────────────────────────────────

/**
 * Failed attempts per client (IP) in memory: after `max` failures within
 * `windowMs` the client is locked out for `lockMs`. Per process only (each
 * serverless instance has its own), which still turns guessing into a slow
 * trickle; the real protection is a long random ADMIN_SECRET.
 */
class AttemptLimiter {
    constructor({ max = 5, windowMs = 15 * 60 * 1000, lockMs = 15 * 60 * 1000, now = () => Date.now(), maxEntries = 10000 } = {}) {
        Object.assign(this, { max, windowMs, lockMs, now, maxEntries });
        this.entries = new Map();
    }

    status(key) {
        const entry = this.entries.get(key);
        const t = this.now();
        if (entry && entry.lockedUntil > t) return { locked: true, retryAfterSec: Math.ceil((entry.lockedUntil - t) / 1000) };
        return { locked: false, retryAfterSec: 0 };
    }

    /** Record a failure. `first` = first failure of a fresh window (to log once). */
    fail(key) {
        const t = this.now();
        let entry = this.entries.get(key);
        if (!entry || t - entry.windowStart > this.windowMs || (entry.lockedUntil && entry.lockedUntil <= t)) {
            entry = { windowStart: t, failures: 0, lockedUntil: 0 };
        }
        entry.failures += 1;
        const first = entry.failures === 1;
        let lockedNow = false;
        if (entry.failures >= this.max) {
            entry.lockedUntil = t + this.lockMs;
            lockedNow = entry.failures === this.max;
        }
        this.entries.set(key, entry);
        if (this.entries.size > this.maxEntries) this.prune();
        return { first, lockedNow, failures: entry.failures, ...this.status(key) };
    }

    reset(key) {
        this.entries.delete(key);
    }

    prune() {
        const t = this.now();
        for (const [key, entry] of this.entries) {
            if (entry.lockedUntil <= t && t - entry.windowStart > this.windowMs) this.entries.delete(key);
        }
        // Still too many (attack from many addresses): drop the oldest.
        while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    }
}

module.exports = {
    JOBS,
    RUNS_MAX_LIMIT,
    DISPATCH_MIN_INTERVAL_MS,
    AUDIT_KEEP_DAYS,
    GITHUB_API_VERSION,
    isMissingIndex,
    queryRuns,
    getHealthOverview,
    listRuns,
    intervalStats,
    getPrefetchIntervals,
    listChanges,
    getStats,
    hashIp,
    writeAudit,
    listAudit,
    cleanupOldAudit,
    dispatchConfig,
    dispatchPrefetch,
    AttemptLimiter,
};
