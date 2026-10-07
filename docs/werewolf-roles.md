# Werwolf: Rollen hinzufügen

Die Engine (`src/games/werewolf/engine.js`) kennt keine konkrete Rolle. Jede Rolle ist **eine Datei**
unter `src/games/werewolf/roles/<seite>/`, die automatisch geladen wird (Registry: `roles/index.js`).

## Drei Seiten
| Ordner | Team (`TEAMS.*`) | Siegbedingung |
|---|---|---|
| `roles/village/` | `VILLAGE` 🏘️ Dorf | Alle Werwölfe tot |
| `roles/wolves/` | `WOLVES` 🐺 Werwölfe | Werwölfe ≥ alle anderen |
| `roles/neutral/` | `NEUTRAL` ⚖️ Neutral | eigene Bedingung per `onDeath`/`checkWin` (z. B. Narr) |

Der Ordner muss zum `team` der Rolle passen (sonst Fehler beim Laden). Neutrale Spieler zählen für die
Wolfs-Mehrheit als "andere" und verhindern das Dorf-Ende nicht.

## Neue Rolle in 3 Schritten
1. `roles/_template.js` in den passenden Seiten-Ordner kopieren, umbenennen (ohne `_`).
2. `id`, `name`, `emoji`, `team`, `description` setzen; nur die Hooks ausfüllen, die die Rolle braucht.
3. Test in `test/werewolf.test.js` ergänzen (Beispiel: Leibwächter per `registerRole`). Keine Änderung an Engine oder Discord-Schicht nötig.

## Hooks (alle optional)
- `defaultCount(n, options)`: Anzahl bei n Spielern; Host überschreibt per `options.roles = { id: Anzahl|false }`. `fill: true` = Füllrolle (Dorfbewohner).
- `seenAs: 'wolf'`: Seher sieht die Rolle als Werwolf. `knowsTeam: true`: kennt Teammitglieder.
- `night`: `normalize` (Eingabe prüfen, Pflicht), `targets`, `canAct`, `needs` (erst nach anderen Rollen), `revisable`, `onOpen`, `onSubmit` (private Events), `onDone`, `resolveOrder` + `resolve(s, ns, ctx)` (`ctx.attacks.push({id, cause, blockable})`, `ctx.protected.add(id)`), `ui` (Hinweis für die Discord-Oberfläche).
- `deathTrigger`: Aktion beim Tod (`targets`, `resolve` → zusätzliche Tode), z. B. Jäger.
- `initState(s)`: Rollen-Zustand in `s.roleState[id]` (Tränke, letzter Schutz). Muss JSON-serialisierbar bleiben.
- `onDeath(s, player, cause)` → `{ winner, reason, playerIds }` für Sondersiege, `checkWin(s)` für globale Zusatzbedingungen.

## Vorhandene Rollen
Dorf: Dorfbewohner, Seherin, Doktor, Hexe, Jäger · Werwölfe: Werwolf · Neutral: Narr (standardmäßig aus).

## Regeln für Rollen-Code
- Zustand nur in `s.roleState[id]` oder `ns.data/ns.shared` – keine Funktionen/Objekte mit Methoden im State (Persistenz!).
- Geheimes nur über Events mit `to: userId`, nie in `publicView`.
- Zufall nur über das übergebene `rng`.
