// Werwolf-Spielmodus (/ww). Gleiches Muster wie Secret Hitler: Geheimes per DM (Fallback: Button
// "Meine Aktion"), Abstimmungen per Buttons, gesprochen wird im Sprachkanal. Besonderheiten:
// Nacht = alle Spieler server-gemutet, Wölfe sprechen sich in einem privaten Thread ab,
// Phasen-Timer (persistiert, laufen nach Neustart weiter) und Host-Optionen in der Lobby.
// Rollen sind datengetrieben (src/games/werewolf/roles/) – dieses Modul kennt keine konkrete Rolle.
const crypto = require('crypto');
const {
  SlashCommandBuilder, ButtonStyle, PermissionsBitField, ChannelType, StringSelectMenuBuilder,
} = require('discord.js');
const W = require('../games/werewolf/engine');
const { getRole } = require('../games/werewolf/roles');
const { describeSetup, selectableRoles } = require('../games/werewolf/setup');
const sessions = require('../games/core/sessions');
const { EPHEMERAL, row, btn, playerSelect, createMessenger } = require('../games/core/messenger');
const { collectLobby, lobbyPayload: buildLobbyPayload, applyLobbyAction } = require('../games/core/lobby');

const { PHASE } = W;
const TYPE = 'ww';
const LIMITS = { min: W.MIN_PLAYERS, max: W.MAX_PLAYERS };

// Zeitprofile in Sekunden: Nacht / Diskussion / Abstimmung
const PROFILES = {
  fast: { label: 'Schnell (Nacht 1 Min, Diskussion 2 Min, Abstimmung 1 Min)', night: 60, discuss: 120, vote: 60 },
  normal: { label: 'Normal (Nacht 2 Min, Diskussion 5 Min, Abstimmung 90 s)', night: 120, discuss: 300, vote: 90 },
  long: { label: 'Lang (Nacht 3 Min, Diskussion 10 Min, Abstimmung 2 Min)', night: 180, discuss: 600, vote: 120 },
};
const TRIGGER_SECONDS = 60;
const TICK_MS = 5000;

const command = new SlashCommandBuilder()
  .setName('ww')
  .setDescription('Werwolf spielen.')
  .addSubcommand((s) => s.setName('start').setDescription('Neue Lobby öffnen (Spieler aus deinem Sprachkanal werden übernommen).'))
  .addSubcommand((s) => s.setName('status').setDescription('Zeigt den aktuellen Spielstand.'))
  .addSubcommand((s) => s.setName('abbrechen').setDescription('Laufendes Spiel abbrechen (Host oder Manage Server).'))
  .addSubcommand((s) => s.setName('regeln').setDescription('Kurzregeln und Rollenübersicht.'));

const mention = (id) => `<@${id}>`;
const defaultOptions = () => ({ revealRoles: true, roles: {}, profile: 'normal' });

