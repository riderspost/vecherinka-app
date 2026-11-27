// Sound for the TV screen of Fanty: the ticking of the bottle, a chime when it
// stops, a buzzer when a timed dare runs out. Everything is synthesised (no
// sound files). A browser only lets a page make sound after a tap, so the TV
// page shows one "turn the sound on" button; after it is tapped the sounds
// play on their own.

let ctx = null;
let on = false;

export function isSoundOn() {
  return on;
}

// Must be called from a tap.
export function enableSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;
  if (!ctx) ctx = new Ctx();
  if (ctx.state === "suspended") ctx.resume();
  on = true;
  // a short blip so the person knows it works
  tone(660, 0.0, 0.12, 0.18);
  return true;
}

function tone(freq, startIn, length, gain, type = "sine") {
  if (!on || !ctx) return;
  const t0 = ctx.currentTime + startIn;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + length + 0.02);
}

// The same easing the bottle uses on screen: cubic-bezier(0.1, 0.85, 0.15, 1).
function bottleProgress(u) {
  const bez = (a, b, t) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bez(0.1, 0.15, mid) < u) lo = mid;
    else hi = mid;
  }
  return bez(0.85, 1, (lo + hi) / 2);
}

// Ticks while the bottle spins: one for every step of angle it passes, so
// they come fast at the start and slow down with the bottle.
export function playSpin(durationMs, totalDegrees) {
  if (!on || !ctx) return;
  const STEP_DEG = 24;
  const ticks = Math.floor(totalDegrees / STEP_DEG);
  for (let i = 1; i <= ticks; i++) {
    const wanted = (i * STEP_DEG) / totalDegrees;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (bottleProgress(mid) < wanted) lo = mid;
      else hi = mid;
    }
    const at = ((lo + hi) / 2) * (durationMs / 1000);
    const fade = 1 - 0.5 * (i / ticks);
    tone(1500 + (i % 2) * 220, at, 0.03, 0.16 * fade, "square");
  }
  // a low whoosh under the start
  tone(110, 0, 0.9, 0.12, "sawtooth");
}

// The bottle has stopped: two rising notes.
export function playChime() {
  tone(523.25, 0, 0.35, 0.22);
  tone(783.99, 0.14, 0.5, 0.22);
}

// A timed dare ran out.
export function playBuzzer() {
  tone(220, 0, 0.35, 0.25, "sawtooth");
  tone(180, 0.38, 0.5, 0.25, "sawtooth");
}
