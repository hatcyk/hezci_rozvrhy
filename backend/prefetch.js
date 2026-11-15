/**
 * Prefetch Module
 * Downloads all timetable data from Bakalari API and stores in Firebase
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { getFirestore } = require('./firebase-admin-init');
const { detectTimetableChanges, selectComparisonBaseline } = require('./change-detector');
const { parseTimetablePage, standardizeGroupName, addRemovedLessonsFromPermanent } = require('./bakalari-parser');
const { buildChangesAggregate, buildFreeRoomsAggregate, sameAggregateContent, stableStringify } = require('./aggregates');
const { formatPragueTime } = require('./timezone-manager');

// Configuration
const BAKALARI_BASE_URL = 'https://mot-spsd.bakalari.cz';
// Bakaláři is the school's production server shared with every pupil and teacher;
// 3 parallel requests are gentle on it everywhere (the default used to be 20
// outside Vercel). PREFETCH_CONCURRENCY still overrides it.
const DEFAULT_CONCURRENCY = 3;
const CONCURRENT_REQUESTS = parseInt(process.env.PREFETCH_CONCURRENCY, 10) || DEFAULT_CONCURRENCY;
const MAX_RETRIES = 3; // attempts per page / login, network errors only
const DEFAULT_RETRY_DELAY_MS = process.env.VERCEL ? 2000 : 1000;
const MAX_RETRY_DELAY_MS = 30000;
const SCHEDULE_TYPES = ['Actual', 'Permanent', 'Next'];
const AGGREGATE_COLLECTION = 'aggregates';
// { date: 'YYYY-MM-DD' (Prague) of the last daily re-check of the permanent
//   schedules, checkedAt, pending: [docKey] that failed and are retried }
const PERMANENT_REFRESH_DOC = ['system', 'permanentRefresh'];

// Browser-like by default (unchanged behaviour); an operator can identify the
// bot honestly with BAKALARI_USER_AGENT (see ZMENY.md for the reasoning).
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Settings a test can override for one run (prefetchAllData({ retryDelayMs }))
const runtime = { retryDelayMs: DEFAULT_RETRY_DELAY_MS };

// Disable keep-alive in serverless environments
const httpAgent = process.env.VERCEL ? new (require('http').Agent)({ keepAlive: false, timeout: 60000 }) : undefined;
const httpsAgent = process.env.VERCEL ? new (require('https').Agent)({ keepAlive: false, timeout: 60000, rejectUnauthorized: true }) : undefined;

/** Axios config; headers built per request so BAKALARI_USER_AGENT set at runtime is honoured. */
function requestConfig(extraHeaders = {}) {
    return {
        timeout: 60000, // 60 second timeout (slow Bakalari responses)
        headers: {
            'User-Agent': process.env.BAKALARI_USER_AGENT || DEFAULT_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'cs,en;q=0.9',
            'Connection': 'close', // Force close connections in serverless
            ...extraHeaders,
        },
        httpAgent,
        httpsAgent,
    };
}

/** Rejected credentials / session: retrying will not help (and could lock the account). */
class BakalariLoginError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BakalariLoginError';
        this.code = 'BAKALARI_LOGIN_FAILED';
    }
}

// Cache for session cookie (valid for the duration of prefetch run)
let cachedSessionCookie = null;
// Bumped with every successful login, so a request knows whether the session
// it used is still the current one.
let sessionGeneration = 0;
// The one mid-run re-login of this run (a promise), see renewSession().
let sessionRenewal = null;

/**
 * Set-Cookie headers → { name: value }. Splits at the FIRST "=" only: session
 * cookies are often base64 with "=" padding, which the old split('=') cut off.
 */
function parseSetCookies(setCookieHeaders) {
    const cookies = {};
    for (const header of [].concat(setCookieHeaders || [])) {
        const [nameValue] = String(header).split(';');
        const eq = nameValue.indexOf('=');
        if (eq <= 0) continue;
        cookies[nameValue.slice(0, eq).trim()] = nameValue.slice(eq + 1).trim();
    }
    return cookies;
}

/** True when an HTML page contains a password field, i.e. it is (again) the login form. */
function looksLikeLoginPage(html) {
    if (typeof html !== 'string' || html === '') return false;
    const $ = cheerio.load(html);
    return $('input[type="password"], input[name="password"]').length > 0;
}

/**
 * Decide whether the POST /login response means "logged in".
 * The old code printed "Login successful" for any status < 400, so wrong
 * credentials only surfaced later as "0 definitions". Failure when:
 *  - the server redirects back to /login,
 *  - it answers with the login form again,
 *  - it does not set any cookie (no session to send with the next requests).
 * @param {{ status: Number, headers: Object, data: any }} response - axios response (maxRedirects: 0)
 * @returns {{ ok: Boolean, reason?: String }}
 */
