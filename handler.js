// ==================== handler.js ====================
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import crypto from "crypto";
import moment from "moment-timezone";

import decodeJid from "./librairie/decodeJid.js";
import { contextInfo } from "./librairie/docs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commandsDir = path.join(__dirname, "commands");
const commands = new Map();

function getText(m) {
  return (
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    m.message?.documentMessage?.caption ||
    m.message?.buttonsResponseMessage?.selectedButtonId ||
    m.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.message?.templateButtonReplyMessage?.selectedId ||
    ""
  );
}

function getMtype(m) {
  return Object.keys(m.message || {})[0] || "unknown";
}

function getChatType(jid = "") {
  if (jid.endsWith("@g.us")) return "group";
  if (jid.endsWith("@s.whatsapp.net")) return "dm";
  if (jid.endsWith("@newsletter")) return "channel";
  return "community";
}

async function loadCommands() {
  if (!fs.existsSync(commandsDir)) return;
  const files = fs.readdirSync(commandsDir);

  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    try {
      const mod = await import(`./commands/${file}?update=${Date.now()}`);
      const cmd = mod?.default;

      if (cmd?.name && typeof cmd.run === "function") {
        commands.set(String(cmd.name).toLowerCase(), cmd);
        if (Array.isArray(cmd.alias)) {
          for (const a of cmd.alias) commands.set(String(a).toLowerCase(), cmd);
        }
        console.log(`✅ Commande chargée: ${cmd.name}`);
      }
    } catch (e) {
      console.error(`❌ Erreur chargement ${file}:`, e?.message || e);
    }
  }
}

await loadCommands();

if (fs.existsSync(commandsDir)) {
  fs.watch(commandsDir, { recursive: false }, async (evt, filename) => {
    if (filename && filename.endsWith(".js")) {
      console.log(`🔄 Reload commande: ${filename}`);
      await loadCommands();
    }
  });
}

export default function handler(sock) {
  if (typeof sock.public !== "boolean") sock.public = true;

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages?.[0];
    if (!m || !m.message) return;

    try {
      if (m.key?.remoteJid === "status@broadcast") return;

      m.chat = m.key.remoteJid;
      m.mtype = getMtype(m);
      m.text = getText(m) || "";

      m.reply = async (text, extra = {}) => {
        return sock.sendMessage(m.chat, { text, ...extra }, { quoted: m });
      };

      const prefix = ",";
      const body = String(m.text || "").trim();

      const botNumber = await decodeJid(sock.user?.id || "");
      m.sender = m.key.fromMe ? botNumber : (m.key.participant || m.key.remoteJid);

      const owners = (process.env.OWNERS || "24165726941").split(",").map(s => s.trim()).filter(Boolean);
      const senderNumber = String(m.sender || "").split("@")[0];
      const isCreator = owners.includes(senderNumber) || m.key.fromMe;

      // Mode privé
      if (!sock.public && !m.key.fromMe && !isCreator) {
        if (body.startsWith(prefix)) return;
      }

      // Group meta
      const isGroup = m.chat.endsWith("@g.us");
      let metadata = null;
      let participants = [];
      let groupName = "";
      let isBotAdmin = false;
      let isAdmin = false;

      if (isGroup) {
        try {
          metadata = await sock.groupMetadata(m.chat);
          participants = metadata?.participants || [];
          groupName = metadata?.subject || "";

          const botP = participants.find(p => p.id === botNumber);
          const sndP = participants.find(p => p.id === m.sender);

          isBotAdmin = !!botP?.admin;
          isAdmin = !!sndP?.admin;
        } catch {
          // ignore
        }
      }

      if (!body.startsWith(prefix)) return;

      const parts = body.slice(prefix.length).trim().split(/\s+/);
      const commandName = (parts.shift() || "").toLowerCase();
      const args = parts;
      const text = args.join(" ");

      // public/private intégrés
      if (commandName === "public") {
        await sock.sendMessage(m.chat, { react: { text: "🔓", key: m.key } });
        if (!isCreator) {
          return sock.sendMessage(m.chat, {
            text: "🚫 COMMANDE RÉSERVÉE AU PROPRIÉTAIRE.",
            contextInfo: { ...contextInfo, mentionedJid: [m.sender] }
          });
        }
        sock.public = true;
        return m.reply("NOVA XMD V1\nPUBLIC DONE ✅");
      }

      if (commandName === "private") {
        await sock.sendMessage(m.chat, { react: { text: "🔒", key: m.key } });
        if (!isCreator) {
          return sock.sendMessage(m.chat, {
            text: "🚫 COMMANDE RÉSERVÉE AU PROPRIÉTAIRE.",
            contextInfo: { ...contextInfo, mentionedJid: [m.sender] }
          });
        }
        sock.public = false;
        return m.reply("NOVA XMD V1\nSELF DONE ✅");
      }

      const cmd = commands.get(commandName);
      if (!cmd) return;

      const time = moment().tz(process.env.TIMEZONE || "Africa/Ouagadougou").format("HH:mm:ss DD/MM");
      const makeid = crypto.randomBytes(3).toString("hex");

      await cmd.run(sock, m, null, args, {
        isGroup,
        metadata,
        participants,
        isAdmins: isAdmin,
        isBotAdmins: isBotAdmin,

        isOwner: isCreator,
        isSudo: isCreator,
        isAdminOrOwner: isAdmin || isCreator,

        body,
        sender: m.sender,
        chatType: getChatType(m.chat),

        text,
        botNumber,
        senderNumber,
        pushname: m.pushName || "No Name",
        groupName,
        command: prefix + commandName,
        prefix,
        time,
        makeid,
        crypto,
        moment
      });
    } catch (err) {
      console.error("❌ Erreur Handler:", err?.message || err);
      try {
        await sock.sendMessage(m.chat, { text: "⚠️ Une erreur est survenue." }, { quoted: m });
      } catch {}
    }
  });
}
