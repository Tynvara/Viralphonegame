/*
 * Critter Merge — app controller: loop, input, screens, saves, sound, haptics.
 * Modes: Free Play (endless), Adventure levels, and the Daily Challenge.
 */
(function () {
  'use strict';

  const Core = window.CritterCore;
  const Levels = window.CritterLevels;
  const { CRITTERS, TW } = Core;
  const { LEVELS, WORLDS } = Levels;
  const { Renderer } = window.CritterRender;
  const { critterImage } = window.CritterArt;
  const Snd = window.CritterAudio;
  const native = window.CritterAndroid || null;

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const canvas = $('game');

  // ---------------------------------------------------------------------------
  // Save data (kept on this device only)
  // ---------------------------------------------------------------------------
  const SAVE_KEY = 'crittermerge.save.v1';
  const STARTER = CRITTERS.map((_, i) => i <= 4); // the droppable five are known from the start
  function loadSave() {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') || {}; } catch (e) { d = {}; }
    const s = Object.assign({
      best: 0, games: 0, bestCritter: 0, muted: false, music: true, haptics: true, seenHint: false,
      discovered: STARTER.slice(), levels: [], daily: { key: '', stars: 0, best: 0 }, shells: 0, streak: 0, lastDailyKey: '',
    }, d);
    if (!Array.isArray(s.discovered) || s.discovered.length !== CRITTERS.length) s.discovered = STARTER.slice();
    for (let i = 0; i <= 4; i++) s.discovered[i] = true;
    if (!Array.isArray(s.levels)) s.levels = [];
    while (s.levels.length < LEVELS.length) s.levels.push(0);
    return s;
  }
  const save = loadSave();
  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* unavailable */ } };

  const todayKey = () => Levels.dateKey(new Date());
  function todaysDaily() {
    const k = todayKey();
    if (save.daily.key !== k) save.daily = { key: k, stars: 0, best: 0 };
    return save.daily;
  }
  const liveStreak = () => {
    const k = todayKey();
    return save.lastDailyKey === k || save.lastDailyKey === Levels.addDaysKey(k, -1) ? save.streak : 0;
  };
  const totalStars = () => save.levels.reduce((a, b) => a + b, 0);
  const unlocked = (i) => i === 0 || save.levels[i - 1] > 0;
  const nextLevelIndex = () => {
    for (let i = 0; i < LEVELS.length; i++) if (save.levels[i] === 0) return unlocked(i) ? i : -1;
    return -1;
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const canVibrate = !!(native && native.vibrate) || typeof navigator.vibrate === 'function';
  function haptic(ms, amp) {
    if (!save.haptics) return;
    try {
      if (native && native.vibrate) native.vibrate(ms, amp || 120);
      else if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* ignore */ }
  }
  const IMG = CRITTERS.map((_, i) => critterImage(i, 160));
  const SIL = CRITTERS.map((_, i) => critterImage(i, 96, true));

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }
  function banner(html) {
    const b = $('banner');
    b.innerHTML = html;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const renderer = new Renderer(canvas);
  let game = null;
  let mode = 'free';          // free | level | daily
  let level = null;           // current level definition (Adventure or Daily)
  let ui = 'title';           // title | playing | paused | over | album | discover | levels | intro | result
  let albumReturn = 'title';
  let aiming = false;
  let discoverQueue = [];
  let discoverAt = 0;         // small delay so the merge pop is seen before the card
  let warnT = 0;
  let resultTimer = 0;

  function setUI(name) {
    ui = name;
    const goal = game && level && (ui === 'playing' || ui === 'paused' || ui === 'discover' || ui === 'result');
    document.body.className = 'ui-' + name + (goal ? ' goal-mode' : '') + (goal && level.goal.type === 'dive' ? ' dive-mode' : '');
  }

  function resize() {
    const r = app.getBoundingClientRect();
    const scale = Math.max(1, Math.min(1.6, r.width / 420, r.height / 720));
    app.style.setProperty('--ui', scale.toFixed(3));
    const cs = getComputedStyle(document.documentElement);
    const sat = parseFloat(cs.getPropertyValue('--sat')) || 0;
    const sab = parseFloat(cs.getPropertyValue('--sab')) || 0;
    renderer.layout(r.width, r.height, window.devicePixelRatio || 1, sat + 84 * scale, sab + 56 * scale);
    measureTitleBand();
  }

  /** Open water on the title screen between the tagline and the buttons. */
  function measureTitleBand() {
    const a = $('titleBest').getBoundingClientRect();
    const b = document.querySelector('.title-buttons').getBoundingClientRect();
    const top = app.getBoundingClientRect().top;
    if (b.top > a.bottom) renderer.titleBand = { top: a.bottom - top + 24, bottom: b.top - top - 30 };
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const hud = { score: -1, next: -1, shakes: -1, hint: null, goal: '', drops: '' };
  function goalIcon(lv) {
    const g = lv.goal;
    if (g.type === 'make') return { img: IMG[g.tier] };
    if (g.type === 'free') return { icon: '🫧' };
    return { icon: '⭐' };
  }
  function updateHud(pop) {
    if (!game) return;
    if (game.score !== hud.score) {
      hud.score = game.score;
      const el = $('score');
      el.textContent = String(game.score);
      if (pop) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
      $('bestSmall').textContent = 'Best ' + Math.max(save.best, game.score);
    }
    if (game.next !== hud.next) {
      hud.next = game.next;
      $('nextImg').src = IMG[game.next];
    }
    if (game.shakes !== hud.shakes) {
      hud.shakes = game.shakes;
      $('shakeCount').textContent = String(game.shakes);
      $('shakeBtn').disabled = game.shakes <= 0;
    }
    if (level) {
      const p = game.progress();
      const txt = p.have + ' / ' + p.need;
      if (txt !== hud.goal) {
        hud.goal = txt;
        $('goalText').textContent = txt;
        $('goalBox').classList.toggle('done', p.have >= p.need);
        if (pop) { const b = $('goalBox'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
      }
      const left = game.dropsLeft();
      const dl = left === Infinity ? '' : left === 1 ? '1 drop left' : left + ' drops left';
      if (dl !== hud.drops) {
        hud.drops = dl;
        $('dropsLeft').textContent = dl;
        $('dropsLeft').classList.toggle('low', left <= 3 && level.goal.type !== 'dive');
      }
    }
    let hint = '';
    if (!save.seenHint && ui === 'playing' && mode === 'free') {
      if (game.drops === 0) hint = 'Slide your finger to aim.<br>Let go to drop!';
      else if (game.merges === 0 && game.drops < 8) hint = 'Two of the same<br>make a bigger critter!';
    } else if (ui === 'playing' && level && level.goal.type === 'free' && game.drops === 0 && level.id <= 4) {
      hint = 'Drop a matching critter<br>on the bubble to pop it!';
    }
    if (hint !== hud.hint) {
      hud.hint = hint;
      if (hint) $('hint').innerHTML = hint;
      $('hint').classList.toggle('show', !!hint);
    }
  }

  function renderChain() {
    const row = $('chainRow');
    row.innerHTML = '';
    CRITTERS.forEach((c, i) => {
      const known = save.discovered[i];
      const d = document.createElement('div');
      d.className = 'link' + (known ? '' : ' unknown') + (game && game.biggest >= i && i > 4 && known ? ' made' : '');
      const img = document.createElement('img');
      img.src = known ? IMG[i] : SIL[i];
      img.alt = known ? c.name : 'Not found yet';
      d.appendChild(img);
      row.appendChild(d);
    });
  }

  // ---------------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------------
  const ICON = {
    soundOn: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zm16.6 3 2.1-2.1-1.4-1.4-2.1 2.1-2.1-2.1-1.4 1.4 2.1 2.1-2.1 2.1 1.4 1.4 2.1-2.1 2.1 2.1 1.4-1.4z"/></svg>',
    music: '<svg viewBox="0 0 24 24"><path d="M9 18a3 3 0 1 1-2-2.8V5l12-2v11.5a3 3 0 1 1-2-2.8V6.3L9 7.6V18z"/></svg>',
    haptic: '<svg viewBox="0 0 24 24"><path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v14h8V5H8zM2 8h2v8H2V8zm18 0h2v8h-2V8z"/></svg>',
  };
  const starsText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

  function refreshTitle() {
    $('titleBest').textContent = save.best > 0 ? '⭐ Free Play best: ' + save.best : '';
    $('albumCount').textContent = save.discovered.filter(Boolean).length + '/' + CRITTERS.length;
    $('adventureStars').textContent = '★ ' + totalStars() + '/' + LEVELS.length * 3;
    const d = todaysDaily();
    const lv = Levels.dailyLevel(new Date());
    const streak = liveStreak();
    $('dailySub').textContent = d.stars
      ? 'Done! ' + starsText(d.stars) + (streak ? ' · 🔥 ' + streak : '')
      : Levels.goalText(lv) + (streak ? ' · 🔥 ' + streak : '');
    $('dailyBadge').style.display = d.stars ? 'none' : '';
    $('soundBtn').innerHTML = save.muted ? ICON.soundOff : ICON.soundOn;
    $('soundBtn').classList.toggle('off', save.muted);
    $('musicBtn').innerHTML = ICON.music;
    $('musicBtn').classList.toggle('off', !save.music);
    $('hapticBtn').innerHTML = ICON.haptic;
    $('hapticBtn').classList.toggle('off', !save.haptics);
    $('hapticBtn').style.display = canVibrate ? '' : 'none';
  }

  function goHome() {
    clearTimeout(resultTimer);
    game = null;
    level = null;
    mode = 'free';
    aiming = false;
    renderer.setTheme(null);
    refreshTitle();
    setUI('title');
  }

  // ---------------------------------------------------------------------------
  // Starting games
  // ---------------------------------------------------------------------------
  function startGame(newMode, lv) {
    Snd.unlock();
    clearTimeout(resultTimer);
    mode = newMode || 'free';
    level = lv || null;
    const seed = level && level.daily ? level.seed : ((Math.random() * 4294967296) >>> 0) || 1;
    game = new Core.Game({ seed, level });
    game.setAim(TW / 2);
    renderer.setTheme(level ? WORLDS[level.world].sky : null);
    renderer.particles.length = 0;
    renderer.texts.length = 0;
    renderer.floaters.length = 0;
    hud.score = hud.next = hud.shakes = -1;
    hud.hint = null;
    hud.goal = hud.drops = '';
    if (level) {
      const ic = goalIcon(level);
      $('goalImg').style.display = ic.img ? '' : 'none';
      if (ic.img) $('goalImg').src = ic.img;
      $('goalIcon').textContent = ic.icon || '';
      $('dropsLeft').textContent = '';
    } else {
      $('dropsLeft').textContent = '';
    }
    discoverQueue = [];
    renderChain();
    setUI('playing');
    updateHud(false);
  }

  function restart() {
    startGame(mode, level);
  }

  // ---------------------------------------------------------------------------
  // Adventure map + level cards
  // ---------------------------------------------------------------------------
  function openLevels() {
    const list = $('levelsList');
    list.innerHTML = '';
    const nextI = nextLevelIndex();
    WORLDS.forEach((w, wi) => {
      const box = document.createElement('div');
      box.className = 'world';
      box.style.background = `linear-gradient(160deg, ${w.sky[0]}, ${w.sky[1]} 60%, ${w.sky[2]})`;
      const h = document.createElement('h3');
      h.textContent = w.emoji + ' ' + w.name;
      const grid = document.createElement('div');
      grid.className = 'world-grid';
      LEVELS.forEach((lv, i) => {
        if (lv.world !== wi) return;
        const b = document.createElement('button');
        const open = unlocked(i);
        b.className = 'lvl' + (open ? '' : ' locked') + (i === nextI ? ' next' : '');
        const st = save.levels[i];
        b.innerHTML = '<b></b><span class="st"></span>';
        b.querySelector('b').textContent = open ? String(lv.id) : '🔒';
        b.querySelector('.st').innerHTML = '<i>' + '★'.repeat(st) + '</i>' + '★'.repeat(3 - st);
        b.setAttribute('aria-label', 'Level ' + lv.id + (open ? ', ' + st + ' stars' : ', locked'));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          Snd.click();
          if (!open) { toast('Finish level ' + (lv.id - 1) + ' first!'); return; }
          showIntro(lv);
        });
        grid.appendChild(b);
      });
      box.append(h, grid);
      list.appendChild(box);
    });
    $('levelsStars').textContent = '★ ' + totalStars() + ' / ' + LEVELS.length * 3;
    setUI('levels');
    const nextBtn = list.querySelector('.lvl.next');
    if (nextBtn) setTimeout(() => nextBtn.scrollIntoView({ block: 'center' }), 30);
  }

  function showIntro(lv) {
    level = lv;
    game = null;
    renderer.setTheme(WORLDS[lv.world].sky);
    $('introEyebrow').textContent = lv.daily ? '📅 Daily Challenge #' + lv.number : WORLDS[lv.world].emoji + ' Level ' + lv.id;
    $('introGoal').textContent = Levels.goalText(lv) + '!';
    $('introHelp').textContent = Levels.goalHelp(lv);
    const ic = goalIcon(lv);
    $('introImg').src = ic.img || (lv.goal.type === 'free' && lv.bubbles.length ? IMG[lv.bubbles[0][0]] : IMG[9]);
    $('introDrops').textContent = lv.drops ? 'You have ' + lv.drops + ' drops' : '';
    $('introDrops').style.display = lv.drops ? '' : 'none';
    $('introBack').textContent = lv.daily ? 'Home' : 'Back to map';
    setUI('intro');
  }

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------
  const PRAISE = ['', 'You did it!', 'Great job!', 'Amazing! Perfect!'];

  function showResult(won) {
    const r = game.result();
    const isDaily = !!(level && level.daily);
    const idx = isDaily ? -1 : LEVELS.indexOf(level);
    let shellText = '';
    if (won) {
      if (isDaily) {
        const d = todaysDaily();
        const firstToday = save.lastDailyKey !== todayKey();
        d.stars = Math.max(d.stars, r.stars);
        d.best = Math.max(d.best, r.score);
        if (firstToday) {
          save.streak = save.lastDailyKey === Levels.addDaysKey(todayKey(), -1) ? save.streak + 1 : 1;
          save.lastDailyKey = todayKey();
          save.shells++;
          shellText = '🐚 You found today\'s seashell! You have ' + save.shells + (save.shells === 1 ? ' shell.' : ' shells.') +
            (save.streak > 1 ? ' 🔥 ' + save.streak + ' days in a row!' : ' Come back tomorrow for another!');
        }
      } else if (idx >= 0) {
        save.levels[idx] = Math.max(save.levels[idx], r.stars);
      }
      persist();
    }
    $('resultEyebrow').textContent = isDaily ? '📅 Daily Challenge #' + level.number : WORLDS[level.world].emoji + ' Level ' + level.id;
    const dive = level.goal.type === 'dive';
    $('resultTitle').textContent = won
      ? (dive ? 'You scored ' + r.score + '!' : isDaily ? 'Challenge complete!' : 'Level complete!')
      : (r.reason === 'full' ? 'Tank full!' : 'Out of drops!');
    $('resultMsg').textContent = won ? PRAISE[r.stars] : 'So close! Want to try again?';
    $('resultShell').textContent = shellText;
    $('resultShell').classList.toggle('show', !!shellText);
    const stars = $('resultStars');
    stars.classList.toggle('hidden', !won);
    [...stars.children].forEach((s) => s.classList.remove('on', 'show'));
    const hasNext = won && !isDaily && idx >= 0 && idx + 1 < LEVELS.length;
    $('resultPrimary').textContent = won ? (hasNext ? 'Next level ▶' : isDaily ? 'Home' : 'Back to map') : 'Try again';
    $('resultPrimary').dataset.action = won ? (hasNext ? 'next' : isDaily ? 'home' : 'map') : 'again';
    $('resultAgain').style.display = won ? '' : 'none';
    $('resultBack').textContent = isDaily ? 'Home' : 'Map';
    $('resultBack').style.display = won && !hasNext ? 'none' : '';
    setUI('result');
    if (won) {
      Snd.win();
      haptic(80, 200);
      [...stars.children].forEach((s, i) => {
        setTimeout(() => {
          s.classList.add('show');
          if (i < r.stars) { s.classList.add('on'); Snd.star(i); haptic(20, 150); }
        }, 350 + i * 320);
      });
      if (r.stars === 3) renderer.burst(Core.TW / 2, 120, '#ffd23f', 50, 380, 5);
    } else {
      Snd.lose();
    }
  }

  function showOver() {
    const r = game.result();
    const prev = save.best;
    save.games++;
    if (r.score > save.best) save.best = r.score;
    if (r.biggest > save.bestCritter) save.bestCritter = r.biggest;
    persist();
    $('overScore').textContent = String(r.score);
    const newBest = r.score > prev && r.score > 0;
    $('overBadge').classList.toggle('show', newBest);
    $('overBest').textContent = 'Best: ' + save.best;
    $('overBiggestImg').src = IMG[r.biggest];
    $('overBiggestName').textContent = CRITTERS[r.biggest].name;
    setUI('over');
    if (newBest) Snd.best();
  }

  function openAlbum(from) {
    albumReturn = from;
    const grid = $('albumGrid');
    grid.innerHTML = '';
    CRITTERS.forEach((c, i) => {
      const known = save.discovered[i];
      const card = document.createElement('div');
      card.className = 'card' + (known ? '' : ' locked');
      const img = document.createElement('img');
      img.src = known ? IMG[i] : SIL[i];
      img.alt = '';
      const name = document.createElement('b');
      name.textContent = known ? c.name : '???';
      const fact = document.createElement('p');
      fact.textContent = known ? c.fact : 'Merge two ' + CRITTERS[i - 1].name + 's to find me!';
      card.append(img, name, fact);
      grid.appendChild(card);
    });
    $('albumProgress').textContent = save.discovered.filter(Boolean).length + ' / ' + CRITTERS.length + ' found';
    setUI('album');
  }

  function showNextDiscovery() {
    const tier = discoverQueue.shift();
    if (tier === undefined) return false;
    $('discImg').src = IMG[tier];
    $('discName').textContent = CRITTERS[tier].name;
    $('discFact').textContent = CRITTERS[tier].fact;
    setUI('discover');
    Snd.discover();
    haptic(40, 200);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Game events → effects
  // ---------------------------------------------------------------------------
  function handleEvents() {
    const evs = game.events;
    for (const e of evs) {
      switch (e.type) {
        case 'drop':
          Snd.drop();
          haptic(8, 60);
          break;
        case 'pop':
          renderer.burst(e.x, e.y, '#ffffff', 26, 260, 5);
          renderer.popText('Pop!', e.x, e.y - 40, '#bff4ff', 30);
          Snd.pop();
          haptic(30, 180);
          updateHud(true);
          break;
        case 'merge': {
          const col = renderer.colorOf(e.tier);
          renderer.burst(e.x, e.y, col, 10 + e.tier * 3, 120 + e.tier * 25, 3 + e.tier * 0.5);
          renderer.popText('+' + e.points, e.x, e.y - CRITTERS[e.tier].r - 6, '#ffffff', 22 + e.tier);
          if (e.combo >= 2) renderer.popText('Combo ×' + e.combo + '!', e.x, e.y - CRITTERS[e.tier].r - 34, '#ffd23f', 24);
          Snd.merge(e.tier, e.combo);
          haptic(12 + e.tier * 3, 80 + e.tier * 15);
          if (e.tier >= 7) renderer.shake = 4 + e.tier - 7;
          if (!save.discovered[e.tier]) {
            save.discovered[e.tier] = true;
            persist();
            discoverQueue.push(e.tier);
            if (discoverQueue.length === 1) discoverAt = performance.now() + 450;
          }
          if (!save.seenHint && game.merges >= 1) { save.seenHint = true; persist(); }
          renderChain();
          updateHud(true);
          break;
        }
        case 'party':
          renderer.burst(e.x, e.y, '#ffd23f', 60, 420, 6);
          renderer.burst(e.x, e.y, '#ff6f91', 40, 360, 5);
          renderer.popText('+' + e.points, e.x, e.y, '#ffffff', 34);
          renderer.flash = 0.35;
          renderer.shake = 10;
          banner('🐋 WHALE PARTY! 🐋<small>Two whales splashed away!</small>');
          Snd.party();
          haptic(120, 255);
          updateHud(true);
          break;
        case 'rescue':
          for (const c of e.critters) renderer.float(c.tier, c.x, c.y);
          banner('🫧 Bubble Rescue! 🫧<small>' + (game.rescues > 0 ? 'You have ' + game.rescues + ' more!' : 'Careful, that was the last one!') + '</small>');
          Snd.rescue();
          haptic(60, 160);
          break;
        case 'shake':
          renderer.shake = 9;
          Snd.shake();
          haptic(150, 200);
          break;
        case 'won':
          updateHud(true);
          renderer.flash = 0.25;
          resultTimer = setTimeout(() => { if (game && game.state === 'won' && (ui === 'playing' || ui === 'discover')) showResult(true); }, 1100);
          break;
        case 'over':
          if (mode === 'free') {
            Snd.over();
            haptic(200, 200);
            resultTimer = setTimeout(() => { if (game && game.state === 'over' && (ui === 'playing' || ui === 'discover')) showOver(); }, 1100);
          } else {
            haptic(120, 160);
            resultTimer = setTimeout(() => { if (game && game.state === 'over' && (ui === 'playing' || ui === 'discover')) showResult(false); }, 900);
          }
          break;
        default:
          break;
      }
    }
    evs.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function aimFrom(e) {
    const r = app.getBoundingClientRect();
    game.setAim(renderer.toWorldX(e.clientX - r.left));
  }
  canvas.addEventListener('pointerdown', (e) => {
    Snd.unlock();
    if (ui !== 'playing' || !game || game.state !== 'play') return;
    aiming = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    aimFrom(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (ui !== 'playing' || !game) return;
    if (aiming || e.pointerType === 'mouse') aimFrom(e);
  });
  const release = (e) => {
    if (!aiming) return;
    aiming = false;
    if (ui === 'playing' && game && game.state === 'play') {
      aimFrom(e);
      if (!game.drop() && game.dropsLeft() === 0) toast('No drops left!');
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => { aiming = false; });

  window.addEventListener('keydown', (e) => {
    if (ui !== 'playing' || !game || (e.repeat && e.code === 'Space')) return;
    if (e.code === 'ArrowLeft') game.setAim(game.aimX - 14);
    else if (e.code === 'ArrowRight') game.setAim(game.aimX + 14);
    else if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'Enter') { e.preventDefault(); game.drop(); }
    else if (e.code === 'Escape') setUI('paused');
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  for (const type of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(type, (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (!e.target.closest('.album-grid, .levels-list')) e.preventDefault(); }, { passive: false });
  for (const type of ['touchend', 'click']) document.addEventListener(type, () => Snd.unlock(), { passive: true });

  function bind(id, fn) {
    $(id).addEventListener('click', (e) => {
      e.stopPropagation();
      Snd.unlock();
      Snd.click();
      fn(e);
    });
  }
  bind('adventureBtn', openLevels);
  bind('dailyBtn', () => showIntro(Levels.dailyLevel(new Date())));
  bind('playBtn', () => startGame('free'));
  bind('albumBtn', () => openAlbum('title'));
  bind('albumClose', () => { if (albumReturn === 'over') setUI('over'); else { refreshTitle(); setUI('title'); } });
  bind('levelsClose', () => { refreshTitle(); setUI('title'); });
  bind('introStart', () => startGame(level.daily ? 'daily' : 'level', level));
  bind('introBack', () => { if (level && level.daily) goHome(); else openLevels(); });
  bind('pauseBtn', () => setUI('paused'));
  bind('resumeBtn', () => setUI('playing'));
  bind('restartBtn', restart);
  bind('pauseHomeBtn', () => { if (mode === 'level') { game = null; openLevels(); } else goHome(); });
  bind('againBtn', () => startGame('free'));
  bind('overHomeBtn', goHome);
  bind('resultPrimary', () => {
    const a = $('resultPrimary').dataset.action;
    if (a === 'again') restart();
    else if (a === 'next') showIntro(LEVELS[LEVELS.indexOf(level) + 1]);
    else if (a === 'map') openLevels();
    else goHome();
  });
  bind('resultAgain', restart);
  bind('resultBack', () => { if (level && level.daily) goHome(); else openLevels(); });
  bind('shakeBtn', () => {
    if (!game || !game.shake()) toast(game && game.shakes <= 0 ? 'No shakes left!' : 'Drop a critter first!');
    updateHud(false);
  });
  bind('discOk', () => { if (!showNextDiscovery()) setUI('playing'); });
  bind('soundBtn', () => { save.muted = !save.muted; Snd.setMuted(save.muted); persist(); refreshTitle(); });
  bind('musicBtn', () => { save.music = !save.music; Snd.setMusic(save.music); persist(); refreshTitle(); });
  bind('hapticBtn', () => { save.haptics = !save.haptics; persist(); refreshTitle(); haptic(40, 160); });

  // Android back button: returns 'exit' when the app should close.
  window.critterBack = function () {
    switch (ui) {
      case 'playing': setUI('paused'); return 'handled';
      case 'paused': setUI('playing'); return 'handled';
      case 'discover': if (!showNextDiscovery()) setUI('playing'); return 'handled';
      case 'album': if (albumReturn === 'over') setUI('over'); else { refreshTitle(); setUI('title'); } return 'handled';
      case 'levels': refreshTitle(); setUI('title'); return 'handled';
      case 'intro': if (level && level.daily) goHome(); else openLevels(); return 'handled';
      case 'result': if (level && level.daily) goHome(); else openLevels(); return 'handled';
      case 'over': goHome(); return 'handled';
      default: return 'exit';
    }
  };
  window.critterPause = function () {
    if (ui === 'playing') setUI('paused');
    Snd.suspend();
  };
  window.critterResume = function () { Snd.resume(); };
  window.setSafeInsets = function (t, b, l, r) {
    const st = document.documentElement.style;
    st.setProperty('--sat', t + 'px');
    st.setProperty('--sab', b + 'px');
    st.setProperty('--sal', l + 'px');
    st.setProperty('--sar', r + 'px');
    resize();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) window.critterPause(); else Snd.resume(); });

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    if (game && (ui === 'playing' || ui === 'result')) {
      game.update(dt);
      handleEvents();
      if (ui === 'playing') updateHud(false);
      if (game.danger && game.state === 'play' && ui === 'playing') {
        warnT -= dt;
        if (warnT <= 0) { Snd.warn(); warnT = 1.2; }
      } else {
        warnT = 0;
      }
      if (discoverQueue.length && game.state === 'play' && ui === 'playing' && now >= discoverAt) showNextDiscovery();
    }
    const titleLike = ui === 'title' || ((ui === 'album' || ui === 'levels' || ui === 'intro') && !game);
    renderer.draw(game, ui === 'paused' || ui === 'discover' ? 0 : dt, {
      title: titleLike,
      showHeld: ui === 'playing' || ui === 'paused' || ui === 'discover',
    });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  Snd.setMuted(save.muted);
  Snd.setMusic(save.music);
  resize();
  window.addEventListener('resize', resize);
  refreshTitle();
  setUI('title');
  measureTitleBand();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureTitleBand);
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !native) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  window.__critter = {
    get game() { return game; },
    get ui() { return ui; },
    get level() { return level; },
    save, renderer, startGame, goHome, openAlbum, openLevels, showIntro, Levels,
  };
})();
