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

router.get('/status', async (req, res) => {
    // Never cached: a stale "healthy" answer would hide an outage.
    res.setHeader('Cache-Control', 'no-store');
    try {
        const status = await getStatus();
        res.status(!status.isHealthy && isStrict(req) ? 503 : 200).json(status);
    } catch (error) {
        console.error('Status error:', error.message);
        res.status(isStrict(req) ? 503 : 500).json({
            isHealthy: false,
            error: 'Failed to get status'
        });
    }
});

module.exports = router;
