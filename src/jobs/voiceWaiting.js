const { ChannelType } = require('discord.js');
const {
  watchConfig,
  getWaitingChannelConfig,
} = require('../utils/voiceWaitingStore');

function isSupportedVoiceChannel(channel) {
  return channel && [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type);
}

function getHumanMembers(channel) {
  return channel.members.filter(member => !member.user.bot);
}

module.exports = (client, logger = console) => {
  watchConfig(logger);

  const pendingTimers = new Map();
  const sentNotifications = new Map();

  function getKey(guildId, channelId) {
    return `${guildId}:${channelId}`;
  }

  function clearTimer(key) {
    const timer = pendingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      pendingTimers.delete(key);
    }
  }

  async function evaluateChannel(channel) {
    if (!isSupportedVoiceChannel(channel)) return;

    const config = getWaitingChannelConfig(channel.guild.id, channel.id, logger);
    const key = getKey(channel.guild.id, channel.id);

    clearTimer(key);

    if (!config) {
      sentNotifications.delete(key);
      return;
    }

    const humans = getHumanMembers(channel);

    if (humans.size !== 1) {
      sentNotifications.delete(key);
      return;
    }

    const [member] = humans.values();
    const sessionId = member.id;

    if (sentNotifications.get(key) === sessionId) {
      return;
    }

    const waitMinutes = config.waitMinutes;
    const waitMs = waitMinutes * 60 * 1000;

    pendingTimers.set(key, setTimeout(async () => {
      pendingTimers.delete(key);

      try {
        const refreshedChannel = await client.channels.fetch(channel.id).catch(() => null);
        if (!isSupportedVoiceChannel(refreshedChannel)) return;

        const refreshedConfig = getWaitingChannelConfig(refreshedChannel.guild.id, refreshedChannel.id, logger);
        if (!refreshedConfig) {
          sentNotifications.delete(key);
          return;
        }

        const refreshedHumans = getHumanMembers(refreshedChannel);
        if (refreshedHumans.size !== 1) {
          sentNotifications.delete(key);
          return;
        }

        const [stillWaitingMember] = refreshedHumans.values();
        if (stillWaitingMember.id !== sessionId) {
          sentNotifications.delete(key);
          return;
        }

        if (sentNotifications.get(key) === sessionId) {
          return;
        }

        await refreshedChannel.send({
          content: `@here <@${stillWaitingMember.id}> wartet in diesem Channel auf Gesellschaft.`,
          allowedMentions: {
            parse: ['everyone', 'users'],
            users: [stillWaitingMember.id],
          },
        });

        sentNotifications.set(key, sessionId);
        logger.info(`📣 Voice-Wait Ping gesendet: guild=${refreshedChannel.guild.id} channel=${refreshedChannel.id} user=${stillWaitingMember.id}`);
      } catch (err) {
        logger.error(`❌ Fehler beim Voice-Wait Ping für Channel ${channel.id}:`, err);
      }
    }, waitMs));
  }

  client.on('voiceStateUpdate', async (oldState, newState) => {
    const channelsToEvaluate = new Map();

    if (isSupportedVoiceChannel(oldState.channel)) {
      channelsToEvaluate.set(oldState.channel.id, oldState.channel);
    }
    if (isSupportedVoiceChannel(newState.channel)) {
      channelsToEvaluate.set(newState.channel.id, newState.channel);
    }

    for (const channel of channelsToEvaluate.values()) {
      await evaluateChannel(channel);
    }
  });

  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (isSupportedVoiceChannel(channel)) {
        evaluateChannel(channel).catch((err) => {
          logger.error(`❌ Fehler beim Initial-Check für Voice-Channel ${channel.id}:`, err);
        });
      }
    }
  }
};
