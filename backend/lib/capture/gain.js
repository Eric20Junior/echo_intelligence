// Input gain (Settings > Audio): amplifies the raw s16le PCM before it reaches
// both the RMS meter and Deepgram, so a quiet lapel mic can be boosted without
// the operator needing OS-level mixer access mid-service. Clamped to int16
// range rather than wrapping, since wrapping would produce loud digital noise
// instead of just clipping the peaks.
function applyGain(chunk, gain) {
  if (gain === 1) return chunk; // common case — skip the copy entirely
  const out = Buffer.alloc(chunk.length);
  for (let i = 0; i < chunk.length - 1; i += 2) {
    const sample = chunk.readInt16LE(i);
    const scaled = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
    out.writeInt16LE(scaled, i);
  }
  return out;
}

module.exports = { applyGain };
