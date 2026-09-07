/**
 * Groups Routes
 * Returns the group list (1.sk, 2.sk, TVk1, ...) of a class from the cached definitions.
 * Timetables and definitions themselves are read by the client straight from Firestore.
 */

const express = require('express');
const { getFirestore } = require('../backend/firebase-admin-init');

const router = express.Router();

// Get groups for a specific class from Firebase cache
router.get('/groups/:classId', async (req, res) => {
    try {
        const { classId } = req.params;

        if (!classId) {
            return res.status(400).json({ error: 'classId is required' });
        }

        // Get from Firebase cache
        const db = getFirestore();
        const definitionsDoc = await db.collection('definitions').doc('current').get();

        if (!definitionsDoc.exists) {
            return res.status(404).json({ error: 'Definitions not found in cache' });
        }

        const data = definitionsDoc.data();
        const classGroups = data.classGroups || {};
        const groups = classGroups[classId] || [];

        res.json({ groups });

    } catch (e) {
        console.error('Get groups error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
