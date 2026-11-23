const express = require("express");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} = require("@whiskeysockets/baileys");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "emech2025";
const PHONE_NUMBER = (process.env.PHONE_NUMBER || "").replace(/\D/g, "");

let sock = null;
let isConnected = false;
let latestPairingCode = "";
let pairingInProgress = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS("Desktop"),
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Request pairing code only once the socket reaches initial handshake (qr/connecting)
    if ((qr || connection === "connecting") && !sock.authState.creds.registered && PHONE_NUMBER && !pairingInProgress) {
      pairingInProgress = true;
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(PHONE_NUMBER);
          latestPairingCode = code;
          console.log("========================================");
          console.log("WHATSAPP PAIRING CODE:", code);
          console.log("========================================");
        } catch (err) {
          console.error("Pairing code error:", err.message);
          pairingInProgress = false;
        }
      }, 3000);
    }

    if (connection === "open") {
      isConnected = true;
      pairingInProgress = false;
      console.log("WhatsApp Bot Connected!");
    } else if (connection === "close") {
      isConnected = false;
      pairingInProgress = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(startBot, 4000);
      } else {
        console.log("Logged out. Clear auth_info and re-pair.");
      }
    }
  });
}

process.on("uncaughtException", (err) => console.error("Uncaught:", err.message));
process.on("unhandledRejection", (err) => console.error("Unhandled:", err));

app.get("/", (req, res) => {
  res.json({
    ok: true,
    bot: "Govt. ITI Ranni - EMech WhatsApp Bot",
    connected: isConnected,
    pairingCode: isConnected ? null : latestPairingCode || "Generating..."
  });
});

app.get("/groups", async (req, res) => {
  if ((req.headers.apikey || req.query.apikey) !== API_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (!isConnected || !sock) {
    return res.status(503).json({ ok: false, error: "WhatsApp not connected yet" });
  }
  try {
    const groupsObj = await sock.groupFetchAllParticipating();
    const groups = Object.values(groupsObj).map((g) => ({
      name: g.subject,
      id: g.id
    }));
    res.json({ ok: true, groups });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/broadcast", async (req, res) => {
  if ((req.headers.apikey || req.body.apikey) !== API_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (!isConnected || !sock) {
    return res.status(503).json({ ok: false, error: "WhatsApp not connected yet" });
  }

  const chatId = req.body.chatId || req.body.groupId;
  const text = req.body.text || req.body.message;

  if (!chatId || !text) {
    return res.status(400).json({ ok: false, error: "Missing chatId or text" });
  }

  try {
    await sock.sendMessage(chatId, { text });
    res.json({ ok: true, sentTo: chatId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
  startBot();
});
