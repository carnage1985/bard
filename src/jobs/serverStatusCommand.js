const { ChannelType, PermissionsBitField } = require('discord.js');
const {
  watchConfig,
  setStatusConfig,
  removeStatusConfig,
  getStatusConfig,
} = require('../utils/serverStatusStore');
const { loadHostingServers, HOSTING_DIR } = require('../utils/hostingServers');

const PREFIX = '!serverstatus';
const MIN_INTERVAL = 10;
const MAX_INTERVAL = 3600;

function parseChannelId(input) {
  if (!input) return null;
  const match = input.match(/^(?:<#)?(\d+)>?$/);
  return match ? match[1] : null;
}

function hasPermission(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageChannels)
    || member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

module.exports = (client, logger = console) => {
  watchConfig(logger);

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const normalized = message.content.trim();
    if (!normalized.toLowerCase().startsWith(PREFIX)) return;

    if (!hasPermission(message.member)) {
      await message.reply('❌ Du brauchst **Manage Channels** oder **Manage Server**, um das zu nutzen.');
      return;
    }

    const remainder = normalized.slice(PREFIX.length).trim();
    const args = remainder ? remainder.split(/\s+/) : [];
    const action = (args[0] || '').toLowerCase();

    if (!['set', 'remove', 'refresh', 'list', 'help'].includes(action)) {
      await message.reply('Nutze `!serverstatus set <sekunden> [channelId]`, `!serverstatus remove`, `!serverstatus refresh` oder `!serverstatus list`.');
      return;
    }

    try {
      if (action === 'set') {
        const intervalSeconds = Number.parseInt(args[1], 10);
        if (!Number.isInteger(intervalSeconds) || intervalSeconds < MIN_INTERVAL || intervalSeconds > MAX_INTERVAL) {
          await message.reply(`❌ Intervall muss eine Zahl zwischen **${MIN_INTERVAL}** und **${MAX_INTERVAL}** Sekunden sein.`);
          return;
        }

        let targetChannel = message.channel;
        if (args[2]) {
          const channelId = parseChannelId(args[2]);
          const fetched = channelId
            ? await message.guild.channels.fetch(channelId).catch(() => null)
            : null;
          if (!fetched) {
            await message.reply('❌ Angegebener Channel nicht gefunden.');
            return;
          }
          targetChannel = fetched;
        }

        if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(targetChannel.type)) {
          await message.reply('❌ Ziel muss ein normaler Text-Channel sein.');
          return;
        }

        const existing = getStatusConfig(message.guild.id, logger);
        if (existing?.messageId && existing.channelId !== targetChannel.id) {
          try {
            const oldChannel = await message.guild.channels.fetch(existing.channelId).catch(() => null);
            if (oldChannel) {
              const oldMsg = await oldChannel.messages.fetch(existing.messageId).catch(() => null);
              if (oldMsg) await oldMsg.delete().catch(() => null);
            }
          } catch {
            // ignore cleanup errors
          }
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

        setStatusConfig(message.guild.id, targetChannel.id, intervalSeconds, messageId, logger);
        client.emit('serverStatusConfigChanged', message.guild.id);
        logger.info(`📝 Server-Status gesetzt: guild=${message.guild.id} channel=${targetChannel.id} intervalSeconds=${intervalSeconds}`);
        await message.reply(`✅ Server-Status wird alle **${intervalSeconds}s** in <#${targetChannel.id}> aktualisiert.`);
        return;
      }

      if (action === 'remove') {
        const existing = getStatusConfig(message.guild.id, logger);
        if (!existing) {
          await message.reply('ℹ️ Kein Server-Status konfiguriert.');
          return;
        }

        if (existing.messageId) {
          try {
            const ch = await message.guild.channels.fetch(existing.channelId).catch(() => null);
            if (ch) {
              const msg = await ch.messages.fetch(existing.messageId).catch(() => null);
              if (msg) await msg.delete().catch(() => null);
            }
          } catch {
            // ignore cleanup errors
          }
        }

        removeStatusConfig(message.guild.id, logger);
        client.emit('serverStatusConfigChanged', message.guild.id);
        logger.info(`🗑️ Server-Status entfernt: guild=${message.guild.id}`);
        await message.reply('✅ Server-Status entfernt.');
        return;
      }

      if (action === 'refresh') {
        const existing = getStatusConfig(message.guild.id, logger);
        if (!existing) {
          await message.reply('ℹ️ Kein Server-Status konfiguriert. Nutze `!serverstatus set <sekunden> [channelId]`.');
          return;
        }
        client.emit('serverStatusRefreshRequested', message.guild.id);
        await message.reply('🔄 Update angestoßen.');
        return;
      }

      if (action === 'list' || action === 'help') {
        const existing = getStatusConfig(message.guild.id, logger);
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
          const icon = s.icon ? `${s.icon} ` : '';
          lines.push(`• ${icon}**${s.name ?? s._dir}** — \`${s.address ?? '?'}\``);
        }
        lines.push('');
        lines.push('Hilfe: `!serverstatus set <sekunden> [channelId]`');
        await message.reply(lines.join('\n'));
      }
    } catch (err) {
      logger.error('❌ Fehler im !serverstatus-Command:', err);
      await message.reply('❌ Da ist etwas schiefgelaufen. Schau ins Log für Details.');
    }
  });
};
