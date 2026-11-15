/**
 * Hledání rozvrhu (návrh G) – nahrazuje rozbalovací seznam a typové záložky.
 *
 *  - jedno pole pro třídy, vyučující i učebny; výsledky seskupené
 *    Třídy / Vyučující / Učebny, hledá se bez ohledu na diakritiku a velikost;
 *  - na mobilu spodní panel přes celou výšku (#searchSheet), na počítači
 *    nabídka pod polem v postranním panelu; klávesa „/“ hledání otevře;
 *  - šipky mezi výsledky, Enter vybere, Esc zavře; hvězdička oblíbených je
 *    samostatné tlačítko vedle položky (ne uvnitř), aby šla ovládat zvlášť;
 *  - bez dotazu ukáže oblíbené, nedávné volby a všechny třídy.
 *
 * Veřejné API zůstává (main.js, timetable.js, modal.js, deeplink.js,
 * favorites-modal.js, calendar-sheet.js, timetable-tools.js):
 * initCustomDropdown, openDropdown, setDropdownValue, getDropdownValue,
 * populateDropdown, refreshDropdownHeartIndicator, setFavoritesAccessBtnUpdater.
 * Popisek vybraného rozvrhu je dál v #valueDropdownLabel.
 */
import { dom } from './dom.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';
import { isFavorite, toggleFavorite } from './favorites.js';
import { state, updateState } from './state.js';
import { esc, abbreviateTeacherName } from './utils.js';

const MOBILE_QUERY = '(max-width: 1079px)';
const RECENT_KEY = 'recentTimetables';
const RECENT_MAX = 6;
const GROUP_LIMIT = 30;

/** Druhy rozvrhů: nadpis skupiny, slovo u položky, ikona. */
const TYPES = {
    Class: { group: 'Třídy', word: 'třída', icon: 'graduation-cap', defs: 'classes', prefix: 'Třída' },
    Teacher: { group: 'Vyučující', word: 'vyučující', icon: 'user', defs: 'teachers', prefix: '' },
    Room: { group: 'Učebny', word: 'učebna', icon: 'door-open', defs: 'rooms', prefix: 'Učebna' },
};
const TYPE_ORDER = ['Class', 'Teacher', 'Room'];

const svg = (name, cls = '') => `<svg class="i${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="icons.svg#${name}"></use></svg>`;
const $ = (id) => document.getElementById(id);

// Will be replaced by real import once favorites-modal.js is available
let updateFavoritesAccessBtn = () => {};
export function setFavoritesAccessBtnUpdater(fn) { updateFavoritesAccessBtn = fn; }

let currentValue = '';
let changeCallback = null;
let menuOpen = false;          // počítač: nabídka pod polem
let typeItems = [];            // populateDropdown(): položky aktuálního druhu (kvůli kompatibilitě)
let statusTimer = null;
let suppressFocusOpen = false; // fokus vrácený do pole po zavření nabídku znovu neotevře

const isMobile = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(MOBILE_QUERY).matches;

/* ── data ──────────────────────────────────────────────────────────────── */

/** "Ukázková" i "ukazkova" i "UKÁZ" najdou totéž. */
export function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function allItems() {
    const defs = state.definitions || {};
    const out = [];
    for (const type of TYPE_ORDER) {
        for (const d of defs[TYPES[type].defs] || []) {
            if (!d || !d.id || !String(d.id).trim() || !d.name || !String(d.name).trim()) continue;
            out.push({ type, id: d.id, name: d.name, key: normalize(d.name) });
        }
    }
    return out;
}

function findItem(type, id) {
    const defs = (state.definitions || {})[TYPES[type] ? TYPES[type].defs : ''] || [];
    const d = defs.find(x => x.id === id);
    if (d) return { type, id, name: d.name, key: normalize(d.name) };
    const fromType = typeItems.find(x => x.value === id);
    return fromType ? { type, id, name: fromType.label, key: normalize(fromType.label) } : null;
}

