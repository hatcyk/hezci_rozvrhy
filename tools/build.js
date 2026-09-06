/**
 * Build script: bundles + minifies the frontend CSS and JS into
 *   public/css/app.css  and  public/js/app.js
 * and stamps a content hash (?v=…) into index.html and the service worker
 * so browsers and the SW precache always pick up a fresh bundle.
 *
 * Source files in public/css and public/js stay untouched; the bundles are
 * committed so the deploy needs no build step.
 *
 * Run:  npm run build
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC = path.join(__dirname, '..', 'public');

// Same order as the original <link> tags in index.html (main.css first,
// which itself @imports variables/base/header/... in order).
const CSS_ORDER = [
    'main.css',
    'theme-warning.css',
    'notifications.css',
    'toast.css',
    'timetable-extras.css',
    'settings.css',
    'layout-modal.css',
    'layout-card-view.css',
    'layout-compact-list.css',
    'outage.css',
    'footer.css',
    'favorites.css',
];

function hashFile(file) {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
}

function replaceOrThrow(text, regex, replacement, label) {
    if (!regex.test(text)) throw new Error(`build: could not find ${label} to rewrite`);
    return text.replace(regex, replacement);
}

async function main() {
    const cssOut = path.join(PUBLIC, 'css', 'app.css');
    const jsOut = path.join(PUBLIC, 'js', 'app.js');

    await esbuild.build({
        stdin: {
            contents: CSS_ORDER.map((f) => `@import url('${f}');`).join('\n'),
            resolveDir: path.join(PUBLIC, 'css'),
            loader: 'css',
        },
        bundle: true,
        minify: true,
        legalComments: 'none',
        outfile: cssOut,
        logLevel: 'warning',
    });

    await esbuild.build({
        entryPoints: [path.join(PUBLIC, 'js', 'main.js')],
        bundle: true,
        format: 'esm',
        target: ['es2020'],
        minify: true,
        sourcemap: true,
        legalComments: 'none',
        outfile: jsOut,
        logLevel: 'warning',
    });

    const cssHash = hashFile(cssOut);
    const jsHash = hashFile(jsOut);
    const shellVersion = `${cssHash}-${jsHash}`;

    // index.html: <link href="css/app.css?v=…"> and <script src="js/app.js?v=…">
    const indexPath = path.join(PUBLIC, 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');
    html = replaceOrThrow(html, /css\/app\.css(\?v=[a-f0-9]+)?/g, `css/app.css?v=${cssHash}`, 'css/app.css link');
    html = replaceOrThrow(html, /js\/app\.js(\?v=[a-f0-9]+)?/g, `js/app.js?v=${jsHash}`, 'js/app.js script');
    fs.writeFileSync(indexPath, html);

    // Service worker: precache URLs + cache name (a new name triggers re-precache).
    const swPath = path.join(PUBLIC, 'firebase-messaging-sw.js');
    let sw = fs.readFileSync(swPath, 'utf8');
    sw = replaceOrThrow(sw, /'\/css\/app\.css(\?v=[a-f0-9]+)?'/g, `'/css/app.css?v=${cssHash}'`, 'SW css precache entry');
    sw = replaceOrThrow(sw, /'\/js\/app\.js(\?v=[a-f0-9]+)?'/g, `'/js/app.js?v=${jsHash}'`, 'SW js precache entry');
    sw = replaceOrThrow(sw, /const SHELL_CACHE = '[^']+';/, `const SHELL_CACHE = 'bakalari-shell-${shellVersion}';`, 'SHELL_CACHE');
    fs.writeFileSync(swPath, sw);

    const kb = (f) => (fs.statSync(f).size / 1024).toFixed(1) + ' KB';
    console.log(`✅ css/app.css  ${kb(cssOut)}  (v=${cssHash})`);
    console.log(`✅ js/app.js    ${kb(jsOut)}  (v=${jsHash})`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
