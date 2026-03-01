#!/usr/bin/env node

/**
 * Standalone Prefetch Script for GitHub Actions
 * Runs prefetch directly without Vercel serverless function limitations
 */

require('dotenv').config();
const { initializeFirebaseAdmin, getFirestore } = require('../backend/firebase-admin-init');
const { prefetchAllData } = require('../backend/prefetch');

async function main() {
    console.log('🚀 Starting prefetch from GitHub Actions...\n');

    const startTime = new Date();

    try {
        // Initialize Firebase Admin
        console.log('🔥 Initializing Firebase Admin...');
        initializeFirebaseAdmin();
        console.log('✅ Firebase Admin initialized\n');

        // Run prefetch
        const result = await prefetchAllData();

        // Update status in Firestore (for /api/status endpoint)
        const db = getFirestore();
        const isHealthy = result.definitionsCount > 0;

        await db.collection('system').doc('prefetchStatus').set({
            isHealthy: isHealthy,
            lastRun: startTime.toISOString(),
            lastSuccess: startTime.toISOString(),
            definitionsCount: result.definitionsCount || 0,
            successCount: result.successCount,
            totalRequests: result.totalRequests,
            error: null,
            updatedAt: new Date().toISOString()
        });

        console.log('✅ Status updated in Firestore');

        // Log results
        console.log('\n' + '='.repeat(60));
        console.log('✅ PREFETCH COMPLETED SUCCESSFULLY');
        console.log('='.repeat(60));
        console.log(`📊 Total requests: ${result.totalRequests}`);
        console.log(`✅ Successful: ${result.successCount}`);
        console.log(`❌ Errors: ${result.errorCount}`);
        console.log(`📚 Definitions: ${result.definitionsCount}`);
        console.log(`⏱️  Duration: ${(result.duration / 1000 / 60).toFixed(2)} minutes`);
        console.log('='.repeat(60) + '\n');

        // Exit with success
        process.exit(0);

    } catch (error) {
        console.error('\n' + '='.repeat(60));
        console.error('❌ PREFETCH FAILED');
        console.error('='.repeat(60));
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('='.repeat(60) + '\n');

        // Update status in Firestore with error
        try {
            const db = getFirestore();
            await db.collection('system').doc('prefetchStatus').set({
                isHealthy: false,
                lastRun: startTime.toISOString(),
                lastSuccess: null,
                definitionsCount: 0,
                successCount: 0,
                totalRequests: 0,
                error: error.message,
                updatedAt: new Date().toISOString()
            });
            console.log('❌ Error status saved to Firestore');
        } catch (fsError) {
            console.error('Failed to save error status to Firestore:', fsError.message);
        }

        // Distinguish expected connectivity issues from real bugs
        // Network/timeout errors = Bakaláři server unreachable (expected, no alert needed)
        const isConnectivityError =
            error.message.includes('timeout') ||
            error.message.includes('login failed after') ||
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('ENOTFOUND') ||
            error.message.includes('ETIMEDOUT') ||
            error.message.includes('socket hang up') ||
            error.message.includes('network');

        if (isConnectivityError) {
            console.log('⚠️  Bakaláři server unreachable — skipping (not a script error)');
            process.exit(0);
        }

        // Real unexpected error → exit 1 → GitHub Actions failure email
        process.exit(1);
    }
}

// Run main function
main();