/**
 * Pořadí shody: 0 celé jméno, 1 začátek jména, 2 začátek slova, 3 kdekoli; -1 nic.
 * U vyučujících se tak najde „ukáz“ i bez titulu.
 */
export function matchRank(key, q) {
    if (!q) return 3;
    if (key === q) return 0;
    if (key.startsWith(q)) return 1;
    if (key.split(/[\s.,-]+/).some(w => w.startsWith(q))) return 2;
    return key.includes(q) ? 3 : -1;
}

/** Výsledky hledání po skupinách. */
export function searchItems(items, query) {
    const q = normalize(query);
    const groups = {};
    for (const type of TYPE_ORDER) groups[type] = [];
    for (const it of items) {
        const r = matchRank(it.key, q);
        if (r < 0) continue;
        groups[it.type].push({ ...it, rank: r });
    }
    const collator = new Intl.Collator('cs', { numeric: true });
    for (const type of TYPE_ORDER) groups[type].sort((a, b) => a.rank - b.rank || collator.compare(a.name, b.name));
    return groups;
}

function readRecent() {
    try {
        const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        return Array.isArray(list) ? list.filter(x => x && TYPES[x.type] && x.id) : [];
    } catch { return []; }
}
function pushRecent(type, id) {
    const list = [{ type, id }, ...readRecent().filter(x => !(x.type === type && x.id === id))].slice(0, RECENT_MAX);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

/** Krátký název pro seznamy (vyučující bez titulu: „J. Ukázková“). */
function shortName(item) {
    if (item.type === 'Teacher') return abbreviateTeacherName(item.name, state.teacherAbbreviationMap) || item.name;
    return item.name;
}

/* ── vykreslení ─────────────────────────────────────────────────────────── */

function rowHtml(item, { showKind = false } = {}) {
    const t = TYPES[item.type];
    const fav = isFavorite(item.type, item.id);
    const selected = item.type === state.selectedType && item.id === currentValue;
    return `<li class="sr-row">
        <button type="button" class="sr-pick" data-type="${esc(item.type)}" data-id="${esc(item.id)}"${selected ? ' aria-current="true"' : ''}>
            ${svg(t.icon, 'sr-ico')}
            <span class="sr-name">${esc(item.name)}</span>
            ${showKind ? `<span class="sr-kind">${t.word}</span>` : ''}
            ${selected ? svg('check', 'sr-check') : ''}
        </button>
        <button type="button" class="sr-fav" data-type="${esc(item.type)}" data-id="${esc(item.id)}" aria-pressed="${fav}" aria-label="Oblíbené: ${esc(item.name)}" title="${fav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}">
            ${svg('star')}
        </button>
    </li>`;
}

function groupHtml(id, title, rows, extra = '') {
    if (!rows.length) return '';
    return `<section class="sr-group" aria-labelledby="sr-h-${id}">
        <h3 class="sr-h" id="sr-h-${id}">${esc(title)}</h3>
        <ul class="sr-list" role="list">${rows.join('')}</ul>${extra}
    </section>`;
}

function render() {
    const box = dom.valueDropdownMenu;
    if (!box) return;
    const input = $('searchInput');
    const query = input ? input.value : '';
    const items = allItems();
    let html = '';
    let count = 0;

    if (!normalize(query)) {
        const favs = (state.favoriteTimetables || []).map(f => findItem(f.type, f.id)).filter(Boolean);
        const recent = readRecent().map(r => findItem(r.type, r.id)).filter(Boolean)
            .filter(r => !isFavorite(r.type, r.id));
        html += groupHtml('fav', 'Oblíbené', favs.map(it => rowHtml(it, { showKind: true })));
        html += groupHtml('recent', 'Nedávné', recent.map(it => rowHtml(it, { showKind: true })));
        const classes = items.filter(it => it.type === 'Class');
        html += groupHtml('Class', 'Třídy', classes.map(it => rowHtml(it)));
        if (!favs.length) {
            html = `<p class="sr-hint">${svg('star')}<span>Hvězdičkou si rozvrh připneš do oblíbených. Učitele a učebny najdeš, když začneš psát.</span></p>` + html;
        }
        count = -1;
    } else {
        const groups = searchItems(items, query);
        for (const type of TYPE_ORDER) {
            const list = groups[type];
            count += list.length;
            const shown = list.slice(0, GROUP_LIMIT);
            const more = list.length - shown.length;
            html += groupHtml(type, TYPES[type].group, shown.map(it => rowHtml(it)),
                more > 0 ? `<p class="sr-more">a další ${more}, upřesni hledání</p>` : '');
        }
        if (!count) {
            html = `<div class="g-empty sr-empty">${svg('search')}<strong>Nic jsme nenašli pro „${esc(query.trim())}“</strong><span>Zkus jen část jména, třeba příjmení bez titulu, nebo číslo učebny.</span></div>`;
        }
    }
    box.innerHTML = html;
    announce(count, query);
}

function announce(count, query) {
    const status = $('searchStatus');
    if (!status) return;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
        if (count < 0) status.textContent = '';
        else if (!count) status.textContent = `Pro „${query.trim()}“ nic nenalezeno.`;
        else status.textContent = `Nalezeno ${count} ${count === 1 ? 'rozvrh' : count <= 4 ? 'rozvrhy' : 'rozvrhů'}.`;
    }, 400);
}

