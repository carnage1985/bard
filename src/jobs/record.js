// src/jobs/record.js
// /record start|stop – nimmt einen Sprachkanal auf (eine Ogg-Opus-Spur pro Person).
// Ablauf: alle im Kanal werden server-stummgeschaltet und im Textkanal markiert; wer auf
// „Zustimmen & entmuten“ klickt, wird entstummt und ab dann aufgenommen. Ohne Klick gibt es
// keine Aufnahme dieser Person. Ende per /record stop oder wenn außer Bots niemand mehr im Kanal ist.
// Die Spuren liegen in DATA_DIR/recordings/<server>/<datum>_<kanal>/ samt session.json
// (Teilnehmer, Zeitindex) – Transkription und Zusammenfassung sind ein eigener, späterer Schritt.
const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder, PermissionsBitField, MessageFlags, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const {
  joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType,
} = require('@discordjs/voice');
const { DateTime } = require('luxon');
const { DATA_DIR, getDataFilePath } = require('../utils/dataFilePath');
const { getCharacterName } = require('../utils/voiceCharactersStore');
const {
  SAMPLE_RATE, OggOpusWriter, TrackTimeline, slugify, formatDuration,
} = require('../utils/recording');

const EPHEMERAL = MessageFlags.Ephemeral;
const CONSENT_ID = 'rec:consent';
const MUTE_REASON = 'Aufnahme – wartet auf Zustimmung';
const UNMUTE_REASON = 'Aufnahme – Zustimmung erteilt oder Aufnahme beendet';
const SAVE_INTERVAL_MS = 15_000;

// Standard: nur Server-Admins. Eine eigene Rolle lässt sich später ohne Code-Änderung freischalten:
// Servereinstellungen → Integrationen → Bard → /record → Rolle hinzufügen.
const command = new SlashCommandBuilder()
  .setName('record')
  .setDescription('Nimmt den Sprachkanal auf (eine Spur pro Person, nur mit Zustimmung).')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .setDMPermission(false)
  .addSubcommand((sub) => sub.setName('start').setDescription('Startet die Aufnahme in deinem Sprachkanal.'))
  .addSubcommand((sub) => sub.setName('stop').setDescription('Beendet die laufende Aufnahme.'));

const consentRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(CONSENT_ID).setLabel('Zustimmen & entmuten').setEmoji('🎙️').setStyle(ButtonStyle.Success),
);

// ── Merkliste der von der Aufnahme gesetzten Stummschaltungen ────────────────
// Server-Mute lässt sich nur aufheben, solange die Person in einem Sprachkanal ist. Wer stumm den
// Kanal verlässt, bleibt hier vermerkt und wird beim nächsten Betreten eines Kanals entstummt –
// auch nach einem Neustart des Bots.
const MUTES_FILE = 'recordMutes.json';
let mutes = null; // { guildId: [userId, …] }

function loadMutes(logger) {
  if (mutes) return mutes;
  try {
    mutes = JSON.parse(fs.readFileSync(getDataFilePath(MUTES_FILE), 'utf8') || '{}');
  } catch (err) {
    if (err.code !== 'ENOENT') logger?.error('❌ Aufnahme: recordMutes.json nicht lesbar:', err);
    mutes = {};
  }
  return mutes;
}

function writeJsonAtomic(target, data) {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, target);
}

function saveMutes(logger) {
  try { writeJsonAtomic(getDataFilePath(MUTES_FILE), mutes); } catch (err) {
    logger?.error('❌ Aufnahme: recordMutes.json nicht speicherbar:', err);
  }
}

const isMutedByUs = (guildId, userId) => (loadMutes()[guildId] || []).includes(userId);

function rememberMute(guildId, userId, logger) {
  loadMutes(logger);
  if (!mutes[guildId]) mutes[guildId] = [];
  if (!mutes[guildId].includes(userId)) { mutes[guildId].push(userId); saveMutes(logger); }
}

function forgetMute(guildId, userId, logger) {
  loadMutes(logger);
  if (!mutes[guildId]?.includes(userId)) return;
  mutes[guildId] = mutes[guildId].filter((id) => id !== userId);
  if (!mutes[guildId].length) delete mutes[guildId];
  saveMutes(logger);
}

