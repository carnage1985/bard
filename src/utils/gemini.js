// Kleiner Gemini-Helfer (Free Tier, REST) für abwechslungsreiche statische Texte.
// Ohne GEMINI_API_KEY oder bei Fehlern/ungültiger Antwort wird immer der feste Fallback-Text verwendet.
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const TIMEOUT_MS = 5000;

// Welche Platzhalter die Antwort enthalten muss und was erzählt werden soll
const KINDS = {
  ping: {
    required: ['name', 'channel'],
    max: 200,
    task: 'Schreibe eine Ankündigung für einen Discord-Textkanal: {name} sitzt gerade alleine im Sprachkanal {channel} und würde sich über Gesellschaft freuen. Lade andere ein, dazuzukommen.',
  },
  dm: {
    required: ['minutes', 'channel'],
    max: 160,
    task: 'Schreibe den Anfang einer privaten Nachricht an eine Person, die seit {minutes} Minuten alleine im Sprachkanal {channel} sitzt. Stelle nur fest, dass sie alleine ist – stelle KEINE Frage und nenne keine Optionen.',
  },
};

let warnedNoKey = false;

async function generateText(prompt, { logger = console, timeoutMs = TIMEOUT_MS } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      logger.info('ℹ️ GEMINI_API_KEY nicht gesetzt – verwende feste Texte.', { toDiscord: false });
    }
    return null;
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1, maxOutputTokens: 300 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      logger.warn(`⚠️ Gemini antwortete mit HTTP ${res.status} – verwende festen Text.`, { toDiscord: false });
      return null;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim();
    return text || null;
  } catch (err) {
    logger.warn(`⚠️ Gemini-Anfrage fehlgeschlagen (${err.name === 'AbortError' ? 'Timeout' : err.message}) – verwende festen Text.`, { toDiscord: false });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Ersetzt {platzhalter} in einem Durchgang (Werte werden nicht erneut ausgewertet)
function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match));
}

// Prüft, ob der Gemini-Text sicher verwendbar ist: ein Satz, nur die erlaubten Platzhalter,
// keine Erwähnungen/Links/Markdown-Tricks. Gibt den bereinigten Text oder null zurück.
function validate(text, spec) {
  if (typeof text !== 'string') return null;
  const clean = text.trim().replace(/^["„“']+|["“”']+$/g, '').trim();
  if (clean.length < 10 || clean.length > spec.max) return null;
  if (/[\r\n@<>`]|https?:|discord\.gg/i.test(clean)) return null;

  const used = new Set([...clean.matchAll(/\{(\w+)\}/g)].map(m => m[1]));
  if (!spec.required.every(key => used.has(key))) return null;
  if ([...used].some(key => !spec.required.includes(key))) return null;
  return clean;
}

// phrase('ping', 'Fallback mit {name}', { name: '**Eve**', channel: '<#1>' })
// `fallback` ist ein Template mit denselben Platzhaltern wie `vars`.
async function phrase(kind, fallback, vars, logger = console) {
  const spec = KINDS[kind];
  if (spec) {
    const prompt = [
      `${spec.task}`,
      'Schreibe ganz normal und natürlich, so wie eine freundliche Person im Chat schreiben würde. Keine Rolle, keine Persona, keine Reime, keine Übertreibungen.',
      'Antworte auf Deutsch mit genau EINEM kurzen Satz (höchstens ' + spec.max + ' Zeichen), ohne Emoji.',
      'Verwende die Platzhalter ' + spec.required.map(k => `{${k}}`).join(' und ') + ' genau so, wie sie hier stehen, jeweils mindestens einmal.',
      'Keine @-Erwähnungen, keine Links, keine Anführungszeichen, keine Erklärungen – nur den Satz.',
    ].join('\n');

    const generated = validate(await generateText(prompt, { logger }), spec);
    if (generated) return fill(generated, vars);
  }
  return fill(fallback, vars);
}

module.exports = { generateText, phrase, validate, fill, KINDS, DEFAULT_MODEL };
