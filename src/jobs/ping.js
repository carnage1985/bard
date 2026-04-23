// src/jobs/ping.js
const { SlashCommandBuilder } = require('discord.js');

const command = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Zeigt die Bot-Latenz an.');

module.exports = (client, logger = console) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'ping') return;
    try {
      await interaction.deferReply();
      const replied = await interaction.fetchReply();
      const latency = replied.createdTimestamp - interaction.createdTimestamp;
      const apiPing = Math.round(client.ws.ping);
      await interaction.editReply(`🏓 Pong! Bot-Latenz: **${latency}ms**, API-Latenz: **${apiPing}ms**`);
      logger.info(`🏓 Ping-Command von ${interaction.user.tag} → Bot: ${latency}ms, API: ${apiPing}ms`);
    } catch (err) {
      logger.error('❌ Fehler im /ping-Command:', err);
    }
  });
};

module.exports.command = command;
