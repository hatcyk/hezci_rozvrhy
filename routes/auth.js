/**
 * Authentication Routes (contract S1)
 *
 * POST /api/auth { userId? } → { token, userId [, migratedFrom] }
 * - no / unknown-format userId → a fresh `anon-<uuid>`
 * - `anon-<uuid>`              → a token for that identity
 * - legacy `anonymous-<ms>`    → one-time move of users/{legacy} to a new ID
 *
 * Before this the endpoint signed a token for ANY uid in the body, so knowing
 * (or guessing) someone's ID was enough to act as them.
 */

const express = require('express');
const { createCustomToken, getFirestore } = require('../backend/firebase-admin-init');
const { isValidUserId, isLegacyUserId, newUserId } = require('../backend/auth-middleware');

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

router.post('/auth', async (req, res) => {
    try {
        const requested = req.body && typeof req.body.userId === 'string' ? req.body.userId : null;

        let userId;
        let migratedFrom;

        if (isValidUserId(requested)) {
            userId = requested;
        } else if (isLegacyUserId(requested)) {
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
