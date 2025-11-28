const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'voiceCharacters.json');

let config = {};
let lastConfigMtimeMs = 0;
let watching = false;

function readConfig(logger) {
  try {
    const stats = fs.statSync(CONFIG_PATH);
    if (stats.mtimeMs === lastConfigMtimeMs && Object.keys(config).length) return config;

    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(raw || '{}');
    lastConfigMtimeMs = stats.mtimeMs;
    logger?.info('🎭 voiceCharacters.json neu geladen.');
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (Object.keys(config).length) {
        logger?.warn('⚠️ voiceCharacters.json nicht gefunden – leere Konfiguration genutzt.');
      }
      config = {};
      lastConfigMtimeMs = 0;
    } else {
      logger?.error('❌ Konnte voiceCharacters.json nicht laden:', err);
    }
  }
  return config;
}

function ensureLoaded(logger) {
  if (!lastConfigMtimeMs && !Object.keys(config).length) {
    readConfig(logger);
  }
}

function watchConfig(logger) {
  if (watching) return;
  watching = true;
  ensureLoaded(logger);
  fs.watchFile(CONFIG_PATH, { interval: 5000 }, () => readConfig(logger));
}

function getCharacterName(guildId, channelId, userId, logger) {
  ensureLoaded(logger);
  if (!guildId || !channelId || !userId) return null;
  return config?.[guildId]?.[channelId]?.[userId] ?? null;
}

function persist(logger) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    try {
      const stats = fs.statSync(CONFIG_PATH);
      lastConfigMtimeMs = stats.mtimeMs;
    } catch {
      lastConfigMtimeMs = Date.now();
    }
  } catch (err) {
    logger?.error('❌ Konnte voiceCharacters.json nicht speichern:', err);
    throw err;
  }
}

function setCharacterName(guildId, channelId, userId, characterName, logger) {
  ensureLoaded(logger);
  if (!config[guildId]) config[guildId] = {};
  if (!config[guildId][channelId]) config[guildId][channelId] = {};
  config[guildId][channelId][userId] = characterName;
  persist(logger);
}

function removeCharacterName(guildId, channelId, userId, logger) {
  ensureLoaded(logger);
  if (!config[guildId]?.[channelId]?.[userId]) return false;

  delete config[guildId][channelId][userId];
  if (!Object.keys(config[guildId][channelId]).length) {
    delete config[guildId][channelId];
  }
  if (!Object.keys(config[guildId]).length) {
    delete config[guildId];
  }
  persist(logger);
  return true;
}

function listCharacters(guildId, channelId, logger) {
  ensureLoaded(logger);
  if (!guildId) return {};
  if (channelId) {
    const entries = config?.[guildId]?.[channelId] ?? {};
    return entries && Object.keys(entries).length ? { [channelId]: entries } : {};
  }
  return config?.[guildId] ?? {};
}

module.exports = {
  CONFIG_PATH,
  watchConfig,
  getCharacterName,
  setCharacterName,
  removeCharacterName,
  listCharacters,
};
