const fs = require('fs');
const { getDataFilePath } = require('./dataFilePath');

const CONFIG_PATH = getDataFilePath('serverStatus.json');

let config = {};
let lastConfigMtimeMs = 0;
let watching = false;
let loaded = false;

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
    logger?.error('❌ Konnte serverStatus.json nicht speichern:', err);
    throw err;
  }
}

function readConfig(logger) {
  try {
    const stats = fs.statSync(CONFIG_PATH);
    if (stats.mtimeMs === lastConfigMtimeMs && loaded) return config;

    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(raw || '{}');
    lastConfigMtimeMs = stats.mtimeMs;
    loaded = true;
    logger?.info('🕒 serverStatus.json neu geladen.');
  } catch (err) {
    if (err.code === 'ENOENT') {
      const hasExisting = Object.keys(config).length > 0;
      logger?.[hasExisting ? 'warn' : 'info'](
        hasExisting
          ? '⚠️ serverStatus.json nicht gefunden – vorhandene Konfiguration wird neu gespeichert.'
          : '🆕 serverStatus.json nicht gefunden – lege leere Datei an.',
      );
      if (!hasExisting) config = {};
      loaded = true;
      try {
        persist(logger);
      } catch (persistErr) {
        logger?.error('❌ Konnte serverStatus.json nicht neu erstellen:', persistErr);
      }
    } else {
      logger?.error('❌ Konnte serverStatus.json nicht laden:', err);
    }
  }

  return config;
}

function ensureLoaded(logger) {
  if (!loaded) readConfig(logger);
}

function watchConfig(logger) {
  if (watching) return;
  watching = true;
  ensureLoaded(logger);
  fs.watchFile(CONFIG_PATH, { interval: 5000 }, () => readConfig(logger));
}

function setStatusConfig(guildId, channelId, intervalSeconds, messageId, logger) {
  ensureLoaded(logger);
  config[guildId] = {
    channelId,
    intervalSeconds,
    messageId: messageId ?? null,
  };
  persist(logger);
}

function updateMessageId(guildId, messageId, logger) {
  ensureLoaded(logger);
  if (!config[guildId]) return;
  config[guildId].messageId = messageId;
  persist(logger);
}

function removeStatusConfig(guildId, logger) {
  ensureLoaded(logger);
  if (!config[guildId]) return false;
  delete config[guildId];
  persist(logger);
  return true;
}

function getStatusConfig(guildId, logger) {
  ensureLoaded(logger);
  return config[guildId] ?? null;
}

function listAllConfigs(logger) {
  ensureLoaded(logger);
  return { ...config };
}

module.exports = {
  CONFIG_PATH,
  watchConfig,
  setStatusConfig,
  updateMessageId,
  removeStatusConfig,
  getStatusConfig,
  listAllConfigs,
};
