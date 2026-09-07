/**
 * Firebase Client SDK
 * Handles Firebase initialization and authentication for frontend
 */

// Firebase will be loaded via CDN in index.html
// This file assumes window.firebase is available

let firebaseApp = null;
let firestore = null;
let isAuthenticated = false;

/**
 * Initialize Firebase Client SDK
 * @param {object} config - Firebase configuration (from index.html)
 */
export async function initializeFirebase(config) {
    try {
        if (firebaseApp) {
            console.log('Firebase already initialized');
            return { app: firebaseApp, db: firestore };
        }

        // Initialize Firebase App
        firebaseApp = firebase.initializeApp(config);

        // Initialize Firestore
        firestore = firebase.firestore();

        console.log('✅ Firebase Client initialized');

        return { app: firebaseApp, db: firestore };
    } catch (error) {
        console.error('❌ Failed to initialize Firebase:', error);
        throw error;
    }
}

/**
 * Authenticate with backend and Firebase
 */
export async function authenticateWithFirebase() {
    try {
        if (isAuthenticated) {
            console.log('Already authenticated');
            return true;
        }

        // Get custom token from backend
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: localStorage.getItem('userId') || undefined,
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to get auth token from backend');
        }

        const { token, userId } = await response.json();

        // Save userId for future requests
        localStorage.setItem('userId', userId);

        // Sign in with custom token
        await firebase.auth().signInWithCustomToken(token);

        isAuthenticated = true;
        console.log('✅ Authenticated with Firebase');

        return true;
    } catch (error) {
        console.error('❌ Firebase authentication failed:', error);
        throw error;
    }
}

/**
 * Get Firestore instance
 * @returns {firebase.firestore.Firestore}
 */
export function getFirestore() {
    if (!firestore) {
        throw new Error('Firestore not initialized. Call initializeFirebase() first.');
    }
    return firestore;
}

/**
 * Fetch definitions from Firebase
 */
export async function fetchDefinitionsFromFirebase() {
    try {
        const db = getFirestore();
        const doc = await db.collection('definitions').doc('current').get();

        if (!doc.exists) {
            throw new Error('Definitions not found in Firebase');
        }

        const data = doc.data();
        return {
            classes: data.classes || [],
            teachers: data.teachers || [],
            rooms: data.rooms || [],
        };
    } catch (error) {
        console.error('Failed to fetch definitions from Firebase:', error);
        throw error;
    }
}

/**
 * Fetch timetable from Firebase
 */
export async function fetchTimetableFromFirebase(type, id, scheduleType) {
    try {
        const db = getFirestore();
        // Capitalize schedule type to match Firebase document keys (Actual/Permanent/Next)
        const capitalizedScheduleType = scheduleType.charAt(0).toUpperCase() + scheduleType.slice(1);
        const docKey = `${type}_${id}_${capitalizedScheduleType}`;
        const doc = await db.collection('timetables').doc(docKey).get();

        if (!doc.exists) {
            throw new Error(`Timetable not found: ${docKey}`);
        }

        const data = doc.data();
        return data.data || [];
    } catch (error) {
        console.error(`Failed to fetch timetable from Firebase:`, error);
        throw error;
    }
}

/**
 * Get last update timestamp from Firebase metadata
 */
export async function getLastUpdateTime() {
    try {
        const db = getFirestore();
        const doc = await db.collection('metadata').doc('lastPrefetch').get();

        if (!doc.exists) {
            return null;
        }

        const data = doc.data();
        return data.timestamp;
    } catch (error) {
        console.error('Failed to get last update time:', error);
        return null;
    }
}
