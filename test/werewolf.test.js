const test = require('node:test');
const assert = require('node:assert');
const W = require('../src/games/werewolf/engine');
const { registerRole, unregisterRole, allRoles } = require('../src/games/werewolf/roles');
const { PHASE, TEAMS } = W;

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mk = (n, rng = mulberry(3), options = {}) => W.createGame({
  code: 'x', hostId: 'p0', rng, options,
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
});

// Setzt Rollen deterministisch (Reihenfolge der Spieler).
function setup(roles, options) {
  const s = mk(roles.length, mulberry(1), options);
  roles.forEach((r, i) => { s.players[i].role = r; });
  return s;
}

const act = (s, id, input) => W.nightAction(s, id, input);
const target = (s, id, targetId) => W.nightAction(s, id, { targetId });

test('Rollen sind in drei Seiten eingeteilt (Dorf, Werwolf, Neutral)', () => {
  const teams = new Set(allRoles().map((r) => r.team));
  assert.deepStrictEqual([...teams].sort(), [TEAMS.NEUTRAL, TEAMS.VILLAGE, TEAMS.WOLVES].sort());
  assert.ok(W.rolesOfTeam(TEAMS.WOLVES).some((r) => r.id === 'werewolf'));
  assert.ok(W.rolesOfTeam(TEAMS.NEUTRAL).some((r) => r.id === 'jester'));
  assert.ok(W.rolesOfTeam(TEAMS.VILLAGE).some((r) => r.id === 'seer'));
});

test('Rollenzusammenstellung je Spielerzahl, Host-Override', () => {
  for (let n = W.MIN_PLAYERS; n <= W.MAX_PLAYERS; n++) {
    const roles = W.rolesFor(n);
    assert.strictEqual(roles.length, n);
    assert.ok(roles.includes('werewolf'));
    assert.ok(roles.includes('seer'));
    assert.strictEqual(mk(n).players.length, n);
  }
  assert.ok(!W.rolesFor(10, { roles: { witch: false } }).includes('witch'));
  assert.ok(W.rolesFor(10, { roles: { jester: 1 } }).includes('jester'));
  assert.ok(!W.rolesFor(10).includes('jester'));
  assert.throws(() => mk(4));
  assert.throws(() => mk(17));
});

test('Wölfe kennen sich, andere nicht', () => {
  const s = mk(9);
  const wolves = s.players.filter((p) => ['werewolf', 'alphawolf'].includes(p.role)).length;
  for (const p of s.players) {
    const info = W.roleInfo(s, p.id);
    const isWolfTeam = ['werewolf', 'alphawolf'].includes(p.role);
    assert.strictEqual(info.teammates.length, isWolfTeam ? wolves - 1 : 0);
    assert.ok(info.teamName && info.name);
  }
});

const night1 = () => setup(['werewolf', 'seer', 'doctor', 'witch', 'villager', 'villager', 'villager', 'villager']);

test('Wolfsopfer stirbt; Doktor-Schutz rettet; Heiltrank rettet', () => {
  let s = night1();
  target(s, 'p0', 'p4'); target(s, 'p1', 'p0'); target(s, 'p2', 'p5');
  const ev = act(s, 'p3', {});
  assert.strictEqual(s.phase, PHASE.DAY_DISCUSS);
  assert.ok(!s.players[4].alive);
  assert.deepStrictEqual(ev.find((e) => e.type === 'dawn').deaths.map((d) => d.id), ['p4']);

  s = night1();
  target(s, 'p0', 'p4'); target(s, 'p1', 'p0'); target(s, 'p2', 'p4'); act(s, 'p3', {});
  assert.ok(s.players[4].alive, 'Doktor schützt');

  s = night1();
  target(s, 'p0', 'p4'); target(s, 'p1', 'p0'); target(s, 'p2', 'p5'); act(s, 'p3', { heal: true });
  assert.ok(s.players[4].alive, 'Hexe heilt');
  assert.strictEqual(s.roleState.witch.heal, false);
});

test('Seher sieht Werwolf-Status, Hexe erst nach den Wölfen', () => {
  const s = setup(['werewolf', 'seer', 'witch', 'villager', 'villager']);
  assert.throws(() => act(s, 'p2', {}), /noch nicht dran/);
  const ev = target(s, 'p1', 'p0');
  assert.strictEqual(ev.find((e) => e.type === 'seer_result').isWolf, true);
  assert.throws(() => target(s, 'p1', 'p3'), /schon entschieden/);
});

