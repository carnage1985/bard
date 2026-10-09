const { SlashCommandBuilder, ChannelType, PermissionsBitField, MessageFlags } = require('discord.js');
const {
  watchConfig,
  setWaitingChannel,
  removeWaitingChannel,
  listWaitingChannels,
  getPingRole,
  setPingRole,
  clearPingRole,
  setNeverPing,
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
  )
  .addSubcommand(sub => sub
    .setName('setrole')
    .setDescription('Legt die Rolle fest, die beim Alleine-Ping erwähnt wird (statt @here).')
    .addRoleOption(opt => opt.setName('role').setDescription('Ping-Rolle').setRequired(true))
  )
  .addSubcommand(sub => sub
    .setName('clearrole')
    .setDescription('Entfernt die Ping-Rolle, es wird wieder @here verwendet.')
  )
  .addSubcommand(sub => sub
    .setName('anmelden')
    .setDescription('Du bekommst die Ping-Rolle und wirst bei Alleine-Pings benachrichtigt.')
  )
  .addSubcommand(sub => sub
    .setName('abmelden')
    .setDescription('Du verlierst die Ping-Rolle und wirst nicht mehr bei Alleine-Pings benachrichtigt.')
  )
  .addSubcommand(sub => sub
    .setName('wiederfragen')
    .setDescription('Hebt „Nie pingen“ auf: Der Bot fragt dich wieder, wenn du alleine im Sprachkanal bist.')
  );

const SELF_SERVICE = ['anmelden', 'abmelden', 'wiederfragen'];

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
  const roleId = getPingRole(guildId, logger);
  if (!lines.length) lines.push('ℹ️ Keine Voice-Channels für den Alleine-Ping konfiguriert.');
  lines.push(roleId ? `🔔 Ping-Rolle: <@&${roleId}>` : '🔔 Ping-Rolle: *(keine – es wird `@here` verwendet)*');
  return lines.join('\n');
}

module.exports = (client, logger = console) => {
  watchConfig(logger);

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'voicewait') return;

    const sub = interaction.options.getSubcommand();

    if (!SELF_SERVICE.includes(sub) && !hasPermission(interaction.member)) {
      await interaction.reply({ content: '❌ Du brauchst das Recht **Manage Channels** oder **Manage Server**, um das zu nutzen.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      if (sub === 'wiederfragen') {
        setNeverPing(interaction.guildId, interaction.user.id, false, logger);
        await interaction.reply({ content: '✅ Der Bot fragt dich wieder, bevor ein Alleine-Ping rausgeht.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (SELF_SERVICE.includes(sub)) {
        const roleId = getPingRole(interaction.guildId, logger);
        if (!roleId) {
          await interaction.reply({ content: 'ℹ️ Es ist keine Ping-Rolle eingerichtet – der Alleine-Ping nutzt `@here`.', flags: MessageFlags.Ephemeral });
          return;
        }
        try {
          if (sub === 'anmelden') await interaction.member.roles.add(roleId);
          else await interaction.member.roles.remove(roleId);
        } catch (err) {
          logger.error('❌ Voice-Wait: Rolle konnte nicht geändert werden:', err);
          await interaction.reply({ content: '❌ Ich kann die Rolle nicht vergeben. Der Bot braucht **Rollen verwalten** und seine Rolle muss über der Ping-Rolle stehen.', flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.reply({
          content: sub === 'anmelden' ? `✅ Du hast jetzt <@&${roleId}> und wirst bei Alleine-Pings benachrichtigt.` : `✅ Du hast <@&${roleId}> abgegeben und wirst nicht mehr benachrichtigt.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (sub === 'setrole') {
        const role = interaction.options.getRole('role');
        setPingRole(interaction.guildId, role.id, logger);
        logger.info(`📝 Voice-Wait Ping-Rolle gesetzt: guild=${interaction.guildId} role=${role.id}`);
        await interaction.reply({ content: `✅ Alleine-Pings erwähnen jetzt <@&${role.id}>. Mitglieder holen sie sich mit \`/voicewait anmelden\`.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        return;
      }

      if (sub === 'clearrole') {
        const removed = clearPingRole(interaction.guildId, logger);
        await interaction.reply({ content: removed ? '✅ Ping-Rolle entfernt, es wird wieder `@here` verwendet.' : 'ℹ️ Es war keine Ping-Rolle eingerichtet.', flags: MessageFlags.Ephemeral });
        return;
      }

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
