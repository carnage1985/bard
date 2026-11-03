const test = require('node:test');
const assert = require('node:assert/strict');
const { phrase, validate, fill, KINDS } = require('../src/utils/gemini');

const quiet = { info() {}, warn() {}, error() {} };
const VARS = { name: '**Eve**', channel: '<#42>' };
const FALLBACK = '{name} ist alleine in {channel}.';
const FALLBACK_TEXT = '**Eve** ist alleine in <#42>.';

const realFetch = global.fetch;
function mockGemini(text, { ok = true, status = 200 } = {}) {
  global.fetch = async () => ({
    ok,
    status,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  });
}
test.beforeEach(() => { process.env.GEMINI_API_KEY = 'test-key'; });
test.afterEach(() => { global.fetch = realFetch; delete process.env.GEMINI_API_KEY; });

test('fill ersetzt Platzhalter in einem Durchgang', () => {
  assert.equal(fill('{a} und {b} {c}', { a: '{b}', b: 'x' }), '{b} und x {c}');
});

test('gültige Gemini-Antwort wird übernommen und Platzhalter gefüllt', async () => {
  mockGemini('Heda, {name} wartet einsam in {channel} auf Gefährten! 🎶');
  assert.equal(await phrase('ping', FALLBACK, VARS, quiet), 'Heda, **Eve** wartet einsam in <#42> auf Gefährten! 🎶');
});

test('ohne API-Key: Fallback ohne fetch', async () => {
  delete process.env.GEMINI_API_KEY;
  global.fetch = async () => { throw new Error('darf nicht aufgerufen werden'); };
  assert.equal(await phrase('ping', FALLBACK, VARS, quiet), FALLBACK_TEXT);
});

for (const [label, text] of [
  ['fehlender Platzhalter', 'Heda, {name} wartet einsam auf Gefährten, kommt doch!'],
  ['unbekannter Platzhalter', '{name} sitzt in {channel} mit {niemand} alleine herum.'],
  ['@everyone', '@everyone: {name} sitzt in {channel} alleine herum.'],
  ['Erwähnung per <', '<@123> {name} sitzt in {channel} alleine herum.'],
  ['Link', '{name} sitzt in {channel} alleine, siehe https://evil.example'],
  ['mehrzeilig', '{name} sitzt in {channel}\nalleine herum.'],
  ['zu lang', `{name} {channel} ${'x'.repeat(KINDS.ping.max)}`],
]) {
  test(`ungültige Antwort (${label}) -> Fallback`, async () => {
    mockGemini(text);
    assert.equal(await phrase('ping', FALLBACK, VARS, quiet), FALLBACK_TEXT);
  });
}

test('HTTP-Fehler -> Fallback', async () => {
  mockGemini('egal', { ok: false, status: 429 });
  assert.equal(await phrase('ping', FALLBACK, VARS, quiet), FALLBACK_TEXT);
});

test('Netzwerkfehler -> Fallback', async () => {
  global.fetch = async () => { throw new Error('offline'); };
  assert.equal(await phrase('ping', FALLBACK, VARS, quiet), FALLBACK_TEXT);
});

test('Timeout -> Fallback', async () => {
  global.fetch = (url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const { generateText } = require('../src/utils/gemini');
  assert.equal(await generateText('x', { logger: quiet, timeoutMs: 20 }), null);
});

test('dm-Variante verlangt {minutes} und {channel}', () => {
  assert.equal(validate('Du sitzt seit {minutes} Min. einsam in {channel} herum.', KINDS.dm), 'Du sitzt seit {minutes} Min. einsam in {channel} herum.');
  assert.equal(validate('Du sitzt einsam in {channel} herum, tapferer Recke.', KINDS.dm), null);
});
