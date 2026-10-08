// Vorschau/Validierung der Rollenverteilung für die Lobby (rein, ohne Discord).
const E = require('./engine');
const { getRole, allRoles } = require('./roles');
const { TEAMS, TEAM_INFO } = require('./teams');

function describeSetup(n, options = {}) {
  const raw = E.rawRoles(n, options);
  const roles = E.rolesFor(n, options);
  const counts = {};
  for (const id of roles) counts[id] = (counts[id] || 0) + 1;

  const groups = [TEAMS.VILLAGE, TEAMS.WOLVES, TEAMS.NEUTRAL].map((team) => ({
    team,
    name: TEAM_INFO[team].name,
    emoji: TEAM_INFO[team].emoji,
    roles: allRoles().filter((r) => r.team === team && counts[r.id])
      .map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, count: counts[r.id] })),
  })).filter((g) => g.roles.length);

  const wolves = roles.filter((id) => getRole(id).team === TEAMS.WOLVES).length;
  const errors = [];
  const warnings = [];
  if (n < E.MIN_PLAYERS) errors.push(`Mindestens ${E.MIN_PLAYERS} Spieler nötig.`);
  if (n > E.MAX_PLAYERS) errors.push(`Höchstens ${E.MAX_PLAYERS} Spieler.`);
  if (wolves === 0) errors.push('Es gibt keinen Werwolf.');
  else if (wolves * 2 >= n) errors.push('Zu viele Werwölfe – sie hätten sofort die Mehrheit.');
  if (raw.length > n) warnings.push(`${raw.length - n} Rolle(n) passen nicht ins Spiel und entfallen (die mit der höchsten Sortierung zuerst).`);

  const text = groups
    .map((g) => `${g.emoji} **${g.name}:** ${g.roles.map((r) => `${r.emoji} ${r.name}${r.count > 1 ? ` ×${r.count}` : ''}`).join(', ')}`)
    .join('\n');
  return { counts, groups, errors, warnings, text };
}

// Rollen, die der Host im Optionen-Menü an-/abwählen kann (ohne Füllrolle und Rollen mit eigener Zahl, z. B. Werwolf).
function selectableRoles() {
  return allRoles().filter((r) => !r.fill && !r.ownCountOption);
}

module.exports = { describeSetup, selectableRoles };