module.exports = (client, logger = console) => {
  const quiet = (msg) => logger.info(msg, { toDiscord: false });
  const sessions = new Map(); // guildId → laufende Aufnahme

  // ── Stummschalten / Entstummen ─────────────────────────────────────────────
  async function muteForConsent(member) {
    if (member.voice.serverMute) return; // war schon vorher stumm: nicht unsere Stummschaltung
    try {
      rememberMute(member.guild.id, member.id, logger); // vorher merken, damit nichts verloren geht
      await member.voice.setMute(true, MUTE_REASON);
    } catch (err) {
      forgetMute(member.guild.id, member.id, logger);
      quiet(`ℹ️ Aufnahme: Stummschalten von ${member.user.tag} nicht möglich (${err.code || err.message}).`);
    }
  }

  // Hebt nur Stummschaltungen auf, die die Aufnahme selbst gesetzt hat.
  async function releaseMute(member) {
    if (!isMutedByUs(member.guild.id, member.id)) return;
    if (!member.voice?.channelId) return; // nicht verbunden: bleibt vermerkt bis zum nächsten Betreten
    try {
      await member.voice.setMute(false, UNMUTE_REASON);
      forgetMute(member.guild.id, member.id, logger);
    } catch (err) {
      quiet(`ℹ️ Aufnahme: Entstummen von ${member.user.tag} nicht möglich (${err.code || err.message}).`);
    }
  }

  // ── Spuren ─────────────────────────────────────────────────────────────────
  function trackFor(session, member) {
    let track = session.tracks.get(member.id);
    if (!track) {
      const file = `${member.id}.ogg`;
      const out = fs.createWriteStream(path.join(session.dir, file));
      out.on('error', (err) => logger.error(`❌ Aufnahme: Schreibfehler bei ${file}:`, err));
      track = {
        userId: member.id,
        file,
        out,
        writer: new OggOpusWriter((page) => out.write(page)),
        timeline: new TrackTimeline(),
        stream: null,
        flushTimer: null,
      };
      session.tracks.set(member.id, track);
    }
    // Namen bei jedem (Wieder-)Einstieg aktualisieren
    track.username = member.user.username;
    track.displayName = member.displayName;
    track.characterName = getCharacterName(session.guildId, session.voiceChannelId, member.id, logger);
    return track;
  }

  function subscribe(session, member) {
    const track = trackFor(session, member);
    if (track.stream && !track.stream.destroyed) return;
    const stream = session.connection.receiver.subscribe(member.id, { end: { behavior: EndBehaviorType.Manual } });
    track.stream = stream;

    stream.on('data', (packet) => {
      const sessionMs = Date.now() - session.startedAt;
      const audioMs = track.writer.durationMs;
      const before = track.writer.samples;
      const samples = track.writer.writePacket(packet);
      if (!samples) return;
      track.timeline.note(sessionMs, audioMs, (samples / SAMPLE_RATE) * 1000);
      // Kurz nach dem letzten Paket eines Redebeitrags die offene Seite auf die Platte schreiben
      clearTimeout(track.flushTimer);
      track.flushTimer = setTimeout(() => track.writer.flush(), 500);
      if (before === 0) quiet(`🎙️ Aufnahme: erste Audiodaten von ${member.user.tag}.`);
    });
    // Bei einem Entschlüsselungsfehler beendet die Voice-Bibliothek den Stream – dann neu abonnieren.
    stream.on('error', (err) => quiet(`⚠️ Aufnahme: Audiostream von ${member.user.tag} unterbrochen (${err.message}).`));
    stream.on('close', () => {
      if (track.stream !== stream) return;
      track.stream = null;
      if (session.stopped || !session.consented.has(member.id)) return;
      setTimeout(() => {
        if (session.stopped) return;
        const current = member.guild.members.cache.get(member.id);
        if (current?.voice.channelId === session.voiceChannelId) subscribe(session, current);
      }, 1000);
    });
  }

  function unsubscribe(session, userId) {
    const track = session.tracks.get(userId);
    if (!track?.stream) return;
    const stream = track.stream;
    track.stream = null;
    stream.destroy();
    clearTimeout(track.flushTimer);
    track.writer.flush();
  }

  function saveSessionFile(session, endedAt = null) {
    const data = {
      version: 1,
      guild: { id: session.guildId, name: session.guildName },
      voiceChannel: { id: session.voiceChannelId, name: session.voiceChannelName },
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: endedAt ? new Date(endedAt).toISOString() : null,
      startedBy: session.startedBy,
      // segments: ab Dateiposition `a` (ms) gilt der Session-Zeitpunkt `t` (ms seit startedAt) – Stille ist nicht gespeichert.
      tracks: [...session.tracks.values()].map((t) => ({
        userId: t.userId,
        username: t.username,
        displayName: t.displayName,
        characterName: t.characterName,
        file: t.file,
        audioMs: t.writer.durationMs,
        segments: t.timeline.segments,
      })),
    };
    try { writeJsonAtomic(path.join(session.dir, 'session.json'), data); } catch (err) {
      logger.error('❌ Aufnahme: session.json nicht speicherbar:', err);
    }
  }

  // ── Start ──────────────────────────────────────────────────────────────────
  async function start(interaction) {
    const guild = interaction.guild;
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ Du musst in einem Sprachkanal sein, um die Aufnahme zu starten.', flags: EPHEMERAL });
    }
    if (voiceChannel.type !== ChannelType.GuildVoice) {
      return interaction.reply({ content: '❌ Aufnahmen gehen nur in normalen Sprachkanälen (keine Stage-Kanäle).', flags: EPHEMERAL });
    }
    if (sessions.has(guild.id)) {
      const running = sessions.get(guild.id);
      return interaction.reply({ content: `❌ Es läuft bereits eine Aufnahme in <#${running.voiceChannelId}>. Beende sie mit \`/record stop\`.`, flags: EPHEMERAL });
    }
    const me = guild.members.me;
    const perms = voiceChannel.permissionsFor(me);
    const missing = [
      ['ViewChannel', 'Kanal ansehen'], ['Connect', 'Verbinden'], ['MuteMembers', 'Mitglieder stummschalten'],
    ].filter(([flag]) => !perms?.has(PermissionsBitField.Flags[flag])).map(([, label]) => label);
    if (missing.length) {
      return interaction.reply({ content: `❌ Mir fehlen Rechte in <#${voiceChannel.id}>: **${missing.join(', ')}**.`, flags: EPHEMERAL });
    }

    await interaction.deferReply({ flags: EPHEMERAL });

    const startedAt = Date.now();
    const stamp = DateTime.fromMillis(startedAt).setZone('Europe/Vienna').toFormat('yyyy-MM-dd_HH-mm-ss');
    const dir = path.join(DATA_DIR, 'recordings', guild.id, `${stamp}_${slugify(voiceChannel.name)}`);

    const session = {
      guildId: guild.id,
      guildName: guild.name,
      voiceChannelId: voiceChannel.id,
      voiceChannelName: voiceChannel.name,
      textChannelId: interaction.channelId,
      startedBy: interaction.user.id,
      startedAt,
      dir,
      connection: null,
      consented: new Set([interaction.user.id]), // wer startet, stimmt damit zu
      tracks: new Map(),
      notices: [],
      saveTimer: null,
      stopped: false,
    };
    sessions.set(guild.id, session); // sofort reservieren (gegen doppeltes Starten)

    try {
      fs.mkdirSync(dir, { recursive: true });
      session.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false, // sonst kommt kein Audio an
        selfMute: true,
      });
      await entersState(session.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (err) {
      sessions.delete(guild.id);
      try { session.connection?.destroy(); } catch { /* schon zerstört */ }
      logger.error('❌ Aufnahme: Beitritt zum Sprachkanal fehlgeschlagen:', err);
      return interaction.editReply('❌ Ich konnte dem Sprachkanal nicht beitreten – Aufnahme nicht gestartet.');
    }

    session.connection.on('error', (err) => logger.error('❌ Aufnahme: Fehler der Sprachverbindung:', err));
    session.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Kurzer Aussetzer oder Kanalwechsel: Discord verbindet selbst neu
        await Promise.race([
          entersState(session.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(session.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        stop(session, 'die Sprachverbindung wurde getrennt').catch(() => {});
      }
    });

    // Zeitpunkt 0 der Aufnahme = jetzt, wo die Verbindung steht
    session.startedAt = Date.now();

    const humans = [...voiceChannel.members.values()].filter((m) => !m.user.bot);
    const starter = humans.find((m) => m.id === interaction.user.id);
    const others = humans.filter((m) => m.id !== interaction.user.id);
    await Promise.all(others.map((m) => muteForConsent(m)));
    if (starter) subscribe(session, starter);
    saveSessionFile(session);
    session.saveTimer = setInterval(() => saveSessionFile(session), SAVE_INTERVAL_MS);

    const mentions = others.map((m) => `<@${m.id}>`).join(' ');
    const notice = [
      `🔴 **Aufnahme in <#${voiceChannel.id}> gestartet** von <@${interaction.user.id}>.`,
      '',
      'Alle im Kanal sind jetzt stummgeschaltet. **Mit einem Klick auf „Zustimmen & entmuten“ stimmst du der Aufnahme deiner Stimme zu** und wirst wieder freigeschaltet.',
      'Wer nicht aufgenommen werden möchte, klickt nicht – du bleibst stumm und es wird nichts von dir gespeichert.',
      mentions ? `\n${mentions}` : '',
    ].join('\n').trim();

    try {
      // followUp statt editReply: nur neue Nachrichten lösen die Erwähnungen aus
      const msg = await interaction.followUp({
        content: notice,
        components: [consentRow()],
        allowedMentions: { users: others.map((m) => m.id) },
      });
      session.notices.push(msg);
    } catch (err) {
      logger.error('❌ Aufnahme: Hinweis konnte nicht gepostet werden – breche ab:', err);
      await stop(session, 'der Aufnahme-Hinweis konnte nicht gepostet werden', { announce: false });
      return interaction.editReply('❌ Ich konnte den Aufnahme-Hinweis hier nicht posten – Aufnahme abgebrochen, alle wieder entstummt.');
    }

    await interaction.editReply(`✅ Aufnahme läuft. Beenden mit \`/record stop\` – oder automatisch, sobald alle <#${voiceChannel.id}> verlassen haben.`);
    logger.info(`🔴 Aufnahme gestartet von ${interaction.user.tag} in #${voiceChannel.name} (${guild.name}), ${others.length} Person(en) warten auf Zustimmung.`);
  }

  // ── Stop ───────────────────────────────────────────────────────────────────
  async function stop(session, reason, { announce = true } = {}) {
    if (session.stopped) return null;
    session.stopped = true;
    sessions.delete(session.guildId);
    clearInterval(session.saveTimer);
    const endedAt = Date.now();

    for (const track of session.tracks.values()) {
      clearTimeout(track.flushTimer);
      if (track.stream) { const s = track.stream; track.stream = null; s.destroy(); }
      track.writer.end();
      track.out.end();
    }
    saveSessionFile(session, endedAt);
    try { session.connection?.destroy(); } catch { /* schon zerstört */ }

    // Alle noch von uns Stummgeschalteten wieder freigeben (wer nicht verbunden ist, folgt beim nächsten Betreten)
    const guild = client.guilds.cache.get(session.guildId);
    if (guild) {
      for (const userId of [...(loadMutes(logger)[session.guildId] || [])]) {
        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (member) await releaseMute(member);
      }
    }
    for (const msg of session.notices) {
      await msg.edit({ components: [] }).catch(() => {}); // Zustimmungs-Button entfernen
    }

    const recorded = [...session.tracks.values()].filter((t) => t.writer.samples > 0);
    const lines = [
      `⏹️ **Aufnahme in <#${session.voiceChannelId}> beendet** (${reason}).`,
      `Dauer: **${formatDuration(endedAt - session.startedAt)}**`,
      recorded.length
        ? `Aufgenommen: ${recorded.map((t) => `<@${t.userId}> (${formatDuration(t.writer.durationMs)})`).join(', ')}`
        : 'Es wurde nichts aufgenommen.',
      `Ablage: \`recordings/${session.guildId}/${path.basename(session.dir)}\``,
    ];
    const summary = lines.join('\n');
    logger.info(`⏹️ Aufnahme beendet in #${session.voiceChannelName} (${reason}), ${recorded.length} Spur(en), ${formatDuration(endedAt - session.startedAt)}.`);

    if (announce) {
      const channel = await client.channels.fetch(session.textChannelId).catch(() => null);
      await channel?.send({ content: summary, allowedMentions: { parse: [] } })
        .catch((err) => quiet(`ℹ️ Aufnahme: Abschlussmeldung nicht möglich (${err.code || err.message}).`));
    }
    return summary;
  }

  // ── Zustimmung per Button ──────────────────────────────────────────────────
  async function consent(interaction) {
    const session = sessions.get(interaction.guildId);
    if (!session) {
      return interaction.reply({ content: 'ℹ️ Es läuft gerade keine Aufnahme.', flags: EPHEMERAL });
    }
    const member = interaction.member;
    if (member.voice?.channelId !== session.voiceChannelId) {
      return interaction.reply({ content: `ℹ️ Du bist nicht in <#${session.voiceChannelId}>. Komm in den Kanal und klick dann noch einmal.`, flags: EPHEMERAL });
    }
    const already = session.consented.has(member.id);
    session.consented.add(member.id);
    await releaseMute(member);
    subscribe(session, member);
    saveSessionFile(session);
    await interaction.reply({
      content: already
        ? '✅ Du hast bereits zugestimmt und wirst aufgenommen.'
        : '✅ Danke – du bist entstummt und wirst ab jetzt aufgenommen. Wenn du das nicht mehr möchtest, verlasse den Sprachkanal.',
      flags: EPHEMERAL,
    });
    if (!already) quiet(`🎙️ Aufnahme: ${member.user.tag} hat zugestimmt.`);
  }

  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === CONSENT_ID) return await consent(interaction);
      if (!interaction.isChatInputCommand() || interaction.commandName !== 'record') return;
      if (!interaction.inCachedGuild()) {
        return await interaction.reply({ content: '❌ Das geht nur auf einem Server.', flags: EPHEMERAL });
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'start') return await start(interaction);
      if (sub === 'stop') {
        const session = sessions.get(interaction.guildId);
        if (!session) return await interaction.reply({ content: 'ℹ️ Es läuft gerade keine Aufnahme.', flags: EPHEMERAL });
        await interaction.deferReply({ flags: EPHEMERAL });
        await stop(session, `gestoppt von ${interaction.user.username}`);
        return await interaction.editReply('⏹️ Aufnahme beendet.');
      }
    } catch (err) {
      logger.error('❌ Fehler im /record-Command:', err);
      const payload = { content: '❌ Da ist etwas schiefgelaufen.', flags: EPHEMERAL };
      await (interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload)).catch(() => {});
    }
  });

  // ── Kommen und Gehen im Sprachkanal ────────────────────────────────────────
  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      const guildId = newState.guild.id;
      const session = sessions.get(guildId);
      const member = newState.member;
      if (!member) return;

      // Der Bot selbst wurde verschoben oder getrennt → Aufnahme beenden
      if (member.id === client.user.id) {
        if (session && newState.channelId !== session.voiceChannelId) {
          await stop(session, newState.channelId ? 'der Bot wurde verschoben' : 'der Bot wurde getrennt');
        }
        return;
      }
      if (member.user.bot) return;

      const recordingChannelId = session?.voiceChannelId ?? null;
      const joined = newState.channelId && newState.channelId !== oldState.channelId;
      const leftRecording = session && oldState.channelId === recordingChannelId && newState.channelId !== recordingChannelId;

      if (joined && session && newState.channelId === recordingChannelId) {
        if (session.consented.has(member.id)) {
          await releaseMute(member); // falls noch von früher stumm
          subscribe(session, member);
        } else {
          await muteForConsent(member);
          const channel = await client.channels.fetch(session.textChannelId).catch(() => null);
          const msg = await channel?.send({
            content: `🔴 <@${member.id}>, in <#${recordingChannelId}> läuft eine **Aufnahme**. Du bist stummgeschaltet – mit „Zustimmen & entmuten“ stimmst du der Aufnahme deiner Stimme zu.`,
            components: [consentRow()],
            allowedMentions: { users: [member.id] },
          }).catch(() => null);
          if (msg) session.notices.push(msg);
        }
      } else if (joined) {
        // In einem anderen Kanal (oder ohne laufende Aufnahme): alte Stummschaltung der Aufnahme aufheben
        await releaseMute(member);
      }

      if (leftRecording) {
        unsubscribe(session, member.id);
        const channel = newState.guild.channels.cache.get(recordingChannelId);
        const humansLeft = channel ? channel.members.filter((m) => !m.user.bot).size : 0;
        if (humansLeft === 0) await stop(session, 'alle haben den Kanal verlassen');
      }
    } catch (err) {
      logger.error('❌ Aufnahme: Fehler bei voiceStateUpdate:', err);
    }
  });

  // ── Nach einem Neustart: übrig gebliebene Stummschaltungen aufheben ────────
  (async () => {
    for (const [guildId, userIds] of Object.entries(loadMutes(logger))) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      for (const userId of [...userIds]) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await releaseMute(member);
        else forgetMute(guildId, userId, logger); // nicht mehr auf dem Server
      }
    }
  })().catch((err) => logger.error('❌ Aufnahme: Aufräumen der Stummschaltungen fehlgeschlagen:', err));
};

module.exports.command = command;
