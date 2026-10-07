const { TEAMS, roleOf } = require('../../teams');

module.exports = {
  id: 'seer',
  name: 'Seherin',
  emoji: '🔮',
  team: TEAMS.VILLAGE,
  description: 'Jede Nacht darfst du erfahren, ob ein Spieler ein Werwolf ist.',
  order: 20,
  defaultCount: () => 1,
  night: {
    ui: { kind: 'target', prompt: 'Wen möchtest du ansehen?' },
    targets: (s, actor) => s.players.filter((p) => p.alive && p.id !== actor.id),
    normalize(s, actor, input) {
      if (!this.targets(s, actor).some((p) => p.id === input.targetId)) throw new Error('Ungültiges Ziel.');
      return { targetId: input.targetId };
    },
    onSubmit(s, actor, data, events) {
      const target = s.players.find((p) => p.id === data.targetId);
      events.push({ type: 'seer_result', to: actor.id, targetId: target.id, isWolf: roleOf(target.role).seenAs === 'wolf' });
    },
  },
};
