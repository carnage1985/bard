// Rollen-Registry: jede Datei in diesem Ordner (nicht "index.js", nicht "_*") definiert genau
// eine Rolle und wird automatisch geladen (wie src/jobs/). Neue Rolle = neue Datei, siehe _template.js
// und docs/werewolf-roles.md. Die Engine kennt keine konkrete Rolle.
const fs = require('fs');
const path = require('path');

const { TEAMS } = require('../teams');
const ROLES = {};

function validate(def) {
  const where = `Rolle "${def?.id}"`;
  if (!def || !/^[a-z][a-z0-9_]*$/.test(def.id || '')) throw new Error(`${where}: ungültige id`);
  if (!def.name) throw new Error(`${where}: name fehlt`);
  if (!Object.values(TEAMS).includes(def.team)) throw new Error(`${where}: ungültiges team`);
  if (def.night) {
    const n = def.night;
    if (n.group !== undefined && typeof n.group !== 'string') throw new Error(`${where}: night.group muss eine Rollen-ID sein`);
    if (n.group === undefined && typeof n.normalize !== 'function') throw new Error(`${where}: night.normalize fehlt`);
    if (n.needs && !Array.isArray(n.needs)) throw new Error(`${where}: night.needs muss ein Array sein`);
  }
  if (def.deathTrigger && typeof def.deathTrigger.resolve !== 'function') {
    throw new Error(`${where}: deathTrigger.resolve fehlt`);
  }
}

function registerRole(def) {
  validate(def);
  ROLES[def.id] = { order: 100, ...def };
  return ROLES[def.id];
}

function unregisterRole(id) {
  delete ROLES[id];
}

// Ordner = Seite: village/ (Dorf), wolves/ (Werwölfe), neutral/ (Neutral). Maßgeblich ist `team` in der
// Rollen-Datei; der Ordner dient nur der Übersicht (Abweichung wird beim Laden abgelehnt).
function loadDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name === 'index.js') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { loadDir(full); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const def = registerRole(require(full));
    const folder = path.basename(dir);
    if (Object.values(TEAMS).includes(folder) || ['village', 'wolves', 'neutral'].includes(folder)) {
      if (def.team !== folder) throw new Error(`Rolle "${def.id}" liegt in ${folder}/, hat aber team "${def.team}".`);
    }
  }
}
loadDir(__dirname);

const getRole = (id) => {
  const r = ROLES[id];
  if (!r) throw new Error(`Unbekannte Rolle: ${id}`);
  return r;
};
const allRoles = () => Object.values(ROLES).sort((a, b) => a.order - b.order);
const rolesOfTeam = (team) => allRoles().filter((r) => r.team === team);

module.exports = { TEAMS, registerRole, unregisterRole, getRole, allRoles, rolesOfTeam };
