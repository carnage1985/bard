// Reine Spiellogik für Werwolf/Mafia (keine Discord-/IO-Abhängigkeiten).
// Gleiches Muster wie secretHitler/engine.js: Aktionen mutieren den Zustand, werfen bei
// illegalen Zügen einen Error und geben Events zurück (Events mit `to` sind privat).
// Zeit steuert die Discord-Schicht: bei Ablauf einer Frist ruft sie forceAdvance() auf.
// `state.deadline` (ms) setzt die Schicht selbst; es wird nur durchgereicht (Board-Countdown).

const PHASE = {
  NIGHT: 'NIGHT',
  DAY_DISCUSS: 'DAY_DISCUSS',
  DAY_VOTE: 'DAY_VOTE',
  HUNTER: 'HUNTER',
  GAME_OVER: 'GAME_OVER',
};

const ROLE = {
  VILLAGER: 'villager',
  WEREWOLF: 'werewolf',
  SEER: 'seer',
  DOCTOR: 'doctor',
  WITCH: 'witch',
  HUNTER: 'hunter',
};

const VILLAGE = 'village';
const WOLVES = 'wolves';

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 16;

const DEFAULT_OPTIONS = { revealRoles: true, doctor: null, witch: null, hunter: null };

function fail(msg) {
  throw new Error(msg);
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Rollen-Zusammenstellung je Spielerzahl; `null` bei Optionen = automatisch nach Größe.
function rolesFor(n, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const wolves = Math.max(1, Math.round(n / 4));
  const roles = Array(wolves).fill(ROLE.WEREWOLF);
  roles.push(ROLE.SEER);
  if (o.doctor ?? n >= 6) roles.push(ROLE.DOCTOR);
  if (o.hunter ?? n >= 7) roles.push(ROLE.HUNTER);
  if (o.witch ?? n >= 8) roles.push(ROLE.WITCH);
  while (roles.length < n) roles.push(ROLE.VILLAGER);
  return roles.slice(0, n);
}

function createGame({ code, hostId, players, rng = Math.random, options = {} }) {
  const n = players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) fail(`Werwolf braucht ${MIN_PLAYERS}–${MAX_PLAYERS} Spieler.`);
  if (new Set(players.map((p) => p.id)).size !== n) fail('Doppelte Spieler.');

  const roles = shuffle(rolesFor(n, options), rng);
  const state = {
    code,
    hostId,
    options: { ...DEFAULT_OPTIONS, ...options },
    players: players.map((p, i) => ({ id: p.id, name: p.name, role: roles[i], alive: true, deathCause: null })),
    phase: PHASE.NIGHT,
    night: 0, // Nummer der aktuellen/letzten Nacht
    day: 0,
    witch: { heal: true, poison: true },
    lastProtectedId: null,
    nightState: null,
    votes: {},
    pendingHunterId: null,
    hunterUsed: false,
    next: null, // 'day' | 'night' – wohin es nach dem Jägerschuss weitergeht
    deadline: null,
    winner: null,
    winReason: null,
    log: [],
  };
  startNight(state, []);
  return state;
}

// ---------- Hilfsfunktionen ----------

const alive = (s) => s.players.filter((p) => p.alive);
const byId = (s, id) => s.players.find((p) => p.id === id);
const aliveWith = (s, role) => alive(s).filter((p) => p.role === role);
const isWolf = (p) => p.role === ROLE.WEREWOLF;

function log(s, type, data = {}) {
  s.log.push({ type, night: s.night, day: s.day, ...data });
  if (s.log.length > 200) s.log.shift();
}

function checkWin(s) {
  const wolves = alive(s).filter(isWolf).length;
  const others = alive(s).length - wolves;
  if (wolves === 0) return { winner: VILLAGE, reason: 'Alle Werwölfe sind tot' };
  if (wolves >= others) return { winner: WOLVES, reason: 'Die Werwölfe haben das Dorf überrannt' };
  return null;
}

function endGame(s, win, events) {
  s.phase = PHASE.GAME_OVER;
  s.winner = win.winner;
  s.winReason = win.reason;
  s.deadline = null;
  log(s, 'game_over', win);
  events.push({ type: 'game_over', winner: win.winner, reason: win.reason });
}

function kill(s, id, cause) {
  const p = byId(s, id);
  p.alive = false;
  p.deathCause = cause;
  return p;
}

// ---------- Nacht ----------

