/**
 * Security headers for every response (Express) - the same values go into
 * vercel.json, because on Vercel the static files are served by the CDN and
 * never pass through Express. tools/csp-hashes.js keeps vercel.json in sync
 * and test/security-headers.test.js fails when they drift apart.
 *
 * The Content-Security-Policy of the app is REPORT-ONLY for now: it lists the
 * sources the app really uses (Firebase SDK from gstatic, Firestore / Auth /
 * FCM APIs, Google Fonts, Vercel Analytics from jsDelivr, sunrisesunset.io)
 * and the sha256 hashes of the inline <script>s of index.html. Browsers only
 * report violations to /api/csp-report; once the reports stay empty for a
 * while it can be switched to the enforcing header. The admin page has no
 * inline scripts and no third-party code, so its policy is enforced already.
 *
 * After ANY change of an inline <script> in public/index.html the hashes must
 * be recomputed: `node tools/csp-hashes.js --write` (updates vercel.json;
 * Express computes them itself at start-up).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_INDEX_HTML = path.join(__dirname, '..', 'public', 'index.html');
const CSP_REPORT_PATH = '/api/csp-report';

// Only features a timetable app could plausibly be abused for; everything the
// app uses (notifications, service worker) is not governed by this header.
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()';

/**
 * sha256 source expressions of the inline scripts (<script> without src) of
 * an HTML document: base64 of SHA-256 over the exact UTF-8 text between the
 * tags, which is what browsers hash (CSP3, "Does element match source list").
 * @returns {string[]} e.g. ["'sha256-abc…='"]
 */
function inlineScriptHashes(html) {
    const hashes = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let match;
    while ((match = re.exec(String(html))) !== null) {
        const attrs = match[1] || '';
        if (/\bsrc\s*=/i.test(attrs)) continue;
        const digest = crypto.createHash('sha256').update(match[2], 'utf8').digest('base64');
        hashes.push(`'sha256-${digest}'`);
    }
    return [...new Set(hashes)];
}

/**
 * CSP of the app (index.html and everything it loads).
 * @param {{ scriptHashes?: string[] }} [options]
 */
function buildAppCsp({ scriptHashes = [] } = {}) {
    const directives = [
        ["default-src", "'self'"],
        // Firebase compat SDK (gstatic), Vercel Analytics / Speed Insights loaded
        // with import() from jsDelivr, their scripts from va.vercel-scripts.com
        // (debug builds) or /_vercel/* (same origin), + the 3 inline scripts.
        ["script-src", "'self'", ...scriptHashes, 'https://www.gstatic.com', 'https://cdn.jsdelivr.net', 'https://va.vercel-scripts.com'],
        // style="" attributes in index.html and the rendered markup need 'unsafe-inline'.
        ["style-src", "'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        ["font-src", "'self'", 'https://fonts.gstatic.com'],
        ["img-src", "'self'", 'data:'],
        ["connect-src", "'self'",
            'https://firestore.googleapis.com',
            'https://identitytoolkit.googleapis.com',
            'https://securetoken.googleapis.com',
            'https://fcmregistrations.googleapis.com',
            'https://firebaseinstallations.googleapis.com',
            // the service worker caches the Firebase SDK files with fetch()
            'https://www.gstatic.com',
            'https://api.sunrisesunset.io',
            'https://vitals.vercel-insights.com'],
        // Firebase Auth's helper iframe (only used by popup/redirect sign-in).
        ["frame-src", 'https://barat-bakalari.firebaseapp.com'],
        ["worker-src", "'self'"],
        ["manifest-src", "'self'"],
        ["object-src", "'none'"],
        ["base-uri", "'self'"],
        ["form-action", "'self'"],
        ["frame-ancestors", "'none'"],
        ["report-uri", CSP_REPORT_PATH],
    ];
    return directives.map(d => d.join(' ')).join('; ');
}

/** Enforced policy of the admin page: own files only, no inline code. */
const ADMIN_CSP = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join('; ');

/** Headers sent with every response. */
function baseHeaders({ appCsp }) {
    return {
        'X-Content-Type-Options': 'nosniff',
        // Other sites see only our origin, never the full URL with the
        // timetable query (?type=Teacher&id=...).
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': PERMISSIONS_POLICY,
        // Nothing of the app is meant to be embedded in another site
        // (clickjacking); a kiosk display opens the page itself.
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy-Report-Only': appCsp,
    };
}

/** Headers added for /admin, /admin.html and /admin/*. */
const ADMIN_HEADERS = {
    'Content-Security-Policy': ADMIN_CSP,
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-cache',
};

const isAdminPath = (p) => p === '/admin' || p === '/admin/' || p === '/admin.html' || p.startsWith('/admin/');

function readHashes(indexHtmlPath) {
    try {
        return inlineScriptHashes(fs.readFileSync(indexHtmlPath, 'utf8'));
    } catch {
        return [];
    }
}

/**
 * Express middleware. The hashes are computed from index.html once, at start.
 * @param {{ indexHtmlPath?: string|null }} [options]
 */
function createSecurityHeaders({ indexHtmlPath = DEFAULT_INDEX_HTML } = {}) {
    const appCsp = buildAppCsp({ scriptHashes: indexHtmlPath ? readHashes(indexHtmlPath) : [] });
    const headers = baseHeaders({ appCsp });
    return function securityHeaders(req, res, next) {
        for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
        if (isAdminPath(req.path)) {
            for (const [name, value] of Object.entries(ADMIN_HEADERS)) res.setHeader(name, value);
        }
        next();
    };
}

/**
 * The "headers" entries vercel.json must contain (tools/csp-hashes.js writes
 * them, the test compares).
 */
function vercelHeaderRules({ scriptHashes }) {
    const toList = (obj) => Object.entries(obj).map(([key, value]) => ({ key, value }));
    return [
        { source: '/(.*)', headers: toList(baseHeaders({ appCsp: buildAppCsp({ scriptHashes }) })) },
        { source: '/admin', headers: toList(ADMIN_HEADERS) },
        { source: '/admin.html', headers: toList(ADMIN_HEADERS) },
        { source: '/admin/(.*)', headers: toList(ADMIN_HEADERS) },
    ];
}

module.exports = {
    DEFAULT_INDEX_HTML,
    CSP_REPORT_PATH,
    PERMISSIONS_POLICY,
    ADMIN_CSP,
    ADMIN_HEADERS,
    inlineScriptHashes,
    buildAppCsp,
    baseHeaders,
    isAdminPath,
    createSecurityHeaders,
    vercelHeaderRules,
};
