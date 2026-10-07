// Reine Spiellogik für Secret Hitler (keine Discord-/IO-Abhängigkeiten).
// Alle Aktionen mutieren den Zustand, werfen bei illegalen Zügen einen Error
// und geben eine Liste von Events zurück. Events mit `to` sind privat.
// Der Zustand ist JSON-serialisierbar (Persistenz / Neustart-Festigkeit).

const PHASE = {
  NOMINATE: 'NOMINATE',
  VOTE: 'VOTE',
  LEGISLATE_PRESIDENT: 'LEGISLATE_PRESIDENT',
  LEGISLATE_CHANCELLOR: 'LEGISLATE_CHANCELLOR',
  VETO: 'VETO',
  EXECUTIVE: 'EXECUTIVE',
  GAME_OVER: 'GAME_OVER',
};

const LIBERAL = 'L';
const FASCIST = 'F';

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;

// [Liberale, normale Faschisten] (+ Hitler)
const ROLE_COUNTS = {
  5: [3, 1],
  6: [4, 1],
  7: [4, 2],
  8: [5, 2],
  9: [5, 3],
  10: [6, 3],
};

// Macht pro erlassener Faschisten-Policy (Index 0 = erste), null = keine.
const POWER_TRACKS = {
  small: [null, null, 'peek', 'execution', 'execution'],
  medium: [null, 'investigate', 'special', 'execution', 'execution'],
  large: ['investigate', 'investigate', 'special', 'execution', 'execution'],
};

function trackFor(playerCount) {
  if (playerCount <= 6) return POWER_TRACKS.small;
  if (playerCount <= 8) return POWER_TRACKS.medium;
  return POWER_TRACKS.large;
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck(rng) {
  return shuffle([...Array(6).fill(LIBERAL), ...Array(11).fill(FASCIST)], rng);
}

function fail(msg) {
  throw new Error(msg);
}

function createGame({ code, hostId, players, rng = Math.random }) {
  const n = players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) fail(`Secret Hitler braucht ${MIN_PLAYERS}–${MAX_PLAYERS} Spieler.`);
  if (new Set(players.map((p) => p.id)).size !== n) fail('Doppelte Spieler.');

  const [libs, fasc] = ROLE_COUNTS[n];
  const roles = shuffle([
    ...Array(libs).fill('liberal'),
    ...Array(fasc).fill('fascist'),
    'hitler',
  ], rng);
  const seats = shuffle(players, rng).map((p, i) => ({
    id: p.id, name: p.name, role: roles[i], alive: true,
  }));

  const first = Math.floor(rng() * n);
  const state = {
    code,
    hostId,
    players: seats,
    phase: PHASE.NOMINATE,
    deck: buildDeck(rng),
    discard: [],
    liberal: 0,
    fascist: 0,
    tracker: 0,
    rotIdx: first, // letzter Präsident der normalen Reihenfolge
    presIdx: first,
    specialActive: false,
    candidateId: null, // nominierter Kanzlerkandidat
    chancellorId: null, // gewählter Kanzler der laufenden Regierung
    lastPresId: null, // zuletzt gewählte Regierung (Term-Limits)
    lastChancId: null,
    votes: {},
    hand: [], // Präsidenten-Hand (3) bzw. Kanzler-Hand (2) – privat
    vetoDenied: false,
    power: null,
    investigated: [],
    winner: null,
    winReason: null,
    round: 1,
    log: [],
  };
  return state;
}

// ---------- Hilfsfunktionen ----------

const alive = (s) => s.players.filter((p) => p.alive);
const byId = (s, id) => s.players.find((p) => p.id === id);
const president = (s) => s.players[s.presIdx];
const chancellor = (s) => (s.chancellorId ? byId(s, s.chancellorId) : null);
const hitler = (s) => s.players.find((p) => p.role === 'hitler');

function party(player) {
  return player.role === 'liberal' ? LIBERAL : FASCIST;
}

function log(s, type, data = {}) {
  s.log.push({ type, round: s.round, ...data });
  if (s.log.length > 200) s.log.shift();
}

