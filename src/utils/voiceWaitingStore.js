const fs = require('fs');
const path = require('path');
const { getDataFilePath, migrateLegacyFile } = require('./dataFilePath');

const LEGACY_CONFIG_PATH = path.join(__dirname, '..', 'voiceWaiting.json');
const CONFIG_PATH = getDataFilePath('voiceWaiting.json');

let config = {};
let lastConfigMtimeMs = 0;
let watching = false;
let loaded = false;

function persist(logger) {
  try {
    migrateLegacyFile('voiceWaiting.json', LEGACY_CONFIG_PATH, logger);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    try {
      const stats = fs.statSync(CONFIG_PATH);
      lastConfigMtimeMs = stats.mtimeMs;
    } catch {
      lastConfigMtimeMs = Date.now();
    }
  } catch (err) {
    logger?.error('❌ Konnte voiceWaiting.json nicht speichern:', err);
    throw err;
  }
}

function readConfig(logger) {
  try {
    migrateLegacyFile('voiceWaiting.json', LEGACY_CONFIG_PATH, logger);
    const stats = fs.statSync(CONFIG_PATH);
    if (stats.mtimeMs === lastConfigMtimeMs && Object.keys(config).length) return config;

    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(raw || '{}');
    lastConfigMtimeMs = stats.mtimeMs;
    loaded = true;
    logger?.info('🕒 voiceWaiting.json neu geladen.');
  } catch (err) {
    if (err.code === 'ENOENT') {
      const hasExistingConfig = Object.keys(config).length > 0;
      logger?.[hasExistingConfig ? 'warn' : 'info'](
        hasExistingConfig
          ? '⚠️ voiceWaiting.json nicht gefunden – vorhandene Konfiguration wird neu gespeichert.'
          : '🆕 voiceWaiting.json nicht gefunden – lege leere Datei an.',
      );
      if (!hasExistingConfig) config = {};
      loaded = true;
      try {
        persist(logger);
      } catch (persistErr) {
        logger?.error('❌ Konnte voiceWaiting.json nicht neu erstellen:', persistErr);
      }
    } else {
      logger?.error('❌ Konnte voiceWaiting.json nicht laden:', err);
    }
  }

  return config;
}

function ensureLoaded(logger) {
  if (!loaded) {
    readConfig(logger);
  }
}

function watchConfig(logger) {
  if (watching) return;
  watching = true;
  ensureLoaded(logger);
  fs.watchFile(CONFIG_PATH, { interval: 5000 }, () => readConfig(logger));
}

function getWaitingChannelConfig(guildId, channelId, logger) {
  ensureLoaded(logger);
  if (!guildId || !channelId) return null;
  return config?.[guildId]?.[channelId] ?? null;
}

function setWaitingChannel(guildId, channelId, waitMinutes, logger) {
  ensureLoaded(logger);
  if (!config[guildId]) config[guildId] = {};
  config[guildId][channelId] = { waitMinutes };
  persist(logger);
}

function removeWaitingChannel(guildId, channelId, logger) {
  ensureLoaded(logger);
  if (!config[guildId]?.[channelId]) return false;

  delete config[guildId][channelId];
  if (!Object.keys(config[guildId]).length) {
    delete config[guildId];
  }
  persist(logger);
  return true;
}

function listWaitingChannels(guildId, logger) {
  ensureLoaded(logger);
  if (!guildId) return {};
  return config?.[guildId] ?? {};
}

module.exports = {
  CONFIG_PATH,
  watchConfig,
  getWaitingChannelConfig,
  setWaitingChannel,
  removeWaitingChannel,
  listWaitingChannels,
};
