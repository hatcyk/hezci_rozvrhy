/**
 * Návrh G: čisté pomocné funkce rozvrhu (bez DOM), sdílené přehledem, dnem,
 * týdnem, seznamem, kartami a detailem hodiny. Testované v Node
 * (test/client-rozvrh.test.js).
 *
 *  - stav hodiny jako ikona + slovo (suplování, jiná učebna, odpadá, akce, přidaná hodina),
 *  - sloty hodin (dělené hodiny vedle sebe, škrtnutý originál suplování schovaný),
 *  - časy ve skutečném měřítku (lessonTimes),
 *  - české datumy a věta o změnách dne.
 */

import { lessonTimes } from './constants.js';
import { esc, standardizeGroupName, abbreviateTeacherName, parseGroupName } from './utils.js';
import { mergeChangeItems, czPlural, originalFromDescription, classifyPair } from './changes-core.js';

/* ── ikony ze spritu ────────────────────────────────────────────────────── */

/** <svg class="i"> ze spritu icons.svg (dekorativní, čtečka ji přeskočí). */
export function icon(name, cls = '') {
    return `<svg class="i${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="icons.svg#${esc(name)}"></use></svg>`;
}

/* ── stav hodiny ────────────────────────────────────────────────────────── */

/** Stav = ikona + slovo; barevná je jen ikona (nebo proužek), slovo zůstává bílé. */
export const KINDS = {
    sub: { word: 'suplování', icon: 'repeat-2', bar: 'sub' },
    room: { word: 'jiná učebna', icon: 'door-open', bar: 'room' },
    cancel: { word: 'odpadá', icon: 'ban', bar: 'cancel' },
    extra: { word: 'akce', icon: 'flag', bar: 'extra' },
    added: { word: 'přidaná hodina', icon: 'circle-plus', bar: 'extra' },
    changed: { word: 'změna', icon: 'info', bar: 'extra' },
};

const isCancelled = (l) => !!l && (l.type === 'removed' || l.type === 'absent');
const descOf = (l) => (l && l.changeInfo && l.changeInfo.description) || '';

/** Druh stavu podle poznámky Bakalářů ('' = nic zvláštního). */
function kindFromText(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return '';
    if (t.includes('suplov')) return 'sub';
    if (/místnost|učebn/.test(t)) return 'room';
    if (/přidan|navíc|mimořádn/.test(t)) return 'added';
    return '';
}

/**
 * Stav jedné hodiny: '' (beze změny) | sub | room | cancel | extra | added | changed.
 * @param {Object} lesson
 * @param {Object|null} [before] - škrtnutý originál ze stejného slotu (suplování)
 */
export function lessonKind(lesson, before = null) {
    if (!lesson) return '';
    if (lesson.type === 'absent') return 'extra';
    if (lesson.type === 'removed') return 'cancel';
    if (!lesson.changed) return '';
    if (before) {
        const k = classifyPair(before, lesson);
        if (k === 'substitution') return 'sub';
        if (k === 'roomChange') return 'room';
    }
    const fromText = kindFromText(descOf(lesson));
    if (fromText) return fromText;
    const orig = originalFromDescription(descOf(lesson));
    if (orig) {
        const k = classifyPair(orig, lesson);
        if (k === 'substitution') return 'sub';
        if (k === 'roomChange') return 'room';
    }
    return 'changed';
}

/** Druh položky změn (changes-core mergeChangeItems) v řeči návrhu G. */
export function entryKind(entry) {
    switch (entry && entry.kind) {
        case 'substitution': return 'sub';
        case 'roomChange': return 'room';
        case 'removed': return 'cancel';
        case 'absent': return 'extra';
        default: {
            const item = entry && entry.items && entry.items[0];
            return kindFromText(descOf(item)) || 'changed';
        }
    }
}

/** HTML stavu: ikona + slovo (g-st). */
export function statusHtml(kind, { now = false, cls = '' } = {}) {
    if (now) return `<span class="g-st g-st--now${cls ? ` ${cls}` : ''}">${icon('clock')}teď</span>`;
    const k = KINDS[kind];
    if (!k) return '';
    return `<span class="g-st g-st--${k.bar}${cls ? ` ${cls}` : ''}">${icon(k.icon)}${esc(k.word)}</span>`;
}

