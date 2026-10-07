# Konzept: Multi-Spiel-Framework für Bard (nächster Schritt: Werwolf/Mafia)

## Kontext
Secret Hitler läuft produktiv (PR #10/#11 gemergt, Deployment funktioniert). Als Nächstes sollen weitere Spiele dazukommen, zuerst Werwolf bzw. Mafia. Dieses Dokument hält das Konzept fest, damit spätere Sessions nahtlos weitermachen können. Dieses Dokument ist das persistente Konzept (Memory) für weitere Spiele.

## Ist-Stand (Secret Hitler)
- `src/games/secretHitler/engine.js`: reine Zustandsmaschine, Aktionen werfen bei illegalem Zug, geben Events zurück (`to` = privat), `publicView()` ohne Geheimnisse, `roleInfo()`.
- `src/games/secretHitler/store.js`: JSON-Persistenz (`secretHitler.json` in DATA_DIR, atomar).
- `src/jobs/secretHitler.js`: Command `/sh`, Lobby, DM-Prompts mit Buttons (`customId` = `sh:<aktion>:<guildId>:<arg>`), Fallback-Button „Meine Aktion“, Vote-Message, Restore nach Neustart.
- `src/web/boardServer.js` + `public/`: Node-http + SSE, Route `/<12hex>/{state,events}`; Board rendert öffentliche Sicht. Aktiv nur mit `WEB_BASE_URL`.
- Deployment: Docker (`carnages/bard:latest`, CI bei Push auf main), Nginx `deploy/nginx/dagon.at-sh.conf`.
- Entscheidungen: Buttons statt Spracherkennung; Voice-Channel nur zum Reden; Bot spricht nicht im Voice.

## Zielarchitektur
1. **Gemeinsamer Kern extrahieren** (Refactor, bevor das 2. Spiel entsteht), nach `src/games/core/`:
   - Lobby (Beitreten/Verlassen/Start, Spieler aus Voice übernehmen, Host-Logik)
   - DM-Zustellung mit Fallback-Button (`dm()`, `sendPrompt()`)
   - Persistenz (`store.js` generisch: `games.json`, Schlüssel guildId, Feld `type`)
   - Sitzungsregister `Map<guildId, Game>` + `/<spiel> status|abbrechen|regeln`
   - Voice-Helfer (Mute/Unmute, Spieler aus Voice-Channel lesen)
2. **Spiel-Plugin-Schnittstelle** (jedes Spiel exportiert): `meta {id,name,min,max,license}`, `create()`, Aktionen (reine Funktionen), `publicView()`, `roleInfo()`, `promptFor(state,userId)`, `waitingFor(state)`, `announce(event)`, `tick(state,now)` für Zeitsteuerung.
3. **Ein Command pro Datei** bleibt Regel (ready.js sammelt nur ein `.command` pro Job-Datei) → entweder ein Command `/game start spiel:<auswahl>` plus Subcommands oder ein Command je Spiel (`/sh`, `/ww`). Empfehlung: ein `/game`-Command mit Autocomplete, `/sh` als Alias behalten.
4. **Webboard** bekommt pro Spiel einen Renderer (`public/<spiel>.js`); Server liefert `view.type`. Gleiche Route/SSE, gleiche Nginx-Config.
5. Engines bleiben ohne Discord-Abhängigkeit und werden mit `node --test` getestet (inkl. Zufallssimulation wie bei SH).

## Werwolf/Mafia – Spielkonzept
- Rundenbasiert: **Nacht** (geheime Aktionen per DM-Buttons) → **Tag** (Diskussion im Voice, öffentliche Abstimmung per Buttons, Lynchen).
- Rollen (Basis): Dorfbewohner, Werwölfe/Mafia, Seher/Detektiv; Erweiterungen: Arzt, Hexe, Jäger, Amor, Don. Rollenverteilung skaliert mit Spielerzahl; Rollen-Pakete konfigurierbar vom Host.
- Nacht: Wölfe wählen Opfer (Mehrheit unter Wölfen, Abstimmung per DM, Timeout), Seher prüft Spieler, Arzt schützt usw.; Auflösung in fester Reihenfolge in der Engine.
- Tag: Opfer wird verkündet, Diskussion mit Timer, Lynch-Abstimmung (öffentlich, Mehrheit, Gleichstand = niemand/Stichwahl, konfigurierbar).
- Sieg: Wölfe ≥ Dorf bzw. alle Wölfe tot.
- **Voice-Integration:** nachts alle Spieler server-muten (Bot braucht `MuteMembers`), tags entmuten; Tote dauerhaft gemutet. Bot-Ansagen als Textnachricht (TTS später optional).
- **Neu gegenüber SH: Zeitsteuerung.** Phasen-Timer (Nacht-Timeout, Tag-Diskussion, Abstimmungsfrist) brauchen `tick()`/`setTimeout` mit persistierten Deadlines (`deadline` im State), damit ein Neustart sie wieder aufnimmt.
- **Offenes Problem: geheime Wolf-Absprache.** Optionen: (a) nur per Buttons/DM-Mehrheit ohne Reden, (b) temporärer privater Textkanal/Thread nur für Wölfe (braucht ManageChannels/Threads), (c) temporärer Voice-Channel für Wölfe. Empfehlung: (b) Private Thread, Fallback (a).
- Webboard: Tag/Nacht-Anzeige, Lebende/Tote (Rolle erst nach Tod/Spielende, einstellbar), Verlauf, Phasen-Timer (Countdown).
- Lizenz/Namen: Werwolf/Mafia-Grundregeln sind frei; keine geschützten Kartennamen/Artworks von „Ultimate Werewolf“ o. ä. verwenden, generische Namen nutzen.

## Weitere Spielideen (später)
Avalon/Resistance (sehr ähnlich zu SH, Team-Votes + Quests), Spyfall/Insider (Wort-Spiele), Codenames (Board stark auf Web). Kriterium: wenig Echtzeit, viel Rollen-Geheimnis → passt zu DM+Voice+Board.

## Reihenfolge / Vorgehen
1. Refactor: Kern aus `src/jobs/secretHitler.js` extrahieren, SH läuft unverändert weiter (Tests + manuelle Prüfung, Persistenz-Format abwärtskompatibel oder Migration).
2. `/game`-Command + Spielregister.
3. Werwolf-Engine + Tests (Nachtauflösung, Siegbedingungen, Zufallssimulation).
4. Discord-UI, Timer, Voice-Mute, Wolf-Thread.
5. Web-Renderer, Doku, `/list` aktualisieren.

## Verifikation
`npm test` (Engine-Tests pro Spiel), Fake-Client-Smoke-Test wie bei SH, danach manueller Test mit 5+ Accounts auf Testserver; Refactor-Regressionstest: SH-Spiel vor/nach dem Refactor identisch spielbar, laufendes Spiel überlebt Neustart.

## Status
- ✅ Schritt 1 (Refactor): `src/games/core/` mit `store.js` (games.json, Migration von secretHitler.json), `sessions.js` (ein Spiel pro Server, Feld `type`), `messenger.js` (say/dm/deliverPrivate/setMute, Button-/Select-Builder), `lobby.js` (Voice-Übernahme, join/leave/begin). `src/jobs/secretHitler.js` nutzt den Kern, Verhalten unverändert.
- ⏳ Schritt 2: `/game`-Command + Spielregister (Plugin-Schnittstelle) – noch offen. Prompt-/DM-Fallback („Meine Aktion“) und Vote-Message liegen noch in `secretHitler.js` und werden bei Bedarf des 2. Spiels in den Kern gehoben.
