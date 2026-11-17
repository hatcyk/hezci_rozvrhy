/**
 * Authentication Routes (contract S1)
 *
 * POST /api/auth { userId? } [Authorization: Bearer <Firebase ID token>]
 *   → { token, userId [, migratedFrom] }
 * - `anon-<uuid>` + ID token of that uid      → a new custom token for it
 * - `anonymous-<ms>` + ID token of that uid   → one-time move of users/{legacy}
 *   to a new ID (1.x clients signed in with a custom token for the legacy uid,
 *   so the owner's browser still holds that Firebase session); the same
 *   session asking again (lost response) gets the same new ID
 * - anything else: no ID, unknown format, or an ID the caller cannot prove
 *                                             → a fresh, empty `anon-<uuid>`
 *   (at most AUTH_NEW_ID_LIMIT per client address in 10 minutes, then 429)
 *
 * The userId is an identifier, not a credential: knowing or guessing someone's
 * ID (the legacy ones are millisecond timestamps) gets you nothing. Before 2.0
 * the endpoint signed a token for ANY uid in the body.
 */

const express = require('express');
const { createCustomToken, getFirestore, verifyIdToken } = require('../backend/firebase-admin-init');
const { isValidUserId, isLegacyUserId, newUserId, bearerToken } = require('../backend/auth-middleware');
const { AttemptLimiter } = require('../backend/admin');
const { clientIp, rateLimitKey } = require('./admin');

const router = express.Router();

const NEW_ID_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_NEW_ID_LIMIT = 60;

/** AUTH_NEW_ID_LIMIT: new identities per client address and 10 minutes. */
function newIdentityLimit(env = process.env) {
    const value = Number(env.AUTH_NEW_ID_LIMIT);
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_NEW_ID_LIMIT;
}

// Every new identity can carry reminders and a device token, which the
// reminder job reads every minute; without a limit one script created
// hundreds of them in a second. Counted per address (IPv6: per /64), like
// the admin limiter, and only for new identities: restoring one's own
// session or migrating with its ID token never counts. Generous because the
// whole school reaches the app from one public IP. Per serverless instance.
const newIdentities = new AttemptLimiter({
    max: newIdentityLimit(),
    windowMs: NEW_ID_WINDOW_MS,
    lockMs: NEW_ID_WINDOW_MS,
});

// userMigrations/{legacyId} = { migratedTo, migratedAt, authTime, moved }:
// which new ID a legacy one became. Kept so that a repeated request is answered
// with the same ID. Server-only (the deny-all rule in firestore.rules).
const MIGRATIONS_COLLECTION = 'userMigrations';

/**
 * Move users/{legacyId} to users/{newId} in one transaction (copy + delete +
 * migration record), so a crash cannot leave the settings in both places or
 * in neither.
 *
 * Repeatable: when the response of the first call is lost (weak Wi-Fi, a
 * closed tab, a failing token signature), the browser still holds the legacy
 * ID and asks again. It used to get a second, empty identity while the moved
 * settings stayed orphaned under the first one. Now the recorded ID is handed
 * out again - but only to the very Firebase session that did the migration
 * (same `auth_time`, the sign-in time carried by every ID token of a
 * session). Another session of the legacy uid gets a fresh empty identity,
 * as before; legacy IDs were guessable and 1.x signed a token for any of them.
 *
 * Device tokens are NOT moved: the owner's browser registers its token again
 * (notificationsEnabled tells it to), and a foreign session of the legacy ID
 * cannot take over notifications to somebody's phone.
 *
 * @param {Object} db
 * @param {String} legacyId
 * @param {String} newId - the ID to use when this is the first migration
 * @param {Number|null} authTime - `auth_time` of the proving ID token
 * @returns {Promise<{ userId: String, moved: Boolean, repeated: Boolean }>}
 */
async function migrateLegacyUser(db, legacyId, newId, authTime = null) {
    const legacyRef = db.collection('users').doc(legacyId);
    const newRef = db.collection('users').doc(newId);
    const recordRef = db.collection(MIGRATIONS_COLLECTION).doc(legacyId);
    const session = Number.isFinite(authTime) ? authTime : null;

    return db.runTransaction(async (tx) => {
        const [record, snap] = [await tx.get(recordRef), await tx.get(legacyRef)];

        if (record.exists) {
            const done = record.data() || {};
            const sameSession = session !== null && done.authTime === session && isValidUserId(done.migratedTo);
            return { userId: sameSession ? done.migratedTo : newId, moved: false, repeated: sameSession };
        }

        const now = new Date().toISOString();
        if (snap.exists) {
            const { tokens, ...settings } = snap.data();
            tx.create(newRef, {
                ...settings,
                tokens: [],
                // 1.x had no such flag: "has a token" meant "notifications on".
                notificationsEnabled: settings.notificationsEnabled ?? (Array.isArray(tokens) && tokens.length > 0),
                migratedFrom: legacyId,
                migratedAt: now,
                lastUpdated: now,
            });
            tx.delete(legacyRef);
        }
        tx.create(recordRef, { migratedTo: newId, migratedAt: now, authTime: session, moved: snap.exists });
        return { userId: newId, moved: snap.exists, repeated: false };
    });
}

/**
 * The caller's Firebase session ({ uid, authTime }), or null when the request
 * carries no valid ID token. An invalid or expired token is not an error
 * here: the caller just cannot prove any identity and gets a new one.
 */
async function provenSession(req) {
    const idToken = bearerToken(req);
    if (!idToken) return null;
    try {
        const decoded = await verifyIdToken(idToken);
        if (!decoded || typeof decoded.uid !== 'string') return null;
        return { uid: decoded.uid, authTime: Number.isFinite(decoded.auth_time) ? decoded.auth_time : null };
    } catch {
        return null;
    }
}

router.post('/auth', async (req, res) => {
    try {
        const requested = req.body && typeof req.body.userId === 'string' ? req.body.userId : null;
        const knownFormat = isValidUserId(requested) || isLegacyUserId(requested);
        const session = knownFormat ? await provenSession(req) : null;
        const owned = !!session && session.uid === requested;

        let userId;
        let migratedFrom;

        if (owned && isValidUserId(requested)) {
            userId = requested;
        } else if (owned) {
            const result = await migrateLegacyUser(getFirestore(), requested, newUserId(), session.authTime);
            userId = result.userId;
            migratedFrom = requested;
            console.log(`🔁 Legacy user ${requested} → ${userId} (${result.repeated ? 'repeated request'
                : result.moved ? 'settings moved' : 'no stored settings'})`);
        } else {
            const key = rateLimitKey(clientIp(req));
            const state = newIdentities.status(key);
            if (state.locked) {
                res.setHeader('Retry-After', String(state.retryAfterSec));
                return res.status(429).json({
                    error: 'Příliš mnoho nových přihlášení z této sítě, zkuste to později.',
                    retryAfterSec: state.retryAfterSec,
                });
            }
            newIdentities.fail(key); // one more new identity of this address
            userId = newUserId();
        }

        const token = await createCustomToken(userId);
        res.json(migratedFrom ? { token, userId, migratedFrom } : { token, userId });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Failed to generate auth token' });
    }
});

module.exports = router;
module.exports.migrateLegacyUser = migrateLegacyUser;
module.exports.newIdentityLimit = newIdentityLimit;
