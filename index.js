require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');

// Import routes
const timetableRoutes = require('./routes/timetable');
const authRoutes = require('./routes/auth');
const fcmRoutes = require('./routes/fcm');
const prefetchRoutes = require('./routes/prefetch');
const debugRoutes = require('./routes/debug');
const statusRoutes = require('./routes/status');
const testNotificationsRoutes = require('./routes/test-notifications');
const cronRoutes = require('./routes/cron');
const favoritesRoutes = require('./routes/favorites');

// Debug mode
const DEBUG = process.env.DEBUG === 'true';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50kb' }));

// Serve static files (express.static sets the right Content-Type itself).
// Long-lived caching only for the versioned bundles (?v=hash in the URL);
// everything else stays revalidated so the SW / index.html pick up changes.
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
        if (/[\\/](?:app\.css|app\.js)$/.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('firebase-messaging-sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Serve login page without .html extension
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Mount API routes
app.use('/api', timetableRoutes);
app.use('/api', authRoutes);
app.use('/api', statusRoutes);
// Test/debug notification endpoints are unauthenticated and can send FCM messages
// and expose device tokens — only mount them when DEBUG is explicitly enabled.
if (DEBUG) {
    app.use('/api', testNotificationsRoutes);
    console.log('🔧 Test notification endpoints mounted at /api/test-ntf (DEBUG mode)');
}
app.use('/api/fcm', fcmRoutes);
app.use('/api/prefetch', prefetchRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api', favoritesRoutes);

// Get local IP address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'IP not found';
}

// Start server
const PORT = 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    const localIP = getLocalIP();

    console.log('\n🚀 Server started:');
    console.log(`   http://localhost:${PORT}`);
    console.log(`   http://${localIP}:${PORT}`);

    if (DEBUG) {
        console.log('\n🔧 DEBUG MODE ENABLED');
    }
});