function nextAliveIdx(s, from) {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (s.players[idx].alive) return idx;
  }
  return from;
}

function legalChancellors(s) {
  const pres = president(s);
  const limitPresToo = alive(s).length > 5;
  return alive(s).filter((p) => p.id !== pres.id
    && p.id !== s.lastChancId
    && !(limitPresToo && p.id === s.lastPresId));
}

function reshuffleIfNeeded(s, rng) {
  if (s.deck.length < 3) {
    s.deck = shuffle([...s.deck, ...s.discard], rng);
    s.discard = [];
  }
}

function draw(s, count, rng) {
  reshuffleIfNeeded(s, rng);
  return s.deck.splice(0, count);
}

function endGame(s, winner, reason, events) {
  s.phase = PHASE.GAME_OVER;
  s.winner = winner;
  s.winReason = reason;
  log(s, 'game_over', { winner, reason });
  events.push({ type: 'game_over', winner, reason });
}

function startRound(s, events) {
  s.rotIdx = nextAliveIdx(s, s.rotIdx);
  s.presIdx = s.rotIdx;
  s.specialActive = false;
  beginNomination(s, events);
}

function beginNomination(s, events) {
  s.round += 1;
  s.phase = PHASE.NOMINATE;
  s.candidateId = null;
  s.chancellorId = null;
  s.votes = {};
  s.hand = [];
  s.vetoDenied = false;
  s.power = null;
  events.push({ type: 'nominate', presidentId: president(s).id });
}

// Policy erlassen (regulär oder durch Chaos). Gibt true zurück wenn das Spiel endete.
function enact(s, policy, { chaos = false }, events, rng) {
  s.tracker = 0;
  if (policy === LIBERAL) s.liberal += 1; else s.fascist += 1;
  log(s, 'policy', { policy, chaos });
  events.push({ type: 'policy', policy, chaos, liberal: s.liberal, fascist: s.fascist });

  if (s.liberal >= 5) { endGame(s, LIBERAL, '5 liberale Policies erlassen', events); return true; }
  if (s.fascist >= 6) { endGame(s, FASCIST, '6 faschistische Policies erlassen', events); return true; }

  reshuffleIfNeeded(s, rng);

  if (policy === FASCIST && !chaos) {
    const power = trackFor(s.players.length)[s.fascist - 1];
    if (power) {
      s.phase = PHASE.EXECUTIVE;
      s.power = power;
      events.push({ type: 'power', power, presidentId: president(s).id });
      return false;
    }
  }
  startRound(s, events);
  return false;
}

function chaos(s, events, rng) {
  const top = draw(s, 1, rng)[0];
  s.lastPresId = null;
  s.lastChancId = null;
  events.push({ type: 'chaos' });
  log(s, 'chaos');
  enact(s, top, { chaos: true }, events, rng);
}

function failedGovernment(s, events, rng) {
  s.tracker += 1;
  if (s.tracker >= 3) chaos(s, events, rng);
  else startRound(s, events);
}

// ---------- Aktionen ----------

function nominate(s, actorId, targetId) {
  if (s.phase !== PHASE.NOMINATE) fail('Gerade wird nicht nominiert.');
  if (actorId !== president(s).id) fail('Nur der Präsident nominiert.');
  if (!legalChancellors(s).some((p) => p.id === targetId)) fail('Dieser Spieler ist nicht wählbar.');
  s.candidateId = targetId;
  s.votes = {};
  s.phase = PHASE.VOTE;
  log(s, 'nominate', { presidentId: actorId, chancellorId: targetId });
  return [{ type: 'vote_start', presidentId: actorId, chancellorId: targetId }];
}

