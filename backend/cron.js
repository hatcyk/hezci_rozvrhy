/**
 * Job runner bookkeeping (contract S4) + the in-process prefetch runner.
 *
 * Scheduling lives outside (GitHub Actions / cron-job.org / host crontab).
 * Every job - prefetch, notify, reminders, cleanup - records one `runs/{auto}`
 * document, and prefetch also maintains `system/health`, which /api/status
 * turns into "how old is the data".
 *
 * Bookkeeping is best effort: a Firestore hiccup while logging must never fail
 * the job itself.
 */

const { initializeFirebaseAdmin, getFirestore } = require('./firebase-admin-init');
const { getPragueTimeInfo } = require('./timezone-manager');

const RUNS_COLLECTION = 'runs';
const HEALTH_DOC = ['system', 'health'];
const LEGACY_STATUS_DOC = ['system', 'prefetchStatus'];

const RUN_STATUSES = new Set(['ok', 'guard_no_definitions', 'guard_no_lessons', 'login_failed', 'network', 'error']);

// /api/status: data counts as fresh when the last successful prefetch is
// younger than this. School day 6-18 h Prague time is when changes matter.
const MAX_AGE_SCHOOL_HOURS_MIN = 120;
const MAX_AGE_OTHERWISE_MIN = 12 * 60;

const MAX_ERROR_LENGTH = 500;

let isRunning = false;

// ───────────────────────────────────────────────────────────────────────────
// Classification
// ───────────────────────────────────────────────────────────────────────────

/**
 * Where the run came from. GitHub sets GITHUB_EVENT_NAME; on a server the
 * crontab sets RUN_TRIGGER=cron. Without either, a terminal means a person.
 * @returns {'schedule'|'dispatch'|'manual'|'cron'|'http'}
 */
function getTrigger(env = process.env, isTTY = !!(process.stdout && process.stdout.isTTY)) {
    const explicit = env.RUN_TRIGGER;
    if (['schedule', 'dispatch', 'manual', 'cron', 'http'].includes(explicit)) return explicit;

    const event = env.GITHUB_EVENT_NAME;
    if (event === 'schedule') return 'schedule';
    if (event === 'workflow_dispatch' || event === 'repository_dispatch') return 'dispatch';
    if (event) return 'manual';

    return isTTY ? 'manual' : 'cron';
}

/**
 * Status of a thrown prefetch error.
 */
function classifyError(error) {
    const message = String((error && error.message) || error || '');
    if (/login failed/i.test(message)) return 'login_failed';
    if (/timeout|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(message)) return 'network';
    return 'error';
}

/**
 * Status of a prefetchAllData() result. New results carry `status`; older
 * ones only `success` + an error text, so fall back to those.
 */
function classifyPrefetchResult(result) {
    if (!result || typeof result !== 'object') return 'error';
    if (typeof result.status === 'string' && RUN_STATUSES.has(result.status)) return result.status;
    if (result.success === true) return 'ok';
    const message = String(result.error || '');
    if (/definitions/i.test(message)) return 'guard_no_definitions';
    if (/lessons/i.test(message)) return 'guard_no_lessons';
    if (result.success === undefined && result.definitionsCount > 0) return 'ok';
    return 'error';
}

/**
 * Numeric counters of a prefetch result (requests, successCount, writes, ...),
 * from `result.stats` when present, otherwise from the result itself.
 */
function prefetchCounts(result) {
    const source = (result && typeof result.stats === 'object' && result.stats) || result || {};
    const counts = {};
    for (const [key, value] of Object.entries(source)) {
        if (key === 'duration' || key === 'durationMs') continue;
        if (typeof value === 'number' && Number.isFinite(value)) counts[key] = value;
    }
    return counts;
}

function truncateError(error) {
    if (!error) return null;
    const text = typeof error === 'string' ? error : (error.message || String(error));
    return text.slice(0, MAX_ERROR_LENGTH);
}

// ───────────────────────────────────────────────────────────────────────────
// runs/{auto} and system/health
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build the runs/{auto} document.
 */
function buildRunDoc({ job, trigger, startedAt, finishedAt = new Date(), status, counts = {}, error = null }) {
    const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
    const end = finishedAt instanceof Date ? finishedAt : new Date(finishedAt);
    return {
        job,
        trigger: trigger || getTrigger(),
        startedAt: start.toISOString(),
        finishedAt: end.toISOString(),
        durationMs: end.getTime() - start.getTime(),
        status: RUN_STATUSES.has(status) ? status : 'error',
        counts,
        error: truncateError(error),
    };
}

