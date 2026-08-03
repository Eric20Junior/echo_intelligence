// Auto-gain unit test (backend/lib/capture/auto-gain.js), run by `npm test`.
//
// Anchored on the failure that prompted the module: a Windows install capturing
// a PA speaker from across a room delivered speech at roughly -40 dBFS, quiet
// enough that Deepgram returned nothing while the meter showed a single bar.
// The cases below are synthetic PCM rather than fixtures because what's being
// tested is the control loop's arithmetic, not any real recording.
const assert = require("assert");
const { createAutoGain, TARGET_RMS, MAX_GAIN, UNCONFIRMED_MAX_GAIN } = require("../lib/capture/auto-gain");
const { rmsLevel, meterScale } = require("../lib/capture/audio-level");
const { applyGain } = require("../lib/capture/gain");

const SAMPLE_RATE = 16000;
const CHUNK_MS = 100;

// A 220Hz carrier at a given RMS, amplitude-modulated at 4Hz — roughly syllable
// rate. The modulation matters: the AGC separates speech from steady room noise
// by how much the level moves (see SPEECH_FLUCTUATION), so an unmodulated sine
// is not a stand-in for speech and testing with one would exercise the wrong
// path entirely. Use steadyTone below when a *non*-speech signal is the point.
function tone(rmsAmplitude, ms = CHUNK_MS, offsetMs = 0) {
  const samples = Math.floor((SAMPLE_RATE * ms) / 1000);
  const buf = Buffer.alloc(samples * 2);
  // Normalised so the modulated waveform still measures the requested RMS.
  const peak = (rmsAmplitude * Math.SQRT2 * 32768) / Math.sqrt(1.125);
  const startSample = Math.floor((SAMPLE_RATE * offsetMs) / 1000);
  for (let i = 0; i < samples; i++) {
    const t = (startSample + i) / SAMPLE_RATE;
    const envelope = 1 + 0.5 * Math.sin(2 * Math.PI * 4 * t);
    buf.writeInt16LE(Math.round(peak * envelope * Math.sin(2 * Math.PI * 220 * t)), i * 2);
  }
  return buf;
}

// Unmodulated — stands in for a fan, mains hum, or an air handler.
function steadyTone(rmsAmplitude, ms = CHUNK_MS) {
  const samples = Math.floor((SAMPLE_RATE * ms) / 1000);
  const buf = Buffer.alloc(samples * 2);
  const peak = rmsAmplitude * Math.SQRT2 * 32768;
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(peak * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE)), i * 2);
  }
  return buf;
}

function silence(ms = CHUNK_MS) {
  return Buffer.alloc(Math.floor((SAMPLE_RATE * ms) / 1000) * 2);
}

// Runs `seconds` worth of chunks through the loop and returns the settled gain.
// Advances the modulation phase across chunks so the envelope is continuous
// rather than restarting identically every 100ms.
function settle(agc, chunk, seconds, modulated = null) {
  let gain = 1;
  const steps = (seconds * 1000) / CHUNK_MS;
  for (let i = 0; i < steps; i++) {
    gain = agc.update(modulated === null ? chunk : modulated(i * CHUNK_MS));
  }
  return gain;
}

