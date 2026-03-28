const { ChannelType } = require('discord.js');
const {
  watchConfig,
  listWaitingChannels,
} = require('../utils/voiceWaitingStore');

const CHECK_INTERVAL_MS = 60 * 1000;

function isSupportedVoiceChannel(channel) {
  return channel && [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type);
}

function getHumanMembers(channel) {
  return channel.members.filter(member => !member.user.bot);
}

module.exports = (client, logger = console) => {
  watchConfig(logger);

  const aloneState = new Map();

  function getKey(guildId, channelId) {
    return `${guildId}:${channelId}`;
  }

  async function inspectChannel(channel, waitMinutes) {
    if (!isSupportedVoiceChannel(channel)) return;

    const key = getKey(channel.guild.id, channel.id);
    const humans = getHumanMembers(channel);
    const current = aloneState.get(key);

    if (humans.size !== 1) {
      aloneState.delete(key);
      return;
    }

    const [member] = humans.values();
    const now = Date.now();

    if (!current || current.userId !== member.id) {
      aloneState.set(key, {
        userId: member.id,
        sinceMs: now,
        notified: false,
      });
      logger.info(`🕒 Voice-Wait gestartet: guild=${channel.guild.id} channel=${channel.id} user=${member.id} waitMinutes=${waitMinutes}`);
      return;
    }

    if (current.notified) {
      return;
    }

    if (now - current.sinceMs < waitMinutes * 60 * 1000) {
      return;
    }

    try {
      await channel.send({
        content: `@here <@${member.id}> wartet in diesem Channel auf Gesellschaft.`,
        allowedMentions: {
          parse: ['everyone'],
          users: [member.id],
        },
      });

      aloneState.set(key, {
        ...current,
        notified: true,
      });
      logger.info(`📣 Voice-Wait Ping gesendet: guild=${channel.guild.id} channel=${channel.id} user=${member.id}`);
    } catch (err) {
      logger.error(`❌ Fehler beim Voice-Wait Ping für Channel ${channel.id}:`, err);
    }
  }

  async function scanGuild(guild) {
    const configuredChannels = listWaitingChannels(guild.id, logger);
    const entries = Object.entries(configuredChannels);

    for (const [channelId, entry] of entries) {
      const waitMinutes = entry?.waitMinutes;
      if (!Number.isInteger(waitMinutes) || waitMinutes < 1) continue;

      const channel = guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null);

      if (!channel) {
        aloneState.delete(getKey(guild.id, channelId));
        continue;
      }

      await inspectChannel(channel, waitMinutes);
    }
  }

  async function runScan() {
    for (const guild of client.guilds.cache.values()) {
      await scanGuild(guild);
    }
  }

  client.on('voiceStateUpdate', async (oldState, newState) => {
    const channels = [oldState.channel, newState.channel].filter(isSupportedVoiceChannel);

    for (const channel of channels) {
      const configured = listWaitingChannels(channel.guild.id, logger)[channel.id];
      if (!configured?.waitMinutes) {
        aloneState.delete(getKey(channel.guild.id, channel.id));
        continue;
      }

      await inspectChannel(channel, configured.waitMinutes);
    }
  });

  client.on('voiceWaitConfigChanged', async (channel) => {
    if (!isSupportedVoiceChannel(channel)) return;

    const configured = listWaitingChannels(channel.guild.id, logger)[channel.id];
    if (!configured?.waitMinutes) {
      aloneState.delete(getKey(channel.guild.id, channel.id));
      return;
    }

    await inspectChannel(channel, configured.waitMinutes);
  });

  setInterval(() => {
    runScan().catch((err) => {
      logger.error('❌ Fehler beim Voice-Wait Scan:', err);
    });
  }, CHECK_INTERVAL_MS);

  runScan().catch((err) => {
    logger.error('❌ Fehler beim initialen Voice-Wait Scan:', err);
  });
};
