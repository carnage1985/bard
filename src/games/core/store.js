// Generische Persistenz aktiver Spiele: games.json (guildId -> Spiel mit Feld `type`).
// Migriert das alte secretHitler.json (Spiele ohne `type` gelten als Secret Hitler).
const fs = require('fs');
const { getDataFilePath } = require('../../utils/dataFilePath');

const FILE = 'games.json';
const LEGACY_FILES = { 'secretHitler.json': 'sh' };

function readJson(name, logger) {
  try {
    return JSON.parse(fs.readFileSync(getDataFilePath(name), 'utf8') || '{}');
  } catch (err) {
    if (err.code !== 'ENOENT') logger?.error(`❌ Konnte ${name} nicht laden:`, err);
    return null;
  }
}

function load(logger) {
  const games = readJson(FILE, logger);
  if (games) return games;
  const migrated = {};
  for (const [file, type] of Object.entries(LEGACY_FILES)) {
    const legacy = readJson(file, logger);
    for (const [gid, g] of Object.entries(legacy || {})) migrated[gid] = { type, ...g };
  }
  return migrated;
}

// Atomar schreiben (tmp + rename), damit ein Absturz die Datei nicht zerstört.
function save(games, logger) {
  try {
    const target = getDataFilePath(FILE);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(games));
    fs.renameSync(tmp, target);
  } catch (err) {
    logger?.error('❌ Konnte games.json nicht speichern:', err);
  }
}

module.exports = { load, save };
