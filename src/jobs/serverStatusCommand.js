const { SlashCommandBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const Gamedig = require('gamedig');
const {
  watchConfig,
  setStatusConfig,
  removeStatusConfig,
  getStatusConfig,
} = require('../utils/serverStatusStore');
const { loadHostingServers, HOSTING_DIR, normalizeQueryHost, normalizeQueryType } = require('../utils/hostingServers');

const MIN_INTERVAL = 10;
const MAX_INTERVAL = 3600;

function hasPermission(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageChannels)
    || member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

const command = new SlashCommandBuilder()
  .setName('serverstatus')
  .setDescription('Verwaltet das Server-Status-Embed.')
  .addSubcommand(sub => sub
    .setName('set')
    .setDescription('Aktiviert das Server-Status-Embed.')
    .addIntegerOption(opt => opt
      .setName('seconds')
      .setDescription(`Update-Intervall (${MIN_INTERVAL}–${MAX_INTERVAL} Sekunden)`)
      .setRequired(true)
      .setMinValue(MIN_INTERVAL)
      .setMaxValue(MAX_INTERVAL)
    )
    .addChannelOption(opt => opt
      .setName('channel')
      .setDescription('Ziel-Channel (Standard: aktueller Channel)')
      .setRequired(false)
    )
  )
  .addSubcommand(sub => sub.setName('remove').setDescription('Entfernt das Server-Status-Embed.'))
  .addSubcommand(sub => sub.setName('refresh').setDescription('Löst ein sofortiges Update aus.'))
  .addSubcommand(sub => sub.setName('list').setDescription('Zeigt Konfiguration und gefundene Server.'))
  .addSubcommand(sub => sub.setName('test').setDescription('Testet alle konfigurierten Server direkt.'));

module.exports = (client, logger = console) => {
  watchConfig(logger);

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'serverstatus') return;

    if (!hasPermission(interaction.member)) {
      await interaction.reply({ content: '❌ Du brauchst **Manage Channels** oder **Manage Server**, um das zu nutzen.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'set') {
        const intervalSeconds = interaction.options.getInteger('seconds');
        const channelOption = interaction.options.getChannel('channel');
        const targetChannel = channelOption
          ?? await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);

        if (!targetChannel) {
          await interaction.reply({ content: '❌ Channel nicht gefunden.', ephemeral: true });
          return;
        }
        if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(targetChannel.type)) {
          await interaction.reply({ content: '❌ Ziel muss ein normaler Text-Channel sein.', ephemeral: true });
          return;
        }

        const existing = getStatusConfig(interaction.guildId, logger);
        if (existing?.messageId && existing.channelId !== targetChannel.id) {
          try {
            const oldChannel = await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
            if (oldChannel) {
              const oldMsg = await oldChannel.messages.fetch(existing.messageId).catch(() => null);
              if (oldMsg) await oldMsg.delete().catch(() => null);
            }
          } catch { /* ignore cleanup errors */ }
        }

        let messageId = null;
        if (existing?.messageId && existing.channelId === targetChannel.id) {
          const stillThere = await targetChannel.messages.fetch(existing.messageId).catch(() => null);
          if (stillThere) messageId = existing.messageId;
        }
        if (!messageId) {
          const sent = await targetChannel.send('⏳ Server-Status wird initialisiert …');
          messageId = sent.id;
        }

        setStatusConfig(interaction.guildId, targetChannel.id, intervalSeconds, messageId, logger);
        client.emit('serverStatusConfigChanged', interaction.guildId);
        logger.info(`📝 Server-Status gesetzt: guild=${interaction.guildId} channel=${targetChannel.id} intervalSeconds=${intervalSeconds}`);
        await interaction.reply({ content: `✅ Server-Status wird alle **${intervalSeconds}s** in <#${targetChannel.id}> aktualisiert.`, ephemeral: true });
        return;
      }

      if (sub === 'remove') {
        const existing = getStatusConfig(interaction.guildId, logger);
        if (!existing) {
          await interaction.reply({ content: 'ℹ️ Kein Server-Status konfiguriert.', ephemeral: true });
          return;
        }
        if (existing.messageId) {
          try {
            const ch = await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
            if (ch) {
              const msg = await ch.messages.fetch(existing.messageId).catch(() => null);
              if (msg) await msg.delete().catch(() => null);
            }
          } catch { /* ignore cleanup errors */ }
        }
        removeStatusConfig(interaction.guildId, logger);
        client.emit('serverStatusConfigChanged', interaction.guildId);
        logger.info(`🗑️ Server-Status entfernt: guild=${interaction.guildId}`);
        await interaction.reply({ content: '✅ Server-Status entfernt.', ephemeral: true });
        return;
      }

      if (sub === 'refresh') {
        const existing = getStatusConfig(interaction.guildId, logger);
        if (!existing) {
          await interaction.reply({ content: 'ℹ️ Kein Server-Status konfiguriert. Nutze `/serverstatus set`.', ephemeral: true });
          return;
        }
        client.emit('serverStatusRefreshRequested', interaction.guildId);
        await interaction.reply({ content: '🔄 Update angestoßen.', ephemeral: true });
        return;
      }

      if (sub === 'list') {
        const existing = getStatusConfig(interaction.guildId, logger);
        const servers = loadHostingServers(logger);
        const lines = [];
        if (existing) {
          lines.push(`📋 **Konfiguriert:** <#${existing.channelId}> alle ${existing.intervalSeconds}s`);
        } else {
          lines.push('📋 **Konfiguriert:** *(nicht gesetzt)*');
        }
        lines.push('');
        lines.push(`**Gefundene Server in \`${HOSTING_DIR}\`:** ${servers.length}`);
        for (const s of servers) {
          lines.push(`• ${s.icon ? s.icon + ' ' : ''}**${s.name ?? s._dir}** — \`${s.address ?? '?'}\``);
        }
        await interaction.reply({ content: lines.join('\n'), ephemeral: true });
        return;
      }

      if (sub === 'test') {
        await interaction.deferReply({ ephemeral: true });
        const servers = loadHostingServers(logger);
        if (!servers.length) {
          await interaction.editReply(`ℹ️ Keine Server in \`${HOSTING_DIR}\` gefunden.`);
          return;
        }
        const lines = [];
        for (const s of servers) {
          const label = `${s.icon ? s.icon + ' ' : ''}**${s.name ?? s._dir}**`;
          const q = s.query;
          if (!q?.type || !q.port) {
            lines.push(`${label} — ❌ keine \`query\`-Config`);
            continue;
          }
          const host = normalizeQueryHost(q.host, s.address);
          const port = Number(q.port);
          const type = normalizeQueryType(q.type);
          try {
            const state = await Gamedig.query({ type, host, port, socketTimeout: 5000, attemptTimeout: 5000, maxAttempts: 1 });
            const players = Array.isArray(state.players) ? state.players.length : (state.raw?.numplayers ?? 0);
            const max = state.maxplayers || s.maxPlayersFallback || 0;
            lines.push(`${label} — 🟢 \`${type}://${host}:${port}\` · ${players}/${max} · "${state.name ?? ''}"`);
          } catch (err) {
            lines.push(`${label} — 🔴 \`${type}://${host}:${port}\` · \`${err?.message || String(err)}\``);
          }
        }
        const out = lines.join('\n');
        if (out.length < 1900) {
          await interaction.editReply(out);
        } else {
          await interaction.editReply(lines[0]);
          for (const line of lines.slice(1)) {
            await interaction.followUp({ content: line, ephemeral: true });
          }
        }
      }
    } catch (err) {
      logger.error('❌ Fehler im /serverstatus-Command:', err);
      const errMsg = { content: '❌ Da ist etwas schiefgelaufen. Schau ins Log für Details.', ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.editReply(errMsg).catch(() => {});
      else await interaction.reply(errMsg).catch(() => {});
    }
  });
};

module.exports.command = command;
