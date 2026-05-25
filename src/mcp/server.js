// src/mcp/server.js
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const http = require('http');
const { z } = require('zod');

function getGuild(client, guildId) {
  if (guildId) return client.guilds.cache.get(guildId);
  return client.guilds.cache.first();
}

function ok(text) {
  return { content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text, null, 2) }] };
}

function createMcpServer(client, logger = console) {
  const server = new McpServer({ name: 'bard-discord', version: '1.0.0' });

  // ── READ TOOLS ──────────────────────────────────────────────────────────────

  server.tool(
    'get_server_info',
    'Allgemeine Infos über den Discord-Server: Name, Memberzahl, Channels, Boost-Level.',
    {},
    async () => {
      const guild = getGuild(client);
      if (!guild) return ok('Kein Server gefunden.');
      await guild.fetch();
      return ok({
        name: guild.name,
        id: guild.id,
        memberCount: guild.memberCount,
        boostLevel: guild.premiumTier,
        boostCount: guild.premiumSubscriptionCount ?? 0,
        createdAt: guild.createdAt.toISOString(),
        channels: guild.channels.cache
          .filter(c => !c.isThread?.())
          .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
          .map(c => ({ id: c.id, name: c.name, type: c.type })),
      });
    }
  );

  server.tool(
    'list_members',
    'Alle Mitglieder mit Rollen und aktuellem Voice-Channel.',
    {},
    async () => {
      const guild = getGuild(client);
      if (!guild) return ok('Kein Server gefunden.');
      const members = await guild.members.fetch();
      const list = members
        .filter(m => !m.user.bot)
        .map(m => ({
          id: m.id,
          username: m.user.username,
          displayName: m.displayName,
          roles: m.roles.cache
            .filter(r => r.name !== '@everyone')
            .map(r => ({ id: r.id, name: r.name })),
          voiceChannel: m.voice?.channel ? { id: m.voice.channel.id, name: m.voice.channel.name } : null,
          joinedAt: m.joinedAt?.toISOString() ?? null,
          timedOut: m.isCommunicationDisabled(),
        }));
      return ok(list);
    }
  );

  server.tool(
    'get_recent_messages',
    'Liest die letzten Nachrichten aus einem oder allen Text-Channels.',
    {
      channel_id: z.string().optional().describe('Channel-ID – leer = alle Channels'),
      limit: z.number().int().min(1).max(20).default(5).describe('Nachrichten pro Channel (max 20)'),
    },
    async ({ channel_id, limit = 5 }) => {
      const guild = getGuild(client);
      if (!guild) return ok('Kein Server gefunden.');

      const channels = channel_id
        ? [guild.channels.cache.get(channel_id)].filter(Boolean)
        : guild.channels.cache
            .filter(c => c.isTextBased?.() && !c.isThread?.() && !c.isVoiceBased?.())
            .toJSON();

      const results = [];
      for (const ch of channels) {
        try {
          const msgs = await ch.messages.fetch({ limit });
          results.push({
            channel: ch.name,
            channelId: ch.id,
            messages: msgs
              .map(m => ({
                id: m.id,
                author: m.author.username,
                content: m.content || (m.embeds.length ? '[Embed]' : '[kein Text]'),
                timestamp: m.createdAt.toISOString(),
              }))
              .reverse(),
          });
        } catch {
          // Channel nicht lesbar (z.B. fehlende Rechte)
        }
      }
      return ok(results);
    }
  );

  server.tool(
    'get_audit_log',
    'Letzte Admin-Aktionen auf dem Server (wer hat was gemacht).',
    {
      limit: z.number().int().min(1).max(25).default(10).describe('Anzahl Einträge'),
    },
    async ({ limit = 10 }) => {
      const guild = getGuild(client);
      if (!guild) return ok('Kein Server gefunden.');
      const logs = await guild.fetchAuditLogs({ limit });
      const entries = logs.entries.map(e => ({
        action: e.action,
        executor: e.executor?.username ?? '?',
        target: e.target?.username ?? e.target?.name ?? String(e.targetId ?? '?'),
        reason: e.reason ?? null,
        timestamp: e.createdAt.toISOString(),
      }));
      return ok(entries);
    }
  );

  server.tool(
    'get_member_info',
    'Details zu einem User: Rollen, Join-Datum, Voice-Status, Timeout.',
    {
      user_id: z.string().describe('Discord User-ID'),
    },
    async ({ user_id }) => {
      const guild = getGuild(client);
      if (!guild) return ok('Kein Server gefunden.');
      const member = await guild.members.fetch(user_id).catch(() => null);
      if (!member) return ok(`User ${user_id} nicht gefunden.`);
      return ok({
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        roles: member.roles.cache
          .filter(r => r.name !== '@everyone')
          .map(r => ({ id: r.id, name: r.name })),
        joinedAt: member.joinedAt?.toISOString() ?? null,
        accountCreatedAt: member.user.createdAt.toISOString(),
        voiceChannel: member.voice?.channel ? { id: member.voice.channel.id, name: member.voice.channel.name } : null,
        timedOut: member.isCommunicationDisabled(),
        timedOutUntil: member.communicationDisabledUntil?.toISOString() ?? null,
        bot: member.user.bot,
      });
    }
  );

  server.tool(
    'list_roles',
    'Alle Rollen auf dem Server mit Farbe und Mitgliederzahl.',
    {},
    async () => {
      const guild = getGuild(client);
      if (!guild) return ok('Kein Server gefunden.');
      const roles = guild.roles.cache
        .filter(r => r.name !== '@everyone')
        .sort((a, b) => b.position - a.position)
        .map(r => ({
          id: r.id,
          name: r.name,
          color: r.hexColor,
          memberCount: r.members.size,
          position: r.position,
        }));
      return ok(roles);
    }
  );

  // ── WRITE TOOLS ─────────────────────────────────────────────────────────────

  server.tool(
    'send_message',
    'Sendet eine Nachricht in einen Channel.',
    {
      channel_id: z.string().describe('Ziel-Channel-ID'),
      content: z.string().max(2000).describe('Nachrichtentext (max 2000 Zeichen)'),
    },
    async ({ channel_id, content }) => {
      const guild = getGuild(client);
      if (!guild) return ok('Kein Server gefunden.');
      const channel = guild.channels.cache.get(channel_id);
      if (!channel?.isTextBased?.()) return ok(`Channel ${channel_id} nicht gefunden oder kein Text-Channel.`);
      const msg = await channel.send(content);
      logger.info(`📨 MCP send_message → #${channel.name}: "${content.slice(0, 80)}"`);
      return ok(`Nachricht gesendet (ID: ${msg.id}) in #${channel.name}.`);
    }
  );

  server.tool(
    'assign_role',
    'Gibt einem User eine Rolle.',
    {
      user_id: z.string().describe('Discord User-ID'),
      role_id: z.string().describe('Rollen-ID'),
    },
    async ({ user_id, role_id }) => {
      const guild = getGuild(client);
      if (!guild) return ok('Kein Server gefunden.');
      const member = await guild.members.fetch(user_id).catch(() => null);
      if (!member) return ok(`User ${user_id} nicht gefunden.`);
      const role = guild.roles.cache.get(role_id);
      if (!role) return ok(`Rolle ${role_id} nicht gefunden.`);
      if (member.roles.cache.has(role_id)) return ok(`${member.user.username} hat die Rolle "${role.name}" bereits.`);
      await member.roles.add(role);
      logger.info(`🏷️ MCP assign_role → ${member.user.tag} + "${role.name}"`);
      return ok(`Rolle "${role.name}" an ${member.user.username} vergeben.`);
    }
  );

  server.tool(
    'remove_role',
    'Entfernt eine Rolle von einem User.',
    {
      user_id: z.string().describe('Discord User-ID'),
      role_id: z.string().describe('Rollen-ID'),
    },
    async ({ user_id, role_id }) => {
      const guild = getGuild(client);
      if (!guild) return ok('Kein Server gefunden.');
      const member = await guild.members.fetch(user_id).catch(() => null);
      if (!member) return ok(`User ${user_id} nicht gefunden.`);
      const role = guild.roles.cache.get(role_id);
      if (!role) return ok(`Rolle ${role_id} nicht gefunden.`);
      if (!member.roles.cache.has(role_id)) return ok(`${member.user.username} hat die Rolle "${role.name}" nicht.`);
      await member.roles.remove(role);
      logger.info(`🏷️ MCP remove_role → ${member.user.tag} - "${role.name}"`);
      return ok(`Rolle "${role.name}" von ${member.user.username} entfernt.`);
    }
  );

  server.tool(
    'timeout_member',
    'Setzt einen User auf Timeout (kann nicht schreiben/sprechen).',
    {
      user_id: z.string().describe('Discord User-ID'),
      minutes: z.number().int().min(1).max(10080).describe('Dauer in Minuten (max 10080 = 7 Tage)'),
      reason: z.string().optional().describe('Begründung (optional)'),
    },
    async ({ user_id, minutes, reason }) => {
      const guild = getGuild(client);
      if (!guild) return ok('Kein Server gefunden.');
      const member = await guild.members.fetch(user_id).catch(() => null);
      if (!member) return ok(`User ${user_id} nicht gefunden.`);
      if (!member.moderatable) return ok(`Kann ${member.user.username} nicht timeoutten – fehlende Rechte oder höherer Rang.`);
      await member.timeout(minutes * 60 * 1000, reason ?? 'Timeout via MCP');
      logger.info(`⏱️ MCP timeout_member → ${member.user.tag} für ${minutes} min (${reason ?? 'kein Grund'})`);
      return ok(`${member.user.username} für ${minutes} Minuten getimedoutet.`);
    }
  );

  server.tool(
    'remove_timeout',
    'Hebt einen laufenden Timeout eines Users auf.',
    {
      user_id: z.string().describe('Discord User-ID'),
    },
    async ({ user_id }) => {
      const guild = getGuild(client);
      if (!guild) return ok('Kein Server gefunden.');
      const member = await guild.members.fetch(user_id).catch(() => null);
      if (!member) return ok(`User ${user_id} nicht gefunden.`);
      if (!member.isCommunicationDisabled()) return ok(`${member.user.username} ist nicht getimedoutet.`);
      await member.timeout(null);
      logger.info(`✅ MCP remove_timeout → ${member.user.tag}`);
      return ok(`Timeout von ${member.user.username} aufgehoben.`);
    }
  );

  // ── HTTP SERVER ──────────────────────────────────────────────────────────────

  const port = parseInt(process.env.MCP_PORT ?? '3456', 10);
  const token = process.env.MCP_TOKEN ?? null;

  if (!token) {
    logger.warn('⚠️ MCP_TOKEN nicht gesetzt – MCP-Server ist ohne Authentifizierung erreichbar!');
  }

  const httpServer = http.createServer((req, res) => {
    // Auth-Check
    if (token) {
      const auth = req.headers['authorization'] ?? '';
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found – POST /mcp erwartet.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => transport.close().catch(() => {}));
        await server.connect(transport);
        await transport.handleRequest(req, res, parsed);
      } catch (err) {
        logger.error('❌ MCP HTTP Fehler:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
    });
  });

  httpServer.listen(port, '0.0.0.0', () => {
    logger.info(`🔌 MCP-Server läuft auf Port ${port} (${token ? 'mit Auth-Token' : '⚠️ KEIN TOKEN'})`);
  });

  return httpServer;
}

module.exports = { createMcpServer };
