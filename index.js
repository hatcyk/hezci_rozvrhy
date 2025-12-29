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

// Import cron
const { startCronJob } = require('./backend/cron');

// Debug mode
const DEBUG = process.env.DEBUG === 'true';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Set proper MIME types
app.use((req, res, next) => {
    if (req.url.endsWith('.js')) {
        res.type('application/javascript');
    } else if (req.url.endsWith('.css')) {
        res.type('text/css');
    }
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api', timetableRoutes);
app.use('/api', authRoutes);
app.use('/api', statusRoutes);
app.use('/api', testNotificationsRoutes);
app.use('/api/fcm', fcmRoutes);
app.use('/api/prefetch', prefetchRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/cron', cronRoutes);

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
