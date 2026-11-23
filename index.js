const express = require("express");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "emech2025";
const PHONE_NUMBER = (process.env.PHONE_NUMBER || "").replace(/\D/g, "");

let sock = null;
let isConnected = false;
let latestPairingCode = "";
let latestQR = "";
let pairingInProgress = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      if (!sock.authState.creds.registered && PHONE_NUMBER && !pairingInProgress) {
        pairingInProgress = true;
        try {
          const code = await sock.requestPairingCode(PHONE_NUMBER);
          latestPairingCode = code;
          console.log("WHATSAPP PAIRING CODE:", code);
        } catch (err) {
          console.error("Pairing code error:", err.message);
          pairingInProgress = false;
        }
      }
    }

    if (connection === "open") {
      isConnected = true;
      latestQR = "";
      pairingInProgress = false;
      console.log("WhatsApp Bot Connected!");
    } else if (connection === "close") {
      isConnected = false;
      pairingInProgress = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(startBot, 3000);
      } else {
        console.log("Logged out. Restarting fresh session.");
        const fs = require("fs");
        fs.rmSync("./auth_info", { recursive: true, force: true });
        setTimeout(startBot, 2000);
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
    pairingCode: isConnected ? null : latestPairingCode || "Waiting for QR...",
    qrPage: "/qr"
  });
});

// Renders a scannable QR code directly in the browser
app.get("/qr", (req, res) => {
  if (isConnected) {
    return res.send("<h2>WhatsApp Bot is already connected!</h2>");
  }
  if (!latestQR) {
    return res.send("<meta http-equiv='refresh' content='3'><h3>Generating QR... Refreshing in 3s</h3>");
  }
  const qrImgUrl = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" + encodeURIComponent(latestQR);
  res.send(`
    <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="15"></head>
      <body style="font-family:sans-serif;text-align:center;padding:24px;background:#111;color:#fff;">
        <h2>Scan with WhatsApp</h2>
        <p>WhatsApp &rarr; Linked Devices &rarr; Link a Device</p>
        <img src="${qrImgUrl}" style="background:#fff;padding:12px;border-radius:12px;" />
        <p style="margin-top:16px;">Or Pairing Code: <b>${latestPairingCode || "N/A"}</b></p>
      </body>
    </html>
  `);
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
