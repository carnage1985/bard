// src/jobs/startEvent.js
const cron = require('node-cron');
const { DateTime } = require('luxon');
const { GuildScheduledEventStatus, ChannelType } = require('discord.js');

module.exports = (client) => {
  // Jede volle Stunde
  cron.schedule('0 * * * *', async () => {
    try {
      const guildId = process.env.GUILD_ID;
      if (!guildId) {
        console.warn('⚠️ GUILD_ID fehlt in .env, überspringe.');
        return;
      }

      const guild = await client.guilds.fetch(guildId);
      const events = await guild.scheduledEvents.fetch();

      // „Jetzt“ auf volle Stunde (Europe/Vienna)
      const nowHour = DateTime.now().setZone('Europe/Vienna').startOf('hour');

      for (const event of events.values()) {
        // Nur geplante Events
        if (event.status !== GuildScheduledEventStatus.Scheduled) continue;

        const desc = event.description ?? '';
        // Nur Events mit "autostart" (ignore case)
        if (!/autostart/i.test(desc)) continue;

        // Startzeit auf volle Stunde runden und vergleichen
        const startHour = DateTime.fromJSDate(event.scheduledStartAt)
          .setZone('Europe/Vienna')
          .startOf('hour');

        if (startHour.toISO() !== nowHour.toISO()) continue;

        // Event starten (Status -> ACTIVE)
        await event.edit({ status: GuildScheduledEventStatus.Active });
        console.log(`✅ Event gestartet: ${event.name} (${event.id})`);

        // Voice-/Stage-Channel holen
        if (!event.channelId) {
          console.warn(`ℹ️ Event ${event.name} hat keinen Channel (externes Event) – kein Chat-Post.`);
          continue;
        }

        const vc = await client.channels.fetch(event.channelId).catch(() => null);
        if (!vc || (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice)) {
          console.warn(`ℹ️ Event-Channel ist kein Voice/Stage (ID: ${event.channelId}) – kein Chat-Post.`);
          continue;
        }

        // Erste @Rolle aus Description extrahieren, z.B. "@Donnerstag autostart"
        // -> wir matchen @<Name> ohne Leer-/Sonderzeichen-Blödsinn
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

        // Nachricht in den Textchat des Voice-/Stage-Channels
        await vc.send({
          content: `${mentionText}${event.name} ist jetzt gestartet 🎉`,
          // allowedMentions so setzen, dass NUR die gefundene Rolle gepingt wird
          allowedMentions: roleIdForMention
            ? { roles: [roleIdForMention] }
            : { parse: [] }
        });
      }
    } catch (err) {
      console.error('❌ Fehler beim stündlichen Event-Check:', err);
    }
  }, { timezone: 'Europe/Vienna' });
};