const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const {
  watchConfig,
  setCharacterName,
  removeCharacterName,
  listCharacters,
} = require('../utils/voiceCharactersStore');
const { syncMemberCharacterName } = require('./voiceCharacters');

const command = new SlashCommandBuilder()
  .setName('dndchar')
  .setDescription('Verwaltet D&D-Charakternamen für Sprachkanäle.')
  .addSubcommand(sub => sub
    .setName('set')
    .setDescription('Setzt einen Charakternamen für einen User in einem Voice-Channel.')
    .addChannelOption(opt => opt.setName('channel').setDescription('Voice-Channel').setRequired(true))
    .addUserOption(opt => opt.setName('user').setDescription('Discord-User').setRequired(true))
    .addStringOption(opt => opt.setName('name').setDescription('Charaktername (max. 32 Zeichen)').setRequired(true).setMaxLength(32))
  )
  .addSubcommand(sub => sub
    .setName('remove')
    .setDescription('Entfernt einen Charakternamen.')
    .addChannelOption(opt => opt.setName('channel').setDescription('Voice-Channel').setRequired(true))
    .addUserOption(opt => opt.setName('user').setDescription('Discord-User').setRequired(true))
  )
  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('Listet alle Charakter-Mappings auf.')
    .addChannelOption(opt => opt.setName('channel').setDescription('Voice-Channel (optional)').setRequired(false))
  );

function formatList(guildId, channelId, logger) {
  const data = listCharacters(guildId, channelId, logger);
  const lines = [];
  for (const [chId, users] of Object.entries(data)) {
    lines.push(`• <#${chId}>`);
    for (const [userId, name] of Object.entries(users)) {
      lines.push(`  ↳ <@${userId}> → **${name}**`);
    }
  }
  return lines.length ? lines.join('\n') : 'ℹ️ Keine Charakter-Mappings vorhanden.';
}

function hasPermission(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageNicknames)
    || member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

async function getGuildMember(guild, userId) {
  if (!guild || !userId) return null;
  if (guild.members.cache.has(userId)) return guild.members.cache.get(userId);
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

module.exports = (client, logger = console) => {
  watchConfig(logger);

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'dndchar') return;

    if (!hasPermission(interaction.member)) {
      await interaction.reply({ content: '❌ Du brauchst das Recht **Manage Nicknames** (oder Manage Server), um das zu nutzen.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'set') {
        const channel = interaction.options.getChannel('channel');
        const user = interaction.options.getUser('user');
        const characterName = interaction.options.getString('name');

        setCharacterName(interaction.guildId, channel.id, user.id, characterName, logger);
        const member = await getGuildMember(interaction.guild, user.id);
        if (member?.voice?.channelId === channel.id) {
          await syncMemberCharacterName(member, channel.id, logger);
        }
        logger.info(`📝 D&D-Char gesetzt: guild=${interaction.guildId} channel=${channel.id} user=${user.id} → ${characterName}`);
        await interaction.reply({ content: `✅ Gespeichert: <@${user.id}> wird in <#${channel.id}> zu **${characterName}**.`, ephemeral: true });
        return;
      }

      if (sub === 'remove') {
        const channel = interaction.options.getChannel('channel');
        const user = interaction.options.getUser('user');

        const removed = removeCharacterName(interaction.guildId, channel.id, user.id, logger);
        if (!removed) {
          await interaction.reply({ content: 'ℹ️ Kein Eintrag gefunden, es wurde nichts gelöscht.', ephemeral: true });
          return;
        }
        const member = await getGuildMember(interaction.guild, user.id);
        if (member?.voice?.channelId === channel.id) {
          await syncMemberCharacterName(member, channel.id, logger);
        }
        logger.info(`🗑️ D&D-Char entfernt: guild=${interaction.guildId} channel=${channel.id} user=${user.id}`);
        await interaction.reply({ content: `✅ Mapping entfernt für <@${user.id}> in <#${channel.id}>.`, ephemeral: true });
        return;
      }

      if (sub === 'list') {
        const channel = interaction.options.getChannel('channel');
        const listText = formatList(interaction.guildId, channel?.id ?? null, logger);
        await interaction.reply({ content: listText, ephemeral: true });
      }
    } catch (err) {
      logger.error('❌ Fehler im /dndchar-Command:', err);
      const errMsg = { content: '❌ Da ist etwas schiefgelaufen. Schau ins Log für Details.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.editReply(errMsg).catch(() => {});
      else await interaction.reply(errMsg).catch(() => {});
    }
  });
};

module.exports.command = command;
