// ==================== handler.js ====================
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import decodeJid from "./librairie/decodeJid.js";
import crypto from "crypto";
import moment from 'moment-timezone';
import { contextInfo } from './librairie/docs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const commands = new Map();
global.groupCache = {};

const commandsDir = path.join(__dirname, "commands");

// Charger toutes les commandes dynamiquement
async function loadCommands() {
  const files = fs.readdirSync(commandsDir);
  for (const file of files) {
    if (file.endsWith(".js")) {
      try {
        const filePath = path.join(commandsDir, file);
        const fileUrl = pathToFileURL(filePath).href;
        if (import.meta.resolve) delete import.meta.resolve[fileUrl];

        const { default: cmd } = await import(`./commands/${file}?update=${Date.now()}`);
        if (cmd?.name && typeof cmd.run === "function") {
          commands.set(cmd.name, cmd);
          console.log(`✅ Commande chargée: ${cmd.name}`);
        }
      } catch (err) {
        console.error(`❌ Erreur chargement ${file}:`, err);
      }
    }
  }
}

// Initial load
await loadCommands();

// Watcher pour recharger automatiquement les nouvelles commandes
fs.watch(commandsDir, { recursive: false }, async (eventType, filename) => {
  if (filename && filename.endsWith(".js")) {
    console.log(`🔄 Détection de modification / ajout de commande: ${filename}`);
    await loadCommands();
  }
});

function getChatType(jid) {
  if (jid.endsWith("@g.us")) return "group";
  if (jid.endsWith("@s.whatsapp.net")) return "dm";
  if (jid.endsWith("@newsletter")) return "channel";
  return "community";
}

