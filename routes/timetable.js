/**
 * Timetable Routes
 * Handles timetable fetching and definitions
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const router = express.Router();

// Helper function to abbreviate teacher name from "Surname Firstname" format
function abbreviateTeacherName(fullName) {
    if (!fullName) return '';

    // Remove titles
    let cleaned = fullName.replace(/^(?:Mgr\.|Ing\.|Bc\.|Dr\.|Ph\.D\.|RNDr\.|PaedDr\.|MBA)\s+/gi, '');
    let prevCleaned = '';
    while (prevCleaned !== cleaned) {
        prevCleaned = cleaned;
        cleaned = cleaned.replace(/^(?:Mgr\.|Ing\.|Bc\.|Dr\.|Ph\.D\.|RNDr\.|PaedDr\.|MBA)\s+/gi, '');
    }
    cleaned = cleaned.replace(/,?\s*(?:Ph\.D\.|CSc\.|MBA)$/gi, '');
    cleaned = cleaned.trim();

    const parts = cleaned.split(/\s+/).filter(p => p.length > 0);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();

    // Detect if in "Surname Firstname" format (reversed)
    const firstPart = parts[0].toLowerCase();
    const surnameSuffixes = ['ová', 'ný', 'ná', 'ský', 'ská', 'ík', 'ek', 'ák', 'vič', 'ovič'];
    const isReversed = surnameSuffixes.some(suffix => firstPart.endsWith(suffix));

    let firstName, lastName;
    if (isReversed) {
        // "Kozakovič Radko" → firstName="Radko", lastName="Kozakovič"
        lastName = parts[0];
        firstName = parts[parts.length - 1];
    } else {
        // "Radko Kozakovič" → firstName="Radko", lastName="Kozakovič"
        firstName = parts[0];
        lastName = parts[parts.length - 1];
    }

    // Return "R. Kozakovič"
    return `${firstName[0]}. ${lastName}`;
}

// Get cookie and base URL from environment
const MOJE_COOKIE = process.env.BAKALARI_COOKIE;
const BASE_URL_TEMPLATE = 'https://mot-spsd.bakalari.cz/Timetable/Public';
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Cookie': MOJE_COOKIE
};

// Axios config for reliability
const axiosConfig = {
    timeout: 60000, // 60 second timeout (increased for slow Bakalari responses)
    headers,
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

/**
 * Add removed lessons from permanent schedule to actual schedule
 * When a lesson exists in permanent but not in actual, add it as type="removed"
 */
function addRemovedLessonsFromPermanent(actualLessons, permanentLessons) {
    if (!permanentLessons || permanentLessons.length === 0) {
        return actualLessons;
    }

    const actualLessonKeys = new Set();
    actualLessons.forEach(lesson => {
        const key = `${lesson.day}-${lesson.hour}-${lesson.subject}-${lesson.teacher}-${lesson.group || ''}`;
        actualLessonKeys.add(key);
    });

    const removedLessons = [];
    permanentLessons.forEach(permLesson => {
        if (permLesson.type === 'removed') return;

        const key = `${permLesson.day}-${permLesson.hour}-${permLesson.subject}-${permLesson.teacher}-${permLesson.group || ''}`;

        if (!actualLessonKeys.has(key)) {
            removedLessons.push({
                ...permLesson,
                type: 'removed',
                changed: true,
                changeInfo: {
                    raw: 'Hodina odpadla',
                    description: 'Hodina odpadla'
                }
            });
        }
    });

    return [...actualLessons, ...removedLessons];
}

