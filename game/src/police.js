// police.js — Wanted system + police AI for Solmar City (W3).
//
//   addWanted(state, n, reason) — stars clamped 0..5, heat, stats.wantedMax,
//            {type:'wanted'} event.
//   updateWanted(state, dt) — consumes crime events ({type:'steal'},
//            {type:'gunshot'}, {type:'ped-down'}, {type:'cop-down'});
//            heat decays and stars drop 1 per ~25 s while no police unit
//            can see the player (distance > 520 — line-of-sight is
//            approximated by distance only, per the contract).
//   updatePolice(state, dt) — spawns/pursues cruisers, rams, roadblocks at
//            3+ stars, on-foot cops at 2+ stars when the player is on foot,
//            busted (touch a cop for 2 s) with garage respawn + cash loss.
//   initPolice(state)
//   drawPolice(ctx, state) — on-foot cops, roadblock cones, pursuit markers
//            only. Cruisers live in state.cars (driver 'police') and are
//            drawn by W2's drawCars.
//
// Police cruisers are pushed to state.cars with driver 'police' and a unique
// id (state.rng + a counter on state). On-foot cops go in state.police with
// onFoot:true. state.policeSiren is true while stars > 0 (audio flag for W1).
//
// Events are READ, never cleared, here — main.js drains the array after the
// tick. A _seenEvents watermark keeps a crime event from counting twice.
//
// Deterministic: only state.rng is used. No Date.now(), no Math.random().

import { damagePlayer } from './combat.js';
import {
  nearestRoadPoint as cityNearestRoadPoint,
  isRoad as cityIsRoad,
  collideBuildings as cityCollideBuildings,
} from './city.js';

// ---------------------------------------------------------------------------
// Local deterministic helpers (same small set as missions.js, kept local so
// this module never depends on a file another worker has not landed yet).
// ---------------------------------------------------------------------------

function rngFn(state) {
  if (typeof state.rng === 'function') return state.rng;
  if (state.rng && typeof state.rng.next === 'function') return () => state.rng.next();
  let a = (state.seed | 0) || 123456789;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) | 0;
    return ((a >>> 0) / 4294967296);
  };
}

function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function onRoad(city, x, y) {
  if (!city) return true;
  if (typeof city.isRoad === 'function') {
    try { return !!city.isRoad(x, y); } catch { return true; }
  }
  try {
    return !!cityIsRoad(city, x, y);
  } catch {
    return true;
  }
}

