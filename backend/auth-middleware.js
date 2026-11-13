/**
 * Authorization middleware (contract S1).
 *
 * Users are anonymous: /api/auth hands out an `anon-<uuid v4>` identity and a
 * Firebase custom token for it. Every request that reads or writes a user's
 * data must prove it owns that identity with a Firebase ID token, otherwise
 * anyone who learned (or guessed - the old `anonymous-<ms>` IDs are just
 * timestamps) a userId could read its FCM tokens or rewrite its settings.
 *
 * The cron guard lives here too so all secret checks use the same
 * constant-time comparison.
 */

const crypto = require('crypto');
const firebaseAdmin = require('./firebase-admin-init');

const USER_ID_RE = /^anon-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Format handed out before S1 ('anonymous-' + Date.now()); only /api/auth
// accepts it, to migrate it to a new ID.
const LEGACY_USER_ID_RE = /^anonymous-\d{10,16}$/;

function isValidUserId(value) {
    return typeof value === 'string' && USER_ID_RE.test(value);
}

function isLegacyUserId(value) {
    return typeof value === 'string' && LEGACY_USER_ID_RE.test(value);
}

function newUserId() {
    return `anon-${crypto.randomUUID()}`;
}

/**
 * Constant-time string comparison, so the response time does not leak how
 * many leading characters of a secret were right.
 */
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function bearerToken(req) {
    const header = req.headers && req.headers.authorization;
    if (typeof header !== 'string') return null;
    const match = header.match(/^Bearer\s+(\S+)\s*$/i);
    return match ? match[1] : null;
}

/**
 * Build the requireUser middleware. The token verifier is injectable so the
 * routes can be tested without Firebase.
 * @param {{ verifyIdToken?: (token: string) => Promise<{uid: string}> }} [deps]
 */
function createRequireUser(deps = {}) {
    const verify = deps.verifyIdToken || ((token) => firebaseAdmin.verifyIdToken(token));

    return async function requireUser(req, res, next) {
        const token = bearerToken(req);
        if (!token) {
            return res.status(401).json({ error: 'Missing Authorization: Bearer <Firebase ID token>' });
        }

        let decoded;
        try {
            decoded = await verify(token);
        } catch (error) {
            return res.status(401).json({ error: 'Invalid or expired ID token' });
        }
        if (!decoded || typeof decoded.uid !== 'string') {
            return res.status(401).json({ error: 'Invalid or expired ID token' });
        }
        req.uid = decoded.uid;

        // The user the request is about, from the path or the body.
        const claimed = (req.params && req.params.userId !== undefined)
            ? req.params.userId
            : (req.body && req.body.userId);

        if (claimed === undefined || claimed === null || claimed === '') {
            // Handlers that need a userId report it missing themselves.
            return next();
        }
        if (!isValidUserId(claimed)) {
            return res.status(400).json({ error: 'Invalid userId format' });
        }
        if (claimed !== req.uid) {
            return res.status(403).json({ error: 'userId does not match the signed-in user' });
        }
        return next();
    };
}

const requireUser = createRequireUser();

function isProductionEnv() {
    return process.env.VERCEL === '1' || process.env.VERCEL === 'true' || process.env.NODE_ENV === 'production';
}

/**
 * Guard for the scheduler endpoints (/api/cron/*, /api/fcm/process-changes).
 * Fails closed in production when CRON_SECRET is missing, so a misconfigured
 * deployment cannot be triggered by anyone.
 */
function verifyCronRequest(req, res, next) {
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
        if (isProductionEnv()) {
            console.error('❌ CRON_SECRET not set in production - refusing cron request');
            return res.status(503).json({ error: 'Cron not configured' });
        }
        console.warn('⚠️  CRON_SECRET not set - cron endpoint is unprotected (dev only)');
        return next();
    }

    if (safeEqual(bearerToken(req) || '', cronSecret)) {
        return next();
    }

    console.error('❌ Unauthorized cron request attempt');
    return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = {
    USER_ID_RE,
    LEGACY_USER_ID_RE,
    isValidUserId,
    isLegacyUserId,
    newUserId,
    safeEqual,
    bearerToken,
    createRequireUser,
    requireUser,
    verifyCronRequest,
    isProductionEnv,
};