// Continuous modulated speech at a fixed level, phase-advanced per chunk.
function speech(rmsAmplitude) {
  return (offsetMs) => tone(rmsAmplitude, CHUNK_MS, offsetMs);
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("boosts the across-the-room case to a transcribable level", () => {
  // -40 dBFS: the level actually observed on the Windows install.
  const quiet = tone(0.01);
  const gain = settle(createAutoGain(), null, 15, speech(0.01));
  const resultRms = rmsLevel(applyGain(quiet, gain));
  assert.ok(
    resultRms > TARGET_RMS * 0.7 && resultRms < TARGET_RMS * 1.3,
    `expected settled RMS near ${TARGET_RMS}, got ${resultRms.toFixed(4)} at gain ${gain.toFixed(1)}`,
  );
});

test("that same input crosses from one meter bar to a visible reading", () => {
  const quiet = tone(0.01);
  const before = Math.floor(meterScale(rmsLevel(quiet)) * 12);
  const gain = settle(createAutoGain(), null, 15, speech(0.01));
  const after = Math.floor(meterScale(rmsLevel(applyGain(quiet, gain))) * 12);
  assert.ok(before <= 4, `quiet input should read low before gain, got ${before} bars`);
  assert.ok(after >= 7, `expected a clearly visible meter after gain, got ${after} bars`);
});

test("attenuates a too-hot input instead of only boosting", () => {
  const gain = settle(createAutoGain(), null, 15, speech(0.5));
  assert.ok(gain < 1, `expected attenuation below 1x, got ${gain.toFixed(2)}`);
});

test("holds gain through silence rather than amplifying the noise floor", () => {
  const agc = createAutoGain();
  const settled = settle(agc, null, 15, speech(0.01));
  const afterSilence = settle(agc, silence(), 30);
  assert.strictEqual(afterSilence, settled, "silence must not move the gain");
});

test("does not clip when speech starts after a long silence", () => {
  const agc = createAutoGain();
  settle(agc, silence(), 30);
  // Sudden loud onset — the peak guard has to catch this on the first chunk,
  // before the (deliberately slow) rise smoothing would have reacted.
  const loud = tone(0.4);
  const gain = agc.update(loud);
  const out = applyGain(loud, gain);
  let clipped = 0;
  for (let i = 0; i < out.length - 1; i += 2) {
    if (Math.abs(out.readInt16LE(i)) >= 32767) clipped++;
  }
  assert.strictEqual(clipped, 0, `${clipped} samples clipped on loud onset`);
});

test("never exceeds the configured ceiling on a near-dead input", () => {
  const gain = settle(createAutoGain(), null, 60, speech(0.0001));
  assert.ok(gain <= MAX_GAIN, `gain ${gain} exceeded MAX_GAIN ${MAX_GAIN}`);
});

test("rises gradually rather than jumping on the first chunk", () => {
  const agc = createAutoGain();
  const first = agc.update(tone(0.01));
  assert.ok(first < 3, `first-chunk gain should ramp, jumped straight to ${first.toFixed(1)}`);
});

test("reaches a usable level within the first seconds of a service", () => {
  // The operator presses Start Listening and the preacher is already talking.
  // Converging over a leisurely 10s means the opening of the sermon is lost, so
  // the warmup path has to get most of the way there fast.
  const gain = settle(createAutoGain(), null, 5, speech(0.005));
  const rms = rmsLevel(applyGain(tone(0.005), gain));
  assert.ok(rms > TARGET_RMS * 0.5, `after 5s expected near target, got ${rms.toFixed(4)} (gain ${gain.toFixed(1)}x)`);
});

test("a steady tone does not gate itself off entirely", () => {
  // Regression: the adaptive noise floor tracks toward whatever it hears during
  // quiet. A signal with no gaps at all (a test tone, a constant hum) let the
  // floor rise to meet it, after which nothing ever counted as speech again and
  // the gain froze at 1x. Real speech has pauses and hid this. A steady tone
  // still shouldn't get the *full* boost — it isn't speech — but it must not
  // deadlock at unity either.
  const gain = settle(createAutoGain(), steadyTone(0.01), 20);
  assert.ok(gain > 4, `steady quiet tone should still be boosted, got ${gain.toFixed(2)}x`);
});

test("an empty room does not wind the gain up to maximum", () => {
  // The other side of the same coin: with no speech at all, amplifying the
  // noise floor toward the target would leave the gain pinned so the first real
  // words arrive clipped, and would feed Deepgram amplified hiss meanwhile.
  // Steady (unmodulated) on purpose — that's what distinguishes it from speech.
  const agc = createAutoGain();
  settle(agc, silence(), 5); // past the floor warmup, so this tests steady-state gating
  const gain = settle(agc, steadyTone(0.0008), 60); // ≈-62 dBFS room tone
  assert.ok(gain <= UNCONFIRMED_MAX_GAIN, `room tone drove gain to ${gain.toFixed(1)}x`);
});

test("recovers when the speaker moves closer mid-sermon", () => {
  const agc = createAutoGain();
  settle(agc, null, 10, speech(0.005)); // distant: winds gain up
  const gain = settle(agc, null, 3, speech(0.3)); // steps up to the mic
  const out = applyGain(tone(0.3), gain);
  let clipped = 0;
  for (let i = 0; i < out.length - 1; i += 2) if (Math.abs(out.readInt16LE(i)) >= 32767) clipped++;
  assert.strictEqual(clipped, 0, `${clipped} samples clipped after the speaker moved closer`);
  assert.ok(gain < 2, `expected gain to back off, still at ${gain.toFixed(1)}x`);
});

let pass = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    fn();
    pass++;
  } catch (err) {
    failures.push({ name, message: err.message });
  }
}

console.log(`auto-gain: ${pass}/${tests.length} passed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`\n  ${f.name}\n    ${f.message}`);
  process.exitCode = 1;
}
