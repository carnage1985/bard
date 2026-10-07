// Secret-Hitler-Spielmodus. Spiel: https://secrethitler.com (CC BY-NC-SA 4.0).
// Geheime Infos laufen per DM (Fallback: "Meine Aktion"-Button mit Ephemeral-Antwort),
// öffentliche Abstimmungen per Buttons im Kanal, der Spielplan als Live-Webseite.
const crypto = require('crypto');
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  EmbedBuilder, MessageFlags, PermissionsBitField,
} = require('discord.js');
const E = require('../games/secretHitler/engine');
const store = require('../games/secretHitler/store');
const board = require('../web/boardServer');

const { PHASE } = E;
const EPHEMERAL = MessageFlags.Ephemeral;

const command = new SlashCommandBuilder()
  .setName('sh')
  .setDescription('Secret Hitler spielen.')
  .addSubcommand((s) => s.setName('start').setDescription('Neue Lobby öffnen (Spieler aus deinem Sprachkanal werden übernommen).'))
  .addSubcommand((s) => s.setName('status').setDescription('Zeigt den aktuellen Spielstand.'))
  .addSubcommand((s) => s.setName('abbrechen').setDescription('Laufendes Spiel abbrechen (Host oder Manage Server).'))
  .addSubcommand((s) => s.setName('regeln').setDescription('Kurzregeln und Lizenzhinweis.'));

const ROLE_TEXT = {
  liberal: '🕊️ **Liberaler**',
  fascist: '🐍 **Faschist**',
  hitler: '💀 **Hitler**',
};
const POWER_TEXT = {
  peek: '🔮 Policy Peek', investigate: '🔍 Loyalität untersuchen',
  special: '🎩 Spezialwahl', execution: '🔫 Hinrichtung',
};
const cardName = (c) => (c === 'L' ? '🕊️ Liberal' : '🐍 Faschistisch');
const mention = (id) => `<@${id}>`;

