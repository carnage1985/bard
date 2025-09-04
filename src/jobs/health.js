// src/jobs/health.js
const cron = require('node-cron');

module.exports = (client, logger = console) => {
  // Jeden Tag um 09:00 und 21:00 (Europe/Vienna)
  cron.schedule('0 9,21 * * *', async () => {
    try {
      const guilds = client.guilds.cache.size;
      const users = client.users.cache.size;
      const mem = process.memoryUsage();
      const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
      const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);

      logger.info(`🩺 Health: online, Guilds=${guilds}, Users(cache)=${users}, RAM=${rssMB}MB, Heap=${heapMB}MB`);
    } catch (err) {
      logger.error('❌ Health-Job Fehler:', err);
    }
  }, { timezone: 'Europe/Vienna' });
};
