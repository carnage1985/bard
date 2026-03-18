const { PermissionsBitField } = require('discord.js');

const PREFIX = '!testnotification';
const OWNER_USER_ID = process.env.OWNER_USER_ID || '324155395709075457';

function hasPermission(member) {
  return member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}

function parseNotificationText(content) {
  const remainder = content.slice(PREFIX.length).trim();
  if (!remainder) return '';

  const quotedMatch = remainder.match(/^"([\s\S]*)"$/);
  return (quotedMatch ? quotedMatch[1] : remainder).trim();
}

module.exports = (client, logger = console) => {
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const normalizedContent = message.content.trim();
    if (!normalizedContent.toLowerCase().startsWith(PREFIX)) return;

    if (!hasPermission(message.member)) {
      await message.reply('❌ Nur Admins mit dem Recht **Administrator** duerfen das nutzen.');
      return;
    }

    const notificationText = parseNotificationText(normalizedContent);
    if (!notificationText) {
      await message.reply('❌ Bitte nutze `!testNotification "Text"`.');
      return;
    }

    try {
      const user = await client.users.fetch(OWNER_USER_ID);
      await user.send({
        content: [
          'Test-Benachrichtigung vom Bot',
          `Von: ${message.author.tag} (${message.author.id})`,
          `Server: ${message.guild.name} (${message.guild.id})`,
          '',
          notificationText,
        ].join('\n'),
      });

      logger.info(`📨 Test-Notification gesendet von ${message.author.tag} (${message.author.id})`);
      await message.reply('✅ Test-Benachrichtigung wurde per DM gesendet.');
    } catch (err) {
      logger.error('❌ Fehler im !testNotification-Command:', err);
      await message.reply('❌ Die Test-Benachrichtigung konnte nicht gesendet werden.');
    }
  });
};