function nearestLine(city, which, v) {
  if (!city || !city.roads) return null;
  const arr = which === 'v' ? city.roads.v || [] : city.roads.h || [];
  let best = null;
  let bd = Infinity;
  for (const e of arr) {
    const n = typeof e === 'number' ? e : (which === 'v' ? (e.x ?? e.x0 ?? e.cx) : (e.y ?? e.y0 ?? e.cy));
    if (typeof n !== 'number') continue;
    const d = Math.abs(n - v);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

export function roadPoint(city, x, y) {
  if (!city) return { x, y };
  let pt = null;
  if (typeof city.nearestRoadPoint === 'function') {
    try {
      const p = city.nearestRoadPoint(x, y);
      if (p && typeof p.x === 'number' && typeof p.y === 'number') pt = { x: p.x, y: p.y };
    } catch { /* fall through */ }
  }
  if (!pt) {
    try {
      const p = cityNearestRoadPoint(city, x, y);
      if (p && typeof p.x === 'number' && typeof p.y === 'number') pt = { x: p.x, y: p.y };
    } catch { /* fall through to the derivation below */ }
  }
  const size = typeof city.size === 'number' ? city.size : 2000;
  const hRoads = [];
  const vRoads = [];
  if (city.roads) {
    for (const e of city.roads.h || []) hRoads.push(typeof e === 'number' ? e : (e.y ?? e.y0 ?? e.cy));
    for (const e of city.roads.v || []) vRoads.push(typeof e === 'number' ? e : (e.x ?? e.x0 ?? e.cx));
  }
  if (!pt) {
    if (hRoads.length === 0 && vRoads.length === 0) {
      pt = { x: clamp(x, 40, size - 40), y: clamp(y, 40, size - 40) };
    } else {
      let best = null;
      let bestD = Infinity;
      for (const ry of hRoads) {
        if (typeof ry !== 'number') continue;
        const d = Math.abs(y - ry);
        if (d < bestD) { bestD = d; best = { x: clamp(x, 40, size - 40), y: ry }; }
      }
      for (const rx of vRoads) {
        if (typeof rx !== 'number') continue;
        const d = Math.abs(x - rx);
        if (d < bestD) { bestD = d; best = { x: rx, y: clamp(y, 40, size - 40) }; }
      }
      pt = best || { x: clamp(x, 40, size - 40), y: clamp(y, 40, size - 40) };
    }
  }
  // Guarantee the result is on a road: fall back to the nearest
  // intersection (always on a road) when the snap kept an off-road point.
  if (!onRoad(city, pt.x, pt.y)) {
    const ix = nearestLine(city, 'v', x);
    const iy = nearestLine(city, 'h', y);
    if (ix !== null && iy !== null) return { x: ix, y: iy };
  }
  return pt;
}

function garagePoint(state) {
  if (state.missions && state.missions.locations && state.missions.locations.garage) {
    return state.missions.locations.garage;
  }
  const city = state.city;
  if (city && Array.isArray(city.landmarks)) {
    for (const lm of city.landmarks) {
      if (String(lm.kind || '').toLowerCase() === 'garage') return { x: lm.x, y: lm.y };
    }
  }
  if (city && city.spawnPoint) return { x: city.spawnPoint.x, y: city.spawnPoint.y };
  return { x: 120, y: 120 };
}

function isRoadAt(state, x, y) {
  const city = state.city;
  if (!city) return true;
  if (typeof city.isRoad === 'function') {
    try { return !!city.isRoad(x, y); } catch { return true; }
  }
  try {
    return !!cityIsRoad(city, x, y);
  } catch {
    return true;
  }
}

function pushParticles(state, x, y, color, n, speed) {
  if (!Array.isArray(state.particles)) state.particles = [];
  const rng = rngFn(state);
  for (let i = 0; i < n; i += 1) {
    if (state.particles.length >= 400) return;
    const a = rng() * Math.PI * 2;
    const s = (0.3 + rng() * 0.7) * (speed || 120);
    state.particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0.3 + rng() * 0.3,
      color,
      size: 2 + rng() * 2,
    });
  }
}

// ---------------------------------------------------------------------------
// Setup / wanted level
// ---------------------------------------------------------------------------

export function initPolice(state) {
  state.police = [];
  state.wanted = { stars: 0, heat: 0, hidden: 0, _seenEvents: 0, _gunshotCooldown: 0 };
  state.policeSiren = false;
  state._policeCounter = 0;
  state._roadblock = null;
  state._roadblockCooldown = 0;
  return state.wanted;
}

function ensurePolice(state) {
  if (!state.wanted) initPolice(state);
  if (!Array.isArray(state.police)) state.police = [];
  if (!Array.isArray(state.cars)) state.cars = [];
  return state.wanted;
}

export function addWanted(state, n, reason) {
  const w = ensurePolice(state);
  if (!n) return w.stars;
  const before = w.stars;
  w.stars = clamp(w.stars + n, 0, 5);
  w.heat = clamp(w.heat + n * 25, 0, 100);
  if (w.stars > before) w.hidden = 0;
  if (state.stats) {
    state.stats.wantedMax = Math.max(state.stats.wantedMax || 0, w.stars);
  }
  state.policeSiren = w.stars > 0;
  state.events = state.events || [];
  state.events.push({ type: 'wanted', stars: w.stars, reason: reason || 'crime' });
  return w.stars;
}

