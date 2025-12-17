#!/usr/bin/env node

/**
 * Standalone Notification Processing Script for GitHub Actions
 * Processes pending change notifications from Firestore and sends FCM notifications
 */

require('dotenv').config();
const { initializeFirebaseAdmin, getFirestore } = require('../backend/firebase-admin-init');
const { processPendingChanges } = require('../backend/fcm');

async function main() {
    console.log('🔔 Starting notification processing from GitHub Actions...\n');

    const startTime = new Date();

    try {
        // Initialize Firebase Admin
        console.log('🔥 Initializing Firebase Admin...');
        initializeFirebaseAdmin();
        console.log('✅ Firebase Admin initialized\n');

        // Process pending changes
        const result = await processPendingChanges();

        // Update status in Firestore (for monitoring)
        const db = getFirestore();
        await db.collection('system').doc('notificationStatus').set({
            lastRun: startTime.toISOString(),
            lastSuccess: startTime.toISOString(),
            processedCount: result.processedCount || 0,
            sentCount: result.sentCount || 0,
            error: null,
            updatedAt: new Date().toISOString()
        });

        console.log('✅ Status updated in Firestore');

        // Log results
        console.log('\n' + '='.repeat(60));
        console.log('✅ NOTIFICATION PROCESSING COMPLETED SUCCESSFULLY');
        console.log('='.repeat(60));
        console.log(`📊 Change documents processed: ${result.processedCount}`);
        console.log(`📨 Notifications sent: ${result.sentCount}`);
        console.log(`⏱️  Duration: ${((Date.now() - startTime.getTime()) / 1000).toFixed(2)} seconds`);
        console.log('='.repeat(60) + '\n');

        // Exit with success
        process.exit(0);

    } catch (error) {
        console.error('\n' + '='.repeat(60));
        console.error('❌ NOTIFICATION PROCESSING FAILED');
        console.error('='.repeat(60));
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('='.repeat(60) + '\n');

        // Update status in Firestore with error
        try {
            const db = getFirestore();
            await db.collection('system').doc('notificationStatus').set({
                lastRun: startTime.toISOString(),
                lastSuccess: null,
                processedCount: 0,
                sentCount: 0,
                error: error.message,
                updatedAt: new Date().toISOString()
            });
            console.log('❌ Error status saved to Firestore');
        } catch (fsError) {
            console.error('Failed to save error status to Firestore:', fsError.message);
        }

        // Exit with error
        process.exit(1);
    }
}

// Run main function
main();