function vote(s, actorId, ja, rng = Math.random) {
  if (s.phase !== PHASE.VOTE) fail('Gerade wird nicht abgestimmt.');
  const voter = byId(s, actorId);
  if (!voter || !voter.alive) fail('Du darfst nicht abstimmen.');
  s.votes[actorId] = !!ja;
  const events = [{ type: 'vote_cast', userId: actorId }];
  if (!alive(s).every((p) => p.id in s.votes)) return events;

  const jaCount = Object.values(s.votes).filter(Boolean).length;
  const neinCount = Object.keys(s.votes).length - jaCount;
  const passed = jaCount > neinCount;
  const votes = { ...s.votes };
  log(s, 'vote', { presidentId: president(s).id, chancellorId: s.candidateId, passed, ja: jaCount, nein: neinCount });
  events.push({ type: 'vote_result', passed, ja: jaCount, nein: neinCount, votes });

  if (!passed) {
    failedGovernment(s, events, rng);
    return events;
  }

  s.chancellorId = s.candidateId;
  s.lastPresId = president(s).id;
  s.lastChancId = s.chancellorId;

  if (s.fascist >= 3) {
    if (chancellor(s).role === 'hitler') {
      endGame(s, FASCIST, 'Hitler wurde nach 3 faschistischen Policies zum Kanzler gewählt', events);
      return events;
    }
    events.push({ type: 'not_hitler', userId: s.chancellorId });
  }

  s.hand = draw(s, 3, rng);
  s.phase = PHASE.LEGISLATE_PRESIDENT;
  events.push({ type: 'legislate_president', presidentId: president(s).id, to: president(s).id, cards: s.hand.slice() });
  return events;
}

function presidentDiscard(s, actorId, index) {
  if (s.phase !== PHASE.LEGISLATE_PRESIDENT) fail('Der Präsident legt gerade nichts ab.');
  if (actorId !== president(s).id) fail('Nur der Präsident wählt hier.');
  if (!Number.isInteger(index) || index < 0 || index >= s.hand.length) fail('Ungültige Karte.');
  const [dropped] = s.hand.splice(index, 1);
  s.discard.push(dropped);
  s.phase = PHASE.LEGISLATE_CHANCELLOR;
  return [{
    type: 'legislate_chancellor',
    chancellorId: s.chancellorId,
    to: s.chancellorId,
    cards: s.hand.slice(),
    canVeto: s.fascist >= 5 && !s.vetoDenied,
  }];
}

function chancellorEnact(s, actorId, index, rng = Math.random) {
  if (s.phase !== PHASE.LEGISLATE_CHANCELLOR) fail('Der Kanzler erlässt gerade nichts.');
  if (actorId !== s.chancellorId) fail('Nur der Kanzler wählt hier.');
  if (!Number.isInteger(index) || index < 0 || index >= s.hand.length) fail('Ungültige Karte.');
  const [enacted] = s.hand.splice(index, 1);
  s.discard.push(...s.hand);
  s.hand = [];
  const events = [];
  enact(s, enacted, { chaos: false }, events, rng);
  return events;
}

function chancellorVeto(s, actorId) {
  if (s.phase !== PHASE.LEGISLATE_CHANCELLOR) fail('Gerade ist kein Veto möglich.');
  if (actorId !== s.chancellorId) fail('Nur der Kanzler kann ein Veto vorschlagen.');
  if (s.fascist < 5 || s.vetoDenied) fail('Veto ist nicht verfügbar.');
  s.phase = PHASE.VETO;
  log(s, 'veto_request');
  return [{ type: 'veto_request', presidentId: president(s).id, to: president(s).id }];
}

function presidentVeto(s, actorId, agree, rng = Math.random) {
  if (s.phase !== PHASE.VETO) fail('Kein Veto offen.');
  if (actorId !== president(s).id) fail('Nur der Präsident entscheidet über das Veto.');
  const events = [];
  if (!agree) {
    s.vetoDenied = true;
    s.phase = PHASE.LEGISLATE_CHANCELLOR;
    log(s, 'veto_denied');
    events.push({ type: 'veto_denied' });
    events.push({
      type: 'legislate_chancellor', chancellorId: s.chancellorId, to: s.chancellorId,
      cards: s.hand.slice(), canVeto: false,
    });
    return events;
  }
  s.discard.push(...s.hand);
  s.hand = [];
  log(s, 'veto_accepted');
  events.push({ type: 'veto_accepted' });
  reshuffleIfNeeded(s, rng);
  failedGovernment(s, events, rng);
  return events;
}

