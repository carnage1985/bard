const { TEAMS, teamOf } = require('../../teams');

// Neutrale Fraktion: Vampire beißen nachts gemeinsam ein Opfer (Rudelabstimmung), Gebissene werden
// zu Vampiren. Wölfe sind immun, Schutz (Doktor/Heiltrank) verhindert den Biss. Standardmäßig aus.
module.exports = {
  id: 'vampire',
  name: 'Vampir',
  emoji: '🧛',
  team: TEAMS.NEUTRAL,
  description: 'Du beißt nachts gemeinsam mit den anderen Vampiren ein Opfer – Gebissene werden zu Vampiren. Ihr gewinnt, wenn ihr mindestens so viele seid wie alle anderen zusammen. Das Dorf muss euch alle besiegen.',
  order: 70,
  hostile: true, // das Dorf gewinnt erst, wenn auch keine Vampire mehr leben
  defaultCount: () => 0,
  allies: (s, me) => s.players.filter((p) => p.role === 'vampire' && p.id !== me.id),
  night: {
    revisable: true,
    ui: { kind: 'target', prompt: 'Wen beißt ihr heute Nacht?' },
    resolveOrder: 25, // nach Schutz (10), Heilung (15) und Wolfsangriff (20)
    targets: (s) => s.players.filter((p) => p.alive && p.role !== 'vampire'),
    normalize(s, actor, input) {
      if (input.targetId === null) return { targetId: null };
      if (!this.targets(s).some((p) => p.id === input.targetId)) throw new Error('Ungültiges Ziel.');
      return { targetId: input.targetId };
    },
    onDone(s, ns, events, rng) {
      const tally = {};
      for (const d of Object.values(ns.data.vampire || {})) if (d.targetId) tally[d.targetId] = (tally[d.targetId] || 0) + 1;
      const max = Math.max(0, ...Object.values(tally));
      const top = Object.keys(tally).filter((id) => tally[id] === max);
      ns.shared.biteId = max ? top[top.length === 1 ? 0 : Math.floor(rng() * top.length)] : null;
    },
    resolve(s, ns, ctx) {
      const id = ns.shared.biteId;
      const target = id && s.players.find((p) => p.id === id);
      if (!target || !target.alive || ctx.protected.has(id)) return;
      if (teamOf(target) === TEAMS.WOLVES) return; // Wölfe sind immun (wirkungslos, niemand erfährt es)
      ctx.conversions.push({ id, roleId: 'vampire' });
    },
  },
  checkWin(s) {
    const a = s.players.filter((p) => p.alive);
    const vamps = a.filter((p) => p.role === 'vampire');
    if (vamps.length && vamps.length * 2 >= a.length) {
      return { winner: TEAMS.NEUTRAL, reason: 'Die Vampire beherrschen das Dorf', playerIds: vamps.map((p) => p.id) };
    }
    return null;
  },
};
