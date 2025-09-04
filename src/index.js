// src/index.js
const { Client, GatewayIntentBits, Events } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: Object.keys(GatewayIntentBits).map(k => GatewayIntentBits[k])
});

// 🔸 Logger initialisieren (schickt Logs in den Discord-Channel aus LOG_CHANNEL_ID)
const { createLogger } = require('./utils/logger');
const logger = createLogger(client, { channelId: process.env.LOG_CHANNEL_ID });

// Ready-Routine (lädt Jobs und loggt eine Übersicht)
const onClientReady = require('./events/ready');

client.once(Events.ClientReady, (c) => {
  const ts = new Date().toISOString();
  // ✅ ab jetzt logger statt console.* verwenden
  logger.info(`🟢 [ClientReady] Bard geladen & eingeloggt als ${c.user.tag} (${c.user.id}) @ ${ts}`);
  onClientReady(c, logger); // logger an ready.js weitergeben
});

client.login(process.env.BOT_TOKEN);

// optional exportieren, falls Jobs ihn direkt importieren möchten
module.exports = { client, logger };
