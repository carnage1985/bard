// src/utils/logger.js
const { Events } = require('discord.js');

function createLogger(client, { channelId } = {}) {
  const queue = [];
  let channel = null;
  let ready = false;

  // 2000 Limit beachten, wir bleiben etwas drunter
  const MAX = 1900, MAX_PER_TICK = 5, TICK_MS = 1500;

  client.once(Events.ClientReady, async () => {
    ready = true;
    if (!channelId) return;
    try { channel = await client.channels.fetch(channelId); } catch { channel = null; }
  });

  setInterval(async () => {
    if (!ready || !channel || !queue.length) return;
    let sent = 0;
    while (queue.length && sent < MAX_PER_TICK) {
      const msg = queue.shift();
      try { await channel.send({ content: msg, allowedMentions: { parse: [] } }); } catch {}
      sent++;
    }
  }, TICK_MS);

  const ts = () => new Date().toISOString().replace('T', ' ').replace('Z', '');
  const chunk = (text) => {
    const parts = [];
    for (let i = 0; i < text.length; i += MAX) parts.push(text.slice(i, i + MAX));
    return parts;
  };
  const toText = (a) => typeof a === 'string'
    ? a
    : a instanceof Error
      ? (a.stack || a.message)
      : JSON.stringify(a, null, 2);

  const enqueue = (level, ...args) => {
    // Option: { toDiscord: false } als letztes Argument unterdrückt die Weiterleitung
    let toDiscord = true;
    if (args.length) {
      const meta = args[args.length - 1];
      if (meta && typeof meta === 'object' && meta.toDiscord === false) {
        toDiscord = false;
        args = args.slice(0, -1);
      }
    }

    // weiterhin in Konsole loggen
    // eslint-disable-next-line no-console
    console[level](...args);

    if (!toDiscord) return;

    const line = `\`${ts()}\` **${level.toUpperCase()}** ${args.map(toText).join(' ')}`;
    for (const part of chunk(line)) queue.push(part);
  };

  return {
    info:  (...a) => enqueue('log',  ...a),
    log:   (...a) => enqueue('log',  ...a),
    warn:  (...a) => enqueue('warn', ...a),
    error: (...a) => enqueue('error',...a),
  };
}

module.exports = { createLogger };