function assessLoginResponse(response) {
    const headers = (response && response.headers) || {};
    const status = response ? response.status : 0;
    const location = String(headers.location || '');

    if (status >= 300 && status < 400 && /\/login(?:[/?#]|$)/i.test(location)) {
        return { ok: false, reason: `redirected back to ${location}` };
    }
    if (looksLikeLoginPage(response && response.data)) {
        return { ok: false, reason: 'login form returned again (wrong username or password?)' };
    }
    if (Object.keys(parseSetCookies(headers['set-cookie'])).length === 0) {
        return { ok: false, reason: 'no session cookie in the response' };
    }
    return { ok: true };
}

/**
 * Login to Bakalari and get fresh session cookie
 * @returns {Promise<string>} Cookie string for authenticated requests
 */
async function loginToBakalari(retries = MAX_RETRIES) {
    // Return cached cookie if available
    if (cachedSessionCookie) {
        return cachedSessionCookie;
    }

    const username = process.env.BAKALARI_USERNAME;
    const password = process.env.BAKALARI_PASSWORD;

    if (!username || !password) {
        throw new BakalariLoginError('BAKALARI_USERNAME and BAKALARI_PASSWORD must be set in environment');
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`🔐 Logging in to Bakalari... (attempt ${attempt}/${retries})`);

            // Step 1: GET login page to get CSRF token and initial cookies
            const loginPageResponse = await axios.get(`${BAKALARI_BASE_URL}/login`, {
                ...requestConfig(),
                maxRedirects: 0,
                validateStatus: (status) => status < 400
            });

            const cookies = parseSetCookies(loginPageResponse.headers['set-cookie']);

            // Parse HTML to get CSRF token
            const $ = cheerio.load(String(loginPageResponse.data || ''));
            const csrfToken = $('input[name="__RequestVerificationToken"]').val();

            // Step 2: POST login form
            const loginData = new URLSearchParams({
                'username': username,
                'password': password,
                '__RequestVerificationToken': csrfToken || ''
            });

            const loginResponse = await axios.post(`${BAKALARI_BASE_URL}/login`, loginData, {
                ...requestConfig({
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
                }),
                maxRedirects: 0,
                validateStatus: (status) => status < 400
            });

            const verdict = assessLoginResponse(loginResponse);
            if (!verdict.ok) {
                throw new BakalariLoginError(`Bakalari login rejected: ${verdict.reason}`);
            }

            Object.assign(cookies, parseSetCookies(loginResponse.headers['set-cookie']));
            const cookieString = Object.entries(cookies)
                .map(([name, value]) => `${name}=${value}`)
                .join('; ');

            console.log('✅ Login successful');

            // Cache the cookie for this prefetch run
            cachedSessionCookie = cookieString;
            sessionGeneration++;

            return cookieString;

        } catch (error) {
            if (error.code === 'BAKALARI_LOGIN_FAILED') {
                console.error(`❌ ${error.message}`);
                throw error;
            }

            const isLastAttempt = attempt === retries;
            const errorMsg = error.code === 'ECONNRESET' ? 'Connection reset by server' : error.message;

            console.error(`❌ Login attempt ${attempt}/${retries} failed: ${errorMsg}`);

            if (isLastAttempt) {
                const wrapped = new Error(`Bakalari login failed after ${retries} attempts: ${error.message}`, { cause: error });
                wrapped.code = error.code;
                throw wrapped;
            }

            const delay = retryDelay(error, attempt);
            console.log(`⏳ Waiting ${delay}ms before retry...`);
            await sleep(delay);
        }
    }
}

/**
 * Sleep utility for throttling
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Network trouble or an overloaded server may pass; a 4xx answer will not. */
function isRetryable(error) {
    if (!error || error.code === 'BAKALARI_LOGIN_FAILED') return false;
    if (!error.response) return true; // timeout, reset, DNS …
    const status = error.response.status;
    return status === 429 || status >= 500;
}

/** Exponential backoff (base, 2×base, …), honouring Retry-After up to 30 s. */
function retryDelay(error, attempt) {
    const base = runtime.retryDelayMs * 2 ** (attempt - 1);
    const retryAfter = Number(error && error.response && error.response.headers && error.response.headers['retry-after']);
    const wanted = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(base, retryAfter * 1000) : base;
    return Math.min(wanted, MAX_RETRY_DELAY_MS);
}

/**
 * GET with retries on network errors, 429 and 5xx (not on other 4xx).
 * @returns {Promise<import('axios').AxiosResponse>}
 */
async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await axios.get(url, options);
        } catch (error) {
            if (attempt >= retries || !isRetryable(error)) throw error;
            const delay = retryDelay(error, attempt);
            console.warn(`Retry ${attempt}/${retries - 1} for ${url} in ${delay} ms: ${error.message}`);
            await sleep(delay);
        }
    }
}

/**
 * The definitions page fetched with our session turned out to be the login form
 * (axios followed a redirect to /login) → the session was not accepted. Without
 * this the run ended as "0 definitions", hiding the real cause.
 */
function isLoginPageResponse(response) {
    let finalPath = '';
    try {
        finalPath = new URL(String(response.request?.res?.responseUrl || ''), BAKALARI_BASE_URL).pathname;
    } catch { /* no usable final URL */ }
    const html = typeof response.data === 'string' ? response.data : '';
    // A page that has the class picker is the right page, whatever else it contains.
    const hasPicker = html.includes('selectedClass');
    return /^\/login(?:\/|$)/i.test(finalPath) || (!hasPicker && looksLikeLoginPage(html));
}

function assertNotLoginPage(response, what) {
    if (isLoginPageResponse(response)) {
        cachedSessionCookie = null;
        throw new BakalariLoginError(`Bakalari returned the login page for ${what} - session not accepted`);
    }
}

