const {
  watchConfig,
  getCharacterName,
} = require('../utils/voiceCharactersStore');

const originalNames = new Map();

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
  watchConfig(logger);

  client.on('voiceStateUpdate', async (oldState, newState) => {
    // Bots ignorieren
    if (newState.member?.user?.bot || oldState.member?.user?.bot) return;

    const member = newState.member || oldState.member;
    if (!member) return;

    const key = `${member.guild.id}:${member.id}`;
    const previousChannelId = oldState.channelId;
    const nextChannelId = newState.channelId;

    const previousChar = getCharacterName(member.guild.id, previousChannelId, member.id, logger);
    const nextChar = getCharacterName(member.guild.id, nextChannelId, member.id, logger);

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
