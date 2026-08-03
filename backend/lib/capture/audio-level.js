// Mic input level meter (roadmap Phase 8 step 4): computes a 0-1 RMS level from
// a raw s16le PCM chunk (the same chunk lib/mic-source.js already hands to
// sendAudio) — no change to mic-source.js's capture path, this just reads the
// same buffer alongside it.
function rmsLevel(chunk) {
  const sampleCount = chunk.length / 2;
  if (sampleCount === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < chunk.length - 1; i += 2) {
    const sample = chunk.readInt16LE(i);
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  return Math.min(1, rms / 32768);
}

// Largest absolute sample in the chunk, 0-1. RMS is an average and so can look
// safe while individual peaks are already clipping — the auto-gain peak guard
// (lib/capture/auto-gain.js) needs the instantaneous figure, not the average.
function peakLevel(chunk) {
  let peak = 0;
  for (let i = 0; i < chunk.length - 1; i += 2) {
    const magnitude = Math.abs(chunk.readInt16LE(i));
    if (magnitude > peak) peak = magnitude;
  }
  return Math.min(1, peak / 32768);
}

// Meter scale. The raw RMS from rmsLevel is linear amplitude, and speech at a
// perfectly good working level sits around 0.05-0.10 of full scale — which on a
// 12-bar linear meter lights exactly one bar. That was read live as "it's not
// hearing anything" when capture was in fact fine, so the meter now shows dBFS
// over a 60 dB window, the way every audio tool does it: normal speech lands
// mid-scale, and the bars only pin at the top when the input is actually hot.
const METER_FLOOR_DB = -60;

function meterScale(level) {
  if (level <= 0) return 0;
  const db = 20 * Math.log10(level);
  if (db <= METER_FLOOR_DB) return 0;
  return Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB);
}

module.exports = { rmsLevel, peakLevel, meterScale, METER_FLOOR_DB };
