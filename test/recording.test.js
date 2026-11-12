const test = require('node:test');
const assert = require('node:assert/strict');
const {
  oggCrc, opusPacketSamples, OggOpusWriter, TrackTimeline, slugify, formatDuration,
} = require('../src/utils/recording');

// Zerlegt einen Ogg-Strom wieder in Seiten und Pakete (prüft dabei Kennung und Prüfsumme).
function parseOgg(buf) {
  const pages = [];
  const packets = [];
  let pos = 0;
  let partial = [];
  while (pos < buf.length) {
    assert.equal(buf.toString('ascii', pos, pos + 4), 'OggS');
    const segCount = buf[pos + 26];
    const lacing = [...buf.subarray(pos + 27, pos + 27 + segCount)];
    const bodyLen = lacing.reduce((a, b) => a + b, 0);
    const end = pos + 27 + segCount + bodyLen;
    const page = Buffer.from(buf.subarray(pos, end));
    const crc = page.readUInt32LE(22);
    page.writeUInt32LE(0, 22);
    assert.equal(oggCrc(page), crc, 'Prüfsumme der Seite stimmt');
    pages.push({ type: page[5], granule: page.readBigUInt64LE(6), seq: page.readUInt32LE(18) });
    let off = pos + 27 + segCount;
    for (const len of lacing) {
      partial.push(buf.subarray(off, off + len));
      off += len;
      if (len < 255) { packets.push(Buffer.concat(partial)); partial = []; }
    }
    pos = end;
  }
  return { pages, packets };
}

// Opus-Paket mit TOC 0x78 (CELT-Vollband, 20 ms, ein Frame) und beliebiger Nutzlast
const packet20ms = (size = 60) => Buffer.concat([Buffer.from([0x78]), Buffer.alloc(size - 1, 7)]);

test('opusPacketSamples liest die Dauer aus dem TOC-Byte', () => {
  assert.equal(opusPacketSamples(Buffer.from([0x78, 0])), 960);          // CELT 20 ms
  assert.equal(opusPacketSamples(Buffer.from([0xf8, 0xff, 0xfe])), 960); // Discords Stille-Frame
  assert.equal(opusPacketSamples(Buffer.from([0x08, 0])), 960);          // SILK 20 ms
  assert.equal(opusPacketSamples(Buffer.from([0x18, 0])), 2880);         // SILK 60 ms
  assert.equal(opusPacketSamples(Buffer.from([0x79, 0, 0])), 1920);      // zwei Frames
  assert.equal(opusPacketSamples(Buffer.from([0x7b, 3, 0])), 2880);      // Code 3: drei Frames
  assert.equal(opusPacketSamples(Buffer.alloc(0)), 0);
  assert.equal(opusPacketSamples(Buffer.from([0x1b, 40])), 0);           // > 120 ms ist ungültig
});

test('OggOpusWriter schreibt gültige Seiten, Kopf und alle Pakete', () => {
  const chunks = [];
  const writer = new OggOpusWriter((p) => chunks.push(p), { serial: 1234 });
  const input = [];
  for (let i = 0; i < 120; i++) { const p = packet20ms(40 + (i % 30)); input.push(p); writer.writePacket(p); }
  const big = packet20ms(600); // länger als 255 Bytes → mehrere Segmente
  input.push(big); writer.writePacket(big);
  const exact = packet20ms(255); // genau 255 Bytes → braucht ein leeres Abschluss-Segment
  input.push(exact); writer.writePacket(exact);
  writer.end();

  const { pages, packets } = parseOgg(Buffer.concat(chunks));
  assert.equal(packets[0].toString('ascii', 0, 8), 'OpusHead');
  assert.equal(packets[0].readUInt32LE(12), 48000);
  assert.equal(packets[1].toString('ascii', 0, 8), 'OpusTags');
  assert.deepEqual(packets.slice(2), input);
  assert.equal(pages[0].type, 2, 'erste Seite ist als Anfang markiert');
  assert.equal(pages.at(-1).type, 4, 'letzte Seite ist als Ende markiert');
  assert.deepEqual(pages.map((p) => p.seq), pages.map((_, i) => i));
  assert.equal(pages.at(-1).granule, BigInt(122 * 960));
  assert.equal(writer.durationMs, 2440);
});

test('OggOpusWriter verwirft ungültige Pakete und schreibt nach end() nichts mehr', () => {
  const chunks = [];
  const writer = new OggOpusWriter((p) => chunks.push(p));
  assert.equal(writer.writePacket(Buffer.alloc(0)), 0);
  assert.equal(writer.writePacket(packet20ms()), 960);
  writer.end();
  const count = chunks.length;
  assert.equal(writer.writePacket(packet20ms()), 0);
  writer.end();
  assert.equal(chunks.length, count);
});

test('TrackTimeline legt nur nach Pausen neue Einträge an und rechnet zurück', () => {
  const tl = new TrackTimeline();
  let audio = 0;
  const speak = (startMs, packets, jitter = 0) => {
    for (let i = 0; i < packets; i++) {
      tl.note(startMs + i * 20 + (i % 2 ? jitter : 0), audio, 20);
      audio += 20;
    }
  };
  speak(1000, 50, 15);   // 1 s Rede ab Sekunde 1, mit unregelmäßiger Ankunft
  speak(10000, 100);     // 2 s Rede ab Sekunde 10
  speak(12100, 10);      // Pause von 100 ms → gehört noch zum selben Beitrag
  assert.deepEqual(tl.segments, [{ t: 1000, a: 0 }, { t: 10000, a: 1000 }]);
  assert.equal(tl.toSessionMs(500), 1500);
  assert.equal(tl.toSessionMs(1000), 10000);
  assert.equal(tl.toSessionMs(2500), 11500);
});

test('slugify und formatDuration', () => {
  assert.equal(slugify('🎲 D&D – Höhle der Trolle!'), 'd-d-hohle-der-trolle');
  assert.equal(slugify('🎲'), 'kanal');
  assert.equal(formatDuration(42_000), '42 s');
  assert.equal(formatDuration(125_000), '2 min 05 s');
  assert.equal(formatDuration(3 * 3600_000 + 7 * 60_000), '3 h 07 min');
});
