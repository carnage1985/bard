// Vorlage für eine neue Rolle – Datei kopieren, umbenennen (ohne führenden "_") und anpassen.
// Alle Felder außer id/name/team sind optional. Details: docs/werewolf-roles.md
const { TEAMS } = require('../teams');

module.exports = {
  id: 'beispiel',            // eindeutig, [a-z0-9_]
  name: 'Beispiel',
  emoji: '❓',
  team: TEAMS.VILLAGE,       // VILLAGE | WOLVES | NEUTRAL
  description: 'Kurzbeschreibung für die Rollen-DM.',
  order: 50,                 // Reihenfolge bei Rollenverteilung/Anzeige (klein = früh)
  defaultCount: (n, options) => (n >= 8 ? 1 : 0), // Anzahl bei n Spielern (Host kann per options.roles überschreiben)
  seenAs: 'villager',        // was der Seher sieht: 'wolf' | 'villager'
  knowsTeam: false,          // kennt die Teammitglieder (z. B. Wölfe)
  allies: (s, me) => [],     // statt knowsTeam: eigene Verbündete (z. B. Vampire)
  hostile: false,            // true: das Dorf gewinnt erst, wenn auch diese Rolle besiegt ist (Vampir)
  voteWeight: (s, player) => 1, // Gewicht der Lynch-Stimme (Bürgermeister: 2)
  packWeight: 1,             // Gewicht in der Rudelabstimmung (Alphawolf: 2)
  replaces: null,            // verdrängt eine andere Rolle der Zusammenstellung (Alphawolf → 'werewolf')
  ownCountOption: false,     // eigene Anzahl-Auswahl in den Lobby-Optionen (Werwolf)
  extraInfo: (s, me) => [],  // Zusatzzeilen in der Rollen-DM (z. B. Ziel des Lynchers)

  // Nachtaktion (optional). Gruppe statt eigener Regeln: night: { group: 'werewolf' } – gemeinsame Abstimmung
  // mit der Gruppen-Rolle (nutzt deren Ziele/Hooks), z. B. Alphawolf.
  night: {
    needs: [],               // Rollen-IDs, die zuerst fertig sein müssen (z. B. ['werewolf'])
    revisable: false,        // Auswahl bis zum Ende ändern (Rudelabstimmung)
    ui: { kind: 'target', prompt: 'Wen wählst du?' },
    canAct: (s, actor) => true,              // false = Rolle überspringt (z. B. keine Tränke mehr)
    targets: (s, actor) => [],               // erlaubte Ziele (Spieler-Objekte)
    normalize: (s, actor, input) => ({ targetId: input.targetId }), // prüft Eingabe (throw bei Fehler), Rückgabe wird gespeichert
    onSubmit: (s, actor, data, events) => {},                        // sofortige private Events (z. B. Seher-Ergebnis)
    onOpen: (s, ns, actors, events) => {},                           // wird einmal aufgerufen, wenn `needs` erfüllt sind
    onDone: (s, ns, events, rng) => {},                              // wenn alle Akteure fertig sind
    resolveOrder: 50,        // Auflösung morgens: kleiner = früher (Schutz 10, Angriffe 20)
    resolve: (s, ns, ctx) => {},             // ctx.attacks.push({id, cause, blockable}), ctx.protected.add(id),
                                             // ctx.immune.add(id), ctx.conversions.push({id, roleId}), ctx.visits (lesen)
    forceDone: (s, ns) => {},                // Timeout (optional)
  },

  // Aktion beim Tod (optional), z. B. Jäger
  deathTrigger: {
    targets: (s, actor) => [],
    resolve: (s, actor, targetId) => [],     // gibt [{id, cause}] zusätzlicher Tode zurück
    ui: { prompt: 'Wen nimmst du mit?' },
  },

  resolveNight: (s, ns, ctx) => {}, // wie night.resolve, aber auch ohne eigene Nachtaktion (Granny); + resolveOrder
  initState: (s, rng) => ({}), // Rollen-Zustand in s.roleState[id] (z. B. Tränke, Ziel des Lynchers)
  onDeath: (s, player, cause) => null, // optional: { winner, reason, playerIds } wenn DIESE Rolle stirbt (Narr)
  onPlayerDeath: (s, dead, cause) => null, // optional: reagiert auf JEDEN Tod → { win, convert: [{id, roleId}] } (Lyncher)
  checkWin: (s) => null,     // optional: zusätzliche Siegbedingung
};