test('Hexe: Gift tötet, Trank nur einmal; Prompt kommt nach der Wolfswahl', () => {
  const s = setup(['werewolf', 'seer', 'witch', 'villager', 'villager', 'villager']);
  const ev = target(s, 'p0', 'p3');
  const prompt = ev.find((e) => e.type === 'witch_prompt');
  assert.strictEqual(prompt.to, 'p2');
  assert.strictEqual(prompt.victimId, 'p3');
  target(s, 'p1', 'p3');
  act(s, 'p2', { poisonId: 'p4' });
  assert.ok(!s.players[3].alive && !s.players[4].alive);
  assert.strictEqual(s.roleState.witch.poison, false);
});

test('Doktor-Sperre in Folgenacht', () => {
  const s = setup(['werewolf', 'seer', 'doctor', 'villager', 'villager', 'villager', 'villager']);
  target(s, 'p0', 'p5'); target(s, 'p1', 'p0'); target(s, 'p2', 'p3');
  W.startVote(s);
  for (const p of s.players.filter((x) => x.alive)) W.vote(s, p.id, null);
  assert.strictEqual(s.phase, PHASE.NIGHT);
  assert.throws(() => target(s, 'p2', 'p3'));
  target(s, 'p2', 'p2');
});

test('Rudel: Umentscheiden erlaubt, Gleichstand entscheidet der Zufall', () => {
  const s = setup(['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager']);
  target(s, 'p0', 'p3');
  target(s, 'p0', 'p4'); // umentschieden
  const ev = target(s, 'p1', 'p5');
  const dec = ev.find((e) => e.type === 'wolves_decided');
  assert.ok(['p4', 'p5'].includes(dec.victimId));
});

