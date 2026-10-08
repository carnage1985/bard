const { TEAMS } = require('../../teams');

// Paranoid: erschießt jeden, der sie nachts "besucht" (dessen Nachtaktion sie als Ziel hat).
// Angriffe auf sie scheitern (die Angreifer sind ja tot).
module.exports = {
  id: 'granny',
  name: 'Granny',
  emoji: '👵',
  team: TEAMS.VILLAGE,
  description: 'Du bist paranoid: Wer dich nachts besucht – Wolf, Seherin, Doktor, Hexe, Vampir –, wird von dir erschossen. Wölfe können dich nachts nicht töten.',
  order: 55,
  defaultCount: (n) => (n >= 10 ? 1 : 0),
  resolveOrder: 5, // vor allen anderen Auflösungen
  resolveNight(s, ns, ctx) {
    for (const granny of s.players.filter((p) => p.alive && p.role === 'granny')) {
      ctx.immune.add(granny.id);
      for (const v of ctx.visits) {
        if (v.targetId === granny.id && v.actorId !== granny.id) {
          ctx.attacks.push({ id: v.actorId, cause: 'granny', blockable: false });
        }
      }
    }
  },
};