/**
 * Next system/health from the previous one and a finished prefetch run.
 * lastSuccessAt moves ONLY on a real success: the old code stamped
 * lastSuccess on every run that did not throw, guard exits included, so the
 * status page showed fresh data while nothing had been downloaded.
 */
function nextHealth(previous, run) {
    const prev = previous || {};
    const ok = run.status === 'ok';
    return {
        lastRunAt: run.finishedAt,
        lastSuccessAt: ok ? run.finishedAt : (prev.lastSuccessAt || null),
        lastStatus: run.status,
        consecutiveFailures: ok ? 0 : (Number(prev.consecutiveFailures) || 0) + 1,
        lastError: ok ? null : run.error,
        updatedAt: new Date().toISOString(),
    };
}

/**
 * Store one finished run. Never throws.
 * @returns {Promise<Object>} the run document
 */
async function recordRun(input, { db = null } = {}) {
    const run = buildRunDoc(input);
    try {
        const firestore = db || getFirestore();
        await firestore.collection(RUNS_COLLECTION).add(run);

        if (run.job === 'prefetch') {
            const healthRef = firestore.collection(HEALTH_DOC[0]).doc(HEALTH_DOC[1]);
            // Transaction: consecutiveFailures is read-modify-write.
            await firestore.runTransaction(async (tx) => {
                const snap = await tx.get(healthRef);
                tx.set(healthRef, nextHealth(snap.exists ? snap.data() : null, run));
            });
        }
    } catch (error) {
        console.error(`⚠️  Failed to record ${run.job} run:`, error.message);
    }
    return run;
}

/**
 * Run a job and record it: 'ok' when `work` resolves (or the status it
 * reports, for jobs that swallow their own errors), 'error' when it throws.
 * `work` returns { counts, status?, error?, ...anything }; the whole value is
 * passed through. Errors are re-thrown after recording.
 */
async function runJob(job, work, { trigger } = {}) {
    const startedAt = new Date();
    try {
        const outcome = (await work()) || {};
        await recordRun({
            job,
            trigger,
            startedAt,
            status: outcome.status || 'ok',
            counts: outcome.counts || {},
            error: outcome.error || null,
        });
        return outcome;
    } catch (error) {
        await recordRun({ job, trigger, startedAt, status: 'error', error });
        throw error;
    }
}

/**
 * { status: 'error', error } when any cleanup helper reported a failure,
 * otherwise {} - for spreading into a runJob outcome.
 */
function failedCleanup(results) {
    const errors = results
        .filter(r => r && (r.error || r.errors > 0))
        .map(r => r.error || `${r.errors} deletions failed`);
    return errors.length ? { status: 'error', error: errors.join('; ') } : {};
}

/**
 * Delete runs older than `daysToKeep` (TTL policies need billing enabled, so
 * the nightly cleanup does it).
 */
async function cleanupOldRuns(daysToKeep = 30, { db = null, now = new Date() } = {}) {
    try {
        const firestore = db || getFirestore();
        const cutoffISO = new Date(now.getTime() - daysToKeep * 24 * 3600 * 1000).toISOString();
        const snapshot = await firestore.collection(RUNS_COLLECTION).where('startedAt', '<', cutoffISO).get();
        if (snapshot.empty) return { deleted: 0, errors: 0 };

        let deleted = 0;
        let errors = 0;
        for (let i = 0; i < snapshot.docs.length; i += 500) {
            const chunk = snapshot.docs.slice(i, i + 500);
            const batch = firestore.batch();
            chunk.forEach(doc => batch.delete(doc.ref));
            try {
                await batch.commit();
                deleted += chunk.length;
            } catch (error) {
                errors += chunk.length;
                console.error('   Error deleting runs batch:', error.message);
            }
        }
        console.log(`🧹 [CLEANUP RUNS] ${deleted} deleted, ${errors} errors (before ${cutoffISO})`);
        return { deleted, errors };
    } catch (error) {
        console.error('❌ [CLEANUP RUNS ERROR]', error.message);
        return { deleted: 0, errors: 1, error: error.message };
    }
}

// ───────────────────────────────────────────────────────────────────────────
// /api/status
// ───────────────────────────────────────────────────────────────────────────

/**
 * Age limit that applies at `now`: strict on school days 6-18 h Prague time,
 * relaxed at night and at weekends when prefetch may run hourly.
 */
