const { PermissionsBitField } = require('discord.js');
const {
  watchConfig,
  setCharacterName,
  removeCharacterName,
  listCharacters,
} = require('../utils/voiceCharactersStore');

const PREFIX = '!dndchar';

function parseChannelId(input) {
  if (!input) return null;
  const match = input.match(/^(?:<#)?(\d+)>?$/);
  return match ? match[1] : null;
}

function parseUserId(input) {
  if (!input) return null;
  const match = input.match(/^(?:<@!?)?(\d+)>?$/);
  return match ? match[1] : null;
}

function formatList(guildId, channelId, logger) {
  const data = listCharacters(guildId, channelId, logger);
  const lines = [];

  for (const [chId, users] of Object.entries(data)) {
    lines.push(`• <#${chId}>`);
    for (const [userId, name] of Object.entries(users)) {
      lines.push(`  ↳ <@${userId}> → **${name}**`);
    }
  }

  return lines.length ? lines.join('\n') : 'ℹ️ Keine Charakter-Mappings vorhanden.';
}

function hasPermission(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageNicknames)
    || member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

module.exports = (client, logger = console) => {
  watchConfig(logger);

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.toLowerCase().startsWith(PREFIX)) return;

    if (!hasPermission(message.member)) {
      await message.reply('❌ Du brauchst das Recht **Manage Nicknames** (oder Manage Server), um das zu nutzen.');
      return;
    }

    const args = message.content.trim().split(/\s+/);
    const action = (args[1] || '').toLowerCase();

    if (!['set', 'remove', 'list', 'help'].includes(action)) {
      await message.reply('Nutze `!dndchar set <#voice> <@user> <Charaktername>`, `!dndchar remove <#voice> <@user>` oder `!dndchar list [#voice]`.');
      return;
    }

    try {
      if (action === 'set') {
        const channelId = parseChannelId(args[2]);
        const userId = parseUserId(args[3]);
        const characterName = args.slice(4).join(' ').trim();

        if (!channelId || !userId || !characterName) {
          await message.reply('❌ Bitte nutze `!dndchar set <#voice> <@user> <Charaktername>`');
          return;
        }
        if (characterName.length > 32) {
          await message.reply('❌ Charaktername zu lang (max. 32 Zeichen, Discord-Nickname Limit).');
          return;
        }

        setCharacterName(message.guild.id, channelId, userId, characterName, logger);
        logger.info(`📝 D&D-Char gesetzt: guild=${message.guild.id} channel=${channelId} user=${userId} → ${characterName}`);
        await message.reply(`✅ Gespeichert: <@${userId}> wird in <#${channelId}> zu **${characterName}**.`);
        return;
      }

      if (action === 'remove') {
        const channelId = parseChannelId(args[2]);
        const userId = parseUserId(args[3]);

        if (!channelId || !userId) {
          await message.reply('❌ Bitte nutze `!dndchar remove <#voice> <@user>`');
          return;
        }

        const removed = removeCharacterName(message.guild.id, channelId, userId, logger);
        if (!removed) {
          await message.reply('ℹ️ Kein Eintrag gefunden, es wurde nichts gelöscht.');
          return;
        }

        logger.info(`🗑️ D&D-Char entfernt: guild=${message.guild.id} channel=${channelId} user=${userId}`);
        await message.reply(`✅ Mapping entfernt für <@${userId}> in <#${channelId}>.`);
        return;
      }

      if (action === 'list' || action === 'help') {
        const channelId = parseChannelId(args[2]);
        const listText = formatList(message.guild.id, channelId, logger);
        await message.reply(listText);
      }
    } catch (err) {
      logger.error('❌ Fehler im !dndchar-Command:', err);
      await message.reply('❌ Da ist etwas schiefgelaufen. Schau ins Log für Details.');
    }
  });
};
