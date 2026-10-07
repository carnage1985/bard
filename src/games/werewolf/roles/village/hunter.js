const { TEAMS } = require('../../teams');

module.exports = {
  id: 'hunter',
  name: 'Jäger',
  emoji: '🏹',
  team: TEAMS.VILLAGE,
  description: 'Stirbst du – egal wie –, darfst du mit deinem letzten Schuss einen Spieler mitnehmen.',
  order: 50,
  defaultCount: (n) => (n >= 7 ? 1 : 0),
  deathTrigger: {
    ui: { prompt: 'Wen nimmst du mit in den Tod?', optional: true },
    targets: (s) => s.players.filter((p) => p.alive),
    resolve: (s, actor, targetId) => (targetId ? [{ id: targetId, cause: 'hunter' }] : []),
  },
};
