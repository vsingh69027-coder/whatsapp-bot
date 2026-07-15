const { default: makeWASocket, DisconnectReason, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const { MongoClient } = require('mongodb');
const cron = require('node-cron');
const express = require('express');
const qrcode = require('qrcode-terminal');
require('dotenv').config();

// --- DUMMY SERVER FOR RENDER ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Baileys WhatsApp Bot is running!'));
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

async function startBot() {
    console.log("⏳ Connecting to MongoDB...");
    const mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    const collection = mongoClient.db('whatsapp_bot').collection('auth_info');
    console.log("✅ Connected to MongoDB");

    const writeData = (data, id) => {
        return collection.replaceOne({ _id: id }, JSON.parse(JSON.stringify(data, BufferJSON.replacer)), { upsert: true });
    };
    const readData = async (id) => {
        const data = await collection.findOne({ _id: id });
        return data ? JSON.parse(JSON.stringify(data), BufferJSON.reviver) : null;
    };
    const removeData = (id) => collection.deleteOne({ _id: id });

    const creds = await readData('creds') || initAuthCreds();

    const state = {
        creds,
        keys: {
            get: async (type, ids) => {
                const data = {};
                await Promise.all(ids.map(async id => {
                    let value = await readData(`${type}-${id}`);
                    if (type === 'app-state-sync-key' && value) {
                        value = require('@whiskeysockets/baileys').proto.Message.AppStateSyncKeyData.fromObject(value);
                    }
                    data[id] = value;
                }));
                return data;
            },
            set: async (data) => {
                const tasks = [];
                for (const category in data) {
                    for (const id in data[category]) {
                        const value = data[category][id];
                        const key = `${category}-${id}`;
                        tasks.push(value ? writeData(value, key) : removeData(key));
                    }
                }
                await Promise.all(tasks);
            }
        }
    };

    const saveCreds = () => writeData(state.creds, 'creds');

    function connectToWhatsApp() {
        const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
        const pino = require('pino');
        
        const sock = makeWASocket({
            printQRInTerminal: true,
            auth: state,
            logger: pino({ level: 'silent' }), // Hide verbose background sync warnings
            defaultQueryTimeoutMs: undefined
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if(qr) {
                console.log("\nScan this QR code to log in:");
                qrcode.generate(qr, { small: true });
            }
            if(connection === 'close') {
                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
                if(shouldReconnect) {
                    connectToWhatsApp();
                }
            } else if(connection === 'open') {
                console.log('✅ WhatsApp Bot Ready & Authenticated!');
                
                cron.schedule(SCHEDULE_TIME, async () => {
                    const jid = TARGET_NUMBER + '@s.whatsapp.net';
                    try {
                        await sock.sendMessage(jid, { text: MESSAGE_TEXT });
                        console.log(`[✓] Message sent to ${TARGET_NUMBER} at ${new Date().toLocaleString()}`);
                    } catch(err) {
                        console.error('❌ Error sending message:', err);
                    }
                });
                console.log(`⏳ Scheduled to send "${MESSAGE_TEXT}" to ${TARGET_NUMBER} using schedule: ${SCHEDULE_TIME}`);
            }
        });

        sock.ev.on('creds.update', saveCreds);
    }

    connectToWhatsApp();
}

startBot().catch(console.error);