/** Oblíbené v postranním panelu (počítač). */
export function renderSideFavorites() {
    const list = $('sideFavs');
    if (!list) return;
    const favs = (state.favoriteTimetables || []).map(f => findItem(f.type, f.id)).filter(Boolean);
    if (!favs.length) {
        list.innerHTML = `<li class="side-empty">Hvězdičkou ve výsledcích hledání si sem připneš rozvrh.</li>`;
        return;
    }
    list.innerHTML = favs.map(it => {
        const t = TYPES[it.type];
        const selected = it.type === state.selectedType && it.id === currentValue;
        const name = it.type === 'Class' ? `Třída ${it.name}` : shortName(it);
        return `<li><button type="button" class="side-item" data-type="${esc(it.type)}" data-id="${esc(it.id)}"${selected ? ' aria-current="true"' : ''}>
            ${svg(t.icon)}<span class="side-item-name">${esc(name)}</span>${it.type !== 'Class' ? `<small>${t.word}</small>` : ''}
        </button></li>`;
    }).join('');
}

/* ── výběr ─────────────────────────────────────────────────────────────── */

/**
 * Vybere rozvrh (z hledání, z oblíbených v panelu, z přehledu) a načte ho.
 * @param {'Class'|'Teacher'|'Room'} type
 * @param {string} id
 */
export function selectTimetable(type, id) {
    if (!TYPES[type] || !id) return;
    const item = findItem(type, id);
    updateState('selectedType', type);
    setDropdownValue(id, item ? item.name : id);
    pushRecent(type, id);
    if (changeCallback) changeCallback();
}

function closeAll({ focusTrigger = false } = {}) {
    if (isMobile()) {
        closeBottomSheet('searchSheet');
    } else {
        closeMenu();
        if (focusTrigger) dom.valueDropdownTrigger?.focus();
    }
}

/* ── otevření / zavření ────────────────────────────────────────────────── */

function openMenu() {
    const box = dom.valueDropdownMenu;
    if (!box || isMobile()) return;
    if (!menuOpen) {
        menuOpen = true;
        render();
    }
    box.hidden = false;
    dom.valueDropdown?.classList.add('is-open');
}

function closeMenu() {
    const box = dom.valueDropdownMenu;
    if (!box || isMobile()) return;
    const input = $('searchInput');
    const hadFocus = box.contains(document.activeElement);
    menuOpen = false;
    box.hidden = true;
    dom.valueDropdown?.classList.remove('is-open');
    if (input) input.value = '';
    if (hadFocus && input) {
        suppressFocusOpen = true;
        input.focus();
        suppressFocusOpen = false;
    }
}