export function clearWanted(state) {
  const w = ensurePolice(state);
  w.stars = 0;
  w.heat = 0;
  w.hidden = 0;
  state.policeSiren = false;
  return 0;
}

// Nearest distance from the player to any police unit (cruiser or cop).
function nearestPoliceDist(state) {
  const p = state.player;
  if (!p) return Infinity;
  let best = Infinity;
  for (const car of state.cars || []) {
    if (car.driver !== 'police') continue;
    best = Math.min(best, dist(car.x, car.y, p.x, p.y));
  }
  for (const cop of state.police || []) {
    best = Math.min(best, dist(cop.x, cop.y, p.x, p.y));
  }
  return best;
}

export function updateWanted(state, dt) {
  const w = ensurePolice(state);
  if (w._gunshotCooldown > 0) w._gunshotCooldown -= dt;
  // Consume fresh crime events (watermarked so main.js clearing the array
  // mid-tick cannot make us double-count).
  const events = state.events || [];
  let seen = w._seenEvents || 0;
  if (events.length < seen) seen = 0;
  for (let i = seen; i < events.length; i += 1) {
    const ev = events[i];
    if (ev.type === 'steal') addWanted(state, 1, 'Vehicle theft');
    else if (ev.type === 'gunshot') {
      if (w._gunshotCooldown <= 0) {
        addWanted(state, 1, 'Shots fired');
        w._gunshotCooldown = 1.5;
      }
    } else if (ev.type === 'ped-down') addWanted(state, 1, 'Pedestrian down');
    else if (ev.type === 'cop-down') addWanted(state, 2, 'Officer down');
  }
  w._seenEvents = events.length;
  // Heat: decay while unseen, one star lost per ~25 s hidden.
  const near = nearestPoliceDist(state);
  const seenByPolice = near <= 520;
  if (w.stars > 0 && !seenByPolice) {
    w.hidden += dt;
    w.heat = Math.max(0, w.heat - dt * 4);
    if (w.hidden >= 25) {
      w.hidden = 0;
      w.stars = Math.max(0, w.stars - 1);
      w.heat = Math.max(0, w.heat - 20);
      state.events = state.events || [];
      state.events.push({ type: 'wanted', stars: w.stars, reason: 'heat cooled off' });
    }
  } else if (w.stars > 0) {
    w.hidden = 0;
    w.heat = Math.min(100, w.heat + dt * 2);
  } else {
    w.hidden = 0;
    w.heat = Math.max(0, w.heat - dt * 8);
  }
  state.policeSiren = w.stars > 0;
}

// ---------------------------------------------------------------------------
// Cruisers
// ---------------------------------------------------------------------------

function policeCars(state) {
  return state.cars.filter((c) => c.driver === 'police');
}

export function spawnCruiser(state, x, y, angle, mode) {
  const w = state.wanted;
  const rng = rngFn(state);
  state._policeCounter = (state._policeCounter || 0) + 1;
  const id = `police-${state._policeCounter}-${Math.floor(rng() * 100000)}`;
  const car = {
    id,
    x,
    y,
    angle: angle || 0,
    speed: 0,
    maxSpeed: 350 + (w ? w.stars : 0) * 18,
    color: '#22315e',
    kind: 'cruiser',
    driver: 'police',
    health: 100,
    _police: { ramCooldown: 0, mode: mode || 'pursue', ttl: mode === 'roadblock' ? 20 : 0 },
  };
  state.cars.push(car);
  return car;
}

