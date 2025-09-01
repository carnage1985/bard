const fs = require('fs');
const path = require('path');

module.exports = (client) => {
  const jobsPath = path.join(__dirname, '..', 'jobs');

  let loaded = 0;
  if (fs.existsSync(jobsPath)) {
    const jobFiles = fs.readdirSync(jobsPath).filter(f => f.endsWith('.js'));
    for (const file of jobFiles) {
      try {
        const job = require(path.join(jobsPath, file));
        if (typeof job === 'function') {
          job(client);        // Job starten
          loaded++;
          console.log(`🕒 Job geladen: ${file}`);
        } else {
          console.warn(`⚠️ Datei ${file} exportiert keine Funktion – übersprungen.`);
        }
      } catch (e) {
        console.error(`❌ Fehler beim Laden von ${file}:`, e);
      }
    }
  } else {
    console.warn('⚠️ jobs/-Ordner nicht gefunden, überspringe Job-Loading.');
  }

  console.log(`✅ Bard ist online als ${client.user.tag} — ${loaded} Job(s) aktiv`);
};
