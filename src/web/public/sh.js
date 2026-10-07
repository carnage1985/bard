// Secret-Hitler-Renderer (registriert sich im Board-Kern, siehe board.js)
(() => {
const ICONS = { peek: ['🔮', 'Peek'], investigate: ['🔍', 'Investigate'], special: ['🎩', 'Spezialwahl'], execution: ['🔫', 'Hinrichtung'] };
const PHASES = {
  LOBBY: 'Lobby – Spieler sammeln sich',
  NOMINATE: 'Präsident nominiert einen Kanzler',
  VOTE: 'Abstimmung läuft',
  LEGISLATE_PRESIDENT: 'Präsident wählt Policies',
  LEGISLATE_CHANCELLOR: 'Kanzler erlässt eine Policy',
  VETO: 'Veto-Entscheidung',
  EXECUTIVE: 'Präsident nutzt seine Macht',
  GAME_OVER: 'Spiel beendet',
};
const nameOf = (v, id) => (v.players.find((p) => p.id === id) || {}).name || '?';

function logLine(v, e) {
  const n = (id) => `„${nameOf(v, id)}“`;
  switch (e.type) {
    case 'nominate': return `${n(e.presidentId)} nominiert ${n(e.chancellorId)}`;
    case 'vote': return `Wahl ${e.passed ? 'angenommen' : 'abgelehnt'} (${e.ja}:${e.nein})`;
    case 'policy': return `${e.policy === 'L' ? 'Liberale' : 'Faschistische'} Policy erlassen${e.chaos ? ' (Chaos)' : ''}`;
    case 'chaos': return 'Das Land versinkt im Chaos';
    case 'veto_request': return 'Kanzler schlägt Veto vor';
    case 'veto_accepted': return 'Veto angenommen';
    case 'veto_denied': return 'Veto abgelehnt';
    case 'peek': return 'Präsident wirft einen Blick auf den Stapel';
    case 'investigate': return `${n(e.presidentId)} untersucht ${n(e.targetId)}`;
    case 'special': return `${n(e.presidentId)} ruft Spezialwahl für ${n(e.targetId)} aus`;
    case 'execution': return `${n(e.presidentId)} richtet ${n(e.targetId)} hin`;
    case 'game_over': return `Spielende: ${e.reason}`;
    default: return null;
  }
}

function render(v) {
  ensureLayout();
  const banner = $('banner');
  banner.hidden = !v.winner;
  if (v.winner) {
    banner.className = `banner ${v.winner}`;
    banner.textContent = `${v.winner === 'L' ? 'Liberale' : 'Faschisten'} gewinnen – ${v.winReason}`;
  }
  $('libTrack').innerHTML = Array.from({ length: 5 }, (_, i) =>
    `<div class="slot ${i < v.liberal ? 'on' : ''}"><span class="ic">🕊️</span>${i === 4 ? 'Sieg' : ''}</div>`).join('');
  $('fasTrack').innerHTML = Array.from({ length: 6 }, (_, i) => {
    const p = v.powers[i];
    const [ic, label] = p ? ICONS[p] : (i === 5 ? ['💀', 'Sieg'] : ['', '']);
    const veto = i === 4 ? ' + Veto' : '';
    return `<div class="slot ${i < v.fascist ? 'on' : ''}"><span class="ic">${ic}</span>${label}${veto}</div>`;
  }).join('');
  $('tracker').className = 'dots';
  $('tracker').innerHTML = [0, 1, 2].map((i) => `<span class="${i < v.tracker ? 'on' : ''}"></span>`).join('');
  $('deck').textContent = v.deckCount;
  $('discard').textContent = v.discardCount;
  $('phase').textContent = (PHASES[v.phase] || v.phase) + (v.round ? ` · Runde ${v.round}` : '');
  $('players').innerHTML = v.players.map((p) => {
    const tags = [];
    if (p.id === v.presidentId && v.phase !== 'GAME_OVER') tags.push('Präsident');
    if (p.id === (v.chancellorId || v.candidateId) && v.phase !== 'LOBBY') tags.push(v.chancellorId ? 'Kanzler' : 'Kandidat');
    if (v.phase === 'VOTE') tags.push(p.voted ? '✓' : '…');
    if (p.id === v.lastChancId || p.id === v.lastPresId) tags.push('gesperrt');
    if (p.role) tags.push({ liberal: 'Liberal', fascist: 'Faschist', hitler: 'Hitler' }[p.role]);
    const cls = [!p.alive && 'dead', p.id === v.presidentId && 'pres', p.id === (v.chancellorId || v.candidateId) && 'chan'].filter(Boolean).join(' ');
    return `<li class="${cls}">${escapeHtml(p.name)}${tags.map((t) => `<span class="tag">${t}</span>`).join('')}</li>`;
  }).join('');
  $('log').innerHTML = v.log.map((e) => logLine(v, e)).filter(Boolean)
    .map((t) => `<li>${escapeHtml(t)}</li>`).reverse().join('');
}


const LAYOUT = `
  <section id="banner" class="banner" hidden></section>
  <section class="tracks">
    <div class="track lib"><h2>Liberale</h2><div id="libTrack" class="slots"></div></div>
    <div class="track fas"><h2>Faschisten</h2><div id="fasTrack" class="slots"></div></div>
  </section>
  <section class="meta">
    <div>Wahl-Tracker <span id="tracker" class="dots"></span></div>
    <div>Nachziehstapel <b id="deck">–</b> · Ablage <b id="discard">–</b></div>
    <div id="phase"></div>
  </section>
  <section><h2>Spieler</h2><ul id="players" class="players"></ul></section>
  <section><h2>Verlauf</h2><ol id="log" class="log"></ol></section>`;

function ensureLayout() {
  if (document.body.dataset.layout === 'sh') return;
  document.body.dataset.layout = 'sh';
  document.body.className = '';
  document.title = 'Secret Hitler – Spielplan';
  $('title').textContent = 'Secret Hitler';
  $('app').innerHTML = LAYOUT;
  $('credit').innerHTML = 'Secret Hitler von Mike Boxleiter, Tommy Maranges &amp; Mac Schubert – <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a> · <a href="https://secrethitler.com">secrethitler.com</a>. Diese Umsetzung ist ein nicht-kommerzieller Discord-Bot-Modus.';
}

registerRenderer('secrethitler', render);
})();
