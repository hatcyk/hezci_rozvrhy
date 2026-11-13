/**
 * Authentication Routes (contract S1)
 *
 * POST /api/auth { userId? } [Authorization: Bearer <Firebase ID token>]
 *   → { token, userId [, migratedFrom] }
 * - `anon-<uuid>` + ID token of that uid      → a new custom token for it
 * - `anonymous-<ms>` + ID token of that uid   → one-time move of users/{legacy}
 *   to a new ID (1.x clients signed in with a custom token for the legacy uid,
 *   so the owner's browser still holds that Firebase session)
 * - anything else: no ID, unknown format, or an ID the caller cannot prove
 *                                             → a fresh, empty `anon-<uuid>`
 *
 * The userId is an identifier, not a credential: knowing or guessing someone's
 * ID (the legacy ones are millisecond timestamps) gets you nothing. Before 2.0
 * the endpoint signed a token for ANY uid in the body.
 */

const express = require('express');
const { createCustomToken, getFirestore, verifyIdToken } = require('../backend/firebase-admin-init');
const { isValidUserId, isLegacyUserId, newUserId, bearerToken } = require('../backend/auth-middleware');

const router = express.Router();

/**
 * Move users/{legacyId} to users/{newId} in one transaction (copy + delete),
 * so a crash cannot leave the settings in both places or in neither.
 * @returns {Promise<boolean>} true when a document was moved
 */
async function migrateLegacyUser(db, legacyId, newId) {
    const legacyRef = db.collection('users').doc(legacyId);
    const newRef = db.collection('users').doc(newId);

    return db.runTransaction(async (tx) => {
        const snap = await tx.get(legacyRef);
        if (!snap.exists) return false;
        tx.create(newRef, {
            ...snap.data(),
            migratedFrom: legacyId,
            migratedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
        });
        tx.delete(legacyRef);
        return true;
    });
}

/**
 * The uid of the caller's Firebase session, or null when the request carries
 * no valid ID token. An invalid or expired token is not an error here: the
 * caller just cannot prove any identity and gets a new one.
 */
async function provenUid(req) {
    const idToken = bearerToken(req);
    if (!idToken) return null;
    try {
        const decoded = await verifyIdToken(idToken);
        return decoded && typeof decoded.uid === 'string' ? decoded.uid : null;
    } catch {
        return null;
    }
}

router.post('/auth', async (req, res) => {
    try {
        const requested = req.body && typeof req.body.userId === 'string' ? req.body.userId : null;
        const knownFormat = isValidUserId(requested) || isLegacyUserId(requested);
        const owned = knownFormat && (await provenUid(req)) === requested;

        let userId;
        let migratedFrom;

        if (owned && isValidUserId(requested)) {
            userId = requested;
        } else if (owned) {
            userId = newUserId();
            const moved = await migrateLegacyUser(getFirestore(), requested, userId);
            migratedFrom = requested;
            console.log(`🔁 Legacy user ${requested} → ${userId} (${moved ? 'settings moved' : 'no stored settings'})`);
        } else {
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
