// Reine Spiellogik für Werwolf/Mafia (keine Discord-/IO-Abhängigkeiten).
// Die Engine kennt KEINE konkrete Rolle: alle Rollen-Eigenschaften (Team, Nachtaktion, Tod-Trigger,
// Auflösung, Sondersiege) stehen als Daten/Hooks in roles/<rolle>.js (siehe roles/_template.js).
// Aktionen mutieren den Zustand, werfen bei illegalen Zügen einen Error und geben Events zurück
// (Events mit `to` sind privat). Zeit steuert die Discord-Schicht: bei Ablauf einer Frist ruft sie
// forceAdvance() auf; `state.deadline` (ms) setzt sie selbst und es wird nur durchgereicht.
const { TEAMS, TEAM_INFO } = require('./teams');
const { getRole, allRoles, rolesOfTeam } = require('./roles');

const PHASE = {
  NIGHT: 'NIGHT',
  DAY_DISCUSS: 'DAY_DISCUSS',
  DAY_VOTE: 'DAY_VOTE',
  DEATH_TRIGGER: 'DEATH_TRIGGER', // Tod-Aktion einer Rolle (z. B. Jäger)
  GAME_OVER: 'GAME_OVER',
};

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 16;
const DEFAULT_OPTIONS = { revealRoles: true, roles: {} }; // roles: { <rolleId>: Anzahl | true | false }

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

// Rollen-Zusammenstellung: pro Rolle `defaultCount(n)`, Host-Override via options.roles,
// Rollen mit `fill` (Dorfbewohner) füllen auf. Reihenfolge = Rolle.order, überzählige fallen hinten weg.
function rolesFor(n, options = {}) {
  const overrides = options.roles || {};
  const roles = [];
  for (const role of allRoles()) {
    if (role.fill) continue;
    const o = overrides[role.id];
    const count = o === undefined ? (role.defaultCount?.(n, options) ?? 0) : Number(o);
    for (let i = 0; i < count; i++) roles.push(role.id);
  }
  const filler = allRoles().find((r) => r.fill);
  if (!filler) fail('Keine Füllrolle registriert.');
  while (roles.length < n) roles.push(filler.id);
  return roles.slice(0, n);
}

function createGame({ code, hostId, players, rng = Math.random, options = {} }) {
  const n = players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) fail(`Werwolf braucht ${MIN_PLAYERS}–${MAX_PLAYERS} Spieler.`);
  if (new Set(players.map((p) => p.id)).size !== n) fail('Doppelte Spieler.');

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const assigned = shuffle(rolesFor(n, opts), rng);
  const state = {
    code,
    hostId,
    options: opts,
    players: players.map((p, i) => ({
      id: p.id, name: p.name, role: assigned[i], alive: true, deathCause: null, triggered: false,
    })),
    phase: PHASE.NIGHT,
    night: 0,
    day: 0,
    roleState: {}, // rollenspezifischer Zustand (Tränke, letzter Schutz, …)
    nightState: null,
    votes: {},
    triggerQueue: [],
    pendingTriggerId: null,
    pendingWin: null,
    next: null, // 'day' | 'night' – wohin es nach Tod-Aktionen weitergeht
    deadline: null,
    winner: null,
    winReason: null,
    log: [],
  };
  for (const role of allRoles()) if (role.initState) state.roleState[role.id] = role.initState(state);
  startNight(state, []);
  return state;
}

// ---------- Hilfsfunktionen ----------

const alive = (s) => s.players.filter((p) => p.alive);
const byId = (s, id) => s.players.find((p) => p.id === id);
const roleOf = (p) => getRole(p.role);
const teamOf = (p) => roleOf(p).team;

function log(s, type, data = {}) {
  s.log.push({ type, night: s.night, day: s.day, ...data });
  if (s.log.length > 200) s.log.shift();
}

function checkWin(s) {
  for (const role of allRoles()) {
    const win = role.checkWin?.(s);
    if (win) return win;
  }
  const a = alive(s);
  const wolves = a.filter((p) => teamOf(p) === TEAMS.WOLVES).length;
  if (wolves === 0) return { winner: TEAMS.VILLAGE, reason: 'Alle Werwölfe sind tot' };
  if (wolves >= a.length - wolves) return { winner: TEAMS.WOLVES, reason: 'Die Werwölfe haben das Dorf überrannt' };
  return null;
}

function endGame(s, win, events) {
  s.phase = PHASE.GAME_OVER;
  s.winner = win.winner;
  s.winReason = win.reason;
  s.winnerIds = win.playerIds || null; // bei Einzelsiegen neutraler Rollen
  s.deadline = null;
  log(s, 'game_over', win);
  events.push({ type: 'game_over', winner: win.winner, reason: win.reason, playerIds: s.winnerIds });
}

function kill(s, id, cause) {
  const p = byId(s, id);
  if (!p || !p.alive) return null;
  p.alive = false;
  p.deathCause = cause;
  const win = roleOf(p).onDeath?.(s, p, cause);
  if (win && !s.pendingWin) s.pendingWin = win; // Sondersieg (z. B. Narr), gilt nach Abschluss der Tod-Aktionen
  return p;
}

