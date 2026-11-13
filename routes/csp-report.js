/**
 * POST /api/csp-report - violation reports of the Report-Only CSP
 * (backend/security-headers.js, directive report-uri).
 *
 * Reports only go to the server log (Vercel → Logs), one short line each,
 * so it is visible what the policy would block before it is enforced.
 * Nothing is stored. A per-process cap keeps a flood of fake reports from
 * filling the log.
 */

const express = require('express');

const MAX_REPORTS_PER_MINUTE = 60;

function createCspReportRouter({ log = (line) => console.warn(line), now = () => Date.now() } = {}) {
    const router = express.Router();
    let windowStart = 0;
    let inWindow = 0;

    // Browsers send application/csp-report (report-uri) or
    // application/reports+json (Reporting API).
    const parse = express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '10kb' });

    const short = (value) => {
        if (typeof value !== 'string') return '';
        try {
            const u = new URL(value);
            return u.origin + u.pathname; // no query strings in the log
        } catch {
            return value.slice(0, 100);
        }
    };

    router.post('/csp-report', parse, (req, res) => {
        const t = now();
        if (t - windowStart > 60000) { windowStart = t; inWindow = 0; }
        inWindow++;
        if (inWindow <= MAX_REPORTS_PER_MINUTE) {
            const body = req.body;
            const reports = Array.isArray(body) ? body.map(r => r && r.body) : [body && body['csp-report']];
            for (const r of reports.filter(Boolean).slice(0, 5)) {
                const directive = r['violated-directive'] || r['effective-directive'] || r.effectiveDirective || '';
                const blocked = r['blocked-uri'] || r.blockedURL || '';
                const page = r['document-uri'] || r.documentURL || '';
                log(`🛡️  CSP report: ${String(directive).slice(0, 60)} blocked=${short(blocked) || blocked} page=${short(page)}`);
            }
        }
        res.status(204).end();
    });

    return router;
}

module.exports = { createCspReportRouter, MAX_REPORTS_PER_MINUTE };
