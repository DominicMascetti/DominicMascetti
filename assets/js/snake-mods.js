/* Challenges and power-ups for snake.js.
 *
 * Every entry is a "mod". Common fields:
 *   id, kind ('challenge' | 'powerup'), name, desc
 *   d       difficulty (0 = harmless), used to budget each level
 *   group   at most one mod per group in a level
 *   not     ids this can't be combined with
 *   temp    false if it can't be switched on mid-level (board size etc.)
 *   icon, weight, dur, curse, when(g)   power-ups only
 * Hooks (all optional), each called with (g, s, ...) where s is per-activation state:
 *   setup cleanup tick after   speed(ms) input(dir, last) lag(n) steer(dir) move(head)
 *   save(cat, why, head) -> 'pass' | 'skip'   eat(food, res)   newFood(food)
 *   foodCount(n) place(x, y) goal(n) size({W, H})   style(st) view(ctx) under(ctx)
 *   draw(ctx) overlay(ctx)   text(str) num(n)   event(name, data)   frozen()   use (power-ups) */
(function () {
  'use strict';
  const M = (window.SnakeMods = []);
  const C = 200; // canvas centre (the canvas is 400 logical px square)

  const challenge = o => M.push(Object.assign({ kind: 'challenge', d: 1 }, o));
  const powerup = o => M.push(Object.assign({ kind: 'powerup', d: 0, weight: 4 }, o));

  const rot = (d, cw) => (cw ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x });
  const same = (a, b) => a.x === b.x && a.y === b.y;
  const perp = (a, b) => a.x * b.x + a.y * b.y === 0;
  const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, Math.max(0, r), 0, Math.PI * 2); c.fill(); };
  const around = (c, fn) => { c.translate(C, C); fn(); c.translate(-C, -C); };
  const ease = k => k * k * (3 - 2 * k);

  // Fire once every min..max ticks.
  function every(g, s, name, min, max) {
    if (s[name] == null) s[name] = g.tick + min + g.rand(max - min + 1);
    if (g.tick >= s[name]) { s[name] = g.tick + min + g.rand(max - min + 1); return true; }
    return false;
  }
  // Same thing but in milliseconds, for purely visual effects.
  function everyMs(g, s, name, min, max) {
    if (s[name] == null) s[name] = g.t + min + Math.random() * (max - min);
    if (g.t >= s[name]) { s[name] = g.t + min + Math.random() * (max - min); return true; }
    return false;
  }
  function wrapLines(c, text, maxW) {
    const words = text.split(' '), lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }
  function mix(a, b, k) {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const A = p(a), B = p(b);
    return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',') + ')';
  }
  const randomTurn = (g, d) => {
    const opts = [rot(d, true), rot(d, false)].filter(o => g.safe(o));
    return opts.length ? g.pick(opts) : null;
  };

  // ═════════════════════════ CONTROLS ═════════════════════════

  challenge({
    id: 'mirror', group: 'controls', d: 1, name: 'Mirror World',
    desc: 'Left and right have swapped places.',
    input: (g, s, d) => ({ x: -d.x, y: d.y }),
  });
  challenge({
    id: 'upside', group: 'controls', d: 1, name: 'Upside-Down Keyboard',
    desc: 'Up and down have swapped places.',
    input: (g, s, d) => ({ x: d.x, y: -d.y }),
  });
  challenge({
    id: 'opposite', group: 'controls', d: 2, name: 'Opposite Day',
    desc: 'Every key does the exact opposite.',
    input: (g, s, d) => ({ x: -d.x, y: -d.y }),
  });
  challenge({
    id: 'sideways', group: 'controls', d: 2, name: 'Sideways Keyboard',
    desc: 'Someone rotated your keyboard a quarter turn.',
    input: (g, s, d) => rot(d, true),
  });
  challenge({
    id: 'onebutton', group: 'controls', d: 2, name: 'One-Button Controller',
    desc: 'Every key turns you clockwise. That’s the whole controller.',
    input: (g, s, d, last) => rot(last, true),
  });
  challenge({
    id: 'zoolander', group: 'controls', d: 1, name: 'Zoolander',
    desc: 'You are not an ambi-turner. You cannot turn left.',
    input(g, s, d, last) {
      if (same(d, rot(last, false))) {
        if (g.t > (s.quiet || 0)) { g.say('can’t turn left', null, null, '#5c0000'); s.quiet = g.t + 900; }
        return null;
      }
      return d;
    },
  });
  challenge({
    id: 'tipsy', group: 'controls', d: 2, name: 'Tipsy',
    desc: 'One in four turns goes the wrong way.',
    input: (g, s, d, last) => (perp(d, last) && g.chance(0.25) ? { x: -d.x, y: -d.y } : d),
  });
  challenge({
    id: 'ice', group: 'controls', d: 1, name: 'Ice Rink',
    desc: 'Some of your turns just slide right off.',
    input(g, s, d, last, synthetic) {
      if (!synthetic && perp(d, last) && g.chance(0.3)) { g.say('whoops', null, null, '#2f6d9b'); return null; }
      return d;
    },
    under(g, s, c) {
      c.fillStyle = 'rgba(160,200,230,0.22)';
      c.fillRect(g.ox, g.oy, g.W * g.cell, g.H * g.cell);
    },
  });
  challenge({
    id: 'lag', group: 'controls', d: 2, name: 'Satellite Internet',
    desc: 'Your key presses arrive three moves late.',
    lag: (g, s, n) => n + 3,
  });
  challenge({
    id: 'cat', d: 1, name: 'Cat on the Keyboard',
    desc: 'Your cat occasionally walks across the keyboard.',
    tick(g, s) {
      if (!every(g, s, 'next', 25, 55)) return;
      g.press(g.pick(g.DIRS));
      g.say('🐈 mrrp', null, null, '#6b5d3a');
    },
  });

  // ═════════════════════════ SPEED ═════════════════════════

  challenge({
    id: 'hyper', group: 'speed', d: 2, name: 'Hyperspeed',
    desc: 'Everything happens 60% faster.',
    speed: (g, s, ms) => ms * 0.62,
  });
  challenge({
    id: 'molasses', group: 'speed', d: 0, name: 'Molasses',
    desc: 'Everything is extremely slow. Savor it.',
    speed: (g, s, ms) => ms * 1.75,
  });
  challenge({
    id: 'accel', group: 'speed', d: 2, name: 'Accelerando',
    desc: 'You get a little faster with every move.',
    setup(g, s) { s.t0 = g.tick; },
    speed: (g, s, ms) => ms * Math.max(0.45, 1 - (g.tick - s.t0) / 450),
  });
  challenge({
    id: 'heartbeat', group: 'speed', d: 1, name: 'Heartbeat',
    desc: 'Your speed pulses. Fast, slow, fast, slow.',
    speed: (g, s, ms) => ms * (1 + 0.5 * Math.sin(g.tick / 5)),
    overlay(g, s, c) {
      const k = Math.max(0, Math.sin(g.tick / 5));
      c.fillStyle = 'rgba(184,50,42,' + (k * 0.06) + ')';
      c.fillRect(0, 0, 400, 400);
    },
  });
  challenge({
    id: 'espresso', group: 'speed', d: 1, name: 'Triple Espresso',
    desc: 'Your speed is random. Every single move.',
    speed(g, s, ms) {
      if (s.at !== g.tick) { s.at = g.tick; s.k = 0.5 + Math.random() * 1.1; }
      return ms * s.k;
    },
  });
  challenge({
    id: 'momentum', group: 'speed', d: 1, name: 'Momentum',
    desc: 'The longer you get, the faster you go.',
    speed: (g, s, ms) => ms * Math.max(0.5, 1 - (g.snake.length - 4) * 0.025),
  });
  challenge({
    id: 'spicy', d: 1, name: 'Spicy Food',
    desc: 'Every snack sends you into a brief, panicked sprint.',
    eat(g, s, f) { s.until = g.tick + 22; g.say('HOT HOT HOT', f.x, f.y, '#c0392b'); },
    speed: (g, s, ms) => (g.tick < (s.until || 0) ? ms * 0.5 : ms),
    style(g, s, st) { if (g.tick < (s.until || 0)) st.snakeColor = Math.floor(g.t / 80) % 2 ? '#b8321b' : '#e8590c'; },
  });
  challenge({
    id: 'slowbites', d: 0, name: 'Slow-Mo Bites',
    desc: 'Every bite plays out in dramatic slow motion.',
    eat(g, s) { s.until = g.tick + 6; },
    speed: (g, s, ms) => (g.tick < (s.until || 0) ? ms * 3 : ms),
    overlay(g, s, c) {
      if (g.tick >= (s.until || 0)) return;
      c.fillStyle = 'rgba(0,0,0,0.85)';
      c.fillRect(0, 0, 400, 34); c.fillRect(0, 366, 400, 34);
    },
  });

  // ═════════════════════════ GROWTH ═════════════════════════

  challenge({
    id: 'bottomless', group: 'growth', d: 1, name: 'Bottomless Appetite',
    desc: 'Every snack makes you five squares longer.',
    eat(g, s, f, res) { if (res.grow > 0) res.grow = 5; },
  });
  challenge({
    id: 'diet', group: 'growth', d: 0, name: 'On a Diet',
    desc: 'You never grow. Very disciplined.',
    eat(g, s, f, res) { res.grow = 0; },
  });
  challenge({
    id: 'molting', d: 0, name: 'Molting',
    desc: 'You shed a segment every few seconds.',
    tick(g) {
      if (g.tick % 25 || g.snake.length <= 3) return;
      const t = g.snake[g.snake.length - 1];
      g.shrink(1);
      g.say('shed', t.x, t.y, '#8a8a84');
    },
  });
  challenge({
    id: 'spurt', d: 1, name: 'Growth Spurt',
    desc: 'You keep growing whether you eat or not.',
    tick(g) { if (g.tick % 12 === 0) g.grow++; },
  });
  challenge({
    id: 'hangry', d: 1, name: 'Hangry',
    desc: 'Go too long without a snack and you start wasting away.',
    setup(g, s) { s.t0 = g.tick; },
    tick(g, s) {
      const since = g.tick - Math.max(g.lastEat, s.t0);
      if (since <= 50 || since % 10) return;
      if (g.snake.length <= 2) { g.die('you starved'); return; }
      g.shrink(1);
      g.say('hungry…', null, null, '#8a6d1f');
    },
    style(g, s, st) { if (g.tick - Math.max(g.lastEat, s.t0) > 40) st.snakeColor = '#6e6450'; },
  });
  challenge({
    id: 'taxes', d: 1, name: 'Tax Season',
    desc: 'Every third snack, the government takes a third of you.',
    eat(g, s) { s.n = (s.n || 0) + 1; if (s.n % 3 === 0) s.due = true; },
    after(g, s) {
      if (!s.due) return;
      s.due = false;
      const n = g.shrink(Math.floor(g.snake.length / 3));
      g.say('taxed: −' + n, null, null, '#5c0000');
      g.sfx('bad');
    },
  });
  challenge({
    id: 'longboi', d: 1, name: 'Long Boi',
    desc: 'You suddenly become sixteen squares longer.',
    setup(g) { g.grow += 16; },
  });

  // ═════════════════════════ MOVEMENT & WALLS ═════════════════════════

  challenge({
    id: 'pacman', group: 'walls', d: 0, name: 'Pac-Man Physics',
    desc: 'Go off one edge and you come back on the other.',
    wrap: true,
    under(g, s, c) {
      c.save();
      c.strokeStyle = 'rgba(47,93,155,0.5)'; c.setLineDash([4, 4]); c.lineWidth = 2;
      c.strokeRect(g.ox + 1, g.oy + 1, g.W * g.cell - 2, g.H * g.cell - 2);
      c.restore();
    },
  });
  challenge({
    id: 'bouncy', group: 'walls', d: 0, name: 'Bouncy Castle',
    desc: 'Walls bounce you backwards instead of killing you.',
    save(g, s, cat) {
      if (cat !== 'wall') return;
      g.reverse();
      g.sfx('boing');
      g.say('boing', null, null, '#c2185b');
      return 'skip';
    },
    under(g, s, c) {
      c.save();
      c.strokeStyle = '#f48fb1'; c.lineWidth = 5;
      c.strokeRect(g.ox + 2.5, g.oy + 2.5, g.W * g.cell - 5, g.H * g.cell - 5);
      c.restore();
    },
  });
  challenge({
    id: 'hiccups', d: 1, name: 'Hiccups',
    desc: 'Every so often you hiccup and lurch forward an extra square.',
    move(g, s, h) {
      if (!every(g, s, 'next', 18, 40)) return h;
      g.say('hic!', h.x, h.y, '#6c3fb5');
      return { x: h.x + g.dir.x, y: h.y + g.dir.y };
    },
  });
  challenge({
    id: 'gravity', d: 1, name: 'Gravity',
    desc: 'Whenever you travel sideways, you sag downward.',
    move(g, s, h) {
      if (g.dir.y !== 0 || g.tick % 4) return h;
      const c = { x: h.x, y: h.y + 1 };
      return g.inBounds(c.x, c.y) && g.inBounds(h.x, h.y) && !g.blockedAt(c.x, c.y) ? c : h;
    },
  });
  challenge({
    id: 'uno', d: 2, name: 'Uno Reverse',
    desc: 'Every snack swaps your head and your tail.',
    eat(g, s) { s.flip = true; },
    after(g, s) {
      if (!s.flip) return;
      s.flip = false;
      g.reverse();
      g.say('reverse!', null, null, '#b8322a');
    },
  });
  challenge({
    id: 'allergies', d: 2, name: 'Allergies',
    desc: 'You sneeze. Sneezing sends you backwards.',
    tick(g, s) {
      if (s.next == null) s.next = g.tick + 40 + g.rand(40);
      const left = s.next - g.tick;
      if (left === 9) g.say('ah…', null, null, '#5a5a56');
      if (left === 4) g.say('ah… ah…', null, null, '#5a5a56');
      if (left > 0) return;
      g.reverse();
      g.say('ACHOO!', null, null, '#5c0000', true);
      g.shake = 7;
      g.sfx('bad');
      s.next = g.tick + 50 + g.rand(50);
    },
  });
  challenge({
    id: 'wormholes', d: 1, name: 'Wormholes',
    desc: 'Two pairs of portals connect distant parts of the board.',
    setup(g, s) {
      const colors = ['#6c3fb5', '#1f8a70'];
      const hz = {
        owner: 'wormholes', ps: [],
        occupies(x, y) { return this.ps.some(p => p.x === x && p.y === y); },
        draw(c) {
          for (const p of this.ps) {
            const x = g.px(p.x), y = g.py(p.y), r = g.cell * 0.45;
            c.save();
            c.strokeStyle = p.color; c.lineWidth = Math.max(1.5, g.cell * 0.12);
            for (let i = 0; i < 3; i++) {
              const a = g.t / 300 + i * 2.1;
              c.beginPath(); c.arc(x, y, r * (1 - i * 0.28), a, a + 4.2); c.stroke();
            }
            c.restore();
          }
        },
      };
      g.hazards.push(hz);
      for (const color of colors) {
        const a = g.randFree({ minDist: 4, avoidAhead: true });
        if (!a) break;
        a.color = color; hz.ps.push(a);
        const b = g.randFree({ minDist: 4, avoidAhead: true, filter: (x, y) => g.dist(a, { x, y }) >= 8 });
        if (!b) { hz.ps.pop(); break; }
        b.color = color; hz.ps.push(b);
        a.to = b; b.to = a;
      }
      s.hz = hz;
    },
    move(g, s, h) {
      const p = s.hz.ps.find(q => q.x === h.x && q.y === h.y);
      if (!p) return h;
      g.sfx('warp');
      g.puff(p.x, p.y, p.color);
      return { x: p.to.x, y: p.to.y };
    },
  });
  challenge({
    id: 'possessed', group: 'chaos', d: 2, name: 'Possessed',
    desc: 'Every so often, something else takes the wheel.',
    tick(g, s) {
      if (s.next == null) s.next = g.tick + 30 + g.rand(40);
      if (g.tick === s.next - 5) g.say('you feel a chill…', null, null, '#6c3fb5');
    },
    steer(g, s, d) {
      if (g.tick < s.next) return d;
      s.next = g.tick + 35 + g.rand(45);
      const nd = randomTurn(g, d);
      if (!nd) return d;
      g.queue = [];
      g.puff(g.head().x, g.head().y, 'rgba(108,63,181,0.5)');
      return nd;
    },
  });
  challenge({
    id: 'squirrel', group: 'chaos', d: 1, name: 'Squirrel!',
    desc: 'Go straight for too long and you get distracted.',
    steer(g, s, d) {
      s.n = s.last && same(s.last, d) ? (s.n || 0) + 1 : 0;
      s.last = d;
      if (s.n < 10) return d;
      const nd = randomTurn(g, d);
      if (!nd) return d;
      s.n = 0; s.last = nd;
      g.queue = [];
      g.say('SQUIRREL!', null, null, '#8a5a2b');
      return nd;
    },
  });
  challenge({
    id: 'tron', d: 2, name: 'Light Cycle',
    desc: 'Your tail leaves a trail of fire behind it.',
    after(g) {
      const t = g.lastTail;
      if (!t || g.onSnake(t.x, t.y) >= 0 || g.rockAt(t.x, t.y) || g.foodAt(t.x, t.y) >= 0) return;
      g.addRock(t.x, t.y, { kind: 'fire', owner: 'tron', until: g.tick + 14 });
    },
  });

  // ═════════════════════════ ARENA ═════════════════════════

  challenge({
    id: 'asteroids', d: 1, name: 'Asteroid Field',
    desc: 'The board is littered with space rocks.',
    setup(g) {
      const n = Math.round(g.W * g.H * 0.045);
      for (let i = 0; i < n; i++) {
        const c = g.randFree({ minDist: 4, avoidAhead: true });
        if (c) g.addRock(c.x, c.y, { kind: 'asteroid', owner: 'asteroids', reason: 'you hit an asteroid' });
      }
    },
  });
  challenge({
    id: 'hotedges', group: 'walls', d: 1, name: 'Hot Edges',
    desc: 'The outermost ring of the board is lava.',
    canStart(g) {
      const inner = p => p.x >= 1 && p.y >= 1 && p.x <= g.W - 2 && p.y <= g.H - 2;
      const h = g.head(), ahead = { x: h.x + g.dir.x * 3, y: h.y + g.dir.y * 3 };
      return g.snake.every(inner) && inner(ahead);
    },
    setup(g) {
      for (let y = 0; y < g.H; y++) {
        for (let x = 0; x < g.W; x++) {
          const edge = x === 0 || y === 0 || x === g.W - 1 || y === g.H - 1;
          if (edge && g.onSnake(x, y) < 0) {
            const f = g.foodAt(x, y);
            if (f >= 0) g.foods.splice(f, 1);
            g.addRock(x, y, { kind: 'lava', owner: 'hotedges' });
          }
        }
      }
    },
  });
  challenge({
    id: 'construction', d: 1, name: 'Construction Zone',
    desc: 'Someone keeps putting up walls. No permits were filed.',
    setup(g, s) {
      s.count = 0;
      s.hz = {
        owner: 'construction', pend: [],
        occupies(x, y) { return this.pend.some(p => p.x === x && p.y === y); },
        draw(c) {
          for (const p of this.pend) {
            const k = 1 - (p.at - g.tick) / 10;
            c.font = Math.round(g.cell * (0.5 + k * 0.35)) + 'px "Noto Color Emoji","Apple Color Emoji",sans-serif';
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText('🚧', g.px(p.x), g.py(p.y));
          }
        },
      };
      g.hazards.push(s.hz);
    },
    tick(g, s) {
      if (s.count < 30 && g.tick % 14 === 0) {
        const c = g.randFree({ minDist: 5 });
        if (c) { c.at = g.tick + 10; s.hz.pend.push(c); }
      }
      s.hz.pend = s.hz.pend.filter(p => {
        if (g.tick < p.at) return true;
        if (g.onSnake(p.x, p.y) < 0 && g.foodAt(p.x, p.y) < 0) {
          g.addRock(p.x, p.y, { kind: 'wall', owner: 'construction', reason: 'you walked into a construction site' });
          s.count++;
        }
        return false;
      });
    },
  });
  challenge({
    id: 'garage', d: 1, name: 'Parking Garage',
    desc: 'Concrete pillars, everywhere.',
    setup(g) {
      const h = g.head();
      for (let y = 0; y < g.H; y++) {
        for (let x = 0; x < g.W; x++) {
          if (x % 4 !== 2 || y % 4 !== 1) continue;
          if (y === h.y || x === h.x || g.dist(h, { x, y }) < 3 || g.taken(x, y)) continue;
          g.addRock(x, y, { kind: 'pillar', owner: 'garage' });
        }
      }
    },
  });
  challenge({
    id: 'cubicles', d: 1, name: 'Cubicle Farm',
    desc: 'Office partitions divide up the board.',
    setup(g) {
      const h = g.head();
      const nearRock = c => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g.rockAt(c.x + dx, c.y + dy)) return true;
        return false;
      };
      let placed = 0;
      for (let tries = 0; placed < 7 && tries < 300; tries++) {
        const horiz = g.chance(0.5), len = 3 + g.rand(4);
        const x0 = g.rand(g.W), y0 = g.rand(g.H), cells = [];
        for (let i = 0; i < len; i++) cells.push(horiz ? { x: x0 + i, y: y0 } : { x: x0, y: y0 + i });
        const ok = cells.every(c => g.inBounds(c.x, c.y) && !g.taken(c.x, c.y) && g.dist(c, h) >= 4 &&
          c.y !== h.y && c.x !== h.x && !nearRock(c));
        if (!ok) continue;
        cells.forEach(c => g.addRock(c.x, c.y, { kind: 'partition', owner: 'cubicles', reason: 'you walked into a cubicle wall' }));
        placed++;
      }
    },
  });
  const tideLevel = (g, s) => Math.round((Math.sin((g.tick - s.t0) / 40 - Math.PI / 2) + 1) / 2 * g.H * 0.4);
  challenge({
    id: 'tide', d: 0, name: 'Rising Tide',
    desc: 'The water rises and falls. Swimming is slow.',
    setup(g, s) { s.t0 = g.tick; },
    speed(g, s, ms) { const h = g.head(); return h && h.y >= g.H - tideLevel(g, s) ? ms * 1.6 : ms; },
    draw(g, s, c) {
      const lv = tideLevel(g, s);
      if (!lv) return;
      const top = g.oy + (g.H - lv) * g.cell, w = g.W * g.cell;
      c.save();
      c.fillStyle = 'rgba(47,110,170,0.28)';
      c.beginPath();
      c.moveTo(g.ox, g.oy + g.H * g.cell);
      for (let x = 0; x <= w; x += 8) c.lineTo(g.ox + x, top + Math.sin(x / 18 + g.t / 300) * 3);
      c.lineTo(g.ox + w, g.oy + g.H * g.cell);
      c.closePath(); c.fill();
      c.restore();
    },
  });
  challenge({ id: 'bigcountry', group: 'size', temp: false, d: 0, name: 'Big Country', desc: 'The board is enormous.', size: () => ({ W: 32, H: 32 }) });
  challenge({ id: 'studio', group: 'size', temp: false, d: 2, name: 'Studio Apartment', desc: 'The board is eleven by eleven. Cozy.', size: () => ({ W: 11, H: 11 }) });
  challenge({ id: 'hallway', group: 'size', temp: false, d: 1, name: 'Hallway', desc: 'A long, thin board.', size: () => ({ W: 28, H: 8 }) });
  challenge({ id: 'bowling', group: 'size', temp: false, d: 1, name: 'Bowling Lane', desc: 'A tall, thin board.', size: () => ({ W: 8, H: 26 }) });

  // ═════════════════════════ FOOD ═════════════════════════

  challenge({
    id: 'shy', group: 'foodmove', d: 1, name: 'Shy Food',
    desc: 'Food tries to get away from you.',
    tick(g) {
      if (g.tick % 2) return;
      const h = g.head();
      for (const f of g.foods) {
        let bd = g.dist(f, h), best = null;
        if (bd > 6) continue;
        for (const d of g.DIRS) {
          const c = { x: f.x + d.x, y: f.y + d.y };
          if (!g.inBounds(c.x, c.y) || g.taken(c.x, c.y)) continue;
          const dd = g.dist(c, h);
          if (dd > bd) { bd = dd; best = c; }
        }
        if (best) { f.x = best.x; f.y = best.y; }
      }
    },
  });
  challenge({
    id: 'restless', group: 'foodmove', d: 1, name: 'Restless Snacks',
    desc: 'Food wanders around aimlessly.',
    tick(g) {
      if (g.tick % 3) return;
      for (const f of g.foods) {
        const d = g.pick(g.DIRS), c = { x: f.x + d.x, y: f.y + d.y };
        if (g.inBounds(c.x, c.y) && !g.taken(c.x, c.y)) { f.x = c.x; f.y = c.y; }
      }
    },
  });
  challenge({
    id: 'quantum', group: 'foodmove', d: 1, name: 'Quantum Snack',
    desc: 'Food teleports every few seconds.',
    tick(g) {
      for (const f of g.foods) {
        if (f.qt == null) f.qt = g.tick + 28;
        if (g.tick < f.qt) continue;
        const c = g.randFree({ minDist: 3 });
        if (c) { g.puff(f.x, f.y, 'rgba(108,63,181,0.5)'); f.x = c.x; f.y = c.y; }
        f.qt = g.tick + 28;
      }
    },
    style(g, s, st) { st.foodBlink = f => f.qt != null && f.qt - g.tick <= 5; },
  });
  challenge({
    id: 'buffet', d: 0, not: ['alphabet', 'picky'], name: 'All-You-Can-Eat',
    desc: 'Five snacks out at once. Help yourself.',
    foodCount: (g, s, n) => Math.max(n, 5),
  });
  challenge({
    id: 'perishables', d: 1, not: ['picky', 'alphabet'], name: 'Perishables',
    cleanup(g) { g.foods.forEach(f => { delete f.scale; if (!f.bad && !f.gold && f.pk == null) delete f.color; }); },
    desc: 'Food rots if you leave it out, and rotten food turns to stone.',
    tick(g) {
      for (const f of g.foods.slice()) {
        const age = g.tick - f.born;
        f.scale = Math.max(0.5, 1 - age / 110);
        if (!f.bad && !f.gold) f.color = mix('#9e1b1b', '#6b6b3a', Math.min(1, age / 70));
        if (age < 70) continue;
        g.removeFood(f);
        g.addRock(f.x, f.y, { kind: 'rotten', owner: 'perishables', until: g.tick + 160 });
        g.say('rotten', f.x, f.y, '#6b6b3a');
      }
    },
  });
  challenge({
    id: 'mystery', d: 1, not: ['picky', 'alphabet'], name: 'Mystery Meat',
    cleanup(g) { g.foods.forEach(f => { if (f.bad) { delete f.bad; delete f.color; } }); },
    desc: 'Some snacks are poisoned. Poison shrinks you and costs you points.',
    foodCount: (g, s, n) => Math.max(n, 3),
    newFood(g, s, f) {
      if (g.foods.some(o => !o.bad) && g.chance(0.5)) { f.bad = true; f.color = '#6c3fb5'; }
    },
    eat(g, s, f, res) {
      if (!f.bad) return;
      res.grow = 0; res.progress = 0; res.points = -20; res.sound = 'bad';
      g.shrink(3);
      g.say('ew', f.x, f.y, '#6c3fb5');
    },
  });
  challenge({
    id: 'goldrush', d: 0, name: 'Gold Rush',
    cleanup(g) { g.foods.forEach(f => { if (f.gold) { delete f.gold; delete f.color; } }); },
    desc: 'Some snacks are solid gold and worth five times as much.',
    newFood(g, s, f) { if (!f.bad && !f.label && f.pk == null && g.chance(0.3)) { f.gold = true; f.color = '#c99a06'; } },
    eat(g, s, f, res) {
      if (!f.gold) return;
      res.points *= 5;
      g.say('×5', f.x, f.y, '#c99a06');
    },
  });
  const ABC = ['A', 'B', 'C'];
  challenge({
    id: 'alphabet', d: 1, not: ['mystery', 'picky', 'goldrush', 'perishables', 'buffet'], name: 'Alphabet Soup',
    desc: 'Eat the letters in alphabetical order.',
    setup(g, s) { s.next = 0; g.foods.splice(0); },
    cleanup(g) { g.foods.forEach(f => { if (f.label) { delete f.label; delete f.color; } }); },
    foodCount: (g, s) => 3 - s.next,
    newFood(g, s, f) {
      const present = g.foods.map(o => o.label);
      for (let i = s.next; i < 3; i++) {
        if (!present.includes(ABC[i])) { f.label = ABC[i]; f.color = '#2a2a28'; return; }
      }
    },
    eat(g, s, f, res) {
      if (!f.label) return;
      if (f.label === ABC[s.next]) {
        s.next++;
        if (s.next === 3) { s.next = 0; g.say('A B C!', f.x, f.y, '#3d7a3a'); }
        return;
      }
      res.grow = 0; res.points = 0; res.sound = 'bad';
      g.shrink(2);
      g.say('that’s ' + f.label + ', not ' + ABC[s.next], f.x, f.y, '#5c0000');
    },
  });
  const PICKY = [{ c: '#b8322a', n: 'red' }, { c: '#2f5d9b', n: 'blue' }, { c: '#3d7a3a', n: 'green' }];
  challenge({
    id: 'picky', d: 1, not: ['mystery', 'alphabet', 'perishables', 'goldrush', 'buffet'], name: 'Picky Eater',
    desc: 'You can only eat snacks that match your color.',
    setup(g, s) { s.c = g.rand(3); g.foods.forEach(f => this.newFood(g, s, f)); },
    cleanup(g) { g.foods.forEach(f => { delete f.pk; delete f.color; }); },
    foodCount: () => 3,
    newFood(g, s, f) {
      const have = g.foods.map(o => o.pk);
      const miss = [0, 1, 2].filter(i => !have.includes(i));
      f.pk = miss.length ? g.pick(miss) : g.rand(3);
      f.color = PICKY[f.pk].c;
    },
    eat(g, s, f, res) {
      if (f.pk !== s.c) {
        res.grow = 0; res.points = 0; res.sound = 'bad';
        g.shrink(2);
        g.say('you’re ' + PICKY[s.c].n + '!', f.x, f.y, PICKY[s.c].c);
      }
      const n = g.rand(3);
      s.c = n === s.c && g.chance(0.5) ? (n + 1) % 3 : n;
    },
    style(g, s, st) { st.snakeColor = PICKY[s.c].c; },
  });
  challenge({
    id: 'edgelord', group: 'foodspot', d: 1, not: ['hotedges'], name: 'Edgelord',
    desc: 'Food only shows up along the walls.',
    place: (g, s, x, y) => x === 0 || y === 0 || x === g.W - 1 || y === g.H - 1,
  });
  challenge({
    id: 'cornerstore', group: 'foodspot', d: 1, not: ['hotedges'], name: 'Corner Store',
    desc: 'Food only shows up in the corners.',
    place: (g, s, x, y) => (x < 2 || x >= g.W - 2) && (y < 2 || y >= g.H - 2),
  });
  challenge({
    id: 'roomservice', group: 'foodspot', d: 0, name: 'Room Service',
    desc: 'Food is delivered right near your face.',
    place(g, s, x, y) { const d = g.dist(g.head(), { x, y }); return d >= 3 && d <= 5; },
  });
  function holeAt(g) {
    const h = g.head(), horiz = g.dir.y === 0;
    let cx = Math.floor(g.W / 2) - 1, cy = Math.floor(g.H / 2) - 1;
    if (horiz && (h.y === cy || h.y === cy + 1)) cy = h.y - 3 >= 0 ? h.y - 3 : h.y + 2;
    if (!horiz && (h.x === cx || h.x === cx + 1)) cx = h.x - 3 >= 0 ? h.x - 3 : h.x + 2;
    return { cx, cy, cells: [{ x: cx, y: cy }, { x: cx + 1, y: cy }, { x: cx, y: cy + 1 }, { x: cx + 1, y: cy + 1 }] };
  }
  challenge({
    id: 'blackhole', d: 1, name: 'Black Hole',
    desc: 'A black hole drags food toward it. Don’t get too close.',
    canStart(g) {
      const { cells } = holeAt(g);
      return cells.every(c => g.onSnake(c.x, c.y) < 0 && !g.rockAt(c.x, c.y) && g.dist(c, g.head()) >= 3);
    },
    setup(g, s) {
      const { cx, cy, cells } = holeAt(g);
      cells.forEach(c => { const f = g.foodAt(c.x, c.y); if (f >= 0) g.foods.splice(f, 1); });
      s.c = { x: cx + 0.5, y: cy + 0.5 };
      s.cells = cells;
      g.hazards.push({
        owner: 'blackhole',
        hit: (x, y) => (cells.some(c => c.x === x && c.y === y) ? 'you were spaghettified by a black hole' : null),
        draw(c) {
          const x = g.ox + (cx + 1) * g.cell, y = g.oy + (cy + 1) * g.cell, r = g.cell;
          c.save();
          const gr = c.createRadialGradient(x, y, r * 0.2, x, y, r * 2.2);
          gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.45, 'rgba(40,20,70,0.85)'); gr.addColorStop(1, 'rgba(40,20,70,0)');
          c.fillStyle = gr; c.fillRect(x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
          c.strokeStyle = 'rgba(201,154,6,0.7)'; c.lineWidth = 1.5;
          for (let i = 0; i < 3; i++) {
            const a = -g.t / 400 + i * 2.1;
            c.beginPath(); c.arc(x, y, r * (0.9 + i * 0.35), a, a + 1.6); c.stroke();
          }
          c.restore();
        },
      });
    },
    tick(g, s) {
      if (g.tick % 5) return;
      for (const f of g.foods.slice()) {
        const dx = s.c.x - f.x, dy = s.c.y - f.y;
        const steps = Math.abs(dx) >= Math.abs(dy)
          ? [{ x: Math.sign(dx), y: 0 }, { x: 0, y: Math.sign(dy) }]
          : [{ x: 0, y: Math.sign(dy) }, { x: Math.sign(dx), y: 0 }];
        for (const d of steps) {
          if (!d.x && !d.y) continue;
          const c = { x: f.x + d.x, y: f.y + d.y };
          if (s.cells.some(q => q.x === c.x && q.y === c.y)) {
            g.removeFood(f);
            g.say('gone', f.x, f.y, '#6c3fb5');
            break;
          }
          if (g.inBounds(c.x, c.y) && !g.taken(c.x, c.y)) { f.x = c.x; f.y = c.y; break; }
        }
      }
    },
  });
  challenge({
    id: 'ninja', group: 'vision', d: 2, name: 'Ninja Snacks',
    desc: 'Food is invisible, apart from the occasional blink.',
    style(g, s, st) { if (!g.has('flashlight')) st.foodVisible = g.t % 1600 < 380; },
  });
  challenge({
    id: 'crumbs', d: 0, name: 'Crumbs',
    desc: 'The snacks are very, very small.',
    style(g, s, st) { st.foodSize = 0.25; },
  });
  challenge({
    id: 'fruitsalad', d: 0, name: 'Fruit Salad',
    desc: 'All food is now emoji. Nutritionally identical.',
    style(g, s, st) { st.emojiFood = true; },
  });
  challenge({
    id: 'hotpotato', d: 2, name: 'Hot Potato',
    desc: 'You’re holding a hot potato. Eat before the timer runs out or it explodes.',
    setup(g, s) { s.deadline = g.tick + 85; },
    eat(g, s) { s.deadline = g.tick + 85; },
    tick(g, s) {
      const left = s.deadline - g.tick;
      if (left === 25) g.say('hurry!', null, null, '#b8321b');
      if (left > 0) return;
      s.deadline = g.tick + 85;
      g.shake = 10;
      g.sfx('boom');
      g.hurt('the hot potato exploded', 'hazard');
    },
    draw(g, s, c) {
      const h = g.head();
      if (!h) return;
      const k = Math.max(0, (s.deadline - g.tick) / 85);
      const x = g.px(h.x), y = g.py(h.y), r = g.cell * 0.9;
      c.save();
      c.strokeStyle = k < 0.3 ? '#b8321b' : '#c99a06'; c.lineWidth = 3;
      c.beginPath(); c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); c.stroke();
      c.font = Math.round(g.cell * 0.7) + 'px "Noto Color Emoji","Apple Color Emoji",sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const jit = k < 0.3 ? (Math.random() - 0.5) * 3 : 0;
      c.fillText('🥔', x + r + jit, y - r + jit);
      c.restore();
    },
  });

  // ═════════════════════════ VISION ═════════════════════════

  challenge({
    id: 'lightsout', group: 'vision', d: 2, name: 'Lights Out',
    desc: 'It’s dark. You can only see what’s right around your head.',
    draw(g, s, c) {
      const h = g.head();
      if (!h) return;
      const r = g.cell * (g.has('flashlight') ? 9 : 3.8);
      g.darkness(c, [{ x: g.px(h.x), y: g.py(h.y), r }], 'rgba(12,11,10,0.97)');
      if (g.style.foodVisible === false) return;
      for (const f of g.foods) {
        c.fillStyle = 'rgba(220,70,50,' + (0.3 + 0.2 * Math.sin(g.t / 250 + f.id)) + ')';
        circle(c, g.px(f.x), g.py(f.y), g.cell * 0.18);
      }
    },
  });
  challenge({
    id: 'fog', group: 'vision', d: 1, name: 'Pea Soup',
    desc: 'A thick fog rolls in.',
    draw(g, s, c) {
      const h = g.head();
      if (!h) return;
      const r = g.cell * (g.has('flashlight') ? 12 : 6.5);
      g.darkness(c, [{ x: g.px(h.x), y: g.py(h.y), r, soft: 0.3 }], 'rgba(214,214,206,0.96)');
    },
  });
  challenge({
    id: 'stagefright', group: 'vision', d: 2, name: 'Stage Fright',
    desc: 'The spotlights are on the snacks, not on you.',
    draw(g, s, c) {
      const holes = g.foods.map(f => ({ x: g.px(f.x), y: g.py(f.y), r: g.cell * 3 }));
      if (g.has('flashlight')) { const h = g.head(); holes.push({ x: g.px(h.x), y: g.py(h.y), r: g.cell * 5 }); }
      g.darkness(c, holes, 'rgba(12,11,10,0.97)');
    },
  });
  challenge({
    id: 'invisnake', d: 2, name: 'Invisible Snake',
    desc: 'Your body is invisible. Only your head remains.',
    style(g, s, st) { st.hideBody = true; },
  });
  challenge({
    id: 'wiring', d: 1, name: 'Faulty Wiring',
    desc: 'The lights keep cutting out.',
    overlay(g, s, c) {
      if (g.state === 'play' && everyMs(g, s, 'next', 1500, 4000)) s.off = g.t + 160 + Math.random() * 380;
      if (g.t >= (s.off || 0)) return;
      c.fillStyle = Math.random() < 0.1 ? 'rgba(10,10,9,0.8)' : 'rgba(10,10,9,0.97)';
      c.fillRect(0, 0, 400, 400);
    },
  });
  challenge({
    id: 'paparazzi', d: 1, name: 'Paparazzi',
    desc: 'Photographers keep flashing their cameras at you.',
    overlay(g, s, c) {
      if (g.state === 'play' && everyMs(g, s, 'next', 1200, 3200)) {
        s.at = g.t; s.x = 40 + Math.random() * 320; s.y = 40 + Math.random() * 320;
      }
      const k = 1 - (g.t - (s.at || -1e9)) / 450;
      if (k <= 0) return;
      c.save();
      c.fillStyle = 'rgba(255,255,255,' + (0.92 * k) + ')';
      c.fillRect(0, 0, 400, 400);
      c.globalAlpha = Math.min(1, k * 2);
      c.font = '30px "Noto Color Emoji","Apple Color Emoji",sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('📸', s.x, s.y);
      c.restore();
    },
  });

  // ═════════════════════════ SCREEN ═════════════════════════

  challenge({
    id: 'spin', group: 'screen', d: 2, name: 'Spin Cycle',
    desc: 'The whole board slowly rotates.',
    setup(g, s) { s.t0 = g.t; },
    view(g, s, c) {
      const a = (g.t - s.t0) / 1000 * 0.32;
      const k = 1 / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
      around(c, () => { c.rotate(a); c.scale(k, k); });
    },
  });
  challenge({
    id: 'australia', group: 'screen', d: 2, name: 'Australia',
    desc: 'The screen is upside down. The controls are not.',
    view(g, s, c) { around(c, () => c.scale(1, -1)); },
  });
  challenge({
    id: 'lookingglass', group: 'screen', d: 2, name: 'Through the Looking Glass',
    desc: 'The screen is mirrored. The controls are not.',
    view(g, s, c) { around(c, () => c.scale(-1, 1)); },
  });
  challenge({
    id: 'antfarm', group: 'screen', d: 1, name: 'Ant Farm',
    desc: 'Everything is tiny.',
    view(g, s, c) { around(c, () => c.scale(0.42, 0.42)); },
  });
  challenge({
    id: 'nose', group: 'screen', d: 1, name: 'Nose Against the Glass',
    desc: 'The camera is way too close.',
    view(g, s, c) {
      const h = g.head();
      if (!h) return;
      const tx = g.px(h.x), ty = g.py(h.y);
      if (s.cx == null || Math.abs(tx - s.cx) > 150 || Math.abs(ty - s.cy) > 150) { s.cx = tx; s.cy = ty; }
      const k = 1 - Math.pow(0.0005, g.dt);
      s.cx += (tx - s.cx) * k; s.cy += (ty - s.cy) * k;
      c.translate(C, C); c.scale(2.3, 2.3); c.translate(-s.cx, -s.cy);
    },
  });
  challenge({
    id: 'jelly', group: 'screen', d: 1, name: 'Jelly',
    desc: 'The board is made of jelly.',
    view(g, s, c) {
      const t = g.t / 1000;
      around(c, () => { c.transform(1, Math.sin(t * 2.1) * 0.12, Math.sin(t * 1.7) * 0.12, 1, 0, 0); c.scale(0.86, 0.86); });
    },
  });
  challenge({
    id: 'funhouse', group: 'screen', d: 1, name: 'Funhouse Mirror',
    desc: 'Squash. Stretch. Squash.',
    view(g, s, c) {
      const k = Math.sin(g.t / 650) * 0.3;
      around(c, () => c.scale((1 + k) * 0.78, (1 - k) * 0.78));
    },
  });
  challenge({
    id: 'earthquake', d: 1, name: 'Earthquake',
    desc: 'Everything shakes. Constantly.',
    view(g, s, c) {
      const m = 2.5 + 3 * Math.abs(Math.sin(g.t / 900));
      c.translate((Math.random() - 0.5) * m * 2, (Math.random() - 0.5) * m * 2);
    },
  });
  challenge({
    id: 'dramaticzoom', d: 0, name: 'Dramatic Zoom',
    desc: 'The camera zooms in dramatically every time you eat.',
    eat(g, s) { s.at = g.t; g.sfx('honk'); },
    view(g, s, c) {
      const k = 1 - (g.t - (s.at || -1e9)) / 900;
      const h = g.head();
      if (k <= 0 || !h) return;
      const z = 1 + 0.9 * ease(k), x = g.px(h.x), y = g.py(h.y);
      c.translate(x, y); c.scale(z, z); c.translate(-x, -y);
    },
  });

  // ═════════════════════════ COLOR & FILTERS ═════════════════════════

  challenge({
    id: 'gameboy', group: 'color', d: 0, name: '1989',
    desc: 'Everything looks like a handheld from 1989.',
    style(g, s, st) {
      Object.assign(st.pal, {
        page: '#9bbc0f', board: '#9bbc0f', check: 'rgba(15,56,15,0.05)', snake: '#0f380f', food: '#306230',
        rock: '#306230', ink: '#0f380f', muted: '#306230', accent: '#0f380f', veil: 'rgba(155,188,15,0.94)', eye: '#9bbc0f',
      });
    },
    overlay(g, s, c) {
      c.fillStyle = 'rgba(15,56,15,0.07)';
      for (let y = 0; y < 400; y += 3) c.fillRect(0, y, 400, 1);
    },
  });
  challenge({
    id: 'negative', group: 'color', d: 0, name: 'Negative',
    desc: 'All colors are inverted.',
    style(g, s, st) { st.filter += ' invert(1) hue-rotate(180deg)'; },
  });
  challenge({
    id: 'darkmode', group: 'color', d: 0, name: 'Dark Mode',
    desc: 'Finally.',
    style(g, s, st) {
      Object.assign(st.pal, {
        page: '#1d1c1a', board: '#1d1c1a', check: 'rgba(255,255,255,0.025)', snake: '#e8e2d4', food: '#e05a4f',
        rock: '#5a5852', ink: '#ece6da', muted: '#a8a296', accent: '#e07a6f', veil: 'rgba(29,28,26,0.93)', eye: '#1d1c1a',
      });
    },
  });
  challenge({
    id: 'disco', group: 'color', d: 0, name: 'Disco',
    desc: 'The floor is lit. So are you.',
    style(g, s, st) { st.rainbow = true; },
    under(g, s, c) {
      const beat = Math.floor(g.t / 480);
      for (let y = 0; y < g.H; y++) {
        for (let x = 0; x < g.W; x++) {
          c.fillStyle = 'hsla(' + (((x * 7 + y * 13 + beat * 5) % 6) * 60) + ',80%,60%,0.22)';
          c.fillRect(g.ox + x * g.cell, g.oy + y * g.cell, g.cell, g.cell);
        }
      }
    },
  });
  challenge({
    id: 'oldtimey', group: 'color', d: 0, name: 'Old Timey',
    desc: 'Sepia, scratches and a flickering projector.',
    style(g, s, st) { st.filter += ' sepia(0.9) contrast(1.05) brightness(' + (0.95 + Math.random() * 0.08).toFixed(3) + ')'; },
    overlay(g, s, c) {
      const gr = c.createRadialGradient(C, C, 120, C, C, 290);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(40,25,10,0.55)');
      c.fillStyle = gr; c.fillRect(0, 0, 400, 400);
      c.strokeStyle = 'rgba(40,25,10,0.35)'; c.lineWidth = 1;
      for (let i = 0; i < 2; i++) {
        if (Math.random() < 0.5) continue;
        const x = Math.random() * 400;
        c.beginPath(); c.moveTo(x, 0); c.lineTo(x + (Math.random() - 0.5) * 10, 400); c.stroke();
      }
    },
  });
  challenge({
    id: 'blur', d: 1, name: 'Forgot My Glasses',
    desc: 'Everything is blurry.',
    style(g, s, st) { if (g.state === 'play') st.filter += ' blur(2.2px)'; },
  });
  let noise = null;
  challenge({
    id: 'reception', d: 1, name: 'Bad Reception',
    desc: 'There’s static on the line.',
    overlay(g, s, c) {
      if (!noise) {
        noise = document.createElement('canvas');
        noise.width = noise.height = 128;
        const n = noise.getContext('2d'), img = n.createImageData(128, 128);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 255;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = Math.random() < 0.5 ? 120 : 0;
        }
        n.putImageData(img, 0, 0);
      }
      const k = 0.35 + 0.35 * Math.max(0, Math.sin(g.t / 1300));
      c.save();
      c.globalAlpha = k;
      const ox = Math.random() * 128, oy = Math.random() * 128;
      for (let y = -oy; y < 400; y += 128) for (let x = -ox; x < 400; x += 128) c.drawImage(noise, x, y);
      c.globalAlpha = 0.25;
      c.fillStyle = '#fff';
      c.fillRect(0, (g.t / 4) % 440 - 40, 400, 18);
      c.restore();
    },
  });
  challenge({
    id: 'glitch', d: 1, name: 'Corrupted Save File',
    desc: 'The screen glitches. Hopefully it’s nothing.',
    overlay(g, s, c) {
      if (g.state !== 'play') return;
      if (everyMs(g, s, 'next', 600, 2200)) s.until = g.t + 120 + Math.random() * 220;
      if (g.t >= (s.until || 0)) return;
      const d = g.dpr;
      for (let i = 0; i < 4; i++) {
        const sy = Math.random() * 380, sh = 4 + Math.random() * 30, dx = (Math.random() - 0.5) * 50;
        c.drawImage(g.canvas, 0, sy * d, 400 * d, sh * d, dx, sy, 400, sh);
      }
      c.fillStyle = g.pick(['rgba(255,0,80,0.25)', 'rgba(0,255,200,0.25)', 'rgba(80,80,255,0.25)']);
      c.fillRect(0, Math.random() * 400, 400, 2 + Math.random() * 6);
    },
  });

  // ═════════════════════════ COSMETIC ═════════════════════════

  challenge({ id: 'bighead', d: 0, name: 'Big Head Mode', desc: 'Your head is enormous. Your body is not.', style(g, s, st) { st.headScale = 2.1; } });
  challenge({ id: 'googly', d: 0, name: 'Googly Eyes', desc: 'Everything gets googly eyes.', style(g, s, st) { st.eyes = 'googly'; st.foodEyes = true; } });
  challenge({
    id: 'gentleman', group: 'hat', d: 0, name: 'Distinguished Gentleman',
    desc: 'A top hat, a monocle and a fine mustache.',
    style(g, s, st) { st.hat = 'top'; st.mustache = true; st.monocle = true; },
  });
  challenge({
    id: 'choochoo', d: 0, name: 'Choo Choo',
    desc: 'You are a train now.',
    style(g, s, st) { st.train = true; },
    after(g) {
      if (g.tick % 2) return;
      const h = g.head();
      g.particles.push({
        kind: 'puff', x: g.px(h.x), y: g.py(h.y) - g.cell * 0.7, vx: (Math.random() - 0.5) * 10, vy: -22,
        life: 0.9, max: 0.9, color: 'rgba(150,150,150,0.45)', size: g.cell * 0.3,
      });
    },
    eat(g, s, f) { g.say('choo choo!', f.x, f.y, '#2f5d9b'); },
  });
  challenge({ id: 'centipede', d: 0, name: 'Centipede', desc: 'Legs. So many legs.', style(g, s, st) { st.legs = true; } });
  challenge({
    id: 'birthday', group: 'hat', d: 0, name: 'Birthday Party',
    desc: 'Party hat on. Every snack sets off confetti.',
    style(g, s, st) { st.hat = 'party'; },
    eat(g, s, f) { g.confettiAt(f.x, f.y, 30); },
  });
  challenge({
    id: 'ghosttown', d: 0, name: 'Ghost Town',
    desc: 'Tumbleweeds roll by. Nobody else is here.',
    draw(g, s, c) {
      s.weeds = s.weeds || [];
      if (g.state === 'play' && everyMs(g, s, 'next', 1500, 4000)) {
        s.weeds.push({ y: g.oy + Math.random() * g.H * g.cell, x: -30, v: 70 + Math.random() * 60, r: 8 + Math.random() * 6 });
      }
      s.weeds = s.weeds.filter(w => w.x < 440);
      for (const w of s.weeds) {
        w.x += w.v * g.dt;
        const bounce = Math.abs(Math.sin(w.x / 25)) * 10;
        c.save();
        c.translate(w.x, w.y - bounce);
        c.rotate(w.x / w.r);
        c.strokeStyle = '#8a6d3b'; c.lineWidth = 1.3;
        for (let i = 0; i < 6; i++) {
          c.beginPath(); c.ellipse(0, 0, w.r, w.r * 0.6, i * 0.55, 0, Math.PI * 2); c.stroke();
        }
        c.restore();
      }
    },
  });

  // ═════════════════════════ HAZARDS ═════════════════════════

  challenge({
    id: 'rival', group: 'opponent', d: 2, name: 'Rival Snake',
    desc: 'Another snake is after your food. Don’t touch it.',
    setup(g) {
      const r = {
        owner: 'rival', body: [], dir: { x: 1, y: 0 }, dead: 0, grow: 0,
        spawn() {
          const c = g.randFree({ minDist: 8, strict: true });
          if (!c) { this.dead = 20; return; }
          this.body = [c, { x: c.x, y: c.y }, { x: c.x, y: c.y }];
          this.dir = g.pick(g.DIRS);
          this.grow = 0;
        },
        on(x, y, skipTail) {
          const n = this.body.length - (skipTail ? 1 : 0);
          for (let i = 0; i < n; i++) if (this.body[i].x === x && this.body[i].y === y) return true;
          return false;
        },
        crash() {
          this.body.forEach(p => g.puff(p.x, p.y, 'rgba(47,93,155,0.5)'));
          this.body = [];
          this.dead = 25;
        },
        update() {
          if (this.dead > 0) { if (--this.dead === 0) this.spawn(); return; }
          const h = this.body[0];
          const blocked = (x, y) => !g.inBounds(x, y) || g.rockAt(x, y) || g.onSnake(x, y) >= 0 ||
            this.on(x, y, true) || g.hazards.some(o => o !== this && o.hit && o.hit(x, y));
          let d = g.path(h, g.foods, blocked, false);
          if (!d || blocked(h.x + d.x, h.y + d.y)) {
            const opts = g.DIRS.filter(o => !(o.x === -this.dir.x && o.y === -this.dir.y) && !blocked(h.x + o.x, h.y + o.y));
            d = opts.length ? g.pick(opts) : null;
          }
          if (!d) { this.crash(); return; }
          this.dir = d;
          const n = { x: h.x + d.x, y: h.y + d.y };
          this.body.unshift(n);
          const fi = g.foodAt(n.x, n.y);
          if (fi >= 0) {
            g.foods.splice(fi, 1);
            this.grow++;
            g.say(g.pick(['mine!', 'too slow', 'yoink']), n.x, n.y, '#2f5d9b');
          }
          if (this.grow > 0) this.grow--; else this.body.pop();
        },
        hit(x, y) { return this.on(x, y) ? 'you ran into the rival snake' : null; },
        draw(c) {
          if (this.body.length) g.drawSnakeBody(c, this.body, this.dir, { color: '#2f5d9b', angry: true, seed: 900 });
        },
      };
      r.spawn();
      g.hazards.push(r);
    },
  });
  challenge({
    id: 'haunted', d: 2, name: 'Haunted',
    desc: 'A ghost drifts slowly toward you. It goes through walls.',
    setup(g) {
      const h = g.head();
      const corners = [{ x: 0, y: 0 }, { x: g.W - 1, y: 0 }, { x: 0, y: g.H - 1 }, { x: g.W - 1, y: g.H - 1 }];
      const start = corners.sort((a, b) => g.dist(b, h) - g.dist(a, h))[0];
      g.hazards.push({
        owner: 'haunted', layer: 'over', x: start.x, y: start.y, fx: g.px(start.x), fy: g.py(start.y),
        update() {
          if (g.tick % 3) return;
          const h = g.head(), dx = h.x - this.x, dy = h.y - this.y;
          if (Math.abs(dx) >= Math.abs(dy)) this.x += Math.sign(dx); else this.y += Math.sign(dy);
        },
        hit(x, y) { return x === this.x && y === this.y ? 'a ghost got you' : null; },
        draw(c) {
          const k = 1 - Math.pow(0.002, g.dt);
          this.fx += (g.px(this.x) - this.fx) * k; this.fy += (g.py(this.y) - this.fy) * k;
          const x = this.fx, y = this.fy + Math.sin(g.t / 300) * g.cell * 0.12, r = g.cell * 0.48;
          c.save();
          c.globalAlpha = 0.85;
          c.fillStyle = '#fbfbf8'; c.strokeStyle = '#8a8a84'; c.lineWidth = 1;
          c.beginPath();
          c.arc(x, y - r * 0.15, r, Math.PI, 0);
          c.lineTo(x + r, y + r * 0.8);
          for (let i = 0; i < 4; i++) c.lineTo(x + r - (i + 0.5) * r / 2, y + r * (i % 2 ? 0.8 : 0.45));
          c.lineTo(x - r, y + r * 0.8);
          c.closePath(); c.fill(); c.stroke();
          c.fillStyle = '#1a1a18';
          circle(c, x - r * 0.35, y - r * 0.25, r * 0.15); circle(c, x + r * 0.35, y - r * 0.25, r * 0.15);
          c.restore();
        },
      });
    },
  });
  challenge({
    id: 'roombas', d: 1, name: 'Roombas',
    desc: 'Robot vacuums patrol the floor. They will not yield.',
    setup(g) {
      const bots = [];
      for (let i = 0; i < 3; i++) {
        const c = g.randFree({ minDist: 6, avoidAhead: true });
        if (c) bots.push({ x: c.x, y: c.y, d: g.pick(g.DIRS) });
      }
      g.hazards.push({
        owner: 'roombas', bots,
        update() {
          if (g.tick % 2) return;
          for (const b of bots) {
            const free = d => {
              const x = b.x + d.x, y = b.y + d.y;
              return g.inBounds(x, y) && !g.rockAt(x, y) && g.onSnake(x, y, 1) < 0 && !bots.some(o => o.x === x && o.y === y);
            };
            if (!free(b.d) || g.chance(0.05)) {
              const opts = g.DIRS.filter(free);
              if (!opts.length) continue;
              b.d = g.pick(opts);
            }
            b.x += b.d.x; b.y += b.d.y;
          }
        },
        hit(x, y) { return bots.some(b => b.x === x && b.y === y) ? 'a roomba ran you over' : null; },
        draw(c) {
          for (const b of bots) {
            const x = g.px(b.x), y = g.py(b.y), r = g.cell * 0.44;
            c.fillStyle = '#3a3a38'; circle(c, x, y, r);
            c.fillStyle = '#5a5a56'; circle(c, x, y, r * 0.7);
            c.fillStyle = Math.floor(g.t / 400) % 2 ? '#3fd16b' : '#1f8a40';
            circle(c, x + b.d.x * r * 0.45, y + b.d.y * r * 0.45, r * 0.15);
          }
        },
      });
    },
  });
  challenge({
    id: 'lasers', d: 2, name: 'Laser Grid',
    desc: 'Lasers sweep the board. They slice right through you.',
    setup(g, s) {
      s.next = g.tick + 20;
      const on = (b, p) => (b.horiz ? p.y === b.i : p.x === b.i);
      g.hazards.push({
        owner: 'lasers',
        update() {
          const b = s.beam;
          if (!b) {
            if (g.tick >= s.next) {
              const horiz = g.chance(0.5);
              s.beam = { horiz, i: g.rand(horiz ? g.H : g.W), warn: g.tick + 9, end: g.tick + 13 };
            }
            return;
          }
          if (g.tick >= b.end) { s.beam = null; s.next = g.tick + 10 + g.rand(20); return; }
          if (g.tick === b.warn) g.sfx('zap');
          if (g.tick < b.warn) return;
          const idx = g.snake.findIndex((p, i) => i > 0 && on(b, p));
          if (idx > 0) {
            g.cut(idx);
            g.say('sliced!', null, null, '#b8322a');
          }
        },
        hit(x, y) {
          const b = s.beam;
          return b && g.tick >= b.warn && on(b, { x, y }) ? 'you got lasered' : null;
        },
        draw(c) {
          const b = s.beam;
          if (!b) return;
          const firing = g.tick >= b.warn;
          const len = (b.horiz ? g.W : g.H) * g.cell;
          const x = b.horiz ? g.ox : g.ox + b.i * g.cell, y = b.horiz ? g.oy + b.i * g.cell : g.oy;
          c.save();
          if (firing) {
            c.shadowColor = '#ff3b3b'; c.shadowBlur = 14;
            c.fillStyle = 'rgba(255,60,60,0.9)';
            const t = g.cell * 0.35;
            if (b.horiz) c.fillRect(x, y + (g.cell - t) / 2, len, t); else c.fillRect(x + (g.cell - t) / 2, y, t, len);
            c.fillStyle = '#fff';
            if (b.horiz) c.fillRect(x, y + g.cell / 2 - 1, len, 2); else c.fillRect(x + g.cell / 2 - 1, y, 2, len);
          } else if (Math.floor(g.t / 120) % 2) {
            c.fillStyle = 'rgba(255,60,60,0.18)';
            if (b.horiz) c.fillRect(x, y, len, g.cell); else c.fillRect(x, y, g.cell, len);
            c.strokeStyle = 'rgba(200,40,40,0.7)'; c.setLineDash([4, 4]); c.lineWidth = 1;
            c.beginPath();
            if (b.horiz) { c.moveTo(x, y + g.cell / 2); c.lineTo(x + len, y + g.cell / 2); }
            else { c.moveTo(x + g.cell / 2, y); c.lineTo(x + g.cell / 2, y + len); }
            c.stroke();
          }
          c.restore();
        },
      });
    },
  });
  challenge({
    id: 'meteors', d: 1, name: 'Meteor Shower',
    desc: 'Rocks fall from the sky. Watch for the shadows.',
    setup(g) {
      const hz = {
        owner: 'meteors', list: [],
        update() {
          if (g.tick % 9 === 0) {
            const c = g.randFree({ minDist: 3 });
            if (c) { c.land = g.tick + 10; this.list.push(c); }
          }
          this.list = this.list.filter(m => {
            if (g.tick < m.land) return true;
            g.shake = Math.max(g.shake, 5);
            g.sfx('thud');
            g.burst(m.x, m.y, '#8a6d3b', 10);
            const i = g.onSnake(m.x, m.y);
            if (i === 0) { g.hurt('you were flattened by a meteor', 'hazard'); return false; }
            if (i > 0) { g.cut(i); g.say('crunch', m.x, m.y, '#8a6d3b'); }
            const fi = g.foodAt(m.x, m.y);
            if (fi >= 0) g.foods.splice(fi, 1);
            g.addRock(m.x, m.y, { kind: 'asteroid', owner: 'meteors', until: g.tick + 70, reason: 'you hit a fallen meteor' });
            return false;
          });
        },
        occupies(x, y) { return this.list.some(m => m.x === x && m.y === y); },
        draw(c) {
          for (const m of this.list) {
            const k = 1 - (m.land - g.tick) / 10, x = g.px(m.x), y = g.py(m.y);
            c.fillStyle = 'rgba(0,0,0,' + (0.1 + 0.25 * k) + ')';
            c.beginPath(); c.ellipse(x, y, g.cell * 0.5 * k, g.cell * 0.3 * k, 0, 0, Math.PI * 2); c.fill();
            if (k > 0.65) {
              const off = (1 - k) * 160;
              c.strokeStyle = 'rgba(232,89,12,0.7)'; c.lineWidth = 3;
              c.beginPath(); c.moveTo(x + off, y - off * 1.4); c.lineTo(x + off + 18, y - off * 1.4 - 26); c.stroke();
              c.fillStyle = '#6d5a43'; circle(c, x + off, y - off * 1.4, g.cell * 0.35);
            }
          }
        },
      };
      g.hazards.push(hz);
    },
  });
  challenge({
    id: 'minefield', d: 2, name: 'Minefield',
    desc: 'Hidden mines. You can only spot the ones near you.',
    setup(g) {
      const hz = {
        owner: 'minefield', mines: [],
        hit(x, y) { return this.mines.some(m => m.x === x && m.y === y) ? 'you stepped on a mine' : null; },
        draw(c) {
          const h = g.head(), all = g.has('flashlight');
          for (const m of this.mines) {
            const d = g.dist(m, h);
            const a = all ? 1 : d <= 2 ? 1 : d === 3 ? 0.45 : d === 4 ? 0.15 : 0;
            if (!a) continue;
            const x = g.px(m.x), y = g.py(m.y), r = g.cell * 0.3;
            c.save();
            c.globalAlpha = a;
            c.strokeStyle = '#2a2a28'; c.lineWidth = Math.max(1, g.cell * 0.08);
            for (let i = 0; i < 4; i++) {
              const an = i * Math.PI / 4;
              c.beginPath(); c.moveTo(x - Math.cos(an) * r * 1.4, y - Math.sin(an) * r * 1.4); c.lineTo(x + Math.cos(an) * r * 1.4, y + Math.sin(an) * r * 1.4); c.stroke();
            }
            c.fillStyle = '#2a2a28'; circle(c, x, y, r);
            c.fillStyle = Math.floor(g.t / 300) % 2 ? '#ff3b3b' : '#7a1010'; circle(c, x, y, r * 0.35);
            c.restore();
          }
        },
      };
      g.hazards.push(hz);
      const n = Math.round(g.W * g.H * 0.025);
      for (let i = 0; i < n; i++) {
        const c = g.randFree({ minDist: 5, avoidAhead: true });
        if (c) hz.mines.push(c);
      }
    },
  });
  challenge({
    id: 'twin', group: 'opponent', d: 2, name: 'Evil Twin',
    desc: 'A mirror-image twin copies your every move. Either of you can eat. Don’t touch.',
    canStart(g) {
      const mid = (g.W - 1) / 2, side = Math.sign(g.head().x - mid);
      const h = g.head(), clear = i => !g.rockAt(g.W - 1 - (h.x + g.dir.x * i), h.y + g.dir.y * i);
      return side !== 0 && Math.abs(h.x - mid) >= 2.5 && g.snake.every(p => Math.sign(p.x - mid) === side) &&
        !g.snake.some(p => g.rockAt(g.W - 1 - p.x, p.y)) && clear(1) && clear(2) && clear(3);
    },
    setup(g) {
      g.hazards.push({
        owner: 'twin',
        body() { return g.snake.map(p => ({ x: g.W - 1 - p.x, y: p.y })); },
        hit(x, y) { return g.snake.some(p => g.W - 1 - p.x === x && p.y === y) ? 'you collided with your evil twin' : null; },
        draw(c) { g.drawSnakeBody(c, this.body(), { x: -g.dir.x, y: g.dir.y }, { color: '#7a1f1f', angry: true, seed: 400 }); },
      });
    },
    after(g) {
      const h = g.head(), t = { x: g.W - 1 - h.x, y: h.y };
      if (g.rockAt(t.x, t.y)) { g.hurt('your evil twin hit a rock', 'hazard'); return; }
      const fi = g.foodAt(t.x, t.y);
      if (fi >= 0) g.eat(fi);
    },
  });
  challenge({
    id: 'seagulls', d: 1, name: 'Seagulls',
    desc: 'Seagulls swoop in and steal your snacks.',
    setup(g) {
      const gulls = [0, 1].map(i => ({ x: -2, y: 3 + i * 8, wait: 25 + i * 30, leaving: false, tx: 0, ty: 0 }));
      g.hazards.push({
        owner: 'seagulls', layer: 'over',
        update() {
          for (const b of gulls) {
            if (b.wait > 0) {
              if (--b.wait === 0) {
                const side = g.rand(4);
                b.x = side === 0 ? -1 : side === 1 ? g.W : g.rand(g.W);
                b.y = side === 2 ? -1 : side === 3 ? g.H : g.rand(g.H);
                b.leaving = false;
              }
              continue;
            }
            let tx, ty;
            if (b.leaving) { tx = b.tx; ty = b.ty; }
            else {
              const f = g.foods.slice().sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
              if (!f) continue;
              tx = f.x; ty = f.y;
            }
            const dx = tx - b.x, dy = ty - b.y, dist = Math.hypot(dx, dy);
            const v = 0.42;
            if (dist <= v) {
              b.x = tx; b.y = ty;
              if (b.leaving) { b.wait = 35 + g.rand(30); continue; }
              const fi = g.foodAt(Math.round(tx), Math.round(ty));
              if (fi >= 0) {
                g.foods.splice(fi, 1);
                g.say('STOLEN', tx, ty, '#2f5d9b');
                b.leaving = true;
                b.tx = g.chance(0.5) ? -3 : g.W + 2; b.ty = g.rand(g.H);
              }
            } else { b.x += dx / dist * v; b.y += dy / dist * v; }
          }
        },
        draw(c) {
          for (const b of gulls) {
            if (b.wait > 0) continue;
            const x = g.ox + (b.x + 0.5) * g.cell, y = g.oy + (b.y + 0.5) * g.cell;
            const flap = Math.sin(g.t / 90) * g.cell * 0.25, w = g.cell * 0.7;
            c.save();
            c.strokeStyle = '#3a3a38'; c.lineWidth = Math.max(1.5, g.cell * 0.1); c.lineCap = 'round';
            c.fillStyle = '#fff';
            c.beginPath(); c.ellipse(x, y, g.cell * 0.22, g.cell * 0.14, 0, 0, Math.PI * 2); c.fill(); c.stroke();
            c.beginPath();
            c.moveTo(x - w, y - flap); c.quadraticCurveTo(x - w / 2, y - g.cell * 0.35, x, y);
            c.quadraticCurveTo(x + w / 2, y - g.cell * 0.35, x + w, y - flap);
            c.stroke();
            c.restore();
          }
        },
      });
    },
  });

  // ═════════════════════════ WORDS & NUMBERS ═════════════════════════

  challenge({
    id: 'comicsans', group: 'font', d: 0, name: 'Font Crimes',
    desc: 'Everything is in Comic Sans.',
    style(g, s, st) { st.font = '"Comic Sans MS","Comic Sans","Comic Neue","Chalkboard SE",cursive'; },
  });
  const pig = str => str.replace(/[A-Za-z’']+/g, w => {
    if (w.length < 2) return w;
    const lower = w.toLowerCase(), m = lower.match(/^([^aeiou]*)(.*)$/);
    let out = !m[1] ? lower + 'way' : m[2] ? m[2] + m[1] + 'ay' : lower + 'ay';
    if (w === w.toUpperCase()) out = out.toUpperCase();
    else if (w[0] !== lower[0]) out = out[0].toUpperCase() + out.slice(1);
    return out;
  });
  challenge({ id: 'piglatin', group: 'lang', d: 0, name: 'Ig-pay Atin-lay', desc: 'All the text is in Pig Latin.', text: (g, s, str) => pig(str) });
  const PIRATE = {
    you: 'ye', your: 'yer', 'you’re': 'ye be', is: 'be', are: 'be', the: 'th’', my: 'me', level: 'voyage',
    score: 'booty', eaten: 'plundered', snack: 'grub', snacks: 'grub', press: 'smash', hello: 'ahoy',
    best: 'finest', game: 'voyage', over: 'sunk', to: 't’', of: 'o’', and: 'an’', wall: 'reef',
  };
  challenge({
    id: 'pirate', group: 'lang', d: 0, name: 'Talk Like a Pirate',
    desc: 'Arr.',
    text: (g, s, str) => str.replace(/[A-Za-z’]+/g, w => {
      const r = PIRATE[w.toLowerCase()];
      if (!r) return w;
      return w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? r[0].toUpperCase() + r.slice(1) : r;
    }),
  });
  challenge({
    id: 'shouting', group: 'lang', d: 0, name: 'Caps Lock',
    desc: 'SOMEONE LEFT CAPS LOCK ON.',
    text: (g, s, str) => (/[a-z]/i.test(str) ? str.toUpperCase().replace(/([A-Z])$/, '$1!!!') : str),
  });
  const romanSmall = n => {
    const R = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [v, sym] of R) while (n >= v) { out += sym; n -= v; }
    return out;
  };
  const roman = n => {
    if (n === 0) return 'nulla';
    if (n < 0) return '−' + roman(-n);
    if (n >= 4000) return romanSmall(Math.floor(n / 1000)).split('').map(ch => ch + '̅').join('') + romanSmall(n % 1000);
    return romanSmall(n);
  };
  challenge({ id: 'spqr', group: 'num', d: 0, name: 'SPQR', desc: 'All numbers are in Roman numerals.', num: (g, s, n) => (typeof n === 'number' ? roman(Math.round(n)) : n) });
  const UNITS = [['furlongs', 1 / 220], ['fathoms', 1 / 6], ['hogsheads', 1 / 63], ['stone', 1 / 14], ['gills', 4], ['rods', 1 / 16.5], ['bushels', 1 / 8], ['chains', 1 / 66], ['scruples', 24]];
  challenge({
    id: 'imperial', group: 'num', d: 0, name: 'Imperial Units',
    desc: 'All numbers are in baffling units.',
    num(g, s, n) {
      if (typeof n !== 'number') return n;
      const [name, k] = UNITS[Math.abs(Math.round(n)) % UNITS.length];
      return (+(n * k).toFixed(2)).toLocaleString() + ' ' + name;
    },
  });
  challenge({
    id: 'hyperinflation', group: 'points', d: 0, name: 'Hyperinflation',
    desc: 'Every snack is worth a million points. Points mean nothing.',
    eat(g, s, f, res) { res.points *= 100000; },
  });
  challenge({
    id: 'daytrader', group: 'points', d: 0, name: 'Day Trader',
    desc: 'Snack prices swing wildly. Some are worth negative points.',
    eat(g, s, f, res) {
      const v = Math.round((Math.random() * 1.6 - 0.45) * 100);
      res.points = v;
      g.say((v >= 0 ? '+$' : '−$') + Math.abs(v), f.x, f.y, v >= 0 ? '#3d7a3a' : '#b8322a');
    },
    tick(g, s) {
      if (g.tick % 25) return;
      const p = (Math.random() * 30 - 12).toFixed(1);
      g.comment('SNAK ' + (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p) + '%   ·   APPL ' + (Math.random() < 0.5 ? '▲' : '▼') + ' ' + (Math.random() * 9).toFixed(1) + '%');
    },
  });

  // Narrators: each one comments on what happens.
  function narrator(id, name, desc, lines) {
    challenge({
      id, group: 'voice', d: 0, name, desc,
      event(g, s, ev) {
        const L = lines[ev];
        if (!L) return;
        if (g.t < (s.quiet || 0) && ev !== 'start' && ev !== 'die') return;
        s.quiet = g.t + 2600;
        g.comment(g.pick(L));
      },
      tick(g, s) { if (g.tick % 70 === 35 && g.t >= (s.quiet || 0)) g.comment(g.pick(lines.idle)); },
    });
  }
  narrator('commentator', 'Sports Commentator', 'A very excited man is calling the game.', {
    start: ['And they’re off!', 'What a night for snake, folks.', 'The crowd is on its feet!'],
    eat: ['WHAT A GRAB!', 'Textbook bite. Textbook.', 'That’s going in the highlight reel.', 'Oh, you love to see it.', 'Clinical finishing from the snake.', 'Absolutely ravenous out there tonight.'],
    close: ['OH! Inches from disaster!', 'My heart can’t take this.', 'Did you SEE that turn?', 'That was closer than my mortgage payment.'],
    pickup: ['A power-up! The crowd goes wild!', 'Ooh, what’s in the box?', 'That changes everything. Maybe.'],
    long: ['Look at the LENGTH on that snake!', 'They’re going to need a bigger board.'],
    change: ['The rules have changed! Can the snake adapt?', 'A shocking change from the referees!', 'Nobody saw that coming, folks.'],
    idle: ['Looking for an opening here…', 'Patient snake. Very patient.', 'Fun fact: snakes cannot clap.', 'Still anyone’s game.', 'The food is looking nervous.'],
    die: ['OH NO. OH NO NO NO.', 'And it’s all over!', 'That’s going to leave a mark.', 'A tragic end to a beautiful run.'],
  });
  narrator('nature', 'Nature Documentary', 'A hushed British narrator observes you in your natural habitat.', {
    start: ['Here, in the tall grass, the snake begins its hunt.', 'Dawn. The snake stirs.'],
    eat: ['Remarkable. The snake swallows its prey whole.', 'Nature is brutal. Delicious, but brutal.', 'The apple never stood a chance.', 'A successful hunt. The snake will eat well tonight.'],
    close: ['The snake narrowly avoids catastrophe. We dare not intervene.', 'Even the most experienced snake is not immune to error.'],
    pickup: ['A rare find. Few snakes ever witness such a thing.'],
    long: ['The snake has grown impressively long. A true elder of the grid.'],
    change: ['The seasons turn. The snake must adapt, or perish.', 'A sudden change in the habitat.'],
    idle: ['We must remain very quiet now.', 'The snake surveys its territory.', 'Notice how the tail follows the head. Every time.', 'Snakes have no eyelids. This one has seen things.'],
    die: ['And so the circle of life continues.', 'We must not interfere. That is the rule.', 'A sobering moment for the crew.'],
  });
  narrator('thoughtleader', 'Thought Leader', 'Your snake now posts about every move on LinkedIn.', {
    start: ['Excited to announce I’m starting a new position: snake.', 'Day one. Let’s get after it. Agree?'],
    eat: ['I ate an apple today. Here’s what it taught me about B2B sales. 🧵', 'Grateful for the opportunity to grow (by one square).', 'Huge thanks to the apple for believing in me.', 'Consumed a snack. Not because it was easy, but because it was hard.'],
    close: ['Almost failing is just succeeding with extra steps.', 'Pivot. Pivot. PIVOT.'],
    pickup: ['Thrilled to add a new skill to my profile. Endorse me!'],
    long: ['Humbled to announce I am now very long.'],
    change: ['Big changes at the company. Excited for this next chapter!', 'Restructuring is just growth in disguise.'],
    idle: ['Rise and grind. Slither and grind.', 'Your network is your net worth. My network is 400 squares.', 'Unpopular opinion: walls are bad.', 'I’m not just a snake. I’m a thought leader.'],
    die: ['Failure is just a growth opportunity. I am no longer growing.', 'Personal news: I have been let go (I hit something).'],
  });
  const CHATTY = {
    eat: ['yum', 'nom', 'delicious', 'more please', 'crunchy', 'that was a grape', 'worth it'],
    close: ['eek', 'yikes', 'not today', 'whew'],
    pickup: ['ooh shiny', 'what does this do'],
    idle: ['is this all there is?', 'i have no arms', 'hiss', 'i’m a long boy', 'who keeps leaving apples around', 'do i have a nose?', 'left. no, right.', 'the walls are judging me'],
  };
  challenge({
    id: 'chatty', d: 0, name: 'Inner Monologue',
    desc: 'Your snake has thoughts, and shares them.',
    event(g, s, ev) { if (CHATTY[ev]) s.bubble = { text: g.T(g.pick(CHATTY[ev])), until: g.t + 1800 }; },
    tick(g, s) { if (g.tick % 55 === 20 && !(s.bubble && g.t < s.bubble.until)) s.bubble = { text: g.T(g.pick(CHATTY.idle)), until: g.t + 2200 }; },
    draw(g, s, c) {
      const h = g.head();
      if (!h || !s.bubble || g.t > s.bubble.until) return;
      c.save();
      c.font = 'italic 14px ' + g.style.font;
      const w = c.measureText(s.bubble.text).width + 16;
      let x = g.px(h.x) - w / 2, y = g.py(h.y) - g.cell - 30;
      x = Math.max(4, Math.min(396 - w, x)); y = Math.max(4, y);
      c.fillStyle = 'rgba(255,255,255,0.95)'; c.strokeStyle = '#8a8a84'; c.lineWidth = 1;
      rr(c, x, y, w, 24, 10); c.fill(); c.stroke();
      c.fillStyle = '#1a1a18'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(s.bubble.text, x + w / 2, y + 12.5);
      c.restore();
    },
  });

  // ═════════════════════════ THE INTERNET ═════════════════════════

  const ADS = [
    ['Doctors HATE this snake', 'Local reptile grows 40 feet with one weird trick'],
    ['CONGRATULATIONS!!', 'You are the 1,000,000th snake. Claim your prize'],
    ['Snake Insurance', 'Plans from $0.99 per segment'],
    ['Download More RAM', 'Your snake is running low on memory'],
    ['Hungry apples', 'in YOUR area want to meet you'],
    ['Your extended warranty', 'We have been trying to reach you'],
    ['Learn Python', 'Become a better snake in 30 days'],
    ['1 New Message', 'From: Mom. “are you eating enough”'],
    ['Is your snake a noodle?', 'Take this two-minute quiz'],
  ];
  challenge({
    id: 'ads', d: 1, name: 'Free Trial',
    desc: 'Your free trial has ended. Enjoy the pop-up ads.',
    overlay(g, s, c) {
      s.ads = (s.ads || []).filter(a => g.t < a.until);
      if (g.state === 'play' && s.ads.length < 2 && everyMs(g, s, 'next', 2500, 5500)) {
        const w = 200, h = 112;
        s.ads.push({ x: 10 + Math.random() * (380 - w), y: 10 + Math.random() * (380 - h), w, h, born: g.t, until: g.t + 3800, ad: g.pick(ADS) });
      }
      for (const a of s.ads) {
        const k = Math.min(1, (g.t - a.born) / 160);
        c.save();
        c.translate(a.x + a.w / 2, a.y + a.h / 2); c.scale(0.6 + 0.4 * ease(k), 0.6 + 0.4 * ease(k)); c.translate(-a.w / 2, -a.h / 2);
        c.shadowColor = 'rgba(0,0,0,0.3)'; c.shadowBlur = 12; c.shadowOffsetY = 4;
        c.fillStyle = '#fffdf0'; c.fillRect(0, 0, a.w, a.h);
        c.shadowBlur = 0; c.shadowOffsetY = 0;
        c.fillStyle = '#1f4fbf'; c.fillRect(0, 0, a.w, 20);
        c.fillStyle = '#fff'; c.font = '600 12px Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillText('ADVERTISEMENT', 7, 10.5);
        c.textAlign = 'right'; c.fillText('✕ ' + Math.ceil((a.until - g.t) / 1000), a.w - 6, 10.5);
        c.fillStyle = '#c4161c'; c.font = '700 15px Arial, sans-serif'; c.textAlign = 'center';
        c.fillText(a.ad[0], a.w / 2, 37);
        c.fillStyle = '#222'; c.font = '12px Arial, sans-serif';
        wrapLines(c, a.ad[1], a.w - 16).slice(0, 2).forEach((l, i) => c.fillText(l, a.w / 2, 57 + i * 14));
        c.fillStyle = Math.floor(g.t / 250) % 2 ? '#ffd400' : '#ffb700';
        rr(c, a.w / 2 - 45, a.h - 26, 90, 19, 4); c.fill();
        c.fillStyle = '#111'; c.font = '700 11px Arial, sans-serif'; c.fillText('CLAIM NOW', a.w / 2, a.h - 16);
        c.restore();
      }
    },
  });
  challenge({
    id: 'cookies', d: 1, name: 'Cookie Banner',
    desc: 'A giant cookie banner covers the bottom of the screen. Eat a snack to accept.',
    setup(g, s) { s.show = true; s.y = 1; },
    eat(g, s) { s.show = false; s.back = g.tick + 30; },
    tick(g, s) { if (!s.show && g.tick >= s.back) s.show = true; },
    overlay(g, s, c) {
      const target = s.show ? 1 : 0;
      s.y += (target - s.y) * (1 - Math.pow(0.001, g.dt));
      if (s.y < 0.01) return;
      const h = 150, y = 400 - h * s.y;
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.25)'; c.shadowBlur = 14;
      c.fillStyle = '#ffffff'; c.fillRect(0, y, 400, h);
      c.shadowBlur = 0;
      c.fillStyle = '#111'; c.font = '700 15px Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText('🍪 We value your privacy', 16, y + 14);
      c.font = '12px Arial, sans-serif'; c.fillStyle = '#444';
      wrapLines(c, 'We and our 847 partners use cookies to remember where your tail is, personalise your apples and sell your turning habits. Eat a snack to accept all.', 368)
        .forEach((l, i) => c.fillText(l, 16, y + 38 + i * 15));
      c.fillStyle = '#1f4fbf'; rr(c, 16, y + h - 40, 110, 26, 5); c.fill();
      c.fillStyle = '#fff'; c.font = '700 12px Arial, sans-serif'; c.textAlign = 'center';
      c.fillText('Accept all', 71, y + h - 33);
      c.fillStyle = '#888'; c.font = '11px Arial, sans-serif';
      c.fillText('Manage preferences (opens 300 pages)', 262, y + h - 32);
      c.restore();
    },
  });
  challenge({
    id: 'buffering', d: 1, name: 'Buffering…',
    desc: 'The game freezes every so often. Your key presses still count.',
    frozen: (g, s) => g.t < (s.until || 0),
    overlay(g, s, c) {
      if (g.state === 'play' && everyMs(g, s, 'next', 4000, 8000)) s.until = g.t + 900 + Math.random() * 700;
      if (g.t >= (s.until || 0)) return;
      c.save();
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 0, 400, 400);
      c.strokeStyle = '#fff'; c.lineWidth = 4; c.lineCap = 'round';
      const a = g.t / 120;
      c.beginPath(); c.arc(C, C - 10, 20, a, a + 4.4); c.stroke();
      c.fillStyle = '#fff'; c.font = '15px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('buffering…', C, C + 30);
      c.restore();
    },
  });
  const TIPS = [
    'It looks like you’re trying to eat an apple. Would you like help?',
    'Tip: try not to die.',
    'Have you considered being longer?',
    'Tip: the walls are load-bearing.',
    'Did you know? You can press keys.',
    'It looks like you’re turning. Would you like to turn?',
    'I see you’re a snake. Would you like to be a different animal?',
    'Tip: snacks are found where the snacks are.',
  ];
  challenge({
    id: 'assistant', d: 0, name: 'Helpful Assistant',
    desc: 'A paperclip would like to help. It will not help.',
    overlay(g, s, c) {
      if (s.i == null || everyMs(g, s, 'next', 4500, 4500)) { s.i = ((s.i == null ? -1 : s.i) + 1) % TIPS.length; s.at = g.t; }
      const k = Math.min(1, (g.t - s.at) / 250);
      const w = 168, x = 400 - w - 8, y = 8 - (1 - ease(k)) * 10;
      c.save();
      c.globalAlpha = k;
      c.font = '12px Arial, sans-serif';
      const lines = wrapLines(c, g.T(TIPS[s.i]), w - 46);
      const h = Math.max(46, 16 + lines.length * 15);
      c.fillStyle = '#ffffe1'; c.strokeStyle = '#555'; c.lineWidth = 1;
      rr(c, x, y, w, h, 6); c.fill(); c.stroke();
      c.font = '24px "Noto Color Emoji","Apple Color Emoji",sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'center';
      c.fillText('📎', x + 20, y + 22 + Math.sin(g.t / 200) * 2);
      c.fillStyle = '#222'; c.font = '12px Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
      lines.forEach((l, i) => c.fillText(l, x + 38, y + 8 + i * 15));
      c.restore();
    },
  });

  // ═════════════════════════ WEATHER ═════════════════════════

  challenge({
    id: 'blizzard', group: 'weather', d: 1, name: 'Blizzard',
    desc: 'It’s snowing. A lot.',
    overlay(g, s, c) {
      if (!s.flakes) s.flakes = Array.from({ length: 140 }, () => ({ x: Math.random() * 400, y: Math.random() * 400, r: 1 + Math.random() * 3, v: 30 + Math.random() * 60, p: Math.random() * 6 }));
      c.save();
      c.fillStyle = 'rgba(90,110,140,0.16)'; c.fillRect(0, 0, 400, 400);
      c.fillStyle = 'rgba(255,255,255,0.95)';
      c.shadowColor = 'rgba(0,0,0,0.25)'; c.shadowBlur = 2;
      for (const f of s.flakes) {
        f.y += f.v * g.dt; f.x += Math.sin(g.t / 700 + f.p) * 20 * g.dt - 14 * g.dt;
        if (f.y > 404) { f.y = -4; f.x = Math.random() * 440; }
        if (f.x < -4) f.x = 404;
        circle(c, f.x, f.y, f.r);
      }
      c.restore();
    },
  });
  challenge({
    id: 'thunderstorm', group: 'weather', d: 1, name: 'Thunderstorm',
    desc: 'Dark skies, heavy rain and the occasional bolt of lightning.',
    overlay(g, s, c) {
      if (!s.drops) s.drops = Array.from({ length: 90 }, () => ({ x: Math.random() * 400, y: Math.random() * 400, v: 380 + Math.random() * 200 }));
      c.save();
      c.fillStyle = 'rgba(20,25,45,0.38)'; c.fillRect(0, 0, 400, 400);
      c.strokeStyle = 'rgba(180,200,230,0.5)'; c.lineWidth = 1;
      c.beginPath();
      for (const d of s.drops) {
        d.y += d.v * g.dt; d.x -= d.v * 0.15 * g.dt;
        if (d.y > 400) { d.y = -10; d.x = Math.random() * 460; }
        c.moveTo(d.x, d.y); c.lineTo(d.x - 2, d.y + 12);
      }
      c.stroke();
      if (g.state === 'play' && everyMs(g, s, 'next', 3500, 8000)) { s.bolt = g.t; setTimeout(() => g.sfx('boom'), 300); }
      const k = 1 - (g.t - (s.bolt || -1e9)) / 500;
      if (k > 0) {
        c.fillStyle = 'rgba(255,255,255,' + (k * (Math.floor(g.t / 60) % 2 ? 0.85 : 0.4)) + ')';
        c.fillRect(0, 0, 400, 400);
      }
      c.restore();
    },
  });

  // ═════════════════════════ POWER-UPS ═════════════════════════

  powerup({
    id: 'shield', icon: '🛡️', weight: 6, dur: Infinity, name: 'Shield',
    desc: 'Survive one crash.',
    save(g) {
      g.deactivate('shield');
      g.activate('ghost', 8, 'power', true);
      g.say('shield broke!', null, null, '#2f5d9b');
      g.sfx('shield');
      g.shake = 6;
      return 'pass';
    },
    draw(g, s, c) {
      const h = g.head();
      if (!h) return;
      c.save();
      c.strokeStyle = 'rgba(47,93,155,' + (0.45 + 0.2 * Math.sin(g.t / 200)) + ')'; c.lineWidth = 2;
      c.beginPath(); c.arc(g.px(h.x), g.py(h.y), g.cell * 0.85, 0, Math.PI * 2); c.stroke();
      c.restore();
    },
  });
  powerup({
    id: 'ghost', icon: '👻', weight: 5, dur: 50, name: 'Ghost',
    desc: 'Pass through walls, rocks and yourself.',
    save: () => 'pass',
    style(g, s, st) { st.snakeAlpha = 0.4; },
  });
  powerup({
    id: 'magnet', icon: '🧲', weight: 6, dur: 60, name: 'Magnet',
    desc: 'Snacks are pulled toward you.',
    tick(g) {
      if (g.tick % 2) return;
      const h = g.head();
      for (const f of g.foods) {
        const dx = h.x - f.x, dy = h.y - f.y;
        const opts = [Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) }];
        opts.push(opts[0].x ? { x: 0, y: Math.sign(dy) } : { x: Math.sign(dx), y: 0 });
        for (const d of opts) {
          if (!d.x && !d.y) continue;
          const c = { x: f.x + d.x, y: f.y + d.y };
          if (g.inBounds(c.x, c.y) && (!g.taken(c.x, c.y) || (c.x === h.x && c.y === h.y))) { f.x = c.x; f.y = c.y; break; }
        }
      }
    },
  });
  powerup({ id: 'slowmo', icon: '🐌', weight: 6, dur: 50, name: 'Slow Motion', desc: 'Time slows down for a while.', speed: (g, s, ms) => ms * 1.8 });
  powerup({
    id: 'scissors', icon: '✂️', weight: 4, name: 'Scissors',
    desc: 'Snip. Half your length, gone.',
    use(g) { g.cut(Math.ceil(g.snake.length / 2)); },
  });
  powerup({
    id: 'double', icon: '⭐', weight: 5, dur: 80, name: 'Double Points',
    desc: 'Every snack is worth twice as much.',
    eat(g, s, f, res) { if (res.points > 0) res.points *= 2; },
  });
  powerup({
    id: 'pinata', icon: '🪅', weight: 4, name: 'Piñata',
    desc: 'Snacks everywhere!',
    use(g) {
      for (let i = 0; i < 8; i++) g.spawnFood();
      const h = g.head();
      g.confettiAt(h.x, h.y, 40);
    },
  });
  powerup({
    id: 'timestop', icon: '⏱️', weight: 3, dur: 50, name: 'Time Stop',
    desc: 'Every hazard freezes in place.',
    when: g => g.hazards.some(h => h.update),
    overlay(g, s, c) { c.fillStyle = 'rgba(80,120,200,0.08)'; c.fillRect(0, 0, 400, 400); },
  });
  powerup({
    id: 'dynamite', icon: '🧨', weight: 3, name: 'Dynamite',
    desc: 'Blows up every rock near you.',
    when: g => g.rocks.size > 0,
    use(g) {
      const h = g.head();
      for (const r of [...g.rocks.values()]) {
        if (Math.hypot(r.x - h.x, r.y - h.y) > 5.5) continue;
        g.removeRock(r.x, r.y);
        g.burst(r.x, r.y, '#e8590c', 6);
      }
      g.shake = 14;
      g.sfx('boom');
      g.say('BOOM', null, null, '#e8590c', true);
    },
  });
  powerup({ id: 'star', icon: '🌟', weight: 6, name: 'Shooting Star', desc: 'Worth fifty points.', use(g) { g.score += 50; } });
  powerup({
    id: 'hallpass', icon: '🎟️', weight: 2, name: 'Hall Pass',
    desc: 'Excuses you from every current challenge, until the next change.',
    when: g => !g.practice && g.levelMods.some(id => !g.BYID[id].size),
    use(g) { g.clearChallenges(); },
  });
  powerup({ id: 'mysterybox', icon: '🎁', weight: 5, name: 'Mystery Box', desc: 'Could be anything. Anything!', use(g) { g.surprise(); } });
  powerup({
    id: 'mushroom', icon: '🍄', weight: 4, curse: true, name: 'Suspicious Mushroom',
    desc: 'Gives you a random challenge for a little while.',
    use(g) { g.curse(70); },
  });
  powerup({
    id: 'discofever', icon: '🪩', weight: 3, dur: 60, name: 'Disco Fever',
    desc: 'Rainbow mode, and snacks are worth double.',
    style(g, s, st) { st.rainbow = true; },
    eat(g, s, f, res) { if (res.points > 0) res.points *= 2; },
  });
  powerup({
    id: 'autopilot', icon: '🤖', weight: 4, dur: 45, name: 'Autopilot',
    desc: 'The snake steers itself toward the nearest snack.',
    steer(g, s, d) {
      g.queue = [];
      const wrap = g.wraps();
      const blocked = (x, y) => g.blockedAt(x, y);
      const nd = g.path(g.head(), g.foods, blocked, wrap);
      if (nd && !(nd.x === -d.x && nd.y === -d.y) && g.safe(nd)) return nd;
      if (g.safe(d)) return d;
      return randomTurn(g, d) || d;
    },
  });
  powerup({
    id: 'wreckingball', icon: '🔨', weight: 3, dur: 60, name: 'Wrecking Ball',
    desc: 'Smash straight through rocks.',
    when: g => g.rocks.size > 0,
    save(g, s, cat, why, head) {
      if (cat !== 'rock') return;
      g.removeRock(head.x, head.y);
      g.burst(head.x, head.y, '#8a8a84', 10);
      g.shake = 5;
      g.sfx('thud');
      return 'pass';
    },
  });
  powerup({
    id: 'tornado', icon: '🌪️', weight: 4, dur: 50, name: 'Tornado Mouth',
    desc: 'Inhale every snack within two squares.',
    after(g) {
      const h = g.head();
      for (let i = g.foods.length - 1; i >= 0; i--) if (g.foods[i] && g.dist(g.foods[i], h) <= 2) g.eat(i);
    },
  });
  powerup({
    id: 'flashlight', icon: '🔦', weight: 4, dur: 90, name: 'Flashlight',
    desc: 'See in the dark, and spot hidden mines.',
    when: g => g.mods.some(m => m.def.group === 'vision' || m.def.id === 'minefield'),
  });
  powerup({
    id: 'radar', icon: '📡', weight: 4, dur: 80, name: 'Snack Radar',
    desc: 'An arrow points you to the nearest snack.',
    draw(g, s, c) {
      const h = g.head();
      if (!h || !g.foods.length) return;
      const f = g.foods.slice().sort((a, b) => g.dist(a, h) - g.dist(b, h))[0];
      const x = g.px(h.x), y = g.py(h.y), a = Math.atan2(g.py(f.y) - y, g.px(f.x) - x);
      c.save();
      c.translate(x + Math.cos(a) * g.cell * 1.2, y + Math.sin(a) * g.cell * 1.2);
      c.rotate(a);
      c.fillStyle = 'rgba(201,154,6,' + (0.7 + 0.3 * Math.sin(g.t / 150)) + ')';
      const s2 = g.cell * 0.4;
      c.beginPath(); c.moveTo(s2, 0); c.lineTo(-s2 * 0.6, -s2 * 0.6); c.lineTo(-s2 * 0.6, s2 * 0.6); c.closePath(); c.fill();
      c.restore();
    },
  });
  powerup({
    id: 'banana', icon: '🍌', weight: 3, curse: true, name: 'Banana Peel',
    desc: 'You slip and spin out.',
    use(g) {
      const nd = randomTurn(g, g.dir);
      if (nd) { g.dir = nd; g.queue = []; }
      g.say('whoa!', null, null, '#c99a06');
      g.shake = 6;
    },
  });
  powerup({
    id: 'coffee', icon: '☕', weight: 4, dur: 50, name: 'Coffee',
    desc: 'Faster, sharper, and every snack is worth double.',
    speed: (g, s, ms) => ms * 0.72,
    eat(g, s, f, res) { if (res.points > 0) res.points *= 2; },
  });
  powerup({
    id: 'timebomb', icon: '💣', weight: 2, dur: 30, curse: true, name: 'Time Bomb',
    desc: 'In a few seconds it explodes, taking half your length with it.',
    cleanup(g, s, expired) {
      if (!expired) return;
      g.cut(Math.ceil(g.snake.length / 2));
      g.shake = 14;
      g.sfx('boom');
      g.say('KABOOM', null, null, '#b8321b', true);
    },
    draw(g, s, c) {
      const t = g.snake[g.snake.length - 1];
      if (!t) return;
      const m = g.mods.find(x => x.def.id === 'timebomb');
      const left = m ? Math.max(0, m.until - g.tick) : 0;
      c.save();
      c.font = Math.round(g.cell * 0.9) + 'px "Noto Color Emoji","Apple Color Emoji",sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('💣', g.px(t.x), g.py(t.y) - g.cell * 0.6);
      c.font = '700 ' + Math.round(g.cell * 0.55) + 'px Arial, sans-serif';
      c.fillStyle = '#b8321b';
      c.fillText(String(Math.ceil(left / 3)), g.px(t.x), g.py(t.y) - g.cell * 1.3);
      c.restore();
    },
  });
  powerup({
    id: 'crown', icon: '👑', weight: 2, dur: Infinity, name: 'Royalty',
    desc: 'A crown, and 500 points. You deserve it.',
    use(g) { g.score += 500; },
    style(g, s, st) { st.hat = 'crown'; },
  });
  powerup({ id: 'cheese', icon: '🧀', weight: 3, name: 'Cheese', desc: 'It does nothing. It’s just cheese.', use(g) { g.say('it’s just cheese', null, null, '#c99a06'); } });
  powerup({ id: 'clover', icon: '🍀', weight: 3, name: 'Four-Leaf Clover', desc: 'Gold snacks start showing up for a while.', use(g) { g.activate('goldrush', 90, 'power'); } });
  powerup({
    id: 'ufo', icon: '🛸', weight: 3, name: 'Abduction',
    desc: 'Aliens beam you up and drop you somewhere else.',
    use(g) {
      if (g.relocate()) { g.sfx('warp'); g.say('beep boop', null, null, '#1f8a70'); }
    },
  });
})();
