const { SlashCommandBuilder, ChannelType, PermissionsBitField, MessageFlags } = require('discord.js');
const { listActivePings, clearActivePing } = require('../utils/voiceWaitingStore');

const MAX_SCAN = 1000;
const BULK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000 - 60 * 1000; // Discord: Bulk-Delete nur < 14 Tage

const command = new SlashCommandBuilder()
  .setName('cls')
  .setDescription('Löscht alle Nachrichten des Bots in einem Kanal.')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
  .addChannelOption(opt => opt
    .setName('channel')
    .setDescription('Kanal (Standard: aktueller Kanal, auch Text-Chat von Sprachkanälen)')
    .addChannelTypes(
      ChannelType.GuildText,
      ChannelType.GuildVoice,
      ChannelType.GuildStageVoice,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread,
    )
  );

module.exports = (client, logger = console) => {
  async function collectOwnMessages(channel) {
    const own = [];
    let before;
    let scanned = 0;

    while (scanned < MAX_SCAN) {
      const batch = await channel.messages.fetch({ limit: 100, before });
      if (!batch.size) break;
      scanned += batch.size;
      for (const message of batch.values()) {
        if (message.author.id === client.user.id) own.push(message);
      }
      before = batch.last().id;
      if (batch.size < 100) break;
    }

    return { own, scanned };
  }

  async function deleteMessages(channel, messages, canBulk) {
    const deleted = new Set();
    const cutoff = Date.now() - BULK_MAX_AGE_MS;

    if (canBulk) {
      const young = messages.filter(m => m.createdTimestamp > cutoff);
      for (let i = 0; i < young.length; i += 100) {
        const chunk = young.slice(i, i + 100);
        if (chunk.length < 2) break; // einzelne Nachricht unten normal löschen
        const result = await channel.bulkDelete(chunk, true).catch(err => {
          logger.warn(`⚠️ /cls: Bulk-Delete fehlgeschlagen: ${err.message}`);
          return null;
        });
        result?.forEach((_, id) => deleted.add(id));
      }
    }

    for (const message of messages) {
      if (deleted.has(message.id)) continue;
      try {
        await message.delete();
        deleted.add(message.id);
      } catch (err) {
        if (err.code === 10008) deleted.add(message.id); // war schon weg
        else logger.warn(`⚠️ /cls: Nachricht ${message.id} nicht löschbar: ${err.message}`);
      }
    }

    return deleted;
  }

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'cls') return;

    if (!interaction.inGuild()) {
      await interaction.reply({ content: '❌ Das geht nur auf einem Server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const guild = interaction.guild;

    try {
      const userPerms = channel.permissionsFor(interaction.member);
      if (!userPerms?.has(PermissionsBitField.Flags.ManageMessages)) {
        await interaction.reply({ content: '❌ Du brauchst das Recht **Nachrichten verwalten** in diesem Kanal.', flags: MessageFlags.Ephemeral });
        return;
      }

      const botPerms = channel.permissionsFor(guild.members.me);
      if (!botPerms?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory])) {
        await interaction.reply({ content: `❌ Ich darf in <#${channel.id}> keinen Verlauf lesen (**Kanal ansehen** + **Nachrichtenverlauf lesen**).`, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const { own, scanned } = await collectOwnMessages(channel);
      const canBulk = botPerms.has(PermissionsBitField.Flags.ManageMessages);
      const deleted = await deleteMessages(channel, own, canBulk);

      // Aktive Alleine-Pings, die dabei mit gelöscht wurden, aus dem Store entfernen
      for (const [voiceChannelId, ping] of Object.entries(listActivePings(guild.id, logger))) {
        if (ping.channelId === channel.id && deleted.has(ping.messageId)) {
          clearActivePing(guild.id, voiceChannelId, logger);
        }
      }

      logger.info(`🧹 /cls von ${interaction.user.tag}: ${deleted.size}/${own.length} Bot-Nachrichten in channel=${channel.id} gelöscht (${scanned} durchsucht)`);
      const failed = own.length - deleted.size;
      await interaction.editReply(
        `🧹 ${deleted.size} Nachricht(en) in <#${channel.id}> gelöscht (${scanned} durchsucht).`
        + (failed ? `\n⚠️ ${failed} konnten nicht gelöscht werden.` : '')
      );
    } catch (err) {
      logger.error('❌ Fehler im /cls-Command:', err);
      const errMsg = { content: '❌ Da ist etwas schiefgelaufen. Schau ins Log für Details.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.editReply(errMsg.content).catch(() => {});
      else await interaction.reply(errMsg).catch(() => {});
    }
  });
};

module.exports.command = command;
