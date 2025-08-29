// src/jobs/startEvent.js
const cron = require('node-cron');
const { DateTime } = require('luxon');
const { GuildScheduledEventStatus, ChannelType } = require('discord.js');

module.exports = (client) => {
  // Jede volle Stunde
  cron.schedule('0 * * * *', async () => {
    try {
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const events = await guild.scheduledEvents.fetch();

      const nowHour = DateTime.now().setZone('Europe/Vienna').startOf('hour');

      for (const event of events.values()) {
        if (event.status !== GuildScheduledEventStatus.Scheduled) continue;

        const desc = event.description ?? '';
        if (!/autostart/i.test(desc)) continue; // nur Events mit "autostart"

        const start = DateTime.fromJSDate(event.scheduledStartAt).setZone('Europe/Vienna').startOf('hour');
        if (start.toISO() !== nowHour.toISO()) continue; // startet nicht jetzt

        // Event aktiv setzen
        await event.edit({ status: GuildScheduledEventStatus.Active });
        console.log(`✅ Event gestartet: ${event.name} (${event.id})`);

        // Voice-/Stage-Channel holen (wo das Event stattfindet)
        if (!event.channelId) continue; // z.B. externe Events
        const vc = await client.channels.fetch(event.channelId).catch(() => null);
        if (!vc || (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice)) continue;

        // Optional: erste @Rolle aus der Description herauslesen (z.B. "@Donnerstag autostart")
        let roleIdForMention = null;
        const at = desc.match(/@([^\s#@]{2,})/);
        if (at && at[1]) {
          const role = guild.roles.cache.find(r => r.name.toLowerCase() === at[1].toLowerCase());
          if (role) roleIdForMention = role.id;
        }

        const mentionText = roleIdForMention ? `<@&${roleIdForMention}> ` : '';

        // Nachricht in den Voice-Channel-Textchat senden
        await vc.send({
          content: `${mentionText}${event.name} ist jetzt gestartet 🎉`,
          allowedMentions: roleIdForMention ? { roles: [roleIdForMention] } : { parse: [] },
        });
      }
    } catch (err) {
      console.error('❌ Fehler beim stündlichen Event-Check:', err);
    }
  }, { timezone: 'Europe/Vienna' });
};
