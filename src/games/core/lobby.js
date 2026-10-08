// Gemeinsame Lobby: Host automatisch dabei, Beitreten/Verlassen/Starten.
const { EmbedBuilder, ButtonStyle } = require('discord.js');
const { row, btn } = require('./messenger');

// Nur der Host ist automatisch dabei; alle anderen treten per „Beitreten“-Button bei.
function collectLobby(interaction) {
  return { lobby: [{ id: interaction.user.id, name: interaction.member?.displayName || interaction.user.username }] };
}

// `prefix` = customId-Präfix des Spiels (z. B. "sh"), Buttons: <prefix>:join|leave|begin
function lobbyPayload(game, { prefix, title, min, max, link, hint, extraButtons = [] }) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription([
      `Spieler (${game.lobby.length}/${max}, min. ${min}):`,
      game.lobby.map((p) => `• <@${p.id}>`).join('\n') || '–',
      '',
      `Host: <@${game.hostId}>`,
      link ? `📋 Spielplan: ${link}` : '',
      hint || '',
    ].filter((l) => l !== '').join('\n'));
  return {
    embeds: [embed],
    components: [row(
      btn(`${prefix}:join`, 'Beitreten', ButtonStyle.Success),
      btn(`${prefix}:leave`, 'Verlassen'),
      btn(`${prefix}:begin`, 'Spiel starten', ButtonStyle.Primary),
      ...extraButtons,
    )],
    allowedMentions: { parse: [] },
  };
}

// Wendet join/leave/begin auf game.lobby an.
// Rückgabe: { error } | { closed: true } | { begin: true } | { updated: true }
function applyLobbyAction(game, action, interaction, { min, max }) {
  const uid = interaction.user.id;
  if (action === 'join') {
    if (game.lobby.some((p) => p.id === uid)) return { error: 'Du bist schon dabei.' };
    if (game.lobby.length >= max) return { error: '❌ Die Lobby ist voll.' };
    game.lobby.push({ id: uid, name: interaction.member?.displayName || interaction.user.username });
    return { updated: true };
  }
  if (action === 'leave') {
    game.lobby = game.lobby.filter((p) => p.id !== uid);
    if (!game.lobby.length) return { closed: true };
    if (uid === game.hostId) game.hostId = game.lobby[0].id;
    return { updated: true };
  }
  if (uid !== game.hostId) return { error: '❌ Nur der Host kann starten.' };
  if (game.lobby.length < min) return { error: `❌ Mindestens ${min} Spieler nötig.` };
  return { begin: true };
}

module.exports = { collectLobby, lobbyPayload, applyLobbyAction };
