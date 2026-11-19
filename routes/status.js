/**
 * Status Routes
 * GET /api/status[?strict=1] — freshness of the timetable data (contract S4).
 *
 * The app always gets 200 and reads `isHealthy` to show its "data may be old"
 * banner. Monitors (check-status.yml, cron-job.org) pass ?strict=1 and get 503
 * when the data is stale, so `curl --fail` turns into an alert.
 */

const express = require('express');
const { getStatus } = require('../backend/cron');

const router = express.Router();

const isStrict = (req) => ['1', 'true', 'yes'].includes(String(req.query.strict || '').toLowerCase());

// Every answer costs two Firestore reads and every open tab asks every two
// minutes. The CDN may keep it for 30 s: data count as stale after hours, not
// seconds, so the banner and the monitors are at most 30 s late. Browsers
// always ask again (max-age=0; the app fetches with cache: 'no-store').
const CACHE_CONTROL = 'public, max-age=0, s-maxage=30';

router.get('/status', async (req, res) => {
    try {
        const status = await getStatus();
        res.setHeader('Cache-Control', CACHE_CONTROL);
        res.status(!status.isHealthy && isStrict(req) ? 503 : 200).json(status);
    } catch (error) {
        console.error('Status error:', error.message);
        // Firestore unreachable says nothing about the data: never cached.
        res.setHeader('Cache-Control', 'no-store');
        res.status(isStrict(req) ? 503 : 500).json({
            isHealthy: false,
            error: 'Failed to get status'
        });
    }
});

module.exports = router;
