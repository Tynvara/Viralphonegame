/*
 * Critter Merge — app controller: loop, input, screens, saves, sound, haptics.
 */
(function () {
  'use strict';

  const Core = window.CritterCore;
  const { CRITTERS, LAST, TW } = Core;
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
    const s = Object.assign({ best: 0, games: 0, bestCritter: 0, muted: false, music: true, haptics: true, seenHint: false, discovered: STARTER.slice() }, d);
    if (!Array.isArray(s.discovered) || s.discovered.length !== CRITTERS.length) s.discovered = STARTER.slice();
    for (let i = 0; i <= 4; i++) s.discovered[i] = true;
    return s;
  }
  const save = loadSave();
  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* unavailable */ } };

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
  let ui = 'title';           // title | playing | paused | over | album | discover
  let albumReturn = 'title';
  let aiming = false;
  let discoverQueue = [];
  let discoverAt = 0;         // small delay so the merge pop is seen before the card
  let warnT = 0;

  function setUI(name) {
    ui = name;
    document.body.className = 'ui-' + name;
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
    if (b.top > a.bottom) renderer.titleBand = { top: a.bottom - top + 30, bottom: b.top - top - 40 };
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const hud = { score: -1, next: -1, shakes: -1, hint: null };
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
    let hint = '';
    if (!save.seenHint && ui === 'playing') {
      if (game.drops === 0) hint = 'Slide your finger to aim.<br>Let go to drop!';
      else if (game.merges === 0 && game.drops < 8) hint = 'Two of the same<br>make a bigger critter!';
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
  // Screens
  // ---------------------------------------------------------------------------
  const ICON = {
    soundOn: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zm16.6 3 2.1-2.1-1.4-1.4-2.1 2.1-2.1-2.1-1.4 1.4 2.1 2.1-2.1 2.1 1.4 1.4 2.1-2.1 2.1 2.1 1.4-1.4z"/></svg>',
    music: '<svg viewBox="0 0 24 24"><path d="M9 18a3 3 0 1 1-2-2.8V5l12-2v11.5a3 3 0 1 1-2-2.8V6.3L9 7.6V18z"/></svg>',
    haptic: '<svg viewBox="0 0 24 24"><path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v14h8V5H8zM2 8h2v8H2V8zm18 0h2v8h-2V8z"/></svg>',
  };

  function refreshTitle() {
    $('titleBest').textContent = save.best > 0 ? '⭐ Best: ' + save.best : '';
    const found = save.discovered.filter(Boolean).length;
    $('albumCount').textContent = found + ' / ' + CRITTERS.length;
    $('soundBtn').innerHTML = save.muted ? ICON.soundOff : ICON.soundOn;
    $('soundBtn').classList.toggle('off', save.muted);
    $('musicBtn').innerHTML = ICON.music;
    $('musicBtn').classList.toggle('off', !save.music);
    $('hapticBtn').innerHTML = ICON.haptic;
    $('hapticBtn').classList.toggle('off', !save.haptics);
    $('hapticBtn').style.display = canVibrate ? '' : 'none';
  }

  function goHome() {
    game = null;
    aiming = false;
    refreshTitle();
    setUI('title');
  }

  function startGame() {
    Snd.unlock();
    game = new Core.Game({ seed: ((Math.random() * 4294967296) >>> 0) || 1 });
    game.setAim(TW / 2);
    renderer.particles.length = 0;
    renderer.texts.length = 0;
    renderer.floaters.length = 0;
    hud.score = hud.next = hud.shakes = -1;
    hud.hint = null;
    discoverQueue = [];
    renderChain();
    setUI('playing');
    updateHud(false);
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
          banner('🫧 Bubble Rescue! 🫧<small>Careful, it only works once!</small>');
          Snd.rescue();
          haptic(60, 160);
          break;
        case 'shake':
          renderer.shake = 9;
          Snd.shake();
          haptic(150, 200);
          break;
        case 'over':
          Snd.over();
          haptic(200, 200);
          setTimeout(() => { if (game && game.state === 'over' && (ui === 'playing' || ui === 'discover')) showOver(); }, 1100);
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
    if (ui === 'title') { startGame(); return; }
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
      game.drop();
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => { aiming = false; });

  window.addEventListener('keydown', (e) => {
    if (ui !== 'playing' || !game || e.repeat && e.code === 'Space') return;
    if (e.code === 'ArrowLeft') game.setAim(game.aimX - 14);
    else if (e.code === 'ArrowRight') game.setAim(game.aimX + 14);
    else if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'Enter') { e.preventDefault(); game.drop(); }
    else if (e.code === 'Escape') setUI('paused');
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  for (const type of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(type, (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (!e.target.closest('.album-grid')) e.preventDefault(); }, { passive: false });
  for (const type of ['touchend', 'click']) document.addEventListener(type, () => Snd.unlock(), { passive: true });

  function bind(id, fn) {
    $(id).addEventListener('click', (e) => {
      e.stopPropagation();
      Snd.unlock();
      fn(e);
    });
  }
  bind('playBtn', () => { Snd.click(); startGame(); });
  bind('albumBtn', () => { Snd.click(); openAlbum('title'); });
  bind('albumClose', () => { Snd.click(); if (albumReturn === 'over') setUI('over'); else { refreshTitle(); setUI('title'); } });
  bind('pauseBtn', () => { Snd.click(); setUI('paused'); });
  bind('resumeBtn', () => { Snd.click(); setUI('playing'); });
  bind('restartBtn', () => { Snd.click(); startGame(); });
  bind('pauseHomeBtn', () => { Snd.click(); goHome(); });
  bind('againBtn', () => { Snd.click(); startGame(); });
  bind('overHomeBtn', () => { Snd.click(); goHome(); });
  bind('shakeBtn', () => {
    if (!game || !game.shake()) toast(game && game.shakes <= 0 ? 'No shakes left!' : 'Drop a critter first!');
    updateHud(false);
  });
  bind('discOk', () => {
    Snd.click();
    if (!showNextDiscovery()) setUI('playing');
  });
  bind('soundBtn', () => { save.muted = !save.muted; Snd.setMuted(save.muted); persist(); refreshTitle(); Snd.click(); });
  bind('musicBtn', () => { save.music = !save.music; Snd.setMusic(save.music); persist(); refreshTitle(); });
  bind('hapticBtn', () => { save.haptics = !save.haptics; persist(); refreshTitle(); haptic(40, 160); });

  // Android back button: returns 'exit' when the app should close.
  window.critterBack = function () {
    switch (ui) {
      case 'playing': setUI('paused'); return 'handled';
      case 'paused': setUI('playing'); return 'handled';
      case 'discover': if (!showNextDiscovery()) setUI('playing'); return 'handled';
      case 'album': if (albumReturn === 'over') setUI('over'); else { refreshTitle(); setUI('title'); } return 'handled';
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
    if (game && ui === 'playing') {
      game.update(dt);
      handleEvents();
      updateHud(false);
      if (game.danger && game.state === 'play') {
        warnT -= dt;
        if (warnT <= 0) { Snd.warn(); warnT = 1.2; }
      } else {
        warnT = 0;
      }
      if (discoverQueue.length && game.state === 'play' && now >= discoverAt) showNextDiscovery();
    }
    renderer.draw(game, ui === 'paused' || ui === 'discover' ? 0 : dt, {
      title: ui === 'title' || (ui === 'album' && !game),
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
    save, renderer, startGame, goHome, openAlbum,
  };
})();
