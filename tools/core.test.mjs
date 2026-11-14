// Unit tests for the game core. Run: node --test tools/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../web/js/core.js');
const DT = 1 / 60;

function layout(g, n) {
  while (g.planets.length < n) g._genNext();
  return g.planets.slice(0, n).map((p) => [p.x.toFixed(3), p.y.toFixed(3), p.r.toFixed(3), p.captureR0.toFixed(3)].join(','));
}

/** Launch whenever a look-ahead says the shot will be captured. */
function botStep(g) {
  if (g.state !== 'play' || g.moon.state !== 'orbit') return;
  const c = g.clone();
  c.events = [];
  c.tap();
  for (let i = 0; i < 120; i++) {
    c.update(DT);
    if (c.events.some((e) => e.type === 'death' || e.type === 'recapture')) return;
    const cap = c.events.find((e) => e.type === 'capture');
    if (cap) {
      if (cap.perfect || g.moon.decay < 0.6) g.tap();
      return;
    }
    c.events.length = 0;
  }
}

test('same seed → identical level layout; different seed → different', () => {
  const a = layout(new Core.Game({ seed: 42, height: 860 }), 60);
  const b = layout(new Core.Game({ seed: 42, height: 860 }), 60);
  const c = layout(new Core.Game({ seed: 43, height: 860 }), 60);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('layout does not depend on screen height (fair daily challenge)', () => {
  const a = layout(new Core.Game({ seed: 7, height: 700 }), 40);
  const b = layout(new Core.Game({ seed: 7, height: 1000 }), 40);
  assert.deepEqual(a, b);
});

test('daily numbering and seeds', () => {
  assert.equal(Core.dailyNumber(new Date(2026, 10, 14, 9)), 1);
  assert.equal(Core.dailyNumber(new Date(2026, 10, 15, 23, 59)), 2);
  assert.equal(Core.dailyNumber(new Date(2027, 0, 1)), 49);
  assert.equal(Core.dailySeed(new Date(2026, 10, 14, 1)), Core.dailySeed(new Date(2026, 10, 14, 22)));
  assert.notEqual(Core.dailySeed(new Date(2026, 10, 14)), Core.dailySeed(new Date(2026, 10, 15)));
  assert.equal(Core.addDaysKey('2026-12-31', 1), '2027-01-01');
  assert.equal(Core.addDaysKey('2026-03-01', -1), '2026-02-28');
});

test('planets stay on screen horizontally', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const g = new Core.Game({ seed, height: 860 });
    layout(g, 150);
    for (const p of g.planets) {
      const reach = p.move ? p.move.amp : 0;
      assert.ok(p.baseX - reach - p.orbitR >= 0, `planet ${p.i} too far left`);
      assert.ok(p.baseX + reach + p.orbitR <= Core.W, `planet ${p.i} too far right`);
    }
  }
});

test('asteroids never cross an orbit (an orbiting moon is always safe)', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const g = new Core.Game({ seed, height: 860 });
    layout(g, 150);
    for (const a of g.asteroids) {
      for (const p of g.planets) {
        assert.ok(Math.abs(a.y - p.y) >= p.orbitR + a.r + Core.MOON_R, `asteroid too close to planet ${p.i}`);
      }
    }
  }
});

test('tap launches tangentially and capture continues the same spin', () => {
  const g = new Core.Game({ seed: 99, height: 860 });
  assert.equal(g.tap(), false, 'cannot launch before start');
  g.start();
  let captured = null;
  for (let f = 0; f < 60 * 30 && !captured && g.state !== 'dead'; f++) {
    botStep(g);
    g.update(DT);
    captured = g.events.find((e) => e.type === 'capture');
    if (captured) {
      const m = g.moon;
      assert.equal(m.state, 'orbit');
      assert.ok(Math.abs(Math.hypot(m.x - g.cur.x, m.y - g.cur.y) - m.radius) < 1e-6);
      assert.equal(g.hops, 1);
      assert.ok(g.score >= 1);
      assert.equal(g.timerOn, true);
    }
    g.events.length = 0;
  }
  assert.ok(captured, 'bot should capture the first planet');
});

test('orbit decays and crashes if you never launch', () => {
  const g = new Core.Game({ seed: 5, height: 860 });
  g.start();
  for (let f = 0; f < 60 * 20 && g.hops < 1; f++) { botStep(g); g.update(DT); }
  assert.equal(g.hops, 1);
  for (let f = 0; f < 60 * 10 && g.state !== 'dead'; f++) g.update(DT);
  assert.equal(g.state, 'dead');
  assert.equal(g.deathReason, 'crashed');
  assert.equal(g.hopLog[g.hopLog.length - 1], 'X');
});

test('flying off screen is a loss', () => {
  const g = new Core.Game({ seed: 3, height: 860 });
  g.start();
  g.moon.angle = 0; // on the right of the planet, dir=+1 → launches straight down
  g.tap();
  for (let f = 0; f < 120 && g.state !== 'dead'; f++) g.update(DT);
  assert.equal(g.state, 'dead');
  assert.equal(g.deathReason, 'lost');
});

test('every level is beatable: look-ahead bot reaches 80 planets on all seeds', () => {
  for (let seed = 100; seed < 106; seed++) {
    const g = new Core.Game({ seed: seed * 2654435761, height: 860 });
    g.start();
    for (let f = 0; f < 60 * 600 && g.hops < 80 && g.state !== 'dead'; f++) {
      botStep(g);
      g.update(DT);
      g.events.length = 0;
    }
    assert.equal(g.state, 'play', `seed ${seed} died at ${g.hops} (${g.deathReason})`);
    assert.ok(g.hops >= 80);
  }
});

test('clone is fully independent', () => {
  const g = new Core.Game({ seed: 11, height: 860 });
  g.start();
  const c = g.clone();
  c.tap();
  for (let i = 0; i < 30; i++) c.update(DT);
  assert.equal(g.moon.state, 'orbit');
  assert.equal(g.t, 0);
  assert.ok(c.cur === c.planets.find((p) => p.id === c.cur.id), 'clone keeps internal references');
});

test('share text: Wordle-style grid, truncation, url', () => {
  const log = 'PPGPX'.split('');
  const txt = Core.shareText({ score: 12, hops: 4, perfects: 3, hopLog: log, daily: true, dailyNo: 3, streakDays: 2, url: 'https://x.y' });
  assert.match(txt, /Daily #3 — 12 pts 🔥2/);
  assert.match(txt, /🟩🟩🟨🟩💥/);
  assert.ok(txt.endsWith('https://x.y'));
  const long = Core.emojiGrid(Array(45).fill('P'), 30, 10);
  assert.ok(long.startsWith('…+15\n'));
  assert.equal(long.split('\n').length, 4);
  const endless = Core.shareText({ score: 5, hops: 5, perfects: 0, hopLog: ['G', 'X'] });
  assert.match(endless, /I scored 5 in Moonsling!/);
});
