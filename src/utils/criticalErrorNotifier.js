const { Events } = require('discord.js');

const DEFAULT_OWNER_ID = '324155395709075457';
const MAX_LENGTH = 1900;

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

  client.on(Events.ShardError, (error, shardId) => {
    void notifier.report(`discordShardError#${shardId}`, error);
  });

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
