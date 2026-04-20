const { EmbedBuilder } = require('discord.js');
const Gamedig = require('gamedig');
const {
  watchConfig,
  listAllConfigs,
  updateMessageId,
} = require('../utils/serverStatusStore');
const {
  loadHostingServers,
  getLastActiveMs,
  normalizeQueryHost,
} = require('../utils/hostingServers');

const QUERY_TIMEOUT_MS = 5000;

async function queryServer(server) {
  const q = server.query;
  if (!q?.type || !q.port) {
    return { online: false, reason: 'keine Query-Config' };
  }
  try {
    const state = await Gamedig.query({
      type: q.type,
      host: normalizeQueryHost(q.host),
      port: Number(q.port),
      socketTimeout: QUERY_TIMEOUT_MS,
      attemptTimeout: QUERY_TIMEOUT_MS,
      maxAttempts: 1,
    });
    return {
      online: true,
      serverName: state.name,
      players: Array.isArray(state.players) ? state.players.length : (state.raw?.numplayers ?? 0),
      maxPlayers: state.maxplayers || server.maxPlayersFallback || 0,
    };
  } catch (err) {
    return { online: false, reason: err?.message || String(err) };
  }
}

function buildEmbed(results) {
  const sorted = [...results].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return b.lastActiveMs - a.lastActiveMs;
  });

  const embed = new EmbedBuilder()
    .setTitle('🎮 Server-Status')
    .setColor(sorted.some(r => r.online) ? 0x2ecc71 : 0x95a5a6)
    .setTimestamp(new Date())
    .setFooter({ text: 'Zuletzt aktiv zuerst · Offline unten' });

  if (sorted.length === 0) {
    embed.setDescription('*Keine Server in `/hosting` gefunden.*');
    return embed;
  }

  for (const r of sorted) {
    const statusEmoji = r.online ? '🟢' : '🔴';
    const icon = r.icon ? `${r.icon} ` : '';
    const header = `${statusEmoji} ${icon}${r.name}`;

    const lines = [];
    if (r.online && r.serverName && r.serverName !== r.name) {
      lines.push(`📛 ${r.serverName}`);
    }
    lines.push(`🌐 \`${r.address ?? '?'}\``);
    if (r.online) {
      lines.push(`👥 ${r.players}/${r.maxPlayers}`);
    } else {
      lines.push('💤 _offline_');
    }

    embed.addFields({ name: header, value: lines.join('\n'), inline: false });
  }

  return embed;
}

module.exports = (client, logger = console) => {
  watchConfig(logger);

  const timers = new Map();
  const running = new Set();

  async function updateGuild(guildId) {
    if (running.has(guildId)) return;
    running.add(guildId);
    try {
      const cfg = listAllConfigs(logger)[guildId];
      if (!cfg) return;

      const guild = client.guilds.cache.get(guildId)
        || await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        logger.warn(`⚠️ Server-Status: Guild ${guildId} nicht erreichbar.`);
        return;
      }

      const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
      if (!channel) {
        logger.warn(`⚠️ Server-Status: Channel ${cfg.channelId} (guild=${guildId}) nicht erreichbar.`);
        return;
      }

      const servers = loadHostingServers(logger);
      const results = await Promise.all(servers.map(async (s) => {
        const query = await queryServer(s);
        return {
          id: s.id ?? s._dir,
          name: s.name ?? s._dir,
          icon: s.icon,
          address: s.address,
          ...query,
          lastActiveMs: getLastActiveMs(s, logger),
        };
      }));

      const embed = buildEmbed(results);

      let message = null;
      if (cfg.messageId) {
        message = await channel.messages.fetch(cfg.messageId).catch(() => null);
      }
      if (message) {
        await message.edit({ content: '', embeds: [embed] });
      } else {
        const sent = await channel.send({ embeds: [embed] });
        updateMessageId(guildId, sent.id, logger);
      }
    } catch (err) {
      logger.error(`❌ Fehler beim Server-Status Update (guild=${guildId}):`, err);
    } finally {
      running.delete(guildId);
    }
  }

  function scheduleGuild(guildId) {
    const cfg = listAllConfigs(logger)[guildId];
    if (timers.has(guildId)) {
      clearInterval(timers.get(guildId));
      timers.delete(guildId);
    }
    if (!cfg) return;

    const intervalMs = Math.max(10, cfg.intervalSeconds) * 1000;
    const handle = setInterval(() => {
      updateGuild(guildId).catch(err => logger.error(`❌ Server-Status Intervall-Fehler (guild=${guildId}):`, err));
    }, intervalMs);
    timers.set(guildId, handle);
    updateGuild(guildId).catch(err => logger.error(`❌ Server-Status Initial-Update-Fehler (guild=${guildId}):`, err));
  }

  function scheduleAll() {
    const configs = listAllConfigs(logger);
    for (const guildId of Object.keys(configs)) {
      scheduleGuild(guildId);
    }
  }

  client.on('serverStatusConfigChanged', (guildId) => {
    const cfg = listAllConfigs(logger)[guildId];
    if (!cfg) {
      if (timers.has(guildId)) {
        clearInterval(timers.get(guildId));
        timers.delete(guildId);
      }
      return;
    }
    scheduleGuild(guildId);
  });

  client.on('serverStatusRefreshRequested', (guildId) => {
    updateGuild(guildId).catch(err => logger.error(`❌ Server-Status Refresh-Fehler (guild=${guildId}):`, err));
  });

  scheduleAll();
};
