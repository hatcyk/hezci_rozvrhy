/**
 * Favorites Routes
 * GET  /api/favorites/:userId  — vrátí favoriteTimetables[]
 * POST /api/favorites/:userId  — uloží celý seznam
 */

const express = require('express');
const { getFirestore } = require('../backend/firebase-admin-init');

const router = express.Router();

router.get('/favorites/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const db = getFirestore();
        const userDoc = await db.collection('users').doc(userId).get();

        if (userDoc.exists) {
            const prefs = userDoc.data().preferences || {};
            res.json({ favoriteTimetables: prefs.favoriteTimetables || [] });
        } else {
            res.json({ favoriteTimetables: [] });
        }
    } catch (error) {
        console.error('Favorites GET error:', error);
        res.status(500).json({ error: 'Failed to get favorites' });
    }
});

router.post('/favorites/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { favoriteTimetables } = req.body;

        if (!Array.isArray(favoriteTimetables)) {
            return res.status(400).json({ error: 'favoriteTimetables must be an array' });
        }
        if (favoriteTimetables.length > 50) {
            return res.status(400).json({ error: 'Too many favorites (max 50)' });
        }
        const validTypes = ['Class', 'Teacher', 'Room'];
        for (const item of favoriteTimetables) {
            if (!item || typeof item.type !== 'string' || !validTypes.includes(item.type) ||
                typeof item.id !== 'string' || !item.id.trim()) {
                return res.status(400).json({ error: 'Invalid favoriteTimetables item format' });
            }
        }

        const db = getFirestore();
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            await userRef.update({
                'preferences.favoriteTimetables': favoriteTimetables,
                lastUpdated: new Date().toISOString()
            });
        } else {
            await userRef.set({
                tokens: [],
                preferences: { favoriteTimetables },
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Favorites POST error:', error);
        res.status(500).json({ error: 'Failed to save favorites' });
    }
});

module.exports = router;
