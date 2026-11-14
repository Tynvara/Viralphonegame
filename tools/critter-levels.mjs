// Calibrates and checks every Critter Merge level with bots.
// Usage: node tools/critter-levels.mjs [runs=24] [days=30]
import { C, L, playHeuristic, solvePuzzle } from './critter-bots.mjs';

const runs = Number(process.argv[2] || 24);
const days = Number(process.argv[3] || 30);
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];

for (const lv of L.LEVELS) {
  const label = `L${String(lv.id).padStart(2)} ${L.goalText(lv).padEnd(26)} limit ${String(lv.drops).padStart(3)}`;
  if (lv.goal.type === 'free') {
    const r = solvePuzzle(lv, 7);
    console.log(`${label}  puzzle ${r.won ? 'SOLVED' : 'FAILED'} in ${r.drops} drops (par ${lv.par}) stars ${r.stars}`);
    continue;
  }
  const n = lv.drops > 300 ? Math.max(6, runs / 4) : runs;
  const unlimited = Object.assign({}, lv, { drops: 0 });
  const used = [];
  let fails = 0;
  for (let i = 0; i < n; i++) {
    const r = playHeuristic(unlimited, lv.id * 1000 + i);
    if (r.won) used.push(r.drops); else fails++;
  }
  const within = used.filter((d) => d <= lv.drops).length;
  console.log(`${label}  bot needs p50 ${q(used, 0.5)} p90 ${q(used, 0.9)}  wins-within-limit ${within}/${n}  (tank-full fails ${fails})`);
}

console.log('\nDaily challenges:');
const start = new Date(2026, 10, 14);
const kinds = {};
for (let i = 0; i < days; i++) {
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
  const lv = L.dailyLevel(d);
  const k = lv.goal.type;
  kinds[k] = kinds[k] || [];
  if (k === 'free') kinds[k].push(solvePuzzle(lv, lv.seed).won ? 1 : 0);
  else kinds[k].push(playHeuristic(lv, lv.seed).score);
}
for (const [k, v] of Object.entries(kinds)) {
  if (k === 'free') console.log(`  free   solved ${v.reduce((a, b) => a + b, 0)}/${v.length}`);
  else console.log(`  ${k.padEnd(6)} bot score p25 ${q(v, 0.25)} p50 ${q(v, 0.5)} p90 ${q(v, 0.9)}`);
}
