const { TEAMS, roleOf } = require('../../teams');

// Neutral: bekommt zu Spielbeginn ein zufälliges Dorf-Ziel und gewinnt allein, wenn das Dorf
// dieses Ziel am Tag lyncht. Stirbt das Ziel anders, wird er zum Dorfbewohner. Standardmäßig aus.
module.exports = {
  id: 'lyncher',
  name: 'Lyncher',
  emoji: '🪢',
  team: TEAMS.NEUTRAL,
  description: 'Du hast ein geheimes Ziel im Dorf. Du gewinnst allein, wenn das Dorf dein Ziel am Tag lyncht. Stirbt dein Ziel anders, wirst du zum Dorfbewohner.',
  order: 65,
  defaultCount: () => 0,
  initState(s, rng = Math.random) {
    const pool = s.players.filter((p) => roleOf(p.role).team === TEAMS.VILLAGE);
    const targets = {};
    for (const l of s.players.filter((p) => p.role === 'lyncher')) {
      if (pool.length) targets[l.id] = pool[Math.floor(rng() * pool.length)].id;
    }
    return { targets };
  },
  extraInfo(s, me) {
    const t = s.roleState.lyncher?.targets?.[me.id];
    const target = t && s.players.find((p) => p.id === t);
    return target ? [`🎯 Dein Ziel: **${target.name}** – sorge dafür, dass das Dorf ihn lyncht.`] : [];
  },
  onPlayerDeath(s, dead, cause) {
    const out = { convert: [] };
    for (const [lyncherId, targetId] of Object.entries(s.roleState.lyncher?.targets || {})) {
      if (targetId !== dead.id) continue;
      const lyncher = s.players.find((p) => p.id === lyncherId);
      if (!lyncher || !lyncher.alive || lyncher.role !== 'lyncher') continue;
      if (cause === 'lynch') {
        out.win = { winner: TEAMS.NEUTRAL, reason: `Der Lyncher (${lyncher.name}) hat sein Ziel gelyncht`, playerIds: [lyncherId] };
      } else {
        out.convert.push({ id: lyncherId, roleId: 'villager' });
      }
    }
    return out.win || out.convert.length ? out : null;
  },
};
