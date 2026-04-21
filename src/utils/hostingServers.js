const fs = require('fs');
const path = require('path');

const HOSTING_DIR = process.env.HOSTING_DIR || '/hosting';

function isLoopbackHost(host) {
  if (!host) return true;
  const lower = String(host).toLowerCase();
  return lower === '127.0.0.1' || lower === 'localhost' || lower === '::1';
}

// Extract hostname from an "address" field like "dagon.at:9876" → "dagon.at"
function hostnameFromAddress(address) {
  if (!address) return null;
  const parts = String(address).split(':');
  return parts[0] || null;
}

function normalizeQueryHost(queryHost, serverAddress) {
  if (!isLoopbackHost(queryHost)) return queryHost;

  // Prefer public hostname from address field — avoids docker-proxy UDP loopback issues
  const publicHost = hostnameFromAddress(serverAddress);
  if (publicHost && publicHost !== 'localhost' && !isLoopbackHost(publicHost)) {
    return publicHost;
  }

  return queryHost || '127.0.0.1';
}

const QUERY_TYPE_ALIASES = {
  source: 'protocol-valve',
  valve: 'protocol-valve',
  a2s: 'protocol-valve',
};

function normalizeQueryType(type) {
  if (!type) return type;
  const lower = String(type).toLowerCase();
  return QUERY_TYPE_ALIASES[lower] ?? type;
}

function loadHostingServers(logger) {
  let entries;
  try {
    entries = fs.readdirSync(HOSTING_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger?.warn?.(`⚠️ Hosting-Verzeichnis nicht gefunden: ${HOSTING_DIR}`);
      return [];
    }
    logger?.error?.(`❌ Konnte Hosting-Verzeichnis ${HOSTING_DIR} nicht lesen:`, err);
    return [];
  }

  const servers = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(HOSTING_DIR, entry.name, 'server.json');
    try {
      const raw = fs.readFileSync(jsonPath, 'utf8');
      const parsed = JSON.parse(raw);
      servers.push({ ...parsed, _dir: entry.name, _jsonPath: jsonPath });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger?.warn?.(`⚠️ Konnte ${jsonPath} nicht lesen: ${err.message}`);
      }
    }
  }
  return servers;
}

function getLastActiveMs(server, logger) {
  if (!server?.activityPath) return 0;
  try {
    const stats = fs.statSync(server.activityPath);
    if (!stats.isDirectory()) return stats.mtimeMs;

    let newest = stats.mtimeMs;
    try {
      const children = fs.readdirSync(server.activityPath);
      for (const child of children) {
        try {
          const childStats = fs.statSync(path.join(server.activityPath, child));
          if (childStats.mtimeMs > newest) newest = childStats.mtimeMs;
        } catch {
          // ignore unreadable child
        }
      }
    } catch {
      // ignore unreadable dir
    }
    return newest;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger?.warn?.(`⚠️ activityPath von ${server.id ?? server._dir} nicht lesbar: ${err.message}`);
    }
    return 0;
  }
}

module.exports = {
  HOSTING_DIR,
  loadHostingServers,
  getLastActiveMs,
  normalizeQueryHost,
  normalizeQueryType,
};
