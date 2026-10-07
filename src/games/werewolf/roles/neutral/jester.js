const { TEAMS } = require('../../teams');

// Neutrale Rolle: gewinnt allein, wenn das Dorf sie am Tag lyncht. Standardmäßig AUS (nur per options.roles { jester: 1 }).
module.exports = {
  id: 'jester',
  name: 'Narr',
  emoji: '🃏',
  team: TEAMS.NEUTRAL,
  description: 'Du gewinnst allein, wenn das Dorf dich am Tag lyncht. Wirke verdächtig – aber nicht zu offensichtlich.',
  order: 60,
  defaultCount: () => 0,
  onDeath: (s, player, cause) => (cause === 'lynch'
    ? { winner: TEAMS.NEUTRAL, reason: `Der Narr (${player.name}) wurde gelyncht`, playerIds: [player.id] }
    : null),
};