function startNight(s, events) {
  s.night += 1;
  s.phase = PHASE.NIGHT;
  s.votes = {};
  s.nightState = {
    wolfVotes: {},
    victimId: null, // vom Rudel gewählt
    wolvesDone: false,
    seerDone: false,
    doctorDone: false,
    witchDone: false,
    protectId: null,
    healed: false,
    poisonId: null,
  };
  log(s, 'night_start');
  events.push({ type: 'night_start', night: s.night });
}

function nightTargets(s, role, actorId) {
  const a = alive(s);
  if (role === ROLE.WEREWOLF) return a.filter((p) => !isWolf(p));
  if (role === ROLE.SEER) return a.filter((p) => p.id !== actorId);
  if (role === ROLE.DOCTOR) return a.filter((p) => p.id !== s.lastProtectedId);
  if (role === ROLE.WITCH) return a.filter((p) => p.id !== actorId);
  return [];
}

function requireNight(s, actorId, role) {
  if (s.phase !== PHASE.NIGHT) fail('Gerade ist nicht Nacht.');
  const p = byId(s, actorId);
  if (!p || !p.alive || p.role !== role) fail('Du hast jetzt keine Aktion.');
  return p;
}

function resolveWolfVotes(s, rng) {
  const ns = s.nightState;
  const tally = {};
  for (const t of Object.values(ns.wolfVotes)) if (t) tally[t] = (tally[t] || 0) + 1;
  const max = Math.max(0, ...Object.values(tally));
  if (!max) { ns.victimId = null; return; }
  const top = Object.keys(tally).filter((id) => tally[id] === max);
  ns.victimId = top.length === 1 ? top[0] : top[Math.floor(rng() * top.length)];
}

function witchHasPotions(s) {
  return s.witch.heal || s.witch.poison;
}

// Prüft, ob alle nötigen Nachtaktionen vorliegen; löst die Nacht dann auf.
function progressNight(s, events, rng) {
  const ns = s.nightState;
  const wolves = aliveWith(s, ROLE.WEREWOLF);
  if (!ns.wolvesDone && wolves.every((w) => w.id in ns.wolfVotes)) {
    ns.wolvesDone = true;
    resolveWolfVotes(s, rng);
    events.push({ type: 'wolves_decided', victimId: ns.victimId, wolfIds: wolves.map((w) => w.id) });
    const witch = aliveWith(s, ROLE.WITCH)[0];
    if (witch && !ns.witchDone) {
      if (witchHasPotions(s)) {
        events.push({
          type: 'witch_prompt', to: witch.id, victimId: ns.victimId,
          canHeal: s.witch.heal && !!ns.victimId, canPoison: s.witch.poison,
        });
      } else {
        ns.witchDone = true;
      }
    }
  }
  const seerPending = aliveWith(s, ROLE.SEER).length && !ns.seerDone;
  const doctorPending = aliveWith(s, ROLE.DOCTOR).length && !ns.doctorDone;
  const witchPending = aliveWith(s, ROLE.WITCH).length && !ns.witchDone;
  if (ns.wolvesDone && !seerPending && !doctorPending && !witchPending) resolveNight(s, events, rng);
}

function resolveNight(s, events, rng) {
  const ns = s.nightState;
  const deaths = [];
  if (ns.victimId && ns.protectId !== ns.victimId && !ns.healed) {
    deaths.push({ id: ns.victimId, cause: 'wolves' });
  }
  if (ns.poisonId && !deaths.some((d) => d.id === ns.poisonId)) {
    deaths.push({ id: ns.poisonId, cause: 'witch' });
  }
  s.lastProtectedId = ns.protectId;
  for (const d of deaths) kill(s, d.id, d.cause);
  s.nightState = null;
  s.day += 1;
  log(s, 'dawn', { deaths });
  events.push({ type: 'dawn', deaths: deaths.map((d) => ({ ...d, role: s.options.revealRoles ? byId(s, d.id).role : null })) });
  afterDeaths(s, deaths.map((d) => d.id), 'day', events);
}

function wolfVote(s, actorId, targetId, rng = Math.random) {
  requireNight(s, actorId, ROLE.WEREWOLF);
  const ns = s.nightState;
  if (ns.wolvesDone) fail('Das Rudel hat sich schon entschieden.');
  if (!nightTargets(s, ROLE.WEREWOLF).some((p) => p.id === targetId)) fail('Ungültiges Ziel.');
  ns.wolfVotes[actorId] = targetId;
  const events = [{ type: 'wolf_vote', userId: actorId, targetId }];
  progressNight(s, events, rng);
  return events;
}

