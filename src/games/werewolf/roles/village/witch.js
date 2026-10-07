const { TEAMS } = require('../../teams');

module.exports = {
  id: 'witch',
  name: 'Hexe',
  emoji: '🧙‍♀️',
  team: TEAMS.VILLAGE,
  description: 'Du hast einen Heiltrank und einen Gifttrank, jeden nur einmal im Spiel. Du siehst das Wolfsopfer.',
  order: 40,
  defaultCount: (n) => (n >= 8 ? 1 : 0),
  initState: () => ({ heal: true, poison: true }),
  night: {
    needs: ['werewolf'],
    ui: { kind: 'potions', prompt: 'Willst du einen Trank einsetzen?' },
    resolveOrder: 15,
    canAct: (s) => s.roleState.witch.heal || s.roleState.witch.poison,
    targets: (s, actor) => s.players.filter((p) => p.alive && p.id !== actor.id),
    normalize(s, actor, input = {}) {
      const st = s.roleState.witch;
      const data = { heal: false, poisonId: null };
      if (input.heal) {
        if (!st.heal) throw new Error('Der Heiltrank ist aufgebraucht.');
        throw_if(!s.nightState.shared.victimId, 'Es gibt kein Opfer zu heilen.');
        data.heal = true;
      }
      if (input.poisonId) {
        if (!st.poison) throw new Error('Der Gifttrank ist aufgebraucht.');
        throw_if(!this.targets(s, actor).some((p) => p.id === input.poisonId), 'Ungültiges Ziel.');
        data.poisonId = input.poisonId;
      }
      return data;
    },
    onOpen(s, ns, actors, events) {
      for (const w of actors) {
        events.push({
          type: 'witch_prompt', to: w.id, victimId: ns.shared.victimId,
          canHeal: s.roleState.witch.heal && !!ns.shared.victimId, canPoison: s.roleState.witch.poison,
        });
      }
    },
    resolve(s, ns, ctx) {
      for (const d of Object.values(ns.data.witch || {})) {
        if (d.heal) { ctx.protected.add(ns.shared.victimId); s.roleState.witch.heal = false; }
        if (d.poisonId) { ctx.attacks.push({ id: d.poisonId, cause: 'witch', blockable: false }); s.roleState.witch.poison = false; }
      }
    },
  },
};

function throw_if(cond, msg) {
  if (cond) throw new Error(msg);
}
