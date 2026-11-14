/*
 * Critter Merge — Adventure levels and the Daily Challenge. Pure data + small
 * generators; no DOM. Every level is checked by tools/critter.test.mjs (bubble
 * puzzles are solved by a bot, other goals are reached by a bot within the
 * drop limit).
 *
 * Goals:  make  — merge until you've made `count` of critter `tier`
 *         free  — pop every trapped bubble (touch it with a matching critter)
 *         score — reach `points`
 *         dive  — score as much as you can with the drops you have (daily)
 */
(function (root, factory) {
  const api = factory(root.CritterCore || (typeof require === 'function' ? require('./core.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CritterLevels = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  const { TW, TH, CRITTERS } = Core;

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
  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  /**
   * A bubble puzzle: `count` trapped critters spread across the tank, and a
   * drop order that contains a matching critter for each (plus a few extras).
   */
  function bubblePuzzle(seed, o) {
    const rnd = mulberry(seed);
    const lanes = 5, laneW = TW / lanes;
    const bubbles = [];
    for (let tries = 0; bubbles.length < o.count && tries < 2000; tries++) {
      const tier = Math.floor(rnd() * (o.maxTier + 1));
      const r = CRITTERS[tier].r;
      const lane = Math.floor(rnd() * lanes);
      const x = Math.max(r + 2, Math.min(TW - r - 2, laneW * (lane + 0.5) + (rnd() * 2 - 1) * laneW * 0.2));
      const y = TH - r - rnd() * TH * (o.height || 0.45);
      const ok = bubbles.every((b) => {
        const rb = CRITTERS[b.tier].r;
        const apart = Math.hypot(b.x - x, b.y - y) > r + rb + 16;
        const ownColumn = Math.abs(b.x - x) > r + rb + 6;
        return apart && (o.stack || ownColumn);
      });
      if (ok) bubbles.push({ tier, x, y });
    }
    const matches = bubbles.map((b) => b.tier);
    const extras = [];
    for (let i = 0; i < (o.extras || 0); i++) extras.push(Math.floor(rnd() * (o.maxTier + 1)));
    const rest = matches.slice(1).concat(extras);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    const queue = [matches[0]].concat(rest);
    // Perfect play pops a bubble with each matching drop.
    let need = 0;
    const left = matches.slice();
    queue.forEach((t, i) => { const k = left.indexOf(t); if (k >= 0) { left.splice(k, 1); need = i + 1; } });
    return {
      goal: { type: 'free' },
      bubbles: bubbles.map((b) => [b.tier, Math.round(b.x), Math.round(b.y)]),
      queue,
      drops: queue.length + (o.slack || 2),
      par: [need, need + 2],
      tiers: o.maxTier,
    };
  }

  const WORLDS = [
    { name: 'Sandy Shallows', emoji: '🏖️', sky: ['#5fe0f7', '#22a6e0', '#1172c0'] },
    { name: 'Coral Reef',     emoji: '🪸', sky: ['#7fd6f2', '#3f8fd8', '#6a4fb8'] },
    { name: 'Kelp Forest',    emoji: '🌿', sky: ['#5fe0c8', '#1f9a9a', '#0f5c6e'] },
    { name: 'Deep Blue',      emoji: '🌊', sky: ['#3a8fd8', '#1a4f9a', '#120f4a'] },
  ];

  // Drop limits and star targets (par = [3 stars, 2 stars]) come from bot runs
  // (tools/critter-levels.mjs), with lots of extra room because kids aren't bots.
  const make = (tier, count, drops, par, extra) => Object.assign({ goal: { type: 'make', tier, count }, drops, par }, extra);
  const score = (points, drops, par, extra) => Object.assign({ goal: { type: 'score', points }, drops, par }, extra);
  const puzzle = (seed, o) => bubblePuzzle(seed, o);
  const F = TH; // floor helper for hand-made puzzles: a critter resting on the floor sits at F - r

  // 32 levels, 8 per world. Hand-made puzzles teach the ideas; later ones are generated.
  const LEVELS = [
    // --- Sandy Shallows ---------------------------------------------------
    make(2, 1, 14, [7, 11], { tiers: 1 }),                                                         // make a crab (only shrimp + clownfish fall)
    { goal: { type: 'free' }, bubbles: [[1, 180, F - 20]], queue: [1, 0, 0], drops: 3, par: [1, 2] },
    make(3, 1, 30, [14, 22], { tiers: 2 }),                                                         // make a starfish
    { goal: { type: 'free' }, bubbles: [[0, 80, F - 15], [2, 270, F - 26]], queue: [0, 2, 1, 0], drops: 5, par: [2, 4] },
    score(100, 38, [21, 30]),
    make(2, 2, 26, [13, 19], { tiers: 1 }),                                                         // make 2 crabs
    { goal: { type: 'free' }, bubbles: [[1, 70, 330], [0, 290, 380], [2, 180, F - 26]], queue: [2, 1, 0, 1, 0], drops: 7, par: [3, 5] },
    make(4, 1, 44, [17, 32], { tiers: 3 }),                                                         // make a pufferfish
    // --- Coral Reef ---------------------------------------------------------
    puzzle(101, { count: 4, maxTier: 2, extras: 2, slack: 3 }),
    make(5, 1, 70, [27, 48]),                                                          // make a jellyfish
    score(250, 58, [35, 47]),
    // Make a crab right next to the trapped crab.
    { goal: { type: 'free' }, bubbles: [[2, 26, F - 26], [3, 327, F - 33]], queue: [1, 1, 3, 0, 0, 1], drops: 8, par: [3, 5] },
    make(3, 3, 50, [21, 34], { tiers: 2 }),                                                         // make 3 starfish
    // A bubble tower: pop the top one and the new critter falls onto the next.
    { goal: { type: 'free' }, bubbles: [[0, 180, 250], [1, 180, 360], [2, 180, F - 26], [0, 60, F - 15]], queue: [0, 0, 2, 1, 1], drops: 7, par: [2, 4] },
    score(450, 84, [52, 68]),
    make(6, 1, 130, [46, 82]),                                                           // make a sea turtle
    // --- Kelp Forest -------------------------------------------------------
    puzzle(207, { count: 5, maxTier: 3, extras: 3, slack: 3 }),
    make(5, 2, 110, [36, 61]),
    score(700, 102, [63, 83]),
    { goal: { type: 'free' }, bubbles: [[0, 90, 240], [1, 90, 350], [2, 90, F - 26], [1, 270, 300], [3, 270, F - 33]], queue: [0, 1, 1, 0, 2, 3, 0], drops: 9, par: [4, 6] },
    make(7, 1, 230, [94, 172]),                                                          // make an octopus
    puzzle(311, { count: 6, maxTier: 3, extras: 3, slack: 3 }),
    score(1100, 148, [94, 120]),
    make(6, 2, 180, [66, 110]),
    // --- Deep Blue ----------------------------------------------------------
    puzzle(419, { count: 6, maxTier: 4, extras: 4, slack: 4, stack: true }),
    make(8, 1, 380, [175, 260], { rescues: 2 }),                                                          // make a narwhal
    score(1700, 210, [128, 170]),
    puzzle(523, { count: 7, maxTier: 4, extras: 4, slack: 4, height: 0.55 }),
    make(7, 2, 330, [147, 228], { rescues: 2 }),
    puzzle(631, { count: 8, maxTier: 4, extras: 4, slack: 5, stack: true, height: 0.55 }),
    score(2600, 280, [185, 228]),
    // Finale: a lonely narwhal waits in the tank. Make it a friend to make a Blue Whale!
    make(9, 1, 450, [200, 320], { rescues: 3, start: [[8, 180, TH - 83]], intro: 'This narwhal needs a friend!' }),                                                          // make a blue whale!
  ].map((lv, i) => Object.assign({ id: i + 1, world: Math.floor(i / 8) }, lv));

  // --- Daily Challenge ------------------------------------------------------
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const DAILY_EPOCH_UTC = Date.UTC(2026, 10, 14);
  function dateKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function addDaysKey(key, days) { const [y, m, dd] = key.split('-').map(Number); const t = new Date(y, m - 1, dd + days); return dateKey(t); }
  function dailyNumber(d) { d = d || new Date(); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - DAILY_EPOCH_UTC) / 86400000) + 1; }

  /** Today's challenge: rotates between a bubble puzzle, a "make" goal and a score dive. */
  function dailyLevel(d) {
    const key = dateKey(d);
    const seed = hashString('crittermerge:daily:' + key) || 1;
    const n = dailyNumber(d);
    const kind = ((n % 3) + 3) % 3;
    let lv;
    if (kind === 0) {
      const rnd = mulberry(seed);
      lv = bubblePuzzle(seed, { count: 4 + Math.floor(rnd() * 2), maxTier: 3, extras: 3, slack: 3 });
    } else if (kind === 1) {
      lv = make(5, 1, 70, [27, 48]);
    } else {
      lv = { goal: { type: 'dive', stars: [0, 180, 300] }, drops: 30 };
    }
    return Object.assign({ id: 'daily-' + key, daily: true, number: n, key, seed, world: n % WORLDS.length }, lv);
  }

  /** Short goal text for a level card / HUD, e.g. "Make 2 Crabs". */
  function goalText(lv) {
    const g = lv.goal;
    const plural = (n) => (/(fish|Shrimp)$/.test(n) ? n : /us$/.test(n) ? n + 'es' : n + 's');
    const name = (t, c) => (c > 1 ? plural(CRITTERS[t].name) : CRITTERS[t].name);
    if (g.type === 'make') return g.count > 1 ? `Make ${g.count} ${name(g.tier, g.count)}` : `Make ${/^[AEIOU]/.test(CRITTERS[g.tier].name) ? 'an' : 'a'} ${CRITTERS[g.tier].name}`;
    if (g.type === 'free') return lv.bubbles.length > 1 ? `Pop all ${lv.bubbles.length} bubbles` : 'Pop the bubble';
    if (g.type === 'score') return `Score ${g.points} points`;
    return `Score as much as you can`;
  }

  /** A longer how-to line for the level intro card. */
  function goalHelp(lv) {
    const g = lv.goal;
    if (lv.intro) return lv.intro + ' Match two of the same to make bigger critters.';
    if (g.type === 'make') return 'Match two of the same to make bigger critters.';
    if (g.type === 'free') return 'Drop a matching critter onto each trapped critter to pop its bubble.';
    if (g.type === 'score') return 'Merges score points. Quick merges in a row score extra!';
    return 'Everyone gets the same critters today. How high can you score?';
  }

  return { WORLDS, LEVELS, bubblePuzzle, dailyLevel, dailyNumber, dateKey, addDaysKey, goalText, goalHelp, hashString };
}));
