const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/games/secretHitler/engine');

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mk = (n, rng = mulberry(1)) => E.createGame({
  code: 'x', hostId: 'p0', rng,
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
});

test('Rollenverteilung je Spielerzahl', () => {
  for (const [n, [l, f]] of Object.entries(E.ROLE_COUNTS)) {
    const s = mk(Number(n));
    const c = (r) => s.players.filter((p) => p.role === r).length;
    assert.strictEqual(c('liberal'), l);
    assert.strictEqual(c('fascist'), f);
    assert.strictEqual(c('hitler'), 1);
  }
});

test('Spielerzahl 4 und 11 abgelehnt', () => {
  assert.throws(() => mk(4));
  assert.throws(() => mk(11));
});

test('Deck 6L/11F', () => {
  const s = mk(5);
  assert.strictEqual(s.deck.filter((c) => c === 'L').length, 6);
  assert.strictEqual(s.deck.filter((c) => c === 'F').length, 11);
});

function elect(s, ja = true) {
  const pres = E.president(s);
  const cand = E.legalChancellors(s)[0];
  E.nominate(s, pres.id, cand.id);
  let ev = [];
  for (const p of s.players.filter((x) => x.alive)) ev = E.vote(s, p.id, ja);
  return ev;
}

test('Wahl scheitert bei Gleichstand, Tracker steigt, Chaos nach 3', () => {
  const s = mk(5);
  elect(s, false);
  assert.strictEqual(s.tracker, 1);
  elect(s, false);
  const ev = elect(s, false);
  assert.ok(ev.some((e) => e.type === 'chaos'));
  assert.strictEqual(s.tracker, 0);
  assert.strictEqual(s.lastChancId, null);
  assert.strictEqual(s.liberal + s.fascist, 1);
});

test('Term-Limits: 5 Spieler nur Kanzler gesperrt, 6+ auch Präsident', () => {
  const s = mk(7);
  elect(s, true);
  const lastP = s.lastPresId; const lastC = s.lastChancId;
  // zurück in Nominierungsphase
  const pres = E.president(s);
  s.phase = E.PHASE.NOMINATE; s.hand = [];
  const ids = E.legalChancellors(s).map((p) => p.id);
  assert.ok(!ids.includes(lastC));
  assert.ok(!ids.includes(lastP) || lastP === pres.id);
  const s5 = mk(5);
  s5.lastPresId = 'p1'; s5.lastChancId = 'p2';
  s5.presIdx = 0;
  const ids5 = E.legalChancellors(s5).map((p) => p.id);
  assert.ok(ids5.includes('p1'));
  assert.ok(!ids5.includes('p2'));
});

test('Hitler als Kanzler nach 3 F-Policies = Faschisten gewinnen', () => {
  const s = mk(5);
  s.fascist = 3;
  const h = s.players.find((p) => p.role === 'hitler');
  const pres = E.president(s);
  if (pres.id === h.id) s.presIdx = (s.presIdx + 1) % 5;
  s.lastPresId = null; s.lastChancId = null;
  E.nominate(s, E.president(s).id, h.id);
  for (const p of s.players) E.vote(s, p.id, true);
  assert.strictEqual(s.winner, E.FASCIST);
});

test('Hinrichtung von Hitler = Liberale gewinnen', () => {
  const s = mk(5);
  s.phase = E.PHASE.EXECUTIVE; s.power = 'execution';
  const h = s.players.find((p) => p.role === 'hitler');
  if (E.president(s).id === h.id) s.presIdx = (s.presIdx + 1) % 5;
  E.usePower(s, E.president(s).id, h.id);
  assert.strictEqual(s.winner, E.LIBERAL);
});

test('Investigate nur einmal pro Spieler, liefert Partei', () => {
  const s = mk(9);
  s.phase = E.PHASE.EXECUTIVE; s.power = 'investigate';
  const pres = E.president(s);
  const t = s.players.find((p) => p.id !== pres.id);
  const ev = E.usePower(s, pres.id, t.id);
  assert.strictEqual(ev.find((e) => e.type === 'investigate').party, E.party(t));
  s.phase = E.PHASE.EXECUTIVE; s.power = 'investigate';
  assert.throws(() => E.usePower(s, E.president(s).id, t.id));
});

test('Special Election überspringt niemanden', () => {
  const s = mk(7);
  s.phase = E.PHASE.EXECUTIVE; s.power = 'special';
  const start = s.presIdx; s.rotIdx = start;
  const target = s.players[(start + 3) % 7];
  E.usePower(s, E.president(s).id, target.id);
  assert.strictEqual(E.president(s).id, target.id);
  s.phase = E.PHASE.NOMINATE;
  // Runde endet erfolglos -> nächster nach Ursprung
  elect(s, false);
  assert.strictEqual(s.presIdx, (start + 1) % 7);
});

test('Veto erst ab 5 F-Policies, erhöht Tracker', () => {
  const s = mk(5);
  elect(s, true);
  assert.throws(() => E.chancellorVeto(s, s.chancellorId)); // falsche Phase
  E.presidentDiscard(s, E.president(s).id, 0);
  assert.throws(() => E.chancellorVeto(s, s.chancellorId));
  s.fascist = 5;
  E.chancellorVeto(s, s.chancellorId);
  E.presidentVeto(s, E.president(s).id, true);
  assert.strictEqual(s.tracker, 1);
  assert.strictEqual(s.phase, E.PHASE.NOMINATE);
});

test('publicView enthält keine Rollen vor Spielende', () => {
  const s = mk(6);
  const v = JSON.stringify(E.publicView(s));
  assert.ok(!/"role":"(liberal|fascist|hitler)"/.test(v));
});

// Zufallssimulation: legale Zufallszüge müssen immer terminieren.
test('1000 Zufallsspiele terminieren', () => {
  for (let g = 0; g < 1000; g++) {
    const rng = mulberry(g + 7);
    const n = 5 + (g % 6);
    const s = mk(n, rng);
    let steps = 0;
    while (s.phase !== E.PHASE.GAME_OVER) {
      assert.ok(++steps < 2000, 'Endlosschleife');
      const pres = E.president(s);
      const pick = (arr) => arr[Math.floor(rng() * arr.length)];
      switch (s.phase) {
        case E.PHASE.NOMINATE: E.nominate(s, pres.id, pick(E.legalChancellors(s)).id); break;
        case E.PHASE.VOTE:
          for (const p of s.players.filter((x) => x.alive)) E.vote(s, p.id, rng() < 0.7, rng);
          break;
        case E.PHASE.LEGISLATE_PRESIDENT: E.presidentDiscard(s, pres.id, Math.floor(rng() * 3)); break;
        case E.PHASE.LEGISLATE_CHANCELLOR:
          if (s.fascist >= 5 && !s.vetoDenied && rng() < 0.3) E.chancellorVeto(s, s.chancellorId);
          else E.chancellorEnact(s, s.chancellorId, Math.floor(rng() * 2), rng);
          break;
        case E.PHASE.VETO: E.presidentVeto(s, pres.id, rng() < 0.5, rng); break;
        case E.PHASE.EXECUTIVE:
          E.usePower(s, pres.id, s.power === 'peek' ? undefined : pick(E.powerTargets(s)).id);
          break;
        default: assert.fail('Unbekannte Phase ' + s.phase);
      }
      assert.ok(s.deck.length + s.discard.length + s.hand.length + s.liberal + s.fascist === 17);
    }
    assert.ok(s.winner);
  }
});
