// src/jobs/geminiChat.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const Groq = require('groq-sdk');

const MODEL = 'llama-3.3-70b-versatile';
const MAX_HISTORY_PAIRS = 10;
const HISTORY_TTL_MS = 30 * 60 * 1000;
const DISCORD_MAX_LENGTH = 2000;

const SYSTEM_PROMPT = `Du bist Bard, ein charismatischer Barde aus der Welt von Dungeons & Dragons.
Du sprichst stets in einer blumigen, poetischen und leicht altmodischen Sprache – voller Metaphern, Redewendungen und gelegentlichen Reimen.
Du nennst den Gesprächspartner gerne "tapferer Recke", "werte Seele", "guter Freund" oder ähnliches.
Du beziehst dich auf deine Abenteuer, deine Laute und die Tavernen, in denen du gespielt hast.
Du beantwortest alle Fragen vollständig und hilfreich – nur eben im Stil eines Barden.
Wenn dir jemand eine nüchterne, moderne Frage stellt, beantworte sie trotzdem korrekt, aber verpacke sie in deine bardische Erzählweise.`;

const command = new SlashCommandBuilder()
  .setName('chat')
  .setDescription('Chattet mit Bard via AI.')
  .addStringOption(opt => opt
    .setName('message')
    .setDescription('Deine Nachricht (oder "reset" um den Verlauf zu löschen)')
    .setRequired(true)
  );

module.exports = (client, logger = console) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    logger.warn('⚠️ GROQ_API_KEY nicht gesetzt – Chat ist deaktiviert.', { toDiscord: false });
    return;
  }

  const groq = new Groq({ apiKey });

  // Map<key, { history: Array<{role, content}>, lastActivity: number }>
  const conversations = new Map();

  function conversationKey(source) {
    // source kann eine message oder interaction sein
    if (source.channel?.isDMBased?.() || source.channelId === null) {
      return `dm_${source.user?.id ?? source.author?.id}`;
    }
    return `ch_${source.channelId ?? source.channel?.id}`;
  }

  function getHistory(key) {
    const entry = conversations.get(key);
    if (!entry) return [];
    if (Date.now() - entry.lastActivity > HISTORY_TTL_MS) {
      conversations.delete(key);
      return [];
    }
    return entry.history;
  }

  function appendHistory(key, role, content) {
    let entry = conversations.get(key);
    if (!entry) {
      entry = { history: [], lastActivity: Date.now() };
      conversations.set(key, entry);
    }
    entry.history.push({ role, content });
    entry.lastActivity = Date.now();
    if (entry.history.length > MAX_HISTORY_PAIRS * 2) {
      entry.history.splice(0, 2);
    }
  }

  function clearHistory(key) {
    conversations.delete(key);
  }

  async function askGroq(history, userText) {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userText },
      ],
    });
    return completion.choices[0].message.content;
  }

  function splitChunks(text) {
    return text.match(/[\s\S]{1,1990}/g) || [];
  }

  // ── Slash-Command /chat ──────────────────────────────────────────────────
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'chat') return;

    const userText = interaction.options.getString('message');
    const key = conversationKey(interaction);

    if (userText.toLowerCase() === 'reset') {
      clearHistory(key);
      await interaction.reply({ content: '🎶 Ein neues Lied beginnt! Ich habe unsere bisherige Geschichte aus meinem Gedächtnis getilgt, werte Seele.', flags: MessageFlags.Ephemeral });
      logger.info(`🗑️ Chat-Verlauf zurückgesetzt von ${interaction.user.tag}`);
      return;
    }

    await interaction.deferReply();
    const history = getHistory(key);
    try {
      const responseText = await askGroq(history, userText);
      appendHistory(key, 'user', userText);
      appendHistory(key, 'assistant', responseText);

      const chunks = splitChunks(responseText);
      await interaction.editReply(chunks[0]);
      for (const chunk of chunks.slice(1)) {
        await interaction.followUp(chunk);
      }
      logger.info(`🎶 /chat von ${interaction.user.tag}: "${userText.slice(0, 60)}${userText.length > 60 ? '…' : ''}"`);
    } catch (err) {
      logger.error('❌ Fehler im /chat-Command:', err);
      await interaction.editReply('❌ Fehler bei der Anfrage. Bitte versuche es später nochmal.');
    }
  });

  // ── @Mention ─────────────────────────────────────────────────────────────
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.mentions.has(client.user)) return;

    const userText = message.content.replace(/<@!?\d+>/g, '').trim();
    const key = conversationKey(message);

    if (userText.toLowerCase() === 'reset') {
      clearHistory(key);
      await message.reply('🎶 Ein neues Lied beginnt! Ich habe unsere bisherige Geschichte aus meinem Gedächtnis getilgt, werte Seele.');
      logger.info(`🗑️ Chat-Verlauf zurückgesetzt von ${message.author.tag}`);
      return;
    }

    if (!userText) {
      await message.reply('🎵 Ah, ein stiller Gruß! Sprecht, tapferer Recke – was führt Euch zu diesem bescheidenen Barden?');
      return;
    }

    const history = getHistory(key);
    try {
      await message.channel.sendTyping();
      const responseText = await askGroq(history, userText);
      appendHistory(key, 'user', userText);
      appendHistory(key, 'assistant', responseText);

      const chunks = splitChunks(responseText);
      await message.reply(chunks[0]);
      for (const chunk of chunks.slice(1)) {
        await message.channel.send(chunk);
      }
      logger.info(`🎶 @mention von ${message.author.tag}: "${userText.slice(0, 60)}${userText.length > 60 ? '…' : ''}"`);
    } catch (err) {
      logger.error('❌ Fehler im Chat (@mention):', err);
      await message.reply('❌ Fehler bei der Anfrage. Bitte versuche es später nochmal.');
    }
  });
};

module.exports.command = command;
