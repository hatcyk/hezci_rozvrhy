#!/usr/bin/env node

/**
 * Standalone prefetch run (GitHub Actions, host crontab, or by hand).
 *
 * Records the run in `runs` and updates `system/health` (contract S4);
 * lastSuccessAt moves only when the prefetch really succeeded.
 *
 * Exit code: 0 for success and for the expected "Bakaláři unavailable" outcomes
 * (guard exits, login/network failures) - those are reported through
 * /api/status?strict=1 instead of a failure e-mail every 15 minutes;
 * 1 for unexpected errors (bugs).
 */

require('dotenv').config();
const { initializeFirebaseAdmin } = require('../backend/firebase-admin-init');
const { runPrefetchJob } = require('../backend/cron');

const EXPECTED_FAILURES = new Set(['guard_no_definitions', 'guard_no_lessons', 'login_failed', 'network']);

async function main() {
    console.log('🚀 Starting prefetch...\n');

    try {
        initializeFirebaseAdmin();
    } catch (error) {
        console.error('❌ Firebase Admin init failed:', error.message);
        process.exit(1);
    }

    const { run, result, error } = await runPrefetchJob();

    console.log('\n' + '='.repeat(60));
    console.log(`Prefetch status: ${run.status} (trigger ${run.trigger}, ${(run.durationMs / 1000).toFixed(1)} s)`);
    if (result) {
        console.log(`📊 Requests: ${result.totalRequests ?? '?'}, ok ${result.successCount ?? '?'}, errors ${result.errorCount ?? '?'}`);
        console.log(`📚 Definitions: ${result.definitionsCount ?? '?'}`);
    }
    if (run.error) console.log(`⚠️  ${run.error}`);
    if (error && error.stack) console.error(error.stack);
    console.log('='.repeat(60) + '\n');

    if (run.status === 'ok') process.exit(0);
    if (EXPECTED_FAILURES.has(run.status)) {
        console.log('⚠️  Bakaláři unavailable or returned no data — not a script error');
        process.exit(0);
    }
    process.exit(1);
}

main();
