const cron = require('node-cron');
const { DateTime } = require('luxon');
const { GuildScheduledEventStatus, ChannelType } = require('discord.js');

module.exports = (client, logger = console) => {
  // Alle 15 Minuten
  cron.schedule('*/15 * * * *', async () => {
    try {
      const guildId = process.env.GUILD_ID;
      if (!guildId) {
        logger.warn('⚠️ GUILD_ID fehlt in .env, überspringe.');
        return;
      }

      const guild = await client.guilds.fetch(guildId);
      const events = await guild.scheduledEvents.fetch();

      const now = DateTime.now().setZone('Europe/Vienna');

      // Statistik-Zähler
      let totalChecked = 0;
      let startedCount = 0;
      let skippedCount = 0;

      for (const event of events.values()) {
        totalChecked++;

        if (event.status !== GuildScheduledEventStatus.Scheduled) {
          skippedCount++;
          continue;
        }

        const desc = event.description ?? '';
        if (!/autostart/i.test(desc)) {
          skippedCount++;
          continue;
        }

        const start = DateTime.fromJSDate(event.scheduledStartAt).setZone('Europe/Vienna');
        const diffMinutes = now.diff(start, 'minutes').minutes;

        // Nur wenn Startzeit <= jetzt und max. 15 Minuten alt
        if (diffMinutes < 0 || diffMinutes > 15) {
          skippedCount++;
          continue;
        }

        // Event starten
        await event.edit({ status: GuildScheduledEventStatus.Active });
        logger.info(`✅ Event gestartet: ${event.name} (${event.id})`);
        startedCount++;

        if (!event.channelId) {
          logger.warn(`ℹ️ Event ${event.name} hat keinen Channel – kein Chat-Post.`);
          continue;
        }

        const vc = await client.channels.fetch(event.channelId).catch(() => null);
        if (!vc || (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice)) {
          logger.warn(`ℹ️ Channel für ${event.name} ist kein Voice/Stage – kein Chat-Post.`);
          continue;
        }

        // Optional: @Rolle aus Description extrahieren
        let roleIdForMention = null;
        const atMatch = desc.match(/@([^\s#@]{2,})/);
        if (atMatch && atMatch[1]) {
          const role = guild.roles.cache.find(r => r.name.toLowerCase() === atMatch[1].toLowerCase());
          if (role) {
            roleIdForMention = role.id;
          } else {
            logger.warn(`⚠️ Rolle "${atMatch[1]}" nicht gefunden – sende ohne Rollenping.`);
          }
        }

        const mentionText = roleIdForMention ? `<@&${roleIdForMention}> ` : '';

        await vc.send({
          content: `${mentionText}${event.name} ist jetzt gestartet 🎉`,
          allowedMentions: roleIdForMention
            ? { roles: [roleIdForMention] }
            : { parse: [] }
        });
      }

      // Zusammenfassung ins Log
      logger.info(`🔎 Event-Check: geprüft=${totalChecked}, gestartet=${startedCount}, übersprungen=${skippedCount}`);

    } catch (err) {
      logger.error('❌ Fehler beim 15-Minuten-Event-Check:', err);
    }
  }, { timezone: 'Europe/Vienna' });
};