const publicRole = (s, p) => (s.options.revealRoles ? p.role : null);

// ---------- Nacht ----------

function startNight(s, events) {
  s.night += 1;
  s.phase = PHASE.NIGHT;
  s.votes = {};
  s.nightState = { data: {}, done: {}, opened: {}, shared: {} };
  log(s, 'night_start');
  events.push({ type: 'night_start', night: s.night });
}

// Rollen mit Nachtaktion, von denen mindestens ein lebender Spieler im Spiel ist.
function nightRoles(s) {
  const present = new Set(alive(s).map((p) => p.role));
  return allRoles().filter((r) => r.night && present.has(r.id));
}

function actorsOf(s, role) {
  return alive(s).filter((p) => p.role === role.id && (role.night.canAct ? role.night.canAct(s, p) : true));
}

// Rolle ist "fertig", wenn niemand mehr von ihr aktiv ist oder alle Akteure abgegeben haben.
function roleDone(s, ns, roleId) {
  const role = getRole(roleId);
  if (!role.night || !alive(s).some((p) => p.role === roleId)) return true;
  return !!ns.done[roleId];
}

const needsMet = (s, ns, role) => (role.night.needs || []).every((id) => roleDone(s, ns, id));

function progressNight(s, events, rng) {
  const ns = s.nightState;
  const roles = nightRoles(s);
  let changed = true;
  while (changed) {
    changed = false;
    for (const role of roles) {
      if (ns.done[role.id] || !needsMet(s, ns, role)) continue;
      const actors = actorsOf(s, role);
      if (!ns.opened[role.id]) {
        ns.opened[role.id] = true;
        role.night.onOpen?.(s, ns, actors, events);
      }
      if (actors.every((a) => a.id in (ns.data[role.id] || {}))) {
        ns.done[role.id] = true;
        role.night.onDone?.(s, ns, events, rng);
        changed = true;
      }
    }
  }
  if (roles.every((r) => ns.done[r.id])) resolveNight(s, events, rng);
}

// input: rollenspezifisch, z. B. { targetId } oder { heal, poisonId }
function nightAction(s, actorId, input = {}, rng = Math.random) {
  if (s.phase !== PHASE.NIGHT) fail('Gerade ist nicht Nacht.');
  const actor = byId(s, actorId);
  if (!actor || !actor.alive) fail('Du hast jetzt keine Aktion.');
  const role = roleOf(actor);
  if (!role.night) fail('Du hast nachts keine Aktion.');
  const ns = s.nightState;
  if (!needsMet(s, ns, role)) fail('Du bist noch nicht dran.');
  if (ns.done[role.id]) fail('Du hast dich schon entschieden.');
  if (!actorsOf(s, role).some((p) => p.id === actorId)) fail('Du hast jetzt keine Aktion.');
  const mine = ns.data[role.id] || (ns.data[role.id] = {});
  if (actorId in mine && !role.night.revisable) fail('Du hast dich schon entschieden.');

  const data = role.night.normalize(s, actor, input);
  mine[actorId] = data;
  const events = [{ type: 'night_action', userId: actorId, roleId: role.id, data }];
  role.night.onSubmit?.(s, actor, data, events);
  progressNight(s, events, rng);
  return events;
}

function resolveNight(s, events) {
  const ns = s.nightState;
  const ctx = { attacks: [], protected: new Set() };
  const order = (r) => r.night.resolveOrder ?? 50;
  for (const role of allRoles().filter((r) => r.night).sort((a, b) => order(a) - order(b))) {
    role.night.resolve?.(s, ns, ctx);
  }
  const deaths = [];
  for (const atk of ctx.attacks) {
    if (atk.blockable && ctx.protected.has(atk.id)) continue;
    if (deaths.some((d) => d.id === atk.id)) continue;
    const p = kill(s, atk.id, atk.cause);
    if (p) deaths.push({ id: p.id, cause: atk.cause });
  }
  s.nightState = null;
  s.day += 1;
  log(s, 'dawn', { deaths });
  events.push({ type: 'dawn', deaths: deaths.map((d) => ({ ...d, role: publicRole(s, byId(s, d.id)) })) });
  afterDeaths(s, deaths.map((d) => d.id), 'day', events);
}

// ---------- Tod-Aktionen / Weiterlauf ----------

function afterDeaths(s, deadIds, next, events) {
  s.next = next;
  for (const id of deadIds) {
    const p = byId(s, id);
    if (roleOf(p).deathTrigger && !p.triggered && !s.triggerQueue.includes(id)) s.triggerQueue.push(id);
  }
  nextTrigger(s, events);
}

function nextTrigger(s, events) {
  const id = s.triggerQueue.shift();
  if (!id) { proceed(s, events); return; }
  const p = byId(s, id);
  p.triggered = true;
  s.phase = PHASE.DEATH_TRIGGER;
  s.pendingTriggerId = id;
  log(s, 'trigger_pending', { playerId: id, roleId: p.role });
  events.push({ type: 'trigger_prompt', to: id, playerId: id, roleId: p.role });
}

