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
