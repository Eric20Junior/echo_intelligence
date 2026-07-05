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

module.exports = { rmsLevel };