test('Abstimmung: Mehrheit lyncht, Gleichstand niemand', () => {
  let s = setup(['werewolf', 'seer', 'villager', 'villager', 'villager', 'villager', 'villager']);
  W.forceAdvance(s);
  assert.strictEqual(s.phase, PHASE.DAY_DISCUSS);
  assert.ok(s.players.every((p) => p.alive));
  W.startVote(s);
  for (const p of s.players) W.vote(s, p.id, p.id === 'p2' ? 'p3' : 'p2');
  assert.strictEqual(s.players[2].deathCause, 'lynch');

  s = setup(['werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
  W.forceAdvance(s); W.startVote(s);
  const t = { p0: 'p3', p1: 'p3', p2: 'p3', p3: 'p0', p4: 'p0', p5: 'p0' };
  let ev;
  for (const id of Object.keys(t)) ev = W.vote(s, id, t[id]);
  assert.strictEqual(ev.find((e) => e.type === 'vote_result').lynchedId, null);
  assert.ok(s.players.every((p) => p.alive));
  assert.strictEqual(s.phase, PHASE.NIGHT);
});

test('Jäger schießt nach dem Tod (Tod-Aktion)', () => {
  const s = setup(['werewolf', 'seer', 'hunter', 'villager', 'villager', 'villager', 'villager']);
  W.forceAdvance(s); W.startVote(s);
  for (const p of s.players) W.vote(s, p.id, p.id === 'p2' ? 'p3' : 'p2');
  assert.strictEqual(s.phase, PHASE.DEATH_TRIGGER);
  assert.throws(() => W.deathAction(s, 'p3', 'p0'));
  W.deathAction(s, 'p2', 'p0');
  assert.strictEqual(s.winner, TEAMS.VILLAGE);
});

test('Neutrale Rolle (Narr) gewinnt allein, wenn gelyncht', () => {
  const s = setup(['werewolf', 'seer', 'jester', 'villager', 'villager', 'villager'], { roles: { jester: 1 } });
  W.forceAdvance(s); W.startVote(s);
  let ev;
  for (const p of s.players) ev = W.vote(s, p.id, p.id === 'p2' ? 'p3' : 'p2');
  const over = ev.find((e) => e.type === 'game_over');
  assert.strictEqual(over.winner, TEAMS.NEUTRAL);
  assert.deepStrictEqual(over.playerIds, ['p2']);
});

test('Sieg der Wölfe bei Gleichstand der Anzahl', () => {
  const s = setup(['werewolf', 'seer', 'villager', 'villager', 'villager']);
  s.players[2].alive = false; s.players[3].alive = false; s.players[4].alive = false;
  assert.strictEqual(W.checkWin(s).winner, TEAMS.WOLVES);
});

test('publicView verrät keine Rollen lebender Spieler', () => {
  const s = mk(8);
  assert.ok(W.publicView(s).players.every((p) => p.role === null));
  W.forceAdvance(s); W.startVote(s);
  const al = s.players.filter((p) => p.alive);
  for (const p of al) W.vote(s, p.id, al.find((x) => x.id !== p.id).id);
  assert.ok(W.publicView(s).players.filter((p) => p.alive).every((p) => p.role === null));
});

// --- Erweiterbarkeit: neue Rolle ohne Änderung an der Engine ---
test('Eigene Rolle per registerRole (Leibwächter) funktioniert ohne Engine-Änderung', () => {
  registerRole({
    id: 'bodyguard', name: 'Leibwächter', emoji: '🛡️', team: TEAMS.VILLAGE, order: 35,
    night: {
      resolveOrder: 10,
      targets: (s, actor) => s.players.filter((p) => p.alive && p.id !== actor.id),
      normalize(s, actor, input) {
        if (!this.targets(s, actor).some((p) => p.id === input.targetId)) throw new Error('Ungültiges Ziel.');
        return { targetId: input.targetId };
      },
      resolve(s, ns, ctx) { for (const d of Object.values(ns.data.bodyguard || {})) if (d.targetId) ctx.protected.add(d.targetId); },
    },
  });
  try {
    const s = setup(['werewolf', 'seer', 'bodyguard', 'villager', 'villager', 'villager']);
    target(s, 'p0', 'p3'); target(s, 'p1', 'p0');
    assert.strictEqual(s.phase, PHASE.NIGHT, 'wartet auf den Leibwächter');
    assert.deepStrictEqual(W.waitingFor(s), ['p2']);
    target(s, 'p2', 'p3');
    assert.ok(s.players[3].alive, 'Leibwächter schützt');
    assert.ok(W.rolesFor(6, { roles: { bodyguard: 1 } }).includes('bodyguard'));
  } finally {
    unregisterRole('bodyguard');
  }
});

test('Ungültige Rollen-Definition wird abgelehnt', () => {
  assert.throws(() => registerRole({ id: 'x', name: 'X', team: 'andere' }));
  assert.throws(() => registerRole({ id: 'y', name: 'Y', team: TEAMS.VILLAGE, night: {} }));
});

test('1000 Zufallsspiele terminieren (mit Narr)', () => {
  for (let g = 0; g < 1000; g++) {
    const rng = mulberry(g + 11);
    const n = 5 + (g % 12);
    const s = mk(n, rng, g % 3 === 0 ? { roles: { jester: 1 } } : {});
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    let steps = 0;
    while (s.phase !== PHASE.GAME_OVER) {
      assert.ok(++steps < 3000, 'Endlosschleife');
      const al = s.players.filter((p) => p.alive);
      switch (s.phase) {
        case PHASE.NIGHT: {
          const waiting = W.waitingFor(s);
          assert.ok(waiting.length > 0, 'Nacht ohne wartende Spieler');
          if (rng() < 0.1) { W.forceAdvance(s, rng); break; }
          const actorId = pick(waiting);
          const actor = s.players.find((p) => p.id === actorId);
          if (actor.role === 'witch') {
            const input = {};
            if (s.roleState.witch.heal && s.nightState.shared.victimId && rng() < 0.5) input.heal = true;
            if (s.roleState.witch.poison && rng() < 0.4) input.poisonId = pick(W.nightTargets(s, actorId)).id;
            W.nightAction(s, actorId, input, rng);
          } else {
            W.nightAction(s, actorId, { targetId: pick(W.nightTargets(s, actorId)).id }, rng);
          }
          break;
        }
        case PHASE.DAY_DISCUSS: W.startVote(s); break;
        case PHASE.DAY_VOTE:
          if (rng() < 0.1) { W.forceAdvance(s, rng); break; }
          for (const p of al) {
            if (s.phase !== PHASE.DAY_VOTE) break;
            W.vote(s, p.id, rng() < 0.2 ? null : pick(al.filter((x) => x.id !== p.id)).id);
          }
          break;
        case PHASE.DEATH_TRIGGER:
          W.deathAction(s, s.pendingTriggerId, rng() < 0.3 ? null : pick(W.deathTargets(s, s.pendingTriggerId)).id);
          break;
        default: assert.fail(`Unbekannte Phase ${s.phase}`);
      }
    }
    assert.ok(s.winner);
  }
});

const { describeSetup, selectableRoles } = require('../src/games/werewolf/setup');

test('describeSetup: Vorschau, Warnungen und Fehler', () => {
  const ok = describeSetup(10, {});
  assert.strictEqual(ok.errors.length, 0);
  assert.ok(ok.text.includes('Werwolf'));
  assert.ok(describeSetup(8, { roles: { werewolf: 0 } }).errors.length > 0);
  assert.ok(describeSetup(6, { roles: { werewolf: 3 } }).errors.length > 0);
  assert.ok(describeSetup(5, { roles: { seer: 1, doctor: 1, witch: 1, hunter: 1, jester: 1 } }).warnings.length > 0);
  assert.ok(describeSetup(4, {}).errors.length > 0);
  assert.ok(selectableRoles().every((r) => !r.fill && !r.ownCountOption));
  assert.ok(selectableRoles().some((r) => r.id === 'alphawolf'));
  assert.ok(!selectableRoles().some((r) => r.id === 'werewolf'));
});

test('publicView für das Web-Board: Typ, Rollen-Metadaten, Zusammenstellung ohne Zuordnung', () => {
  const s = mk(8);
  const v = W.publicView(s);
  assert.strictEqual(v.type, 'werewolf');
  assert.ok(v.roles.seer && v.roles.seer.team === TEAMS.VILLAGE);
  const total = v.composition.flatMap((g) => g.roles).reduce((n, r) => n + r.count, 0);
  assert.strictEqual(total, 8);
  assert.ok(v.players.every((p) => p.role === null));
});

// ---------- Neue Rollen: Bürgermeister, Granny, Vampir, Alphawolf, Lyncher ----------

const dayVoteAll = (s, pick) => {
  W.forceAdvance(s);
  if (s.phase === PHASE.DAY_DISCUSS) W.startVote(s);
  let ev = [];
  for (const p of s.players.filter((x) => x.alive)) if (s.phase === PHASE.DAY_VOTE) ev = W.vote(s, p.id, pick(p));
  return ev;
};

test('Bürgermeister: Stimme zählt doppelt und entscheidet Gleichstand', () => {
  const s = setup(['werewolf', 'seer', 'mayor', 'villager', 'villager', 'villager']);
  W.forceAdvance(s); W.startVote(s);
  // p0,p1 -> p3 (2) ; p2 (Bürgermeister, 2) + p4 -> p5? Bürgermeister zählt 2: p2 -> p0 (2)
  const t = { p0: 'p3', p1: 'p3', p2: 'p0', p3: 'p0', p4: 'p5', p5: 'p4' };
  let ev;
  for (const id of Object.keys(t)) ev = W.vote(s, id, t[id]);
  const res = ev.find((e) => e.type === 'vote_result');
  assert.strictEqual(res.tally.p0, 3); // p2 (2) + p3 (1)
  assert.strictEqual(res.tally.p3, 2);
  assert.strictEqual(res.lynchedId, 'p0');
});

test('Granny erschießt Besucher (Seher, Doktor, Wolfsstimme), Angriff auf sie scheitert', () => {
  let s = setup(['werewolf', 'seer', 'doctor', 'granny', 'villager', 'villager', 'villager']);
  target(s, 'p0', 'p3'); // Wolf will Granny
  target(s, 'p1', 'p3'); // Seher besucht Granny
  target(s, 'p2', 'p3'); // Doktor besucht Granny
  assert.ok(s.players[3].alive, 'Granny überlebt');
  assert.strictEqual(s.winner, TEAMS.VILLAGE, 'der einzige Wolf wurde erschossen');
  for (const i of [0, 1, 2]) {
    assert.ok(!s.players[i].alive, `p${i} erschossen`);
    assert.strictEqual(s.players[i].deathCause, 'granny');
  }
  s = setup(['werewolf', 'seer', 'doctor', 'granny', 'villager', 'villager', 'villager']);
  target(s, 'p0', 'p4'); target(s, 'p1', 'p0'); target(s, 'p2', 'p4');
  assert.ok(s.players.every((p) => p.alive), 'ohne Besucher passiert nichts');
});

test('Granny: Hexen-Gift auf Granny erschießt die Hexe', () => {
  const s = setup(['werewolf', 'seer', 'witch', 'granny', 'villager', 'villager', 'villager', 'villager']);
  target(s, 'p0', 'p4'); target(s, 'p1', 'p0');
  act(s, 'p2', { poisonId: 'p3' });
  assert.ok(s.players[3].alive);
  assert.ok(!s.players[2].alive);
});

test('Vampir: Biss wandelt um, Rolle wechselt, Event role_change', () => {
  const s = setup(['werewolf', 'vampire', 'seer', 'villager', 'villager', 'villager', 'villager'], { roles: { vampire: 1 } });
  target(s, 'p0', 'p3'); target(s, 'p1', 'p4'); target(s, 'p2', 'p0');
  assert.strictEqual(s.phase, PHASE.DAY_DISCUSS);
  assert.ok(!s.players[3].alive, 'Wolfsopfer tot');
  assert.strictEqual(s.players[4].role, 'vampire', 'Gebissener ist Vampir');
});

test('Vampir: role_change-Event, Schutz verhindert Biss, Wolf ist immun', () => {
  let s = setup(['werewolf', 'vampire', 'doctor', 'seer', 'villager', 'villager', 'villager'], { roles: { vampire: 1 } });
  target(s, 'p0', 'p5');
  target(s, 'p1', 'p4');
  target(s, 'p2', 'p4');
  const ev = target(s, 'p3', 'p0');
  assert.strictEqual(s.players[4].role, 'villager', 'Doktor schützt');
  assert.ok(!ev.some((e) => e.type === 'role_change'));

  s = setup(['werewolf', 'vampire', 'seer', 'villager', 'villager', 'villager', 'villager'], { roles: { vampire: 1 } });
  target(s, 'p0', 'p3'); target(s, 'p1', 'p0');
  const ev2 = target(s, 'p2', 'p0');
  assert.strictEqual(s.players[0].role, 'werewolf', 'Wolf immun');
  assert.ok(!ev2.some((e) => e.type === 'role_change'));

  s = setup(['werewolf', 'vampire', 'seer', 'villager', 'villager', 'villager', 'villager'], { roles: { vampire: 1 } });
  target(s, 'p0', 'p3'); target(s, 'p1', 'p4');
  const ev3 = target(s, 'p2', 'p0');
  const rc = ev3.find((e) => e.type === 'role_change');
  assert.deepStrictEqual([rc.to, rc.roleId], ['p4', 'vampire']);
  assert.ok(W.roleInfo(s, 'p4').teammates.some((t) => t.id === 'p1'), 'Vampire kennen sich');
});

test('Dorf gewinnt nicht, solange ein Vampir lebt; Vampire gewinnen bei Mehrheit', () => {
  const s = setup(['werewolf', 'vampire', 'seer', 'villager', 'villager', 'villager', 'villager'], { roles: { vampire: 1 } });
  s.players[0].alive = false; // alle Wölfe tot
  assert.strictEqual(W.checkWin(s), null, 'Vampir lebt noch');
  s.players[3].alive = false; s.players[4].alive = false; s.players[5].alive = false; // 1 Vampir vs 2 andere
  assert.strictEqual(W.checkWin(s), null);
  s.players[6].alive = false; // Vampir + Seher: 1 >= 1
  const win = W.checkWin(s);
  assert.strictEqual(win.winner, TEAMS.NEUTRAL);
  assert.deepStrictEqual(win.playerIds, ['p1']);
  s.players[1].alive = false;
  assert.strictEqual(W.checkWin(s).winner, TEAMS.VILLAGE, 'ohne Vampire gewinnt das Dorf');
});

test('Alphawolf: Zusammenstellung ersetzt Werwolf, Stimme zählt doppelt, beide müssen abstimmen', () => {
  const roles = W.rolesFor(10, { roles: { alphawolf: 1 } });
  assert.strictEqual(roles.filter((r) => r === 'alphawolf').length, 1);
  assert.strictEqual(roles.filter((r) => r === 'werewolf' || r === 'alphawolf').length, 3); // kein Extra-Wolf
  const s = setup(['alphawolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
  assert.deepStrictEqual(W.waitingFor(s).sort(), ['p0', 'p1', 'p2']);
  target(s, 'p0', 'p3'); // Alpha: 2 Stimmen
  const ev = target(s, 'p1', 'p4'); // Werwolf: 1 Stimme
  assert.strictEqual(ev.find((e) => e.type === 'wolves_decided').victimId, 'p3');
  assert.deepStrictEqual(ev.find((e) => e.type === 'wolves_decided').wolfIds.sort(), ['p0', 'p1']);
  assert.ok(W.nightTargets(s, 'p0').length > 0, 'Alphawolf nutzt die Gruppen-Ziele');
});

test('Lyncher: Sieg wenn das Ziel gelyncht wird', () => {
  const s = setup(['werewolf', 'seer', 'lyncher', 'villager', 'villager', 'villager', 'villager']);
  s.roleState.lyncher = { targets: { p2: 'p3' } };
  assert.ok(W.roleInfo(s, 'p2').extra[0].includes('P3'));
  W.forceAdvance(s); W.startVote(s);
  let ev;
  for (const p of s.players) ev = W.vote(s, p.id, p.id === 'p3' ? 'p4' : 'p3');
  const over = ev.find((e) => e.type === 'game_over');
  assert.strictEqual(over.winner, TEAMS.NEUTRAL);
  assert.deepStrictEqual(over.playerIds, ['p2']);
});

test('Lyncher wird zum Dorfbewohner, wenn das Ziel anders stirbt', () => {
  const s = setup(['werewolf', 'seer', 'lyncher', 'villager', 'villager', 'villager', 'villager']);
  s.roleState.lyncher = { targets: { p2: 'p3' } };
  target(s, 'p0', 'p3'); // Wolf tötet das Ziel
  const ev = target(s, 'p1', 'p0');
  assert.ok(!s.players[3].alive);
  assert.strictEqual(s.players[2].role, 'villager');
  const rc = ev.find((e) => e.type === 'role_change');
  assert.deepStrictEqual([rc.to, rc.roleId], ['p2', 'villager']);
});

test('Lyncher bekommt beim Spielstart ein Dorf-Ziel', () => {
  for (let g = 0; g < 50; g++) {
    const s = mk(8, mulberry(g + 5), { roles: { lyncher: 1 } });
    const l = s.players.find((p) => p.role === 'lyncher');
    const t = s.roleState.lyncher.targets[l.id];
    assert.ok(t && W.roleInfo(s, t).team === TEAMS.VILLAGE);
  }
});

test('1000 Zufallsspiele mit allen neuen Rollen terminieren', () => {
  const all = { roles: { vampire: 1, lyncher: 1, alphawolf: 1, mayor: 1, granny: 1, jester: 1 } };
  for (let g = 0; g < 1000; g++) {
    const rng = mulberry(g + 91);
    const n = 8 + (g % 9);
    const s = mk(n, rng, all);
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    let steps = 0;
    while (s.phase !== PHASE.GAME_OVER) {
      assert.ok(++steps < 4000, 'Endlosschleife');
      const al = s.players.filter((p) => p.alive);
      switch (s.phase) {
        case PHASE.NIGHT: {
          const waiting = W.waitingFor(s);
          assert.ok(waiting.length > 0, 'Nacht ohne wartende Spieler');
          if (rng() < 0.1) { W.forceAdvance(s, rng); break; }
          const actorId = pick(waiting);
          const actor = s.players.find((p) => p.id === actorId);
          if (actor.role === 'witch') {
            const input = {};
            if (s.roleState.witch.heal && s.nightState.shared.victimId && rng() < 0.5) input.heal = true;
            if (s.roleState.witch.poison && rng() < 0.4) input.poisonId = pick(W.nightTargets(s, actorId)).id;
            W.nightAction(s, actorId, input, rng);
          } else {
            W.nightAction(s, actorId, { targetId: pick(W.nightTargets(s, actorId)).id }, rng);
          }
          break;
        }
        case PHASE.DAY_DISCUSS: W.startVote(s); break;
        case PHASE.DAY_VOTE:
          if (rng() < 0.1) { W.forceAdvance(s, rng); break; }
          for (const p of al) {
            if (s.phase !== PHASE.DAY_VOTE) break;
            W.vote(s, p.id, rng() < 0.2 ? null : pick(al.filter((x) => x.id !== p.id)).id);
          }
          break;
        case PHASE.DEATH_TRIGGER:
          W.deathAction(s, s.pendingTriggerId, rng() < 0.3 ? null : pick(W.deathTargets(s, s.pendingTriggerId)).id);
          break;
        default: assert.fail(`Unbekannte Phase ${s.phase}`);
      }
    }
    assert.ok(s.winner);
  }
});
