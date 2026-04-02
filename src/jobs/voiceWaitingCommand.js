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
    const notifyChannel = entry?.notifyChannelId ? `<#${entry.notifyChannelId}>` : '*(unbekannt)*';
    return `• <#${channelId}> → Ping nach **${waitMinutes}** Min. alleine → Benachrichtigung in ${notifyChannel}`;
  });

  return lines.length
    ? lines.join('\n')
    : 'ℹ️ Keine Voice-Channels für den Alleine-Ping konfiguriert.';
}

module.exports = (client, logger = console) => {
  watchConfig(logger);

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const normalizedContent = message.content.trim();
    if (!normalizedContent.toLowerCase().startsWith(PREFIX)) return;

    if (!hasPermission(message.member)) {
      await message.reply('❌ Du brauchst das Recht **Manage Channels** oder **Manage Server**, um das zu nutzen.');
      return;
    }

    const remainder = normalizedContent.slice(PREFIX.length).trim();
    const args = remainder ? remainder.split(/\s+/) : [];
    const action = (args[0] || '').toLowerCase();

    if (!['set', 'remove', 'list', 'help'].includes(action)) {
      await message.reply('Nutze `!voicewait set <voiceChannelId> <minuten>`, `!voicewait remove <voiceChannelId>` oder `!voicewait list`.');
      return;
    }

    try {
      if (action === 'set') {
        const channelId = parseChannelId(args[1]);
        const waitMinutes = Number.parseInt(args[2], 10);
        const channel = channelId
          ? await message.guild.channels.fetch(channelId).catch(() => null)
          : null;

        if (!channel || !Number.isInteger(waitMinutes)) {
          await message.reply('❌ Bitte nutze `!voicewait set <voiceChannelId> <minuten>`.');
          return;
        }

        if (waitMinutes < 1 || waitMinutes > 240) {
          await message.reply('❌ Minuten müssen zwischen **1** und **240** liegen.');
          return;
        }

        if (![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
          await message.reply('❌ Das angegebene Ziel ist kein Voice- oder Stage-Channel.');
          return;
        }

        setWaitingChannel(message.guild.id, channel.id, waitMinutes, message.channel.id, logger);
        client.emit('voiceWaitConfigChanged', channel);
        logger.info(`📝 Voice-Wait gesetzt: guild=${message.guild.id} channel=${channel.id} waitMinutes=${waitMinutes} notifyChannel=${message.channel.id}`);
        await message.reply(`✅ <#${channel.id}> wird jetzt überwacht. Wenn dort jemand **${waitMinutes}** Minute(n) alleine ist, kommt ein \`@here\`-Ping hier in <#${message.channel.id}>.`);
        return;
      }

      if (action === 'remove') {
        const channelId = parseChannelId(args[1]);
        const channel = channelId
          ? await message.guild.channels.fetch(channelId).catch(() => null)
          : null;

        if (!channel) {
          await message.reply('❌ Bitte nutze `!voicewait remove <voiceChannelId>`.');
          return;
        }

        const removed = removeWaitingChannel(message.guild.id, channel.id, logger);
        if (!removed) {
          await message.reply('ℹ️ Für diesen Channel war kein Alleine-Ping hinterlegt.');
          return;
        }

        client.emit('voiceWaitConfigChanged', channel);
        logger.info(`🗑️ Voice-Wait entfernt: guild=${message.guild.id} channel=${channel.id}`);
        await message.reply(`✅ Alleine-Ping für <#${channel.id}> entfernt.`);
        return;
      }

      if (action === 'list' || action === 'help') {
        const listText = formatList(message.guild.id, logger);
        await message.reply(`${listText}\n\nHilfe: \`!voicewait set <voiceChannelId> <minuten>\``);
      }
    } catch (err) {
      logger.error('❌ Fehler im !voicewait-Command:', err);
      await message.reply('❌ Da ist etwas schiefgelaufen. Schau ins Log für Details.');
    }
  });
};