/** Otevře hledání: na mobilu panel, na počítači pole v postranním panelu s nabídkou. */
export function openDropdown() {
    const input = $('searchInput');
    if (isMobile()) {
        placeSearch();
        if (input) input.value = '';
        render();
        openBottomSheet('searchSheet', { fullHeight: true });
        // Fokus do pole hned po showModal(), dokud je to akce uživatele (klávesnice na iOS)
        if (input) input.focus({ preventScroll: true });
        return;
    }
    openMenu();
    if (input) input.focus();
}

/** Na mobilu je hledání v panelu, na počítači v postranním panelu. */
function placeSearch() {
    const box = dom.valueDropdown;
    const slot = $(isMobile() ? 'searchSlotSheet' : 'searchSlotSide');
    if (!box || !slot || box.parentElement === slot) return;
    slot.appendChild(box);
    const results = dom.valueDropdownMenu;
    if (results) results.hidden = !isMobile();
    menuOpen = false;
    dom.valueDropdown.classList.remove('is-open');
}

/* ── klávesnice ────────────────────────────────────────────────────────── */

const picks = () => [...(dom.valueDropdownMenu?.querySelectorAll('.sr-pick') || [])];

function onResultsKeydown(e) {
    const el = e.target;
    const list = picks();
    const i = list.indexOf(el.closest('.sr-row')?.querySelector('.sr-pick'));
    const input = $('searchInput');
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            (list[i + 1] || list[i])?.focus();
            break;
        case 'ArrowUp':
            e.preventDefault();
            if (i <= 0) input?.focus();
            else list[i - 1].focus();
            break;
        case 'Home':
            e.preventDefault();
            list[0]?.focus();
            break;
        case 'End':
            e.preventDefault();
            list[list.length - 1]?.focus();
            break;
        case 'ArrowRight':
            if (el.classList.contains('sr-pick')) { e.preventDefault(); el.parentElement.querySelector('.sr-fav')?.focus(); }
            break;
        case 'ArrowLeft':
            if (el.classList.contains('sr-fav')) { e.preventDefault(); el.parentElement.querySelector('.sr-pick')?.focus(); }
            break;
        case 'Escape':
            if (!isMobile()) { e.preventDefault(); closeMenu(); }
            break;
        default:
            // psaní kdekoli ve výsledcích pokračuje v poli
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && input) input.focus();
    }
}

function onInputKeydown(e) {
    const list = picks();
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isMobile()) openMenu();
        list[0]?.focus();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const first = picks()[0];
        if (first && normalize(e.target.value)) first.click();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        if (isMobile()) closeBottomSheet('searchSheet'); // jinak by Esc jen smazalo text pole
        else if (menuOpen) closeMenu();
        else e.target.blur();
    }
}

/** „/“ kdekoli mimo pole formuláře otevře hledání (jako v Kalendáři / na GitHubu). */
function onGlobalKeydown(e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector('dialog[open]')) return;
    if (document.documentElement.dataset.kiosk) return;
    e.preventDefault();
    openDropdown();
}

/* ── inicializace ──────────────────────────────────────────────────────── */

