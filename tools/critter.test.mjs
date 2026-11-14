// Unit tests for Critter Merge's rules and physics. Run: node --test tools/critter.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../critter-merge/web/js/core.js');
const DT = 1 / 60;
const run = (g, sec) => { for (let i = 0; i < sec * 60; i++) g.update(DT); };

test('critter ladder grows and ends with the whale', () => {
  assert.equal(C.CRITTERS.length, 10);
  assert.equal(C.CRITTERS[C.LAST].id, 'whale');
  for (let i = 1; i < C.CRITTERS.length; i++) {
    assert.ok(C.CRITTERS[i].r > C.CRITTERS[i - 1].r, 'each critter is bigger than the one before');
    assert.ok(C.CRITTERS[i].fact.length > 10);
  }
  assert.ok(C.CRITTERS[C.LAST].r * 2 < C.TW * 0.6, 'a whale fits comfortably in the tank');
});

test('first drops are small, and only the five smallest are ever dropped', () => {
  const g = new C.Game({ seed: 3 });
  const seen = [];
  for (let i = 0; i < 300; i++) {
    seen.push(g.cur);
    g.cooldown = 0;
    g.drop();
    g.bodies.length = 0;
  }
  assert.ok(seen.slice(0, 4).every((t) => t <= 2));
  assert.ok(seen.every((t) => t >= 0 && t <= 4));
  assert.ok(seen.includes(4));
});

test('same seed gives the same critters to drop', () => {
  const seq = (seed) => { const g = new C.Game({ seed }); const s = []; for (let i = 0; i < 30; i++) { s.push(g.cur); g.cooldown = 0; g.drop(); } return s.join(''); };
  assert.equal(seq(9), seq(9));
  assert.notEqual(seq(9), seq(10));
});

test('drop cooldown stops double drops', () => {
  const g = new C.Game({ seed: 1 });
  assert.equal(g.drop(), true);
  assert.equal(g.drop(), false);
  run(g, 0.6);
  assert.equal(g.drop(), true);
});

test('aim is kept inside the tank', () => {
  const g = new C.Game({ seed: 1 });
  g.setAim(-500);
  assert.equal(g.aimX, C.CRITTERS[g.cur].r);
  g.setAim(9999);
  assert.equal(g.aimX, C.TW - C.CRITTERS[g.cur].r);
});

test('two critters resting side by side merge (touching is enough)', () => {
  const g = new C.Game({ seed: 1 });
  g._spawn(2, 100, C.TH - 26);
  g._spawn(2, 152.5, C.TH - 26); // exactly touching, nothing pushing them together
  run(g, 0.3);
  assert.deepEqual(g.bodies.map((b) => b.tier), [3]);
});

test('two shrimps merge into a clownfish and score points', () => {
  const g = new C.Game({ seed: 1 });
  g._spawn(0, 150, C.TH - 15);
  g._spawn(0, 178, C.TH - 15);
  run(g, 0.5);
  const tiers = g.bodies.map((b) => b.tier);
  assert.deepEqual(tiers, [1]);
  assert.equal(g.score, C.CRITTERS[1].points);
  assert.ok(g.events.some((e) => e.type === 'merge' && e.tier === 1));
});

test('chain reaction: the new critter merges again', () => {
  const g = new C.Game({ seed: 1 });
  g._spawn(1, 20, C.TH - 20);    // a clownfish resting against the left wall
  g._spawn(0, 55, C.TH - 15);    // a shrimp touching it, and another shrimp dropping on top
  g._spawn(0, 55, C.TH - 80);
  run(g, 2);
  assert.deepEqual(g.bodies.map((b) => b.tier), [2]);
  assert.equal(g.biggest, 2);
  assert.ok(g.events.filter((e) => e.type === 'merge').length >= 2);
});

test('two whales make a whale party and disappear', () => {
  const g = new C.Game({ seed: 1 });
  g._spawn(9, 100, C.TH - 97);
  g._spawn(9, 260, C.TH - 97);
  run(g, 1);
  assert.equal(g.bodies.length, 0);
  assert.ok(g.events.some((e) => e.type === 'party'));
  assert.ok(g.score >= 100);
});

