const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const express = require('express');
require('dotenv').config();

// --- DUMMY SERVER FOR RENDER ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('WhatsApp Bot is running!'));
app.listen(PORT, () => console.log(`🌍 Server is listening on port ${PORT}`));
// -------------------------------

const MONGODB_URI = process.env.MONGODB_URI;
const TARGET_NUMBER = process.env.TARGET_NUMBER || '919876543210'; 
const MESSAGE_TEXT = process.env.MESSAGE_TEXT || 'Good Morning 🌞';
const SCHEDULE_TIME = process.env.SCHEDULE_TIME || '0 8 * * *';

if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI is not set!");
    process.exit(1);
}

mongoose.connect(MONGODB_URI).then(() => {
    console.log("✅ Connected to MongoDB");
    const store = new MongoStore({ mongoose: mongoose });
    
    const client = new Client({
        authStrategy: new RemoteAuth({
            clientId: "render-whatsapp-bot",
            store: store,
            backupSyncIntervalMs: 300000
        }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => {
        qrcode.generate(qr, { small: true });
        console.log("Scan the QR code above to link your device.");
    });

    client.on('remote_session_saved', () => {
        console.log('✅ Session saved to MongoDB! You will not need to scan again after restarts.');
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp Bot Ready & Authenticated!');
        
        cron.schedule(SCHEDULE_TIME, () => {
            const chatId = TARGET_NUMBER + '@c.us';
            client.sendMessage(chatId, MESSAGE_TEXT).then(() => {
                console.log(`[✓] Message sent to ${TARGET_NUMBER} at ${new Date().toLocaleString()}`);
            }).catch(err => console.error('❌ Error sending message:', err));
        });
        console.log(`⏳ Scheduled to send "${MESSAGE_TEXT}" to ${TARGET_NUMBER} using schedule: ${SCHEDULE_TIME}`);
    });

    client.initialize();
}).catch(err => {
    console.error("❌ Failed to connect to MongoDB:", err);
});