function spawnPointNearPlayer(state) {
  const p = state.player;
  const rng = rngFn(state);
  const size = state.city && typeof state.city.size === 'number' ? state.city.size : 2000;
  // Try several angles: the road snap can collapse the standoff when the
  // spawn direction is perpendicular to the player's road (the snap pulls
  // the point onto the player's own road line, possibly right on top of
  // the player). Only accept a snapped point that keeps the >500 px gap;
  // otherwise fall back to the raw point, which is 560-720 px away by
  // construction.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const ang = rng() * Math.PI * 2;
    const d = 560 + rng() * 160;
    const rawX = p.x + Math.cos(ang) * d;
    const rawY = p.y + Math.sin(ang) * d;
    // Clamp into the world BEFORE judging the standoff: a road snap (or
    // the collide step later) can otherwise drag an out-of-bounds spawn
    // point hundreds of px closer to the player.
    let pt = roadPoint(state.city, rawX, rawY);
    pt = { x: clamp(pt.x, 32, size - 32), y: clamp(pt.y, 32, size - 32) };
    if (dist(pt.x, pt.y, p.x, p.y) > 500) return pt;
    if (attempt === 7) {
      return { x: clamp(rawX, 32, size - 32), y: clamp(rawY, 32, size - 32) };
    }
  }
  return { x: p.x + 600, y: p.y };
}

function updateCruiser(state, car, dt) {
  const p = state.player;
  if (!p) return;
  const meta = car._police || (car._police = { ramCooldown: 0, mode: 'pursue', ttl: 0 });
  if (meta.ramCooldown > 0) meta.ramCooldown -= dt;
  if (meta.mode === 'roadblock') {
    meta.ttl -= dt;
    car.speed = 0;
    if (meta.ttl <= 0 || (state.wanted && state.wanted.stars < 3)) meta.mode = 'pursue';
    return;
  }
  // Target: the player — unless off-road, in which case steer back to the
  // nearest road first (keeps cruisers out of buildings).
  let tx = p.x;
  let ty = p.y;
  if (!isRoadAt(state, car.x, car.y)) {
    const rp = roadPoint(state.city, car.x, car.y);
    tx = rp.x;
    ty = rp.y;
  }
  const desired = Math.atan2(ty - car.y, tx - car.x);
  const turn = clamp(angleDiff(desired, car.angle), -3.5 * dt, 3.5 * dt);
  car.angle += turn;
  const targetSpeed = car.maxSpeed || 360;
  car.speed = Math.min(targetSpeed, car.speed + 420 * dt);
  let nx = car.x + Math.cos(car.angle) * car.speed * dt;
  let ny = car.y + Math.sin(car.angle) * car.speed * dt;
  // city.js collideBuildings returns the position pushed out of buildings
  // (and clamped to the world) — use it, so cruisers stay out of blocks.
  const city = state.city;
  if (city) {
    try {
      const fixed = cityCollideBuildings(city, nx, ny, 18);
      if (fixed && typeof fixed.x === 'number' && typeof fixed.y === 'number') {
        if (fixed.x !== nx || fixed.y !== ny) car.speed *= 0.5; // clipped a building
        nx = fixed.x;
        ny = fixed.y;
      }
    } catch { /* no collision data: move freely */ }
  }
  car.x = nx;
  car.y = ny;
  // Ram: damage the player's car (and jolt the player) on contact.
  const playerCar = p.car && typeof p.car === 'object' ? p.car : null;
  if (!p.onFoot && playerCar) {
    const d = dist(car.x, car.y, playerCar.x, playerCar.y);
    if (d < 48 && meta.ramCooldown <= 0) {
      meta.ramCooldown = 0.9;
      playerCar.health = (typeof playerCar.health === 'number' ? playerCar.health : 100) - 12;
      const kx = (playerCar.x - car.x) / (d || 1);
      const ky = (playerCar.y - car.y) / (d || 1);
      playerCar.x += kx * 14;
      playerCar.y += ky * 14;
      pushParticles(state, car.x, car.y, '#ffdd66', 6, 160);
      damagePlayer(state, 4);
      state.events = state.events || [];
      state.events.push({ type: 'ram', x: car.x, y: car.y });
      if (playerCar.health <= 0) {
        playerCar.health = 0;
        playerCar.speed = 0;
        state.events.push({ type: 'car-destroyed', carId: playerCar.id, x: playerCar.x, y: playerCar.y });
      }
    }
  } else if (p.onFoot) {
    const d = dist(car.x, car.y, p.x, p.y);
    if (d < 30 && meta.ramCooldown <= 0) {
      meta.ramCooldown = 0.9;
      damagePlayer(state, 6);
      p.x += ((p.x - car.x) / (d || 1)) * 12;
      p.y += ((p.y - car.y) / (d || 1)) * 12;
      pushParticles(state, car.x, car.y, '#ffdd66', 5, 140);
    }
  }
}

