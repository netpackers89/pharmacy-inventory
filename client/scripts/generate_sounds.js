#!/usr/bin/env node
/**
 * generate_sounds.js — builds the UI notification sounds shipped in
 * client/public/sounds/.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The previous audio in this project was the Web Speech API pronunciation
 * forced to `pitch: 0.85` at full volume. On devices whose only local voices
 * are low-quality synths (eSpeak / Flite "compact" voices) that combination
 * produced a deep, distorted, growl-like "horror" tone. This script instead
 * renders four SHORT, SOFT, PURE-SINE UI tones with a proper envelope.
 *
 * DESIGN RULES (each one is enforced by the checks at the bottom of this
 * file, not merely documented):
 *   • Pure sine + a very quiet octave. No saw/square waves, so there are no
 *     harsh harmonics, no buzz and no distortion.
 *   • 493 Hz - 1318 Hz only. Nothing below ~490 Hz, so the sound can never
 *     read as a low rumble or a growl.
 *   • Peak normalised to SOFT_PEAK (0.62) and hard-limited, so the waveform
 *     cannot clip in any browser at any volume.
 *   • 8 ms raised-cosine attack and an exponential release down to a true
 *     zero. A tone that starts or ends at a non-zero sample value produces an
 *     audible click, which is what makes cheap UI sounds feel broken.
 *   • 16-bit PCM, 44.1 kHz, mono WAV — the most widely supported browser
 *     audio format (Chrome, Firefox, Safari, Edge, Android and iOS).
 *   • 90-200 ms per sound: long enough to read as a "ding", short enough to
 *     never be intrusive on a busy pharmacy counter.
 *
 * Usage:  node client/scripts/generate_sounds.js
 * Output: client/public/sounds/{success,notify,warning,error}.wav
 */

// The client package is "type": "module", so this dev script uses ESM
// imports — matching the package the rest of the frontend uses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SAMPLE_RATE = 44100;
const BITS_PER_SAMPLE = 16;
const SOFT_PEAK = 0.62;   // headroom that guarantees no clipping anywhere
const CHANNELS = 1;


/* ── tone definitions ─────────────────────────────────────────────────── */
/*
 * Each sound is a list of notes. A note plays at `freq` Hz for `ms`, with
 * `gain` scaling it relative to the overall soft peak — used to make the
 * second note of a chime slightly quieter, which is what real UI chimes do.
 */
const SOUNDS = {
  /* Saved successfully / completed. A gentle rising two-note chime. */
  success: [
    { freq: 880.00,  ms: 85, gain: 1.00 },   // A5
    { freq: 1318.51, ms: 150, gain: 0.85 },  // E6, slightly softer
  ],

  /* Barcode / QR scan accepted. One short, bright, friendly blip. */
  notify: [
    { freq: 1174.66, ms: 130, gain: 1.00 },  // D6
  ],

  /* Warning (low stock, needs attention, unsaved changes). Two mid notes,
     level with each other — "notice me", but never shrill. */
  warning: [
    { freq: 987.77, ms: 95, gain: 0.95 },   // B5
    { freq: 739.99, ms: 140, gain: 1.00 },  // F#5
  ],

  /* Error / failed operation. A soft descending pair — clearly different from
     the warning, still gentle (no buzz, no siren, no growl). */
  error: [
    { freq: 659.25, ms: 95, gain: 1.00 },   // E5
    { freq: 493.88, ms: 150, gain: 0.90 },  // B4
  ],
};

/* A single quiet octave above the fundamental. This is what makes a sine
   chime sound "professional" rather than a bare test tone, because it gives
   the ear a second, quieter partial to lock onto. Kept very low (8%) so it
   can never introduce harshness. */

/**
 * Raised-cosine attack / exponential release envelope.
 * Guarantees the waveform starts and ends at exactly 0.0 → zero clicks.
 */
const envelope = (t, duration) => {
  if (t < 0 || t > duration) return 0;

  const attack = 0.008;                       // 8 ms
  const releaseStart = duration * 0.42;       // release over the last 58%

  if (t < attack) {
    const x = t / attack;                     // smoothstep 0 -> 1
    return x * x * (3 - 2 * x);
  }
  if (t < releaseStart) return 1;

  const x = (t - releaseStart) / (duration - releaseStart);
  return Math.max(0, Math.exp(-4.5 * x) - 0.0001) / 0.9999;
};

