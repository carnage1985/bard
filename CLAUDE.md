# Bard – Hinweise für Claude

Discord-Bot (Node, CommonJS, discord.js 14, deutsche Texte/Logs mit Emoji). Jobs in `src/jobs/` werden automatisch geladen (`src/events/ready.js`, **ein `.command` pro Datei**, globale Slash-Command-Registrierung). Hilfetext in `src/jobs/listCommand.js` bei neuen Befehlen ergänzen. Deployment: Docker (`carnages/bard:latest`), die CI baut bei jedem Push auf `main` das Image, ein Merge deployt also den Bot neu.

## Spielmodi (Secret Hitler `/sh`, Werwolf `/ww`)
Gespielt wird im Discord-Sprachkanal, Aktionen laufen über Buttons/Auswahlmenüs, Geheimes per DM (Fallback: Button „Meine Aktion“ mit Ephemeral-Antwort), der öffentliche Spielplan ist eine Live-Webseite (SSE) auf dagon.at.

```
src/games/core/        gemeinsamer Kern: store.js (games.json, Migration von secretHitler.json),
                       sessions.js (ein Spiel pro Server, Feld `type`), messenger.js (say/dm/
                       deliverPrivate/setMute, Button-/Select-Builder), lobby.js (Voice-Übernahme, join/leave/begin)
src/games/secretHitler/engine.js   reine Engine (5–10 Spieler)
src/games/werewolf/    engine.js (reine Engine, 5–16 Spieler), setup.js (Rollen-Vorschau/Validierung),
                       teams.js, roles/ (siehe unten)
src/jobs/secretHitler.js, werewolf.js   Discord-Schicht (Command, Lobby, Prompts, Timer, Voice)
src/web/               boardServer.js (Node-http + SSE, ein Server für alle Spiele),
                       public/ board.js (Kern + Renderer-Registry), sh.js, ww.js, board.css
deploy/nginx/          Reverse-Proxy dagon.at/sh/<code>/ (SSE: proxy_buffering off)
test/                  node --test (Engines inkl. Zufallssimulationen)
docs/                  games-concept.md (Konzept/Status/Roadmap), werewolf-roles.md (Rollen-Anleitung)
```

- **Konzept, Roadmap und offene Punkte:** `docs/games-concept.md` – vor Arbeit an weiteren Spielen zuerst lesen. Offen: gemeinsamer `/game`-Command mit Spielregister, weitere Spiele (Avalon, Spyfall …).
- **Neues Spiel:** Engine (rein, mit Tests) in `src/games/<spiel>/`, Discord-Schicht als Job-Datei mit eigenem customId-Präfix (`sh:`, `ww:`), Kern aus `src/games/core/` nutzen, Web-Renderer `public/<spiel>.js` + Eintrag in `board.html` und in der Whitelist von `boardServer.js`.

### Werwolf-Rollen (leicht erweiterbar)
Die Engine kennt keine konkrete Rolle. **Eine Rolle = eine Datei** in `src/games/werewolf/roles/<village|wolves|neutral>/` (drei Seiten: Dorf, Werwolf, Neutral), automatisch geladen über die Registry `roles/index.js`; der Ordner muss zum `team` passen. Neue Rolle: `roles/_template.js` kopieren, nur benötigte Hooks ausfüllen (`defaultCount`, `night.*`, `deathTrigger`, `initState`, `onDeath`, `checkWin`, `ui`-Texte für die Prompts). Die Discord-Oberfläche (Prompts, Optionen-Menü der Lobby) füllt sich daraus automatisch. Details und Hook-Liste: `docs/werewolf-roles.md`. Aktuell: Dorf – Dorfbewohner, Seherin, Doktor, Hexe, Jäger, Bürgermeister, Granny · Werwölfe – Werwolf, Alphawolf · Neutral – Narr, Vampir, Lyncher (standardmäßig aus). Generische Engine-Hooks u. a.: `night.group`, `resolveNight`/`ctx.visits|immune|conversions`, `voteWeight`, `packWeight`, `replaces`, `hostile`, `onPlayerDeath`, `extraInfo`.

### Werwolf-Ablauf (Discord)
Lobby mit Host-Optionen (Spezialrollen, Wolfsanzahl, Zeitprofil, Rollen aufdecken) → Nacht (alle server-gemutet, Wölfe im privaten Thread, Aktionen per DM) → Tag (Diskussion, Abstimmung per Button + ephemeres Menü) → Phasen-Timer: `state.deadline` ist persistiert, ein Tick alle 5 s ruft bei Ablauf `forceAdvance()`. Aktionen pro Server werden per Lock serialisiert. Bot-Rechte: Private Threads erstellen, Threads verwalten, Mitglieder stummschalten (Fallbacks vorhanden).

## Konventionen
- Spiellogik = reine Engine ohne Discord-Abhängigkeit, Zufall nur über übergebenen `rng`, Zustand JSON-serialisierbar (Persistenz/Neustart); getestet mit `npm test` (`node --test`).
- Illegale Züge werfen einen Error, Aktionen geben Events zurück (Events mit `to` sind privat).
- Geheimnisse nur per DM/Ephemeral, nie in `publicView`/Board-State.
- Persistenz: `games.json` in `DATA_DIR` (Docker-Volume `/data`), atomar geschrieben; laufende Spiele werden beim Start wiederhergestellt (jeder Deploy startet den Container neu).
- Neue Env-Variablen auch in `docker-compose.yml` ergänzen (dort wird nur durchgereicht, was aufgelistet ist). Web-Board nur aktiv mit `WEB_BASE_URL` (+ `WEB_PORT`, Standard 3000).
- Lizenz Secret Hitler: CC BY-NC-SA 4.0 – Credit im Board-Footer und in `/sh regeln`, nur nicht-kommerziell. Bei Werwolf keine geschützten Kartennamen/Artworks anderer Verlage.
- Discord-Teile wurden bisher nur mit Fake-Clients getestet; vor Spielabenden einmal mit echten Accounts durchspielen.
