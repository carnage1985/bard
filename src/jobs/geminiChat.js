// src/jobs/geminiChat.js
const { GoogleGenerativeAI } = require('@google/generative-ai');

const MAX_HISTORY_PAIRS = 10; // wie viele Gesprächspaare pro Kanal gespeichert werden
const HISTORY_TTL_MS = 30 * 60 * 1000; // 30 Minuten Inaktivität löscht den Verlauf
const DISCORD_MAX_LENGTH = 2000;

module.exports = (client, logger = console) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn('⚠️ GEMINI_API_KEY nicht gesetzt – Gemini-Chat ist deaktiviert.', { toDiscord: false });
    return;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: `Du bist Bard, ein charismatischer Barde aus der Welt von Dungeons & Dragons.
Du sprichst stets in einer blumigen, poetischen und leicht altmodischen Sprache – voller Metaphern, Redewendungen und gelegentlichen Reimen.
Du nennst den Gesprächspartner gerne "tapferer Recke", "werte Seele", "guter Freund" oder ähnliches.
Du beziehst dich auf deine Abenteuer, deine Laute und die Tavernen, in denen du gespielt hast.
Du beantwortest alle Fragen vollständig und hilfreich – nur eben im Stil eines Barden.
Wenn dir jemand eine nüchterne, moderne Frage stellt, beantworte sie trotzdem korrekt, aber verpacke sie in deine bardische Erzählweise.`,
  });

  // Map<key, { history: Array, lastActivity: number }>
  const conversations = new Map();

  function conversationKey(message) {
    return message.channel.isDMBased()
      ? `dm_${message.author.id}`
      : `ch_${message.channel.id}`;
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

  function appendHistory(key, role, text) {
    let entry = conversations.get(key);
    if (!entry) {
      entry = { history: [], lastActivity: Date.now() };
      conversations.set(key, entry);
    }
    entry.history.push({ role, parts: [{ text }] });
    entry.lastActivity = Date.now();
    // Ältestes Paar entfernen wenn zu lang
    if (entry.history.length > MAX_HISTORY_PAIRS * 2) {
      entry.history.splice(0, 2);
    }
  }

  function clearHistory(key) {
    conversations.delete(key);
  }

  async function sendChunked(message, text) {
    if (text.length <= DISCORD_MAX_LENGTH) {
      await message.reply(text);
      return;
    }
    const chunks = text.match(/[\s\S]{1,1990}/g) || [];
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) await message.reply(chunks[i]);
      else await message.channel.send(chunks[i]);
    }
  }

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const isMentioned = message.mentions.has(client.user);
    const isCommand = message.content.toLowerCase().startsWith('!chat');

    if (!isMentioned && !isCommand) return;

    // Nachrichtentext extrahieren
    let userText;
    if (isMentioned) {
      userText = message.content.replace(/<@!?\d+>/g, '').trim();
    } else {
      userText = message.content.slice('!chat'.length).trim();
    }

    const key = conversationKey(message);

    // !chat reset – Gesprächsverlauf löschen
    if (userText.toLowerCase() === 'reset') {
      clearHistory(key);
      await message.reply('🎶 Ein neues Lied beginnt! Ich habe unsere bisherige Geschichte aus meinem Gedächtnis getilgt, werte Seele.');
      logger.info(`🗑️ Gemini-Verlauf zurückgesetzt von ${message.author.tag}`);
      return;
    }

    if (!userText) {
      await message.reply('🎵 Ah, ein stiller Gruß! Sprecht, tapferer Recke – was führt Euch zu diesem bescheidenen Barden? Versucht es mit `!chat Hallo!`');
      return;
    }

    const history = getHistory(key);

    try {
      await message.channel.sendTyping();

      const chat = model.startChat({ history });
      const result = await chat.sendMessage(userText);
      const responseText = result.response.text();

      appendHistory(key, 'user', userText);
      appendHistory(key, 'model', responseText);

      await sendChunked(message, responseText);

      logger.info(`🤖 Gemini-Chat von ${message.author.tag}: "${userText.slice(0, 60)}${userText.length > 60 ? '…' : ''}"`);
    } catch (err) {
      logger.error('❌ Fehler im Gemini-Chat:', err);
      await message.reply('❌ Fehler bei der Anfrage an Gemini. Bitte versuche es später nochmal.');
    }
  });
};