function powerTargets(s) {
  const pres = president(s);
  if (s.power === 'investigate') {
    return alive(s).filter((p) => p.id !== pres.id && !s.investigated.includes(p.id));
  }
  if (s.power === 'special' || s.power === 'execution') {
    return alive(s).filter((p) => p.id !== pres.id);
  }
  return [];
}

function usePower(s, actorId, targetId) {
  if (s.phase !== PHASE.EXECUTIVE) fail('Gerade gibt es keine Macht zu nutzen.');
  if (actorId !== president(s).id) fail('Nur der Präsident nutzt die Macht.');
  const events = [];
  const power = s.power;

  if (power === 'peek') {
    const cards = s.deck.slice(0, 3);
    log(s, 'peek');
    events.push({ type: 'peek', to: actorId, cards });
    startRound(s, events);
    return events;
  }

  const target = powerTargets(s).find((p) => p.id === targetId);
  if (!target) fail('Ungültiges Ziel.');

  if (power === 'investigate') {
    s.investigated.push(target.id);
    log(s, 'investigate', { presidentId: actorId, targetId });
    events.push({ type: 'investigate', to: actorId, targetId, party: party(target), public: { presidentId: actorId, targetId } });
    startRound(s, events);
  } else if (power === 'special') {
    log(s, 'special', { presidentId: actorId, targetId });
    events.push({ type: 'special', presidentId: actorId, targetId });
    s.presIdx = s.players.indexOf(target);
    s.specialActive = true;
    beginNomination(s, events);
  } else if (power === 'execution') {
    target.alive = false;
    log(s, 'execution', { presidentId: actorId, targetId });
    events.push({ type: 'execution', presidentId: actorId, targetId });
    if (target.role === 'hitler') {
      endGame(s, LIBERAL, 'Hitler wurde hingerichtet', events);
    } else {
      startRound(s, events);
    }
  }
  return events;
}

// ---------- Sichten ----------

// Geheime Info für den Rollen-DM eines Spielers.
function roleInfo(s, id) {
  const me = byId(s, id);
  const n = s.players.length;
  const fascists = s.players.filter((p) => p.role === 'fascist');
  const h = hitler(s);
  const info = { role: me.role, teammates: [], hitler: null };
  if (me.role === 'fascist') {
    info.teammates = fascists.filter((p) => p.id !== id).map((p) => ({ id: p.id, name: p.name }));
    info.hitler = { id: h.id, name: h.name };
  } else if (me.role === 'hitler' && n <= 6) {
    info.teammates = fascists.map((p) => ({ id: p.id, name: p.name }));
  }
  return info;
}

// Öffentliche Sicht für Board/Status – enthält keinerlei Geheimnisse.
function publicView(s) {
  const gameOver = s.phase === PHASE.GAME_OVER;
  const pres = s.players[s.presIdx];
  const track = trackFor(s.players.length);
  return {
    code: s.code,
    phase: s.phase,
    round: s.round,
    liberal: s.liberal,
    fascist: s.fascist,
    tracker: s.tracker,
    deckCount: s.deck.length,
    discardCount: s.discard.length,
    powers: track,
    vetoUnlocked: s.fascist >= 5,
    presidentId: pres.id,
    candidateId: s.candidateId,
    chancellorId: s.chancellorId,
    lastPresId: s.lastPresId,
    lastChancId: s.lastChancId,
    power: s.power,
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      voted: s.phase === PHASE.VOTE ? p.id in s.votes : null,
      // Rollen erst nach Spielende
      role: gameOver ? p.role : null,
    })),
    winner: s.winner,
    winReason: s.winReason,
    log: s.log.slice(-30),
  };
}

module.exports = {
  PHASE, LIBERAL, FASCIST, MIN_PLAYERS, MAX_PLAYERS, ROLE_COUNTS,
  createGame, nominate, vote, presidentDiscard, chancellorEnact, chancellorVeto, presidentVeto,
  usePower, legalChancellors, powerTargets, roleInfo, publicView, trackFor, shuffle,
  president, chancellor, byId, party,
};
