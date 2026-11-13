/**
 * Firebase Client SDK
 * Handles Firebase initialization and authentication for frontend
 */

// Firebase will be loaded via CDN in index.html
// This file assumes window.firebase is available

let firebaseApp = null;
let firestore = null;
let isAuthenticated = false;
let authPromise = null;

/**
 * Shown instead of SDK internals ("Firestore not initialized...") when the
 * Firebase scripts did not load - blocked by an ad blocker, a captive portal
 * or a dead connection before the service worker cached them.
 */
export const FIREBASE_UNAVAILABLE_MESSAGE =
    'Nepodařilo se připojit k databázi rozvrhů. Zkontrolujte připojení k internetu, případně vypněte blokování obsahu pro tuto stránku, a obnovte ji.';

/** True when the Firebase compat SDK scripts from index.html are loaded. */
export function isFirebaseSdkLoaded() {
    return typeof firebase !== 'undefined' && !!firebase && typeof firebase.initializeApp === 'function';
}

function requireSdk() {
    if (!isFirebaseSdkLoaded()) throw new Error(FIREBASE_UNAVAILABLE_MESSAGE);
    return firebase;
}

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
        const sdk = requireSdk();
        firebaseApp = sdk.initializeApp(config);

        // Initialize Firestore
        firestore = sdk.firestore();

        console.log('✅ Firebase Client initialized');

        return { app: firebaseApp, db: firestore };
    } catch (error) {
        console.error('❌ Failed to initialize Firebase:', error);
        throw error;
    }
}

// Same format check as the server (backend/auth-middleware.js).
const USER_ID_RE = /^anon-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUTH_STATE_TIMEOUT_MS = 5000;

/**
 * Wait until Firebase has restored the session saved in the browser:
 * auth().currentUser is null until then, even for a signed-in user.
 */
function authStateReady(auth) {
    if (typeof auth.authStateReady === 'function') return auth.authStateReady();
    if (typeof auth.onAuthStateChanged !== 'function') return Promise.resolve();
    return new Promise((resolve) => {
        let unsubscribe = null;
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (unsubscribe) unsubscribe();
            resolve();
        };
        const timer = setTimeout(done, AUTH_STATE_TIMEOUT_MS);
        unsubscribe = auth.onAuthStateChanged(done, done);
        if (settled) unsubscribe();
    });
}

/**
 * Authenticate with backend and Firebase (contract S1).
 *
 * The server decides the identity: it returns a new `anon-<uuid>` for first
 * visits and migrates the old guessable `anonymous-<ms>` IDs, so the returned
 * userId - not the one we sent - is what gets stored. The stored ID alone is
 * not enough: the server re-issues it (or migrates a legacy one) only with
 * the ID token of the Firebase session that belongs to it.
 * Concurrent callers (boot + a 401 retry) share one sign-in.
 * @param {{ force?: boolean }} [opts] - force a new sign-in (after a 401)
 */
export function authenticateWithFirebase({ force = false } = {}) {
    if (isAuthenticated && !force) return Promise.resolve(true);
    if (!authPromise) {
        authPromise = signIn(force).finally(() => { authPromise = null; });
    }
    return authPromise;
}

async function signIn(force = false) {
    try {
        const sdk = requireSdk();
        const auth = sdk.auth();
        await authStateReady(auth);

        const storedId = localStorage.getItem('userId') || undefined;
        const user = auth.currentUser;
        const ownsStoredId = !!(user && storedId && user.uid === storedId);

        // The SDK keeps the session by itself: a restored session for the
        // stored anon-<uuid> needs no new custom token.
        if (ownsStoredId && !force && USER_ID_RE.test(storedId)) {
            isAuthenticated = true;
            return true;
        }

        // Prove that the stored ID is ours with the session's ID token.
        let idToken = null;
        if (ownsStoredId) {
            try {
                idToken = await user.getIdToken(force);
            } catch {
                idToken = null; // refresh failed: the server hands out a new ID
            }
        }
        const headers = { 'Content-Type': 'application/json' };
        if (idToken) headers.Authorization = `Bearer ${idToken}`;

        // Get custom token from backend
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers,
            body: JSON.stringify({ userId: storedId }),
        });

        if (!response.ok) {
            throw new Error('Failed to get auth token from backend');
        }

        const { token, userId, migratedFrom } = await response.json();
        if (!token || !userId) throw new Error('Auth response is missing token or userId');

        // Save the server-issued userId (it changes once when an old ID is migrated)
        localStorage.setItem('userId', userId);
        if (migratedFrom) console.log(`🔁 User ID migrated from ${migratedFrom}`);

        // Sign in with custom token
        await auth.signInWithCustomToken(token);

        isAuthenticated = true;
        console.log('✅ Authenticated with Firebase');

        return true;
    } catch (error) {
        isAuthenticated = false;
        console.error('❌ Firebase authentication failed:', error);
        throw error;
    }
}

/**
 * The signed-in user's ID: the token's uid is authoritative (the server
 * compares it with the userId in the URL/body), localStorage is the fallback.
 */
export function getCurrentUserId() {
    try {
        const uid = isFirebaseSdkLoaded() && firebase.auth && firebase.auth().currentUser
            ? firebase.auth().currentUser.uid
            : null;
        return uid || localStorage.getItem('userId');
    } catch {
        return localStorage.getItem('userId');
    }
}

/**
 * Fresh Firebase ID token for `Authorization: Bearer`. getIdToken() refreshes
 * an expired token by itself (they live one hour); forceRefresh is used after
 * the server rejected one.
 * @param {boolean} [forceRefresh]
 * @returns {Promise<string>}
 */
export async function getIdToken(forceRefresh = false) {
    let user = isFirebaseSdkLoaded() ? firebase.auth().currentUser : null;
    if (!user) {
        await authenticateWithFirebase({ force: true });
        user = firebase.auth().currentUser;
    }
    if (!user) throw new Error('Not signed in');
    return user.getIdToken(forceRefresh);
}

/**
 * Get Firestore instance
 * @returns {firebase.firestore.Firestore}
 */
export function getFirestore() {
    if (!firestore) {
        // Reaches the user through loadTimetable's error box, so keep it human.
        throw new Error(FIREBASE_UNAVAILABLE_MESSAGE);
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
            throw new Error('Seznam tříd, učitelů a učeben zatím není k dispozici.');
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
            // Shown to the user (loadTimetable), so Czech and without the doc key
            throw new Error('Tento rozvrh zatím není k dispozici. Zkuste to prosím později.');
        }

        const data = doc.data();
        return data.data || [];
    } catch (error) {
        console.error(`Failed to fetch timetable from Firebase:`, error);
        throw error;
    }
}

/**
 * Summary document aggregates/{id} (contract S3: changes_Actual|Next,
 * freeRooms_Actual|Next). One read instead of every class / room timetable.
 * @returns {Promise<object|null>} null until prefetch has written it
 */
export async function fetchAggregateFromFirebase(id) {
    const db = getFirestore();
    const doc = await db.collection('aggregates').doc(id).get();
    return doc.exists ? doc.data() : null;
}

/**
 * Live aggregate for the kiosk: Firestore pushes every new version, so a
 * hallway screen shows a new substitution without reloading.
 * @returns {() => void} unsubscribe
 */
export function watchAggregateFromFirebase(id, onData, onError) {
    const db = getFirestore();
    return db.collection('aggregates').doc(id).onSnapshot(
        (snap) => onData(snap.exists ? snap.data() : null),
        (err) => { if (onError) onError(err); },
    );
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