/**
 * A timetable page came back as the login form: the session expired in the
 * middle of the run. Log in again - ONCE per run, shared by the requests in
 * flight - so one expiry does not cost the rest of the run, and a server that
 * keeps refusing the session is not hit with a login per page.
 * @param {Number} usedGeneration - sessionGeneration the failed request was sent with
 * @returns {Promise<Boolean>} true when there is a newer session to retry with
 */
async function renewSession(usedGeneration) {
    if (sessionGeneration === usedGeneration) {
        if (!sessionRenewal) {
            console.warn('⚠️  Bakaláři returned the login page mid-run - logging in again (once)');
            cachedSessionCookie = null;
            sessionRenewal = loginToBakalari().catch((error) => {
                console.error(`❌ Re-login failed: ${error.message}`);
            });
        }
        await sessionRenewal;
    }
    return sessionGeneration !== usedGeneration;
}

const NETWORK_CODES = new Set([
    'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN',
    'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'ERR_NETWORK', 'ERR_SOCKET_CONNECTION_TIMEOUT', 'ERR_BAD_RESPONSE',
]);

/**
 * Map an error to the S4 run status.
 * @returns {'login_failed'|'network'|'error'}
 */
function classifyError(error) {
    if (!error) return 'error';
    if (error.code === 'BAKALARI_LOGIN_FAILED') return 'login_failed';
    const cause = error.cause || error;
    if (NETWORK_CODES.has(error.code) || NETWORK_CODES.has(cause.code)) return 'network';
    const response = cause.response || error.response;
    if (response && (response.status >= 500 || response.status === 429)) return 'network';
    return 'error';
}

// A run in which more than this share of the timetables was not refreshed
// (download errors + empty pages whose old snapshot was kept) is 'partial',
// not 'ok': system/health.lastSuccessAt stays where it was, so /api/status
// reports the data as stale once the age limit passes. A few failing pages are
// everyday noise and must not raise an alarm.
const PARTIAL_FAILURE_RATIO = 0.1;

/**
 * S4 status of a run that got as far as downloading timetables.
 * @param {{ totalRequests: Number, errorCount: Number, emptyGuarded: Number }} stats
 * @param {Error|null} [lastError] - decides the status when every task failed
 * @returns {'ok'|'partial'|'login_failed'|'network'|'error'}
 */
function runStatus({ totalRequests = 0, errorCount = 0, emptyGuarded = 0 }, lastError = null) {
    // Every single timetable failed → an outage, not a successful run.
    if (totalRequests > 0 && errorCount === totalRequests) return classifyError(lastError);
    return errorCount + emptyGuarded > totalRequests * PARTIAL_FAILURE_RATIO ? 'partial' : 'ok';
}

/**
 * Fetch definitions (classes, teachers, rooms) from Bakalari
 * Same logic as current /api/definitions endpoint
 */
async function fetchDefinitions() {
    try {
        // Get fresh login cookie
        const cookie = await loginToBakalari();

        const url = `${BAKALARI_BASE_URL}/Timetable/Public/Actual/Class/ZL`;
        const response = await fetchWithRetry(url, requestConfig({ Cookie: cookie }));
        assertNotLoginPage(response, 'definitions');

        const $ = cheerio.load(response.data);

        // Extract classes
        const classes = [];
        $('#selectedClass option').each((i, el) => {
            const value = $(el).attr('value');
            const text = $(el).text().trim();
            if (value && text) {
                classes.push({ id: value, name: text });
            }
        });

        // Extract teachers
        const teachers = [];
        $('#selectedTeacher option').each((i, el) => {
            let value = $(el).attr('value');
            const text = $(el).text().trim();
            // If ID is empty but name exists, use name as ID (same as /api/definitions)
            if ((!value || value.trim() === '') && text) {
                value = text;
            }
            if (value && text) {
                teachers.push({ id: value, name: text });
            }
        });

        // Extract rooms
        const rooms = [];
        $('#selectedRoom option').each((i, el) => {
            const value = $(el).attr('value');
            const text = $(el).text().trim();
            if (value && text) {
                rooms.push({ id: value, name: text });
            }
        });

        return { classes, teachers, rooms };
    } catch (error) {
        console.error('Failed to fetch definitions:', error.message);
        throw error;
    }
}

/**
 * Fetch single timetable from Bakalari API
 */
async function fetchTimetableHtml(type, id, scheduleType, date = null) {
    let url = `${BAKALARI_BASE_URL}/Timetable/Public/${scheduleType}/${type}/${id}`;
    if (date) {
        url += `?date=${date}`;
    }

    for (let attempt = 1; ; attempt++) {
        // Get fresh login cookie (cached during prefetch run)
        const cookie = await loginToBakalari();
        const generation = sessionGeneration;

        const response = await fetchWithRetry(url, requestConfig({ Cookie: cookie }));
        // HTTP 200 with the login form parsed as "0 lessons", the single-page
        // guard kept the old snapshot and the run still counted it as a success.
        if (!isLoginPageResponse(response)) return response.data;
        if (attempt > 1 || !(await renewSession(generation))) {
            throw new BakalariLoginError(`Bakalari returned the login page for ${type}/${id}/${scheduleType} - session not accepted`);
        }
    }
}

