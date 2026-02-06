import express from "express";
import fs from "fs";
import path from "path";
import pino from "pino";

import handler from "./handler.js";

import makeWASocket, {
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers
} from "@whiskeysockets/baileys";

const app = express();

// Render fournit PORT
const PORT = Number(process.env.PORT || 2038);

// ================== CONFIG ==================
const config = {
  MAX_RETRIES: 5,

  // ✅ Message de bienvenue (WhatsApp)
  WELCOME_IMAGE: "https://files.catbox.moe/wgpnnv.jpg",
  CHANNEL_URL: "https://whatsapp.com/channel/0029VbBrAUYAojYjf3Ndw70d",
  CHANNEL_TITLE: "NOVA XMD • Chaîne Officielle",
  CHANNEL_BODY: "Clique pour rejoindre 🚀",

  // Newsletter (optionnel)
  NEWSLETTER_JID: "120363330645505280@newsletter",
  NEWSLETTER_MESSAGE_ID: "428"
};

const SESSION_BASE_PATH = "./session";

// ================== GLOBALS ==================
const activeSockets = new Map(); // number -> sock
const socketCreationTime = new Map();

// ================== EXPRESS ==================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.get("/pair", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "pair.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "dashboard.html"));
});

// Health
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    sessions_active: activeSockets.size
  });
});

// Dashboard data
app.get("/api/status", (req, res) => {
  const sessions = Array.from(activeSockets.keys()).map((n) => ({
    number: n,
    since: socketCreationTime.get(n) || null
  }));

  res.json({
    ok: true,
    sessions_active: activeSockets.size,
    sessions
  });
});

// Pairing API
app.get("/api/pair", async (req, res) => {
  const phoneNumber = String(req.query.number || "").trim();
  if (!phoneNumber) {
    return res.status(400).json({ ok: false, error: "Numéro requis" });
  }

  try {
    const result = await startBot(phoneNumber, res);
    // startBot envoie déjà la réponse si besoin
    if (!res.headersSent && result?.code) {
      res.json({ ok: true, code: result.code });
    }
  } catch (e) {
    console.error("PAIR ERROR:", e);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "Erreur interne" });
    }
  }
});

// ================== BOT ==================
async function startBot(phoneNumber, res) {
  const sanitized = String(phoneNumber).replace(/[^0-9]/g, "");
  if (sanitized.length < 8) {
    if (!res.headersSent) res.status(400).json({ ok: false, error: "Numéro invalide" });
    return;
  }

  // si déjà actif
  if (activeSockets.has(sanitized)) {
    return { ok: true, code: null, alreadyActive: true };
  }

  const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitized}`);
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const logger = pino({ level: process.env.NODE_ENV === "production" ? "fatal" : "silent" });

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    printQRInTerminal: false,
    browser: Browsers.macOS("Safari")
  });

  // handler (commands)
  try {
    handler(sock);
  } catch (e) {
    console.log("⚠️ handler() error:", e?.message || e);
  }

  // track
  activeSockets.set(sanitized, sock);
  socketCreationTime.set(sanitized, Date.now());

  sock.ev.on("creds.update", saveCreds);

  // auto restart
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== 401;

      activeSockets.delete(sanitized);
      socketCreationTime.delete(sanitized);

      if (shouldReconnect) {
        console.log(`🔄 Reconnect ${sanitized}...`);
        await delay(8000);
        const mockRes = { headersSent: true, json: () => {}, status: () => mockRes };
        await startBot(sanitized, mockRes);
      } else {
        console.log(`🔒 Logged out (401) for ${sanitized}`);
      }
    }

    if (connection === "open") {
      try {
        await delay(2000);

        // Newsletter follow (optionnel)
        try {
          if (config.NEWSLETTER_JID) {
            await sock.newsletterFollow(config.NEWSLETTER_JID);
            if (config.NEWSLETTER_MESSAGE_ID) {
              await sock.sendMessage(config.NEWSLETTER_JID, {
                react: { text: "❤️", key: { id: config.NEWSLETTER_MESSAGE_ID } }
              });
            }
          }
        } catch {}

        const now = new Date();
        const dateStr = now.toLocaleDateString("fr-FR");
        const timeStr = now.toLocaleTimeString("fr-FR");

        // ✅ Welcome message with hidden channel link
        await sock.sendMessage(sock.user.id, {
          image: { url: config.WELCOME_IMAGE },
          caption:
            `*🤖 BOT NOVA XMD V1 CONNECTÉ AVEC SUCCÈS* ✅\n\n` +
            `📅 *Date* : ${dateStr}\n` +
            `⏰ *Heure* : ${timeStr}\n` +
            `🔢 *Numéro* : ${sanitized}\n` +
            `👥 *Sessions actives* : ${activeSockets.size}\n\n` +
            `👉 *Voir la chaîne officielle*`,
          contextInfo: {
            externalAdReply: {
              title: config.CHANNEL_TITLE,
              body: config.CHANNEL_BODY,
              mediaType: 1,
              renderLargerThumbnail: true,
              thumbnailUrl: config.WELCOME_IMAGE,
              sourceUrl: config.CHANNEL_URL
            }
          }
        });

        console.log(`✅ Connected: ${sanitized}`);
      } catch (e) {
        console.log("Welcome error:", e?.message || e);
      }
    }
  });

  // pairing code
  if (!sock.authState?.creds?.registered) {
    let retries = config.MAX_RETRIES;
    let code = null;

    while (retries > 0) {
      try {
        await delay(1200);
        code = await sock.requestPairingCode(sanitized);
        break;
      } catch (err) {
        retries--;
        console.warn(`Pairing code failed: ${err?.message || err} | retries: ${retries}`);
        await delay(1500);
      }
    }

    if (!res.headersSent) {
      res.json({ ok: true, code });
    }

    return { ok: true, code };
  }

  // déjà enregistré
  if (!res.headersSent) {
    res.json({ ok: true, code: null, registered: true });
  }

  return { ok: true, code: null, registered: true };
}

app.listen(PORT, () => {
  console.log(`✅ Server running on :${PORT}`);
});