function maybeRoadblock(state, dt) {
  const w = state.wanted;
  if (!w || w.stars < 3) return;
  if (state._roadblockCooldown > 0) {
    state._roadblockCooldown -= dt;
    return;
  }
  const p = state.player;
  if (!p) return;
  const existing = policeCars(state).filter((c) => c._police && c._police.mode === 'roadblock');
  if (existing.length >= 2) return;
  // Two cruisers parked across the road ahead of the player.
  const ahead = 520;
  const ax = p.x + Math.cos(p.angle || 0) * ahead;
  const ay = p.y + Math.sin(p.angle || 0) * ahead;
  const center = roadPoint(state.city, ax, ay);
  const perp = (p.angle || 0) + Math.PI / 2;
  for (const off of [-32, 32]) {
    const c = spawnCruiser(
      state,
      center.x + Math.cos(perp) * off,
      center.y + Math.sin(perp) * off,
      perp,
      'roadblock',
    );
    c.speed = 0;
  }
  state._roadblock = { x: center.x, y: center.y, angle: perp };
  state._roadblockCooldown = 18;
}

// ---------------------------------------------------------------------------
// On-foot cops + busted
// ---------------------------------------------------------------------------

function doBusted(state) {
  const p = state.player;
  const g = garagePoint(state);
  state.events = state.events || [];
  state.events.push({ type: 'busted', x: p ? p.x : 0, y: p ? p.y : 0 });
  if (p) {
    p.cash = Math.max(0, (p.cash || 0) - 150);
    p.x = g.x;
    p.y = g.y;
    p.angle = 0;
    p.speed = 0;
    p.onFoot = true;
    p.car = null;
    p.health = Math.max(p.health || 100, 60);
  }
  clearWanted(state);
  state.police.length = 0;
  for (let i = state.cars.length - 1; i >= 0; i -= 1) {
    if (state.cars[i].driver === 'police') state.cars.splice(i, 1);
  }
  state._roadblock = null;
}

function updateFootCops(state, dt) {
  const p = state.player;
  const w = state.wanted;
  if (!p || !w) return;
  // Spawn on-foot cops only while the player is on foot at 2+ stars.
  if (p.onFoot && w.stars >= 2) {
    const want = Math.min(w.stars, 3);
    const cops = state.police.filter((c) => c.onFoot);
    if (cops.length < want) {
      const rng = rngFn(state);
      const ang = rng() * Math.PI * 2;
      const d = 320 + rng() * 120;
      const pt = roadPoint(state.city, p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d);
      state.police.push({
        x: pt.x,
        y: pt.y,
        angle: Math.atan2(p.y - pt.y, p.x - pt.x),
        carId: null,
        onFoot: true,
        speed: 170,
        state: 'chase',
        hp: 60,
        bustTimer: 0,
      });
    }
  }
  for (let i = state.police.length - 1; i >= 0; i -= 1) {
    const cop = state.police[i];
    if (!cop.onFoot) continue;
    const d = dist(cop.x, cop.y, p.x, p.y);
    if (d > 900 || w.stars === 0) {
      state.police.splice(i, 1);
      continue;
    }
    cop.angle = Math.atan2(p.y - cop.y, p.x - cop.x);
    const step = Math.min(cop.speed * dt, Math.max(0, d - 18));
    cop.x += Math.cos(cop.angle) * step;
    cop.y += Math.sin(cop.angle) * step;
    if (d < 26) {
      cop.bustTimer = (cop.bustTimer || 0) + dt;
      // Cop punches while holding the player.
      damagePlayer(state, 5 * dt);
      if (cop.bustTimer >= 2) {
        doBusted(state);
        return;
      }
    } else {
      cop.bustTimer = Math.max(0, (cop.bustTimer || 0) - dt * 2);
    }
  }
}

