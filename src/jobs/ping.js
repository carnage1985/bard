module.exports = (client) => {
  client.on('messageCreate', async (message) => {
    // Bots ignorieren
    if (message.author.bot) return;

    // Nur auf "!ping" reagieren
    if (message.content.toLowerCase() === '!ping') {
      const sent = await message.reply('🏓 Pingen...');
      const latency = sent.createdTimestamp - message.createdTimestamp;
      const apiPing = Math.round(client.ws.ping);

      await sent.edit(`🏓 Pong! Bot-Latenz: **${latency}ms**, API-Latenz: **${apiPing}ms**`);
    }
  });
};
