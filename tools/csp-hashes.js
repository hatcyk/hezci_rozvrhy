#!/usr/bin/env node
/**
 * Recompute the sha256 hashes of the inline <script>s in public/index.html
 * and keep the security headers in vercel.json in sync with
 * backend/security-headers.js (Express computes the hashes itself at start;
 * the Vercel CDN only knows what vercel.json says).
 *
 *   node tools/csp-hashes.js           print the hashes, say whether vercel.json is current
 *   node tools/csp-hashes.js --check   exit 1 when vercel.json is out of date (CI)
 *   node tools/csp-hashes.js --write   update the header rules in vercel.json
 *
 * Run --write after every change of an inline script in index.html.
 */
const fs = require('fs');
const path = require('path');
const { inlineScriptHashes, vercelHeaderRules, DEFAULT_INDEX_HTML } = require('../backend/security-headers');

const VERCEL_JSON = path.join(__dirname, '..', 'vercel.json');

/** vercel.json with the security rules replaced (other rules kept, in order). */
function syncedVercelConfig(config, rules) {
    const managed = new Set(rules.map(r => r.source));
    const others = (config.headers || []).filter(r => !managed.has(r.source));
    return { ...config, headers: [...others, ...rules] };
}

/** True when every managed rule in `config` equals the expected one. */
function isInSync(config, rules) {
    const bySource = new Map((config.headers || []).map(r => [r.source, r]));
    return rules.every(rule => JSON.stringify(bySource.get(rule.source)) === JSON.stringify(rule));
}

function main(argv = process.argv.slice(2)) {
    const html = fs.readFileSync(DEFAULT_INDEX_HTML, 'utf8');
    const scriptHashes = inlineScriptHashes(html);
    const rules = vercelHeaderRules({ scriptHashes });
    const config = JSON.parse(fs.readFileSync(VERCEL_JSON, 'utf8'));
    const inSync = isInSync(config, rules);

    if (argv.includes('--write')) {
        if (!inSync) fs.writeFileSync(VERCEL_JSON, JSON.stringify(syncedVercelConfig(config, rules), null, 2) + '\n');
        console.log(`${inSync ? '✅ vercel.json already current' : '✍️  vercel.json updated'} (${scriptHashes.length} inline scripts)`);
        return 0;
    }
    console.log(`Inline scripts in public/index.html: ${scriptHashes.length}`);
    scriptHashes.forEach(h => console.log(`  ${h}`));
    console.log(inSync ? '✅ vercel.json is current' : '❌ vercel.json is out of date: run node tools/csp-hashes.js --write');
    return argv.includes('--check') && !inSync ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = { syncedVercelConfig, isInSync, VERCEL_JSON };