function maxDataAgeMinutes(now = new Date()) {
    const info = getPragueTimeInfo(now);
    const schoolHours = info.dayIndex >= 0 && info.hour >= 6 && info.hour < 18;
    return schoolHours ? MAX_AGE_SCHOOL_HOURS_MIN : MAX_AGE_OTHERWISE_MIN;
}

/**
 * Public status from system/health (or, until the first new run, from the
 * legacy system/prefetchStatus document).
 */
function computeStatus(health, now = new Date(), legacy = null) {
    const h = health || {};
    const lastSuccessAt = h.lastSuccessAt || (legacy && legacy.isHealthy && legacy.lastSuccess) || null;
    const lastSuccessMs = lastSuccessAt ? Date.parse(lastSuccessAt) : NaN;
    const dataAgeMin = Number.isFinite(lastSuccessMs)
        ? Math.max(0, Math.floor((now.getTime() - lastSuccessMs) / 60000))
        : null;
    const maxAgeMin = maxDataAgeMinutes(now);
    const isHealthy = dataAgeMin !== null && dataAgeMin < maxAgeMin;

    const lastError = h.lastError !== undefined ? h.lastError : (legacy ? legacy.error || null : null);

    return {
        isHealthy,
        lastSuccessAt: Number.isFinite(lastSuccessMs) ? new Date(lastSuccessMs).toISOString() : null,
        dataAgeMin,
        maxAgeMin,
        lastRunAt: h.lastRunAt || (legacy && legacy.lastRun) || null,
        lastStatus: h.lastStatus || null,
        consecutiveFailures: Number(h.consecutiveFailures) || 0,
        lastError: lastError || null,
        // Kept for clients built before S4.
        error: isHealthy ? null : (lastError || (dataAgeMin === null ? 'No successful prefetch recorded' : `Data is ${dataAgeMin} min old`)),
        prefetchInProgress: isRunning,
    };
}

async function getStatus({ db = null, now = new Date() } = {}) {
    const firestore = db || getFirestore();
    const [healthSnap, legacySnap] = await Promise.all([
        firestore.collection(HEALTH_DOC[0]).doc(HEALTH_DOC[1]).get(),
        firestore.collection(LEGACY_STATUS_DOC[0]).doc(LEGACY_STATUS_DOC[1]).get(),
    ]);
    return computeStatus(
        healthSnap.exists ? healthSnap.data() : null,
        now,
        legacySnap.exists ? legacySnap.data() : null
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Prefetch run (shared by scripts/run-prefetch.js and /api/cron/prefetch)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Run one prefetch and record it.
 * @returns {Promise<{run: Object, result: Object|null, error: Error|null}>}
 */
async function runPrefetchJob({ trigger } = {}) {
    // Required lazily: the parser/HTTP stack is only needed for this job.
    const { prefetchAllData } = require('./prefetch');
    const startedAt = new Date();
    let result = null;
    let error = null;
    let status;

    try {
        result = await prefetchAllData();
        status = classifyPrefetchResult(result);
    } catch (err) {
        error = err;
        status = classifyError(err);
    }

    const run = await recordRun({
        job: 'prefetch',
        trigger,
        startedAt,
        status,
        counts: prefetchCounts(result),
        error: error || (status !== 'ok' && result ? result.error : null),
    });
    return { run, result, error };
}

/**
 * In-process prefetch (HTTP cron route). Skips when one is already running in
 * this process; across processes the GitHub `concurrency` group serializes.
 */
async function triggerManualPrefetch({ trigger = 'http' } = {}) {
    if (isRunning) {
        console.log('⏭️  Prefetch already running, skipping this run');
        return null;
    }

    initializeFirebaseAdmin();
    isRunning = true;
    try {
        const outcome = await runPrefetchJob({ trigger });
        if (outcome.run.status === 'ok') {
            // Same as the GitHub workflow: send the new change notifications now.
            const { processPendingChanges } = require('./fcm');
            await processPendingChanges();
        }
        return outcome;
    } finally {
        isRunning = false;
    }
}

module.exports = {
    RUN_STATUSES,
    MAX_AGE_SCHOOL_HOURS_MIN,
    MAX_AGE_OTHERWISE_MIN,
    getTrigger,
    classifyError,
    classifyPrefetchResult,
    prefetchCounts,
    buildRunDoc,
    nextHealth,
    recordRun,
    runJob,
    failedCleanup,
    cleanupOldRuns,
    maxDataAgeMinutes,
    computeStatus,
    getStatus,
    runPrefetchJob,
    triggerManualPrefetch,
};
