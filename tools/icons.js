/**
 * Sada ikon návrhu G: z balíčku lucide-static (licence ISC) poskládá SVG sprite public/icons.svg.
 * Použití v HTML/JS:  <svg class="i" aria-hidden="true"><use href="icons.svg#calendar-days"></use></svg>
 * Novou ikonu přidej do seznamu ICONS a spusť:  node tools/icons.js
 * Přehled názvů: https://lucide.dev/icons/
 */
const fs = require('fs');
const path = require('path');

const ICONS = [
    // navigace a pohledy
    'calendar-days', 'calendar-range', 'calendar-plus', 'repeat-2', 'door-open', 'users', 'search', 'settings',
    'house', 'sun', 'moon', 'sun-moon', 'layers',
    // rozvržení
    'calendar', 'list', 'rectangle-vertical', 'gallery-vertical-end', 'columns-3',
    // stavy hodin
    'ban', 'clock', 'arrow-right', 'arrow-left-right', 'flag', 'circle-plus', 'circle-alert', 'info', 'triangle-alert',
    // ovládání
    'x', 'check', 'chevron-left', 'chevron-right', 'chevron-down', 'chevron-up', 'ellipsis', 'plus', 'minus',
    'filter', 'share-2', 'printer', 'bell', 'bell-off', 'bell-ring', 'star', 'heart', 'refresh-cw', 'wifi-off',
    'pause', 'play', 'maximize', 'external-link', 'copy', 'trash-2', 'eye', 'eye-off', 'log-out', 'lock',
    // entity
    'graduation-cap', 'user', 'school', 'map-pin', 'history', 'sparkles', 'smartphone', 'download',
    // admin
    'activity', 'database', 'server', 'chart-line', 'circle-check', 'circle-x',
    // kiosk, sdílení, nastavení, společné volno, o aplikaci
    'tv', 'share', 'link', 'user-plus', 'sunrise', 'contrast', 'monitor-smartphone', 'code',
];

const dir = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');
// ISC requires the copyright and permission notice in every copy: the sprite carries it.
const license = fs.readFileSync(path.join(dir, '..', 'LICENSE'), 'utf8').trim().replace(/--/g, '- -');
const out = path.join(__dirname, '..', 'public', 'icons.svg');

const symbols = ICONS.map((name) => {
    const file = path.join(dir, `${name}.svg`);
    if (!fs.existsSync(file)) throw new Error(`ikona ${name} v lucide-static není`);
    const svg = fs.readFileSync(file, 'utf8');
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '');
    return `<symbol id="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>`;
});

fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg"><!-- Ikony Lucide (https://lucide.dev), generuje tools/icons.js.\n\n${license}\n-->\n${symbols.join('\n')}\n</svg>\n`);
console.log(`icons.svg: ${ICONS.length} ikon, ${fs.statSync(out).size} B`);
