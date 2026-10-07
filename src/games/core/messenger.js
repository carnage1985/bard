// Gemeinsame Discord-Helfer für Spiele: Kanal-Nachrichten, DMs, Komponenten, Voice-Mute.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags,
} = require('discord.js');

const EPHEMERAL = MessageFlags.Ephemeral;

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const playerSelect = (customId, placeholder, players) => new StringSelectMenuBuilder()
  .setCustomId(customId).setPlaceholder(placeholder)
  .addOptions(players.map((p) => ({ label: p.name.slice(0, 100), value: p.id })));

function createMessenger(client, logger = console) {
  const quiet = (msg, ...a) => logger.info(msg, ...a, { toDiscord: false });

  const channelOf = (game) => client.channels.fetch(game.channelId).catch(() => null);

  async function say(game, payload) {
    const ch = await channelOf(game);
    if (!ch) return null;
    try { return await ch.send(typeof payload === 'string' ? { content: payload } : payload); } catch (err) {
      logger.error('❌ Spiel: Senden fehlgeschlagen:', err);
      return null;
    }
  }

  async function dm(userId, payload) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(payload);
      return true;
    } catch (err) {
      quiet(`⚠️ Spiel: DM an ${userId} fehlgeschlagen (${err.code || err.message}).`);
      return false;
    }
  }

  // Privates Ergebnis: direkt ephemeral an den Interaction-User, sonst per DM.
  async function deliverPrivate(userId, text, interaction) {
    if (interaction && interaction.user.id === userId) {
      await interaction.followUp({ content: text, flags: EPHEMERAL }).catch(() => dm(userId, { content: text }));
    } else {
      await dm(userId, { content: text });
    }
  }

  async function setMute(game, userId, mute = true) {
    try {
      const ch = await channelOf(game);
      const member = await ch?.guild.members.fetch(userId);
      if (member?.voice.channelId) await member.voice.setMute(mute, 'Spielmodus');
    } catch (err) {
      quiet(`ℹ️ Spiel: Mute für ${userId} nicht möglich (${err.code || err.message}).`);
    }
  }

  return { quiet, channelOf, say, dm, deliverPrivate, setMute };
}

module.exports = { EPHEMERAL, row, btn, playerSelect, createMessenger };
