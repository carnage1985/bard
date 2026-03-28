// src/jobs/listCommand.js
module.exports = (client, logger = console) => {
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.content.toLowerCase() !== '!list') return;

    const lines = [
      '📋 **Verfügbare Befehle:**',
      '',
      '`!ping`',
      '→ Zeigt die Bot-Latenz an.',
      '',
      '`!list`',
      '→ Zeigt diese Befehlsübersicht.',
      '',
      '`!dndchar set <#voice> <@user> <Charaktername>`',
      '`!dndchar remove <#voice> <@user>`',
      '`!dndchar list [#voice]`',
      '→ Verwaltet D&D-Charakternamen für Sprachkanäle. *(Benötigt: Manage Nicknames oder Manage Server)*',
      '',
      '`!voicewait set <#voice> <Minuten>`',
      '`!voicewait remove <#voice>`',
      '`!voicewait list`',
      '→ Sendet ein @here, wenn jemand alleine im Sprachkanal wartet. *(Benötigt: Manage Channels oder Manage Server)*',
      '',
      '`!testnotification "<Nachricht>"`',
      '→ Sendet eine Test-DM an den Bot-Besitzer. *(Benötigt: Administrator)*',
    ];

    try {
      await message.reply(lines.join('\n'));
      logger.info(`📋 !list-Command ausgeführt von ${message.author.tag}`);
    } catch (err) {
      logger.error('❌ Fehler im !list-Command:', err);
    }
  });
};