/* ── sloty ──────────────────────────────────────────────────────────────── */

const groupNum = (l) => {
    const m = String(l.group || '').match(/(\d+)\s*\.?\s*sk/i);
    if (m) return parseInt(m[1], 10);
    return l.group ? 998 : 0;
};
const groupKeyOf = (l) => String(l.group || '').toLowerCase().replace(/\s+/g, '');

/** "1.sk" → "1. sk", "2.A celá" → "" (celá třída), jinak původní text. */
export function groupText(group) {
    if (!group) return '';
    const parsed = parseGroupName(group);
    const raw = parsed ? parsed.groupName : group;
    const std = standardizeGroupName(raw);
    if (!std) return '';
    return std.replace(/^(\d+)\.sk$/i, '$1. sk');
}

/**
 * Hodiny jednoho slotu (den + hodina) tak, jak se zobrazí: škrtnutý originál
 * suplování ve stejné skupině se schová a připojí jako `before`, skupiny jsou
 * seřazené (celá třída, 1. sk, 2. sk …). Každá položka: { lesson, kind, before }.
 * @param {Array} rows - všechny řádky slotu
 */
export function slotLessons(rows) {
    const list = (rows || []).filter(Boolean);
    const out = [];
    const used = new Set();
    for (const l of list) {
        if (l.type !== 'removed') continue;
        // náhrada ve stejné skupině → originál se nezobrazuje samostatně
        const repl = list.find(o => o !== l && groupKeyOf(o) === groupKeyOf(l) && !isCancelled(o));
        if (repl) used.add(l);
    }
    for (const l of list) {
        if (used.has(l)) continue;
        const before = isCancelled(l) ? null
            : list.find(o => used.has(o) && groupKeyOf(o) === groupKeyOf(l)) || null;
        out.push({ lesson: l, kind: lessonKind(l, before), before });
    }
    out.sort((a, b) => groupNum(a.lesson) - groupNum(b.lesson)
        || String(a.lesson.group || '').localeCompare(String(b.lesson.group || ''), 'cs'));
    return out;
}

/**
 * Lekce jednoho dne po hodinách: Map(hour → slotLessons), seřazené.
 * @param {Array} data - lekce týdne
 * @param {number} day - 0 = pondělí
 */
export function daySlots(data, day) {
    const byHour = new Map();
    for (const l of data || []) {
        if (!l || l.day !== day) continue;
        if (!byHour.has(l.hour)) byHour.set(l.hour, []);
        byHour.get(l.hour).push(l);
    }
    return new Map([...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([h, rows]) => [h, slotLessons(rows)]));
}

/* ── čas ────────────────────────────────────────────────────────────────── */

const timeOf = (hour) => lessonTimes.find(t => t.hour === hour) || null;
export const startMin = (hour) => { const t = timeOf(hour); return t ? t.start[0] * 60 + t.start[1] : null; };
export const endMin = (hour) => { const t = timeOf(hour); return t ? t.end[0] * 60 + t.end[1] : null; };
/** 480 → "8:00" */
export const fmtMin = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
/** "8:00–8:45" */
export const hourRange = (hour) => { const s = startMin(hour), e = endMin(hour); return s == null ? '' : `${fmtMin(s)}–${fmtMin(e)}`; };
export const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

/**
 * Časový rozsah zobrazených hodin (od začátku první do konce poslední),
 * zaokrouhlený na celé čtvrthodiny kvůli čitelné ose.
 * @param {number[]} hours
 * @returns {{ start: number, end: number, range: number } | null}
 */
export function timeRange(hours) {
    const known = (hours || []).filter(h => timeOf(h));
    if (!known.length) return null;
    const start = Math.min(...known.map(startMin));
    const end = Math.max(...known.map(endMin));
    return { start, end, range: end - start };
}

/** Celé hodiny na ose v rozsahu (8:00, 9:00 …). */
export function axisHours({ start, end }) {
    const out = [];
    for (let m = Math.ceil(start / 60) * 60; m <= end; m += 60) out.push(m);
    return out;
}

