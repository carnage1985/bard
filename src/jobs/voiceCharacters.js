const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'voiceCharacters.json');
const originalNames = new Map();
let config = {};
let lastConfigMtimeMs = 0;

function loadConfig(logger) {
  try {
    const stats = fs.statSync(CONFIG_PATH);
    if (stats.mtimeMs === lastConfigMtimeMs && Object.keys(config).length) return;
    lastConfigMtimeMs = stats.mtimeMs;
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(raw);
    logger.info('🎭 voiceCharacters.json neu geladen.');
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (Object.keys(config).length) {
        logger.warn('⚠️ voiceCharacters.json nicht gefunden – leere Konfiguration genutzt.');
      }
      config = {};
      lastConfigMtimeMs = 0;
    } else {
      logger.error('❌ Konnte voiceCharacters.json nicht laden:', err);
    }
  }
}

function getCharacterName(guildId, channelId, userId) {
  if (!guildId || !channelId || !userId) return null;
  return config?.[guildId]?.[channelId]?.[userId] ?? null;
}

async function applyNickname(member, nickname, logger) {
  if (!member.manageable) {
    logger.warn(`⚠️ Kann Nick von ${member.user.tag} nicht setzen (fehlende Rechte?).`);
    return;
  }
  if (member.nickname === nickname) return;
  try {
    await member.setNickname(nickname, 'D&D Charaktername gesetzt');
  } catch (err) {
    logger.error(`❌ Konnte Nick von ${member.user.tag} nicht setzen:`, err);
  }
}

async function restoreNickname(member, key, logger) {
  const original = originalNames.get(key);
  if (!original) return;
  originalNames.delete(key);
  if (!member.manageable) {
    logger.warn(`⚠️ Kann Original-Nick von ${member.user.tag} nicht wiederherstellen (fehlende Rechte?).`);
    return;
  }
  if (member.nickname === original) return;
  try {
    await member.setNickname(original, 'D&D Charaktername beendet');
  } catch (err) {
    logger.error(`❌ Konnte Original-Nick von ${member.user.tag} nicht wiederherstellen:`, err);
  }
}

module.exports = (client, logger = console) => {
  loadConfig(logger);
  fs.watchFile(CONFIG_PATH, { interval: 5000 }, () => loadConfig(logger));

  client.on('voiceStateUpdate', async (oldState, newState) => {
    // Bots ignorieren
    if (newState.member?.user?.bot || oldState.member?.user?.bot) return;

    loadConfig(logger);

    const member = newState.member || oldState.member;
    if (!member) return;

    const key = `${member.guild.id}:${member.id}`;
    const previousChannelId = oldState.channelId;
    const nextChannelId = newState.channelId;

    const previousChar = getCharacterName(member.guild.id, previousChannelId, member.id);
    const nextChar = getCharacterName(member.guild.id, nextChannelId, member.id);

    // Wenn wir in einen Charakter-Channel joinen oder wechseln, Nickname setzen
    if (nextChar) {
      if (!originalNames.has(key)) {
        originalNames.set(key, member.nickname ?? member.user.username);
      }
      await applyNickname(member, nextChar, logger);
      return;
    }

    // Wenn wir einen Charakter-Channel verlassen, originalen Nick zurücksetzen
    if (previousChar || (!nextChannelId && originalNames.has(key))) {
      await restoreNickname(member, key, logger);
    }
  });
};