module.exports = (client, logger = console) => {
  sessions.init(logger);
  const {
    quiet, channelOf, say, dm, deliverPrivate, setMute,
  } = createMessenger(client, logger);

  const persist = () => sessions.persist();
  const timers = (game) => PROFILES[game.options.profile] || PROFILES.normal;
  const nameOf = (game, id) => (game.state || game).players?.find((p) => p.id === id)?.name
    || game.lobby?.find((p) => p.id === id)?.name || 'Unbekannt';

  // Aktionen pro Server nacheinander abarbeiten (Button-Klicks und Timer dürfen sich nicht überholen).
  const locks = new Map();
  function withLock(gid, fn) {
    const prev = locks.get(gid) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    locks.set(gid, next);
    next.finally(() => { if (locks.get(gid) === next) locks.delete(gid); }).catch(() => {});
    return next;
  }

  // ---------- Lobby & Optionen ----------

  function engineOptions(game) {
    return { revealRoles: game.options.revealRoles, roles: game.options.roles };
  }

  function setupFor(game) {
    return describeSetup(Math.max(game.lobby.length, LIMITS.min), engineOptions(game));
  }

  function lobbyPayload(game) {
    const setup = setupFor(game);
    const hint = [
      `**Rollen (bei ${Math.max(game.lobby.length, LIMITS.min)} Spielern):**`,
      setup.text,
      ...setup.warnings.map((w) => `⚠️ ${w}`),
      ...setup.errors.map((e) => `❌ ${e}`),
      `⏱️ ${timers(game).label}`,
      game.options.revealRoles ? '🪦 Rollen werden beim Tod aufgedeckt.' : '🪦 Rollen bleiben nach dem Tod geheim.',
      'Gesprochen wird im Sprachkanal (nachts stumm), Aktionen per Buttons/DM, Wölfe sprechen sich im privaten Thread ab.',
    ].join('\n');
    return buildLobbyPayload(game, {
      prefix: TYPE,
      title: '🐺 Werwolf – Lobby',
      ...LIMITS,
      hint,
      extraButtons: [btn(`${TYPE}:opt`, '⚙️ Optionen')],
    });
  }

  async function updateLobby(game) {
    const ch = await channelOf(game);
    const msg = game.lobbyMsgId && await ch?.messages.fetch(game.lobbyMsgId).catch(() => null);
    if (msg) await msg.edit(lobbyPayload(game)).catch(() => {});
    persist();
  }

  // Optionen-Panel (ephemeral, nur Host): Rollen, Wolfsanzahl, Zeitprofil, Aufdecken
  function optionsPanel(game) {
    const g = game.guildId;
    const n = Math.max(game.lobby.length, LIMITS.min);
    const o = game.options;
    const eff = (r) => (o.roles[r.id] === undefined ? (r.defaultCount?.(n, engineOptions(game)) ?? 0) > 0 : Number(o.roles[r.id]) > 0);
    const selectable = selectableRoles();

    const rolesSelect = new StringSelectMenuBuilder()
      .setCustomId(`${TYPE}:or:${g}`)
      .setPlaceholder('Spezialrollen auswählen')
      .setMinValues(0)
      .setMaxValues(Math.max(1, selectable.length))
      .addOptions(selectable.map((r) => ({
        label: `${r.emoji} ${r.name}`.slice(0, 100),
        description: `${getTeamName(r.team)} – ${(r.description || '').slice(0, 70)}`.slice(0, 100),
        value: r.id,
        default: eff(r),
      })));

    const maxWolves = Math.max(1, Math.min(5, Math.floor((n - 1) / 2)));
    const wolfSelect = new StringSelectMenuBuilder()
      .setCustomId(`${TYPE}:ow:${g}`)
      .setPlaceholder('Anzahl Werwölfe')
      .addOptions([
        { label: `Automatisch (${W.rawRoles(n, {}).filter((id) => id === 'werewolf').length})`, value: 'auto', default: o.roles.werewolf === undefined },
        ...Array.from({ length: maxWolves }, (_, i) => ({
          label: `${i + 1} Werwolf${i ? 'ölfe' : ''}`, value: String(i + 1), default: Number(o.roles.werewolf) === i + 1,
        })),
      ]);

    const profileSelect = new StringSelectMenuBuilder()
      .setCustomId(`${TYPE}:op:${g}`)
      .setPlaceholder('Zeitlimits')
      .addOptions(Object.entries(PROFILES).map(([id, p]) => ({ label: p.label.slice(0, 100), value: id, default: o.profile === id })));

    const setup = setupFor(game);
    return {
      content: [
        '⚙️ **Werwolf-Optionen** (nur für den Host)',
        setup.text,
        ...setup.warnings.map((w) => `⚠️ ${w}`),
        ...setup.errors.map((e) => `❌ ${e}`),
      ].join('\n'),
      components: [
        row(rolesSelect), row(wolfSelect), row(profileSelect),
        row(
          btn(`${TYPE}:ot:${g}`, o.revealRoles ? '🪦 Aufdecken: AN' : '🪦 Aufdecken: AUS', o.revealRoles ? ButtonStyle.Success : ButtonStyle.Secondary),
          btn(`${TYPE}:oz:${g}`, 'Auf Standard zurücksetzen', ButtonStyle.Danger),
        ),
      ],
      flags: EPHEMERAL,
    };
  }

  const getTeamName = (team) => require('../games/werewolf/teams').TEAM_INFO[team].name;

  async function handleOption(interaction, game, action) {
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({ content: '❌ Nur der Host kann die Optionen ändern.', flags: EPHEMERAL });
    }
    if (game.state) return interaction.reply({ content: '❌ Das Spiel läuft bereits.', flags: EPHEMERAL });
    const o = game.options;
    if (action === 'or') {
      for (const r of selectableRoles()) o.roles[r.id] = interaction.values.includes(r.id) ? 1 : 0;
    } else if (action === 'ow') {
      const v = interaction.values[0];
      if (v === 'auto') delete o.roles.werewolf; else o.roles.werewolf = Number(v);
    } else if (action === 'op') {
      if (PROFILES[interaction.values[0]]) o.profile = interaction.values[0];
    } else if (action === 'ot') {
      o.revealRoles = !o.revealRoles;
    } else if (action === 'oz') {
      game.options = defaultOptions();
    }
    await interaction.update(optionsPanel(game)).catch(() => {});
    await updateLobby(game);
  }

  // ---------- Prompts ----------

  function witchPrompt(game, uid) {
    const s = game.state;
    const g = game.guildId;
    const victimId = s.nightState.shared.victimId;
    const st = s.roleState.witch;
    const pend = (game.pending[uid] ||= { heal: false, poisonId: null });
    const lines = [
      `${getRole('witch').emoji} **Hexe** – ${victimId ? `Die Wölfe haben **${nameOf(game, victimId)}** gewählt.` : 'Die Wölfe haben niemanden gewählt.'}`,
      `Heiltrank: ${st.heal ? 'vorhanden' : 'aufgebraucht'} · Gifttrank: ${st.poison ? 'vorhanden' : 'aufgebraucht'}`,
      `Auswahl: ${[pend.heal && '🧪 heilen', pend.poisonId && `☠️ vergiften: ${nameOf(game, pend.poisonId)}`].filter(Boolean).join(' · ') || 'nichts'}`,
    ];
    const buttons = [];
    if (st.heal && victimId) {
      buttons.push(btn(`${TYPE}:wh:${g}`, pend.heal ? 'Heilung: AN' : 'Heilung: AUS', pend.heal ? ButtonStyle.Success : ButtonStyle.Secondary));
    }
    buttons.push(btn(`${TYPE}:wc:${g}`, 'Bestätigen', ButtonStyle.Primary));
    const components = [];
    if (st.poison) {
      components.push(row(new StringSelectMenuBuilder().setCustomId(`${TYPE}:wp:${g}`).setPlaceholder('Gift einsetzen auf …').addOptions([
        { label: 'Kein Gift', value: 'none', default: !pend.poisonId },
        ...W.nightTargets(s, uid).map((p) => ({ label: p.name.slice(0, 100), value: p.id, default: pend.poisonId === p.id })),
      ])));
    }
    components.push(row(...buttons));
    return { content: lines.join('\n'), components };
  }

  // Privater Prompt für das, was `userId` gerade tun muss (null = nichts).
  function promptFor(game, userId) {
    const s = game.state;
    if (!s) return null;
    const g = game.guildId;
    const me = s.players.find((p) => p.id === userId);
    if (!me || !me.alive && s.phase !== PHASE.DEATH_TRIGGER) return null;
    const role = getRole(me.role);

    if (s.phase === PHASE.NIGHT && role.night && W.waitingFor(s).includes(userId)) {
      const kind = role.night.ui?.kind || 'target';
      if (kind === 'potions') return witchPrompt(game, userId);
      const current = s.nightState.data[role.id]?.[userId]?.targetId;
      const targets = W.nightTargets(s, userId);
      return {
        content: `${role.emoji} **${role.name}** – ${role.night.ui?.prompt || 'Wähle ein Ziel.'}${current ? `\nAktuell: **${nameOf(game, current)}**` : ''}`,
        components: [row(playerSelect(`${TYPE}:na:${g}`, 'Ziel wählen', targets))],
      };
    }
    if (s.phase === PHASE.DEATH_TRIGGER && s.pendingTriggerId === userId && role.deathTrigger) {
      return {
        content: `${role.emoji} **${role.name}** – ${role.deathTrigger.ui?.prompt || 'Wähle ein Ziel.'}`,
        components: [
          row(playerSelect(`${TYPE}:dt:${g}`, 'Ziel wählen', W.deathTargets(s, userId))),
          row(btn(`${TYPE}:dx:${g}`, 'Verzichten')),
        ],
      };
    }
    return null;
  }

  async function sendPrompt(game, userId) {
    const prompt = promptFor(game, userId);
    if (!prompt) return;
    if (!(await dm(userId, prompt))) {
      await say(game, {
        content: `⚠️ ${mention(userId)}, ich kann dir keine DM schicken (DMs für Server-Mitglieder erlauben!). Nutze stattdessen den Button.`,
        components: [row(btn(`${TYPE}:prompt:${game.guildId}`, '📬 Meine Aktion', ButtonStyle.Primary))],
        allowedMentions: { users: [userId] },
      });
    }
  }

  const phaseKey = (s) => `${s.night}:${s.day}:${s.phase}:${s.pendingTriggerId || ''}`;

  function secondsFor(game) {
    const s = game.state;
    const t = timers(game);
    switch (s.phase) {
      case PHASE.NIGHT: return t.night;
      case PHASE.DAY_DISCUSS: return t.discuss;
      case PHASE.DAY_VOTE: return t.vote;
      case PHASE.DEATH_TRIGGER: return TRIGGER_SECONDS;
      default: return null;
    }
  }

  // ---------- Spielstart ----------

  function roleText(game, userId) {
    const info = W.roleInfo(game.state, userId);
    const lines = [
      `Deine Rolle: ${info.emoji} **${info.name}** (${info.teamEmoji} ${info.teamName})`,
      info.description,
    ];
    if (info.teammates.length) lines.push(`Deine Teammitglieder: ${info.teammates.map((t) => `**${t.name}**`).join(', ')}`);
    lines.push('', '🤫 Zeig diese Nachricht niemandem.');
    return lines.join('\n');
  }

  async function createWolfThread(game) {
    const s = game.state;
    const wolves = s.players.filter((p) => getRole(p.role).team === W.TEAMS.WOLVES);
    try {
      const ch = await channelOf(game);
      const thread = await ch.threads.create({
        name: '🐺 Wolfsrudel',
        autoArchiveDuration: 1440,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: 'Werwolf: geheime Absprache',
      });
      for (const w of wolves) await thread.members.add(w.id);
      game.threadId = thread.id;
      await thread.send(`🐺 Willkommen im Rudel, ${wolves.map((w) => mention(w.id)).join(' ')}! Hier sprecht ihr euch nachts ab. Die Abstimmung selbst läuft über die Buttons in euren DMs.`);
    } catch (err) {
      game.threadId = null;
      quiet(`ℹ️ Werwolf: privater Thread nicht möglich (${err.code || err.message}) – Wölfe stimmen nur per DM ab.`);
      await say(game, '⚠️ Ich konnte keinen privaten Wolfs-Thread anlegen (Berechtigung „Private Threads erstellen“ fehlt). Die Wölfe stimmen nur per DM ab.');
    }
  }

  async function threadSay(game, text) {
    if (!game.threadId) return;
    const t = await client.channels.fetch(game.threadId).catch(() => null);
    await t?.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  }

  async function lockThread(game, locked) {
    if (!game.threadId) return;
    const t = await client.channels.fetch(game.threadId).catch(() => null);
    await t?.setLocked(locked).catch(() => {});
  }

  async function beginGame(game) {
    const state = W.createGame({
      code: game.code, hostId: game.hostId, players: game.lobby, options: engineOptions(game),
    });
    game.state = state;
    game.sent = {};
    game.pending = {};
    game.phaseKey = null;
    persist();

    const failed = [];
    for (const p of state.players) if (!(await dm(p.id, { content: roleText(game, p.id) }))) failed.push(p.id);
    const setup = describeSetup(state.players.length, state.options);
    await say(game, {
      content: [
        '🐺 **Das Spiel beginnt!** Rollen wurden per DM verschickt.',
        setup.text,
        failed.length ? `⚠️ DM fehlgeschlagen für ${failed.map(mention).join(', ')} – nutzt den Button „Meine Rolle“.` : '',
      ].filter(Boolean).join('\n'),
      components: failed.length ? [row(btn(`${TYPE}:role:${game.guildId}`, '🎴 Meine Rolle', ButtonStyle.Primary))] : [],
      allowedMentions: { users: failed },
    });
    await createWolfThread(game);
    await advance(game, [{ type: 'night_start', night: state.night }], null);
  }

  // ---------- Fortschritt nach jeder Aktion ----------

  const deathLine = (game, d) => {
    const role = d.role ? getRole(d.role) : null;
    const how = { wolves: 'wurde von den Wölfen gerissen', witch: 'wurde vergiftet', hunter: 'wurde erschossen', lynch: 'wurde gelyncht' }[d.cause] || 'ist gestorben';
    return `💀 **${nameOf(game, d.id)}** ${how}${role ? ` – ${role.emoji} ${role.name}` : ''}`;
  };

  async function announce(game, ev) {
    const s = game.state;
    switch (ev.type) {
      case 'night_start':
        await say(game, `🌙 **Nacht ${ev.night}.** Das Dorf schläft ein – alle sind stumm. Wölfe, Seherin & Co. bekommen ihre Aufgaben per DM.`);
        break;
      case 'night_action':
        if (ev.roleId === 'werewolf') await threadSay(game, `🐺 **${nameOf(game, ev.userId)}** stimmt für **${ev.data.targetId ? nameOf(game, ev.data.targetId) : 'niemanden'}**.`);
        break;
      case 'wolves_decided':
        await threadSay(game, `🐺 Das Rudel hat entschieden: **${ev.victimId ? nameOf(game, ev.victimId) : 'niemand'}**.`);
        break;
      case 'seer_result':
        await deliverPrivate(ev.to, `🔮 **${nameOf(game, ev.targetId)}** ist ${ev.isWolf ? '🐺 **ein Werwolf**' : '🧑‍🌾 **kein Werwolf**'}.`, null);
        break;
      case 'dawn':
        await say(game, ev.deaths.length
          ? `🌅 **Der Morgen graut.**\n${ev.deaths.map((d) => deathLine(game, d)).join('\n')}`
          : '🌅 **Der Morgen graut.** Diese Nacht ist niemand gestorben.');
        break;
      case 'day_start':
        await say(game, {
          content: `☀️ **Tag ${ev.day}.** Diskutiert im Sprachkanal! Diskussion endet ${deadlineText(s)}.`,
          components: [row(btn(`${TYPE}:sv:${game.guildId}`, 'Abstimmung jetzt starten (Host)', ButtonStyle.Primary))],
        });
        break;
      case 'vote_start': {
        const msg = await say(game, {
          content: `🗳️ **Abstimmung** – wen lyncht das Dorf? Endet ${deadlineText(s)}.\n⏳ Fehlt noch: ${pendingNames(game)}`,
          components: [row(btn(`${TYPE}:vb:${game.guildId}`, '🗳️ Abstimmen', ButtonStyle.Primary))],
        });
        game.voteMsgId = msg?.id || null;
        break;
      }
      case 'vote_result': {
        const lines = s.players.filter((p) => p.id in ev.votes)
          .map((p) => `${p.name} → ${ev.votes[p.id] ? nameOf(game, ev.votes[p.id]) : 'Enthaltung'}`);
        const verdict = ev.lynchedId
          ? `⚖️ **${nameOf(game, ev.lynchedId)}** wird gelyncht${ev.role ? ` – ${getRole(ev.role).emoji} ${getRole(ev.role).name}` : ''}.`
          : (ev.tie ? '⚖️ Gleichstand – niemand wird gelyncht.' : '⚖️ Keine Mehrheit – niemand wird gelyncht.');
        await editVoteMessage(game, `🗳️ **Abstimmung beendet**\n${lines.join('\n')}\n${verdict}`);
        break;
      }
      case 'death_trigger':
        await say(game, ev.kills.length
          ? `${getRole(ev.roleId).emoji} **${nameOf(game, ev.playerId)}** nimmt jemanden mit:\n${ev.kills.map((d) => deathLine(game, d)).join('\n')}`
          : `${getRole(ev.roleId).emoji} **${nameOf(game, ev.playerId)}** verzichtet.`);
        break;
      case 'game_over': {
        const lines = s.players.map((p) => {
          const r = getRole(p.role);
          const won = ev.playerIds ? ev.playerIds.includes(p.id) : null;
          return `${r.emoji} ${r.name} – ${p.name}${p.alive ? '' : ' ☠️'}${won ? ' 🏆' : ''}`;
        });
        const teamName = { village: 'Das Dorf', wolves: 'Die Werwölfe', neutral: 'Eine neutrale Rolle' }[ev.winner] || ev.winner;
        await say(game, { content: `🏁 **${teamName} gewinnt!** ${ev.reason}.\n\n${lines.join('\n')}`, allowedMentions: { parse: [] } });
        break;
      }
      default: break;
    }
  }

  const deadlineText = (s) => (s.deadline ? `<t:${Math.floor(s.deadline / 1000)}:R>` : 'offen');
  const pendingNames = (game) => W.waitingFor(game.state).map((id) => nameOf(game, id)).join(', ') || '–';

  async function editVoteMessage(game, content) {
    const ch = await channelOf(game);
    const msg = game.voteMsgId && await ch?.messages.fetch(game.voteMsgId).catch(() => null);
    if (msg) await msg.edit({ content, components: [], allowedMentions: { parse: [] } }).catch(() => {});
    else await say(game, { content, allowedMentions: { parse: [] } });
    game.voteMsgId = null;
  }

  async function updateVoteMessage(game) {
    if (!game.voteMsgId) return;
    const ch = await channelOf(game);
    const msg = await ch?.messages.fetch(game.voteMsgId).catch(() => null);
    if (!msg) return;
    const head = msg.content.split('\n')[0];
    await msg.edit({ content: `${head}\n⏳ Fehlt noch: ${pendingNames(game)}`, allowedMentions: { parse: [] } }).catch(() => {});
  }

  async function applyVoice(game) {
    const s = game.state;
    for (const p of s.players) {
      const mute = !p.alive || s.phase === PHASE.NIGHT;
      if (mute !== (game.muted?.[p.id] || false)) {
        (game.muted ||= {})[p.id] = mute;
        await setMute(game, p.id, mute);
      }
    }
  }

  async function finishGame(game) {
    const s = game.state;
    for (const p of s.players) await setMute(game, p.id, false);
    if (game.threadId) {
      const t = await client.channels.fetch(game.threadId).catch(() => null);
      await t?.setLocked(false).catch(() => {});
      await t?.setArchived(true).catch(() => {});
    }
    sessions.remove(game.guildId);
    persist();
  }

  // Events verarbeiten, Phasenwechsel (Frist, Voice, Thread), dann Prompts verschicken.
  async function advance(game, events) {
    const s = game.state;
    // Frist für neue Phase setzen, bevor angesagt wird (Countdown steht in der Ansage).
    const key = phaseKey(s);
    const phaseChanged = key !== game.phaseKey;
    if (phaseChanged && s.phase !== PHASE.GAME_OVER) {
      const secs = secondsFor(game);
      s.deadline = secs ? Date.now() + secs * 1000 : null;
    }
    for (const ev of events) {
      if (ev.type === 'vote_cast') continue;
      await announce(game, ev);
    }
    if (events.length === 1 && events[0].type === 'vote_cast') await updateVoteMessage(game);

    if (s.phase === PHASE.GAME_OVER) { await finishGame(game); return; }

    if (phaseChanged) {
      game.phaseKey = key;
      game.sent = {};
      game.pending = {};
      await applyVoice(game);
      if (s.phase === PHASE.NIGHT) await lockThread(game, false);
      else if (s.phase === PHASE.DAY_DISCUSS) await lockThread(game, true);
    }
    persist();
    if (s.phase !== PHASE.DAY_VOTE && s.phase !== PHASE.DAY_DISCUSS) {
      for (const id of new Set(W.waitingFor(s))) {
        if (game.sent[id]) continue;
        game.sent[id] = true;
        await sendPrompt(game, id);
      }
      persist();
    }
  }

  // Timer: abgelaufene Fristen erzwingen den Weiterlauf.
  async function tick() {
    const now = Date.now();
    for (const game of sessions.restore(TYPE)) {
      const s = game.state;
      if (!s || s.phase === PHASE.GAME_OVER || !s.deadline || now < s.deadline) continue;
      await withLock(game.guildId, async () => {
        if (sessions.get(game.guildId) !== game || !s.deadline || Date.now() < s.deadline) return;
        try {
          const events = W.forceAdvance(s);
          await advance(game, events);
        } catch (err) {
          logger.error('❌ Werwolf: Timer-Fehler:', err);
        }
      });
    }
  }

  // ---------- Interaktionen ----------

  function statusText(game) {
    const s = game.state;
    if (!s) return `Lobby mit ${game.lobby.length} Spieler(n).`;
    const alive = s.players.filter((p) => p.alive);
    const waiting = W.waitingFor(s).map(mention).join(', ');
    return [
      `Phase: **${s.phase}** · Nacht ${s.night} · Tag ${s.day}`,
      `Lebende (${alive.length}): ${alive.map((p) => p.name).join(', ')}`,
      s.deadline ? `⏱️ Frist: <t:${Math.floor(s.deadline / 1000)}:R>` : '',
      waiting ? `Wartet auf: ${waiting}` : '',
    ].filter(Boolean).join('\n');
  }

  async function handleCommand(interaction) {
    const sub = interaction.options.getSubcommand();
    const gid = interaction.guildId;
    if (!gid) return interaction.reply({ content: '❌ Nur auf einem Server nutzbar.', flags: EPHEMERAL });
    const game = sessions.get(gid);
    if (game && game.type !== TYPE && sub !== 'regeln') {
      return interaction.reply({ content: '❌ Auf diesem Server läuft bereits ein anderes Spiel.', flags: EPHEMERAL });
    }

    if (sub === 'regeln') {
      const { TEAM_INFO } = require('../games/werewolf/teams');
      const { allRoles } = require('../games/werewolf/roles');
      const byTeam = ['village', 'wolves', 'neutral'].map((t) => {
        const rs = allRoles().filter((r) => r.team === t);
        return rs.length ? `${TEAM_INFO[t].emoji} **${TEAM_INFO[t].name}**\n${rs.map((r) => `${r.emoji} **${r.name}** – ${r.description || ''}`).join('\n')}` : '';
      }).filter(Boolean);
      return interaction.reply({
        flags: EPHEMERAL,
        content: [
          '**Werwolf** (5–16 Spieler): Nachts erwachen Wölfe und Spezialrollen (per DM), tagsüber diskutiert das Dorf im Sprachkanal und lyncht per Abstimmung. Das Dorf gewinnt, wenn alle Wölfe tot sind; die Wölfe, wenn sie mindestens so viele sind wie alle anderen.',
          byTeam.join('\n\n'),
        ].join('\n\n').slice(0, 1990),
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
      if (game.state) await finishGame(game); else { sessions.remove(gid); persist(); }
      return interaction.reply('🛑 Werwolf wurde abgebrochen.');
    }
    // start
    if (game) return interaction.reply({ content: '❌ Auf diesem Server läuft bereits ein Spiel (`/ww status`).', flags: EPHEMERAL });
    await interaction.deferReply({ flags: EPHEMERAL });
    const { lobby, fromVoice } = collectLobby(interaction, LIMITS.max);
    const g = {
      type: TYPE, guildId: gid, channelId: interaction.channelId, hostId: interaction.user.id,
      code: crypto.randomBytes(6).toString('hex'), lobby, state: null, options: defaultOptions(),
      lobbyMsgId: null, voteMsgId: null, threadId: null, phaseKey: null, sent: {}, pending: {}, muted: {},
    };
    sessions.set(gid, g);
    const msg = await say(g, lobbyPayload(g));
    g.lobbyMsgId = msg?.id || null;
    persist();
    await interaction.editReply(fromVoice
      ? `✅ Lobby geöffnet, ${lobby.length} Spieler aus deinem Sprachkanal übernommen. Über „⚙️ Optionen“ stellst du Rollen und Zeiten ein.`
      : '✅ Lobby geöffnet. Tipp: Starte aus einem Sprachkanal, dann werden alle dort übernommen.');
  }

  async function handleComponent(interaction) {
    const [, action, gidFromId, arg] = interaction.customId.split(':');
    const gid = interaction.guildId || gidFromId;
    const game = sessions.get(gid);
    const reply = (content) => interaction.reply({ content, flags: EPHEMERAL }).catch(() => {});
    if (!game || game.type !== TYPE) return reply('❌ Dieses Spiel läuft nicht mehr.');
    const uid = interaction.user.id;

    // --- Lobby ---
    if (['join', 'leave', 'begin'].includes(action)) {
      if (game.state) return reply('❌ Das Spiel läuft bereits.');
      const res = applyLobbyAction(game, action, interaction, LIMITS);
      if (res.error) return reply(res.error);
      if (res.closed) {
        sessions.remove(gid); persist();
        return interaction.update({ content: 'Lobby geschlossen.', embeds: [], components: [] });
      }
      if (res.begin) {
        const setup = setupFor(game);
        if (setup.errors.length) return reply(`❌ ${setup.errors.join(' ')}`);
        await interaction.update({ content: '🐺 Spiel gestartet.', embeds: [], components: [] }).catch(() => {});
        return withLock(gid, () => beginGame(game));
      }
      await interaction.deferUpdate().catch(() => {});
      return updateLobby(game);
    }
    if (action === 'opt') {
      if (uid !== game.hostId) return reply('❌ Nur der Host kann die Optionen ändern.');
      return interaction.reply(optionsPanel(game));
    }
    if (['or', 'ow', 'op', 'ot', 'oz'].includes(action)) return handleOption(interaction, game, action);

    // --- Fallback-Buttons ---
    const s = game.state;
    if (!s) return reply('❌ Das Spiel hat noch nicht begonnen.');
    if (action === 'role') {
      if (!s.players.some((p) => p.id === uid)) return reply('❌ Du spielst nicht mit.');
      return reply(roleText(game, uid));
    }
    if (action === 'prompt') {
      const prompt = promptFor(game, uid);
      if (!prompt) return reply('Du musst gerade nichts tun.');
      return interaction.reply({ ...prompt, flags: EPHEMERAL });
    }

    // --- Spielaktionen (seriell) ---
    return withLock(gid, async () => {
      let events;
      let done;
      try {
        switch (action) {
          case 'na': {
            const role = getRole(s.players.find((p) => p.id === uid)?.role || 'villager');
            events = W.nightAction(s, uid, { targetId: interaction.values[0] });
            done = `✅ Gewählt: **${nameOf(game, interaction.values[0])}**.`;
            if (role.night?.revisable) { // Rudel darf bis zum Ende ändern: Menü bleibt
              await interaction.update({ content: `${done} Du kannst bis zur Entscheidung des Rudels neu wählen.` }).catch(() => {});
              return advance(game, events);
            }
            break;
          }
          case 'wh': case 'wp': {
            const pend = (game.pending[uid] ||= { heal: false, poisonId: null });
            if (!W.waitingFor(s).includes(uid)) return reply('❌ Du bist gerade nicht dran.');
            if (action === 'wh') pend.heal = !pend.heal;
            else pend.poisonId = interaction.values[0] === 'none' ? null : interaction.values[0];
            return interaction.update(witchPrompt(game, uid)).catch(() => {});
          }
          case 'wc': {
            const pend = game.pending[uid] || { heal: false, poisonId: null };
            events = W.nightAction(s, uid, { heal: pend.heal, poisonId: pend.poisonId });
            delete game.pending[uid];
            done = '✅ Entscheidung gespeichert.';
            break;
          }
          case 'vb': {
            const me = s.players.find((p) => p.id === uid);
            if (s.phase !== PHASE.DAY_VOTE) return reply('❌ Gerade wird nicht abgestimmt.');
            if (!me || !me.alive) return reply('❌ Du darfst nicht abstimmen.');
            return interaction.reply({
              content: '🗳️ Wen soll das Dorf lynchen? Du kannst bis zum Ende neu wählen.',
              components: [row(new StringSelectMenuBuilder().setCustomId(`${TYPE}:v:${gid}`).setPlaceholder('Spieler wählen').addOptions([
                { label: 'Enthaltung', value: 'none' },
                ...s.players.filter((p) => p.alive && p.id !== uid).map((p) => ({ label: p.name.slice(0, 100), value: p.id })),
              ]))],
              flags: EPHEMERAL,
            });
          }
          case 'v': {
            const v = interaction.values[0];
            events = W.vote(s, uid, v === 'none' ? null : v);
            await interaction.update({ content: `🗳️ Deine Stimme: **${v === 'none' ? 'Enthaltung' : nameOf(game, v)}**. Du kannst sie bis zum Ende ändern.` }).catch(() => {});
            return advance(game, events);
          }
          case 'sv': {
            const allowed = uid === game.hostId || interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
            if (!allowed) return reply('❌ Nur der Host kann die Abstimmung vorzeitig starten.');
            events = W.startVote(s);
            await interaction.update({ components: [] }).catch(() => {});
            return advance(game, events);
          }
          case 'dt': case 'dx':
            events = W.deathAction(s, uid, action === 'dt' ? interaction.values[0] : null);
            done = '✅ Erledigt.';
            break;
          default: return reply('❌ Unbekannte Aktion.');
        }
      } catch (err) {
        return reply(`❌ ${err.message}`);
      }
      await interaction.update({ content: done, components: [] }).catch(() => {});
      return advance(game, events);
    });
  }

  // ---------- Setup ----------

  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'ww') await handleCommand(interaction);
      else if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(`${TYPE}:`)) {
        await handleComponent(interaction);
      }
    } catch (err) {
      logger.error('❌ Fehler im Werwolf-Modus:', err);
      const msg = { content: '❌ Interner Fehler im Werwolf-Modus.', flags: EPHEMERAL };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
  });

  // Laufende Spiele nach Neustart wiederherstellen; Timer laufen mit persistierter Frist weiter.
  let restored = 0;
  for (const g of sessions.restore(TYPE)) {
    if (g.state?.phase === PHASE.GAME_OVER) { sessions.remove(g.guildId); continue; }
    g.options ||= defaultOptions();
    g.sent ||= {}; g.pending ||= {}; g.muted ||= {};
    restored += 1;
  }
  if (restored) quiet(`🐺 Werwolf: ${restored} Spiel(e) wiederhergestellt.`);
  setInterval(() => tick().catch((err) => logger.error('❌ Werwolf: Tick-Fehler:', err)), TICK_MS).unref();
};

module.exports.command = command;
