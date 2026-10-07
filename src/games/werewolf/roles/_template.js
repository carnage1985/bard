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

  // Nachtaktion (optional)
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
    resolve: (s, ns, ctx) => {},             // ctx.attacks.push({id, cause, blockable}), ctx.protected.add(id)
    forceDone: (s, ns) => {},                // Timeout (optional)
  },

  // Aktion beim Tod (optional), z. B. Jäger
  deathTrigger: {
    targets: (s, actor) => [],
    resolve: (s, actor, targetId) => [],     // gibt [{id, cause}] zusätzlicher Tode zurück
    ui: { prompt: 'Wen nimmst du mit?' },
  },

  initState: (s) => ({}),    // Rollen-Zustand in s.roleState[id] (z. B. Tränke)
  onDeath: (s, player, cause) => null, // optional: { winner, reason } für Sondersiege (z. B. Narr)
  checkWin: (s) => null,     // optional: zusätzliche Siegbedingung
};
