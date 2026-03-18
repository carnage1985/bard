const { ChannelType, PermissionsBitField } = require('discord.js');
const {
  watchConfig,
  setWaitingChannel,
  removeWaitingChannel,
  listWaitingChannels,
} = require('../utils/voiceWaitingStore');

const PREFIX = '!voicewait';

function parseChannelId(input) {
  if (!input) return null;
  const match = input.match(/^(?:<#)?(\d+)>?$/);
  return match ? match[1] : null;
}

function hasPermission(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageChannels)
    || member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

function formatList(guildId, logger) {
  const data = listWaitingChannels(guildId, logger);
  const lines = Object.entries(data).map(([channelId, entry]) => {
    const waitMinutes = entry?.waitMinutes ?? '?';
    return `• <#${channelId}> → Ping nach **${waitMinutes}** Minute(n) alleine`;
  });

  return lines.length
    ? lines.join('\n')
    : 'ℹ️ Keine Voice-Channels für den Alleine-Ping konfiguriert.';
}

function getCurrentVoiceChannel(member) {
  const channel = member?.voice?.channel ?? null;
  if (!channel) return null;
  return [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)
    ? channel
    : null;
}

module.exports = (client, logger = console) => {
  watchConfig(logger);

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.toLowerCase().startsWith(PREFIX)) return;

    if (!hasPermission(message.member)) {
      await message.reply('❌ Du brauchst das Recht **Manage Channels** oder **Manage Server**, um das zu nutzen.');
      return;
    }

    const args = message.content.trim().split(/\s+/);
    const action = (args[1] || '').toLowerCase();

    if (!['set', 'remove', 'list', 'help'].includes(action)) {
      await message.reply('Nutze `!voicewait set <minuten>`, `!voicewait remove`, `!voicewait list` oder optional weiter `!voicewait set <#voice> <minuten>`.');
      return;
    }

    try {
      if (action === 'set') {
        let channel = null;
        let waitMinutes = null;

        const explicitChannelId = parseChannelId(args[2]);
        if (explicitChannelId) {
          channel = await message.guild.channels.fetch(explicitChannelId).catch(() => null);
          waitMinutes = Number.parseInt(args[3], 10);
        } else {
          channel = getCurrentVoiceChannel(message.member);
          waitMinutes = Number.parseInt(args[2], 10);
        }

        if (!channel || !Number.isInteger(waitMinutes)) {
          await message.reply('❌ Bitte nutze `!voicewait set <minuten>` während du im Voice-Channel bist oder `!voicewait set <#voice> <minuten>`.');
          return;
        }

        if (waitMinutes < 1 || waitMinutes > 240) {
          await message.reply('❌ Minuten müssen zwischen **1** und **240** liegen.');
          return;
        }

        if (!channel || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
          await message.reply('❌ Das angegebene Ziel ist kein Voice- oder Stage-Channel.');
          return;
        }

        setWaitingChannel(message.guild.id, channel.id, waitMinutes, logger);
        logger.info(`📝 Voice-Wait gesetzt: guild=${message.guild.id} channel=${channel.id} waitMinutes=${waitMinutes}`);
        await message.reply(`✅ <#${channel.id}> ist jetzt berechtigt. Wenn dort jemand **${waitMinutes}** Minute(n) alleine ist, wird ein \`@here\` gesendet.`);
        return;
      }

      if (action === 'remove') {
        const explicitChannelId = parseChannelId(args[2]);
        const channel = explicitChannelId
          ? await message.guild.channels.fetch(explicitChannelId).catch(() => null)
          : getCurrentVoiceChannel(message.member);

        if (!channel) {
          await message.reply('❌ Bitte nutze `!voicewait remove` während du im Voice-Channel bist oder `!voicewait remove <#voice>`.');
          return;
        }

        const removed = removeWaitingChannel(message.guild.id, channel.id, logger);
        if (!removed) {
          await message.reply('ℹ️ Für diesen Channel war kein Alleine-Ping hinterlegt.');
          return;
        }

        logger.info(`🗑️ Voice-Wait entfernt: guild=${message.guild.id} channel=${channel.id}`);
        await message.reply(`✅ Alleine-Ping für <#${channel.id}> entfernt.`);
        return;
      }

      if (action === 'list' || action === 'help') {
        const listText = formatList(message.guild.id, logger);
        await message.reply(`${listText}\n\nHilfe: \`!voicewait set <minuten>\` im Voice-Channel oder optional \`!voicewait set <#voice> <minuten>\`.`);
      }
    } catch (err) {
      logger.error('❌ Fehler im !voicewait-Command:', err);
      await message.reply('❌ Da ist etwas schiefgelaufen. Schau ins Log für Details.');
    }
  });
};
