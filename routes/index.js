/**
 * Express app factory: middleware + all API routes.
 *
 * Kept out of index.js so tests can build the app without starting a server.
 * (Not named app.js in the project root: Vercel picks app.js before index.js
 * as the Express entry point.)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { createSecurityHeaders } = require('../backend/security-headers');

const DEFAULT_CORS_ORIGINS = [
    'https://spsd-rozvrhy.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
];

/**
 * Allowed browser origins: CORS_ORIGINS (comma separated) or the defaults.
 * cors() used to answer every origin with "*", so any website could call the
 * API from its visitors' browsers.
 */
function parseCorsOrigins(value = process.env.CORS_ORIGINS) {
    if (!value || !value.trim()) return DEFAULT_CORS_ORIGINS.slice();
    return value.split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

/**
 * Security headers without a new dependency (helmet): nosniff, Referrer-Policy,
 * Permissions-Policy, X-Frame-Options and the report-only CSP for every
 * response, the enforced CSP for the admin page (backend/security-headers.js;
 * vercel.json carries the same values for the CDN).
 */
const securityHeaders = createSecurityHeaders();

function createApp({ corsOrigins = parseCorsOrigins(), staticDir = path.join(__dirname, '..', 'public'), adminDeps = {} } = {}) {
    const groupsRoutes = require('./groups');
    const authRoutes = require('./auth');
    const fcmRoutes = require('./fcm');
    const debugRoutes = require('./debug');
    const statusRoutes = require('./status');
    const cronRoutes = require('./cron');
    const favoritesRoutes = require('./favorites');
    const { createAdminRouter } = require('./admin');
    const { createIcalRouter } = require('./ical');
    const { createCspReportRouter } = require('./csp-report');

    const app = express();
    app.disable('x-powered-by');

    app.use(staticDir ? createSecurityHeaders({ indexHtmlPath: path.join(staticDir, 'index.html') }) : securityHeaders);
    app.use(cors({
        origin: corsOrigins,
        allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    app.use(express.json({ limit: '50kb' }));

    // Serve static files (express.static sets the right Content-Type itself).
    // Long-lived caching only for the versioned bundles (?v=hash in the URL);
    // everything else stays revalidated so the SW / index.html pick up changes.
    // (On Vercel public/ is served by the CDN and this is skipped.)
    if (staticDir) {
        // /admin → the admin page (on Vercel the same is a rewrite in vercel.json).
        // `root` so that only the part below public/ is checked for dot-folders
        // (a checkout inside e.g. .worktrees/ would otherwise answer 404).
        app.get(['/admin', '/admin/'], (req, res) => res.sendFile('admin.html', { root: staticDir }));
        app.use(express.static(staticDir, {
            setHeaders(res, filePath) {
                if (/[\\/](?:app\.css|app\.js)$/.test(filePath)) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                } else if (filePath.endsWith('firebase-messaging-sw.js')) {
                    res.setHeader('Cache-Control', 'no-cache');
                }
            }
        }));
    }

    // Mount API routes. The old /api/prefetch/trigger and /api/prefetch/status
    // were unauthenticated and unused by the app; prefetch runs only through
    // the scheduler (/api/cron/prefetch with CRON_SECRET, or the scripts).
    app.use('/api', groupsRoutes);
    app.use('/api', authRoutes);
    app.use('/api', statusRoutes);
    app.use('/api/fcm', fcmRoutes);
    app.use('/api/debug', debugRoutes);
    app.use('/api/cron', cronRoutes);
    app.use('/api', favoritesRoutes);
    app.use('/api/admin', createAdminRouter(adminDeps));
    app.use('/api', createIcalRouter());
    app.use('/api', createCspReportRouter());

    return app;
}

module.exports = {
    DEFAULT_CORS_ORIGINS,
    parseCorsOrigins,
    securityHeaders,
    createApp,
};
