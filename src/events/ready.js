const fs = require('fs');
const path = require('path');

module.exports = (client) => {
client.once('clientReady', () => {
  console.log(`✅ Bard ist online als ${client.user.tag}`);

    const jobsPath = path.join(__dirname, '..', 'jobs');
    if (!fs.existsSync(jobsPath)) {
      console.warn('⚠️ jobs/-Ordner nicht gefunden, überspringe Job-Loading.');
      return;
    }

    const jobFiles = fs.readdirSync(jobsPath).filter(f => f.endsWith('.js'));
    for (const file of jobFiles) {
      try {
        const job = require(path.join(jobsPath, file));
        if (typeof job === 'function') {
          job(client);
          console.log(`🕒 Job geladen: ${file}`);
        } else {
          console.warn(`⚠️ Datei ${file} exportiert keine Funktion.`);
        }
      } catch (e) {
        console.error(`❌ Fehler beim Laden von ${file}:`, e);
      }
    }
  });
};