// Logged once per run so a markup change / unpublished timetable is visible in the log
let emptyPageDiagnosticLogged = false;

/**
 * Download and parse one timetable page.
 * @returns {Promise<{ lessons: Array, weekStart: String|null, allDaysOff: Boolean, hours: Array<Number> }>}
 */
async function fetchTimetablePage(type, id, scheduleType, { now = new Date() } = {}) {
    try {
        const html = await fetchTimetableHtml(type, id, scheduleType);
        const page = parseTimetablePage(html, { now });

        if (scheduleType === 'Permanent') {
            // S2: the permanent schedule is not a particular week (and has no holidays)
            page.weekStart = null;
            page.daysOff = [];
            page.lessons = page.lessons.map(lesson => ({ ...lesson, date: null }));
        }

        if (page.lessons.length === 0 && !emptyPageDiagnosticLogged) {
            emptyPageDiagnosticLogged = true;
            const $ = cheerio.load(html);
            const text = $('body').text().replace(/\s+/g, ' ').trim();
            console.warn(`⚠️  0 lessons parsed for ${type}/${id}/${scheduleType}: ` +
                `${String(html).length} bytes, format=${page.format}, allDaysOff=${page.allDaysOff}, ` +
                `.bk-timetable-row=${$('.bk-timetable-row').length}, ` +
                `.day-item-hover=${$('.day-item-hover').length}, [data-detail]=${$('[data-detail]').length}, ` +
                `title="${$('title').text().trim()}", text="${text.slice(0, 160)}"`);
        }

        return page;
    } catch (error) {
        console.error(`Failed to fetch timetable ${type}/${id}/${scheduleType}:`, error.message);
        throw error;
    }
}

/**
 * Firestore doc → { lessons, weekStart, daysOff } (weekStart undefined → null: saved
 * before S2; daysOff undefined → null: saved before days off were stored).
 */
function snapshotFromDoc(doc) {
    if (!doc.exists) return null;
    const data = doc.data() || {};
    if (!Array.isArray(data.data)) return null;
    return { lessons: data.data, weekStart: data.weekStart ?? null, daysOff: Array.isArray(data.daysOff) ? data.daysOff : null };
}

/**
 * Write the four aggregate documents, each only when its content changed
 * (ignoring generatedAt), so an unchanged week costs 4 reads and 0 writes.
 * @returns {Promise<Number>} number of documents written
 */
async function writeAggregates(db, aggregates) {
    const ids = Object.keys(aggregates);
    const refs = ids.map(id => db.collection(AGGREGATE_COLLECTION).doc(id));
    const existing = await db.getAll(...refs);
    let written = 0;
    for (let i = 0; i < ids.length; i++) {
        const current = existing[i] && existing[i].exists ? existing[i].data() : null;
        if (sameAggregateContent(current, aggregates[ids[i]])) continue;
        await refs[i].set(aggregates[ids[i]]);
        written++;
    }
    return written;
}

/**
 * Main prefetch function - downloads all data and stores in Firebase.
 *
 * Never throws: the outcome is in `status` (S4) —
 * 'ok' | 'partial' | 'guard_no_definitions' | 'guard_no_lessons' | 'login_failed' | 'network' | 'error'.
 *
 * @param {Object} [options]
 * @param {Object} [options.db] - Firestore instance (tests pass a fake)
 * @param {Date} [options.now] - "now" of the run (year of "D.M." dates, September check)
 * @param {Number} [options.retryDelayMs] - base retry delay (tests use 0)
 * @returns {Promise<{ success: Boolean, status: String, totalRequests: Number, successCount: Number,
 *   errorCount: Number, duration: Number, definitionsCount: Number, error?: String, … }>}
 */