/* ── datumy ─────────────────────────────────────────────────────────────── */

export const DAY_NAMES = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek'];
export const DAY_SHORT = ['Po', 'Út', 'St', 'Čt', 'Pá'];
const MONTHS_GEN = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
const WEEKDAY_IN = ['v neděli', 'v pondělí', 'v úterý', 've středu', 've čtvrtek', 'v pátek', 'v sobotu'];

/** Date → "4. listopadu" */
export const czDate = (d) => `${d.getDate()}. ${MONTHS_GEN[d.getMonth()]}`;
/** Date → "ve středu" */
export const czWeekdayIn = (d) => WEEKDAY_IN[d.getDay()];

/** Pondělí (Date, 0:00) + n dní */
export function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

/** "Týden 2.–6. listopadu" (přes hranici měsíce "Týden 30. listopadu – 4. prosince"). */
export function weekTitle(monday) {
    if (!monday) return 'Stálý rozvrh';
    const fri = addDays(monday, 4);
    if (monday.getMonth() === fri.getMonth()) return `Týden ${monday.getDate()}.–${fri.getDate()}. ${MONTHS_GEN[fri.getMonth()]}`;
    return `Týden ${czDate(monday)} – ${czDate(fri)}`;
}

/** Datum dne v týdnu z lekcí (pole `date`, smlouva S2) nebo z pondělí. */
export function weekMonday(data, fallbackMonday) {
    const dated = (data || []).find(l => l && l.date && /^\d{4}-\d{2}-\d{2}$/.test(l.date));
    if (dated) {
        const [y, m, d] = dated.date.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return addDays(date, -dated.day);
    }
    return fallbackMonday || null;
}

/* ── texty ──────────────────────────────────────────────────────────────── */

/** "a" před poslední položkou: ["a", "b", "c"] → "a, b a c" */
export function joinCz(parts) {
    const p = parts.filter(Boolean);
    if (p.length <= 1) return p.join('');
    return `${p.slice(0, -1).join(', ')} a ${p[p.length - 1]}`;
}

const ENTRY_PHRASE = {
    sub: 'suplování',
    room: 'v jiné učebně',
    cancel: 'odpadá',
    extra: 'akce',
    added: 'přidaná hodina',
    changed: 'změna',
};

/** Změny jednoho dne (lekce s příznakem) jako položky changes-core. */
export function dayChangeEntries(dayLessons) {
    const flagged = (dayLessons || []).filter(l => l && (l.changed || isCancelled(l)))
        .sort((a, b) => a.hour - b.hour);
    return mergeChangeItems(flagged, (l) => `${l.day}|${l.hour}`);
}

/**
 * Věta jako v Počasí: "Dnes 4 změny: 3. hodina suplování, 4. hodina v jiné
 * učebně, 5. hodina odpadá a 6. hodina suplování pro 1. sk."
 * @param {Array} entries - dayChangeEntries
 * @param {string} [when] - "Dnes" / "Zítra" / "Ve čtvrtek"
 */
export function changesSentence(entries, when = 'Dnes') {
    if (!entries || !entries.length) return `${when} beze změn, platí stálý rozvrh.`;
    const parts = entries.map(e => {
        const g = groupText(e.group);
        // nezlomitelná mezera: „4. hodina“ ani „1. sk“ se nerozdělí na dva řádky
        return `${e.hour}.\u00a0hodina ${ENTRY_PHRASE[entryKind(e)]}${g ? ` pro ${g.replace(/\. /, '.\u00a0')}` : ''}`;
    });
    return `${when} ${czPlural(entries.length, ['změna', 'změny', 'změn'])}: ${joinCz(parts)}.`;
}

/** Krátké jméno vyučujícího ("M. Cvičná"). */
export const teacherShort = (name, map) => (name ? abbreviateTeacherName(name, map) : '');

/** Třída z pole group u rozvrhu vyučujícího / učebny ("2.A 1.sk" → "2.A"). */
export function classOf(lesson) {
    const p = parseGroupName(lesson && lesson.group);
    return p ? p.classId : '';
}

export { isCancelled };
