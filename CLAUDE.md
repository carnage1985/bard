# Bard – Hinweise für Claude

Discord-Bot (Node, CommonJS, discord.js 14, deutsche Texte/Logs mit Emoji). Jobs in `src/jobs/` werden automatisch geladen (`src/events/ready.js`, ein `.command` pro Datei). Deployment: Docker, CI baut bei Push auf `main` das Image `carnages/bard:latest`.

## Spielmodi
- Secret Hitler läuft produktiv (`/sh`, Engine in `src/games/secretHitler/`, Live-Board in `src/web/`, Nginx in `deploy/nginx/`).
- **Geplant: Multi-Spiel-Framework + Werwolf/Mafia → siehe `docs/games-concept.md`.** Dort stehen Architektur, Spielkonzept, offene Fragen und Reihenfolge. Vor Arbeit an weiteren Spielen zuerst lesen.

## Konventionen
- Spiellogik = reine Engine ohne Discord-Abhängigkeit, getestet mit `npm test` (`node --test`).
- Geheimnisse nur per DM/Ephemeral, nie im öffentlichen Board-State.
- Neue Env-Variablen auch in `docker-compose.yml` ergänzen.
