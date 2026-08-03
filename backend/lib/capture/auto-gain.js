// Automatic input gain (AGC), the always-on default for Settings > Audio.
//
// Why this exists: the manual gain slider assumes the operator knows their mic
// is too quiet, can see that from the meter, and has a free hand mid-service to
// fix it. All three failed on the first real Windows install — a laptop mic
// picking up a PA speaker across a room delivered speech around -45 dBFS, which
// is real audio (ffmpeg was capturing fine) but far below the level Deepgram
// needs to produce words. The operator saw "listening", one lit bar, and no
// transcript, with no way to tell a quiet mic from a broken one.
//
// This closes that loop: measure the incoming speech level and pick the
// multiplier that lands it on target, continuously, without anyone touching a
// slider. It only computes the multiplier — lib/capture/gain.js still does the
// actual sample scaling, so there's exactly one place that touches PCM.
const { rmsLevel, peakLevel } = require("./audio-level");

// Target speech level, ≈-22 dBFS RMS. Chosen well below full scale because RMS
// is a long-run average and speech peaks run 12-18 dB above it; targeting
// anything hotter means the peak guard below fights the gain ramp constantly.
const TARGET_RMS = 0.08;

// 0.25 lets a genuinely hot input be pulled *down* rather than only boosted; 64
// (+36 dB) covers the across-the-room case that prompted this. The ceiling is
// deliberately generous because the alternative — capping lower and staying
// quiet — means no transcript at all, whereas an over-amplified room's worst
// case is audible hiss that Deepgram tolerates.
const MIN_GAIN = 0.25;
const MAX_GAIN = 64;

// Asymmetric adaptation: creep up over seconds so a lull between sentences
// doesn't audibly pump the level, but come down quickly, since being too loud
// means clipping — which destroys transcription accuracy outright, where being
// too quiet for another second only delays it.
const RISE_TIME_S = 3;
const FALL_TIME_S = 0.4;

// The steady-state rise above is too slow to start a service with: from unity
// it takes ~10s of speech to reach a 20x target, and those are exactly the
// seconds where someone has just pressed Start Listening and begun talking. So
// the first stretch of speech in a session converges roughly 6x faster, then
// hands over to the slow constant once the level is established.
const WARMUP_RISE_TIME_S = 0.5;
const WARMUP_SPEECH_S = 2.5;

// Noise floor tracking. A fixed silence threshold can't work across both a
// close lapel mic and a mic hearing a PA across a room — the room case's actual
// speech is quieter than the lapel case's *silence*, so any constant either
// gates real speech out of one or lets room tone into the other (a fixed
// -56 dBFS constant did exactly the former: at -45 dBFS input the gate stayed
// shut and the gain never moved). Tracked per session instead: falls quickly to
// follow genuine quiet, rises slowly so a long loud passage doesn't drag the
// floor up behind it and gate itself off.
const FLOOR_FALL_TIME_S = 0.5;
const FLOOR_RISE_TIME_S = 20;

// Speech has to beat the tracked floor by 6 dB to count. Low enough to catch a
// distant speaker, high enough that fan noise and mains hum don't read as
// speech and wind the gain up during an empty room.
const FLOOR_MARGIN = 2;

// The floor is seeded from the first chunk, which may well be mid-sentence, so
// for this opening window the margin test above is skipped and anything audible
// adapts the gain. Two jobs: it gets the level right within the first breath of
// a service, and it stops a perfectly steady input (a test tone, a constant
// hum) from deadlocking — with no gaps to track downward through, the floor
// would otherwise rise to meet the signal and gate it out permanently.
const FLOOR_WARMUP_S = 2.5;

// ≈-74 dBFS. Floor of the floor: digital silence would otherwise drive the
// tracker toward zero, after which any dither at all reads as speech.
const ABS_SILENCE_RMS = 0.0002;

// Level alone cannot separate distant speech from room tone — a PA heard across
// a room and a server fan can sit at the same -62 dBFS. What separates them is
// *movement*: speech swings level syllable to syllable, while a fan, mains hum,
// or air handling holds steady. Measured as the average absolute deviation of
// the log level from its own short running mean.
//
// The envelope tau is deliberately short (0.6s). A longer one measures
// syllables just as well but also treats a single step change — silence, then a
// hum switching on — as fluctuation for as long as it takes to catch up, which
// read a constant tone as speech. At 0.6s the envelope absorbs a step within a
// chunk or two while still lagging syllable rate.
//
// Measured over the three real sermon recordings in test-audio/, attenuated to
// -40 dBFS: speech averages 0.40-0.62, while steady tone, white noise, and a
// silence-to-hum step peak at 0.115. The threshold sits in that gap with ~3.5x
// margin either side. Re-check with test/auto-gain-run.js if these move.
const FLUCTUATION_ENVELOPE_TAU_S = 0.6;
const FLUCTUATION_TAU_S = 5;
const SPEECH_FLUCTUATION = 0.25;

// Gain ceiling before anything speech-shaped has been heard. A room that is
// merely quiet still gets a useful boost, but an empty room can't wind all the
// way to MAX_GAIN and sit there amplifying its own hiss into Deepgram — and,
// worse, clipping the first words when someone finally speaks. Lifts to the
// full MAX_GAIN as soon as the fluctuation test above confirms real speech.
const UNCONFIRMED_MAX_GAIN = 8;

