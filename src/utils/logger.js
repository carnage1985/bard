// src/utils/logger.js
const { Events } = require('discord.js');

const NTFY_URL = process.env.NTFY_URL;
const NTFY_TOKEN = process.env.NTFY_TOKEN;

function createLogger(client, { channelId } = {}) {
  const queue = [];
  let channel = null;
  let ready = false;

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

  // Schickt Error-Logs zusätzlich an ntfy (Topic aus NTFY_URL), fire-and-forget.
  const notifyNtfy = (args) => {
    if (!NTFY_URL) return;
    const text = args.map(toText).join(' ').slice(0, 3800);
    const headers = {
      'Title': 'Bard: Fehler',
      'Priority': 'high',
      'Tags': 'warning',
    };
    if (NTFY_TOKEN) headers['Authorization'] = `Bearer ${NTFY_TOKEN}`;
    fetch(NTFY_URL, {
      method: 'POST',
      headers,
      body: text,
    }).catch(() => {});
  };

  const enqueue = (level, ...args) => {
    // Option: { toDiscord: false } als letztes Argument unterdrückt die Weiterleitung
    // (Discord-Channel UND ntfy) - z.B. um Melde-Schleifen bei bereits behandelten
    // bzw. transienten Fehlern zu vermeiden.
    let toDiscord = true;
    if (args.length) {
      const meta = args[args.length - 1];
      if (meta && typeof meta === 'object' && meta.toDiscord === false) {
        toDiscord = false;
        args = args.slice(0, -1);
      }
    }

    // eslint-disable-next-line no-console
    console[level](...args);

    if (level === 'error' && toDiscord) notifyNtfy(args);

    if (!toDiscord) return;

    const line = `\`${ts()}\` **${level.toUpperCase()}** ${args.map(toText).join(' ')}`;
    for (const part of chunk(line)) queue.push(part);
  };

  return {
    info:  (...a) => enqueue('info', ...a),
    log:   (...a) => enqueue('log',  ...a),
    warn:  (...a) => enqueue('warn', ...a),
    error: (...a) => enqueue('error',...a),
  };
}

module.exports = { createLogger };
