// Sound, synthesised with WebAudio only — no audio files, no network. The
// engine is a low oscillator whose pitch follows speed, the siren is a
// two-tone wail, gunshots are filtered noise bursts, and the radio is a tiny
// bassline-plus-lead sequencer. Nothing is created until start() runs on a
// user gesture, so browsers never block it.

const SIREN_LOW = 660;
const SIREN_HIGH = 880;

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenHigh = false;
  let sirenTimer = 0;
  let musicOn = true;
  let musicTimer = null;
  let step = 0;
  let muted = false;

  // A short bassline and lead in A minor, looped bar by bar.
  const BASS = [55, 0, 55, 0, 65.41, 0, 55, 0, 49, 0, 49, 0, 61.74, 0, 73.42, 0];
  const LEAD = [220, 0, 261.63, 329.63, 0, 293.66, 261.63, 0, 220, 0, 196, 220, 0, 246.94, 0, 0];
  const STEP_SECONDS = 0.16;

  function ensure() {
    if (ctx) return true;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 50;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 400;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'square';
      sirenOsc.frequency.value = SIREN_LOW;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
    } catch {
      ctx = null;
      return false;
    }
    return true;
  }

  function tone(freq, dur, type, vol, when = 0) {
    if (!ctx || !master) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function playStep() {
    if (!ctx || !musicOn || muted) return;
    const i = step % 16;
    const bass = BASS[i];
    const lead = LEAD[i];
    if (bass) tone(bass, STEP_SECONDS * 1.8, 'triangle', 0.22);
    if (lead) tone(lead, STEP_SECONDS * 0.9, 'square', 0.07);
    step += 1;
  }

  function startMusic() {
    if (musicTimer !== null || !ctx) return;
    musicTimer = window.setInterval(playStep, STEP_SECONDS * 1000);
  }

  function stopMusic() {
    if (musicTimer !== null) {
      window.clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  return {
    /** Create the audio graph. Call from a user gesture; safe to call twice. */
    start() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      if (musicOn) startMusic();
    },
    /** Engine hum: 0 when parked or on foot, up to 1 at top speed. */
    setEngine(speed01) {
      if (!ctx || !engineOsc || !engineGain) return;
      const s = Math.max(0, Math.min(1, speed01));
      engineOsc.frequency.setTargetAtTime(48 + s * 130, ctx.currentTime, 0.08);
      engineGain.gain.setTargetAtTime(s > 0.02 ? 0.05 + s * 0.05 : 0, ctx.currentTime, 0.1);
    },
    /** Two-tone police siren on or off. */
    siren(on) {
      if (!ctx || !sirenOsc || !sirenGain) return;
      if (on && sirenTimer === 0) {
        sirenGain.gain.setTargetAtTime(0.045, ctx.currentTime, 0.1);
        sirenTimer = window.setInterval(() => {
          sirenHigh = !sirenHigh;
          sirenOsc.frequency.value = sirenHigh ? SIREN_HIGH : SIREN_LOW;
        }, 450);
      } else if (!on && sirenTimer !== 0) {
        window.clearInterval(sirenTimer);
        sirenTimer = 0;
        sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      }
    },
    /** A gunshot: a short burst of filtered noise. */
    shot() {
      if (!ctx || !master) return;
      const dur = 0.12;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
      const gain = ctx.createGain();
      gain.gain.value = 0.3;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start();
    },
    /** A pickup blip: two rising notes. */
    blip() {
      tone(660, 0.09, 'sine', 0.18);
      tone(990, 0.12, 'sine', 0.18, 0.08);
    },
    /** Mission complete: a short four-note jingle. */
    jingle() {
      tone(523.25, 0.14, 'triangle', 0.22);
      tone(659.25, 0.14, 'triangle', 0.22, 0.13);
      tone(783.99, 0.14, 'triangle', 0.22, 0.26);
      tone(1046.5, 0.3, 'triangle', 0.24, 0.39);
    },
    /** Flip the radio on/off. Returns the new state. */
    toggleMusic() {
      musicOn = !musicOn;
      if (musicOn) startMusic();
      else stopMusic();
      return musicOn;
    },
    /** Silence (or restore) everything without stopping the sequencer. */
    setMuted(b) {
      muted = !!b;
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
    },
    /** Whether the radio is currently on. */
    get musicOn() {
      return musicOn;
    },
  };
}
