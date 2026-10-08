const { TEAMS } = require('../../teams');

module.exports = {
  id: 'mayor',
  name: 'Bürgermeister',
  emoji: '🎖️',
  team: TEAMS.VILLAGE,
  description: 'Deine Stimme bei der Lynch-Abstimmung zählt doppelt. Niemand weiß, dass du Bürgermeister bist – es sei denn, du verrätst es.',
  order: 45,
  defaultCount: (n) => (n >= 9 ? 1 : 0),
  voteWeight: () => 2,
};
