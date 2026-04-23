const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

const OWNER_USER_ID = process.env.OWNER_USER_ID || '324155395709075457';

const command = new SlashCommandBuilder()
  .setName('testnotification')
  .setDescription('Sendet eine Test-DM an den Bot-Besitzer. (Nur Admins)')
  .addStringOption(opt => opt
    .setName('message')
    .setDescription('Nachrichtentext')
    .setRequired(true)
  );

function hasPermission(member) {
  return member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}

module.exports = (client, logger = console) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'testnotification') return;

    if (!hasPermission(interaction.member)) {
      await interaction.reply({ content: '❌ Nur Admins mit dem Recht **Administrator** dürfen das nutzen.', flags: MessageFlags.Ephemeral });
      return;
    }

    const notificationText = interaction.options.getString('message');
    try {
      const user = await client.users.fetch(OWNER_USER_ID);
      await user.send({
        content: [
          'Test-Benachrichtigung vom Bot',
          `Von: ${interaction.user.tag} (${interaction.user.id})`,
          `Server: ${interaction.guild.name} (${interaction.guildId})`,
          '',
          notificationText,
        ].join('\n'),
      });
      logger.info(`📨 Test-Notification gesendet von ${interaction.user.tag} (${interaction.user.id})`);
      await interaction.reply({ content: '✅ Test-Benachrichtigung wurde per DM gesendet.', flags: MessageFlags.Ephemeral });
    } catch (err) {
      logger.error('❌ Fehler im /testnotification-Command:', err);
      await interaction.reply({ content: '❌ Die Test-Benachrichtigung konnte nicht gesendet werden.', flags: MessageFlags.Ephemeral });
    }
  });
};

module.exports.command = command;
