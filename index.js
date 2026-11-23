const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL; // Your ITI Ranni EM Google Apps Script /exec URL
const PHONE_NUMBER = process.env.PHONE_NUMBER;     // Your WhatsApp number with country code, e.g., 9198XXXXXXXX

app.get('/', (req, res) => res.send('ITI Ranni EM WhatsApp Group Bot is running!'));
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  // Request an 8-digit Pairing Code (no QR scanner needed on a single phone!)
  if (!sock.authState.creds.registered && PHONE_NUMBER) {
    setTimeout(async () => {
      const code = await sock.requestPairingCode(PHONE_NUMBER);
      console.log('====================================');
      console.log('YOUR WHATSAPP PAIRING CODE:', code);
      console.log('====================================');
    }, 4000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('Connected to WhatsApp!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const remoteJid = msg.key.remoteJid; // Works for BOTH DMs and Groups (@g.us)
    const text = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ''
    ).trim();

    if (!text.startsWith('!')) return; // Only respond to commands starting with '!'

    const parts = text.slice(1).split(/\s+/);
    const cmd = (parts[0] || '').toUpperCase();
    const roll = parts[1] || '';

    if (cmd === 'HELP') {
      await sock.sendMessage(remoteJid, {
        text: '🤖 *Govt. ITI Ranni EM Bot*\n• `!status <RollNo>` — Check attendance\n• `!late <RollNo> <Reason>` — Log running late'
      }, { quoted: msg });
      return;
    }

    if ((cmd === 'STATUS' || cmd === 'LATE') && roll && APPS_SCRIPT_URL) {
      const reason = parts.slice(2).join(' ') || 'Running late';
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'WP_BOT', cmd, roll, reason })
      });
      const replyText = await res.text();
      await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
    }
  });
}

startBot();
