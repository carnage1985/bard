const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  || (process.platform === 'win32' ? path.join(process.cwd(), 'data') : '/data');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getDataFilePath(fileName) {
  ensureDataDir();
  return path.join(DATA_DIR, fileName);
}

function migrateLegacyFile(fileName, legacyPath, logger) {
  const targetPath = getDataFilePath(fileName);
  if (fs.existsSync(targetPath) || !fs.existsSync(legacyPath)) return targetPath;

  try {
    fs.copyFileSync(legacyPath, targetPath);
    logger?.info(`📦 ${fileName} aus altem Pfad nach ${targetPath} migriert.`);
  } catch (err) {
    logger?.error(`❌ Konnte ${fileName} nicht aus altem Pfad migrieren:`, err);
  }

  return targetPath;
}

module.exports = {
  DATA_DIR,
  getDataFilePath,
  migrateLegacyFile,
};
