/**
 * Prefetch Module
 * Downloads all timetable data from Bakalari API and stores in Firebase
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { getFirestore } = require('./firebase-admin-init');
const { detectTimetableChanges } = require('./change-detector');
const { parseTimetableHtml, standardizeGroupName, addRemovedLessonsFromPermanent } = require('./bakalari-parser');

// Configuration
const BAKALARI_BASE_URL = 'https://mot-spsd.bakalari.cz';
// Reduce concurrent requests on Vercel to avoid rate limiting/DDoS blocks.
// Can be overridden with PREFETCH_CONCURRENCY (e.g. on a GitHub Actions runner that
// isn't subject to the same rate limits but still wants to stay gentle on Bakalari).
const DEFAULT_CONCURRENCY = process.env.VERCEL ? 3 : 20;
const CONCURRENT_REQUESTS = parseInt(process.env.PREFETCH_CONCURRENCY) || DEFAULT_CONCURRENCY;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = process.env.VERCEL ? 2000 : 1000; // Longer delay on Vercel
const SCHEDULE_TYPES = ['Actual', 'Permanent', 'Next'];
const ENTITY_TYPES = ['Class', 'Teacher', 'Room'];

// Axios configuration for serverless environments
const axiosConfig = {
    timeout: 60000, // 60 second timeout (increased for slow Bakalari responses)
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'cs,en;q=0.9',
        'Connection': 'close' // Force close connections in serverless
    },
    // Disable keep-alive in serverless environments
    httpAgent: process.env.VERCEL ? new (require('http').Agent)({
        keepAlive: false,
        timeout: 60000
    }) : undefined,
    httpsAgent: process.env.VERCEL ? new (require('https').Agent)({
        keepAlive: false,
        timeout: 60000,
        rejectUnauthorized: true
    }) : undefined,
};

// Cache for session cookie (valid for the duration of prefetch run)
let cachedSessionCookie = null;

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
        throw new Error('BAKALARI_USERNAME and BAKALARI_PASSWORD must be set in environment');
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`🔐 Logging in to Bakalari... (attempt ${attempt}/${retries})`);

            // Step 1: GET login page to get CSRF token and initial cookies
            const loginPageResponse = await axios.get(`${BAKALARI_BASE_URL}/login`, {
                ...axiosConfig,
                maxRedirects: 0,
                validateStatus: (status) => status < 400
            });

            // Extract cookies from login page
            const setCookieHeaders = loginPageResponse.headers['set-cookie'] || [];
            let cookies = {};
            setCookieHeaders.forEach(cookieStr => {
                const [nameValue] = cookieStr.split(';');
                const [name, value] = nameValue.split('=');
                cookies[name.trim()] = value;
            });

            // Parse HTML to get CSRF token
            const $ = cheerio.load(loginPageResponse.data);
            const csrfToken = $('input[name="__RequestVerificationToken"]').val();

            // Step 2: POST login form
            const loginData = new URLSearchParams({
                'username': username,
                'password': password,
                '__RequestVerificationToken': csrfToken || ''
            });

            const loginResponse = await axios.post(`${BAKALARI_BASE_URL}/login`, loginData, {
                ...axiosConfig,
                headers: {
                    ...axiosConfig.headers,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
                },
                maxRedirects: 0,
                validateStatus: (status) => status < 400
            });

            // Extract all cookies from login response
            const loginSetCookies = loginResponse.headers['set-cookie'] || [];
            loginSetCookies.forEach(cookieStr => {
                const [nameValue] = cookieStr.split(';');
                const [name, value] = nameValue.split('=');
                cookies[name.trim()] = value;
            });

            // Build cookie string
            const cookieString = Object.entries(cookies)
                .map(([name, value]) => `${name}=${value}`)
                .join('; ');

            console.log('✅ Login successful');

            // Cache the cookie for this prefetch run
            cachedSessionCookie = cookieString;

            return cookieString;

        } catch (error) {
            const isLastAttempt = attempt === retries;
            const errorMsg = error.code === 'ECONNRESET' ? 'Connection reset by server' : error.message;

            console.error(`❌ Login attempt ${attempt}/${retries} failed: ${errorMsg}`);

            if (isLastAttempt) {
                throw new Error(`Bakalari login failed after ${retries} attempts: ${error.message}`);
            }

            // Wait before retry with exponential backoff
            const delay = RETRY_DELAY_MS * attempt;
            console.log(`⏳ Waiting ${delay}ms before retry...`);
            await sleep(delay);
        }
    }
}

/**
 * Sleep utility for throttling
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch with retry logic
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(url, options);
            return response.data;
        } catch (error) {
            console.warn(`Retry ${i + 1}/${retries} for ${url}:`, error.message);
            if (i === retries - 1) throw error;
            await sleep(RETRY_DELAY_MS * (i + 1)); // Exponential backoff
        }
    }
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
        const response = await axios.get(url, {
            ...axiosConfig,
            headers: {
                ...axiosConfig.headers,
                Cookie: cookie
            },
        });

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
async function fetchTimetable(type, id, scheduleType, date = null) {
    try {
        // Get fresh login cookie (cached during prefetch run)
        const cookie = await loginToBakalari();

        let url = `${BAKALARI_BASE_URL}/Timetable/Public/${scheduleType}/${type}/${id}`;
        if (date) {
            url += `?date=${date}`;
        }

        const response = await axios.get(url, {
            ...axiosConfig,
            headers: {
                ...axiosConfig.headers,
                Cookie: cookie
            },
        });

        return parseTimetableHtml(response.data);
    } catch (error) {
        console.error(`Failed to fetch timetable ${type}/${id}/${scheduleType}:`, error.message);
        throw error;
    }
}

/**
 * Main prefetch function - downloads all data and stores in Firebase
 */