function proceed(s, events) {
  const next = s.next;
  s.pendingTriggerId = null;
  s.next = null;
  const win = s.pendingWin || checkWin(s);
  if (win) { endGame(s, win, events); return; }
  if (next === 'day') {
    s.phase = PHASE.DAY_DISCUSS;
    s.votes = {};
    events.push({ type: 'day_start', day: s.day });
  } else {
    startNight(s, events);
  }
}

// targetId = null → verzichten
function deathAction(s, actorId, targetId = null) {
  if (s.phase !== PHASE.DEATH_TRIGGER) fail('Gerade gibt es keine Tod-Aktion.');
  if (actorId !== s.pendingTriggerId) fail('Du bist nicht dran.');
  const actor = byId(s, actorId);
  const trigger = roleOf(actor).deathTrigger;
  if (targetId && !trigger.targets(s, actor).some((p) => p.id === targetId)) fail('Ungültiges Ziel.');
  const events = [];
  const killed = [];
  for (const k of trigger.resolve(s, actor, targetId)) {
    const p = kill(s, k.id, k.cause);
    if (p) killed.push({ id: p.id, cause: k.cause, role: publicRole(s, p) });
  }
  log(s, 'death_trigger', { playerId: actorId, roleId: actor.role, kills: killed });
  events.push({ type: 'death_trigger', playerId: actorId, roleId: actor.role, kills: killed });
  afterDeaths(s, killed.map((k) => k.id), s.next, events);
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
    role: lynchedId ? publicRole(s, byId(s, lynchedId)) : null,
  });
  if (!lynchedId) { s.next = 'night'; proceed(s, events); return; }
  kill(s, lynchedId, 'lynch');
  afterDeaths(s, [lynchedId], 'night', events);
}

// ---------- Zeitablauf ----------

// Fehlende Aktionen gelten als Passen/Enthaltung; für Timeouts der Discord-Schicht.
function forceAdvance(s, rng = Math.random) {
  const events = [];
  switch (s.phase) {
    case PHASE.NIGHT: {
      const ns = s.nightState;
      for (let i = 0; i <= allRoles().length && s.phase === PHASE.NIGHT; i++) {
        for (const role of nightRoles(s)) {
          if (ns.done[role.id] || !needsMet(s, ns, role)) continue;
          const mine = ns.data[role.id] || (ns.data[role.id] = {});
          for (const a of actorsOf(s, role)) if (!(a.id in mine)) mine[a.id] = { timeout: true };
        }
        progressNight(s, events, rng);
      }
      break;
    }
    case PHASE.DAY_DISCUSS: events.push(...startVote(s)); break;
    case PHASE.DAY_VOTE: resolveVote(s, events); break;
    case PHASE.DEATH_TRIGGER: events.push(...deathAction(s, s.pendingTriggerId, null)); break;
    default: break;
  }
  return events;
}

// ---------- Sichten ----------

// Wer wird gerade erwartet? (Status, Erinnerungen, Prompts)
function waitingFor(s) {
  switch (s.phase) {
    case PHASE.NIGHT: {
      const ns = s.nightState;
      const ids = [];
      for (const role of nightRoles(s)) {
        if (ns.done[role.id] || !needsMet(s, ns, role)) continue;
        for (const a of actorsOf(s, role)) if (!(a.id in (ns.data[role.id] || {}))) ids.push(a.id);
      }
      return ids;
    }
    case PHASE.DAY_VOTE: return alive(s).filter((p) => !(p.id in s.votes)).map((p) => p.id);
    case PHASE.DEATH_TRIGGER: return [s.pendingTriggerId];
    default: return [];
  }
}

// Erlaubte Ziele einer Nachtaktion für den Akteur (für UI-Auswahl).
function nightTargets(s, actorId) {
  const actor = byId(s, actorId);
  return roleOf(actor).night?.targets?.(s, actor) || [];
}

function deathTargets(s, actorId) {
  const actor = byId(s, actorId);
  return roleOf(actor).deathTrigger?.targets(s, actor) || [];
}

// Geheime Info für die Rollen-DM.
function roleInfo(s, id) {
  const me = byId(s, id);
  const role = roleOf(me);
  const teammates = role.knowsTeam
    ? s.players.filter((p) => p.id !== id && teamOf(p) === role.team).map((p) => ({ id: p.id, name: p.name }))
    : [];
  return {
    role: me.role, name: role.name, emoji: role.emoji, description: role.description,
    team: role.team, teamName: TEAM_INFO[role.team].name, teamEmoji: TEAM_INFO[role.team].emoji, teammates,
  };
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
    winnerIds: s.winnerIds || null,
    log: s.log.slice(-30),
  };
}

module.exports = {
  PHASE, TEAMS, TEAM_INFO, rolesOfTeam, MIN_PLAYERS, MAX_PLAYERS,
  createGame, rolesFor, nightAction, deathAction, startVote, vote, forceAdvance,
  nightTargets, deathTargets, waitingFor, roleInfo, publicView, checkWin, shuffle,
};