export function updatePolice(state, dt) {
  const w = ensurePolice(state);
  const p = state.player;
  if (!p) return;
  const stars = w.stars;
  // Cruiser count tracks the wanted level (stars + 1), spawned on roads
  // near the player but never closer than 500 px.
  const wantCruisers = stars > 0 ? stars + 1 : 0;
  let cruisers = policeCars(state);
  if (stars === 0) {
    // Heat is gone: cruisers leave (removed, they drive off).
    for (const car of cruisers) {
      const idx = state.cars.indexOf(car);
      if (idx >= 0) state.cars.splice(idx, 1);
    }
    state._roadblock = null;
  } else {
    // Despawn cruisers that fell far behind, then top up near the player.
    for (let i = cruisers.length - 1; i >= 0; i -= 1) {
      if (dist(cruisers[i].x, cruisers[i].y, p.x, p.y) > 1500) {
        const idx = state.cars.indexOf(cruisers[i]);
        if (idx >= 0) state.cars.splice(idx, 1);
      }
    }
    cruisers = policeCars(state);
    while (cruisers.length < wantCruisers) {
      const pt = spawnPointNearPlayer(state);
      cruisers.push(spawnCruiser(state, pt.x, pt.y, Math.atan2(p.y - pt.y, p.x - pt.x), 'pursue'));
    }
    maybeRoadblock(state, dt);
  }
  for (const car of policeCars(state)) updateCruiser(state, car, dt);
  updateFootCops(state, dt);
  state.policeSiren = stars > 0;
}

// ---------------------------------------------------------------------------
// Drawing (on-foot cops, roadblock cones, pursuit markers only)
// ---------------------------------------------------------------------------

export function drawPolice(ctx, state) {
  if (!ctx) return;
  const w = state.wanted;
  ctx.save();
  // On-foot cops: navy body, pale badge dot, bust-progress ring.
  for (const cop of state.police || []) {
    if (!cop.onFoot) continue;
    ctx.fillStyle = '#1d2f5e';
    ctx.beginPath();
    ctx.arc(cop.x, cop.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#dfe6ff';
    ctx.beginPath();
    ctx.arc(cop.x + Math.cos(cop.angle) * 5, cop.y + Math.sin(cop.angle) * 5, 3, 0, Math.PI * 2);
    ctx.fill();
    if (cop.bustTimer > 0) {
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cop.x, cop.y, 16, -Math.PI / 2, -Math.PI / 2 + (cop.bustTimer / 2) * Math.PI * 2);
      ctx.stroke();
    }
  }
  // Roadblock cones: orange triangles across the road at the block.
  if (state._roadblock) {
    const rb = state._roadblock;
    for (const off of [-48, -16, 16, 48]) {
      const cx = rb.x + Math.cos(rb.angle) * off;
      const cy = rb.y + Math.sin(rb.angle) * off;
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx - 6, cy + 6);
      ctx.lineTo(cx + 6, cy + 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 6, cy + 1, 12, 3);
    }
  }
  // Pursuit markers: a flashing ring over each chasing cruiser.
  if (w && w.stars >= 1) {
    const pulse = 0.5 + 0.5 * Math.sin((state.time || 0) * 8);
    ctx.strokeStyle = pulse > 0.5 ? '#ff3b30' : '#3b82ff';
    ctx.lineWidth = 2;
    for (const car of state.cars || []) {
      if (car.driver !== 'police') continue;
      ctx.beginPath();
      ctx.arc(car.x, car.y, 24 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}
