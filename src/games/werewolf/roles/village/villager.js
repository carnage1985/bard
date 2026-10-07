const { TEAMS } = require('../../teams');

module.exports = {
  id: 'villager',
  name: 'Dorfbewohner',
  emoji: '🧑‍🌾',
  team: TEAMS.VILLAGE,
  description: 'Du hast keine Spezialfähigkeit. Finde die Werwölfe und lynche sie am Tag.',
  order: 1000,
  fill: true, // füllt die restlichen Plätze auf
};
