const { TEAMS, roleOf, teamOf } = require('../../teams');

module.exports = {
  id: 'werewolf',
  name: 'Werwolf',
  emoji: '🐺',
  team: TEAMS.WOLVES,
  description: 'Du erwachst nachts mit dem Rudel und wählst ein Opfer. Tagsüber gibst du dich als Dorfbewohner aus.',
  order: 10,
  seenAs: 'wolf',
  knowsTeam: true,
  ownCountOption: true, // eigene Anzahl-Auswahl in den Lobby-Optionen
  defaultCount: (n) => Math.max(1, Math.round(n / 4)),
  night: {
    revisable: true, // Rudel kann sich bis zum Ende umentscheiden
    ui: { kind: 'target', prompt: 'Wen frisst das Rudel heute Nacht?' },
    resolveOrder: 20,
    targets: (s) => s.players.filter((p) => p.alive && teamOf(p) !== TEAMS.WOLVES),
    normalize(s, actor, input) {
      if (input.targetId === null) return { targetId: null }; // Enthaltung (nur Timeout)
      if (!this.targets(s).some((p) => p.id === input.targetId)) throw new Error('Ungültiges Ziel.');
      return { targetId: input.targetId };
    },
    onDone(s, ns, events, rng) {
      const tally = {};
      for (const [actorId, d] of Object.entries(ns.data.werewolf || {})) {
        if (!d.targetId) continue;
        const voter = s.players.find((p) => p.id === actorId);
        tally[d.targetId] = (tally[d.targetId] || 0) + (roleOf(voter.role).packWeight ?? 1); // z. B. Alphawolf ×2
      }
      const max = Math.max(0, ...Object.values(tally));
      const top = Object.keys(tally).filter((id) => tally[id] === max);
      ns.shared.victimId = max ? top[top.length === 1 ? 0 : Math.floor(rng() * top.length)] : null;
      events.push({
        type: 'wolves_decided', victimId: ns.shared.victimId,
        wolfIds: s.players.filter((p) => p.alive && teamOf(p) === TEAMS.WOLVES).map((p) => p.id),
      });
    },
    resolve(s, ns, ctx) {
      if (ns.shared.victimId) ctx.attacks.push({ id: ns.shared.victimId, cause: 'wolves', blockable: true });
    },
  },
};
