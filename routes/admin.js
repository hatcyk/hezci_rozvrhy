/**
 * Admin API (contract S5) - /api/admin/*
 *
 * Every request needs `Authorization: Bearer <ADMIN_SECRET>` (constant-time
 * comparison). Without a configured secret the API is closed (503), also
 * outside production: the dev server listens on 0.0.0.0, i.e. the whole LAN.
 * Wrong secrets are rate limited per client and every request - allowed or
 * not - leaves a record in `audit` (with a keyed hash instead of the IP).
 *
 *   GET  /health               system/health, data age, last run of each job
 *   GET  /runs?job=&limit=     newest runs (max 100)
 *   GET  /runs/intervals?days= prefetch runs + gaps between them (chart)
 *   GET  /changes?limit=       detected changes and their delivery
 *   GET  /stats                aggregated counts only (no personal data)
 *   POST /prefetch/dispatch    start prefetch.yml on GitHub (max 1× / 10 min)
 *   GET  /audit?limit=         the audit trail
 */

const express = require('express');
const admin = require('../backend/admin');
const { safeEqual, bearerToken, isProductionEnv } = require('../backend/auth-middleware');
const { getFirestore } = require('../backend/firebase-admin-init');

// openssl rand -base64 32 gives 44 characters; anything this short is guessable.
const MIN_SECRET_LENGTH = 16;

/**
 * Client address for the rate limiter and the audit hash. On Vercel the
 * platform overwrites X-Forwarded-For / X-Real-IP ("do not forward external
 * IPs ... to prevent IP spoofing"); elsewhere these headers are client
 * controlled, so the socket address is used unless TRUST_PROXY=1.
 */
function clientIp(req, env = process.env) {
    const trusted = env.VERCEL === '1' || env.VERCEL === 'true' || env.TRUST_PROXY === '1';
    if (trusted) {
        const real = req.headers['x-real-ip'];
        if (typeof real === 'string' && real.trim()) return real.trim();
        const xff = req.headers['x-forwarded-for'];
        if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
    }
    return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * @param {Object} [deps] - injectable for tests
 * @param {admin.AttemptLimiter} [deps.limiter]
 * @param {() => Object} [deps.getDb]
 * @param {Function} [deps.fetchImpl] - fetch used for the GitHub API
 * @param {() => Date} [deps.now]
 */
function createAdminRouter({
    limiter = new admin.AttemptLimiter(),
    getDb = () => getFirestore(),
    fetchImpl = (...args) => globalThis.fetch(...args),
    now = () => new Date(),
} = {}) {
    const router = express.Router();

    const audit = (req, action, target = null, details = null) => admin.writeAudit({
        db: getDb(), action, target, details, ip: req.adminIp, secret: process.env.ADMIN_SECRET, now: now(),
    });

    // Admin answers must never sit in a shared cache, nor in search results.
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        next();
    });

    router.use(async (req, res, next) => {
        const secret = process.env.ADMIN_SECRET;
        if (!secret) {
            console.error('❌ ADMIN_SECRET not set - admin API is closed');
            return res.status(503).json({ error: 'Admin API není nastavené (chybí ADMIN_SECRET).' });
        }
        if (isProductionEnv() && secret.length < MIN_SECRET_LENGTH) {
            console.error('❌ ADMIN_SECRET too short - admin API is closed');
            return res.status(503).json({ error: `ADMIN_SECRET je kratší než ${MIN_SECRET_LENGTH} znaků.` });
        }

        const ip = clientIp(req);
        req.adminIp = ip;
        const state = limiter.status(ip);
        if (state.locked) {
            res.setHeader('Retry-After', String(state.retryAfterSec));
            return res.status(429).json({ error: 'Příliš mnoho chybných pokusů, zkuste to později.', retryAfterSec: state.retryAfterSec });
        }

        if (!safeEqual(bearerToken(req) || '', secret)) {
            const result = limiter.fail(ip);
            // One record per burst (first failure, lock-out), not one per guess.
            if (result.first || result.lockedNow) {
                await audit(req, result.lockedNow ? 'auth_locked' : 'auth_failed', `${req.method} ${req.path}`, { failures: result.failures });
            }
            if (result.locked) {
                res.setHeader('Retry-After', String(result.retryAfterSec));
                return res.status(429).json({ error: 'Příliš mnoho chybných pokusů, zkuste to později.', retryAfterSec: result.retryAfterSec });
            }
            return res.status(401).json({ error: 'Neplatné nebo chybějící admin tajemství.' });
        }

        limiter.reset(ip);
        return next();
    });

    // Wrap a read endpoint: audit it, answer JSON, turn errors into 4xx/500.
    const view = (action, handler) => async (req, res) => {
        try {
            const { body, details } = await handler(req);
            await audit(req, action, null, details || null);
            res.json(body);
        } catch (error) {
            const status = error.status || 500;
            if (status >= 500) console.error(`Admin ${action} error:`, error.message);
            res.status(status).json({ error: status >= 500 ? 'Interní chyba' : error.message });
        }
    };

    router.get('/health', view('view_health', async () => ({
        body: await admin.getHealthOverview({ db: getDb(), now: now() }),
    })));

    router.get('/runs', view('view_runs', async (req) => {
        const job = typeof req.query.job === 'string' && req.query.job !== '' ? req.query.job : null;
        const body = await admin.listRuns({ db: getDb(), job, limit: req.query.limit });
        return { body, details: { job, limit: body.limit } };
    }));

    router.get('/runs/intervals', view('view_intervals', async (req) => {
        const body = await admin.getPrefetchIntervals({ db: getDb(), now: now(), days: req.query.days });
        return { body, details: { days: body.days } };
    }));

    router.get('/changes', view('view_changes', async (req) => {
        const body = await admin.listChanges({ db: getDb(), limit: req.query.limit });
        return { body, details: { limit: body.limit } };
    }));

    router.get('/stats', view('view_stats', async () => ({
        body: await admin.getStats({ db: getDb(), now: now() }),
    })));

    router.get('/audit', view('view_audit', async (req) => {
        const body = await admin.listAudit({ db: getDb(), limit: req.query.limit });
        return { body, details: { limit: body.limit } };
    }));

    router.post('/prefetch/dispatch', async (req, res) => {
        try {
            const outcome = await admin.dispatchPrefetch({ db: getDb(), now: now(), fetchImpl });
            await audit(req, 'prefetch_dispatch', 'prefetch.yml', {
                result: outcome.result,
                githubStatus: outcome.githubStatus ?? null,
                workflowRunId: outcome.workflowRunId ?? null,
                ...(outcome.retryAfterSec ? { retryAfterSec: outcome.retryAfterSec } : {}),
                ...(outcome.missing ? { missing: outcome.missing } : {}),
            });
            if (outcome.retryAfterSec) res.setHeader('Retry-After', String(outcome.retryAfterSec));
            const { httpStatus, ...body } = outcome;
            res.status(httpStatus).json(body);
        } catch (error) {
            console.error('Admin dispatch error:', error.message);
            await audit(req, 'prefetch_dispatch', 'prefetch.yml', { result: 'error' });
            res.status(500).json({ error: 'Interní chyba' });
        }
    });

    return router;
}

module.exports = { createAdminRouter, clientIp, MIN_SECRET_LENGTH };
