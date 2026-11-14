// Bots that play Critter Merge levels, shared by the level calibrator and tests.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const C = require('../critter-merge/web/js/core.js');
export const L = require('../critter-merge/web/js/levels.js');

const DT = 1 / 60;

/** Heuristic aimer: drop onto a matching critter if one is reachable, else into the lowest spot. */
export function smartAim(g, rnd) {
  const tier = g.cur, r = C.CRITTERS[tier].r;
  let best = null;
  for (let x = r; x <= C.TW - r; x += 8) {
    const y = g.landingY(x, tier);
    let match = false;
    for (const b of g.bodies) if (b.tier === tier && Math.hypot(b.x - x, b.y - y) <= b.r + r + 3) { match = true; break; }
    const s = (match ? 10000 : 0) + y + (rnd ? rnd() * 6 : 0);
    if (!best || s > best.s) best = { x, s };
  }
  return best.x;
}

/** Play a level with the heuristic aimer. Returns the game's result. */
export function playHeuristic(level, seed, maxSec = 3600) {
  const g = new C.Game({ seed, level });
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let f = 0; f < maxSec * 60 && g.state === 'play'; f++) {
    if (g.canDrop()) { g.setAim(smartAim(g, rnd)); g.drop(); }
    g.update(DT);
    g.events.length = 0;
  }
  return g.result();
}

/** Run the simulation until every critter has stopped moving (or time runs out). */
function simulateUntilQuiet(g, maxSec) {
  for (let f = 0; f < maxSec * 60 && g.state === 'play'; f++) {
    g.update(DT);
    if (g.t - g.lastDropT < 0.4 || g.t - g.lastMergeT < 0.3 || g.cooldown > 0) continue;
    let moving = false;
    for (const b of g.bodies) if (!b.fixed && Math.hypot(b.x - b.px, b.y - b.py) > 0.08) { moving = true; break; }
    if (!moving) break;
  }
}

function evaluate(c) {
  let top = C.TH;
  for (const b of c.bodies) if (!b.fixed) top = Math.min(top, b.y - b.r);
  return (c.state === 'won' ? 1e6 : 0) + c.popped * 1000 + top * 0.5 - (c.state === 'over' ? 1e6 : 0);
}

/** Greedy look-ahead solver for bubble puzzles: tries many drop positions by simulation. */
export function solvePuzzle(level, seed = 1) {
  const g = new C.Game({ seed, level });
  while (g.state === 'play') {
    while (g.state === 'play' && !g.canDrop() && g.dropsLeft() > 0) { g.update(DT); g.events.length = 0; }
    if (g.state !== 'play') break;
    if (g.dropsLeft() <= 0) { simulateUntilQuiet(g, 5); g.update(3); break; }
    // Try every drop position; if none pops a bubble right away, look one drop
    // further ahead (e.g. two clownfish that merge into a crab next to a trapped crab).
    const r = C.CRITTERS[g.cur].r;
    const tries = [];
    for (let x = r; x <= C.TW - r + 0.1; x += 12) {
      const c = g.clone();
      c.events = [];
      c.setAim(x);
      c.drop();
      simulateUntilQuiet(c, 4);
      tries.push({ x, c, s: evaluate(c) });
    }
    let best = tries.reduce((a, b) => (b.s > a.s ? b : a));
    if (best.c.popped === g.popped && best.c.state === 'play' && best.c.dropsLeft() > 0) {
      for (const t of tries) {
        if (t.c.state !== 'play') continue;
        const r2 = C.CRITTERS[t.c.cur].r;
        let s2 = -Infinity;
        for (let x2 = r2; x2 <= C.TW - r2 + 0.1; x2 += 18) {
          const c2 = t.c.clone();
          c2.events = [];
          while (!c2.canDrop() && c2.state === 'play') c2.update(DT);
          c2.setAim(x2);
          c2.drop();
          simulateUntilQuiet(c2, 4);
          s2 = Math.max(s2, evaluate(c2));
        }
        t.s2 = s2;
      }
      best = tries.reduce((a, b) => ((b.s2 ?? b.s) > (a.s2 ?? a.s) ? b : a));
    }
    g.setAim(best.x);
    g.drop();
    simulateUntilQuiet(g, 4);
    g.events.length = 0;
  }
  return g.result();
}
