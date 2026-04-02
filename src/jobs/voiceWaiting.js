const { ChannelType } = require('discord.js');
const { watchConfig, listWaitingChannels } = require('../utils/voiceWaitingStore');

const CHECK_INTERVAL_MS = 60 * 1000;

function isSupportedVoiceChannel(channel) {
  return channel && [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type);
}

function getHumanMembers(channel) {
  return channel.members.filter(member => !member.user.bot);
}

function buildPingMessage(member, voiceChannel) {
  const name = member.displayName || member.user.username;
  return `@here **${name}** ist gerade alleine in <#${voiceChannel.id}> und würde sich über Gesellschaft freuen! 🎮`;
}

module.exports = (client, logger = console) => {
  watchConfig(logger);

  const aloneState = new Map();
  let scanInProgress = false;

  function getKey(guildId, channelId) {
    return `${guildId}:${channelId}`;
  }

  async function sendPing(member, voiceChannel, notifyChannelId) {
    let notifyChannel = null;

    if (notifyChannelId) {
      notifyChannel = client.channels.cache.get(notifyChannelId)
        || await client.channels.fetch(notifyChannelId).catch(() => null);
    }

    if (!notifyChannel) {
      logger.warn(`⚠️ Voice-Wait: Notification-Channel ${notifyChannelId} nicht gefunden, sende in Voice-Channel als Fallback.`);
      notifyChannel = voiceChannel;
    }

    const sent = await notifyChannel.send({
      content: buildPingMessage(member, voiceChannel),
      allowedMentions: { parse: ['everyone'] },
    });

    if (!sent?.id) {
      logger.error(`❌ Voice-Wait: Nachricht für user=${member.id} in channel=${notifyChannel.id} wurde gesendet, aber kein Message-Objekt zurückgegeben.`);
      throw new Error('Kein Message-Objekt nach channel.send()');
    }

    // Nach 1 Minute prüfen ob die Nachricht wirklich angekommen ist
    setTimeout(async () => {
      try {
        const verified = await notifyChannel.messages.fetch(sent.id);
        if (verified?.id) {
          logger.info(`✅ Voice-Wait: Nachricht verifiziert (messageId=${sent.id} channel=${notifyChannel.id})`);
        } else {
          logger.error(`❌ Voice-Wait: Nachricht (messageId=${sent.id}) nicht auffindbar nach 1 Minute – möglicherweise nicht zugestellt.`);
        }
      } catch (err) {
        logger.error(`❌ Voice-Wait: Verifikation der Nachricht (messageId=${sent.id}) fehlgeschlagen:`, err);
      }
    }, 60 * 1000);
  }

  async function inspectChannel(channel, waitMinutes, notifyChannelId) {
    if (!isSupportedVoiceChannel(channel)) return;

    const key = getKey(channel.guild.id, channel.id);
    const humans = getHumanMembers(channel);
    const current = aloneState.get(key);

    if (humans.size !== 1) {
      if (current) {
        aloneState.delete(key);
        logger.info(`🔄 Voice-Wait zurückgesetzt: channel=${channel.id} (${humans.size} Personen)`);
      }
      return;
    }

    const [member] = humans.values();
    const now = Date.now();

    if (!current || current.userId !== member.id) {
      aloneState.set(key, {
        userId: member.id,
        sinceMs: now,
        notified: false,
        sending: false,
      });
      logger.info(`🕒 Voice-Wait gestartet: channel=${channel.id} user=${member.id} waitMinutes=${waitMinutes}`);
      return;
    }

    if (current.notified || current.sending) return;

    if (now - current.sinceMs < waitMinutes * 60 * 1000) return;

    aloneState.set(key, { ...current, sending: true });

    try {
      await sendPing(member, channel, notifyChannelId);

      aloneState.set(key, { ...current, notified: true, sending: false });
      logger.info(`📣 Voice-Wait Ping gesendet: channel=${channel.id} user=${member.id}`);
    } catch (err) {
      aloneState.set(key, { ...current, sending: false });
      logger.error(`❌ Fehler beim Voice-Wait Ping für Channel ${channel.id}:`, err);
    }
  }

  async function scanGuild(guild) {
    const configuredChannels = listWaitingChannels(guild.id, logger);

    for (const [channelId, entry] of Object.entries(configuredChannels)) {
      const waitMinutes = entry?.waitMinutes;
      const notifyChannelId = entry?.notifyChannelId;

      if (!Number.isInteger(waitMinutes) || waitMinutes < 1) continue;

      const channel = guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null);

      if (!channel) {
        aloneState.delete(getKey(guild.id, channelId));
        continue;
      }

      await inspectChannel(channel, waitMinutes, notifyChannelId);
    }
  }

  async function runScan() {
    if (scanInProgress) return;

    scanInProgress = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        await scanGuild(guild);
      }
    } finally {
      scanInProgress = false;
    }
  }

  client.on('voiceStateUpdate', async (oldState, newState) => {
    const guild = oldState.guild || newState.guild;
    const seen = new Set();
    const channels = [oldState.channel, newState.channel].filter(ch => {
      if (!isSupportedVoiceChannel(ch) || seen.has(ch.id)) return false;
      seen.add(ch.id);
      return true;
    });
    const configuredChannels = listWaitingChannels(guild.id, logger);

    for (const channel of channels) {
      const entry = configuredChannels[channel.id];
      if (!entry?.waitMinutes) {
        aloneState.delete(getKey(guild.id, channel.id));
        continue;
      }

      await inspectChannel(channel, entry.waitMinutes, entry.notifyChannelId);
    }
  });

  client.on('voiceWaitConfigChanged', async (channel) => {
    if (!isSupportedVoiceChannel(channel)) return;

    const entry = listWaitingChannels(channel.guild.id, logger)[channel.id];
    if (!entry?.waitMinutes) {
      aloneState.delete(getKey(channel.guild.id, channel.id));
      return;
    }

    await inspectChannel(channel, entry.waitMinutes, entry.notifyChannelId);
  });

  setInterval(() => {
    runScan().catch(err => logger.error('❌ Fehler beim Voice-Wait Scan:', err));
  }, CHECK_INTERVAL_MS);

  runScan().catch(err => logger.error('❌ Fehler beim initialen Voice-Wait Scan:', err));
};
