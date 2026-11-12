// Reine Helfer für Sprachaufnahmen (ohne Discord-Abhängigkeit, getestet in test/recording.test.js):
// Opus-Pakete, wie Discord sie liefert, werden unverändert in einen Ogg-Container geschrieben
// (kein Decoder, kein ffmpeg nötig). Stille wird nicht aufgefüllt – stattdessen merkt sich der
// Zeitindex, an welcher Stelle der Datei welcher Zeitpunkt der Session liegt.

const SAMPLE_RATE = 48000;

// CRC-32 wie von Ogg verlangt (Polynom 0x04c11db7, ohne Spiegelung, Start 0, kein End-XOR).
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let r = i << 24;
  for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
  CRC_TABLE[i] = r >>> 0;
}
function oggCrc(buf) {
  let crc = 0;
  for (let i = 0; i < buf.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
  return crc;
}

// Dauer eines Opus-Pakets in Samples (48 kHz), gelesen aus dem TOC-Byte (RFC 6716, Abschnitt 3.1).
function opusPacketSamples(packet) {
  if (!packet || packet.length < 1) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  let frameSamples;
  if (config < 12) frameSamples = [480, 960, 1920, 2880][config & 3];      // SILK: 10/20/40/60 ms
  else if (config < 16) frameSamples = [480, 960][config & 1];             // Hybrid: 10/20 ms
  else frameSamples = [120, 240, 480, 960][config & 3];                    // CELT: 2,5/5/10/20 ms
  const code = toc & 3;
  let frames = 1;
  if (code === 1 || code === 2) frames = 2;
  else if (code === 3) frames = packet.length > 1 ? (packet[1] & 0x3f) : 0;
  const samples = frameSamples * frames;
  return samples > 5760 ? 0 : samples; // mehr als 120 ms ist laut RFC ungültig
}

const HEADER_BOS = 2;
const HEADER_EOS = 4;
const MAX_PAGE_PACKETS = 50;      // ~1 s bei 20-ms-Paketen
const MAX_PAGE_SEGMENTS = 255;

/**
 * Schreibt Opus-Pakete als Ogg-Opus-Strom. `sink(buffer)` bekommt fertige Ogg-Seiten.
 * Ohne `end()` fehlt nur die Ende-Markierung – die Datei bleibt abspielbar (wichtig bei Neustart).
 */
class OggOpusWriter {
  constructor(sink, { channels = 2, serial = (Math.random() * 0xffffffff) >>> 0 } = {}) {
    this.sink = sink;
    this.serial = serial >>> 0;
    this.pageSeq = 0;
    this.samples = 0;       // geschriebene Samples insgesamt (= Granule-Position)
    this.pending = [];      // Pakete der noch offenen Seite
    this.pendingSegments = 0;
    this.ended = false;

    const head = Buffer.alloc(19);
    head.write('OpusHead', 0, 'ascii');
    head[8] = 1;                         // Version
    head[9] = channels;
    head.writeUInt16LE(0, 10);           // Pre-Skip
    head.writeUInt32LE(SAMPLE_RATE, 12); // ursprüngliche Abtastrate
    head.writeInt16LE(0, 16);            // Gain
    head[18] = 0;                        // Kanal-Mapping 0 (Mono/Stereo)
    this._page([head], 0n, HEADER_BOS);

    const vendor = Buffer.from('bard', 'utf8');
    const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
    tags.write('OpusTags', 0, 'ascii');
    tags.writeUInt32LE(vendor.length, 8);
    vendor.copy(tags, 12);
    tags.writeUInt32LE(0, 12 + vendor.length);
    this._page([tags], 0n, 0);
  }

  get durationMs() { return Math.round((this.samples / SAMPLE_RATE) * 1000); }

  /** Hängt ein Opus-Paket an. Gibt seine Dauer in Samples zurück (0 = verworfen). */
  writePacket(packet) {
    if (this.ended) return 0;
    const samples = opusPacketSamples(packet);
    if (!samples) return 0;
    const segments = Math.floor(packet.length / 255) + 1;
    if (segments > MAX_PAGE_SEGMENTS) return 0;
    if (this.pendingSegments + segments > MAX_PAGE_SEGMENTS) this.flush();
    this.pending.push(packet);
    this.pendingSegments += segments;
    this.samples += samples;
    if (this.pending.length >= MAX_PAGE_PACKETS) this.flush();
    return samples;
  }

  /** Schreibt die offene Seite hinaus (z. B. am Ende eines Redebeitrags). */
  flush() {
    if (!this.pending.length) return;
    this._page(this.pending, BigInt(this.samples), 0);
    this.pending = [];
    this.pendingSegments = 0;
  }

  /** Schließt den Strom sauber ab. */
  end() {
    if (this.ended) return;
    this.flush();
    this._page([], BigInt(this.samples), HEADER_EOS);
    this.ended = true;
  }

  _page(packets, granule, headerType) {
    const lacing = [];
    for (const p of packets) {
      let rest = p.length;
      while (rest >= 255) { lacing.push(255); rest -= 255; }
      lacing.push(rest);
    }
    const header = Buffer.alloc(27 + lacing.length);
    header.write('OggS', 0, 'ascii');
    header[4] = 0;
    header[5] = headerType;
    header.writeBigUInt64LE(granule, 6);
    header.writeUInt32LE(this.serial, 14);
    header.writeUInt32LE(this.pageSeq++, 18);
    header.writeUInt32LE(0, 22);
    header[26] = lacing.length;
    for (let i = 0; i < lacing.length; i++) header[27 + i] = lacing[i];
    const page = Buffer.concat([header, ...packets]);
    page.writeUInt32LE(oggCrc(page), 22);
    this.sink(page);
  }
}

/**
 * Zeitindex einer Spur: Da Stille nicht gespeichert wird, hält jeder Eintrag fest, dass ab
 * Dateiposition `a` (ms in der Audiodatei) der Session-Zeitpunkt `t` (ms seit Aufnahmestart) gilt.
 * Ein neuer Eintrag entsteht, wenn zwischen zwei Paketen eine Pause lag.
 */
class TrackTimeline {
  constructor({ gapMs = 250 } = {}) {
    this.gapMs = gapMs;
    this.segments = [];
    this.expectedT = null; // Session-Zeit, zu der das nächste Paket ohne Pause käme
  }

  /** Vor dem Schreiben eines Pakets aufrufen. Gibt true zurück, wenn ein neuer Redebeitrag beginnt. */
  note(sessionMs, audioMs, packetMs) {
    const t = Math.max(0, Math.round(sessionMs));
    let started = false;
    if (this.expectedT === null || t - this.expectedT > this.gapMs) {
      this.segments.push({ t, a: Math.round(audioMs) });
      this.expectedT = t;
      started = true;
    }
    // Pakete kommen leicht unregelmäßig an: innerhalb eines Beitrags zählt die Audiodauer, nicht die Ankunftszeit.
    this.expectedT = Math.max(this.expectedT + packetMs, t);
    return started;
  }

  /** Rechnet eine Position in der Audiodatei (ms) in Session-Zeit (ms) um. */
  toSessionMs(audioMs) {
    let seg = null;
    for (const s of this.segments) {
      if (s.a > audioMs) break;
      seg = s;
    }
    return seg ? seg.t + (audioMs - seg.a) : audioMs;
  }
}

function slugify(text, fallback = 'kanal') {
  const slug = String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || fallback;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

module.exports = {
  SAMPLE_RATE, oggCrc, opusPacketSamples, OggOpusWriter, TrackTimeline, slugify, formatDuration,
};
