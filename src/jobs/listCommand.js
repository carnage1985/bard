// src/jobs/listCommand.js
const { SlashCommandBuilder } = require('discord.js');

const command = new SlashCommandBuilder()
  .setName('list')
  .setDescription('Zeigt alle verfügbaren Befehle.');

module.exports = (client, logger = console) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'list') return;

    const lines = [
      '📋 **Verfügbare Befehle:**',
      '',
      '`/ping`',
      '→ Zeigt die Bot-Latenz an.',
      '',
      '`/list`',
      '→ Zeigt diese Befehlsübersicht.',
      '',
      '`/dndchar set channel: user: name:`',
      '`/dndchar remove channel: user:`',
      '`/dndchar list [channel:]`',
      '→ Verwaltet D&D-Charakternamen für Sprachkanäle. *(Benötigt: Manage Nicknames oder Manage Server)*',
      '',
      '`/voicewait set channel: minutes:`',
      '`/voicewait remove channel:`',
      '`/voicewait list`',
      '→ Sendet ein @here, wenn jemand alleine im Sprachkanal wartet. *(Benötigt: Manage Channels oder Manage Server)*',
      '',
      '`/testnotification message:`',
      '→ Sendet eine Test-DM an den Bot-Besitzer. *(Benötigt: Administrator)*',
      '',
      '`/serverstatus set seconds: [channel:]`',
      '`/serverstatus remove`',
      '`/serverstatus refresh`',
      '`/serverstatus list`',
      '`/serverstatus test`',
      '→ Postet ein regelmäßig aktualisiertes Server-Status-Embed. *(Benötigt: Manage Channels oder Manage Server)*',
      '',
      '`/chat message:` oder **@Bot** <Nachricht>',
      '→ Chattet mit dem Bot via AI. Schreibe `reset` als Nachricht um den Verlauf zu löschen.',
    ];

    try {
      await interaction.reply({ content: lines.join('\n'), ephemeral: true });
      logger.info(`📋 /list-Command ausgeführt von ${interaction.user.tag}`);
    } catch (err) {
      logger.error('❌ Fehler im /list-Command:', err);
    }
  });
};

module.exports.command = command;
