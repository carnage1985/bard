const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
  watchConfig,
  listWaitingChannels,
  getPingRole,
  isNeverPing,
  setNeverPing,
  getActivePing,
  listActivePings,
  setActivePing,
  clearActivePing,
} = require('../utils/voiceWaitingStore');
const { phrase } = require('../utils/gemini');

const CHECK_INTERVAL_MS = 60 * 1000;
const CONFIRM_TIMEOUT_MS = 30 * 1000;

function isSupportedVoiceChannel(channel) {
  return channel && [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type);
}

function getHumanMembers(channel) {
  return channel.members.filter(member => !member.user.bot);
}

// @Rolle/@here, Name und Kanal-Link setzt immer der Bot; Gemini formuliert nur den Satz drumherum.
async function buildPingMessage(member, voiceChannel, roleId, logger) {
  const name = member.displayName || member.user.username;
  const target = roleId ? `<@&${roleId}>` : '@here';
  const sentence = await phrase(
    'ping',
    '{name} ist gerade alleine in {channel} und würde sich über Gesellschaft freuen! 🎮',
    { name: `**${name}**`, channel: `<#${voiceChannel.id}>` },
    logger,
  );
  return `${target} ${sentence}`;
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

    const roleId = getPingRole(voiceChannel.guild.id, logger);
    const sent = await notifyChannel.send({
      content: await buildPingMessage(member, voiceChannel, roleId, logger),
      allowedMentions: roleId ? { roles: [roleId] } : { parse: ['everyone'] },
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
        if (err.code === 10008) {
          logger.info(`🧹 Voice-Wait: Nachricht (messageId=${sent.id}) war bei der Verifikation schon gelöscht.`);
          return;
        }
        logger.error(`❌ Voice-Wait: Verifikation der Nachricht (messageId=${sent.id}) fehlgeschlagen:`, err);
      }
    }, 60 * 1000);

    return { channelId: notifyChannel.id, messageId: sent.id };
  }

  // Löscht die Alleine-Ping-Nachricht (aus dem State oder dem Store) und räumt den Store-Eintrag auf.
  async function deletePingMessage(guildId, voiceChannelId, ping = null) {
    const stored = getActivePing(guildId, voiceChannelId, logger);
    const target = ping || stored;
    if (stored && (!ping || stored.messageId === ping.messageId)) {
      clearActivePing(guildId, voiceChannelId, logger);
    }
    if (!target) return;

    try {
      const channel = client.channels.cache.get(target.channelId)
        || await client.channels.fetch(target.channelId).catch(() => null);
      if (!channel) return;
      await channel.messages.delete(target.messageId);
      logger.info(`🧹 Voice-Wait Ping gelöscht: voiceChannel=${voiceChannelId} messageId=${target.messageId}`);
    } catch (err) {
      if (err.code === 10008) return; // Nachricht existiert nicht mehr
      logger.warn(`⚠️ Voice-Wait: Ping (messageId=${target.messageId}) konnte nicht gelöscht werden: ${err.message}`);
    }
  }

  // Channel nicht mehr überwacht/vorhanden: State und eventuell noch stehende Nachricht entfernen.
  async function resetChannel(guildId, channelId) {
    const key = getKey(guildId, channelId);
    const current = aloneState.get(key);
    aloneState.delete(key);
    await deletePingMessage(guildId, channelId, current?.pingMessage);
  }

  // Nach einem Neustart: übrig gebliebene Pings löschen, außer dieselbe Person sitzt noch alleine dort.
  async function restoreActivePings() {
    for (const guild of client.guilds.cache.values()) {
      for (const [voiceChannelId, ping] of Object.entries(listActivePings(guild.id, logger))) {
        const channel = guild.channels.cache.get(voiceChannelId)
          || await guild.channels.fetch(voiceChannelId).catch(() => null);
        const entry = listWaitingChannels(guild.id, logger)[voiceChannelId];
        const humans = isSupportedVoiceChannel(channel) ? getHumanMembers(channel) : null;

        if (entry?.waitMinutes && humans?.size === 1 && humans.first().id === ping.userId) {
          aloneState.set(getKey(guild.id, voiceChannelId), {
            userId: ping.userId,
            sinceMs: Date.now(),
            notified: true,
            sending: false,
            pingMessage: { channelId: ping.channelId, messageId: ping.messageId },
          });
        } else {
          await deletePingMessage(guild.id, voiceChannelId);
        }
      }
    }
  }

  // Fragt die alleine sitzende Person per DM (nur sie sieht es). Keine Antwort
  // innerhalb von 30 s oder DMs geschlossen => Ping wird ausgelöst.
  async function confirmPing(member, voiceChannel, waitMinutes) {
    const intro = await phrase(
      'dm',
      '🎮 Du bist seit {minutes} Min. alleine in {channel}.',
      { minutes: `**${waitMinutes}**`, channel: `**${voiceChannel.name}**` },
      logger,
    );

    let dm;
    try {
      dm = await member.send({
        content: `${intro} Soll ich die anderen anpingen? Ohne Antwort pinge ich in 30 Sekunden automatisch. („Nie pingen“ gilt dauerhaft, rückgängig mit \`/voicewait wiederfragen\`.)`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('vw:ping').setLabel('Ping auslösen').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('vw:skip').setLabel('Nicht pingen').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('vw:never').setLabel('Nie pingen').setStyle(ButtonStyle.Danger),
        )],
      });
    } catch (err) {
      logger.warn(`⚠️ Voice-Wait: DM an user=${member.id} nicht möglich, pinge direkt.`);
      return true;
    }

    try {
      const click = await dm.awaitMessageComponent({
        time: CONFIRM_TIMEOUT_MS,
        filter: i => i.user.id === member.id,
      });
      const never = click.customId === 'vw:never';
      const ping = click.customId === 'vw:ping';
      if (never) setNeverPing(voiceChannel.guild.id, member.id, true, logger);
      const text = ping ? '📣 Ping wird gesendet.' : never ? '🔕 Okay, ich pinge für dich nie wieder. Rückgängig mit `/voicewait wiederfragen`.' : '🤫 Okay, kein Ping.';
      await click.update({ content: text, components: [] }).catch(() => {});
      return ping;
    } catch {
      await dm.edit({ content: '📣 Keine Antwort – Ping wurde gesendet.', components: [] }).catch(() => {});
      return true;
    }
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
      await deletePingMessage(channel.guild.id, channel.id, current?.pingMessage);
      return;
    }

    const [member] = humans.values();
    const now = Date.now();

    if (!current || current.userId !== member.id) {
      if (current) await deletePingMessage(channel.guild.id, channel.id, current.pingMessage);
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

    if (isNeverPing(channel.guild.id, member.id, logger)) {
      aloneState.set(key, { ...current, notified: true, sending: false });
      return;
    }

    try {
      const confirmed = await confirmPing(member, channel, waitMinutes);

      // Währenddessen gegangen/gewechselt? Dann ist der State zurückgesetzt worden.
      const latest = aloneState.get(key);
      if (!latest || latest.sinceMs !== current.sinceMs) return;

      if (!confirmed) {
        aloneState.set(key, { ...current, notified: true, sending: false });
        logger.info(`🤫 Voice-Wait Ping abgelehnt: channel=${channel.id} user=${member.id}`);
        return;
      }

      const ping = await sendPing(member, channel, notifyChannelId);

      // Währenddessen gegangen/gewechselt? Dann den frisch gesendeten Ping gleich wieder entfernen.
      const afterSend = aloneState.get(key);
      if (!afterSend || afterSend.sinceMs !== current.sinceMs) {
        await deletePingMessage(channel.guild.id, channel.id, ping);
        return;
      }

      setActivePing(channel.guild.id, channel.id, { userId: member.id, ...ping }, logger);
      aloneState.set(key, { ...current, notified: true, sending: false, pingMessage: ping });
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
        await resetChannel(guild.id, channelId);
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
        await resetChannel(guild.id, channel.id);
        continue;
      }

      await inspectChannel(channel, entry.waitMinutes, entry.notifyChannelId);
    }
  });

  client.on('voiceWaitConfigChanged', async (channel) => {
    if (!isSupportedVoiceChannel(channel)) return;

    const entry = listWaitingChannels(channel.guild.id, logger)[channel.id];
    if (!entry?.waitMinutes) {
      await resetChannel(channel.guild.id, channel.id);
      return;
    }

    await inspectChannel(channel, entry.waitMinutes, entry.notifyChannelId);
  });

  setInterval(() => {
    runScan().catch(err => logger.error('❌ Fehler beim Voice-Wait Scan:', err));
  }, CHECK_INTERVAL_MS);

  restoreActivePings()
    .catch(err => logger.error('❌ Fehler beim Wiederherstellen der Voice-Wait Pings:', err))
    .then(() => runScan())
    .catch(err => logger.error('❌ Fehler beim initialen Voice-Wait Scan:', err));
};
