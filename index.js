require('dotenv').config();
// Vercel deploys index.js as the Express app only if this file itself
// requires 'express' (@vercel/express checks the source with a regex), even
// though the app is built in routes/index.js. Without it the build fails with
// "No entrypoint found which imports express".
require('express');
const os = require('os');
const { createApp, listenHost } = require('./routes');

// Debug mode
const DEBUG = process.env.DEBUG === 'true';

// Middleware, static files and API routes are set up in routes/index.js.
const app = createApp();

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
const PORT = process.env.PORT || 3000;
// 127.0.0.1 by default; HOST=0.0.0.0 for the LAN (e.g. trying it on a phone)
const HOST = listenHost();

app.listen(PORT, HOST, () => {
    console.log('\n🚀 Server started:');
    console.log(`   http://localhost:${PORT}`);
    if (HOST === '0.0.0.0' || HOST === '::') {
        console.log(`   http://${getLocalIP()}:${PORT}`);
    }

    if (DEBUG) {
        console.log('\n🔧 DEBUG MODE ENABLED');
    }
});
