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

  const notifyPlain = async (message) => {
    pendingMessages.push(message);

    if (!ready || !owner) return;
    await flushPending();
  };

  const notify = (source, error) => notifyPlain(buildMessage(source, error));

  const report = async (source, error) => {
    logger.error(`🚨 Schwerer Fehler (${source}):`, error);

    try {
      await notify(source, error);
    } catch (notifyError) {
      logger.error('❌ Fehler beim Zustellen einer Critical-Error-DM:', notifyError, { toDiscord: false });
    }
  };

  const reportRecovery = async (source, message) => {
    logger.info(`✅ ${message}`);

    const text = ['✅ Bot-Problem behoben.', `Zeit: ${new Date().toISOString()}`, `Quelle: ${source}`, message].join('\n');
    try {
      await notifyPlain(text);
    } catch (notifyError) {
      logger.error('❌ Fehler beim Zustellen einer Recovery-DM:', notifyError, { toDiscord: false });
    }
  };

  return { report, reportRecovery };
}

function registerCriticalErrorHandlers(client, logger = console, options = {}) {
  const notifier = createCriticalErrorNotifier(client, logger, options);

  client.on(Events.Error, (error) => {
    void notifier.report('discordClientError', error);
  });

  // Transiente Gateway-Fehler (z.B. 503 beim Handshake): DM beim ersten Fehler
  // einer Verbindungsstörung, danach nur noch stumm loggen (discord.js
  // reconnectet selbst), bis der Shard wieder verbunden ist - dann Recovery-DM.
  const shardDownSince = new Map();

  client.on(Events.ShardError, (error, shardId) => {
    if (!isTransientConnectionError(error)) {
      void notifier.report(`discordShardError#${shardId}`, error);
      return;
    }

    if (shardDownSince.has(shardId)) {
      logger.warn(
        `⚠️ Weiterer Gateway-Fehler auf Shard ${shardId} (weiterhin getrennt), Reconnect läuft automatisch:`,
        error,
        { toDiscord: false },
      );
      return;
    }

    shardDownSince.set(shardId, Date.now());
    void notifier.report(`discordShardError#${shardId}`, error);
  });

  const resetShardErrors = (shardId, eventName) => {
    const since = shardDownSince.get(shardId);
    if (since === undefined) return;
    shardDownSince.delete(shardId);

    const downtimeMs = Date.now() - since;
    const downtimeLabel = downtimeMs < 60000
      ? `${Math.max(1, Math.round(downtimeMs / 1000))}s`
      : `${Math.round(downtimeMs / 60000)} Min.`;

    void notifier.reportRecovery(
      `discordShardRecovered#${shardId}`,
      `Shard ${shardId} wieder verbunden (${eventName}) nach ca. ${downtimeLabel} Verbindungsproblemen.`,
    );
  };

  client.on(Events.ShardReady, (shardId) => resetShardErrors(shardId, 'ShardReady'));
  client.on(Events.ShardResume, (shardId) => resetShardErrors(shardId, 'ShardResume'));

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
