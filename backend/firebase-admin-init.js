/**
 * Firebase Admin SDK Initialization
 * Initializes Firebase Admin for server-side operations (Firestore writes, auth)
 */

const admin = require('firebase-admin');
const path = require('path');

let firebaseApp = null;
let db = null;

/**
 * Initialize Firebase Admin SDK
 * Supports two modes:
 * 1. Local: FIREBASE_SERVICE_ACCOUNT_PATH (path to JSON file)
 * 2. Vercel: FIREBASE_SERVICE_ACCOUNT (entire JSON as string)
 */
function initializeFirebaseAdmin() {
    if (firebaseApp) {
        console.log('Firebase Admin already initialized');
        return { app: firebaseApp, db };
    }

    try {
        let serviceAccount;

        // Check if running on Vercel (or any env with JSON string)
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            console.log('Loading Firebase from FIREBASE_SERVICE_ACCOUNT env var');
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        }
        // Local development with file path
        else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
            console.log('Loading Firebase from file path');
            const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
            serviceAccount = require(path.resolve(serviceAccountPath));
        }
        else {
            throw new Error(
                'Firebase credentials not found!\n' +
                'For local: Add FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json\n' +
                'For Vercel: Add FIREBASE_SERVICE_ACCOUNT={...json...}'
            );
        }

        // Initialize Firebase Admin
        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });

        // Get Firestore instance
        db = admin.firestore();

        console.log('✅ Firebase Admin initialized successfully');
        console.log(`   Project: ${serviceAccount.project_id}`);

        return { app: firebaseApp, db };
    } catch (error) {
        console.error('❌ Failed to initialize Firebase Admin:', error.message);
        throw error;
    }
}

/**
 * Get Firestore database instance
 * @returns {FirebaseFirestore.Firestore}
 */
function getFirestore() {
    if (!db) {
        const result = initializeFirebaseAdmin();
        return result.db;
    }
    return db;
}

/**
 * Get Firebase Admin app instance
 * @returns {admin.app.App}
 */
function getFirebaseApp() {
    if (!firebaseApp) {
        const result = initializeFirebaseAdmin();
        return result.app;
    }
    return firebaseApp;
}

/**
 * Get Firebase Messaging instance
 * @returns {admin.messaging.Messaging}
 */
function getMessaging() {
    const app = getFirebaseApp();
    return app.messaging();
}

/**
 * Create custom auth token for client
 * @param {string} uid - User ID
 * @param {object} claims - Optional custom claims
 * @returns {Promise<string>} Custom token
 */
async function createCustomToken(uid, claims = {}) {
    try {
        const app = getFirebaseApp();
        const token = await app.auth().createCustomToken(uid, claims);
        return token;
    } catch (error) {
        console.error('Failed to create custom token:', error);
        throw error;
    }
}

module.exports = {
    initializeFirebaseAdmin,
    getFirestore,
    getMessaging,
    createCustomToken,
};