function seerInspect(s, actorId, targetId, rng = Math.random) {
  requireNight(s, actorId, ROLE.SEER);
  const ns = s.nightState;
  if (ns.seerDone) fail('Du hast schon geschaut.');
  const target = nightTargets(s, ROLE.SEER, actorId).find((p) => p.id === targetId);
  if (!target) fail('Ungültiges Ziel.');
  ns.seerDone = true;
  const events = [{ type: 'seer_result', to: actorId, targetId, isWolf: isWolf(target) }];
  progressNight(s, events, rng);
  return events;
}

function doctorProtect(s, actorId, targetId, rng = Math.random) {
  requireNight(s, actorId, ROLE.DOCTOR);
  const ns = s.nightState;
  if (ns.doctorDone) fail('Du hast schon geschützt.');
  if (!nightTargets(s, ROLE.DOCTOR).some((p) => p.id === targetId)) fail('Dieser Spieler darf nicht geschützt werden.');
  ns.protectId = targetId;
  ns.doctorDone = true;
  const events = [];
  progressNight(s, events, rng);
  return events;
}

// action: { heal: bool, poisonId?: string } – leer = passen
function witchAct(s, actorId, action = {}, rng = Math.random) {
  requireNight(s, actorId, ROLE.WITCH);
  const ns = s.nightState;
  if (!ns.wolvesDone) fail('Das Rudel hat noch nicht gewählt.');
  if (ns.witchDone) fail('Du hast dich schon entschieden.');
  if (action.heal) {
    if (!s.witch.heal) fail('Der Heiltrank ist aufgebraucht.');
    if (!ns.victimId) fail('Es gibt kein Opfer zu heilen.');
    ns.healed = true;
    s.witch.heal = false;
  }
  if (action.poisonId) {
    if (!s.witch.poison) fail('Der Gifttrank ist aufgebraucht.');
    if (!nightTargets(s, ROLE.WITCH, actorId).some((p) => p.id === action.poisonId)) fail('Ungültiges Ziel.');
    ns.poisonId = action.poisonId;
    s.witch.poison = false;
  }
  ns.witchDone = true;
  const events = [];
  progressNight(s, events, rng);
  return events;
}

// ---------- Tote / Jäger / Weiterlauf ----------

function afterDeaths(s, deadIds, next, events) {
  const hunter = deadIds.map((id) => byId(s, id)).find((p) => p.role === ROLE.HUNTER);
  if (hunter && !s.hunterUsed) {
    s.phase = PHASE.HUNTER;
    s.pendingHunterId = hunter.id;
    s.next = next;
    s.hunterUsed = true;
    log(s, 'hunter_pending', { hunterId: hunter.id });
    events.push({ type: 'hunter_prompt', to: hunter.id, hunterId: hunter.id });
    return;
  }
  proceed(s, next, events);
}

function proceed(s, next, events) {
  s.pendingHunterId = null;
  s.next = null;
  const win = checkWin(s);
  if (win) { endGame(s, win, events); return; }
  if (next === 'day') {
    s.phase = PHASE.DAY_DISCUSS;
    s.votes = {};
    events.push({ type: 'day_start', day: s.day });
  } else {
    startNight(s, events);
  }
}

function hunterShoot(s, actorId, targetId) {
  if (s.phase !== PHASE.HUNTER) fail('Gerade schießt niemand.');
  if (actorId !== s.pendingHunterId) fail('Nur der Jäger schießt.');
  const events = [];
  if (targetId) {
    const target = alive(s).find((p) => p.id === targetId);
    if (!target) fail('Ungültiges Ziel.');
    kill(s, targetId, 'hunter');
    log(s, 'hunter_shot', { hunterId: actorId, targetId });
    events.push({ type: 'hunter_shot', hunterId: actorId, targetId, role: s.options.revealRoles ? target.role : null });
  }
  proceed(s, s.next, events);
  return events;
}

// ---------- Tag ----------

function startVote(s) {
  if (s.phase !== PHASE.DAY_DISCUSS) fail('Gerade wird nicht diskutiert.');
  s.phase = PHASE.DAY_VOTE;
  s.votes = {};
  log(s, 'vote_start');
  return [{ type: 'vote_start' }];
}

// targetId = null → Enthaltung
function vote(s, actorId, targetId) {
  if (s.phase !== PHASE.DAY_VOTE) fail('Gerade wird nicht abgestimmt.');
  const voter = byId(s, actorId);
  if (!voter || !voter.alive) fail('Du darfst nicht abstimmen.');
  if (targetId !== null && !alive(s).some((p) => p.id === targetId && p.id !== actorId)) fail('Ungültiges Ziel.');
  s.votes[actorId] = targetId;
  const events = [{ type: 'vote_cast', userId: actorId }];
  if (alive(s).every((p) => p.id in s.votes)) resolveVote(s, events);
  return events;
}

