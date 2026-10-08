const { TEAMS } = require('../../teams');

// Gehört zum Wolfsrudel (gemeinsame Abstimmung über die Gruppe "werewolf"), Stimme zählt doppelt.
module.exports = {
  id: 'alphawolf',
  name: 'Alphawolf',
  emoji: '🐺👑',
  team: TEAMS.WOLVES,
  description: 'Du führst das Rudel: Deine Stimme bei der Opferwahl zählt doppelt. Tagsüber gibst du dich als Dorfbewohner aus.',
  order: 11,
  seenAs: 'wolf',
  knowsTeam: true,
  packWeight: 2,
  replaces: 'werewolf', // ersetzt einen normalen Werwolf in der Zusammenstellung
  defaultCount: (n) => (n >= 9 ? 1 : 0),
  night: { group: 'werewolf' }, // Regeln/Hooks (Ziele, Abstimmung, Auflösung) kommen vom Werwolf
};