// Get timetable data
router.get('/timetable', async (req, res) => {
    const { type, id, schedule, date } = req.query;

    let scheduleType = 'Actual';
    if (schedule === 'permanent') {
        scheduleType = 'Permanent';
    } else if (schedule === 'next') {
        scheduleType = 'Next';
    }

    let url = `${BASE_URL_TEMPLATE}/${scheduleType}/${type}/${id}`;
    if (date) {
        url += `?date=${date}`;
    }

    console.log(`[API] Fetching timetable: ${url}`);

    try {
        const response = await axios.get(url, axiosConfig);
        const $ = cheerio.load(response.data);
        let timetable = [];

        $('.bk-timetable-row').each((rowIndex, row) => {
            const dayName = $(row).find('.bk-day-day').text().trim();
            const dayIndex = ['po', 'út', 'st', 'čt', 'pá'].indexOf(dayName.toLowerCase());

            $(row).find('.bk-timetable-cell').each((cellIndex, cell) => {
                const items = $(cell).find('.day-item-hover');

                items.each((_, item) => {
                    const detailRaw = $(item).attr('data-detail');
                    if (detailRaw) {
                        try {
                            const data = JSON.parse(detailRaw);

                            let changeInfo = null;
                            if (data.changeinfo) {
                                changeInfo = {
                                    raw: data.changeinfo,
                                    description: data.changeinfo
                                };
                            }

                            let subject = "";
                            let teacher = data.teacher || "";
                            let finalChangeInfo = changeInfo;

                            if (data.type === "removed" && data.removedinfo) {
                                // Parse removedinfo: "Vyjmuto z rozvrhu (PŘEDMĚT, UČITEL)" or "Zrušeno (PŘEDMĚT, UČITEL)"
                                const match = data.removedinfo.match(/\(([^,]+),\s*([^)]+)\)/);
                                if (match) {
                                    subject = match[1].trim();
                                    // Teacher name from removedinfo - abbreviate it (e.g., "Kozakovič Radko" → "R. Kozakovič")
                                    const fullTeacherName = match[2].trim();
                                    teacher = abbreviateTeacherName(fullTeacherName);
                                } else {
                                    // Fallback if format doesn't match
                                    subject = data.subjecttext ? data.subjecttext.split('|')[0].trim() : "";
                                    // Use original teacher if available
                                    teacher = data.teacher || "";
                                }

                                finalChangeInfo = {
                                    raw: data.removedinfo,
                                    description: data.removedinfo
                                };
                            } else if (data.type === "absent" && data.InfoAbsentName) {
                                subject = data.InfoAbsentName;
                                if (subject && subject.length > 0) {
                                    subject = subject.charAt(0).toUpperCase() + subject.slice(1);
                                }

                                finalChangeInfo = {
                                    raw: data.absentinfo || "Absence",
                                    description: data.absentinfo ? `${data.InfoAbsentName} (${data.absentinfo})` : data.InfoAbsentName
                                };
                            } else {
                                subject = data.subjecttext ? data.subjecttext.split('|')[0].trim() : "";
                            }

                            const lessonData = {
                                day: dayIndex,
                                dayName: dayName,
                                hour: cellIndex,
                                subject: subject,
                                teacher: teacher,
                                room: data.room,
                                group: data.group,
                                theme: data.theme,
                                type: data.type,
                                changed: !!(finalChangeInfo),
                                changeInfo: finalChangeInfo,
                                _rawData: data
                            };

                            timetable.push(lessonData);
                        } catch (e) { }
                    }
                });
            });
        });

        // For Actual schedules of Classes, add removed lessons from Permanent schedule
        // This ensures removed group lessons are displayed with strikethrough
        if (scheduleType === 'Actual' && type === 'Class') {
            try {
                const { getFirestore } = require('../backend/firebase-admin-init');
                const db = getFirestore();
                const permanentDocKey = `Class_${id}_Permanent`;
                const permanentDoc = await db.collection('timetables').doc(permanentDocKey).get();

                if (permanentDoc.exists) {
                    const permanentData = permanentDoc.data().data;
                    timetable = addRemovedLessonsFromPermanent(timetable, permanentData);
                    console.log(`[API] Added removed lessons from permanent schedule`);
                }
            } catch (err) {
                console.error('[API] Failed to load permanent schedule for comparison:', err.message);
                // Continue with timetable without removed lessons
            }
        }

        res.json(timetable);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get definitions (classes, teachers, rooms)
// Now returns cached data from Firebase instead of fetching from Bakalari
router.get('/definitions', async (req, res) => {
    try {
        // Try to get from Firebase cache first
        const { getFirestore } = require('../backend/firebase-admin-init');
        const db = getFirestore();
        const definitionsDoc = await db.collection('definitions').doc('current').get();

        if (definitionsDoc.exists) {
            const data = definitionsDoc.data();
            res.json({
                classes: data.classes || [],
                teachers: data.teachers || [],
                rooms: data.rooms || []
            });
            return;
        }

        // Fallback: Fetch from Bakalari if cache is empty
        console.log('⚠️  No cached definitions, fetching from Bakalari...');
        const response = await axios.get(`${BASE_URL_TEMPLATE}/Actual/Class/ZL`, axiosConfig);
        const $ = cheerio.load(response.data);
        const data = { classes: [], teachers: [], rooms: [] };

        // Classes
        $('#selectedClass option').each((_, el) => {
            const id = $(el).val();
            const name = $(el).text().trim();
            if (id && name) {
                data.classes.push({ id, name });
            }
        });

        // Teachers
        $('#selectedTeacher option').each((_, el) => {
            let id = $(el).val();
            const name = $(el).text().trim();

            if ((!id || id.trim() === '') && name) {
                id = name;
            }

            if (id && name) {
                data.teachers.push({ id, name });
            }
        });

        // Rooms
        $('#selectedRoom option').each((_, el) => {
            const id = $(el).val();
            const name = $(el).text().trim();
            if (id && name) {
                data.rooms.push({ id, name });
            }
        });

        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get groups for a specific class from Firebase cache
router.get('/groups/:classId', async (req, res) => {
    try {
        const { classId } = req.params;

        if (!classId) {
            return res.status(400).json({ error: 'classId is required' });
        }

        // Get from Firebase cache
        const { getFirestore } = require('../backend/firebase-admin-init');
        const db = getFirestore();
        const definitionsDoc = await db.collection('definitions').doc('current').get();

        if (!definitionsDoc.exists) {
            return res.status(404).json({ error: 'Definitions not found in cache' });
        }

        const data = definitionsDoc.data();
        const classGroups = data.classGroups || {};
        const groups = classGroups[classId] || [];

        res.json({ groups });

    } catch (e) {
        console.error('Get groups error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
