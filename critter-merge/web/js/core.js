/*
 * Critter Merge — core rules and physics. Pure logic: no DOM, no canvas.
 *
 * Drop sea critters into a tank. Two of the same kind touching merge into the
 * next kind up. Two whales make a Whale Party. If the tank stays over-full the
 * game ends (the first time, a Bubble Rescue clears the top instead).
 *
 * A game can also carry a level: a goal (make a critter, pop every trapped
 * bubble, reach a score, or score as much as possible), a drop limit, an
 * optional fixed drop order and critters trapped in bubbles. Trapped critters
 * stay put until a matching critter touches them, which pops them free.
 *
 * Physics: circles with Verlet integration and iterative position solving at
 * a fixed 120 Hz step. Water drag keeps everything calm and stable.
 *
 * World units: the tank's inside is TW × TH; (0,0) is its top-left corner at
 * the rim, y grows downwards. Critters are dropped from above the rim.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CritterCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TW = 360;               // tank inside width
  const TH = 520;               // tank inside height
  const DROP_Y = -52;           // where the held critter waits, above the rim
  const STEP = 1 / 120;
  const ITER = 6;
  const GRAVITY = 1500;
  const DRAG = 0.994;           // per step; it's water
  const WALL_FRICTION = 0.12;
  const MAX_STEP_MOVE = 14;     // units per step, stops explosions after merges
  const GROW_TIME = 0.14;       // a merged critter grows to full size over this
  const DROP_COOLDOWN = 0.45;
  const OVER_TIME = 2.4;        // seconds over the rim before the tank counts as full
  const WARN_Y = 70;            // critters this close to the rim show the warning
  const GRACE = 1.1;            // fresh critters are ignored by the overflow check
  const DEEP = 3;               // overlap depth beyond which pushes don't add speed
  const MERGE_GAP = 1.0;        // same critters this close count as touching
  const SETTLE_TIME = 2.2;      // after the last drop, wait this long before judging a level

  /** The critter ladder. `r` is the physics radius. */
  const CRITTERS = [
    { id: 'shrimp',    name: 'Shrimp',     r: 15, points: 0,  fact: 'Shrimp can flick their tails to zoom backwards and escape danger!' },
    { id: 'clownfish', name: 'Clownfish',  r: 20, points: 1,  fact: 'Clownfish live inside sea anemones, which keep them safe from bigger fish.' },
    { id: 'crab',      name: 'Crab',       r: 26, points: 3,  fact: 'Most crabs walk sideways!' },
    { id: 'starfish',  name: 'Starfish',   r: 33, points: 6,  fact: 'A starfish can grow back an arm if it loses one.' },
    { id: 'puffer',    name: 'Pufferfish', r: 41, points: 10, fact: 'Pufferfish blow up like a ball by gulping lots of water.' },
    { id: 'jelly',     name: 'Jellyfish',  r: 50, points: 15, fact: 'Jellyfish have no brain, no heart and no bones!' },
    { id: 'turtle',    name: 'Sea Turtle', r: 60, points: 21, fact: 'Sea turtles can hold their breath for hours while they rest.' },
    { id: 'octopus',   name: 'Octopus',    r: 71, points: 28, fact: 'An octopus has three hearts and blue blood!' },
    { id: 'narwhal',   name: 'Narwhal',    r: 83, points: 36, fact: 'A narwhal\'s long tusk is really a giant tooth.' },
    { id: 'whale',     name: 'Blue Whale', r: 97, points: 45, fact: 'Blue whales are the biggest animals that have ever lived!' },
  ];
  const LAST = CRITTERS.length - 1;
  const WHALE_PARTY_POINTS = 100;
  const DROP_WEIGHTS = [32, 28, 20, 12, 8]; // only the five smallest are dropped

  class Game {
    /**
     * @param {{seed?: number, level?: {goal?: object, drops?: number, queue?: number[], tiers?: number,
     *          bubbles?: number[][], start?: number[][], par?: number[], rescues?: number}}} opts
     */
    constructor(opts) {
      opts = opts || {};
      const lv = opts.level || null;
      this.seed = (opts.seed >>> 0) || 1;
      this.rs = this.seed;
      this.t = 0;
      this.acc = 0;
      this.bodies = [];
      this.uid = 0;
      this.events = [];
      this.state = 'play';       // play | over
      this.score = 0;
      this.drops = 0;
      this.merges = 0;
      this.biggest = 0;
      this.combo = 0;
      this.lastMergeT = -10;
      this.cooldown = 0;
      this.aimX = TW / 2;
      this.shakes = 3;
      this.rescues = lv && lv.rescues !== undefined ? lv.rescues : 1;
      this.overT = 0;
      this.danger = false;
      this.parties = 0;
      // level / goal state
      this.goal = lv && lv.goal ? lv.goal : null;
      this.dropLimit = lv && lv.drops ? lv.drops : 0;
      this.queue = lv && lv.queue ? lv.queue.slice() : null;
      this.qi = 0;
      this.maxTier = lv && lv.tiers !== undefined ? lv.tiers : DROP_WEIGHTS.length - 1;
      this.par = lv && lv.par ? lv.par.slice() : null;
      this.made = CRITTERS.map(() => 0);
      this.popped = 0;
      this.bubbleCount = 0;
      this.stars = 0;
      this.endReason = null;
      this.lastDropT = -10;
      for (const [tier, x, y] of (lv && lv.start) || []) this._spawn(tier, x, y, 0, false); // free critters already in the tank
      for (const [tier, x, y] of (lv && lv.bubbles) || []) {
        this._spawn(tier, x, y, 0, false).fixed = true;
        this.bubbleCount++;
      }
      this.cur = this.take();
      this.next = this.take();
    }

    /** Next critter for the player: the level's fixed order first, then random. */
    take() {
      if (this.queue && this.qi < this.queue.length) return this.queue[this.qi++];
      return this.roll();
    }

    /** Drops still allowed (Infinity when the level has no limit). */
    dropsLeft() { return this.dropLimit ? Math.max(0, this.dropLimit - this.drops) : Infinity; }

    /** Progress toward the goal as {have, need}. */
    progress() {
      const g = this.goal;
      if (!g) return null;
      if (g.type === 'make') return { have: Math.min(this.made[g.tier], g.count), need: g.count };
      if (g.type === 'free') return { have: this.popped, need: this.bubbleCount };
      if (g.type === 'score') return { have: Math.min(this.score, g.points), need: g.points };
      return { have: this.score, need: g.stars ? g.stars[2] : 0 }; // dive
    }

    // --- RNG (mulberry32, state kept as a number so games can be cloned) ---
    rand() {
      let t = (this.rs = (this.rs + 0x6D2B79F5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Next critter to drop. The first few drops stay small so it's easy to start. */
    roll() {
      const maxTier = Math.min(this.maxTier, this.drops < 4 ? 2 : DROP_WEIGHTS.length - 1);
      let total = 0;
      for (let i = 0; i <= maxTier; i++) total += DROP_WEIGHTS[i];
      let x = this.rand() * total;
      for (let i = 0; i <= maxTier; i++) {
        x -= DROP_WEIGHTS[i];
        if (x < 0) return i;
      }
      return 0;
    }

    clone() {
      const c = structuredClone(this);
      Object.setPrototypeOf(c, Game.prototype);
      return c;
    }

    // --- Player actions ----------------------------------------------------
    clampAim(x, tier) {
      const r = CRITTERS[tier === undefined ? this.cur : tier].r;
      return Math.max(r, Math.min(TW - r, x));
    }
    setAim(x) { this.aimX = this.clampAim(x); }
    canDrop() { return this.state === 'play' && this.cooldown <= 0 && this.dropsLeft() > 0; }

    drop() {
      if (!this.canDrop()) return false;
      const x = this.clampAim(this.aimX);
      this._spawn(this.cur, x, DROP_Y, 0, false);
      this._emit({ type: 'drop', tier: this.cur, x, y: DROP_Y });
      this.drops++;
      this.lastDropT = this.t;
      this.cur = this.next;
      this.next = this.take();
      this.cooldown = DROP_COOLDOWN;
      return true;
    }

    /** Jiggle the tank to free stuck critters. */
    shake() {
      if (this.state !== 'play' || this.shakes <= 0 || !this.bodies.length) return false;
      this.shakes--;
      for (const b of this.bodies) {
        if (b.fixed) continue;
        const k = 1.3 * (30 / (b.R + 15)); // small critters jump more than big ones
        b.px = b.x - (this.rand() * 2 - 1) * k;
        b.py = b.y + (1 + this.rand() * 1.5) * k; // upward kick
      }
      this._emit({ type: 'shake' });
      return true;
    }

    // --- Simulation --------------------------------------------------------
    update(dt) {
      if (!(dt > 0)) return;
      this.acc = Math.min(this.acc + dt, 0.1);
      while (this.acc >= STEP) {
        this.acc -= STEP;
        this.t += STEP;
        this._step(STEP);
      }
      if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.state === 'play') this._checkGoal();
      if (this.state === 'play') this._checkOverflow(dt);
    }

    _checkGoal() {
      const g = this.goal;
      if (!g) return;
      const p = this.progress();
      if (g.type !== 'dive' && p.have >= p.need) { this._win(); return; }
      // Out of drops: wait until the tank has calmed down, then judge.
      if (this.dropLimit && this.drops >= this.dropLimit) {
        const quiet = this.t - Math.max(this.lastDropT, this.lastMergeT);
        if (quiet > SETTLE_TIME) {
          if (g.type === 'dive') this._win();
          else this._end('drops');
        }
      }
    }

    _win() {
      const g = this.goal;
      if (g.type === 'dive') {
        const s = g.stars || [0, 0, 0];
        this.stars = this.score >= s[2] ? 3 : this.score >= s[1] ? 2 : 1;
      } else {
        const limit = this.dropLimit || 99;
        const par = this.par || [Math.ceil(limit * 0.55), Math.ceil(limit * 0.8)];
        this.stars = this.drops <= par[0] ? 3 : this.drops <= par[1] ? 2 : 1;
      }
      this.state = 'won';
      this._emit({ type: 'won', stars: this.stars });
    }

    _end(reason) {
      this.state = 'over';
      this.endReason = reason;
      this._emit({ type: 'over', reason });
    }

    _spawn(tier, x, y, startR, merged) {
      const c = CRITTERS[tier];
      const b = {
        id: this.uid++, tier, x, y, px: x, py: y,
        R: c.r, r: startR || c.r, r0: startR || c.r,
        born: this.t, merged, wob: this.rand() * 6.28,
      };
      this.bodies.push(b);
      return b;
    }

    _step(h) {
      const bodies = this.bodies;
      const g = GRAVITY * h * h;
      for (const b of bodies) {
        if (b.fixed) continue;
        let vx = (b.x - b.px) * DRAG;
        let vy = (b.y - b.py) * DRAG;
        const sp = Math.hypot(vx, vy);
        if (sp > MAX_STEP_MOVE) { vx *= MAX_STEP_MOVE / sp; vy *= MAX_STEP_MOVE / sp; }
        b.px = b.x;
        b.py = b.y;
        b.x += vx;
        b.y += vy + g;
        if (b.r < b.R) b.r = Math.min(b.R, b.r + ((b.R - b.r0) * h) / GROW_TIME);
      }

      const merges = [];
      const n = bodies.length;
      for (let it = 0; it < ITER; it++) {
        for (let i = 0; i < n; i++) {
          const a = bodies[i];
          for (let j = i + 1; j < n; j++) {
            const b = bodies[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const rr = a.r + b.r;
            const reach = rr + MERGE_GAP;
            if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue;
            const d2 = dx * dx + dy * dy;
            // Same critters merge as soon as they touch (resting side by side counts).
            if (a.fixed && b.fixed) continue;
            if (it === 0 && a.tier === b.tier && !a.dead && !b.dead && d2 < reach * reach) {
              a.dead = b.dead = true; // reserve this pair; resolved after the solve
              merges.push([a, b]);
              continue;
            }
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 0.001;
            if (a.dead && b.dead && a.tier === b.tier) continue;
            const depth = rr - d;
            const ma = a.R * a.R, mb = b.R * b.R;
            // Trapped critters don't move: the free one takes the whole push.
            const ka = a.fixed ? 0 : b.fixed ? 1 : mb / (ma + mb);
            const kb = b.fixed ? 0 : a.fixed ? 1 : ma / (ma + mb);
            let nx = dx / d, ny = dy / d;
            // Nothing balances perfectly on top of a trapped bubble: nudge it so it rolls off.
            if ((a.fixed || b.fixed) && Math.abs(nx) < 0.03) {
              nx += (a.fixed ? b : a).wob > 3.14 ? 0.03 : -0.03;
              const k = Math.hypot(nx, ny); nx /= k; ny /= k;
            }
            const ax = nx * depth * ka, ay = ny * depth * ka;
            const bx = nx * depth * kb, by = ny * depth * kb;
            a.x -= ax; a.y -= ay;
            b.x += bx; b.y += by;
            // Deep overlaps (a freshly merged critter appearing on top of a small
            // one) are pushed apart without turning the push into a launch.
            if (depth > DEEP) {
              const k = 1 - DEEP / depth;
              a.px -= ax * k; a.py -= ay * k;
              b.px += bx * k; b.py += by * k;
            }
          }
        }
        for (const b of bodies) if (!b.fixed) this._walls(b);
      }
      if (merges.length) this._merge(merges);
    }

    /** Keep a critter inside the tank. Deep pushes don't bounce it back out. */
    _walls(b) {
      if (b.x < b.r) {
        const pen = b.r - b.x;
        b.x = b.r;
        if (pen > DEEP) b.px += pen - DEEP;
        b.py += (b.y - b.py) * WALL_FRICTION;
      } else if (b.x > TW - b.r) {
        const pen = b.x - (TW - b.r);
        b.x = TW - b.r;
        if (pen > DEEP) b.px -= pen - DEEP;
        b.py += (b.y - b.py) * WALL_FRICTION;
      }
      if (b.y > TH - b.r) {
        const pen = b.y - (TH - b.r);
        b.y = TH - b.r;
        if (pen > DEEP) b.py -= pen - DEEP;
        b.px += (b.x - b.px) * WALL_FRICTION;
      }
    }

    _merge(pairs) {
      for (const [a, b] of pairs) {
        const tier = a.tier;
        const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
        const vx = ((a.x - a.px) + (b.x - b.px)) / 2, vy = ((a.y - a.py) + (b.y - b.py)) / 2;
        this.combo = this.t - this.lastMergeT < 1.0 ? this.combo + 1 : 1;
        this.lastMergeT = this.t;
        this.merges++;
        const freed = (a.fixed ? 1 : 0) + (b.fixed ? 1 : 0);
        if (freed) {
          this.popped += freed;
          this._emit({ type: 'pop', tier, x, y });
        }
        const mult = 1 + (Math.min(this.combo, 5) - 1) * 0.5;
        if (tier === LAST) {
          const pts = Math.round(WHALE_PARTY_POINTS * mult);
          this.score += pts;
          this.parties++;
          this._emit({ type: 'party', x, y, points: pts, combo: this.combo });
          continue;
        }
        const nt = tier + 1;
        const nb = this._spawn(nt, x, y, CRITTERS[tier].r, true);
        nb.px = x - vx * 0.5;
        nb.py = y - vy * 0.5;
        this._walls(nb);
        const pts = Math.round(CRITTERS[nt].points * mult);
        this.score += pts;
        this.made[nt]++;
        if (nt > this.biggest) this.biggest = nt;
        this._emit({ type: 'merge', tier: nt, x, y, points: pts, combo: this.combo });
      }
      this.bodies = this.bodies.filter((b) => !b.dead);
    }

    _checkOverflow(dt) {
      let over = false, warn = false;
      for (const b of this.bodies) {
        if (b.fixed || this.t - b.born < GRACE) continue;
        const top = b.y - b.r;
        if (top < 0) over = true;
        if (top < WARN_Y) warn = true;
      }
      this.danger = warn;
      this.overT = over ? this.overT + dt : Math.max(0, this.overT - dt * 2);
      if (this.overT < OVER_TIME) return;
      this.overT = 0;
      if (this.rescues > 0) this._rescue();
      else this._end('full');
    }

    /** Bubbles carry away every critter in the top part of the tank. */
    _rescue() {
      this.rescues--;
      const cut = TH * 0.4;
      const saved = this.bodies.filter((b) => !b.fixed && b.y - b.r < cut);
      this.bodies = this.bodies.filter((b) => b.fixed || b.y - b.r >= cut);
      this._emit({ type: 'rescue', critters: saved.map((b) => ({ tier: b.tier, x: b.x, y: b.y })) });
    }

    _emit(e) { this.events.push(e); }

    /** Where a critter dropped at x would first touch something (for the aim guide). */
    landingY(x, tier) {
      const r = CRITTERS[tier].r;
      let best = TH - r;
      for (const b of this.bodies) {
        const dx = Math.abs(b.x - x);
        const rr = b.r + r;
        if (dx >= rr) continue;
        const y = b.y - Math.sqrt(rr * rr - dx * dx);
        if (y < best) best = y;
      }
      return best;
    }

    result() {
      return {
        score: this.score, biggest: this.biggest, drops: this.drops, merges: this.merges, parties: this.parties,
        stars: this.stars, popped: this.popped, won: this.state === 'won', reason: this.endReason,
      };
    }
  }

  return { TW, TH, DROP_Y, WARN_Y, OVER_TIME, CRITTERS, LAST, DROP_COOLDOWN, Game };
}));
