/*
 * Moonsling — app controller: game loop, input, UI screens, saves, haptics,
 * daily challenge, and the Android bridge hooks.
 */
(function () {
  'use strict';

  const Core = window.MoonCore;
  const { Game, SKINS, DEATH_TEXT } = Core;
  const { Renderer, zoneInfo } = window.MoonRender;
  const Snd = window.MoonAudio;
  const Share = window.MoonShare;
  const native = window.MoonslingAndroid || null;

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const canvas = $('game');

  // ---------------------------------------------------------------------------
  // Save data
  // ---------------------------------------------------------------------------
  const SAVE_KEY = 'moonsling.save.v1';
  const DEFAULTS = {
    best: 0, bank: 0, owned: ['luna'], skin: 'luna', muted: false, haptics: true,
    tutorialDone: false, games: 0, totalStars: 0,
    daily: { key: '', best: 0, attempts: 0, bestLog: [] },
    streakDays: 0, lastDailyKey: '',
  };
  function loadSave() {
    let data = {};
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') || {}; } catch (e) { data = {}; }
    const s = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), data);
    if (!Array.isArray(s.owned) || !s.owned.includes('luna')) s.owned = ['luna'].concat(Array.isArray(s.owned) ? s.owned : []);
    if (!SKINS.some((k) => k.id === s.skin)) s.skin = 'luna';
    return s;
  }
  const save = loadSave();
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable */ } }

  const todayKey = () => Core.dateKey(new Date());
  function freshDaily() {
    const k = todayKey();
    if (save.daily.key !== k) save.daily = { key: k, best: 0, attempts: 0, bestLog: [] };
    return save.daily;
  }
  function liveStreak() {
    const k = todayKey();
    return save.lastDailyKey === k || save.lastDailyKey === Core.addDaysKey(k, -1) ? save.streakDays : 0;
  }

  // ---------------------------------------------------------------------------
  // Platform helpers
  // ---------------------------------------------------------------------------
  function haptic(ms, amp) {
    if (!save.haptics) return;
    try {
      if (native && native.vibrate) native.vibrate(ms, amp || 120);
      else if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* ignore */ }
  }
  function shareUrl() {
    if (window.MOONSLING_SHARE_URL) return window.MOONSLING_SHARE_URL;
    try { if (native && native.getShareUrl) return native.getShareUrl(); } catch (e) { /* ignore */ }
    try {
      if (window.top === window && /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname)) {
        return location.origin + location.pathname;
      }
    } catch (e) { /* cross-origin frame */ }
    return '';
  }
  const randomSeed = () => ((Math.random() * 4294967296) >>> 0) || 1;
  // iPads and iPhones have no web vibration API, so the toggle is hidden there.
  const canVibrate = !!(native && native.vibrate) || typeof navigator.vibrate === 'function';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const renderer = new Renderer(canvas);
  renderer.setSkin(SKINS.find((k) => k.id === save.skin));
  let game = null;
  let titleGame = true;          // current game is the idle one behind the title screen
  let mode = 'endless';          // endless | daily
  let ui = 'title';              // title | playing | paused | over | skins
  let skinsReturn = 'title';
  let guide = false;
  let slowT = 0, slowScale = 1;
  let lastResult = null;

  function setUI(name) {
    ui = name;
    document.body.className = 'ui-' + name;
  }

  function resize() {
    const r = app.getBoundingClientRect();
    renderer.resize(r.width, r.height, window.devicePixelRatio || 1);
    if (game) game.setHeight(renderer.H);
    // Menus and HUD are laid out for a ~420×700 phone; scale them up on tablets.
    const ui = Math.max(1, Math.min(1.6, r.width / 420, r.height / 700));
    app.style.setProperty('--ui', ui.toFixed(3));
  }

  function newGame(seed) {
    game = new Game({ seed, height: renderer.H });
    renderer.reset();
    hud.score = -1;
    hud.stars = -1;
    hud.streak = -1;
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const hud = { score: -1, stars: -1, streak: -1, hint: '' };
  const elScore = $('score'), elRunStars = $('runStars').querySelector('b'), elStreak = $('streak'), elHint = $('hint');

  function updateHud(pop) {
    if (game.score !== hud.score) {
      hud.score = game.score;
      elScore.textContent = String(hud.score);
      if (pop) {
        elScore.classList.remove('pop');
        void elScore.offsetWidth;
        elScore.classList.add('pop');
      }
    }
    if (game.starsCollected !== hud.stars) {
      hud.stars = game.starsCollected;
      elRunStars.textContent = String(hud.stars);
    }
    const st = game.state === 'dead' ? 0 : game.streak;
    if (st !== hud.streak) {
      hud.streak = st;
      if (st >= 2) {
        elStreak.textContent = '🔥 PERFECT ×' + st;
        elStreak.classList.add('show');
      } else {
        elStreak.classList.remove('show');
      }
    }
    let hint = '';
    if (ui === 'playing' && game.state === 'play' && game.moon.state === 'orbit') {
      if (guide && game.hops < 3) hint = 'Tap when the line points at a planet 🎯';
      else if (game.launches === 0) hint = 'Tap to launch';
    }
    if (hint !== hud.hint) {
      hud.hint = hint;
      if (hint) elHint.textContent = hint;
      elHint.classList.toggle('show', !!hint);
    }
  }

  // ---------------------------------------------------------------------------
  // Title screen
  // ---------------------------------------------------------------------------
  const ICON_SOUND_ON = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';
  const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zm16.6 3 2.1-2.1-1.4-1.4-2.1 2.1-2.1-2.1-1.4 1.4 2.1 2.1-2.1 2.1 1.4 1.4 2.1-2.1 2.1 2.1 1.4-1.4z"/></svg>';
  const ICON_HAPTIC = '<svg viewBox="0 0 24 24"><path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v14h8V5H8zM2 8h2v8H2V8zm18 0h2v8h-2V8z"/></svg>';

  function refreshTitle() {
    const d = freshDaily();
    $('titleBest').textContent = save.best > 0 ? 'BEST ' + save.best : '';
    $('bankChip').querySelector('b').textContent = String(save.bank);
    $('dailyLabel').textContent = 'DAILY #' + Core.dailyNumber(new Date());
    const streak = liveStreak();
    $('dailySub').textContent = (d.best ? 'Best ' + d.best : 'New run today!') + (streak > 0 ? ' · 🔥' + streak : '');
    $('skinsSub').textContent = SKINS.filter((k) => save.owned.includes(k.id)).length + '/' + SKINS.length + ' unlocked';
    $('soundBtn').innerHTML = save.muted ? ICON_SOUND_OFF : ICON_SOUND_ON;
    $('soundBtn').classList.toggle('off', save.muted);
    $('hapticBtn').innerHTML = ICON_HAPTIC;
    $('hapticBtn').classList.toggle('off', !save.haptics);
    $('hapticBtn').style.display = canVibrate ? '' : 'none';
  }

  function goHome() {
    newGame(randomSeed());
    titleGame = true;
    mode = 'endless';
    refreshTitle();
    setUI('title');
  }

  function startRun(newMode) {
    Snd.unlock();
    mode = newMode;
    const canReuse = mode === 'endless' && titleGame && game && game.state === 'ready';
    if (!canReuse) newGame(mode === 'daily' ? Core.dailySeed(new Date()) : randomSeed());
    titleGame = false;
    if (mode === 'daily') {
      freshDaily().attempts++;
      persist();
    }
    guide = !save.tutorialDone;
    game.start();
    setUI('playing');
    updateHud(false);
  }

  // ---------------------------------------------------------------------------
  // Game events → juice
  // ---------------------------------------------------------------------------
  function slow(duration, scale) { slowT = duration; slowScale = scale; }

  function handleEvents() {
    const evs = game.events;
    if (!evs.length) return;
    for (const e of evs) {
      switch (e.type) {
        case 'launch':
          Snd.launch();
          haptic(8, 60);
          break;
        case 'capture': {
          const p = game.planets.find((q) => q.id === e.planet);
          const col = e.perfect ? '#7dff9e' : '#ffe066';
          if (p) renderer.ripple(p.x, p.y, p.captureR, col);
          renderer.burst(e.x, e.y, col, e.perfect ? 26 : 12, e.perfect ? 260 : 150);
          if (e.perfect) {
            renderer.popText(e.streak > 1 ? 'PERFECT ×' + e.streak : 'PERFECT', e.px, e.py - 72, '#7dff9e', 26);
            renderer.kick = 1;
            renderer.doFlash('#ffffff', 0.12);
            slow(0.12, 0.35);
            haptic(24, 200);
          } else {
            haptic(12, 90);
          }
          renderer.popText('+' + e.pts, e.x, e.y - 22, '#ffffff', 18);
          if (e.advanced > 1) renderer.popText('SKIP!', e.px, e.py + 70, '#ffb347', 22);
          Snd.capture(e.streak, e.perfect);
          updateHud(true);
          break;
        }
        case 'recapture':
          Snd.capture(0, false);
          haptic(10, 60);
          break;
        case 'star':
          Snd.star();
          renderer.burst(e.x, e.y, '#ffe066', 10, 140, 2.5);
          haptic(5, 40);
          break;
        case 'close':
          renderer.popText('CLOSE!', e.x, e.y - 18, '#ff9ecb', 18);
          Snd.close();
          break;
        case 'tick':
          Snd.tick(e.left);
          if (e.left <= 0.5) haptic(6, 50);
          break;
        case 'decayed':
          Snd.decayed();
          break;
        case 'zone': {
          const z = zoneInfo(e.zone);
          const b = $('banner');
          b.innerHTML = '<small>ZONE ' + (e.zone + 1) + '</small>' + z.name;
          b.classList.remove('show');
          void b.offsetWidth;
          b.classList.add('show');
          renderer.doFlash(z.accent, 0.3);
          Snd.zone();
          haptic(30, 160);
          break;
        }
        case 'death':
          onDeath(e);
          break;
        default:
          break;
      }
    }
    evs.length = 0;
  }

  function onDeath(e) {
    Snd.death();
    haptic(140, 255);
    renderer.shake = 12;
    const sk = renderer.skin;
    renderer.burst(e.x, e.y, sk.trail === 'rainbow' ? '#ff6bd6' : sk.glow, 40, 320, 4);
    renderer.burst(e.x, e.y, '#ffffff', 16, 200, 2);
    renderer.doFlash('#ff4d6d', 0.28);
    slow(0.6, 0.3);

    const r = game.result();
    save.games++;
    save.bank += r.stars;
    save.totalStars += r.stars;
    const prevBest = save.best;
    let newBest = false, newDailyBest = false, dailyBonus = 0;
    if (r.score > save.best) { save.best = r.score; newBest = prevBest > 0 || r.score >= 5; }
    if (mode === 'daily') {
      const d = freshDaily();
      if (r.score > d.best) { d.best = r.score; d.bestLog = r.hopLog; newDailyBest = true; }
      const k = todayKey();
      if (save.lastDailyKey !== k) {
        // First daily run today: extend the streak and pay a streak-scaled bonus.
        save.streakDays = save.lastDailyKey === Core.addDaysKey(k, -1) ? save.streakDays + 1 : 1;
        save.lastDailyKey = k;
        dailyBonus = 10 + 5 * Math.min(save.streakDays - 1, 4);
        save.bank += dailyBonus;
      }
    }
    if (r.hops >= 3) save.tutorialDone = true;
    persist();

    lastResult = Object.assign({}, r, {
      daily: mode === 'daily',
      dailyNo: Core.dailyNumber(new Date()),
      streakDays: liveStreak(),
      newBest, newDailyBest, dailyBonus,
    });
    const shownFor = game;
    setTimeout(() => {
      if (game === shownFor && ui === 'playing') showGameOver(lastResult);
    }, 900);
  }

  function showGameOver(r) {
    $('overMode').textContent = r.daily
      ? 'DAILY #' + r.dailyNo + ' · ATTEMPT ' + save.daily.attempts
      : 'ENDLESS';
    $('overReason').textContent = (DEATH_TEXT[r.reason] || 'Game over').toUpperCase();
    $('overScore').textContent = String(r.score);
    const badge = $('overBadge');
    badge.textContent = r.newBest ? 'NEW BEST!' : r.newDailyBest && r.daily ? 'BEST TODAY!' : '';
    badge.classList.toggle('show', !!(r.newBest || (r.daily && r.newDailyBest && r.score > 0)));
    $('overBest').textContent = String(r.daily ? save.daily.best : save.best);
    $('overBest').nextElementSibling.textContent = r.daily ? 'TODAY' : 'BEST';
    $('overHops').textContent = String(r.hops);
    $('overPerfect').textContent = String(r.perfects);

    const grid = $('overGrid');
    grid.innerHTML = '';
    const cells = r.hopLog.slice(-30);
    if (r.hopLog.length > 30) {
      const more = document.createElement('span');
      more.className = 'more';
      more.textContent = '+' + (r.hopLog.length - 30) + ' earlier';
      grid.appendChild(more);
    }
    for (const c of cells) {
      const i = document.createElement('i');
      i.className = c;
      grid.appendChild(i);
    }

    // progress to next unlock
    const next = SKINS.filter((k) => !save.owned.includes(k.id)).sort((a, b) => a.price - b.price)[0];
    const unlock = $('overUnlock');
    const bar = $('unlockBar');
    if (next) {
      unlock.style.display = '';
      const ready = save.bank >= next.price;
      $('unlockText').textContent = ready ? next.name + ' is ready to unlock!' : 'Next: ' + next.name;
      $('unlockStars').textContent = '+' + (r.stars + r.dailyBonus) + ' ★  ·  ' + Math.min(save.bank, next.price) + '/' + next.price;
      bar.style.width = '0%';
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = Math.min(100, (100 * save.bank) / next.price) + '%'; }));
    } else {
      unlock.style.display = 'none';
    }

    setUI('over');
    if (r.dailyBonus) Share.toast('🔥 Daily bonus +' + r.dailyBonus + ' ★');
    if (r.newBest) {
      Snd.best();
      renderer.burst(game.moon.x, game.camY + renderer.H * 0.3, '#ffe066', 60, 380, 3.5);
    }
  }

  // ---------------------------------------------------------------------------
  // Skins
  // ---------------------------------------------------------------------------
  function renderSkins() {
    $('skinsBank').querySelector('b').textContent = String(save.bank);
    const grid = $('skinGrid');
    grid.innerHTML = '';
    for (const sk of SKINS) {
      const owned = save.owned.includes(sk.id);
      const equipped = save.skin === sk.id;
      const b = document.createElement('button');
      b.className = 'skin' + (owned ? ' owned' : ' locked') + (equipped ? ' equipped' : '') + (sk.trail === 'rainbow' ? ' rainbow' : '');
      b.style.setProperty('--c', sk.color);
      b.style.setProperty('--g', sk.glow);
      b.innerHTML = '<span class="orb"></span><span class="name"></span><span class="price"></span>';
      b.querySelector('.name').textContent = sk.name;
      b.querySelector('.price').textContent = equipped ? 'IN USE' : owned ? 'USE' : '★ ' + sk.price;
      b.addEventListener('click', () => {
        if (owned) {
          save.skin = sk.id;
          Snd.click();
        } else if (save.bank >= sk.price) {
          save.bank -= sk.price;
          save.owned.push(sk.id);
          save.skin = sk.id;
          Snd.buy();
          haptic(30, 180);
          Share.toast(sk.name + ' unlocked!');
        } else {
          b.classList.remove('nope');
          void b.offsetWidth;
          b.classList.add('nope');
          Share.toast('Need ' + (sk.price - save.bank) + ' more ★');
          return;
        }
        renderer.setSkin(sk);
        persist();
        renderSkins();
      });
      grid.appendChild(b);
    }
  }

  function openSkins(from) {
    skinsReturn = from;
    renderSkins();
    setUI('skins');
  }

  // ---------------------------------------------------------------------------
  // Pause / back / lifecycle
  // ---------------------------------------------------------------------------
  function pause() {
    if (ui !== 'playing' || game.state === 'dead') return;
    setUI('paused');
  }
  function resume() {
    if (ui !== 'paused') return;
    setUI('playing');
  }

  // Android back button. Returns 'exit' when the app should close.
  window.moonslingBack = function () {
    switch (ui) {
      case 'playing': if (game.state === 'dead') return 'handled'; pause(); return 'handled';
      case 'paused': resume(); return 'handled';
      case 'skins': if (skinsReturn === 'over') setUI('over'); else { refreshTitle(); setUI('title'); } return 'handled';
      case 'over': goHome(); return 'handled';
      default: return 'exit';
    }
  };
  window.moonslingPause = function () {
    pause();
    Snd.suspend();
  };
  window.moonslingResume = function () { Snd.resume(); };
  window.setSafeInsets = function (t, b, l, r) {
    const st = document.documentElement.style;
    st.setProperty('--sat', t + 'px');
    st.setProperty('--sab', b + 'px');
    st.setProperty('--sal', l + 'px');
    st.setProperty('--sar', r + 'px');
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.moonslingPause();
    else Snd.resume();
  });

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function onPress(e) {
    if (e.target.closest && e.target.closest('button, .panel')) return;
    if (e.button !== undefined && e.button > 0) return;
    Snd.unlock();
    if (ui === 'title') {
      startRun('endless');
    } else if (ui === 'playing') {
      game.tap();
    }
  }
  app.addEventListener('pointerdown', onPress);
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp') {
      e.preventDefault();
      if (ui === 'title') startRun('endless');
      else if (ui === 'playing') game.tap();
      else if (ui === 'over') startRun(mode);
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      if (ui === 'playing') pause(); else if (ui === 'paused') resume();
    }
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  // Safari (iPad/iPhone) ignores user-scalable=no: block pinch, double-tap zoom and rubber-banding.
  for (const type of ['gesturestart', 'gesturechange', 'dblclick']) {
    document.addEventListener(type, (e) => e.preventDefault());
  }
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  // iOS unlocks audio on touchend/click rather than pointerdown.
  for (const type of ['touchend', 'click']) {
    document.addEventListener(type, () => Snd.unlock(), { passive: true });
  }

  function bind(id, fn) {
    $(id).addEventListener('click', (e) => {
      e.stopPropagation();
      Snd.unlock();
      fn(e);
    });
  }
  bind('pauseBtn', () => { Snd.click(); pause(); });
  bind('resumeBtn', () => { Snd.click(); resume(); });
  bind('pauseHomeBtn', () => { Snd.click(); goHome(); });
  bind('retryBtn', () => { Snd.click(); startRun(mode); });
  bind('homeBtn', () => { Snd.click(); goHome(); });
  bind('shareBtn', () => {
    Snd.click();
    if (!lastResult) return;
    const text = Core.shareText(Object.assign({}, lastResult, { url: shareUrl() }));
    Share.shareRun(lastResult, text);
  });
  $('overUnlock').addEventListener('click', (e) => {
    e.stopPropagation();
    Snd.click();
    openSkins('over');
  });
  bind('dailyBtn', () => { Snd.click(); startRun('daily'); });
  bind('skinsBtn', () => { Snd.click(); openSkins('title'); });
  bind('skinsClose', () => {
    Snd.click();
    if (skinsReturn === 'over') setUI('over');
    else { refreshTitle(); setUI('title'); }
  });
  bind('soundBtn', () => {
    save.muted = !save.muted;
    Snd.setMuted(save.muted);
    persist();
    refreshTitle();
    Snd.click();
  });
  bind('hapticBtn', () => {
    save.haptics = !save.haptics;
    persist();
    refreshTitle();
    haptic(30, 160);
  });

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;

    let gdt = 0;
    if (ui !== 'paused') {
      let scale = 1;
      if (slowT > 0) { slowT -= dt; scale = slowScale; }
      gdt = dt * scale;
      let rem = gdt;
      while (rem > 1e-6) {
        const h = Math.min(rem, 1 / 120);
        game.update(h);
        rem -= h;
      }
      handleEvents();
      if (ui === 'playing') updateHud(false);
    }
    renderer.draw(game, gdt, {
      guide: guide && ui === 'playing' && game.hops < 3,
      dim: ui === 'title' ? 0.88 : 0,
    });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  Snd.setMuted(save.muted);
  resize();
  window.addEventListener('resize', resize);
  newGame(randomSeed());
  refreshTitle();
  setUI('title');
  requestAnimationFrame(frame);

  // Offline support when installed from a website (e.g. "Add to Home Screen" on iPad).
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !native) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* not available here */ });
    });
  }

  // Test / debug hook.
  window.__moonsling = {
    get game() { return game; },
    get ui() { return ui; },
    save, renderer, startRun, goHome, showGameOver: () => lastResult && showGameOver(lastResult),
  };
})();
