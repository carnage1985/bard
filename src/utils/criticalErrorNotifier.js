const { Events } = require('discord.js');

const DEFAULT_OWNER_ID = '324155395709075457';
const MAX_LENGTH = 1900;

// Vorübergehende Verbindungsfehler zum Gateway (discord.js reconnectet selbst).
const TRANSIENT_ERROR_PATTERNS = [
  /unexpected server response: 5\d\d/i,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /EAI_AGAIN/,
  /ENOTFOUND/,
  /EPIPE/,
  /socket hang up/i,
];

const SHARD_ERROR_WINDOW_MS = 15 * 60 * 1000;
const SHARD_ERROR_THRESHOLD = 3;

function isTransientConnectionError(error) {
  const text = error instanceof Error ? `${error.message} ${error.code || ''}` : String(error);
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function createCriticalErrorNotifier(client, logger = console, { userId } = {}) {
  const ownerId = userId || process.env.OWNER_USER_ID || DEFAULT_OWNER_ID;
  const pendingMessages = [];
  let owner = null;
  let ready = false;

  const toText = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message || String(value);

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const truncate = (text) => {
    if (text.length <= MAX_LENGTH) return text;
    return `${text.slice(0, MAX_LENGTH - 25)}\n...[gekürzt]`;
  };

  const buildMessage = (source, error) => {
    const timestamp = new Date().toISOString();
    const details = truncate(toText(error));
    return [
      'Achtung: Schwerer Bot-Fehler erkannt.',
      `Zeit: ${timestamp}`,
      `Quelle: ${source}`,
      '```txt',
      details,
      '```',
    ].join('\n');
  };

  const flushPending = async () => {
    if (!ready || !owner || !pendingMessages.length) return;

    while (pendingMessages.length) {
      const message = pendingMessages.shift();
      try {
        await owner.send({ content: message });
      } catch (sendError) {
        logger.error('❌ Konnte Critical-Error-DM nicht senden:', sendError, { toDiscord: false });
        break;
      }
    }
  };

  client.once(Events.ClientReady, async () => {
    ready = true;

    if (!ownerId) {
      logger.warn('⚠️ Keine Owner-User-ID für Critical-Error-DMs gesetzt.', { toDiscord: false });
      return;
    }

    try {
      owner = await client.users.fetch(ownerId);
      await flushPending();
    } catch (fetchError) {
      logger.error(`❌ Konnte Owner ${ownerId} für Critical-Error-DMs nicht laden:`, fetchError, { toDiscord: false });
    }
  });

  const notify = async (source, error) => {
    const message = buildMessage(source, error);
    pendingMessages.push(message);

    if (!ready || !owner) return;
    await flushPending();
  };

  const report = async (source, error) => {
    logger.error(`🚨 Schwerer Fehler (${source}):`, error);

    try {
      await notify(source, error);
    } catch (notifyError) {
      logger.error('❌ Fehler beim Zustellen einer Critical-Error-DM:', notifyError, { toDiscord: false });
    }
  };

  return { report };
}

function registerCriticalErrorHandlers(client, logger = console, options = {}) {
  const notifier = createCriticalErrorNotifier(client, logger, options);

  client.on(Events.Error, (error) => {
    void notifier.report('discordClientError', error);
  });

  // Transiente Gateway-Fehler (z.B. 503 beim Handshake) nur als Warnung loggen;
  // DM an den Owner erst, wenn ein Shard sich wiederholt nicht fangen kann.
  const shardErrorTimestamps = new Map();

  client.on(Events.ShardError, (error, shardId) => {
    if (!isTransientConnectionError(error)) {
      void notifier.report(`discordShardError#${shardId}`, error);
      return;
    }

    const now = Date.now();
    const recent = (shardErrorTimestamps.get(shardId) || [])
      .filter((ts) => now - ts < SHARD_ERROR_WINDOW_MS);
    recent.push(now);
    shardErrorTimestamps.set(shardId, recent);

    if (recent.length >= SHARD_ERROR_THRESHOLD) {
      shardErrorTimestamps.set(shardId, []);
      void notifier.report(
        `discordShardError#${shardId} (${recent.length}x in ${SHARD_ERROR_WINDOW_MS / 60000} Min.)`,
        error,
      );
      return;
    }

    logger.warn(
      `⚠️ Vorübergehender Gateway-Fehler auf Shard ${shardId} (${recent.length}/${SHARD_ERROR_THRESHOLD}), Reconnect läuft automatisch:`,
      error,
      { toDiscord: false },
    );
  });

  const resetShardErrors = (shardId) => {
    if (shardErrorTimestamps.has(shardId)) shardErrorTimestamps.delete(shardId);
  };

  client.on(Events.ShardReady, resetShardErrors);
  client.on(Events.ShardResume, resetShardErrors);

  process.on('unhandledRejection', (reason) => {
    void notifier.report('unhandledRejection', reason);
  });

  process.on('uncaughtException', (error) => {
    void notifier.report('uncaughtException', error);
  });

  return notifier;
}

module.exports = {
  createCriticalErrorNotifier,
  registerCriticalErrorHandlers,
};
