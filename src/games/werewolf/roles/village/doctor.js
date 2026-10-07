const { TEAMS } = require('../../teams');

module.exports = {
  id: 'doctor',
  name: 'Doktor',
  emoji: '⚕️',
  team: TEAMS.VILLAGE,
  description: 'Jede Nacht schützt du einen Spieler vor dem Wolfsangriff – nie zwei Nächte hintereinander denselben.',
  order: 30,
  defaultCount: (n) => (n >= 6 ? 1 : 0),
  initState: () => ({ lastProtectedId: null }),
  night: {
    ui: { kind: 'target', prompt: 'Wen schützt du heute Nacht?' },
    resolveOrder: 10,
    targets: (s) => s.players.filter((p) => p.alive && p.id !== s.roleState.doctor.lastProtectedId),
    normalize(s, actor, input) {
      if (!this.targets(s).some((p) => p.id === input.targetId)) throw new Error('Dieser Spieler darf nicht geschützt werden.');
      return { targetId: input.targetId };
    },
    resolve(s, ns, ctx) {
      const picks = Object.values(ns.data.doctor || {});
      s.roleState.doctor.lastProtectedId = picks[0]?.targetId ?? null;
      for (const d of picks) if (d.targetId) ctx.protected.add(d.targetId);
    },
  },
};
