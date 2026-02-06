import express from 'express';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

const app = express();
const port = 2038;

// Variables globales
const activeSockets = new Map();
const socketCreationTime = new Map();

import handler from './handler.js';

// Import config (ajuster selon votre structure)
const config = {
    MAX_RETRIES: 5,
    NEWSLETTER_JID: '120363330645505280@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    IMAGE_PATH: '',
};

const SESSION_BASE_PATH = './session';

import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} from 'baileys';

// START BOT
async function StartBot(phoneNumber, res) {
const sanitizedNumber = phoneNumber.replace(/[^0-9]/g, '');
const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

// Créer le dossier de session si nécessaire
if (!fs.existsSync(sessionPath)) {
fs.mkdirSync(sessionPath, { recursive: true });
}

const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

try {
const DevMessyBot = makeWASocket({
  auth: {
  creds: state.creds,
  keys: makeCacheableSignalKeyStore(state.keys, logger),
  },
  printQRInTerminal: false,
  logger,
  browser: Browsers.macOS('Safari')
  });

function setupAutoRestart(DevMessyBot, number) {
DevMessyBot.ev.on('connection.update', async (update) => {
const { connection, lastDisconnect } = update;
if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
console.log(`Connection lost for ${number}, attempting to reconnect...`);
  await delay(10000);
  activeSockets.delete(number.replace(/[^0-9]/g, ''));
  socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
  const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
  await StartBot(number, mockRes); 
  // Utilise StartBot directement
  }
 });
}

  setupAutoRestart(DevMessyBot, sanitizedNumber);
  handler(DevMessyBot, m, msg, rawMsg)

if (!DevMessyBot.authState.creds.registered) {
   let retries = config.MAX_RETRIES;
   let code;
   while (retries > 0) {
try {
   await delay(1500);
   code = await DevMessyBot.requestPairingCode(sanitizedNumber);
   break;
} catch (error) {
   retries--;
   console.warn(`Failed to request pairing code: ${error.message}, retries left: ${retries}`);
   await delay(2000 * (config.MAX_RETRIES - retries));
  }
}

if (!res.headersSent) {
   res.send({ code });
 }
}

DevMessyBot.ev.on('connection.update', async (update) => {
const { connection } = update;
if (connection === 'open') {
try {
  await delay(3000);

try {
if (config.NEWSLETTER_JID) {
   await DevMessyBot.newsletterFollow(config.NEWSLETTER_JID)
if (config.NEWSLETTER_MESSAGE_ID) {
   await DevMessyBot.sendMessage(config.NEWSLETTER_JID, { 
   react: { 
   text: '❤️', 
   key: { id: config.NEWSLETTER_MESSAGE_ID } 
   } 
 });
}

console.log('✅ Auto-followed newsletter & reacted ❤️');
}
} catch (error) {
console.error('❌ Newsletter error:', error.message);
}

activeSockets.set(sanitizedNumber, DevMessyBot);
                    
const now = new Date();
const dateStr = now.toLocaleDateString('fr-FR');
const timeStr = now.toLocaleTimeString('fr-FR');
const activeSessionCount = activeSockets.size;

await DevMessyBot.sendMessage(DevMessyBot.user.id, {
    image: { url: config.IMAGE_PATH },
    caption: `*🤖 BOT CONNECTÉ AVEC SUCCÈS* ✅\n\n` +
            `📅 *Date* : ${dateStr}\n` +
            `⏰ *Heure* : ${timeStr}\n` +
            `🔢 *Numéro* : ${sanitizedNumber}\n` +
            `👥 *Sessions actives* : ${activeSessionCount}\n\n` +
            `_Tapez *menu* pour voir les options disponibles_`
});

} catch (error) {
console.error('Error during connection setup:', error);
 }
}
});

// Sauvegarder les credentials
DevMessyBot.ev.on('creds.update', saveCreds);

} catch (error) {
console.error('Error creating DevMessyBot:', error);
if (!res.headersSent) {
   res.status(500).json({ error: "Failed to create bot session" });
  }
 }
}

app.get('/pair', async (req, res) => {
    const phoneNumber = req.query.code;
    if (!phoneNumber) {
        return res.status(400).json({ message: 'Numéro de téléphone requis' });
    }
  
    try {
        await StartBot(phoneNumber, res);
    } catch (error) {
        console.log("Erreur lors de l'appairage :", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Erreur interne du serveur" });
        }
    }
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'WhatsApp Bot API'
    });
});

app.listen(port, () => {
    console.log(`✅ Serveur démarré sur le port ${port}`);
    console.log(`🔗 Endpoint: http://localhost:${port}/pair?code=+226xxxxxxxx`);
});