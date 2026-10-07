// Persistenz aktiver Secret-Hitler-Spiele (Neustart-Festigkeit).
const fs = require('fs');
const { getDataFilePath } = require('../../utils/dataFilePath');

const FILE = 'secretHitler.json';

function load(logger) {
  try {
    const raw = fs.readFileSync(getDataFilePath(FILE), 'utf8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    if (err.code !== 'ENOENT') logger?.error('❌ Konnte secretHitler.json nicht laden:', err);
    return {};
  }
}

// Atomar schreiben (tmp + rename), damit ein Absturz die Datei nicht zerstört.
function save(games, logger) {
  try {
    const target = getDataFilePath(FILE);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(games));
    fs.renameSync(tmp, target);
  } catch (err) {
    logger?.error('❌ Konnte secretHitler.json nicht speichern:', err);
  }
}

module.exports = { load, save };
