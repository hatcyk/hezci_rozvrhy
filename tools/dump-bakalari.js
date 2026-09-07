#!/usr/bin/env node
/**
 * Diagnostic: log in to Bakaláři (BAKALARI_USERNAME / BAKALARI_PASSWORD) with the
 * same code prefetch uses, save the raw HTML of a few timetable pages and report
 * what the parser finds in them. Nothing is written to Firestore.
 *
 *   BAKALARI_USERNAME=... BAKALARI_PASSWORD=... node tools/dump-bakalari.js [outDir]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { loginToBakalari, fetchTimetableHtml } = require('../backend/prefetch');
const { parseTimetableHtml } = require('../backend/bakalari-parser');

const BASE = 'https://mot-spsd.bakalari.cz';
const outDir = process.argv[2] || path.join(__dirname, '..', 'debug_output');

(async () => {
    if (!process.env.BAKALARI_USERNAME || !process.env.BAKALARI_PASSWORD) {
        console.error('Set BAKALARI_USERNAME and BAKALARI_PASSWORD (env or .env)');
        process.exit(1);
    }
    fs.mkdirSync(outDir, { recursive: true });

    const cookie = await loginToBakalari();
    const pub = await axios.get(`${BASE}/Timetable/Public`, { headers: { Cookie: cookie } });
    fs.writeFileSync(path.join(outDir, 'public.html'), pub.data);
    const $ = cheerio.load(pub.data);
    const classes = $('#selectedClass option').map((_, o) => ({ id: $(o).attr('value'), name: $(o).text().trim() })).get().filter(c => c.id);
    console.log(`Timetable/Public: ${String(pub.data).length} bytes, classes in dropdown: ${classes.length}, title="${$('title').text().trim()}"`);

    const cls = classes.find(c => c.name === '3.A') || classes[0];
    if (!cls) { console.log('No classes found - see public.html'); return; }

    for (const schedule of ['Actual', 'Permanent', 'Next']) {
        const html = await fetchTimetableHtml('Class', cls.id, schedule);
        fs.writeFileSync(path.join(outDir, `class-${cls.name}-${schedule}.html`), html);
        const $$ = cheerio.load(html);
        const lessons = parseTimetableHtml(html);
        console.log(`\n${schedule}/Class/${cls.name}: ${String(html).length} bytes, ` +
            `.bk-timetable-row=${$$('.bk-timetable-row').length}, .day-item-hover=${$$('.day-item-hover').length}, ` +
            `[data-detail]=${$$('[data-detail]').length}, parsed lessons=${lessons.length}`);
        const sample = $$('[data-detail]').first().attr('data-detail');
        if (sample) console.log(`  sample data-detail: ${sample.slice(0, 220)}`);
        if (lessons.length === 0) {
            console.log(`  page text: ${$$('body').text().replace(/\s+/g, ' ').trim().slice(0, 300)}`);
        }
    }
    console.log(`\nHTML saved to ${outDir}`);
})().catch(err => { console.error(err.message); process.exit(1); });