async function prefetchAllData(options = {}) {
    console.log('\n🚀 Starting prefetch of all timetable data...');
    const startTime = Date.now();
    const now = options.now instanceof Date ? options.now : new Date();
    const previousRetryDelay = runtime.retryDelayMs;
    if (Number.isFinite(options.retryDelayMs)) runtime.retryDelayMs = options.retryDelayMs;

    // Reset per-run state for a fresh login
    cachedSessionCookie = null;
    sessionRenewal = null;
    emptyPageDiagnosticLogged = false;

    const stats = {
        totalRequests: 0,
        successCount: 0,
        errorCount: 0,
        timetablesWritten: 0,
        writesSkipped: 0,
        changeDocs: 0,
        changesDetected: 0,
        comparisonsSkipped: 0,
        emptyGuarded: 0,
        aggregatesWritten: 0,
    };
    const finish = (status, extra = {}) => ({
        success: status === 'ok',
        status,
        ...stats,
        duration: Date.now() - startTime,
        definitionsCount: 0,
        ...extra,
    });

    try {
        const db = options.db || getFirestore();

        // Step 1: Fetch and store definitions
        console.log('\n📋 Fetching definitions...');
        let definitions;
        try {
            definitions = await fetchDefinitions();
        } catch (error) {
            const status = classifyError(error);
            console.error(`❌ Prefetch stopped (${status}): ${error.message}`);
            return finish(status, { error: error.message });
        }

        // Only save definitions if we got valid data (not empty)
        const totalEntitiesFetched = definitions.classes.length + definitions.teachers.length + definitions.rooms.length;
        if (totalEntitiesFetched === 0) {
            console.log('⚠️  WARNING: Fetched 0 definitions - cookie may be expired or API failed');
            console.log('⚠️  Keeping existing definitions in Firebase to prevent data loss');
            console.log('⚠️  Skipping prefetch to avoid overwriting valid data\n');
            return finish('guard_no_definitions', { error: 'No definitions fetched - check cookie validity' });
        }

        // Step 1.5: Extract groups for each class from both Actual and Next schedules
        // (Some groups like TVDi may only appear in Next schedule)
        console.log('\n📦 Extracting groups for each class...');
        const classGroups = {}; // Map: classId -> Set<groupName>

        // Timetables fetched here are exactly the Class/Actual and Class/Next
        // tasks processed below, so keep them and skip the second Bakaláři
        // round-trip for those (~2 requests per class per run).
        const prefetchedPages = new Map(); // docKey -> parsed page
        const groupErrors = [];

        const extractGroupsForClass = async (classEntity) => {
            try {
                // One after the other: with CONCURRENT_REQUESTS classes in flight this
                // keeps Bakaláři at CONCURRENT_REQUESTS parallel requests (Promise.all doubled it).
                const actualPage = await fetchTimetablePage('Class', classEntity.id, 'Actual', { now });
                const nextPage = await fetchTimetablePage('Class', classEntity.id, 'Next', { now });
                prefetchedPages.set(`Class_${classEntity.id}_Actual`, actualPage);
                prefetchedPages.set(`Class_${classEntity.id}_Next`, nextPage);
                const allLessons = [...actualPage.lessons, ...nextPage.lessons];

                const groupsSet = new Set();
                allLessons.forEach(lesson => {
                    if (lesson.group) {
                        // Standardize group name (e.g., "1. skupina" -> "1.sk")
                        const standardized = standardizeGroupName(lesson.group);
                        if (standardized) {
                            groupsSet.add(standardized);
                        }
                    }
                });

                if (groupsSet.size > 0) {
                    classGroups[classEntity.id] = Array.from(groupsSet).sort((a, b) => a.localeCompare(b));
                    console.log(`   ${classEntity.name}: ${classGroups[classEntity.id].join(', ')}`);
                }
            } catch (error) {
                groupErrors.push(error);
                console.error(`   Failed to extract groups for ${classEntity.name}:`, error.message);
            }
        };

        for (let i = 0; i < definitions.classes.length; i += CONCURRENT_REQUESTS) {
            await Promise.all(definitions.classes.slice(i, i + CONCURRENT_REQUESTS).map(extractGroupsForClass));
        }

        // Guard: if not a single lesson was parsed for any class (actual or next
        // week), Bakaláři either has no timetable published or changed its markup.
        // Writing that would wipe the cache (and, in September, the permanent
        // schedules) with empty snapshots, so keep what we have and report it.
        const lessonsSeen = Array.from(prefetchedPages.values()).reduce((sum, page) => sum + page.lessons.length, 0);
        if (definitions.classes.length > 0 && lessonsSeen === 0) {
            if (groupErrors.length === definitions.classes.length) {
                // Every download failed: that is an outage, not an empty timetable.
                const status = classifyError(groupErrors[0]);
                console.log(`⚠️  All class timetables failed to download (${status}) - keeping existing data\n`);
                return finish(status, { totalRequests: groupErrors.length, error: groupErrors[0].message });
            }
            console.log('⚠️  WARNING: 0 lessons parsed across all class timetables');
            console.log('⚠️  Keeping existing timetables and definitions in Firebase\n');
            return finish('guard_no_lessons', {
                totalRequests: prefetchedPages.size,
                error: 'No lessons parsed from Bakaláři - timetable not published or page markup changed',
            });
        }

        await db.collection('definitions').doc('current').set({
            ...definitions,
            classGroups: classGroups,
            lastUpdate: new Date().toISOString(),
        });

        const totalGroupsExtracted = Object.values(classGroups).reduce((sum, groups) => sum + groups.length, 0);
        console.log(`✅ Definitions saved: ${definitions.classes.length} classes, ${definitions.teachers.length} teachers, ${definitions.rooms.length} rooms, ${totalGroupsExtracted} groups`);

        // Step 2: Calculate total possible requests
        const totalEntities = definitions.classes.length + definitions.teachers.length + definitions.rooms.length;
        const totalPossibleRequests = totalEntities * SCHEDULE_TYPES.length;
        console.log(`\n📊 Total entities: ${totalEntities}`);
        console.log(`📊 Maximum possible requests: ${totalPossibleRequests} (${SCHEDULE_TYPES.length} schedule types per entity)`);
        console.log(`📊 Parallel requests: ${CONCURRENT_REQUESTS}`);

        // Step 3: Fetch all timetables in parallel batches
        const entityGroups = [
            { type: 'Class', entities: definitions.classes },
            { type: 'Teacher', entities: definitions.teachers },
            { type: 'Room', entities: definitions.rooms },
        ];

        // Permanent schedules change mostly at the start of the school year, so in
        // September they are fetched in every run. They do change during the year
        // as well (second term, a teacher leaving): a stale copy turned every
        // lesson it no longer matched into a false "Hodina odpadla", week after
        // week until September. So outside September each one is re-checked in
        // the first run of every day (Prague time) - one extra request per
        // timetable and DAY, ~0.5 % on top of the 96 daily runs - and the ones
        // that failed are retried in the following runs.
        const isSeptember = now.getMonth() === 8; // 0-11, where 8 = September
        const today = formatPragueTime(now, 'yyyy-MM-dd');
        const refreshRef = db.collection(PERMANENT_REFRESH_DOC[0]).doc(PERMANENT_REFRESH_DOC[1]);
        let refreshState = null;
        let pendingPermanent = new Set();
        let dailyRefreshDue = false;

        // If not September, fetch existing permanent schedule IDs in one batch
        let existingPermanentIds = new Set();
        if (!isSeptember) {
            const refreshDoc = await refreshRef.get();
            refreshState = refreshDoc.exists ? (refreshDoc.data() || {}) : {};
            dailyRefreshDue = refreshState.date !== today;
            pendingPermanent = new Set(Array.isArray(refreshState.pending) ? refreshState.pending : []);

            const permanentDocs = await db.collection('timetables')
                .where('scheduleType', '==', 'Permanent')
                .select('lessonCount') // Only the count, not the full data
                .get();

            // Only a permanent schedule that actually has lessons counts as cached;
            // empty or legacy (pre-lessonCount) docs are fetched again.
            permanentDocs.forEach(doc => {
                if ((doc.data().lessonCount || 0) > 0) existingPermanentIds.add(doc.id);
            });

            console.log(`📦 Found ${existingPermanentIds.size} existing permanent schedules in cache`);
        }

        // Build task queue
        const tasks = [];
        let skippedPermanentCount = 0;

        for (const group of entityGroups) {
            for (const entity of group.entities) {
                for (const scheduleType of SCHEDULE_TYPES) {
                    // Skip permanent schedules if:
                    // 1. It's not September (new school year)
                    // 2. We already have the data in Firebase
                    // 3. and they were re-checked today (and did not fail then)
                    if (scheduleType === 'Permanent' && !isSeptember && !dailyRefreshDue) {
                        const docKey = `${group.type}_${entity.id}_Permanent`;

                        if (existingPermanentIds.has(docKey) && !pendingPermanent.has(docKey)) {
                            skippedPermanentCount++;
                            continue; // Skip this task
                        }
                    }

                    tasks.push({
                        type: group.type,
                        entity: entity,
                        scheduleType: scheduleType
                    });
                }
            }
        }

        if (skippedPermanentCount > 0) {
            console.log(`⏭️  Skipping ${skippedPermanentCount} permanent schedules (not September, checked today)`);
        }
        if (dailyRefreshDue) console.log('🔄 First run of the day: re-checking the permanent schedules');

        // Permanent first: the class Actual task adds the cancelled lessons from
        // the permanent schedule and must see THIS run's copy. In one mixed batch
        // it used last run's (in September: phantom cancellations for 15 minutes).
        tasks.sort((a, b) => (b.scheduleType === 'Permanent') - (a.scheduleType === 'Permanent'));
        const failedPermanent = [];

        const totalExpectedRequests = tasks.length;

        // Load every snapshot the loop will compare against in a few bulk
        // getAll() calls instead of one get() per task. `previousSnapshots` stays
        // as it was at the start of the run: the Actual task must see LAST run's
        // Next snapshot even if this run's Next task (same batch) is done first.
        // `latestSnapshots` follows the writes (fresh Permanent for later tasks,
        // final state for the aggregates).
        const previousSnapshots = new Map(); // docKey -> { lessons, weekStart } | null
        {
            const wanted = new Set();
            for (const task of tasks) {
                wanted.add(`${task.type}_${task.entity.id}_${task.scheduleType}`);
                if (task.scheduleType === 'Actual') {
                    wanted.add(`${task.type}_${task.entity.id}_Next`);
                    if (task.type === 'Class') wanted.add(`${task.type}_${task.entity.id}_Permanent`);
                }
            }
            const keys = Array.from(wanted);
            const GET_ALL_CHUNK = 50;
            for (let i = 0; i < keys.length; i += GET_ALL_CHUNK) {
                const chunk = keys.slice(i, i + GET_ALL_CHUNK);
                const docs = await db.getAll(...chunk.map((key) => db.collection('timetables').doc(key)));
                docs.forEach((doc, idx) => {
                    previousSnapshots.set(chunk[idx], snapshotFromDoc(doc));
                });
            }
            console.log(`📦 Preloaded ${keys.length} existing snapshots from Firestore`);
        }
        const latestSnapshots = new Map(previousSnapshots);
        let raster = []; // lesson numbers of the Bakaláři hour raster, for freeRooms
        let lastTaskError = null;

        console.log(`\n📚 Processing ${totalExpectedRequests} timetables with ${CONCURRENT_REQUESTS} parallel requests...`);
        console.log(`⏱️  Estimated time: ~${Math.ceil(totalExpectedRequests / CONCURRENT_REQUESTS * 0.5 / 60)} minutes\n`);

        // Process tasks in parallel batches
        const processBatch = async (batch) => {
            return Promise.all(batch.map(async (task) => {
                stats.totalRequests++;
                const progress = `[${stats.totalRequests}/${totalExpectedRequests}]`;
                const label = `${task.type}/${task.entity.name}/${task.scheduleType}`;

                try {
                    const docKey = `${task.type}_${task.entity.id}_${task.scheduleType}`;

                    // Fetch timetable (or reuse the copy from the group-extraction step)
                    const page = prefetchedPages.has(docKey)
                        ? prefetchedPages.get(docKey)
                        : await fetchTimetablePage(task.type, task.entity.id, task.scheduleType, { now });
                    if (raster.length === 0 && page.hours && page.hours.length) raster = page.hours;

                    const previous = previousSnapshots.get(docKey) ?? null;

                    // Guard for ONE timetable: an empty page replacing a non-empty
                    // snapshot is far more often a glitch (unpublished week, broken
                    // page) than a real "no lessons at all" — unless Bakaláři marks
                    // every day of the week as a day off (holidays).
                    if (page.lessons.length === 0 && previous && previous.lessons.length > 0 && !page.allDaysOff) {
                        stats.emptyGuarded++;
                        stats.successCount++;
                        console.warn(`${progress} 🛡️  ${label}: empty page, keeping the previous snapshot ` +
                            `(${previous.lessons.length} lessons), no changes reported`);
                        return;
                    }

                    const weekStart = task.scheduleType === 'Permanent' ? null : (page.weekStart || null);
                    const daysOff = task.scheduleType === 'Permanent' ? [] : (page.daysOff || []);
                    let timetableData = page.lessons;

                    // For Actual schedules of Classes, add removed lessons from Permanent schedule
                    // This ensures removed group lessons are displayed with strikethrough.
                    let permanentLessons = null;
                    if (task.scheduleType === 'Actual' && task.type === 'Class') {
                        const permanent = latestSnapshots.get(`${task.type}_${task.entity.id}_Permanent`);
                        permanentLessons = permanent && permanent.lessons.length ? permanent.lessons : null;
                        if (permanentLessons) {
                            timetableData = addRemovedLessonsFromPermanent(timetableData, permanentLessons, { weekStart, daysOff });
                        }
                    }

                    // S2: compare only snapshots of the same week
                    const { baseline, source, reason } = selectComparisonBaseline({
                        scheduleType: task.scheduleType,
                        newWeekStart: weekStart,
                        previous,
                        previousNext: task.scheduleType === 'Actual'
                            ? previousSnapshots.get(`${task.type}_${task.entity.id}_Next`) ?? null
                            : null,
                    });

                    let note = '';
                    if (baseline) {
                        const metadata = {
                            type: task.type,
                            id: task.entity.id,
                            name: task.entity.name,
                            scheduleType: task.scheduleType
                        };

                        // The old Next snapshot never got the cancelled lessons from the
                        // permanent schedule; add them the same way so both sides match.
                        // Same week, so the days off of this download apply when the old
                        // snapshot was stored before days off were recorded.
                        const baseLessons = source === 'previousNext' && permanentLessons
                            ? addRemovedLessonsFromPermanent(baseline.lessons, permanentLessons, {
                                weekStart, daysOff: baseline.daysOff || daysOff,
                            })
                            : baseline.lessons;

                        const changes = detectTimetableChanges(baseLessons, timetableData, metadata, {
                            oldWeekStart: baseline.weekStart ?? null,
                            newWeekStart: weekStart,
                        });

                        // Store detected changes
                        if (changes.length > 0) {
                            const changeId = `${docKey}_${Date.now()}`;
                            await db.collection('changes').doc(changeId).set({
                                timetable: metadata,
                                weekStart,
                                changes: changes,
                                timestamp: new Date().toISOString(),
                                sent: false
                            });
                            stats.changeDocs++;
                            stats.changesDetected += changes.length;

                            console.log(`${progress} 🔔 ${changes.length} changes detected for ${task.entity.name}` +
                                (source === 'previousNext' ? ' (vs. last run\'s Next of the same week)' : ''));
                        }
                    } else if (previous && previous.lessons.length > 0) {
                        // e.g. the first run after deploying S2 ('previous_without_week'), or
                        // a new Next week ('week_changed'): nothing comparable, nothing reported.
                        stats.comparisonsSkipped++;
                        note = `, not compared: ${reason}`;
                    }

                    // Write only if the content differs (lessons or week). Key order
                    // independent, since Firestore does not promise to keep it.
                    const isDataIdentical = previous
                        && (previous.weekStart ?? null) === weekStart
                        && stableStringify(previous.daysOff || []) === stableStringify(daysOff)
                        && stableStringify(previous.lessons) === stableStringify(timetableData);

                    if (!isDataIdentical) {
                        await db.collection('timetables').doc(docKey).set({
                            type: task.type,
                            id: task.entity.id,
                            name: task.entity.name,
                            scheduleType: task.scheduleType,
                            weekStart,
                            // Holidays of this week ({day, date, name}): the app can label the
                            // day and the reminder job skips it.
                            daysOff,
                            data: timetableData,
                            lessonCount: timetableData.length,
                            lastUpdate: new Date().toISOString(),
                        });
                        latestSnapshots.set(docKey, { lessons: timetableData, weekStart, daysOff });
                        stats.timetablesWritten++;
                        stats.successCount++;
                        console.log(`${progress} ✅ ${label} (Updated${note})`);
                    } else {
                        stats.writesSkipped++;
                        stats.successCount++;
                        console.log(`${progress} ⏭️  ${label} (No changes, skipped write${note})`);
                    }

                } catch (error) {
                    stats.errorCount++;
                    lastTaskError = error;
                    if (task.scheduleType === 'Permanent') failedPermanent.push(`${task.type}_${task.entity.id}_Permanent`);
                    console.error(`${progress} ❌ ${label}: ${error.message}`);
                }
            }));
        };

        // Process in batches; the Permanent tasks (sorted first) are finished
        // before the first Actual/Next batch starts.
        const permanentCount = tasks.filter(task => task.scheduleType === 'Permanent').length;
        for (const part of [tasks.slice(0, permanentCount), tasks.slice(permanentCount)]) {
            for (let i = 0; i < part.length; i += CONCURRENT_REQUESTS) {
                await processBatch(part.slice(i, i + CONCURRENT_REQUESTS));
            }
        }

        // Remember today's re-check and what is left to retry (written only
        // when it changes: once a day, plus after a failure / its recovery).
        if (!isSeptember) {
            const pending = [...new Set(failedPermanent)].sort();
            const before = [...pendingPermanent].sort();
            if (dailyRefreshDue || stableStringify(pending) !== stableStringify(before)) {
                await refreshRef.set({
                    date: today,
                    checkedAt: dailyRefreshDue ? new Date().toISOString() : (refreshState.checkedAt || null),
                    pending,
                });
            }
        }

        // Step 4: aggregates (S3) from the snapshots in memory — no extra Bakaláři request
        let aggregatesError = null;
        try {
            const generatedAt = new Date().toISOString();
            const snapshotsOf = (type, entities, scheduleType) => entities
                .map(entity => {
                    const snap = latestSnapshots.get(`${type}_${entity.id}_${scheduleType}`);
                    return snap ? { id: entity.id, name: entity.name, lessons: snap.lessons, weekStart: snap.weekStart ?? null } : null;
                })
                .filter(Boolean);

            stats.aggregatesWritten = await writeAggregates(db, {
                changes_Actual: buildChangesAggregate(snapshotsOf('Class', definitions.classes, 'Actual'), { generatedAt }),
                changes_Next: buildChangesAggregate(snapshotsOf('Class', definitions.classes, 'Next'), { generatedAt }),
                freeRooms_Actual: buildFreeRoomsAggregate(snapshotsOf('Room', definitions.rooms, 'Actual'), { generatedAt, hours: raster }),
                freeRooms_Next: buildFreeRoomsAggregate(snapshotsOf('Room', definitions.rooms, 'Next'), { generatedAt, hours: raster }),
            });
            console.log(`📊 Aggregates: ${stats.aggregatesWritten} of 4 updated`);
        } catch (error) {
            // The timetables themselves are saved; a failed summary must not hide that.
            aggregatesError = error.message;
            console.error('❌ Failed to write aggregates:', error.message);
        }

        const status = runStatus(stats, lastTaskError);
        const notRefreshed = stats.errorCount + stats.emptyGuarded;
        const runError = status === 'partial'
            ? `${notRefreshed} of ${stats.totalRequests} timetables not refreshed ` +
                `(${stats.errorCount} errors, ${stats.emptyGuarded} empty pages kept)` +
                (lastTaskError ? `; last error: ${lastTaskError.message}` : '')
            : (lastTaskError ? lastTaskError.message : null);

        // Step 5: Update metadata
        await db.collection('metadata').doc('lastPrefetch').set({
            timestamp: new Date().toISOString(),
            status,
            totalRequests: stats.totalRequests,
            successCount: stats.successCount,
            errorCount: stats.errorCount,
            duration: Date.now() - startTime,
        });

        // Summary
        const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
        console.log(`\n${'='.repeat(60)}`);
        console.log(`${status === 'ok' ? '✅' : status === 'partial' ? '⚠️ ' : '❌'} Prefetch finished (${status}) in ${duration} minutes`);
        console.log(`📊 Success: ${stats.successCount}/${stats.totalRequests}`);
        console.log(`❌ Errors: ${stats.errorCount}/${stats.totalRequests}`);
        console.log(`${'='.repeat(60)}\n`);

        return finish(status, {
            definitionsCount: totalEntitiesFetched,
            ...(aggregatesError ? { aggregatesError } : {}),
            ...(status !== 'ok' && runError ? { error: runError } : {}),
        });

    } catch (error) {
        const status = classifyError(error);
        console.error(`\n❌ Prefetch failed (${status}):`, error.message);
        return finish(status, { error: error.message });
    } finally {
        runtime.retryDelayMs = previousRetryDelay;
    }
}

module.exports = {
    prefetchAllData,
    loginToBakalari,
    fetchTimetableHtml,
    // exported for tests
    assessLoginResponse,
    parseSetCookies,
    fetchWithRetry,
    classifyError,
    runStatus,
    PARTIAL_FAILURE_RATIO,
    requestConfig,
    BakalariLoginError,
    DEFAULT_CONCURRENCY,
    CONCURRENT_REQUESTS,
};
