// Physics + balance check for Critter Merge.
// Plays many games with two simple policies and checks the physics never
// misbehaves (NaN, escaping the tank, runaway speed).
// Usage: node tools/critter-sim.mjs [games=20]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../critter-merge/web/js/core.js');

const DT = 1 / 60;

function policyRandom(g) { return C.CRITTERS[g.cur].r + g.rand() * (C.TW - 2 * C.CRITTERS[g.cur].r); }
/** Aim at the highest critter of the same kind if one is reachable, else at the lowest spot. */
function policySmart(g) {
  let best = null;
  for (const b of g.bodies) if (b.tier === g.cur && (!best || b.y < best.y)) best = b;
  if (best) return best.x;
  let lowX = C.TW / 2, lowY = -Infinity;
  for (let x = 20; x <= C.TW - 20; x += 20) {
    const y = g.landingY(g.clampAim(x), g.cur);
    if (y > lowY) { lowY = y; lowX = x; }
  }
  return lowX;
}

function play(seed, policy, maxSec) {
  const g = new C.Game({ seed });
  let maxSpeed = 0, escapes = 0, nan = false, peak = 0, rescues = 0;
  for (let f = 0; f < maxSec * 60 && g.state === 'play'; f++) {
    if (g.canDrop() && f % 36 === 0) { g.setAim(policy(g)); g.drop(); }
    g.update(DT);
    for (const e of g.events) if (e.type === 'rescue') rescues++;
    g.events.length = 0;
    for (const b of g.bodies) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) nan = true;
      if (b.x < b.r - 1.5 || b.x > C.TW - b.r + 1.5 || b.y > C.TH - b.r + 1.5) escapes++;
      if (g.t - b.born > 0.5) maxSpeed = Math.max(maxSpeed, Math.hypot(b.x - b.px, b.y - b.py) * 120);
    }
    peak = Math.max(peak, g.bodies.length);
  }
  return { ...g.result(), t: g.t, over: g.state === 'over', maxSpeed, escapes, nan, peak, rescues };
}

const games = Number(process.argv[2] || 20);
for (const [name, pol] of [['random', policyRandom], ['smart', policySmart]]) {
  const rs = [];
  for (let i = 0; i < games; i++) rs.push(play(1 + i * 7777, pol, 900));
  const med = (k) => rs.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rs.length / 2)];
  const bigC = {};
  for (const r of rs) bigC[C.CRITTERS[r.biggest].name] = (bigC[C.CRITTERS[r.biggest].name] || 0) + 1;
  console.log(`${name.padEnd(7)} minutes ${(med('t') / 60).toFixed(1)}  score ${med('score')}  drops ${med('drops')}  peak bodies ${Math.max(...rs.map((r) => r.peak))}  ` +
    `maxSpeed ${Math.max(...rs.map((r) => r.maxSpeed)).toFixed(0)}  escapes ${rs.reduce((a, r) => a + r.escapes, 0)}  nan ${rs.some((r) => r.nan)}  ` +
    `ended ${rs.filter((r) => r.over).length}/${rs.length}  parties ${rs.reduce((a, r) => a + r.parties, 0)}\n        biggest: ${JSON.stringify(bigC)}`);
}