// ==================== Handler principal ====================
export default async function handler(DevMessyBot, m, msg, rawMsg) {
    DevMessyBot.ev.on('messages.upsert', async ({ messages }) => {
  try {
    const owner2 = ["24165726941"];
    const sender = m.key.fromMe ? DevMessyBot.user.id.split(":")[0] + "@s.whatsapp.net" || DevMessyBot.user.id : m.key.participant || m.key.remoteJid;
    const budy = (typeof m.text === 'string' ? m.text : '');
    const prefix = ",";
    
    // Récupération du texte de la commande
    let body = (
      m.mtype === "conversation" ? m.message.conversation :
      m.mtype === "imageMessage" ? m.message.imageMessage.caption :
      m.mtype === "videoMessage" ? m.message.videoMessage.caption :
      m.mtype === "extendedTextMessage" ? m.message.extendedTextMessage.text :
      m.mtype === "buttonsResponseMessage" ? m.message.buttonsResponseMessage.selectedButtonId :
      m.mtype === "listResponseMessage" ? m.message.listResponseMessage.singleSelectReply.selectedRowId :
      m.mtype === "interactiveResponseMessage" ? (() => {
        try {
          return JSON.parse(m.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson).id;
        } catch {
          return "";
        }
      })() :
      m.mtype === "templateButtonReplyMessage" ? m.message.templateButtonReplyMessage.selectedId :
      m.mtype === "messageContextInfo" ?
        m.message.buttonsResponseMessage?.selectedButtonId ||
        m.message.listResponseMessage?.singleSelectReply.selectedRowId ||
        m.message.interactiveResponseMessage?.nativeFlowResponseMessage ||
        m.text :
      ""
    );

    if (!body) body = "";
    
    if (!body.startsWith(prefix)) return;  
    const isCreator = owner2.includes(m.sender) ? true : m.sender == owner+"@s.whatsapp.net" ? true : m.fromMe ? true : false;
    const isCmd = body.startsWith(prefix);
    const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : "";
    const cmdString = prefix + command;
    const args = body.trim().split(/ +/).slice(1);
    const time = moment().format("HH:mm:ss DD/MM");
    const { randomBytes } = crypto;
    const makeid = randomBytes(3).toString('hex');
    const quoted = m.quoted ? m.quoted : m;
    const mime = (quoted.msg || quoted).mimetype || '';
    const qmsg = (quoted.msg || quoted);
    const text = args.join(" ");
    const botNumber = await decodeJid(DevMessyBot.user.id);
    const isGroup = m.chat.endsWith('@g.us');
    const senderNumber = m.sender.split('@')[0];
    const pushname = m.pushName || "No Name";
    const isBot = botNumber.includes(senderNumber);
    const groupMetadata = isGroup ? await DevMessyBot.groupMetadata(m.chat) : {};
    let participant_bot = isGroup ? groupMetadata.participants.find((v) => v.id == botNumber) : {};
    const groupName = isGroup ? groupMetadata.subject : "";
    const participants = isGroup ? await groupMetadata.participants : "";
    const isBotAdmin = participant_bot?.admin !== null ? true : false;
    const isAdmin = participants?.admin !== null ? true : false;

    // SWITCH CASE pour les commandes intégrées
    switch(command) {
      case "public": {
        await DevMessyBot.sendMessage(m.chat, { react: { text: "🔓", key: m.key } });
        
        if (!isCreator) {
          return DevMessyBot.sendMessage(m.chat, { 
            text: "🚫 𝙲𝙾𝙼𝙼𝙰𝙽𝙳𝙴 𝚁𝙴𝚂𝙴𝚁𝚅𝙴𝙴 𝙰𝚄 𝙿𝚁𝙾𝙿𝚁𝙸𝙴𝚃𝙰𝙸𝚁𝙴.",
            contextInfo: {
              ...contextInfo,
              mentionedJid: [m.sender]
            }
          });
        }
        
        DevMessyBot.public = true;
        
        await DevMessyBot.sendMessage(m.chat, { 
          text: '𝙰𝚁𝙲𝙰𝙽𝙴 𝙼𝙳 𝙼𝙾𝙳𝙴\n𝙿𝚄𝙱𝙻𝙸𝙲 𝙳𝙾𝙽𝙴 ✅',
          contextInfo: {
            ...contextInfo,
            mentionedJid: [m.sender]
          }
        });
        return;
      }

      case "private": {
        await DevMessyBot.sendMessage(m.chat, { react: { text: "🔒", key: m.key } });
        
        if (!isCreator) {
          return DevMessyBot.sendMessage(m.chat, { 
            text: "🚫 𝙲𝙾𝙼𝙼𝙰𝙽𝙳𝙴 𝚁𝙴𝚂𝙴𝚁𝚅𝙴𝙴 𝙰𝚄 𝙿𝚁𝙾𝙿𝚁𝙸𝙴𝚃𝙰𝙸𝚁𝙴.",
            contextInfo: {
              ...contextInfo,
              mentionedJid: [m.sender]
            }
          });
        }
        
        DevMessyBot.public = false;
        
        await DevMessyBot.sendMessage(m.chat, { 
          text: '𝙰𝚁𝙲𝙰𝙽𝙴 𝙼𝙳 𝙼𝙾𝙳𝙴\n𝚂𝙴𝙻𝙵 𝙳𝙾𝙽𝙴 ✅',
          contextInfo: {
            ...contextInfo,
            mentionedJid: [m.sender]
          }
        });
        return;
      }
    }

    // Vérification mode privé (APRÈS les commandes public/private)
    if (!DevMessyBot.public && !m.key.fromMe && !isCreator) {
      console.log(`🚫 Mode privé - Commande bloquée de ${m.sender}`);
      return;
    }

    const cmd = commands.get(command);

    // Exécution de la commande avec toutes les variables nécessaires
    await cmd.run(DevMessyBot, m, msg, args, {
      // Pour les groupes
      isGroup,
      metadata: groupMetadata,
      participants,
      isAdmins: isAdmin,
      isBotAdmins: isBotAdmin,
      
      // Pour les permissions owner/sudo
      isOwner: isCreator,
      isSudo: isCreator,
      isAdminOrOwner: isAdmin || isCreator,
      
      // Données du message
      body,
      budy,
      sender: m.sender,
      chatType: getChatType(m.chat),
      
      // Variables supplémentaires
      text,
      botNumber,
      senderNumber,
      pushname,
      isBot,
      groupName,
      quoted,
      mime,
      qmsg,
      command: cmdString,
      prefix,
      time,
      makeid,
      crypto,
      moment
    });

  } catch (err) {
    console.error("❌ Erreur Handler:", err);
    try {
      await DevMessyBot.sendMessage(m.chat, { text: "⚠️ Une erreur est survenue." }, { quoted: m });
    } catch {}
  }
}
}