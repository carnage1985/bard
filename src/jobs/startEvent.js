const cron = require('node-cron');
const { DateTime } = require('luxon');
const { GuildScheduledEventStatus, ChannelType } = require('discord.js');

module.exports = (client) => {
  // Alle 15 Minuten
  cron.schedule('*/15 * * * *', async () => {
    try {
      const guildId = process.env.GUILD_ID;
      if (!guildId) {
        console.warn('⚠️ GUILD_ID fehlt in .env, überspringe.');
        return;
      }

      const guild = await client.guilds.fetch(guildId);
      const events = await guild.scheduledEvents.fetch();

      const now = DateTime.now().setZone('Europe/Vienna');

      for (const event of events.values()) {
        if (event.status !== GuildScheduledEventStatus.Scheduled) continue;

        const desc = event.description ?? '';
        if (!/autostart/i.test(desc)) continue; // nur mit "autostart"

        const start = DateTime.fromJSDate(event.scheduledStartAt).setZone('Europe/Vienna');

        // Prüfen, ob Startzeit innerhalb der letzten 15 Minuten liegt
        const diffMinutes = now.diff(start, 'minutes').minutes;
        if (diffMinutes < 0 || diffMinutes > 15) continue;

        // Event starten
        await event.edit({ status: GuildScheduledEventStatus.Active });
        console.log(`✅ Event gestartet: ${event.name} (${event.id})`);

        if (!event.channelId) {
          console.warn(`ℹ️ Event ${event.name} hat keinen Channel – kein Chat-Post.`);
          continue;
        }

        const vc = await client.channels.fetch(event.channelId).catch(() => null);
        if (!vc || (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice)) {
          console.warn(`ℹ️ Channel für ${event.name} ist kein Voice/Stage – kein Chat-Post.`);
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
            console.warn(`⚠️ Rolle "${atMatch[1]}" nicht gefunden – sende ohne Rollenping.`);
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
    } catch (err) {
      console.error('❌ Fehler beim 15-Minuten-Event-Check:', err);
    }
  }, { timezone: 'Europe/Vienna' });
};