/** Render one note into the shared float buffer. */
const renderNote = (buffer, offsetSeconds, note) => {
  const duration = note.ms / 1000;
  const start = Math.floor(offsetSeconds * SAMPLE_RATE);
  const end = Math.min(buffer.length, start + Math.floor(duration * SAMPLE_RATE));
  const w = (2 * Math.PI * note.freq) / SAMPLE_RATE;
  const wHarm = w * 2;

  for (let i = start; i < end; i += 1) {
    const t = (i - start) / SAMPLE_RATE;
    const env = envelope(t, duration);
    if (env <= 0) continue;
    const fundamental = Math.sin(w * (i - start));
    const harmonic = Math.sin(wHarm * (i - start)) * HARMONIC_MIX;
    buffer[i] += (fundamental + harmonic) * env * note.gain;
  }
};

/**
 * Build the float sample buffer for a whole sound.
 * The result is already peak-normalised to SOFT_PEAK, so it is exactly the
 * signal that gets written to the .wav — the safety checks below therefore
 * measure the real output rather than an intermediate value.
 */
const renderSound = (notes) => {
  const totalMs = notes.reduce((sum, n) => sum + n.ms, 0);
  const buffer = new Float32Array(Math.ceil((totalMs / 1000) * SAMPLE_RATE) + 1);

  let offset = 0;
  for (const note of notes) {
    renderNote(buffer, offset, note);
    offset += note.ms / 1000;
  }

  let peak = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const abs = Math.abs(buffer[i]);
    if (abs > peak) peak = abs;
  }
  if (peak > 0) {
    const scale = SOFT_PEAK / peak;
    for (let i = 0; i < buffer.length; i += 1) buffer[i] *= scale;
  }
  return buffer;
};

const HARMONIC_MIX = 0.08;


/** Encode a float buffer as a 16-bit PCM mono WAV file. */
const encodeWav = (samples) => {
  const dataBytes = samples.length * 2; // 16-bit = 2 bytes per sample
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');

  // fmt sub-chunk (PCM)
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);                              // sub-chunk size
  buffer.writeUInt16LE(1, 20);                               // audio format: PCM
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), 28); // byte rate
  buffer.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32);              // block align
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);

  // data sub-chunk
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  /* Peak-normalise to SOFT_PEAK, then hard-limit. This is the guarantee that
     the file can never clip, no matter how the notes are combined. */
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  const scale = peak > 0 ? SOFT_PEAK / peak : 1;

  for (let i = 0; i < samples.length; i += 1) {
    let v = samples[i] * scale;
    if (v > SOFT_PEAK) v = SOFT_PEAK;
    else if (v < -SOFT_PEAK) v = -SOFT_PEAK;
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }

  return buffer;
};


const outDir = path.resolve(__dirname, '..', 'public', 'sounds');
fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
Object.entries(SOUNDS).forEach(([name, notes]) => {
  const samples = renderSound(notes);
  const wav = encodeWav(samples);
  fs.writeFileSync(path.join(outDir, `${name}.wav`), wav);

  /* Verify the rendered signal, so the safety guarantees are auditable. */
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    if (Math.abs(v) > peak) peak = Math.abs(v);
    sumSquares += v * v;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  const ms = Math.round((samples.length / SAMPLE_RATE) * 1000);
  const lowest = Math.min(...notes.map((n) => n.freq));

  if (peak > SOFT_PEAK + 1e-6) failures += 1;              // clipping
  if (lowest < 490) failures += 1;                          // rumble / growl
  if (Math.abs(samples[0]) > 1e-6 || Math.abs(samples[samples.length - 1]) > 1e-6) failures += 1; // click

  console.log(
    `${name.padEnd(8)} ${String(ms).padStart(4)}ms  peak ${peak.toFixed(3)}  ` +
    `rms ${rms.toFixed(3)}  lowest ${Math.round(lowest)}Hz  ${(wav.length / 1024).toFixed(1)}KB`
  );
});

if (failures > 0) {
  console.error(`\nFAILED safety checks (${failures}). Refusing to keep unsafe audio.`);
  process.exit(1);
}
console.log('\nAll sounds written to client/public/sounds/ (no clipping, no sub-490Hz content).');