async function prefetchAllData() {
    console.log('\n🚀 Starting prefetch of all timetable data...');
    const startTime = Date.now();

    // Reset cookie cache for fresh login
    cachedSessionCookie = null;

    const db = getFirestore();
    let totalRequests = 0;
    let successCount = 0;
    let errorCount = 0;

    try {
        // Step 1: Fetch and store definitions
        console.log('\n📋 Fetching definitions...');
        const definitions = await fetchDefinitions();

        // Only save definitions if we got valid data (not empty)
        const totalEntitiesFetched = definitions.classes.length + definitions.teachers.length + definitions.rooms.length;
        if (totalEntitiesFetched === 0) {
            console.log('⚠️  WARNING: Fetched 0 definitions - cookie may be expired or API failed');
            console.log('⚠️  Keeping existing definitions in Firebase to prevent data loss');
            console.log('⚠️  Skipping prefetch to avoid overwriting valid data\n');
            return {
                success: false,
                totalRequests: 0,
                successCount: 0,
                errorCount: 0,
                duration: Date.now() - startTime,
                definitionsCount: 0,
                error: 'No definitions fetched - check cookie validity'
            };
        }

        // Step 1.5: Extract groups for each class from both Actual and Next schedules
        // (Some groups like TVDi may only appear in Next schedule)
        console.log('\n📦 Extracting groups for each class...');
        const classGroups = {}; // Map: classId -> Set<groupName>

        // Timetables fetched here are exactly the Class/Actual and Class/Next
        // tasks processed below, so keep them and skip the second Bakaláři
        // round-trip for those (~2 requests per class per run).
        const prefetchedTimetables = new Map(); // docKey -> lessons

        const extractGroupsForClass = async (classEntity) => {
            try {
                // Fetch both Actual and Next schedules to get all possible groups
                const [actualLessons, nextLessons] = await Promise.all([
                    fetchTimetable('Class', classEntity.id, 'Actual'),
                    fetchTimetable('Class', classEntity.id, 'Next'),
                ]);
                prefetchedTimetables.set(`Class_${classEntity.id}_Actual`, actualLessons);
                prefetchedTimetables.set(`Class_${classEntity.id}_Next`, nextLessons);
                const allLessons = [...actualLessons, ...nextLessons];

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
                console.error(`   Failed to extract groups for ${classEntity.name}:`, error.message);
            }
        };

        for (let i = 0; i < definitions.classes.length; i += CONCURRENT_REQUESTS) {
            await Promise.all(definitions.classes.slice(i, i + CONCURRENT_REQUESTS).map(extractGroupsForClass));
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

        // Check if we should fetch permanent schedules
        // Permanent schedules only change at start of school year (September)
        const currentMonth = new Date().getMonth(); // 0-11, where 8 = September
        const isSeptember = currentMonth === 8;

        // If not September, fetch existing permanent schedule IDs in one batch
        let existingPermanentIds = new Set();
        if (!isSeptember) {
            const permanentDocs = await db.collection('timetables')
                .where('scheduleType', '==', 'Permanent')
                .select() // Only fetch document IDs, not the full data
                .get();

            permanentDocs.forEach(doc => {
                existingPermanentIds.add(doc.id);
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
                    if (scheduleType === 'Permanent' && !isSeptember) {
                        const docKey = `${group.type}_${entity.id}_Permanent`;

                        if (existingPermanentIds.has(docKey)) {
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
            console.log(`⏭️  Skipping ${skippedPermanentCount} permanent schedules (not September, already cached)`);
        }

        const totalExpectedRequests = tasks.length;

        // Load every snapshot the loop will compare against in a few bulk
        // getAll() calls instead of one get() per task (and a second one for
        // the Permanent doc of each class). Same billed reads, far fewer
        // round-trips, and each doc is read once.
        const snapshotCache = new Map(); // docKey -> lessons[] | null
        {
            const wanted = new Set();
            for (const task of tasks) {
                wanted.add(`${task.type}_${task.entity.id}_${task.scheduleType}`);
                if (task.scheduleType === 'Actual' && task.type === 'Class') {
                    wanted.add(`${task.type}_${task.entity.id}_Permanent`);
                }
            }
            const keys = Array.from(wanted);
            const GET_ALL_CHUNK = 50;
            for (let i = 0; i < keys.length; i += GET_ALL_CHUNK) {
                const chunk = keys.slice(i, i + GET_ALL_CHUNK);
                const docs = await db.getAll(...chunk.map((key) => db.collection('timetables').doc(key)));
                docs.forEach((doc, idx) => {
                    snapshotCache.set(chunk[idx], doc.exists ? (doc.data().data ?? null) : null);
                });
            }
            console.log(`📦 Preloaded ${keys.length} existing snapshots from Firestore`);
        }

        console.log(`\n📚 Processing ${totalExpectedRequests} timetables with ${CONCURRENT_REQUESTS} parallel requests...`);
        console.log(`⏱️  Estimated time: ~${Math.ceil(totalExpectedRequests / CONCURRENT_REQUESTS * 0.5 / 60)} minutes\n`);

        // Process tasks in parallel batches
        const processBatch = async (batch) => {
            return Promise.all(batch.map(async (task) => {
                totalRequests++;
                const progress = `[${totalRequests}/${totalExpectedRequests}]`;

                try {
                    const docKey = `${task.type}_${task.entity.id}_${task.scheduleType}`;

                    // Fetch timetable (or reuse the copy from the group-extraction step)
                    let timetableData = prefetchedTimetables.has(docKey)
                        ? prefetchedTimetables.get(docKey)
                        : await fetchTimetable(task.type, task.entity.id, task.scheduleType);

                    // For Actual schedules of Classes, add removed lessons from Permanent schedule
                    // This ensures removed group lessons are displayed with strikethrough.
                    // Also keep permanentData so change-detector can filter out "revert to normal" events.
                    let permanentData = null;
                    if (task.scheduleType === 'Actual' && task.type === 'Class') {
                        permanentData = snapshotCache.get(`${task.type}_${task.entity.id}_Permanent`) ?? null;
                        if (permanentData) {
                            timetableData = addRemovedLessonsFromPermanent(timetableData, permanentData);
                        }
                    }

                    // Previous snapshot for change detection (preloaded above)
                    const previousData = snapshotCache.get(docKey) ?? null;

                    // Detect changes if previous snapshot exists
                    let hasChanges = false;
                    if (previousData && previousData.length > 0) {
                        const metadata = {
                            type: task.type,
                            id: task.entity.id,
                            name: task.entity.name,
                            scheduleType: task.scheduleType
                        };

                        const changes = detectTimetableChanges(previousData, timetableData, metadata, permanentData);

                        // Store detected changes
                        if (changes.length > 0) {
                            hasChanges = true;
                            const changeId = `${docKey}_${Date.now()}`;
                            await db.collection('changes').doc(changeId).set({
                                timetable: metadata,
                                changes: changes,
                                timestamp: new Date().toISOString(),
                                sent: false
                            });

                            console.log(`${progress} 🔔 ${changes.length} changes detected for ${task.entity.name}`);
                        }
                    }

                    // Check if data is identical to avoid unnecessary writes
                    // We write if:
                    // 1. It's a new document (!previousData)
                    // 2. We detected semantic changes (hasChanges)
                    // 3. The raw data is different (JSON comparison) - covers cases detectTimetableChanges might miss
                    const isDataIdentical = previousData && JSON.stringify(previousData) === JSON.stringify(timetableData);

                    if (!isDataIdentical) {
                        // Store new timetable in Firestore
                        await db.collection('timetables').doc(docKey).set({
                            type: task.type,
                            id: task.entity.id,
                            name: task.entity.name,
                            scheduleType: task.scheduleType,
                            data: timetableData,
                            lastUpdate: new Date().toISOString(),
                        });
                        // Keep the in-run cache current (a fresh Permanent snapshot is
                        // then visible to later tasks of the same run).
                        snapshotCache.set(docKey, timetableData);
                        successCount++;
                        console.log(`${progress} ✅ ${task.type}/${task.entity.name}/${task.scheduleType} (Updated)`);
                    } else {
                        // Skip write, but count as success
                        successCount++;
                        // Update lastUpdate timestamp only occasionally or not at all? 
                        // Let's NOT update it to save writes. The data hasn't changed.
                        console.log(`${progress} ⏭️  ${task.type}/${task.entity.name}/${task.scheduleType} (No changes, skipped write)`);
                    }

                } catch (error) {
                    errorCount++;
                    console.error(`${progress} ❌ ${task.type}/${task.entity.name}/${task.scheduleType}: ${error.message}`);
                }
            }));
        };

        // Process in batches
        for (let i = 0; i < tasks.length; i += CONCURRENT_REQUESTS) {
            const batch = tasks.slice(i, i + CONCURRENT_REQUESTS);
            await processBatch(batch);
        }

        // Step 4: Update metadata
        await db.collection('metadata').doc('lastPrefetch').set({
            timestamp: new Date().toISOString(),
            totalRequests,
            successCount,
            errorCount,
            duration: Date.now() - startTime,
        });

        // Summary
        const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
        console.log(`\n${'='.repeat(60)}`);
        console.log(`✅ Prefetch completed in ${duration} minutes`);
        console.log(`📊 Success: ${successCount}/${totalRequests}`);
        console.log(`❌ Errors: ${errorCount}/${totalRequests}`);
        console.log(`${'='.repeat(60)}\n`);

        return {
            success: true,
            totalRequests,
            successCount,
            errorCount,
            duration: Date.now() - startTime,
            definitionsCount: totalEntitiesFetched,
        };

    } catch (error) {
        console.error('\n❌ Prefetch failed:', error.message);
        throw error;
    }
}

module.exports = {
    prefetchAllData,
    fetchDefinitions,
    fetchTimetable,
};
