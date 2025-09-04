// src/jobs/ping.js
module.exports = (client, logger = console) => {
  client.on('messageCreate', async (message) => {
    // Bots ignorieren
    if (message.author.bot) return;

    // Nur auf "!ping" reagieren
    if (message.content.toLowerCase() === '!ping') {
      try {
        const sent = await message.reply('🏓 Pingen...');
        const latency = sent.createdTimestamp - message.createdTimestamp;
        const apiPing = Math.round(client.ws.ping);

        await sent.edit(`🏓 Pong! Bot-Latenz: **${latency}ms**, API-Latenz: **${apiPing}ms**`);

        // ins Log schreiben
        logger.info(`🏓 Ping-Command von ${message.author.tag} → Bot: ${latency}ms, API: ${apiPing}ms`);
      } catch (err) {
        logger.error('❌ Fehler im Ping-Command:', err);
      }
    }
  });
};