test('different critters stack without merging or overlapping', () => {
  const g = new C.Game({ seed: 1 });
  g._spawn(4, 180, C.TH - 41);
  g._spawn(2, 180, 200);
  run(g, 3);
  assert.equal(g.bodies.length, 2);
  const [a, b] = g.bodies;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(d > a.r + b.r - 1.5, 'no deep overlap at rest');
  for (const x of g.bodies) assert.ok(Math.hypot(x.x - x.px, x.y - x.py) < 0.5, 'settled');
});

test('overflow: first a Bubble Rescue, then game over', () => {
  const g = new C.Game({ seed: 1 });
  const mix = [3, 5, 4, 6, 2, 7, 4, 3, 6, 5];
  let k = 0;
  // Keep piling mixed critters above the rim until the tank counts as full.
  const pileUntil = (done) => {
    for (let sec = 0; sec < 60 && !done(); sec++) {
      for (let col = 0; col < 3; col++) g._spawn(mix[k++ % mix.length], 70 + col * 110, -60);
      run(g, 1);
    }
  };
  pileUntil(() => g.rescues === 0);
  assert.equal(g.rescues, 0);
  assert.ok(g.events.some((e) => e.type === 'rescue'));
  assert.equal(g.state, 'play', 'the rescue keeps the game going');
  g.events.length = 0;
  pileUntil(() => g.state === 'over');
  assert.equal(g.state, 'over');
  assert.ok(g.events.some((e) => e.type === 'over'));
  assert.equal(g.drop(), false, 'no drops after game over');
});

test('shake: three per game, needs critters in the tank', () => {
  const g = new C.Game({ seed: 1 });
  assert.equal(g.shake(), false);
  g._spawn(2, 180, C.TH - 26);
  assert.equal(g.shake(), true);
  assert.equal(g.shake(), true);
  assert.equal(g.shake(), true);
  assert.equal(g.shake(), false);
  run(g, 2);
  for (const b of g.bodies) assert.ok(b.y <= C.TH - b.r + 0.01 && b.y > 0, 'shaken critters stay in the tank');
});

test('physics stays sane through a long random game', () => {
  const g = new C.Game({ seed: 42 });
  for (let f = 0; f < 60 * 240 && g.state === 'play'; f++) {
    if (g.canDrop() && f % 30 === 0) { g.setAim(g.rand() * C.TW); g.drop(); }
    g.update(DT);
    g.events.length = 0;
    for (const b of g.bodies) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
      assert.ok(b.x >= b.r - 1.5 && b.x <= C.TW - b.r + 1.5 && b.y <= C.TH - b.r + 1.5, 'inside the tank');
    }
  }
  assert.ok(g.merges > 20);
});

test('landingY finds the top of the stack', () => {
  const g = new C.Game({ seed: 1 });
  assert.equal(g.landingY(180, 0), C.TH - 15);
  g._spawn(5, 180, C.TH - 50);
  assert.ok(Math.abs(g.landingY(180, 0) - (C.TH - 100 - 15)) < 0.01);
});

// --- Adventure levels & Daily Challenge --------------------------------------
const L = require('../critter-merge/web/js/levels.js');
const { playHeuristic, solvePuzzle } = await import('./critter-bots.mjs');

test('trapped critters stay put until a match pops them', () => {
  const g = new C.Game({ seed: 1, level: { goal: { type: 'free' }, bubbles: [[2, 180, 300]], queue: [1, 2], drops: 5 } });
  const bubble = g.bodies[0];
  assert.equal(bubble.fixed, true);
  g.setAim(180);
  g.drop(); // a clownfish lands on the crab bubble: no match, it rolls off
  run(g, 2);
  assert.equal(bubble.x, 180);
  assert.equal(bubble.y, 300);
  assert.equal(g.popped, 0);
  g.setAim(180);
  g.drop(); // a crab: pop!
  run(g, 2);
  assert.equal(g.popped, 1);
  assert.equal(g.state, 'won');
  assert.ok(g.events.some((e) => e.type === 'pop'));
  assert.ok(g.bodies.every((b) => !b.fixed));
});

