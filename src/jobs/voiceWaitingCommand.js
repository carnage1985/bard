const { SlashCommandBuilder, ChannelType, PermissionsBitField, MessageFlags } = require('discord.js');
const {
  watchConfig,
  setWaitingChannel,
  removeWaitingChannel,
  listWaitingChannels,
} = require('../utils/voiceWaitingStore');

const command = new SlashCommandBuilder()
  .setName('voicewait')
  .setDescription('Konfiguriert den Alleine-Ping für Voice-Channels.')
  .addSubcommand(sub => sub
    .setName('set')
    .setDescription('Aktiviert den Alleine-Ping für einen Voice-Channel.')
    .addChannelOption(opt => opt.setName('channel').setDescription('Voice-Channel').setRequired(true))
    .addIntegerOption(opt => opt.setName('minutes').setDescription('Minuten alleine bis zum Ping (1–240)').setRequired(true).setMinValue(1).setMaxValue(240))
  )
  .addSubcommand(sub => sub
    .setName('remove')
    .setDescription('Deaktiviert den Alleine-Ping für einen Voice-Channel.')
    .addChannelOption(opt => opt.setName('channel').setDescription('Voice-Channel').setRequired(true))
  )
  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('Zeigt alle konfigurierten Voice-Channels.')
  );

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
  return lines.length ? lines.join('\n') : 'ℹ️ Keine Voice-Channels für den Alleine-Ping konfiguriert.';
}

module.exports = (client, logger = console) => {
  watchConfig(logger);

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'voicewait') return;

    if (!hasPermission(interaction.member)) {
      await interaction.reply({ content: '❌ Du brauchst das Recht **Manage Channels** oder **Manage Server**, um das zu nutzen.', flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'set') {
        const channel = interaction.options.getChannel('channel');
        const waitMinutes = interaction.options.getInteger('minutes');

        if (![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
          await interaction.reply({ content: '❌ Das angegebene Ziel ist kein Voice- oder Stage-Channel.', flags: MessageFlags.Ephemeral });
          return;
        }

        setWaitingChannel(interaction.guildId, channel.id, waitMinutes, interaction.channelId, logger);
        client.emit('voiceWaitConfigChanged', channel);
        logger.info(`📝 Voice-Wait gesetzt: guild=${interaction.guildId} channel=${channel.id} waitMinutes=${waitMinutes} notifyChannel=${interaction.channelId}`);
        await interaction.reply({ content: `✅ <#${channel.id}> wird jetzt überwacht. Wenn dort jemand **${waitMinutes}** Minute(n) alleine ist, kommt ein \`@here\`-Ping hier in <#${interaction.channelId}>.`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'remove') {
        const channel = interaction.options.getChannel('channel');
        const removed = removeWaitingChannel(interaction.guildId, channel.id, logger);
        if (!removed) {
          await interaction.reply({ content: 'ℹ️ Für diesen Channel war kein Alleine-Ping hinterlegt.', flags: MessageFlags.Ephemeral });
          return;
        }
        client.emit('voiceWaitConfigChanged', channel);
        logger.info(`🗑️ Voice-Wait entfernt: guild=${interaction.guildId} channel=${channel.id}`);
        await interaction.reply({ content: `✅ Alleine-Ping für <#${channel.id}> entfernt.`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'list') {
        const listText = formatList(interaction.guildId, logger);
        await interaction.reply({ content: listText, flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      logger.error('❌ Fehler im /voicewait-Command:', err);
      const errMsg = { content: '❌ Da ist etwas schiefgelaufen. Schau ins Log für Details.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.editReply(errMsg).catch(() => {});
      else await interaction.reply(errMsg).catch(() => {});
    }
  });
};

module.exports.command = command;
