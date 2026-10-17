/* Snake: classic and challenge modes.
 *
 * The engine knows nothing about specific challenges. Everything absurd lives
 * in snake-mods.js as "mods": objects with optional hooks the engine calls at
 * fixed points (tick, input, eat, draw, ...). A level activates a few
 * challenge mods; power-ups activate their own mod for a number of ticks. */
(function () {
  'use strict';

  const canvas = document.getElementById('snake-board');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const hudEl = document.getElementById('snake-hud');
  const fxEl = document.getElementById('snake-effects');
  const tickerEl = document.getElementById('snake-ticker');
  const guideEl = document.getElementById('snake-guide');
  const soundBtn = document.getElementById('snake-sound');
  const modeBtns = document.querySelectorAll('[data-snake-mode]');

  const MODS = window.SnakeMods || [];
  const BYID = {};
  MODS.forEach(m => { BYID[m.id] = m; });
  const CHALLENGES = MODS.filter(m => m.kind === 'challenge');
  const POWERUPS = MODS.filter(m => m.kind === 'powerup');

  const PX = 400;
  const SERIF = '"EB Garamond", Georgia, serif';
  const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  const FRUITS = ['🍎', '🍌', '🍇', '🍓', '🍒', '🍑', '🍍', '🥝', '🍉', '🥕', '🧀', '🍩'];

  // ── storage (best-effort; private windows may throw) ──────────
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('snake.' + k); return v == null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set(k, v) { try { localStorage.setItem('snake.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  // ── sound ─────────────────────────────────────────────────────
  let soundOn = store.get('sound', true);
  let audio = null;
  function tone(f, dur, type, vol, delay, f2) {
    const t = audio.currentTime + (delay || 0);
    const o = audio.createOscillator();
    const gn = audio.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    gn.gain.setValueAtTime(vol || 0.03, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(audio.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const SFX = {
    eat: () => { tone(520, 0.07, 'square', 0.03); tone(780, 0.07, 'square', 0.025, 0.05); },
    power: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.09, 'square', 0.025, i * 0.06)),
    bad: () => tone(220, 0.25, 'sawtooth', 0.03, 0, 90),
    die: () => tone(440, 0.6, 'triangle', 0.06, 0, 55),
    level: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, 'triangle', 0.05, i * 0.08)),
    boing: () => tone(180, 0.2, 'sine', 0.08, 0, 520),
    warp: () => tone(300, 0.25, 'sine', 0.06, 0, 1400),
    boom: () => { tone(120, 0.5, 'sawtooth', 0.06, 0, 30); tone(80, 0.6, 'square', 0.04, 0.02, 25); },
    thud: () => tone(140, 0.15, 'square', 0.05, 0, 50),
    zap: () => tone(1800, 0.18, 'sawtooth', 0.025, 0, 200),
    click: () => tone(900, 0.03, 'square', 0.02),
    shield: () => tone(900, 0.3, 'triangle', 0.05, 0, 300),
    honk: () => { tone(260, 0.12, 'sawtooth', 0.04); tone(260, 0.12, 'sawtooth', 0.04, 0.16); },
  };
  function sfx(name) {
    if (!soundOn || !SFX[name]) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      SFX[name]();
    } catch (e) { /* no audio, no problem */ }
  }

  // ── game state ────────────────────────────────────────────────
  const g = {
    mode: 'classic', state: 'ready', W: 20, H: 20, cell: 20, ox: 0, oy: 0,
    snake: [], dir: { x: 1, y: 0 }, queue: [], foods: [], pickups: [],
    rocks: new Map(), hazards: [], mods: [], particles: [], toasts: [],
    levelMods: [], runSeen: new Set(), practice: null,
    level: 1, eaten: 0, goal: Infinity, score: 0, lives: 3, tick: 0, grow: 0,
    t: 0, dt: 0, shake: 0, flash: 0, lockUntil: 0, lastEat: 0, lastTail: null,
    deathReason: '', nextPickup: 0, closeAt: 0, style: null,
    canvas, ctx, dpr: 1, PX, DIRS,
  };
  window.SnakeGame = g; // handy for poking at it from the console

  let foodSeq = 0;
  const key = (x, y) => x + ',' + y;

  g.rand = n => Math.floor(Math.random() * n);
  g.chance = p => Math.random() < p;
  g.pick = a => a[Math.floor(Math.random() * a.length)];
  g.dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  g.inBounds = (x, y) => x >= 0 && y >= 0 && x < g.W && y < g.H;
  g.head = () => g.snake[0];
  g.px = x => g.ox + x * g.cell + g.cell / 2;
  g.py = y => g.oy + y * g.cell + g.cell / 2;
  g.has = id => g.mods.some(m => m.def.id === id);
  g.wraps = () => g.mods.some(m => m.def.wrap);
  g.sfx = sfx;

  g.onSnake = (x, y, from) => {
    for (let i = from || 0; i < g.snake.length; i++) {
      if (g.snake[i].x === x && g.snake[i].y === y) return i;
    }
    return -1;
  };
  g.rockAt = (x, y) => g.rocks.get(key(x, y));
  g.addRock = (x, y, o) => {
    if (!g.inBounds(x, y)) return;
    o = o || {};
    g.rocks.set(key(x, y), {
      x, y, kind: o.kind || 'rock', owner: o.owner || null,
      until: o.until || Infinity, reason: o.reason, born: g.tick,
    });
  };
  g.removeRock = (x, y) => g.rocks.delete(key(x, y));
  g.foodAt = (x, y) => g.foods.findIndex(f => f.x === x && f.y === y);
  g.removeFood = f => { const i = g.foods.indexOf(f); if (i >= 0) g.foods.splice(i, 1); };
  g.pickupAt = (x, y) => g.pickups.findIndex(p => p.x === x && p.y === y);

  g.hazardHit = (x, y) => {
    for (const h of g.hazards) {
      const r = h.hit && h.hit(x, y);
      if (r) return r;
    }
    return null;
  };

  // Anything already sitting on this cell?
  g.taken = (x, y) =>
    g.onSnake(x, y) >= 0 || g.rocks.has(key(x, y)) || g.foodAt(x, y) >= 0 ||
    g.pickupAt(x, y) >= 0 ||
    g.hazards.some(h => (h.hit && h.hit(x, y)) || (h.occupies && h.occupies(x, y)));

  // Would the head die moving here? (ignores the tail, which moves away)
  g.blockedAt = (x, y) => !!hitAt(x, y);

  // Random empty cell. opts: filter(x, y), minDist from head, avoidAhead.
  g.randFree = opts => {
    opts = opts || {};
    const h = g.snake[0];
    const md = opts.minDist == null ? 2 : opts.minDist;
    const good = [], loose = [];
    for (let y = 0; y < g.H; y++) {
      for (let x = 0; x < g.W; x++) {
        if (g.taken(x, y)) continue;
        if (h && g.dist(h, { x, y }) < md) continue;
        if (opts.avoidAhead && h && aheadOfHead(x, y)) continue;
        loose.push({ x, y });
        if (!opts.filter || opts.filter(x, y)) good.push({ x, y });
      }
    }
    const pool = good.length ? good : opts.strict ? [] : loose;
    return pool.length ? g.pick(pool) : null;
  };
  function aheadOfHead(x, y) {
    const h = g.snake[0], d = g.dir;
    for (let i = 1; i <= 6; i++) if (h.x + d.x * i === x && h.y + d.y * i === y) return true;
    return false;
  }

  g.spawnFood = extra => {
    const c = g.randFree({ filter: (x, y) => all('place', x, y), minDist: 2 });
    if (!c) return null;
    const f = Object.assign({ x: c.x, y: c.y, born: g.tick, id: foodSeq++ }, extra || {});
    run('newFood', f);
    g.foods.push(f);
    return f;
  };
  function topUpFood() {
    const n = fold('foodCount', 1);
    for (let i = 0; g.foods.length < n && i < 20; i++) if (!g.spawnFood()) break;
  }

  g.eat = i => {
    const f = g.foods[i];
    if (!f) return;
    g.foods.splice(i, 1);
    const res = { grow: 1, progress: 1, points: 10, sound: 'eat' };
    run('eat', f, res);
    if (res.grow > 0) g.grow += res.grow;
    g.eaten = Math.max(0, g.eaten + res.progress);
    g.score += res.points;
    g.lastEat = g.tick;
    sfx(res.sound);
    g.burst(f.x, f.y, f.color || (g.style && g.style.pal.food) || '#5c0000', 8);
    emit('eat', { food: f, res });
  };

  g.shrink = n => {
    const fromGrow = Math.min(g.grow, n);
    g.grow -= fromGrow;
    n -= fromGrow;
    let k = 0;
    while (k < n && g.snake.length > 2) {
      const t = g.snake.pop();
      g.puff(t.x, t.y);
      k++;
    }
    return k;
  };
  // Keep the first `keep` segments.
  g.cut = keep => {
    keep = Math.max(2, keep);
    g.snake.splice(keep).forEach(p => g.puff(p.x, p.y));
    g.grow = 0;
  };
  g.reverse = () => {
    if (g.snake.length < 2) { g.dir = { x: -g.dir.x, y: -g.dir.y }; return; }
    g.snake.reverse();
    const a = g.snake[0], b = g.snake[1];
    const dx = a.x - b.x, dy = a.y - b.y;
    let d;
    if (!dx && !dy) d = { x: -g.dir.x, y: -g.dir.y };
    else if (Math.abs(dx) >= Math.abs(dy)) d = { x: Math.sign(dx) * (Math.abs(dx) > 2 ? -1 : 1), y: 0 };
    else d = { x: 0, y: Math.sign(dy) * (Math.abs(dy) > 2 ? -1 : 1) };
    g.dir = d;
    g.queue = [];
  };

  // Can the head safely move one step in direction d?
  g.safe = d => {
    const h = g.snake[0];
    let x = h.x + d.x, y = h.y + d.y;
    if (!g.inBounds(x, y)) {
      if (!g.wraps()) return false;
      x = (x + g.W) % g.W; y = (y + g.H) % g.H;
    }
    return !g.blockedAt(x, y);
  };

  // Breadth-first search: first step from `from` toward the nearest target.
  g.path = (from, targets, blocked, wrap) => {
    if (!targets.length) return null;
    const W = g.W, H = g.H;
    const goal = new Set(targets.map(t => key(t.x, t.y)));
    const seen = new Uint8Array(W * H);
    const q = [];
    seen[from.y * W + from.x] = 1;
    for (const d of DIRS) q.push({ x: from.x + d.x, y: from.y + d.y, first: d });
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      if (!g.inBounds(c.x, c.y)) {
        if (!wrap) continue;
        c.x = (c.x + W) % W; c.y = (c.y + H) % H;
      }
      const idx = c.y * W + c.x;
      if (seen[idx]) continue;
      seen[idx] = 1;
      if (goal.has(key(c.x, c.y))) return c.first;
      if (blocked(c.x, c.y)) continue;
      for (const d of DIRS) q.push({ x: c.x + d.x, y: c.y + d.y, first: c.first });
    }
    return null;
  };

  // Drop the snake somewhere roomy, in a straight line.
  g.relocate = () => {
    const len = g.snake.length;
    const others = new Set(g.snake.map(p => key(p.x, p.y)));
    const free = (x, y) => g.inBounds(x, y) && (others.has(key(x, y)) || !g.taken(x, y));
    for (let tries = 0; tries < 300; tries++) {
      const d = g.pick(DIRS);
      const hx = g.rand(g.W), hy = g.rand(g.H);
      let ok = true;
      for (let i = -5; i < len && ok; i++) ok = free(hx - d.x * i, hy - d.y * i);
      if (!ok) continue;
      g.snake.forEach(p => g.puff(p.x, p.y));
      g.snake = [];
      for (let i = 0; i < len; i++) g.snake.push({ x: hx - d.x * i, y: hy - d.y * i });
      g.dir = d;
      g.queue = [];
      return true;
    }
    return false;
  };

  // Something hurt the snake. Mods get a chance to save it first.
  g.hurt = (reason, cat) => {
    if (g.state !== 'play') return;
    const r = first('save', cat || 'hazard', reason, g.snake[0]);
    if (r !== 'pass' && r !== 'skip') g.die(reason);
  };

  g.die = reason => {
    if (g.state !== 'play') return;
    g.deathReason = reason;
    g.shake = 12;
    g.flash = 1;
    sfx('die');
    g.snake.forEach((p, i) => { if (i % 2 === 0) g.puff(p.x, p.y); });
    emit('die', reason);
    if (g.mode === 'classic') {
      if (g.score > store.get('bestScore', 0)) store.set('bestScore', g.score);
      g.state = 'over';
    } else if (g.practice) {
      g.state = 'dead';
    } else {
      g.lives--;
      g.state = g.lives > 0 ? 'dead' : 'over';
    }
    g.lockUntil = performance.now() + 650;
  };

  // ── particles & messages ──────────────────────────────────────
  g.say = (text, x, y, color, big) => {
    if (x == null) { const h = g.snake[0] || { x: g.W / 2, y: g.H / 2 }; x = h.x; y = h.y; }
    g.particles.push({
      kind: 'text', text: T(text), x: g.px(x), y: g.py(y) - g.cell * 0.6,
      vx: 0, vy: -26, life: 1.3, max: 1.3, color: color || '#1a1a18', size: big ? 22 : 15,
    });
  };
  g.burst = (x, y, color, n) => {
    for (let i = 0; i < (n || 8); i++) {
      const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 70;
      g.particles.push({
        kind: 'dot', x: g.px(x), y: g.py(y), vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0.5, max: 0.5, color, size: 1.5 + Math.random() * 2,
      });
    }
  };
  g.puff = (x, y, color) => {
    g.particles.push({
      kind: 'puff', x: g.px(x), y: g.py(y), vx: 0, vy: -8, life: 0.45, max: 0.45,
      color: color || 'rgba(120,115,105,0.5)', size: g.cell * 0.35,
    });
  };
  g.confetti = (cx, cy, n, screen) => {
    const colors = ['#5c0000', '#c99a06', '#2f5d9b', '#3d7a3a', '#b8322a', '#6c3fb5'];
    for (let i = 0; i < (n || 40); i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 120 + Math.random() * 180;
      g.particles.push({
        kind: 'confetti', screen: !!screen, x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 1.6, max: 1.6, color: g.pick(colors), size: 3 + Math.random() * 3,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
      });
    }
  };
  g.confettiAt = (x, y, n) => g.confetti(g.px(x), g.py(y), n || 24);
  g.toast = text => { g.toasts.push({ text: T(text), born: g.t, until: g.t + 2200 }); };
  g.comment = text => {
    if (!tickerEl) return;
    tickerEl.textContent = T(text);
    tickerEl.classList.remove('fresh');
    void tickerEl.offsetWidth; // restart the fade-in
    tickerEl.classList.add('fresh');
  };

  // ── mods ──────────────────────────────────────────────────────
  function run(name, ...a) {
    for (const m of g.mods.slice()) {
      const f = m.def[name];
      if (f && g.mods.includes(m)) f.call(m.def, g, m.s, ...a);
    }
  }
  function fold(name, v, ...a) {
    for (const m of g.mods.slice()) {
      const f = m.def[name];
      if (f) { const r = f.call(m.def, g, m.s, v, ...a); if (r !== undefined) v = r; }
    }
    return v;
  }
  function first(name, ...a) {
    for (const m of g.mods.slice()) {
      const f = m.def[name];
      if (f && g.mods.includes(m)) { const r = f.call(m.def, g, m.s, ...a); if (r) return r; }
    }
    return null;
  }
  function all(name, ...a) {
    for (const m of g.mods) {
      const f = m.def[name];
      if (f && !f.call(m.def, g, m.s, ...a)) return false;
    }
    return true;
  }
  function emit(name, data) { run('event', name, data); }
  g.emit = emit;

  g.activate = (id, ticks, src, quiet) => {
    const def = BYID[id];
    if (!def) return null;
    const existing = g.mods.find(m => m.def === def);
    const until = ticks == null || ticks === Infinity ? Infinity : g.tick + ticks;
    if (existing) {
      existing.until = Math.max(existing.until, until);
      existing.dur = Math.max(existing.dur, ticks || 0);
      return existing;
    }
    const m = { def, s: {}, until, dur: ticks || 0, src: src || 'level' };
    g.mods.push(m);
    if (def.setup) def.setup(g, m.s);
    if (!quiet) discover(id);
    return m;
  };
  g.deactivate = (which, expired) => {
    const m = typeof which === 'string' ? g.mods.find(x => x.def.id === which) : which;
    if (!m) return;
    const i = g.mods.indexOf(m);
    if (i < 0) return;
    g.mods.splice(i, 1);
    if (m.def.cleanup) m.def.cleanup(g, m.s, expired);
    g.hazards = g.hazards.filter(h => h.owner !== m.def.id);
    for (const [k, r] of g.rocks) if (r.owner === m.def.id) g.rocks.delete(k);
  };

  // A random challenge for a while (the suspicious mushroom).
  g.curse = ticks => {
    const groups = new Set(g.mods.map(m => m.def.group).filter(Boolean));
    const pool = CHALLENGES.filter(c => c.temp !== false && !c.size && !g.has(c.id) &&
      !(c.group && groups.has(c.group)) && c.d <= 2);
    if (!pool.length) return null;
    const c = g.pick(pool);
    g.activate(c.id, ticks || 60, 'curse');
    g.toast(c.name + '!');
    return c;
  };
  g.surprise = () => {
    if (g.chance(0.3)) { g.curse(); return; }
    const pool = POWERUPS.filter(p => p.id !== 'mysterybox' && (!p.when || p.when(g)));
    applyPowerup(g.pick(pool), g.snake[0]);
  };
  g.press = d => request(d, true);

  // ── level flow ────────────────────────────────────────────────
  function layout() {
    g.cell = Math.floor(PX / Math.max(g.W, g.H));
    g.ox = Math.floor((PX - g.W * g.cell) / 2);
    g.oy = Math.floor((PX - g.H * g.cell) / 2);
  }

  function placeSnake() {
    const len = 4;
    g.snake = [];
    if (g.W >= g.H) {
      const y = Math.floor(g.H / 2), x0 = Math.max(len, Math.floor(g.W / 4));
      for (let i = 0; i < len; i++) g.snake.push({ x: x0 - i, y });
      g.dir = { x: 1, y: 0 };
    } else {
      const x = Math.floor(g.W / 2), y0 = Math.min(Math.floor(g.H * 0.7), g.H - len);
      for (let i = 0; i < len; i++) g.snake.push({ x, y: y0 + i });
      g.dir = { x: 0, y: -1 };
    }
  }

  function startLevel() {
    for (const m of g.mods.slice()) g.deactivate(m);
    g.mods = [];
    let sz = { W: 20, H: 20 };
    g.levelMods.forEach(id => { if (BYID[id] && BYID[id].size) sz = BYID[id].size(sz); });
    g.W = sz.W; g.H = sz.H;
    layout();
    g.rocks = new Map();
    g.hazards = []; g.foods = []; g.pickups = []; g.particles = []; g.toasts = []; g.queue = [];
    g.tick = 0; g.grow = 0; g.eaten = 0; g.lastEat = 0; g.shake = 0; g.flash = 0; g.lastTail = null;
    placeSnake();
    g.levelMods.forEach(id => g.activate(id, Infinity, 'level'));
    g.goal = g.mode === 'challenge' ? Math.round(fold('goal', Math.min(4 + g.level, 12))) : Infinity;
    topUpFood();
    g.nextPickup = 25 + g.rand(30);
    if (tickerEl) tickerEl.textContent = '';
  }

  function pickChallenges(level) {
    const want = level <= 2 ? 1 : level <= 5 ? 2 : level <= 9 ? 3 : 4;
    const budget = [0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6][Math.min(level, 10)] + Math.max(0, level - 10);
    const seenEver = new Set(store.get('seen', []));
    let fallback = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const fresh = CHALLENGES.filter(c => !g.runSeen.has(c.id));
      const base = fresh.length >= want * 4 ? fresh : CHALLENGES.slice();
      // Shuffle, nudging never-seen challenges toward the front.
      const pool = base.map(c => ({ c, r: Math.random() - (seenEver.has(c.id) ? 0 : 0.35) }))
        .sort((a, b) => a.r - b.r).map(o => o.c);
      const out = [], groups = new Set();
      let cost = 0;
      for (const c of pool) {
        if (out.length >= want) break;
        if (c.group && groups.has(c.group)) continue;
        if ((c.not || []).some(id => out.includes(id))) continue;
        if (out.some(id => (BYID[id].not || []).includes(c.id))) continue;
        if (c.size && out.some(id => BYID[id].size)) continue;
        if (cost + c.d > budget) continue;
        out.push(c.id);
        cost += c.d;
        if (c.group) groups.add(c.group);
      }
      if (out.length < want) continue;
      fallback = fallback || out;
      // Make sure each level actually asks something of you.
      if (cost < Math.min(budget, level <= 2 ? 1 : budget - 1)) continue;
      out.forEach(id => g.runSeen.add(id));
      return out;
    }
    const out = fallback || [g.pick(CHALLENGES).id];
    out.forEach(id => g.runSeen.add(id));
    return out;
  }

  function newRun(mode, practiceId) {
    g.mode = mode;
    g.practice = practiceId || null;
    g.level = 1; g.score = 0; g.lives = 3;
    g.runSeen = new Set();
    g.levelMods = practiceId ? [practiceId] : [];
    startLevel();
    g.state = mode === 'classic' ? 'ready' : practiceId ? 'intro' : 'title';
    g.lockUntil = performance.now() + 150;
    modeBtns.forEach(b => b.classList.toggle('active', b.dataset.snakeMode === mode));
    fxEl.textContent = '';
  }

  function levelClear() {
    g.state = 'clear';
    sfx('level');
    g.score += 50 * g.level;
    if (!g.practice && g.level + 1 > store.get('bestLevel', 0)) store.set('bestLevel', g.level + 1);
    g.confetti(PX / 2, PX * 0.75, 70, true);
    g.lockUntil = performance.now() + 700;
    emit('clear');
  }

  // Advance past whatever card is showing. `d` is an arrow, if one was pressed.
  function cont(d) {
    if (performance.now() < g.lockUntil) return;
    switch (g.state) {
      case 'ready':
        g.state = 'play';
        emit('start');
        if (d) request(d);
        break;
      case 'title':
        g.levelMods = pickChallenges(g.level);
        startLevel();
        g.state = 'intro';
        g.lockUntil = performance.now() + 250;
        sfx('click');
        break;
      case 'intro':
        g.state = 'play';
        emit('start');
        if (d) request(d);
        break;
      case 'dead':
        startLevel();
        g.state = 'intro';
        g.lockUntil = performance.now() + 250;
        break;
      case 'clear':
        g.level++;
        g.levelMods = g.practice ? [g.practice] : pickChallenges(g.level);
        startLevel();
        g.state = 'intro';
        g.lockUntil = performance.now() + 250;
        sfx('click');
        break;
      case 'over':
        newRun(g.mode);
        break;
      case 'paused':
        g.state = 'play';
        break;
    }
  }

  function togglePause() {
    if (g.state === 'play') { g.state = 'paused'; sfx('click'); }
    else if (g.state === 'paused') g.state = 'play';
  }

  // ── input ─────────────────────────────────────────────────────
  function request(d, synthetic) {
    if (g.state !== 'play') return;
    const last = g.queue.length ? g.queue[g.queue.length - 1] : g.dir;
    const nd = fold('input', { x: d.x, y: d.y }, last, synthetic);
    if (!nd) return;
    if ((nd.x === last.x && nd.y === last.y) || (nd.x === -last.x && nd.y === -last.y)) return;
    if (g.queue.length >= 3) return;
    g.queue.push({ x: nd.x, y: nd.y, at: g.tick + fold('lag', 0) });
  }

  const KEYS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
  };
  function onScreen() {
    const r = canvas.getBoundingClientRect();
    return r.bottom > 40 && r.top < window.innerHeight - 40;
  }
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (g.state !== 'play' && !onScreen()) return;
    const k = KEYS[e.key];
    if (k) {
      e.preventDefault();
      const d = { x: k[0], y: k[1] };
      if (g.state === 'play') request(d); else cont(d);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (g.state === 'play') togglePause(); else cont(null);
    } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      togglePause();
    }
  });

  // Swipes turn as soon as they pass the threshold; a tap continues or pauses.
  let tx = 0, ty = 0, moved = false;
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    tx = e.touches[0].clientX; ty = e.touches[0].clientY; moved = false;
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    const dx = x - tx, dy = y - ty;
    if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
    const d = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
    if (g.state === 'play') request(d);
    else if (g.state === 'ready' || g.state === 'intro') cont(d);
    tx = x; ty = y; moved = true;
  }, { passive: false });
  canvas.addEventListener('touchend', () => {
    if (moved) return;
    if (g.state === 'play') togglePause(); else cont(null);
  });
  canvas.addEventListener('click', () => { if (g.state !== 'play') cont(null); });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && g.state === 'play') g.state = 'paused';
  });

  // ── simulation ────────────────────────────────────────────────
  function wrapPos(p) { p.x = ((p.x % g.W) + g.W) % g.W; p.y = ((p.y % g.H) + g.H) % g.H; }

  // What would kill a head arriving at (x, y)? Returns [category, reason] or null.
  function hitAt(x, y) {
    const r = g.rocks.get(key(x, y));
    if (r) return ['rock', r.reason || ROCK_REASONS[r.kind] || 'you hit a rock'];
    const tailMoves = g.grow === 0;
    const n = g.snake.length - (tailMoves ? 1 : 0);
    for (let i = 0; i < n; i++) {
      if (g.snake[i].x === x && g.snake[i].y === y) return ['self', 'you bit your own tail'];
    }
    const hz = g.hazardHit(x, y);
    if (hz) return ['hazard', hz];
    return null;
  }
  const ROCK_REASONS = {
    lava: 'you fell in the lava', fire: 'you drove into your own light trail',
    wall: 'you walked into a wall', pillar: 'you hit a pillar', rotten: 'you tripped over a rotten snack',
  };

  function step() {
    g.tick++;
    for (const m of g.mods.slice()) {
      if (g.tick >= m.until) {
        g.deactivate(m, true);
        if (m.src !== 'level') g.toast(m.def.name + ' wore off');
      }
    }
    for (const [k, r] of g.rocks) if (g.tick >= r.until) { g.rocks.delete(k); g.puff(r.x, r.y); }
    g.pickups = g.pickups.filter(p => g.tick < p.until);

    run('tick');
    if (g.state !== 'play') return;

    if (g.queue.length && g.queue[0].at <= g.tick) {
      const q = g.queue.shift();
      if (!(q.x === -g.dir.x && q.y === -g.dir.y)) g.dir = { x: q.x, y: q.y };
    }
    g.dir = fold('steer', g.dir);
    const h0 = g.snake[0];
    const head = fold('move', { x: h0.x + g.dir.x, y: h0.y + g.dir.y });

    if (!g.inBounds(head.x, head.y)) {
      if (g.wraps()) wrapPos(head);
      else {
        const r = first('save', 'wall', 'you hit the wall', head);
        if (r === 'pass') wrapPos(head);
        else { if (r !== 'skip') g.die('you hit the wall'); return; }
      }
    }
    const hit = hitAt(head.x, head.y);
    if (hit) {
      const r = first('save', hit[0], hit[1], head);
      if (r === 'skip') return;
      if (r !== 'pass') { g.die(hit[1]); return; }
    }

    g.snake.unshift(head);
    const fi = g.foodAt(head.x, head.y);
    if (fi >= 0) g.eat(fi);
    if (g.grow > 0) { g.grow--; g.lastTail = null; }
    else g.lastTail = g.snake.pop();

    const pi = g.pickupAt(head.x, head.y);
    if (pi >= 0) {
      const p = g.pickups.splice(pi, 1)[0];
      applyPowerup(BYID[p.id], p);
    }

    if (!g.has('timestop')) for (const h of g.hazards) if (h.update) h.update(g);
    if (g.state !== 'play') return;
    const hz = g.hazardHit(g.snake[0].x, g.snake[0].y);
    if (hz) g.hurt(hz, 'hazard');
    if (g.state !== 'play') return;

    run('after');
    if (g.state !== 'play') return;

    if (g.mode === 'challenge' && g.eaten >= g.goal) { levelClear(); return; }
    topUpFood();
    maybeSpawnPickup();
    noticeCloseCalls();
  }

  function noticeCloseCalls() {
    if (g.tick < g.closeAt) return;
    const h = g.snake[0];
    let n = 0;
    for (const d of DIRS) {
      if (d.x === -g.dir.x && d.y === -g.dir.y) continue;
      const x = h.x + d.x, y = h.y + d.y;
      if ((!g.inBounds(x, y) && !g.wraps()) || (g.inBounds(x, y) && g.blockedAt(x, y))) n++;
    }
    if (n >= 2) { g.closeAt = g.tick + 15; emit('close'); }
    const len = g.snake.length;
    if (len >= 15 && len % 10 === 5 && g.lastTail === null) emit('long');
  }

  function maybeSpawnPickup() {
    if (g.mode !== 'challenge' || g.tick < g.nextPickup) return;
    g.nextPickup = g.tick + 40 + g.rand(45);
    if (g.pickups.length >= 2) return;
    const pool = POWERUPS.filter(p => !p.when || p.when(g));
    let total = 0;
    pool.forEach(p => { total += p.weight || 3; });
    let r = Math.random() * total, def = pool[0];
    for (const p of pool) { r -= p.weight || 3; if (r <= 0) { def = p; break; } }
    const c = g.randFree({ minDist: 4 });
    if (c) g.pickups.push({ x: c.x, y: c.y, id: def.id, born: g.tick, until: g.tick + 85 });
  }

  function applyPowerup(def, at) {
    if (!def) return;
    discover(def.id);
    sfx(def.curse ? 'bad' : 'power');
    g.say(def.name, at.x, at.y, def.curse ? '#6c3fb5' : '#5c0000');
    g.burst(at.x, at.y, '#c99a06', 12);
    if (def.use) def.use(g, {});
    if (def.dur) g.activate(def.id, def.dur, def.curse ? 'curse' : 'power');
    emit('pickup', def);
  }

  // ── rendering ─────────────────────────────────────────────────
  function baseStyle() {
    return {
      pal: {
        page: '#f5f0e8', board: '#f5f0e8', check: 'rgba(60,50,30,0.028)', snake: '#1a1a18',
        food: '#9e1b1b', rock: '#8a8a84', ink: '#1a1a18', muted: '#5a5a56', accent: '#5c0000',
        veil: 'rgba(245,240,232,0.93)', eye: '#f5f0e8',
      },
      font: SERIF, filter: '', headScale: 1, eyes: 'dot', hat: null, mustache: false,
      monocle: false, train: false, legs: false, hideBody: false, snakeAlpha: 1, rainbow: false,
      snakeColor: null, foodVisible: true, foodSize: 1, emojiFood: false, foodEyes: false, foodBlink: null,
    };
  }

  // Offscreen layers for darkness masks and translucent snakes.
  const layerA = document.createElement('canvas');
  const layerB = document.createElement('canvas');
  function prepLayer(c) {
    const bw = g.W * g.cell, bh = g.H * g.cell;
    const w = Math.ceil(bw * g.dpr), h = Math.ceil(bh * g.dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d');
    x.setTransform(g.dpr, 0, 0, g.dpr, -g.ox * g.dpr, -g.oy * g.dpr);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    x.clearRect(g.ox, g.oy, bw, bh);
    return x;
  }
  function blitLayer(c, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(c, 0, 0, c.width, c.height, g.ox, g.oy, g.W * g.cell, g.H * g.cell);
    ctx.restore();
  }

  // Cover the board in `color`, leaving soft holes ({x, y, r} in pixels).
  g.darkness = (c2d, holes, color) => {
    const x = prepLayer(layerA);
    x.fillStyle = color;
    x.fillRect(g.ox, g.oy, g.W * g.cell, g.H * g.cell);
    x.globalCompositeOperation = 'destination-out';
    for (const o of holes) {
      const gr = x.createRadialGradient(o.x, o.y, o.r * (o.soft == null ? 0.45 : o.soft), o.x, o.y, o.r);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr;
      x.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
    }
    x.globalCompositeOperation = 'source-over';
    c2d.drawImage(layerA, 0, 0, layerA.width, layerA.height, g.ox, g.oy, g.W * g.cell, g.H * g.cell);
  };

  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.max(0, r), 0, Math.PI * 2); c.fill(); }
  function rrect(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
  }
  const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
  // Close enough to draw as one body (hiccups and gravity leave small gaps; wrapping doesn't).
  const joined = (a, b) => { const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y); return dx + dy > 0 && dx <= 2 && dy <= 2; };

  // Draw any snake-shaped thing. Used for the player, the rival and the twin.
  g.drawSnakeBody = (c, body, dir, o) => {
    const n = body.length;
    if (!n) return;
    const cs = g.cell, R = cs * 0.42;
    const colorAt = o.colorAt || (() => o.color);
    const rad = i => { const e = n - 1 - i; return e < 3 ? R * (0.55 + 0.15 * e) : R; };
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (!o.hideBody) {
      for (let i = n - 1; i >= 1; i--) {
        const p = body[i], q = body[i - 1];
        const col = colorAt(i);
        const x = g.px(p.x), y = g.py(p.y);
        if (o.train) { drawCar(c, p, q, i, col); continue; }
        c.fillStyle = col; c.strokeStyle = col;
        if (joined(p, q)) {
          c.lineWidth = rad(i) * 2;
          c.beginPath(); c.moveTo(x, y); c.lineTo(g.px(q.x), g.py(q.y)); c.stroke();
        } else circle(c, x, y, rad(i));
        if (o.legs) drawLegs(c, p, q, i, col);
      }
    }
    const h = body[0], hx = g.px(h.x), hy = g.py(h.y), hs = o.headScale || 1;
    if (o.train) drawLoco(c, hx, hy, dir);
    else {
      c.fillStyle = colorAt(0);
      circle(c, hx, hy, R * 1.04 * hs);
      // the occasional tongue flick
      if (!o.noTongue && (g.t + (o.seed || 0)) % 2300 < 160) {
        c.strokeStyle = '#c0392b'; c.lineWidth = Math.max(1, cs * 0.07);
        const tx0 = hx + dir.x * R * hs, ty0 = hy + dir.y * R * hs;
        const tx1 = tx0 + dir.x * cs * 0.35, ty1 = ty0 + dir.y * cs * 0.35;
        c.beginPath(); c.moveTo(tx0, ty0); c.lineTo(tx1, ty1);
        c.lineTo(tx1 + (dir.x - dir.y) * cs * 0.12, ty1 + (dir.y + dir.x) * cs * 0.12);
        c.moveTo(tx1, ty1); c.lineTo(tx1 + (dir.x + dir.y) * cs * 0.12, ty1 + (dir.y - dir.x) * cs * 0.12);
        c.stroke();
      }
    }
    drawEyes(c, hx, hy, dir, R * hs, o);
    if (o.hat) drawHat(c, hx, hy - R * hs * 0.9, R * hs, o.hat);
    if (o.mustache) drawMustache(c, hx + dir.x * R * hs * 0.5, hy + R * hs * 0.35 + dir.y * R * hs * 0.3, R * hs);
  };

  function drawEyes(c, hx, hy, d, R, o) {
    const p = { x: -d.y, y: d.x };
    const ex = d.x * R * 0.35, ey = d.y * R * 0.35;
    for (const side of [-1, 1]) {
      const x = hx + ex + p.x * R * 0.45 * side, y = hy + ey + p.y * R * 0.45 * side;
      if (o.eyes === 'googly') {
        c.fillStyle = '#fff'; circle(c, x, y, R * 0.42);
        c.strokeStyle = '#1a1a18'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, R * 0.42, 0, Math.PI * 2); c.stroke();
        const a = g.t / 90 + side * 1.7, j = R * 0.18;
        c.fillStyle = '#111'; circle(c, x + Math.cos(a) * j, y + Math.abs(Math.sin(a)) * j, R * 0.2);
      } else {
        c.fillStyle = o.eyeColor || '#f5f0e8'; circle(c, x, y, R * 0.26);
        c.fillStyle = '#111'; circle(c, x + d.x * R * 0.08, y + d.y * R * 0.08, R * 0.13);
        if (o.angry) {
          c.strokeStyle = '#111'; c.lineWidth = Math.max(1, R * 0.12);
          c.beginPath();
          c.moveTo(x - R * 0.3, y - R * 0.35 - side * R * 0.08);
          c.lineTo(x + R * 0.3, y - R * 0.35 + side * R * 0.08);
          c.stroke();
        }
        if (o.monocle && side === 1) {
          c.strokeStyle = '#c99a06'; c.lineWidth = Math.max(1, R * 0.1);
          c.beginPath(); c.arc(x, y, R * 0.36, 0, Math.PI * 2); c.stroke();
          c.beginPath(); c.moveTo(x, y + R * 0.36); c.lineTo(x + R * 0.2, y + R * 1.1); c.stroke();
        }
      }
    }
  }
  function drawHat(c, x, y, R, kind) {
    if (kind === 'top') {
      c.fillStyle = '#111';
      c.fillRect(x - R * 0.95, y - R * 0.12, R * 1.9, R * 0.22);
      c.fillRect(x - R * 0.6, y - R * 1.15, R * 1.2, R * 1.05);
      c.fillStyle = '#7a1f1f';
      c.fillRect(x - R * 0.6, y - R * 0.35, R * 1.2, R * 0.2);
    } else if (kind === 'party') {
      c.fillStyle = '#2f5d9b';
      c.beginPath(); c.moveTo(x - R * 0.6, y + R * 0.05); c.lineTo(x + R * 0.6, y + R * 0.05); c.lineTo(x, y - R * 1.5); c.closePath(); c.fill();
      c.fillStyle = '#c99a06';
      circle(c, x - R * 0.2, y - R * 0.35, R * 0.12); circle(c, x + R * 0.18, y - R * 0.75, R * 0.1);
      c.fillStyle = '#b8322a'; circle(c, x, y - R * 1.5, R * 0.2);
    } else if (kind === 'crown') {
      c.fillStyle = '#d4a20b';
      c.beginPath();
      c.moveTo(x - R * 0.75, y + R * 0.05); c.lineTo(x - R * 0.75, y - R * 0.7); c.lineTo(x - R * 0.38, y - R * 0.3);
      c.lineTo(x, y - R * 0.9); c.lineTo(x + R * 0.38, y - R * 0.3); c.lineTo(x + R * 0.75, y - R * 0.7);
      c.lineTo(x + R * 0.75, y + R * 0.05); c.closePath(); c.fill();
      c.fillStyle = '#b8322a'; circle(c, x, y - R * 0.25, R * 0.12);
    }
  }
  function drawMustache(c, x, y, R) {
    c.fillStyle = '#3b2a1a';
    for (const s of [-1, 1]) {
      c.beginPath();
      c.ellipse(x + s * R * 0.32, y, R * 0.36, R * 0.14, s * 0.35, 0, Math.PI * 2);
      c.fill();
      circle(c, x + s * R * 0.68, y - R * 0.12, R * 0.09);
    }
  }
  function drawLegs(c, p, q, i, col) {
    const ax = q.x - p.x, ay = q.y - p.y;
    const px = -ay, py = ax, cs = g.cell;
    const x = g.px(p.x), y = g.py(p.y);
    const swing = Math.sin(g.tick * 1.3 + i) * cs * 0.18;
    c.strokeStyle = col; c.lineWidth = Math.max(1, cs * 0.08);
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + px * s * cs * 0.62 + ax * swing * s, y + py * s * cs * 0.62 + ay * swing * s);
      c.stroke();
    }
  }
  function drawCar(c, p, q, i, col) {
    const cs = g.cell, x = g.ox + p.x * cs, y = g.oy + p.y * cs;
    if (adjacent(p, q)) {
      c.strokeStyle = '#444'; c.lineWidth = Math.max(1, cs * 0.08);
      c.beginPath(); c.moveTo(g.px(p.x), g.py(p.y)); c.lineTo(g.px(q.x), g.py(q.y)); c.stroke();
    }
    c.fillStyle = i % 2 ? '#7a1f1f' : '#2f5d9b';
    rrect(c, x + cs * 0.1, y + cs * 0.12, cs * 0.8, cs * 0.62, cs * 0.12); c.fill();
    c.fillStyle = '#f5e7b5';
    c.fillRect(x + cs * 0.22, y + cs * 0.22, cs * 0.22, cs * 0.18);
    c.fillRect(x + cs * 0.56, y + cs * 0.22, cs * 0.22, cs * 0.18);
    c.fillStyle = '#222';
    circle(c, x + cs * 0.3, y + cs * 0.8, cs * 0.11); circle(c, x + cs * 0.7, y + cs * 0.8, cs * 0.11);
  }
  function drawLoco(c, hx, hy, d) {
    const cs = g.cell;
    c.fillStyle = '#1f1f1d';
    rrect(c, hx - cs * 0.45, hy - cs * 0.32, cs * 0.9, cs * 0.66, cs * 0.14); c.fill();
    c.fillRect(hx - cs * 0.12, hy - cs * 0.62, cs * 0.24, cs * 0.32);
    c.fillStyle = '#b8322a';
    c.fillRect(hx - cs * 0.45, hy + cs * 0.06, cs * 0.9, cs * 0.1);
    c.fillStyle = '#ffd34d';
    circle(c, hx + d.x * cs * 0.4, hy + d.y * cs * 0.3, cs * 0.12);
    c.fillStyle = '#222';
    circle(c, hx - cs * 0.25, hy + cs * 0.4, cs * 0.12); circle(c, hx + cs * 0.25, hy + cs * 0.4, cs * 0.12);
  }

  function drawRocks(st) {
    const cs = g.cell;
    for (const r of g.rocks.values()) {
      const x = g.ox + r.x * cs, y = g.oy + r.y * cs;
      const left = r.until - g.tick;
      ctx.save();
      if (left < 15 && Math.floor(g.t / 120) % 2) ctx.globalAlpha = 0.45;
      switch (r.kind) {
        case 'lava': {
          ctx.fillStyle = '#b8321b'; ctx.fillRect(x, y, cs, cs);
          ctx.fillStyle = '#f08a24';
          const w = Math.sin(g.t / 260 + r.x * 1.7 + r.y * 2.3);
          circle(ctx, x + cs * (0.35 + w * 0.1), y + cs * 0.45, cs * 0.2);
          circle(ctx, x + cs * 0.7, y + cs * (0.7 - w * 0.1), cs * 0.13);
          break;
        }
        case 'fire': {
          ctx.globalAlpha *= Math.max(0.25, Math.min(1, left / 14));
          const f = Math.sin(g.t / 60 + r.x * 3 + r.y) * cs * 0.08;
          ctx.fillStyle = '#e8590c';
          ctx.beginPath();
          ctx.moveTo(x + cs * 0.2, y + cs * 0.9); ctx.quadraticCurveTo(x + cs * 0.1, y + cs * 0.4, x + cs * 0.5 + f, y + cs * 0.08);
          ctx.quadraticCurveTo(x + cs * 0.9, y + cs * 0.4, x + cs * 0.8, y + cs * 0.9); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ffc94d';
          circle(ctx, x + cs * 0.5, y + cs * 0.66, cs * 0.17);
          break;
        }
        case 'wall':
          ctx.fillStyle = '#6d6a63'; ctx.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
          ctx.fillStyle = '#e0b100'; ctx.fillRect(x + 0.5, y + 0.5, cs - 1, cs * 0.18);
          break;
        case 'pillar':
          ctx.fillStyle = '#a19c90'; ctx.fillRect(x + cs * 0.1, y + cs * 0.1, cs * 0.8, cs * 0.8);
          ctx.strokeStyle = '#7d786d'; ctx.lineWidth = 1; ctx.strokeRect(x + cs * 0.1, y + cs * 0.1, cs * 0.8, cs * 0.8);
          break;
        case 'partition':
          ctx.fillStyle = '#9aa3ad'; ctx.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
          break;
        case 'rotten':
          ctx.fillStyle = '#6b6b3a'; rrect(ctx, x + cs * 0.12, y + cs * 0.12, cs * 0.76, cs * 0.76, cs * 0.25); ctx.fill();
          break;
        case 'asteroid':
          ctx.fillStyle = st.pal.rock; rrect(ctx, x + cs * 0.08, y + cs * 0.08, cs * 0.84, cs * 0.84, cs * 0.3); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          circle(ctx, x + cs * 0.38, y + cs * 0.4, cs * 0.12); circle(ctx, x + cs * 0.66, y + cs * 0.64, cs * 0.08);
          break;
        default:
          ctx.fillStyle = st.pal.rock; rrect(ctx, x + cs * 0.08, y + cs * 0.08, cs * 0.84, cs * 0.84, cs * 0.18); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawFoods(st) {
    const cs = g.cell;
    for (const f of g.foods) {
      if (st.foodVisible === false) continue;
      if (st.foodBlink && st.foodBlink(f) && Math.floor(g.t / 90) % 2) continue;
      const x = g.px(f.x), y = g.py(f.y);
      const bob = 1 + 0.07 * Math.sin(g.t / 230 + f.id);
      const r = cs * 0.34 * st.foodSize * (f.scale || 1) * bob;
      ctx.save();
      if (f.gold) { ctx.shadowColor = 'rgba(255,196,0,0.9)'; ctx.shadowBlur = 12; }
      if ((st.emojiFood || f.emoji) && !f.label) {
        ctx.font = Math.round(r * 2.5) + 'px ' + EMOJI;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(f.emoji || FRUITS[f.id % FRUITS.length], x, y + r * 0.1);
      } else {
        ctx.fillStyle = f.color || st.pal.food;
        circle(ctx, x, y, r);
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        circle(ctx, x - r * 0.35, y - r * 0.35, r * 0.28);
        if (!f.label && !f.bad && cs >= 14 && st.foodSize >= 0.5) {
          ctx.strokeStyle = '#5b4126'; ctx.lineWidth = Math.max(1, cs * 0.06);
          ctx.beginPath(); ctx.moveTo(x, y - r * 0.8); ctx.lineTo(x + r * 0.15, y - r * 1.25); ctx.stroke();
          ctx.fillStyle = '#4a7a2c';
          ctx.beginPath(); ctx.ellipse(x + r * 0.45, y - r * 1.1, r * 0.35, r * 0.17, -0.5, 0, Math.PI * 2); ctx.fill();
        }
        if (f.bad) {
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          circle(ctx, x - r * 0.3, y - r * 0.1, r * 0.15); circle(ctx, x + r * 0.3, y - r * 0.1, r * 0.15);
          ctx.fillRect(x - r * 0.3, y + r * 0.3, r * 0.6, r * 0.12);
        }
      }
      if (f.label) {
        ctx.fillStyle = '#fff';
        ctx.font = '600 ' + Math.round(cs * 0.55) + 'px ' + st.font;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(f.label, x, y + 1);
      }
      if (st.foodEyes) {
        for (const s of [-1, 1]) {
          ctx.fillStyle = '#fff'; circle(ctx, x + s * r * 0.4, y - r * 0.15, r * 0.32);
          ctx.fillStyle = '#111';
          circle(ctx, x + s * r * 0.4 + Math.cos(g.t / 80 + s) * r * 0.12, y - r * 0.1 + Math.abs(Math.sin(g.t / 70)) * r * 0.1, r * 0.15);
        }
      }
      ctx.restore();
    }
  }

  function drawPickups() {
    const cs = g.cell;
    for (const p of g.pickups) {
      const left = p.until - g.tick;
      if (left < 20 && Math.floor(g.t / 130) % 2) continue;
      const def = BYID[p.id];
      const x = g.px(p.x), y = g.py(p.y) + Math.sin(g.t / 300 + p.x) * cs * 0.06;
      const s = cs * 0.92 * (1 + 0.05 * Math.sin(g.t / 180));
      ctx.save();
      ctx.shadowColor = 'rgba(201,154,6,0.6)'; ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(255,253,245,0.95)';
      rrect(ctx, x - s / 2, y - s / 2, s, s, s * 0.25); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#c99a06'; ctx.lineWidth = 1.2;
      rrect(ctx, x - s / 2, y - s / 2, s, s, s * 0.25); ctx.stroke();
      ctx.font = Math.round(s * 0.7) + 'px ' + EMOJI;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def ? def.icon : '?', x, y + s * 0.04);
      ctx.restore();
    }
  }

  function drawParticles(screen) {
    for (const p of g.particles) {
      if (!!p.screen !== screen) continue;
      const a = Math.max(0, p.life / p.max);
      ctx.save();
      ctx.globalAlpha = a;
      if (p.kind === 'text') {
        ctx.font = '600 ' + p.size + 'px ' + g.style.font;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(245,240,232,0.9)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
      } else if (p.kind === 'puff') {
        ctx.fillStyle = p.color; circle(ctx, p.x, p.y, p.size * (1.6 - a * 0.6));
      } else if (p.kind === 'confetti') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        ctx.fillStyle = p.color; circle(ctx, p.x, p.y, p.size);
      }
      ctx.restore();
    }
  }
  function updateParticles(dt) {
    for (const p of g.particles) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'confetti') { p.vy += 260 * dt; p.vx *= 0.99; p.rot += p.vr * dt; }
      if (p.kind === 'dot') { p.vx *= 0.9; p.vy *= 0.9; }
    }
    g.particles = g.particles.filter(p => p.life > 0);
    if (g.particles.length > 600) g.particles.splice(0, g.particles.length - 600);
  }

  function drawToasts(st) {
    g.toasts = g.toasts.filter(t => g.t < t.until);
    g.toasts.forEach((t, i) => {
      const age = g.t - t.born, left = t.until - g.t;
      const a = Math.min(1, age / 150, left / 300);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = '500 15px ' + st.font;
      const w = ctx.measureText(t.text).width + 24;
      const y = 14 + i * 32 - (1 - Math.min(1, age / 200)) * 8;
      ctx.fillStyle = 'rgba(26,26,24,0.88)';
      rrect(ctx, PX / 2 - w / 2, y, w, 26, 13); ctx.fill();
      ctx.fillStyle = '#f5f0e8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.text, PX / 2, y + 13.5);
      ctx.restore();
    });
  }

  // ── cards ─────────────────────────────────────────────────────
  function wrapText(text, maxW) {
    const words = text.split(' '), lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  // blocks: [{ text, size, color, style ('italic'), weight, gap }]
  function card(blocks, st) {
    ctx.save();
    ctx.fillStyle = st.pal.veil;
    ctx.fillRect(0, 0, PX, PX);
    let scale = 1, laid;
    for (let attempt = 0; attempt < 6; attempt++) {
      laid = [];
      let h = 0;
      for (const b of blocks) {
        const size = Math.round(b.size * scale);
        ctx.font = (b.style || '') + ' ' + (b.weight || 400) + ' ' + size + 'px ' + st.font;
        const lines = wrapText(T(b.text), PX - 56);
        const lh = size * 1.25;
        laid.push({ b, size, lines, lh, gap: (b.gap || 0) * scale });
        h += (b.gap || 0) * scale + lines.length * lh;
      }
      if (h <= PX - 50) { laid.h = h; break; }
      laid.h = h;
      scale *= 0.88;
    }
    let y = (PX - laid.h) / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const l of laid) {
      y += l.gap;
      ctx.font = (l.b.style || '') + ' ' + (l.b.weight || 400) + ' ' + l.size + 'px ' + st.font;
      ctx.fillStyle = l.b.color || st.pal.ink;
      for (const line of l.lines) { ctx.fillText(line, PX / 2, y); y += l.lh; }
    }
    ctx.restore();
  }

  const PROMPT = matchMedia('(hover: none)').matches ? 'tap or swipe' : 'press space or an arrow key';

  function drawCard(st) {
    const P = st.pal, s = g.state;
    if (s === 'ready') {
      ctx.save();
      ctx.font = 'italic 17px ' + st.font;
      const text = T(matchMedia('(hover: none)').matches ? 'swipe to start' : 'press an arrow key to start');
      const w = ctx.measureText(text).width + 28;
      ctx.fillStyle = P.veil; rrect(ctx, PX / 2 - w / 2, PX * 0.7, w, 32, 16); ctx.fill();
      ctx.fillStyle = P.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, PX / 2, PX * 0.7 + 16);
      ctx.restore();
      return;
    }
    if (s === 'title') {
      const best = store.get('bestLevel', 0);
      card([
        { text: 'challenge mode', size: 34, weight: 500 },
        { text: 'Every level brings new rules, each more absurd than the last. Grab power-ups, avoid suspicious mushrooms, and eat enough snacks to move on.', size: 17, color: P.muted, style: 'italic', gap: 12 },
        { text: 'You have three lives.', size: 17, color: P.muted, style: 'italic', gap: 6 },
        best ? { text: 'best: level ' + N(best), size: 16, color: P.accent, gap: 16 } : null,
        { text: PROMPT + ' to begin', size: 16, color: P.ink, gap: 20 },
      ].filter(Boolean), st);
    } else if (s === 'intro') {
      const blocks = [{ text: g.practice ? 'practice' : 'level ' + N(g.level), size: 30, weight: 500 }];
      g.levelMods.forEach((id, i) => {
        const d = BYID[id];
        blocks.push({ text: d.name, size: 21, weight: 600, color: P.accent, gap: i ? 12 : 16 });
        blocks.push({ text: d.desc, size: 16, color: P.muted, style: 'italic', gap: 2 });
      });
      blocks.push({ text: 'eat ' + N(g.goal) + ' snack' + (g.goal === 1 ? '' : 's'), size: 17, gap: 18 });
      blocks.push({ text: PROMPT + ' to go', size: 15, color: P.muted, gap: 6 });
      card(blocks, st);
    } else if (s === 'dead') {
      card([
        { text: 'ouch.', size: 34, weight: 500 },
        { text: g.deathReason, size: 18, color: P.muted, style: 'italic', gap: 8 },
        g.practice ? null : { text: hearts(), size: 22, color: P.accent, gap: 14 },
        { text: PROMPT + ' to try ' + (g.practice ? 'again' : 'level ' + N(g.level) + ' again'), size: 16, gap: 16 },
      ].filter(Boolean), st);
    } else if (s === 'clear') {
      const blocks = [
        { text: (g.practice ? 'cleared' : 'level ' + N(g.level) + ' cleared'), size: 32, weight: 500 },
        { text: 'survived: ' + g.levelMods.map(id => BYID[id].name).join(', '), size: 16, color: P.muted, style: 'italic', gap: 10 },
        { text: '+' + N(50 * g.level) + ' bonus', size: 17, color: P.accent, gap: 10 },
        { text: PROMPT + (g.practice ? ' to go again' : ' for level ' + N(g.level + 1)), size: 16, gap: 16 },
      ];
      card(blocks, st);
    } else if (s === 'over') {
      if (g.mode === 'classic') {
        card([
          { text: 'game over', size: 34, weight: 500 },
          { text: g.deathReason, size: 17, color: P.muted, style: 'italic', gap: 8 },
          { text: 'score ' + N(g.score) + '  ·  best ' + N(store.get('bestScore', 0)), size: 18, gap: 14 },
          { text: PROMPT + ' to play again', size: 16, color: P.muted, gap: 14 },
        ], st);
      } else {
        card([
          { text: 'game over', size: 34, weight: 500 },
          { text: g.deathReason, size: 17, color: P.muted, style: 'italic', gap: 8 },
          { text: 'you reached level ' + N(g.level) + '  ·  score ' + N(g.score), size: 18, gap: 14 },
          { text: 'best: level ' + N(Math.max(g.level, store.get('bestLevel', 0))), size: 16, color: P.accent, gap: 6 },
          { text: PROMPT + ' to start a new run', size: 16, color: P.muted, gap: 14 },
        ], st);
      }
    } else if (s === 'paused') {
      card([
        { text: 'paused', size: 32, weight: 500 },
        { text: matchMedia('(hover: none)').matches ? 'tap to resume' : 'press space or P to resume', size: 16, color: P.muted, gap: 10 },
      ], st);
    }
  }

  // ── text & numbers (mods can mangle both) ─────────────────────
  function T(str) { return fold('text', String(str)); }
  function N(n) { const v = fold('num', n); return typeof v === 'number' ? v.toLocaleString() : v; }
  g.T = T;
  function hearts() { return g.lives <= 6 ? '♥'.repeat(g.lives) + '♡'.repeat(Math.max(0, 3 - g.lives)) : '♥ ×' + g.lives; }

  // ── DOM bits ──────────────────────────────────────────────────
  let lastHud = '', lastFx = '', lastFont = '', lastFilter = '';
  function hud(st) {
    let text;
    if (g.mode === 'classic') {
      text = 'score ' + N(g.score) + '  ·  best ' + N(Math.max(g.score, store.get('bestScore', 0)));
    } else if (g.state === 'title') {
      text = 'challenge mode';
    } else {
      text = [
        g.practice ? 'practice' : 'level ' + N(g.level),
        N(Math.min(g.eaten, g.goal)) + '/' + N(g.goal) + ' eaten',
        g.practice ? null : hearts(),
        'score ' + N(g.score),
      ].filter(Boolean).join('  ·  ');
    }
    text = T(text);
    if (text !== lastHud) { hudEl.textContent = text; lastHud = text; }
    const font = st.font === SERIF ? '' : st.font;
    if (font !== lastFont) { hudEl.style.fontFamily = font; tickerEl.style.fontFamily = font; lastFont = font; }
  }
  function effects() {
    if (g.mode === 'classic' || g.state === 'title') {
      if (lastFx) { fxEl.textContent = ''; lastFx = ''; }
      return;
    }
    const sig = g.mods.map(m => m.def.id + (isFinite(m.until) ? ':' + Math.ceil((m.until - g.tick) / 3) : '')).join('|');
    if (sig === lastFx) return;
    lastFx = sig;
    fxEl.textContent = '';
    for (const m of g.mods) {
      const chip = document.createElement('span');
      chip.className = 'snake-chip ' + m.src;
      chip.title = m.def.desc;
      chip.textContent = (m.def.icon ? m.def.icon + ' ' : '') + T(m.def.name);
      if (isFinite(m.until) && m.dur) {
        const bar = document.createElement('i');
        bar.style.width = Math.max(0, Math.min(100, (m.until - g.tick) / m.dur * 100)) + '%';
        chip.appendChild(bar);
      }
      fxEl.appendChild(chip);
    }
  }

  // ── field guide ───────────────────────────────────────────────
  function discover(id) {
    const seen = store.get('seen', []);
    if (seen.includes(id)) return;
    seen.push(id);
    store.set('seen', seen);
    renderGuide();
  }
  function renderGuide() {
    if (!guideEl) return;
    const seen = new Set(store.get('seen', []));
    const count = MODS.filter(m => seen.has(m.id)).length;
    const head = guideEl.querySelector('[data-guide-count]');
    if (head) head.textContent = count + ' of ' + MODS.length + ' discovered';
    const fill = (sel, list, tryable) => {
      const ul = guideEl.querySelector(sel);
      if (!ul) return;
      ul.textContent = '';
      for (const m of list) {
        const li = document.createElement('li');
        if (seen.has(m.id)) {
          const name = document.createElement('span');
          name.className = 'snake-guide-name';
          name.textContent = (m.icon ? m.icon + ' ' : '') + m.name;
          const desc = document.createElement('span');
          desc.className = 'snake-guide-desc';
          desc.textContent = m.desc;
          li.append(name, desc);
          if (tryable) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'snake-try';
            b.dataset.try = m.id;
            b.textContent = 'try';
            li.append(b);
          }
        } else {
          li.className = 'undiscovered';
          li.textContent = '???';
        }
        ul.append(li);
      }
    };
    fill('[data-guide="challenge"]', CHALLENGES, true);
    fill('[data-guide="powerup"]', POWERUPS, false);
  }
  if (guideEl) {
    guideEl.addEventListener('click', e => {
      const b = e.target.closest('[data-try]');
      if (!b) return;
      newRun('challenge', b.dataset.try);
      setHash('challenge');
      canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // ── controls outside the canvas ───────────────────────────────
  function setHash(mode) {
    try { history.replaceState(null, '', mode === 'challenge' ? '#challenge' : location.pathname); } catch (e) { /* ignore */ }
  }
  modeBtns.forEach(b => b.addEventListener('click', () => {
    b.blur();
    newRun(b.dataset.snakeMode);
    setHash(b.dataset.snakeMode);
  }));
  function syncSound() { if (soundBtn) soundBtn.textContent = 'sound: ' + (soundOn ? 'on' : 'off'); }
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      soundBtn.blur();
      soundOn = !soundOn;
      store.set('sound', soundOn);
      syncSound();
      sfx('click');
    });
  }

  // ── main loop ─────────────────────────────────────────────────
  function resize() {
    const d = Math.min(window.devicePixelRatio || 1, 3);
    if (d !== g.dpr || canvas.width !== PX * d) {
      g.dpr = d;
      canvas.width = PX * d;
      canvas.height = PX * d;
    }
  }

  function render() {
    const st = g.style = baseStyle();
    run('style', st);
    const P = st.pal;
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = P.page;
    ctx.fillRect(0, 0, PX, PX);

    ctx.save();
    if (g.shake > 0.2) ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
    run('view', ctx);
    ctx.fillStyle = P.board;
    ctx.fillRect(g.ox, g.oy, g.W * g.cell, g.H * g.cell);
    ctx.fillStyle = P.check;
    for (let y = 0; y < g.H; y++) {
      for (let x = (y % 2); x < g.W; x += 2) ctx.fillRect(g.ox + x * g.cell, g.oy + y * g.cell, g.cell, g.cell);
    }
    if (g.W !== g.H) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
      ctx.strokeRect(g.ox - 0.5, g.oy - 0.5, g.W * g.cell + 1, g.H * g.cell + 1);
    }
    run('under', ctx);
    drawRocks(st);
    for (const h of g.hazards) if (h.draw && h.layer !== 'over') h.draw(ctx, g, st);
    drawFoods(st);
    drawPickups();

    const look = {
      color: st.snakeColor || P.snake, headScale: st.headScale, eyes: st.eyes, hat: st.hat,
      mustache: st.mustache, monocle: st.monocle, train: st.train, legs: st.legs, hideBody: st.hideBody,
      eyeColor: P.eye,
      colorAt: st.rainbow ? i => 'hsl(' + ((i * 22 + g.t / 6) % 360) + ',70%,45%)' : null,
    };
    if (g.snake.length) {
      if (st.snakeAlpha < 1) {
        const lc = prepLayer(layerB);
        g.drawSnakeBody(lc, g.snake, g.dir, look);
        blitLayer(layerB, st.snakeAlpha);
      } else {
        g.drawSnakeBody(ctx, g.snake, g.dir, look);
      }
    }
    for (const h of g.hazards) if (h.draw && h.layer === 'over') h.draw(ctx, g, st);
    run('draw', ctx);
    drawParticles(false);
    ctx.restore();

    run('overlay', ctx);
    if (g.flash > 0.01) {
      ctx.fillStyle = 'rgba(184,50,42,' + (g.flash * 0.3) + ')';
      ctx.fillRect(0, 0, PX, PX);
    }
    drawToasts(st);
    drawCard(st);
    drawParticles(true);

    const filter = st.filter.trim();
    if (filter !== lastFilter) { canvas.style.filter = filter; lastFilter = filter; }
    hud(st);
    effects();
  }

  function speed() {
    const base = g.mode === 'classic' ? 110 : 122 - Math.min(g.level - 1, 10) * 2.5;
    return Math.max(38, Math.min(600, fold('speed', base)));
  }

  let acc = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min(now - last, 250);
    last = now;
    g.t = now;
    g.dt = dt / 1000;
    resize();
    if (g.state === 'play') {
      if (first('frozen')) acc = 0;
      else {
        acc += dt;
        let ms = speed(), guard = 0;
        while (acc >= ms && g.state === 'play' && guard++ < 5) { acc -= ms; step(); ms = speed(); }
        if (guard >= 5) acc = 0;
      }
    } else acc = 0;
    g.shake *= Math.pow(0.002, g.dt);
    g.flash *= Math.pow(0.02, g.dt);
    updateParticles(g.dt);
    try { render(); } catch (e) { console.error(e); }
    requestAnimationFrame(frame);
  }

  // Test hooks for driving the game without a person attached.
  g._step = step;
  g._render = render;
  g._newRun = newRun;
  g._cont = cont;
  g._request = request;
  g._levelClear = levelClear;
  g._pickChallenges = pickChallenges;
  g._applyPowerup = applyPowerup;
  g.MODS = MODS;
  g.BYID = BYID;

  syncSound();
  renderGuide();
  newRun(location.hash === '#challenge' ? 'challenge' : 'classic');
  resize();
  requestAnimationFrame(frame);
})();
