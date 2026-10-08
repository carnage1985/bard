// Werwolf-Renderer (registriert sich im Board-Kern, siehe board.js)
(() => {
const PHASES = {
  LOBBY: ['🛋️', 'Lobby – Spieler sammeln sich'],
  NIGHT: ['🌙', 'Nacht – das Dorf schläft'],
  DAY_DISCUSS: ['☀️', 'Tag – Diskussion'],
  DAY_VOTE: ['🗳️', 'Abstimmung läuft'],
  DEATH_TRIGGER: ['⚡', 'Letzte Aktion'],
  GAME_OVER: ['🏁', 'Spiel beendet'],
};
const CAUSES = { wolves: '🐺 gerissen', witch: '☠️ vergiftet', hunter: '🏹 erschossen', granny: '👵 von Granny erschossen', lynch: '⚖️ gelyncht' };
const TEAM_NAMES = { village: 'Das Dorf', wolves: 'Die Werwölfe', neutral: 'Eine neutrale Rolle' };

const LAYOUT = `
  <section id="banner" class="banner" hidden></section>
  <section class="meta">
    <div id="phase" class="phase"></div>
    <div id="clock" class="clock"></div>
  </section>
  <section id="compSection"><h2>Rollen im Spiel</h2><div id="comp" class="comp"></div></section>
  <section><h2>Spieler <span id="count" class="mut"></span></h2><ul id="players" class="players ww"></ul></section>
  <section><h2>Verlauf</h2><ol id="log" class="log"></ol></section>`;

const CREDIT = 'Werwolf/Mafia ist ein freies Gesellschaftsspiel. Diese Umsetzung ist ein nicht-kommerzieller Discord-Bot-Modus.';
let deadline = null;
let ticker = null;

function ensureLayout() {
  if (document.body.dataset.layout === 'ww') return;
  document.body.dataset.layout = 'ww';
  $('title').textContent = 'Werwolf';
  document.title = 'Werwolf – Spielplan';
  $('app').innerHTML = LAYOUT;
  $('credit').textContent = CREDIT;
}

function clock() {
  const el = $('clock');
  if (!el) return;
  if (!deadline) { el.textContent = ''; return; }
  const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  el.textContent = `⏱️ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

const roleLabel = (v, id) => {
  const r = v.roles && v.roles[id];
  return r ? `${r.emoji} ${r.name}` : '';
};

function logLine(v, e) {
  const name = (id) => `„${(v.players.find((p) => p.id === id) || {}).name || '?'}“`;
  switch (e.type) {
    case 'night_start': return `🌙 Nacht ${e.night} beginnt`;
    case 'dawn': return e.deaths.length
      ? `🌅 Morgen: ${e.deaths.map((d) => `${name(d.id)} ${CAUSES[d.cause] || 'gestorben'}`).join(', ')}`
      : '🌅 Morgen: niemand ist gestorben';
    case 'vote_start': return '🗳️ Abstimmung beginnt';
    case 'vote_result': return e.lynchedId ? `⚖️ ${name(e.lynchedId)} wird gelyncht` : '⚖️ Niemand wird gelyncht';
    case 'trigger_pending': return `⚡ ${name(e.playerId)} hat eine letzte Aktion`;
    case 'death_trigger': return e.kills.length
      ? `⚡ ${name(e.playerId)} nimmt ${e.kills.map((k) => name(k.id)).join(', ')} mit`
      : `⚡ ${name(e.playerId)} verzichtet`;
    case 'game_over': return `🏁 ${e.reason}`;
    default: return null;
  }
}

function render(v) {
  ensureLayout();
  document.body.className = v.phase === 'GAME_OVER' ? 'ww over' : (v.isNight ? 'ww night' : 'ww day');

  const banner = $('banner');
  banner.hidden = !v.winner;
  if (v.winner) {
    banner.className = `banner ${v.winner}`;
    banner.textContent = `${TEAM_NAMES[v.winner] || v.winner} gewinnt – ${v.winReason}`;
  }

  const [icon, label] = PHASES[v.phase] || ['', v.phase];
  const round = v.phase === 'LOBBY' ? '' : ` · ${v.isNight ? `Nacht ${v.night}` : `Tag ${v.day}`}`;
  $('phase').textContent = `${icon} ${label}${round}`;
  deadline = v.deadline || null;
  clearInterval(ticker);
  clock();
  if (deadline) ticker = setInterval(clock, 1000);

  const groups = v.composition || [];
  $('compSection').hidden = !groups.length;
  $('comp').innerHTML = groups.map((g) => `<div class="cteam ${g.team}"><b>${g.emoji} ${escapeHtml(g.name)}</b> ${
    g.roles.map((r) => `<span class="chip">${r.emoji} ${escapeHtml(r.name)}${r.count > 1 ? ` ×${r.count}` : ''}</span>`).join('')}</div>`).join('');

  $('count').textContent = v.phase === 'LOBBY' ? `(${v.players.length})` : `(${v.aliveCount} am Leben)`;
  $('players').innerHTML = v.players.map((p) => {
    const tags = [];
    if (!p.alive && p.cause) tags.push(CAUSES[p.cause] || 'tot');
    else if (!p.alive) tags.push('tot');
    if (p.role) tags.push(roleLabel(v, p.role));
    if (v.phase === 'DAY_VOTE' && p.alive) tags.push(p.voted ? '✓ gewählt' : '… offen');
    const team = p.role && v.roles[p.role] ? v.roles[p.role].team : '';
    return `<li class="${[!p.alive && 'dead', team].filter(Boolean).join(' ')}"><span class="pname">${escapeHtml(p.name)}</span>${
      tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</li>`;
  }).join('');

  $('log').innerHTML = (v.log || []).map((e) => logLine(v, e)).filter(Boolean)
    .map((t) => `<li>${escapeHtml(t)}</li>`).reverse().join('');
}

registerRenderer('werewolf', render);
})();
