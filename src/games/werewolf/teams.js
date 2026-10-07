// Teams + kleine Helfer (eigene Datei, damit Rollen-Dateien sie ohne Zirkelbezug importieren können).
const TEAMS = { VILLAGE: 'village', WOLVES: 'wolves', NEUTRAL: 'neutral' };

// Die drei Seiten (Anzeige in DMs, Board und Rollenübersicht).
const TEAM_INFO = {
  village: { name: 'Dorf', emoji: '🏘️' },
  wolves: { name: 'Werwölfe', emoji: '🐺' },
  neutral: { name: 'Neutral', emoji: '⚖️' },
};

// Registry wird erst beim Aufruf geladen (Rollen-Dateien werden von der Registry selbst geladen).
const roleOf = (id) => require('./roles').getRole(id);
const teamOf = (player) => roleOf(player.role).team;

module.exports = { TEAMS, TEAM_INFO, roleOf, teamOf };