test('levels follow their drop order, then end when drops run out', () => {
  const g = new C.Game({ seed: 1, level: { goal: { type: 'make', tier: 9, count: 1 }, queue: [3, 1, 4], drops: 3 } });
  const seen = [];
  for (let i = 0; i < 3; i++) { seen.push(g.cur); g.setAim(40 + i * 140); g.cooldown = 0; g.drop(); }
  assert.deepEqual(seen, [3, 1, 4]);
  assert.equal(g.dropsLeft(), 0);
  assert.equal(g.drop(), false);
  run(g, 5);
  assert.equal(g.state, 'over');
  assert.equal(g.result().reason, 'drops');
});

test('a dive ends after the last drop and always awards at least one star', () => {
  const g = new C.Game({ seed: 4, level: { goal: { type: 'dive', stars: [0, 99999, 99999] }, drops: 2 } });
  g.drop();
  run(g, 0.6);
  g.drop();
  run(g, 5);
  assert.equal(g.state, 'won');
  assert.equal(g.stars, 1);
});

test('stars depend on how many drops it took', () => {
  const lv = { goal: { type: 'free' }, bubbles: [[0, 180, C.TH - 15]], queue: [1, 1, 0], drops: 3, par: [1, 2] };
  const g = new C.Game({ seed: 1, level: lv });
  for (const x of [40, 320, 180]) { g.setAim(x); g.cooldown = 0; g.drop(); run(g, 1.5); }
  assert.equal(g.state, 'won');
  assert.equal(g.stars, 1, 'three drops for a par-1 puzzle is one star');
});

test('there are 32 levels in 4 worlds, with sensible goals', () => {
  assert.equal(L.LEVELS.length, 32);
  assert.equal(L.WORLDS.length, 4);
  L.LEVELS.forEach((lv, i) => {
    assert.equal(lv.id, i + 1);
    assert.equal(lv.world, Math.floor(i / 8));
    assert.ok(lv.drops > 0, 'every level has a drop limit');
    assert.ok(L.goalText(lv).length > 5);
    if (lv.goal.type === 'free') {
      assert.ok(lv.bubbles.length >= 1);
      assert.ok(lv.queue.length <= lv.drops);
      for (const [t, x, y] of lv.bubbles) {
        const r = C.CRITTERS[t].r;
        assert.ok(x >= r && x <= C.TW - r && y <= C.TH - r && y - r > 0, `bubble inside the tank (level ${lv.id})`);
      }
    }
  });
  assert.equal(L.goalText(L.LEVELS[20]), 'Make an Octopus');
  assert.equal(L.goalText(L.LEVELS[12]), 'Make 3 Starfish');
});

test('every bubble puzzle can be solved within its drop limit', () => {
  for (const lv of L.LEVELS.filter((l) => l.goal.type === 'free')) {
    const r = solvePuzzle(lv, 7);
    assert.ok(r.won, `level ${lv.id} should be solvable`);
    assert.ok(r.drops <= lv.drops);
  }
});

test('every make/score level is reachable by a bot well within its limit', () => {
  for (const lv of L.LEVELS.filter((l) => l.goal.type === 'make' || l.goal.type === 'score')) {
    if (lv.drops > 300) continue; // the long late-game levels are covered by tools/critter-levels.mjs
    let wins = 0;
    for (let i = 0; i < 3; i++) {
      const r = playHeuristic(lv, lv.id * 100 + i);
      if (r.won) wins++;
    }
    assert.ok(wins >= 2, `level ${lv.id}: bot won ${wins}/3`);
  }
});

test('daily challenge: same for everyone each day, rotates, puzzles are solvable', () => {
  const a = L.dailyLevel(new Date(2026, 10, 20, 8));
  const b = L.dailyLevel(new Date(2026, 10, 20, 21));
  assert.deepEqual(a, b);
  assert.equal(L.dailyNumber(new Date(2026, 10, 14)), 1);
  const kinds = new Set();
  for (let i = 0; i < 12; i++) {
    const lv = L.dailyLevel(new Date(2026, 10, 14 + i));
    kinds.add(lv.goal.type);
    if (lv.goal.type === 'free') assert.ok(solvePuzzle(lv, lv.seed).won, `daily ${lv.key} solvable`);
  }
  assert.deepEqual([...kinds].sort(), ['dive', 'free', 'make']);
});
