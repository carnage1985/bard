const fs = require('fs');
const path = require('path');

module.exports = async (client, logger = console) => {
  const jobsPath = path.join(__dirname, '..', 'jobs');
  const commands = [];

  let loaded = 0;
  if (fs.existsSync(jobsPath)) {
    const jobFiles = fs.readdirSync(jobsPath).filter(f => f.endsWith('.js'));
    for (const file of jobFiles) {
      try {
        const job = require(path.join(jobsPath, file));
        if (typeof job === 'function') {
          if (job.command) commands.push(job.command.toJSON());
          job(client, logger);
          loaded++;
          logger.info(`🕒 Job geladen: ${file}`);
        } else {
          logger.warn(`⚠️ Datei ${file} exportiert keine Funktion – übersprungen.`);
        }
      } catch (e) {
        logger.error(`❌ Fehler beim Laden von ${file}:`, e);
      }
    }
  } else {
    logger.warn('⚠️ jobs/-Ordner nicht gefunden, überspringe Job-Loading.');
  }

  // Slash-Commands bei Discord registrieren
  if (commands.length > 0) {
    try {
      await client.application.commands.set(commands);
      logger.info(`✅ ${commands.length} Slash-Command(s) bei Discord registriert.`);
    } catch (err) {
      logger.error('❌ Fehler beim Registrieren der Slash-Commands:', err);
    }
  }

  logger.info(`✅ Bard ist online als ${client.user.tag} — ${loaded} Job(s) aktiv`);
};