// Hard ceiling for instantaneous peaks. Clipping is unrecoverable distortion,
// so this one bypasses all the smoothing above and applies immediately.
const PEAK_CEILING = 0.97;

const SAMPLE_RATE = 16000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Exponential smoothing coefficient for a given time constant, derived from the
// chunk's own duration rather than assuming a fixed chunk size — ffmpeg's pipe
// writes are not a guaranteed length, and hardcoding one would make every time
// constant here silently wrong on any platform that chunks differently.
function smoothing(dt, tau) {
  return 1 - Math.exp(-dt / tau);
}

// The fluctuation estimate uses a 5s time constant, which is right for a stable
// reading but means an EMA starting from zero needs several seconds before it
// reflects reality — and until it does, the gain stays capped at
// UNCONFIRMED_MAX_GAIN and a very quiet room is still un-transcribable. Blending
// in a plain running mean (1/n) for the first few updates makes the estimate
// accurate from the start and decays into the plain EMA as n grows. Standard
// EMA bias correction; without it the first ~10s of a service pay for the
// smoothing that only matters later.
function warmedSmoothing(dt, tau, updateCount) {
  return Math.max(smoothing(dt, tau), 1 / updateCount);
}

// Stateful because gain has to persist across chunks — each call sees ~100ms of
// audio and the ramp spans seconds. One instance per capture session, so a
// restart begins from unity rather than inheriting the last service's room.
function createAutoGain() {
  let gain = 1;
  let floor = null;
  let speechSeconds = 0;
  let elapsedSeconds = 0;
  let slowLevel = null; // running mean of log level, for the fluctuation measure
  let fluctuation = 0;
  let sawSpeech = false;
  let updates = 0;

  function update(chunk) {
    const sampleCount = Math.floor(chunk.length / 2);
    if (sampleCount === 0) return gain;
    const dt = sampleCount / SAMPLE_RATE;
    elapsedSeconds += dt;
    updates++;

    const rms = rmsLevel(chunk);
    if (floor === null) floor = Math.max(rms, ABS_SILENCE_RMS);

    // Tracked on the raw input, before gain — this has to describe the room, and
    // measuring post-gain audio would partly measure the AGC's own ramp instead.
    const logLevel = Math.log(Math.max(rms, ABS_SILENCE_RMS));
    if (slowLevel === null) slowLevel = logLevel;
    slowLevel += (logLevel - slowLevel) * warmedSmoothing(dt, FLUCTUATION_ENVELOPE_TAU_S, updates);
    fluctuation += (Math.abs(logLevel - slowLevel) - fluctuation) * warmedSmoothing(dt, FLUCTUATION_TAU_S, updates);
    if (fluctuation >= SPEECH_FLUCTUATION) sawSpeech = true;

    const audible = rms > ABS_SILENCE_RMS;
    const isSpeech = audible && (elapsedSeconds <= FLOOR_WARMUP_S || rms > floor * FLOOR_MARGIN);

    // Always track downward; only track upward while nothing is being said, so
    // sustained speech can't walk the floor up into its own gate.
    if (rms < floor) {
      floor += (rms - floor) * smoothing(dt, FLOOR_FALL_TIME_S);
    } else if (!isSpeech) {
      floor += (rms - floor) * smoothing(dt, FLOOR_RISE_TIME_S);
    }
    floor = Math.max(floor, ABS_SILENCE_RMS);

    if (isSpeech) {
      speechSeconds += dt;
      const ceiling = sawSpeech ? MAX_GAIN : UNCONFIRMED_MAX_GAIN;
      const desired = clamp(TARGET_RMS / rms, MIN_GAIN, ceiling);
      const rise = speechSeconds <= WARMUP_SPEECH_S ? WARMUP_RISE_TIME_S : RISE_TIME_S;
      const tau = desired > gain ? rise : FALL_TIME_S;
      // Smoothed in the log domain: gain is a multiplier, so a fixed *ratio*
      // per step is what reads as even. Smoothing it linearly makes the same
      // nominal step feel abrupt at 1x and imperceptible at 20x.
      const alpha = smoothing(dt, tau);
      gain = Math.exp(Math.log(gain) + (Math.log(desired) - Math.log(gain)) * alpha);
    }

    const peak = peakLevel(chunk);
    if (peak > 0 && peak * gain > PEAK_CEILING) {
      gain = clamp(PEAK_CEILING / peak, MIN_GAIN, MAX_GAIN);
    }

    return gain;
  }

  return {
    update,
    getGain: () => gain,
    // Exposed for diagnostics — "is it hearing speech at all" is a different
    // question from "what gain is it using", and only this module knows the first.
    getState: () => ({ gain, floor, speechSeconds, fluctuation, sawSpeech }),
  };
}

module.exports = {
  createAutoGain,
  TARGET_RMS,
  MIN_GAIN,
  MAX_GAIN,
  ABS_SILENCE_RMS,
  FLOOR_MARGIN,
  UNCONFIRMED_MAX_GAIN,
  SPEECH_FLUCTUATION,
};
