const { Client, GatewayIntentBits, Events } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: Object.keys(GatewayIntentBits).map(k => GatewayIntentBits[k])
});

const onClientReady = require('./events/ready');

client.once(Events.ClientReady, (c) => {
  const ts = new Date().toISOString();
  console.log(`🟢 [ClientReady] Bard v20250901.2357 geladen & eingeloggt als ${c.user.tag} (${c.user.id}) @ ${ts}`);
  onClientReady(c);
});

client.login(process.env.BOT_TOKEN);