module.exports = (client, logger = console) => {
  const quiet = (msg, ...a) => logger.info(msg, ...a, { toDiscord: false });
  const games = new Map(); // guildId -> game
  const webBase = (process.env.WEB_BASE_URL || '').replace(/\/+$/, '');
  const webPort = Number(process.env.WEB_PORT) || 3000;
  let webStarted = false;

  // ---------- Persistenz / Web ----------

  function persist() {
    const out = {};
    for (const [gid, g] of games) out[gid] = g;
    store.save(out, logger);
  }

  function view(game) {
    if (game.state) return E.publicView(game.state);
    return {
      code: game.code, phase: 'LOBBY', round: 0, liberal: 0, fascist: 0, tracker: 0,
      deckCount: 17, discardCount: 0, powers: [], presidentId: null, candidateId: null,
      chancellorId: null, lastPresId: null, lastChancId: null,
      players: game.lobby.map((p) => ({ ...p, alive: true, voted: null, role: null })),
      winner: null, winReason: null, log: [],
    };
  }

  function sync(game) {
    if (webBase) board.publish(game.code, view(game));
    persist();
  }

  function boardLink(game) {
    return webBase ? `${webBase}/${game.code}/` : null;
  }

  function ensureWeb() {
    if (!webBase || webStarted) return;
    webStarted = true;
    board.start({ port: webPort, logger });
  }

  // ---------- Hilfen ----------

  const nameOf = (game, id) => game.state?.players.find((p) => p.id === id)?.name
    || game.lobby.find((p) => p.id === id)?.name || 'Unbekannt';

  async function channelOf(game) {
    return client.channels.fetch(game.channelId).catch(() => null);
  }

  async function say(game, payload) {
    const ch = await channelOf(game);
    if (!ch) return null;
    try { return await ch.send(typeof payload === 'string' ? { content: payload } : payload); } catch (err) {
      logger.error('❌ Secret Hitler: Senden fehlgeschlagen:', err);
      return null;
    }
  }

  const row = (...components) => new ActionRowBuilder().addComponents(...components);
  const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

  function playerSelect(game, customId, placeholder, players) {
    return new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder)
      .addOptions(players.map((p) => ({ label: p.name.slice(0, 100), value: p.id })));
  }

  // Privater Prompt (Text + Komponenten) für das, was `userId` gerade tun muss.
  function promptFor(game, userId) {
    const s = game.state;
    if (!s) return null;
    const g = game.guildId;
    const pres = E.president(s);
    if (s.phase === PHASE.NOMINATE && userId === pres.id) {
      return {
        content: '🏛️ **Du bist Präsident.** Wen nominierst du als Kanzler?',
        components: [row(playerSelect(game, `sh:nom:${g}`, 'Kanzlerkandidat wählen', E.legalChancellors(s)))],
      };
    }
    if (s.phase === PHASE.LEGISLATE_PRESIDENT && userId === pres.id) {
      return {
        content: `📜 **Legislative – Präsident.** Du ziehst: ${s.hand.map(cardName).join(' · ')}\nWelche Policy **wirfst du ab**?`,
        components: [row(...s.hand.map((c, i) => btn(`sh:pd:${g}:${i}`, `${cardName(c)} abwerfen`, ButtonStyle.Danger)))],
      };
    }
    if (s.phase === PHASE.LEGISLATE_CHANCELLOR && userId === s.chancellorId) {
      const buttons = s.hand.map((c, i) => btn(`sh:ce:${g}:${i}`, `${cardName(c)} erlassen`, ButtonStyle.Primary));
      if (s.fascist >= 5 && !s.vetoDenied) buttons.push(btn(`sh:cv:${g}`, 'Veto vorschlagen', ButtonStyle.Danger));
      return {
        content: `📜 **Legislative – Kanzler.** Der Präsident gibt dir: ${s.hand.map(cardName).join(' · ')}\nWelche Policy **erlässt du**?`,
        components: [row(...buttons)],
      };
    }
    if (s.phase === PHASE.VETO && userId === pres.id) {
      return {
        content: '🛑 Der Kanzler möchte ein **Veto** einlegen. Beide Policies würden abgeworfen (Wahl-Tracker +1). Zustimmen?',
        components: [row(btn(`sh:pv:${g}:1`, 'Veto zustimmen', ButtonStyle.Danger), btn(`sh:pv:${g}:0`, 'Veto ablehnen'))],
      };
    }
    if (s.phase === PHASE.EXECUTIVE && userId === pres.id) {
      const g2 = `sh:pw:${g}`;
      if (s.power === 'peek') {
        return {
          content: `⚡ **Macht: ${POWER_TEXT.peek}** – du siehst die obersten 3 Policies.`,
          components: [row(btn(g2, 'Peek ausführen', ButtonStyle.Primary))],
        };
      }
      return {
        content: `⚡ **Macht: ${POWER_TEXT[s.power]}** – wähle einen Spieler.`,
        components: [row(playerSelect(game, g2, 'Spieler wählen', E.powerTargets(s)))],
      };
    }
    return null;
  }

  // Wer wird gerade erwartet (für Status/Fallback)?
  function waitingFor(game) {
    const s = game.state;
    if (!s) return [];
    switch (s.phase) {
      case PHASE.NOMINATE: case PHASE.LEGISLATE_PRESIDENT: case PHASE.VETO: case PHASE.EXECUTIVE:
        return [E.president(s).id];
      case PHASE.LEGISLATE_CHANCELLOR: return [s.chancellorId];
      case PHASE.VOTE: return s.players.filter((p) => p.alive && !(p.id in s.votes)).map((p) => p.id);
      default: return [];
    }
  }

  async function dm(userId, payload) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(payload);
      return true;
    } catch (err) {
      quiet(`⚠️ Secret Hitler: DM an ${userId} fehlgeschlagen (${err.code || err.message}).`);
      return false;
    }
  }

  async function sendPrompt(game, userId) {
    const prompt = promptFor(game, userId);
    if (!prompt) return;
    const ok = await dm(userId, prompt);
    if (!ok) {
      await say(game, {
        content: `⚠️ ${mention(userId)}, ich kann dir keine DM schicken (DMs für Server-Mitglieder erlauben!). Nutze stattdessen den Button.`,
        components: [row(btn(`sh:prompt:${game.guildId}`, '📬 Meine Aktion', ButtonStyle.Primary))],
        allowedMentions: { users: [userId] },
      });
    }
  }

  // ---------- Spielstart ----------

  function lobbyPayload(game) {
    const link = boardLink(game);
    const embed = new EmbedBuilder()
      .setTitle('🎩 Secret Hitler – Lobby')
      .setDescription([
        `Spieler (${game.lobby.length}/${E.MAX_PLAYERS}, min. ${E.MIN_PLAYERS}):`,
        game.lobby.map((p) => `• ${mention(p.id)}`).join('\n') || '–',
        '',
        `Host: ${mention(game.hostId)}`,
        link ? `📋 Spielplan: ${link}` : '',
        'Gesprochen wird im Sprachkanal, Aktionen laufen über Buttons. Rollen kommen per DM.',
      ].filter((l) => l !== '').join('\n'));
    return {
      embeds: [embed],
      components: [row(
        btn('sh:join', 'Beitreten', ButtonStyle.Success),
        btn('sh:leave', 'Verlassen'),
        btn('sh:begin', 'Spiel starten', ButtonStyle.Primary),
      )],
      allowedMentions: { parse: [] },
    };
  }

  async function updateLobby(game) {
    const ch = await channelOf(game);
    const msg = game.lobbyMsgId && await ch?.messages.fetch(game.lobbyMsgId).catch(() => null);
    if (msg) await msg.edit(lobbyPayload(game)).catch(() => {});
    sync(game);
  }

  async function beginGame(game, interaction) {
    const state = E.createGame({ code: game.code, hostId: game.hostId, players: game.lobby });
    game.state = state;
    game.promptKey = null;
    sync(game);
    ensureWeb();

    const failed = [];
    for (const p of state.players) {
      const info = E.roleInfo(state, p.id);
      const lines = [`Deine Rolle: ${ROLE_TEXT[info.role]}`];
      if (info.role === 'liberal') lines.push('Finde die Faschisten und erlasse 5 liberale Policies – oder töte Hitler.');
      if (info.role === 'fascist') {
        lines.push(`Hitler ist **${info.hitler.name}**.`);
        if (info.teammates.length) lines.push(`Deine Mitfaschisten: ${info.teammates.map((t) => `**${t.name}**`).join(', ')}`);
        lines.push('Erlasse 6 faschistische Policies – oder bringe Hitler nach 3 Policies ins Kanzleramt.');
      }
      if (info.role === 'hitler') {
        lines.push(info.teammates.length
          ? `Deine Mitfaschisten: ${info.teammates.map((t) => `**${t.name}**`).join(', ')}`
          : 'Du kennst die Faschisten nicht – sie kennen dich.');
        lines.push('Spiele möglichst liberal und lass dich nach 3 faschistischen Policies zum Kanzler wählen.');
      }
      lines.push('', '🤫 Zeig diese Nachricht niemandem. Lügen ist erlaubt – außer als Hitler im Moment der Wahl/Hinrichtung.');
      if (!(await dm(p.id, { content: lines.join('\n') }))) failed.push(p.id);
    }

    const link = boardLink(game);
    await say(game, {
      content: [
        '🎩 **Das Spiel beginnt!** Rollen wurden per DM verschickt.',
        link ? `📋 Spielplan: ${link}` : '',
        failed.length ? `⚠️ DM fehlgeschlagen für ${failed.map(mention).join(', ')} – nutzt den Button „Meine Rolle“.` : '',
        `Reihenfolge: ${state.players.map((p) => p.name).join(' → ')}`,
      ].filter(Boolean).join('\n'),
      components: failed.length ? [row(btn(`sh:role:${game.guildId}`, '🎴 Meine Rolle', ButtonStyle.Primary))] : [],
      allowedMentions: { users: failed },
    });
    await advance(game, [{ type: 'nominate', presidentId: E.president(state).id }], null);
  }

  // ---------- Fortschritt nach jeder Aktion ----------

  async function announce(game, ev) {
    const s = game.state;
    const n = (id) => `**${nameOf(game, id)}**`;
    switch (ev.type) {
      case 'nominate':
        await say(game, `🏛️ Präsident ${mention(ev.presidentId)} nominiert einen Kanzler …`);
        break;
      case 'vote_start': {
        const msg = await say(game, {
          content: `🗳️ **Abstimmung:** Präsident ${mention(ev.presidentId)} + Kanzler ${mention(ev.chancellorId)}\nAlle lebenden Spieler stimmen ab.`,
          components: [row(btn(`sh:vote:${game.guildId}:1`, 'Ja!', ButtonStyle.Success), btn(`sh:vote:${game.guildId}:0`, 'Nein', ButtonStyle.Danger))],
          allowedMentions: { parse: [] },
        });
        game.voteMsgId = msg?.id || null;
        break;
      }
      case 'vote_result': {
        const lines = s.players.filter((p) => p.id in ev.votes).map((p) => `${ev.votes[p.id] ? '✅ Ja' : '❌ Nein'} – ${p.name}`);
        const text = `🗳️ **Ergebnis: ${ev.passed ? 'Regierung gewählt' : 'Abgelehnt'}** (${ev.ja}:${ev.nein})\n${lines.join('\n')}`;
        const ch = await channelOf(game);
        const msg = game.voteMsgId && await ch?.messages.fetch(game.voteMsgId).catch(() => null);
        if (msg) await msg.edit({ content: text, components: [], allowedMentions: { parse: [] } }).catch(() => {});
        else await say(game, text);
        game.voteMsgId = null;
        break;
      }
      case 'not_hitler': await say(game, `✔️ ${n(ev.userId)} ist **nicht Hitler**.`); break;
      case 'chaos': await say(game, '🌀 **Chaos!** Drei Regierungen in Folge abgelehnt – die oberste Policy wird erlassen, Term-Limits fallen.'); break;
      case 'policy':
        await say(game, `${ev.policy === 'L' ? '🕊️ **Liberale** Policy erlassen' : '🐍 **Faschistische** Policy erlassen'}${ev.chaos ? ' (durch Chaos)' : ''} – 🕊️ ${ev.liberal}/5 · 🐍 ${ev.fascist}/6`);
        break;
      case 'veto_request': await say(game, '🛑 Der Kanzler schlägt ein **Veto** vor …'); break;
      case 'veto_accepted': await say(game, '🛑 Veto angenommen – beide Policies abgeworfen, Wahl-Tracker +1.'); break;
      case 'veto_denied': await say(game, '🛑 Veto abgelehnt – der Kanzler muss eine Policy erlassen.'); break;
      case 'power': await say(game, `⚡ Der Präsident erhält eine Macht: **${POWER_TEXT[ev.power]}**`); break;
      case 'peek': await say(game, '🔮 Der Präsident hat die obersten drei Policies angesehen.'); break;
      case 'investigate': await say(game, `🔍 ${n(ev.public.presidentId)} untersucht die Parteizugehörigkeit von ${n(ev.public.targetId)}.`); break;
      case 'special': await say(game, `🎩 ${n(ev.presidentId)} ruft eine **Spezialwahl** aus: ${n(ev.targetId)} wird Präsidentschaftskandidat.`); break;
      case 'execution': {
        await say(game, `🔫 ${n(ev.presidentId)} richtet **${nameOf(game, ev.targetId)}** hin.`);
        await muteDead(game, ev.targetId);
        break;
      }
      case 'game_over': {
        const roles = s.players.map((p) => `${ROLE_TEXT[p.role]} – ${p.name}${p.alive ? '' : ' ☠️'}`).join('\n');
        await say(game, `🏁 **${ev.winner === E.LIBERAL ? 'Die Liberalen' : 'Die Faschisten'} gewinnen!** ${ev.reason}.\n\n${roles}`);
        break;
      }
      default: break;
    }
  }

  async function muteDead(game, userId, mute = true) {
    try {
      const ch = await channelOf(game);
      const member = await ch?.guild.members.fetch(userId);
      if (member?.voice.channelId) await member.voice.setMute(mute, 'Secret Hitler');
    } catch (err) {
      quiet(`ℹ️ Secret Hitler: Mute für ${userId} nicht möglich (${err.code || err.message}).`);
    }
  }

  // Events verarbeiten, dann private Prompts für den neuen Zustand verschicken.
  // `actor` = Interaction-User, an den private Ergebnisse direkt (ephemeral) gehen.
  async function advance(game, events, interaction) {
    const s = game.state;
    for (const ev of events) {
      if (ev.type === 'vote_cast') continue;
      if (ev.type === 'investigate') {
        const text = `🔍 **${nameOf(game, ev.targetId)}** gehört zur Partei: ${ev.party === E.LIBERAL ? '🕊️ **Liberal**' : '🐍 **Faschistisch**'}\n(Du darfst lügen.)`;
        await deliverPrivate(game, ev.to, text, interaction);
      } else if (ev.type === 'peek') {
        await deliverPrivate(game, ev.to, `🔮 Oberste Policies: ${ev.cards.map(cardName).join(' · ')}`, interaction);
      }
      await announce(game, ev);
    }

    if (s.phase === PHASE.GAME_OVER) {
      for (const p of s.players) if (!p.alive) await muteDead(game, p.id, false);
      sync(game);
      setTimeout(() => { // Board noch kurz sichtbar lassen
        games.delete(game.guildId);
        board.remove(game.code);
        persist();
      }, 60 * 60 * 1000).unref();
      return;
    }

    if (events.some((e) => e.type === 'vote_cast') && events.length === 1) {
      await updateVoteMessage(game);
      sync(game);
      return;
    }
    sync(game);
    const key = `${s.round}:${s.phase}`;
    if (key !== game.promptKey && s.phase !== PHASE.VOTE) {
      game.promptKey = key;
      for (const id of new Set(waitingFor(game))) await sendPrompt(game, id);
    }
  }

  async function deliverPrivate(game, userId, text, interaction) {
    if (interaction && interaction.user.id === userId) {
      await interaction.followUp({ content: text, flags: EPHEMERAL }).catch(() => dm(userId, { content: text }));
    } else {
      await dm(userId, { content: text });
    }
  }

  async function updateVoteMessage(game) {
    const s = game.state;
    if (!game.voteMsgId) return;
    const ch = await channelOf(game);
    const msg = await ch?.messages.fetch(game.voteMsgId).catch(() => null);
    if (!msg) return;
    const pending = s.players.filter((p) => p.alive && !(p.id in s.votes)).map((p) => p.name);
    const base = msg.content.split('\n').slice(0, 2).join('\n');
    await msg.edit({ content: `${base}\n⏳ Fehlt noch: ${pending.join(', ') || '–'}`, allowedMentions: { parse: [] } }).catch(() => {});
  }

  // ---------- Interaktionen ----------

  function statusText(game) {
    const s = game.state;
    if (!s) return `Lobby mit ${game.lobby.length} Spieler(n).`;
    const waiting = waitingFor(game).map(mention).join(', ');
    return [
      `Phase: **${s.phase}** · Runde ${s.round}`,
      `🕊️ ${s.liberal}/5 · 🐍 ${s.fascist}/6 · Wahl-Tracker ${s.tracker}/3`,
      `Präsident: ${mention(E.president(s).id)}${s.chancellorId ? ` · Kanzler: ${mention(s.chancellorId)}` : ''}`,
      waiting ? `Wartet auf: ${waiting}` : '',
      boardLink(game) ? `📋 ${boardLink(game)}` : '',
    ].filter(Boolean).join('\n');
  }

  async function handleCommand(interaction) {
    const sub = interaction.options.getSubcommand();
    const gid = interaction.guildId;
    if (!gid) return interaction.reply({ content: '❌ Nur auf einem Server nutzbar.', flags: EPHEMERAL });
    const game = games.get(gid);

    if (sub === 'regeln') {
      return interaction.reply({
        flags: EPHEMERAL,
        content: [
          '**Secret Hitler** (5–10 Spieler): Liberale gewinnen mit 5 liberalen Policies oder wenn Hitler stirbt. Faschisten gewinnen mit 6 faschistischen Policies oder wenn Hitler nach 3 faschistischen Policies Kanzler wird.',
          'Pro Runde: Präsident nominiert Kanzler → alle stimmen ab → Präsident zieht 3 Policies, wirft 1 ab → Kanzler erlässt eine von 2. Faschistische Policies geben dem Präsidenten Mächte.',
          'Gesprochen wird im Sprachkanal; Rollen, Policies und Aktionen bekommst du per DM / Buttons. Lügen ist erlaubt.',
          'Spiel von Mike Boxleiter, Tommy Maranges & Mac Schubert – https://secrethitler.com – Lizenz CC BY-NC-SA 4.0 (nicht-kommerziell). Diese Umsetzung ist ein Discord-Bot-Modus; Regeln sinngemäß übernommen.',
        ].join('\n\n'),
      });
    }
    if (sub === 'status') {
      return interaction.reply({ content: game ? statusText(game) : 'Es läuft kein Spiel.', flags: EPHEMERAL });
    }
    if (sub === 'abbrechen') {
      if (!game) return interaction.reply({ content: 'Es läuft kein Spiel.', flags: EPHEMERAL });
      const allowed = interaction.user.id === game.hostId
        || interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
      if (!allowed) return interaction.reply({ content: '❌ Nur der Host oder Manage Server.', flags: EPHEMERAL });
      for (const p of game.state?.players || []) if (!p.alive) await muteDead(game, p.id, false);
      games.delete(gid);
      board.remove(game.code);
      persist();
      return interaction.reply('🛑 Secret Hitler wurde abgebrochen.');
    }
    // start
    if (game) return interaction.reply({ content: '❌ Auf diesem Server läuft bereits ein Spiel (`/sh status`).', flags: EPHEMERAL });
    await interaction.deferReply({ flags: EPHEMERAL });
    const voice = interaction.member?.voice?.channel;
    const lobby = [{ id: interaction.user.id, name: interaction.member.displayName }];
    if (voice) {
      for (const m of voice.members.values()) {
        if (!m.user.bot && m.id !== interaction.user.id && lobby.length < E.MAX_PLAYERS) lobby.push({ id: m.id, name: m.displayName });
      }
    }
    const g = {
      guildId: gid, channelId: interaction.channelId, hostId: interaction.user.id,
      code: crypto.randomBytes(6).toString('hex'), lobby, state: null,
      lobbyMsgId: null, voteMsgId: null, promptKey: null,
    };
    games.set(gid, g);
    ensureWeb();
    const msg = await say(g, lobbyPayload(g));
    g.lobbyMsgId = msg?.id || null;
    sync(g);
    await interaction.editReply(voice
      ? `✅ Lobby geöffnet, ${lobby.length} Spieler aus deinem Sprachkanal übernommen.`
      : '✅ Lobby geöffnet. Tipp: Starte aus einem Sprachkanal, dann werden alle dort übernommen.');
  }

  async function handleComponent(interaction) {
    const [, action, gidFromId, arg] = interaction.customId.split(':');
    const gid = interaction.guildId || gidFromId;
    const game = games.get(gid);
    const reply = (content) => interaction.reply({ content, flags: EPHEMERAL }).catch(() => {});
    if (!game) return reply('❌ Dieses Spiel läuft nicht mehr.');
    const uid = interaction.user.id;

    // --- Lobby ---
    if (['join', 'leave', 'begin'].includes(action)) {
      if (game.state) return reply('❌ Das Spiel läuft bereits.');
      if (action === 'join') {
        if (game.lobby.some((p) => p.id === uid)) return reply('Du bist schon dabei.');
        if (game.lobby.length >= E.MAX_PLAYERS) return reply('❌ Die Lobby ist voll.');
        game.lobby.push({ id: uid, name: interaction.member?.displayName || interaction.user.username });
      } else if (action === 'leave') {
        game.lobby = game.lobby.filter((p) => p.id !== uid);
        if (!game.lobby.length) { games.delete(gid); board.remove(game.code); persist(); return interaction.update({ content: 'Lobby geschlossen.', embeds: [], components: [] }); }
        if (uid === game.hostId) game.hostId = game.lobby[0].id;
      } else {
        if (uid !== game.hostId) return reply('❌ Nur der Host kann starten.');
        if (game.lobby.length < E.MIN_PLAYERS) return reply(`❌ Mindestens ${E.MIN_PLAYERS} Spieler nötig.`);
        await interaction.update({ content: '🎩 Spiel gestartet.', embeds: [], components: [] }).catch(() => {});
        return beginGame(game, interaction);
      }
      await interaction.deferUpdate().catch(() => {});
      return updateLobby(game);
    }

    // --- Fallback-Buttons ---
    if (action === 'role') {
      const p = game.state?.players.find((x) => x.id === uid);
      if (!p) return reply('❌ Du spielst nicht mit.');
      const info = E.roleInfo(game.state, uid);
      const lines = [`Deine Rolle: ${ROLE_TEXT[info.role]}`];
      if (info.hitler) lines.push(`Hitler: **${info.hitler.name}**`);
      if (info.teammates.length) lines.push(`Mitfaschisten: ${info.teammates.map((t) => `**${t.name}**`).join(', ')}`);
      return reply(lines.join('\n'));
    }
    if (action === 'prompt') {
      const prompt = promptFor(game, uid);
      if (!prompt) return reply('Du musst gerade nichts tun.');
      return interaction.reply({ ...prompt, flags: EPHEMERAL });
    }

    // --- Spielaktionen ---
    const s = game.state;
    if (!s) return reply('❌ Das Spiel hat noch nicht begonnen.');
    const value = interaction.isStringSelectMenu() ? interaction.values[0] : arg;
    let events;
    let done;
    try {
      switch (action) {
        case 'vote':
          events = E.vote(s, uid, arg === '1');
          return await finishVote(game, interaction, events, arg === '1');
        case 'nom': events = E.nominate(s, uid, value); done = `✅ Du nominierst **${nameOf(game, value)}**.`; break;
        case 'pd': events = E.presidentDiscard(s, uid, Number(value)); done = '✅ Policy abgeworfen, der Rest geht an den Kanzler.'; break;
        case 'ce': events = E.chancellorEnact(s, uid, Number(value)); done = '✅ Policy erlassen.'; break;
        case 'cv': events = E.chancellorVeto(s, uid); done = '✅ Veto vorgeschlagen.'; break;
        case 'pv': events = E.presidentVeto(s, uid, arg === '1'); done = arg === '1' ? '✅ Veto zugestimmt.' : '✅ Veto abgelehnt.'; break;
        case 'pw':
          events = E.usePower(s, uid, s.power === 'peek' ? undefined : value);
          done = '✅ Macht eingesetzt.';
          break;
        default: return reply('❌ Unbekannte Aktion.');
      }
    } catch (err) {
      return reply(`❌ ${err.message}`);
    }
    await interaction.update({ content: done, components: [] }).catch(() => {});
    return advance(game, events, interaction);
  }

  async function finishVote(game, interaction, events, ja) {
    await interaction.reply({
      content: `🗳️ Deine Stimme (**${ja ? 'Ja' : 'Nein'}**) ist gespeichert. Du kannst sie bis zur Aufdeckung noch ändern.`,
      flags: EPHEMERAL,
    }).catch(() => {});
    return advance(game, events, interaction);
  }

  // ---------- Setup ----------

  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'sh') await handleCommand(interaction);
      else if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('sh:')) {
        await handleComponent(interaction);
      }
    } catch (err) {
      logger.error('❌ Fehler im Secret-Hitler-Modus:', err);
      const msg = { content: '❌ Interner Fehler im Secret-Hitler-Modus.', flags: EPHEMERAL };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
  });

  // Laufende Spiele nach Neustart wiederherstellen.
  const saved = store.load(logger);
  for (const [gid, g] of Object.entries(saved)) {
    if (g.state?.phase === PHASE.GAME_OVER) continue;
    games.set(gid, g);
    if (webBase) { ensureWeb(); board.publish(g.code, view(g)); }
  }
  if (games.size) quiet(`🎩 Secret Hitler: ${games.size} Spiel(e) wiederhergestellt.`);
};

module.exports.command = command;
