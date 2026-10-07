// Sitzungsregister: ein laufendes Spiel pro Server, unabhängig vom Spieltyp.
// Wird von allen Spiel-Modulen geteilt (gleiche Instanz via require-Cache).
const store = require('./store');

const games = new Map(); // guildId -> game ({ type, guildId, channelId, hostId, code, lobby, state, ... })
let logger = console;
let restored = false;

function init(log) {
  logger = log || console;
}

function persist() {
  store.save(Object.fromEntries(games), logger);
}

// Lädt gespeicherte Spiele einmalig und gibt die eines Typs zurück.
function restore(type) {
  if (!restored) {
    restored = true;
    for (const [gid, g] of Object.entries(store.load(logger))) games.set(gid, g);
  }
  return [...games.values()].filter((g) => g.type === type);
}

const get = (guildId) => games.get(guildId);
const set = (guildId, game) => games.set(guildId, game);
const remove = (guildId) => games.delete(guildId);

module.exports = { init, persist, restore, get, set, remove, all: () => [...games.values()] };
