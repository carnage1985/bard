const test = require('node:test');
const assert = require('node:assert');
const W = require('../src/games/werewolf/engine');
const { ROLE, PHASE } = W;

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
const withRole = (s, role) => s.players.filter((p) => p.role === role);

// Setzt Rollen deterministisch (Reihenfolge der Spieler).
function setup(roles, options) {
  const s = mk(roles.length, mulberry(1), options);
  roles.forEach((r, i) => { s.players[i].role = r; });
  return s;
}

test('Rollenzusammenstellung je Spielerzahl', () => {
  for (let n = W.MIN_PLAYERS; n <= W.MAX_PLAYERS; n++) {
    const roles = W.rolesFor(n);
    assert.strictEqual(roles.length, n);
    assert.ok(roles.filter((r) => r === ROLE.WEREWOLF).length >= 1);
    assert.ok(roles.includes(ROLE.SEER));
    const s = mk(n);
    assert.strictEqual(s.players.length, n);
  }
  assert.throws(() => mk(4));
  assert.throws(() => mk(17));
});

test('Wölfe kennen sich, andere nicht', () => {
  const s = mk(9);
  for (const p of s.players) {
    const info = W.roleInfo(s, p.id);
    if (p.role === ROLE.WEREWOLF) assert.strictEqual(info.teammates.length, withRole(s, ROLE.WEREWOLF).length - 1);
    else assert.strictEqual(info.teammates.length, 0);
  }
});

test('Wolfsopfer stirbt; Doktor-Schutz rettet; Heiltrank rettet', () => {
  // p0 Wolf, p1 Seher, p2 Doktor, p3 Hexe, p4..p7 Dorf
  const mkGame = () => setup(['werewolf', 'seer', 'doctor', 'witch', 'villager', 'villager', 'villager', 'villager']);
  let s = mkGame();
  W.wolfVote(s, 'p0', 'p4');
  W.seerInspect(s, 'p1', 'p0');
  W.doctorProtect(s, 'p2', 'p5');
  let ev = W.witchAct(s, 'p3', {});
  assert.strictEqual(s.phase, PHASE.DAY_DISCUSS);
  assert.ok(!s.players[4].alive);
  assert.deepStrictEqual(ev.find((e) => e.type === 'dawn').deaths.map((d) => d.id), ['p4']);

  s = mkGame();
  W.wolfVote(s, 'p0', 'p4');
  W.seerInspect(s, 'p1', 'p0');
  W.doctorProtect(s, 'p2', 'p4');
  W.witchAct(s, 'p3', {});
  assert.ok(s.players[4].alive, 'Doktor schützt');

  s = mkGame();
  W.wolfVote(s, 'p0', 'p4');
  W.seerInspect(s, 'p1', 'p0');
  W.doctorProtect(s, 'p2', 'p5');
  W.witchAct(s, 'p3', { heal: true });
  assert.ok(s.players[4].alive, 'Hexe heilt');
  assert.strictEqual(s.witch.heal, false);
});

test('Seher sieht Werwolf-Status, Hexe darf erst nach den Wölfen', () => {
  const s = setup(['werewolf', 'seer', 'witch', 'villager', 'villager']);
  assert.throws(() => W.witchAct(s, 'p2', {}), /Rudel/);
  const ev = W.seerInspect(s, 'p1', 'p0');
  assert.strictEqual(ev.find((e) => e.type === 'seer_result').isWolf, true);
  assert.throws(() => W.seerInspect(s, 'p1', 'p3'));
});

test('Hexe: Gift tötet, Trank nur einmal', () => {
  const s = setup(['werewolf', 'seer', 'witch', 'villager', 'villager', 'villager']);
  W.wolfVote(s, 'p0', 'p3');
  W.seerInspect(s, 'p1', 'p3');
  W.witchAct(s, 'p2', { poisonId: 'p4' });
  assert.ok(!s.players[3].alive && !s.players[4].alive);
  assert.strictEqual(s.witch.poison, false);
});

test('Doktor-Sperre in Folgenacht', () => {
  const s = setup(['werewolf', 'seer', 'doctor', 'villager', 'villager', 'villager', 'villager']);
  W.wolfVote(s, 'p0', 'p5'); W.seerInspect(s, 'p1', 'p0'); W.doctorProtect(s, 'p2', 'p3');
  W.startVote(s);
  for (const p of s.players.filter((x) => x.alive)) W.vote(s, p.id, null);
  assert.strictEqual(s.phase, PHASE.NIGHT);
  assert.throws(() => W.doctorProtect(s, 'p2', 'p3'));
  W.doctorProtect(s, 'p2', 'p2');
});

