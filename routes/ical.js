/**
 * iCal export: GET /api/ical/:type/:id.ics?schedule=permanent|actual|next|actual,next&group=1.sk
 *
 * Public like the app itself: anyone with the link gets the timetable. The
 * Bakaláři timetable behind it needs a login, so this makes data that is
 * otherwise behind the school login machine-readable and cacheable by third
 * parties (Google fetches subscribed calendars from its own servers).
 * ICAL_ENABLED=false turns the endpoint off (404). See ZMENY.md (adm2).
 */

const express = require('express');
const { getFirestore } = require('../backend/firebase-admin-init');
const { buildCalendar, parseScheduleParam, isIcalEnabled, SCHEDULE_DOC } = require('../backend/ical');
const { TIMETABLE_TYPES } = require('./validation');

const ID_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
const GROUP_RE = /^[\p{L}\p{N} ._-]{1,40}$/u;
const MAX_GROUPS = 10;

// Prefetch refreshes the data every 15 min on school days; calendar clients
// poll far less often. The CDN may serve a copy for 15 min and a stale one
// for an hour while it revalidates.
const CACHE_CONTROL = 'public, max-age=900, s-maxage=900, stale-while-revalidate=3600';

function createIcalRouter({ getDb = () => getFirestore(), now = () => new Date() } = {}) {
    const router = express.Router();

    router.get('/ical/:type/:id.ics', async (req, res) => {
        if (!isIcalEnabled()) {
            return res.status(404).json({ error: 'iCal export je vypnutý' });
        }
        const { type, id } = req.params;
        if (!TIMETABLE_TYPES.has(type) || !ID_RE.test(id)) {
            return res.status(400).json({ error: 'Invalid timetable type or id' });
        }
        const parsed = parseScheduleParam(req.query.schedule);
        if (parsed.error) return res.status(400).json({ error: parsed.error });

        const groups = typeof req.query.group === 'string' && req.query.group !== ''
            ? req.query.group.split(',').map(g => g.trim()).filter(Boolean)
            : [];
        if (groups.length > MAX_GROUPS || !groups.every(g => GROUP_RE.test(g))) {
            return res.status(400).json({ error: 'Invalid group' });
        }

        try {
            const db = getDb();
            const refs = parsed.schedules.map(s => db.collection('timetables').doc(`${type}_${id}_${SCHEDULE_DOC[s]}`));
            const docs = await db.getAll(...refs);
            const sources = [];
            docs.forEach((doc, i) => {
                if (doc.exists) sources.push({ schedule: parsed.schedules[i], snapshot: doc.data() || {} });
            });
            if (!sources.length) return res.status(404).json({ error: 'Timetable not found' });

            const first = sources[0].snapshot;
            const ics = buildCalendar({
                timetable: { type, id, name: first.name || id },
                sources,
                groups,
                now: now(),
            });

            res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
            res.setHeader('Content-Disposition', `inline; filename="rozvrh-${type}-${id}.ics"`);
            res.setHeader('Cache-Control', CACHE_CONTROL);
            // Express adds a weak ETag; the output only changes with the data.
            res.send(ics);
        } catch (error) {
            console.error('iCal export error:', error.message);
            res.status(500).json({ error: 'Failed to build calendar' });
        }
    });

    return router;
}

module.exports = { createIcalRouter, CACHE_CONTROL };
