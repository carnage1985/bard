const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: Object.keys(GatewayIntentBits).map(k => GatewayIntentBits[k])
});

client.once('ready', () => {
  console.log(`✅ Bard ist online als ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN);