test('Abstimmung: Mehrheit lyncht', () => {
  const s = setup(['werewolf', 'seer', 'villager', 'villager', 'villager', 'villager', 'villager']);
  W.forceAdvance(s); // Nacht ohne Aktionen
  assert.strictEqual(s.phase, PHASE.DAY_DISCUSS);
  assert.ok(s.players.every((p) => p.alive));
  W.startVote(s);
  for (const p of s.players) W.vote(s, p.id, p.id === 'p2' ? 'p3' : 'p2');
  assert.ok(!s.players[2].alive);
  assert.strictEqual(s.players[2].deathCause, 'lynch');
});

test('Gleichstand lyncht niemanden', () => {
  const s = setup(['werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
  W.forceAdvance(s); W.startVote(s);
  // p0,p1,p2 -> p3 ; p3,p4,p5 -> p0  => 3:3
  const t = { p0: 'p3', p1: 'p3', p2: 'p3', p3: 'p0', p4: 'p0', p5: 'p0' };
  let ev;
  for (const id of Object.keys(t)) ev = W.vote(s, id, t[id]);
  assert.strictEqual(ev.find((e) => e.type === 'vote_result').lynchedId, null);
  assert.ok(s.players.every((p) => p.alive));
  assert.strictEqual(s.phase, PHASE.NIGHT);
});

test('Jäger schießt nach dem Tod', () => {
  const s = setup(['werewolf', 'seer', 'hunter', 'villager', 'villager', 'villager', 'villager']);
  W.forceAdvance(s); W.startVote(s);
  for (const p of s.players) W.vote(s, p.id, p.id === 'p2' ? 'p3' : 'p2');
  assert.strictEqual(s.phase, PHASE.HUNTER);
  assert.throws(() => W.hunterShoot(s, 'p3', 'p0'));
  W.hunterShoot(s, 'p2', 'p0');
  assert.strictEqual(s.winner, W.VILLAGE);
});

test('Sieg der Wölfe bei Gleichstand der Anzahl', () => {
  const s = setup(['werewolf', 'seer', 'villager', 'villager', 'villager']);
  s.players[2].alive = false;
  s.players[3].alive = false;
  s.players[4].alive = false;
  assert.strictEqual(W.checkWin(s).winner, W.WOLVES);
});

test('publicView verrät keine Rollen lebender Spieler', () => {
  const s = mk(8);
  assert.ok(W.publicView(s).players.every((p) => p.role === null));
  W.forceAdvance(s);
  W.startVote(s);
  const alive = s.players.filter((p) => p.alive);
  for (const p of alive) W.vote(s, p.id, alive.find((x) => x.id !== p.id).id);
  const v = W.publicView(s);
  assert.ok(v.players.filter((p) => p.alive).every((p) => p.role === null));
});

test('1000 Zufallsspiele terminieren', () => {
  for (let g = 0; g < 1000; g++) {
    const rng = mulberry(g + 11);
    const n = 5 + (g % 12);
    const s = mk(n, rng);
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
          if (actor.role === ROLE.WEREWOLF) W.wolfVote(s, actor.id, pick(W.nightTargets(s, ROLE.WEREWOLF)).id, rng);
          else if (actor.role === ROLE.SEER) W.seerInspect(s, actor.id, pick(W.nightTargets(s, ROLE.SEER, actor.id)).id, rng);
          else if (actor.role === ROLE.DOCTOR) W.doctorProtect(s, actor.id, pick(W.nightTargets(s, ROLE.DOCTOR)).id, rng);
          else {
            const act = {};
            if (s.witch.heal && s.nightState.victimId && rng() < 0.5) act.heal = true;
            if (s.witch.poison && rng() < 0.4) act.poisonId = pick(W.nightTargets(s, ROLE.WITCH, actor.id)).id;
            W.witchAct(s, actor.id, act, rng);
          }
          break;
        }
        case PHASE.DAY_DISCUSS: W.startVote(s); break;
        case PHASE.DAY_VOTE:
          if (rng() < 0.1) { W.forceAdvance(s, rng); break; }
          for (const p of al) {
            if (s.phase !== PHASE.DAY_VOTE) break;
            const others = al.filter((x) => x.id !== p.id);
            W.vote(s, p.id, rng() < 0.2 ? null : pick(others).id);
          }
          break;
        case PHASE.HUNTER: {
          const targets = al;
          W.hunterShoot(s, s.pendingHunterId, rng() < 0.3 ? null : pick(targets).id);
          break;
        }
        default: assert.fail(`Unbekannte Phase ${s.phase}`);
      }
    }
    assert.ok(s.winner);
  }
});
