// Headless balance simulator for Moonsling.
//
// Plays the real game logic (web/js/core.js) with bots:
//   - "oracle": looks ahead with cloned game states and always picks the best
//     launch moment → proves every generated level is beatable.
//   - "human(σ)": aims like the oracle but adds Gaussian reaction noise of σ ms
//     → estimates how far real players get.
//
// Usage: node tools/sim.mjs [runs=40] [maxHops=150]
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../web/js/core.js');

const DT = 1 / 60;
const H = 860; // ~ 20:9 phone

function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simulate launching from `g` right now. Returns capture info or null. */
function probeLaunch(g) {
  const c = g.clone();
  c.events = [];
  if (!c.tap()) return null;
  for (let i = 0; i < 120; i++) {
    c.update(DT);
    for (const e of c.events) {
      if (e.type === 'death') return null;
      if (e.type === 'capture') return { off: e.off, perfect: e.perfect, advanced: e.advanced };
      if (e.type === 'recapture') return null;
    }
    c.events.length = 0;
  }
  return null;
}

/**
 * Plan the best launch frame from the current orbit.
 * Returns {frame, perfect} for the lowest-offset frame inside the first
 * window of successful launch frames, or null if nothing works.
 */
function plan(g, horizonSec) {
  const probe = g.clone();
  probe.events = [];
  const frames = Math.floor(horizonSec / DT);
  let best = null;
  let inWindow = false;
  for (let k = 0; k < frames; k++) {
    if (probe.moon.state !== 'orbit' || probe.state === 'dead') break;
    const r = probeLaunch(probe);
    if (r) {
      inWindow = true;
      if (!best || r.off < best.off) best = { frame: k, off: r.off, perfect: r.perfect };
    } else if (inWindow) {
      break; // first window finished
    }
    probe.update(DT);
    probe.events.length = 0;
  }
  return best;
}

function playRun(seed, sigmaMs, maxHops, rng) {
  const g = new Core.Game({ seed, height: H });
  g.start();
  let safety = 0;
  while (g.state !== 'dead' && g.hops < maxHops && safety++ < 200000) {
    if (g.moon.state === 'orbit') {
      const horizon = g.timerOn ? Math.max(0.05, g.moon.decay - 0.02) : 6;
      const p = plan(g, horizon);
      let frame = p ? p.frame : 0;
      if (sigmaMs > 0) frame = Math.max(0, frame + Math.round((gauss(rng) * sigmaMs) / 1000 / DT));
      for (let k = 0; k < frame && g.moon.state === 'orbit'; k++) { g.update(DT); g.events.length = 0; }
      if (g.moon.state === 'orbit') g.tap();
    }
    g.update(DT);
    g.events.length = 0;
  }
  return g.result();
}

function stats(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], p25: q(0.25), median: q(0.5), p75: q(0.75), max: s[s.length - 1] };
}

const runs = Number(process.argv[2] || 40);
const maxHops = Number(process.argv[3] || 150);
const rng = mulberry(12345);

for (const [label, sigma] of [['oracle', 0], ['human σ=35ms', 35], ['human σ=60ms', 60], ['human σ=90ms', 90]]) {
  const hops = [], scores = [], reasons = {};
  let starsTotal = 0, hopsTotal = 0;
  let perfectRate = 0;
  const t0 = Date.now();
  for (let r = 0; r < runs; r++) {
    const res = playRun(1000 + r * 7919, sigma, maxHops, rng);
    hops.push(res.hops);
    scores.push(res.score);
    perfectRate += res.hops ? res.perfects / res.hops : 0;
    starsTotal += res.stars;
    hopsTotal += res.hops;
    const why = res.reason || 'cap';
    reasons[why] = (reasons[why] || 0) + 1;
  }
  console.log(`${label.padEnd(14)} hops ${JSON.stringify(stats(hops))}  score median ${stats(scores).median}  perfect ${(100 * perfectRate / runs).toFixed(0)}%  stars/hop ${(starsTotal / Math.max(1, hopsTotal)).toFixed(2)}  ends ${JSON.stringify(reasons)}  (${Date.now() - t0}ms)`);
}