export function initCustomDropdown(onChangeCallback) {
    changeCallback = onChangeCallback;
    const input = $('searchInput');
    const results = dom.valueDropdownMenu;
    if (!input || !results) {
        console.error('Search elements not found');
        return;
    }

    placeSearch();
    if (window.matchMedia) {
        const mq = window.matchMedia(MOBILE_QUERY);
        const onChange = () => {
            const sheet = $('searchSheet');
            if (!mq.matches && sheet && sheet.open) closeBottomSheet('searchSheet');
            placeSearch();
        };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
    }

    input.addEventListener('input', () => {
        if (!isMobile()) openMenu();
        render();
    });
    input.addEventListener('focus', () => { if (!isMobile() && !suppressFocusOpen) openMenu(); });
    input.addEventListener('keydown', onInputKeydown);
    results.addEventListener('keydown', onResultsKeydown);

    results.addEventListener('click', async (e) => {
        const fav = e.target.closest('.sr-fav');
        if (fav) {
            e.preventDefault();
            await onToggleFavorite(fav);
            return;
        }
        const pick = e.target.closest('.sr-pick');
        if (pick) {
            closeAll({ focusTrigger: false });
            selectTimetable(pick.dataset.type, pick.dataset.id);
        }
    });

    // Počítač: klik mimo hledání nebo odchod tabulátorem nabídku zavře
    document.addEventListener('pointerdown', (e) => {
        if (menuOpen && !isMobile() && dom.valueDropdown && !dom.valueDropdown.contains(e.target)) closeMenu();
    });
    dom.valueDropdown?.addEventListener('focusout', (e) => {
        if (!menuOpen || isMobile()) return;
        if (e.relatedTarget && dom.valueDropdown.contains(e.relatedTarget)) return;
        if (!e.relatedTarget) return; // klik do prázdna řeší pointerdown
        closeMenu();
    });

    dom.valueDropdownTrigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        openDropdown();
    });
    $('searchFab')?.addEventListener('click', () => openDropdown());
    $('searchSheetClose')?.addEventListener('click', () => closeBottomSheet('searchSheet'));
    $('searchSheet')?.addEventListener('close', () => { if (input) input.value = ''; });

    // Oblíbené v postranním panelu
    $('sideFavs')?.addEventListener('click', (e) => {
        const item = e.target.closest('.side-item');
        if (item) selectTimetable(item.dataset.type, item.dataset.id);
    });

    document.addEventListener('keydown', onGlobalKeydown);
    renderSideFavorites();
}

async function onToggleFavorite(btn) {
    const { type, id } = btn.dataset;
    try {
        await toggleFavorite(type, id);
    } catch {
        console.error('Failed to toggle favorite');
    }
    const fav = isFavorite(type, id);
    // Stejná položka může být ve výsledcích víckrát (oblíbené, nedávné, třídy)
    dom.valueDropdownMenu?.querySelectorAll('.sr-fav').forEach(b => {
        if (b.dataset.type !== type || b.dataset.id !== id) return;
        b.setAttribute('aria-pressed', String(fav));
        b.title = fav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených';
    });
    renderSideFavorites();
    updateFavoritesAccessBtn();
    document.dispatchEvent(new CustomEvent('favoriteschanged'));
}

/* ── hodnota ───────────────────────────────────────────────────────────── */

function updateWho() {
    const t = TYPES[state.selectedType] || TYPES.Class;
    const use = $('whoIconUse');
    if (use) use.setAttribute('href', `icons.svg#${t.icon}`);
    const kind = $('whoKind');
    if (kind) {
        kind.textContent = t.prefix;
        kind.hidden = !t.prefix;
    }
}

/** Označí vybraný rozvrh ve výsledcích a v oblíbených. */
function markSelected() {
    renderSideFavorites();
    if (dom.valueDropdownMenu && (menuOpen || isMobile())) render();
}

export function refreshDropdownHeartIndicator() {
    renderSideFavorites();
    if (dom.valueDropdownMenu && (menuOpen || isMobile())) render();
}

/**
 * Položky aktuálního druhu (timetable.js populateValueSelect). Hledání čte
 * všechny druhy přímo z definic; tyto položky slouží jen k dohledání popisku.
 */
export function populateDropdown(items) {
    typeItems = Array.isArray(items) ? items : [];
    if (dom.valueDropdownMenu && (menuOpen || isMobile())) render();
    renderSideFavorites();
}

// Set dropdown value programmatically
export function setDropdownValue(value, label) {
    currentValue = value;
    if (dom.valueDropdownLabel) {
        if (label) {
            dom.valueDropdownLabel.textContent = label;
        } else {
            const item = findItem(state.selectedType, value);
            if (item) dom.valueDropdownLabel.textContent = item.name;
        }
    }
    updateWho();
    markSelected();
}

// Get current dropdown value
export function getDropdownValue() {
    return currentValue;
}