function resolveVote(s, events) {
  const tally = {};
  for (const t of Object.values(s.votes)) if (t) tally[t] = (tally[t] || 0) + 1;
  const max = Math.max(0, ...Object.values(tally));
  const top = Object.keys(tally).filter((id) => tally[id] === max);
  const lynchedId = max > 0 && top.length === 1 ? top[0] : null; // Gleichstand/keine Stimmen: niemand
  const votes = { ...s.votes };
  log(s, 'vote_result', { lynchedId, tally });
  events.push({
    type: 'vote_result', votes, tally, lynchedId, tie: max > 0 && top.length > 1,
    role: lynchedId && s.options.revealRoles ? byId(s, lynchedId).role : null,
  });
  if (!lynchedId) { proceed(s, 'night', events); return; }
  kill(s, lynchedId, 'lynch');
  afterDeaths(s, [lynchedId], 'night', events);
}

// ---------- Zeitablauf ----------

// Fehlende Aktionen gelten als Enthaltung/Passen; für Timeouts der Discord-Schicht.
function forceAdvance(s, rng = Math.random) {
  const events = [];
  switch (s.phase) {
    case PHASE.NIGHT: {
      const ns = s.nightState;
      // Nur Wölfe, die noch nicht gewählt haben, enthalten sich (kein Opfer wegen Zeit).
      for (const w of aliveWith(s, ROLE.WEREWOLF)) if (!(w.id in ns.wolfVotes)) ns.wolfVotes[w.id] = null;
      progressNight(s, events, rng);
      if (s.phase === PHASE.NIGHT) {
        ns.seerDone = true; ns.doctorDone = true; ns.witchDone = true;
        progressNight(s, events, rng);
      }
      break;
    }
    case PHASE.DAY_DISCUSS: events.push(...startVote(s)); break;
    case PHASE.DAY_VOTE: resolveVote(s, events); break;
    case PHASE.HUNTER: events.push(...hunterShoot(s, s.pendingHunterId, null)); break;
    default: break;
  }
  return events;
}

// ---------- Sichten ----------

function waitingFor(s) {
  switch (s.phase) {
    case PHASE.NIGHT: {
      const ns = s.nightState;
      const ids = [];
      if (!ns.wolvesDone) ids.push(...aliveWith(s, ROLE.WEREWOLF).filter((w) => !(w.id in ns.wolfVotes)).map((w) => w.id));
      if (!ns.seerDone) ids.push(...aliveWith(s, ROLE.SEER).map((p) => p.id));
      if (!ns.doctorDone) ids.push(...aliveWith(s, ROLE.DOCTOR).map((p) => p.id));
      if (ns.wolvesDone && !ns.witchDone) ids.push(...aliveWith(s, ROLE.WITCH).map((p) => p.id));
      return ids;
    }
    case PHASE.DAY_VOTE: return alive(s).filter((p) => !(p.id in s.votes)).map((p) => p.id);
    case PHASE.HUNTER: return [s.pendingHunterId];
    default: return [];
  }
}

function roleInfo(s, id) {
  const me = byId(s, id);
  const info = { role: me.role, teammates: [] };
  if (me.role === ROLE.WEREWOLF) {
    info.teammates = s.players.filter((p) => isWolf(p) && p.id !== id).map((p) => ({ id: p.id, name: p.name }));
  }
  return info;
}

// Öffentliche Sicht – keine Rollen lebender Spieler, keine Nachtaktionen.
function publicView(s) {
  const over = s.phase === PHASE.GAME_OVER;
  return {
    code: s.code,
    type: 'werewolf',
    phase: s.phase,
    night: s.night,
    day: s.day,
    isNight: s.phase === PHASE.NIGHT,
    deadline: s.deadline,
    aliveCount: alive(s).length,
    wolvesAlive: over ? alive(s).filter(isWolf).length : null,
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      voted: s.phase === PHASE.DAY_VOTE ? p.id in s.votes : null,
      cause: p.alive ? null : p.deathCause,
      role: over || (!p.alive && s.options.revealRoles) ? p.role : null,
    })),
    winner: s.winner,
    winReason: s.winReason,
    log: s.log.slice(-30),
  };
}

module.exports = {
  PHASE, ROLE, VILLAGE, WOLVES, MIN_PLAYERS, MAX_PLAYERS,
  createGame, rolesFor, wolfVote, seerInspect, doctorProtect, witchAct, hunterShoot,
  startVote, vote, forceAdvance, nightTargets, waitingFor, roleInfo, publicView, checkWin, shuffle,
};
