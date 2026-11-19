// economy.js — Cash, progression and side activities for Solmar City (W3).
//
//   initEconomy(state) — spawns pickups (cash bundles, health kits, armor
//            vests, ammo boxes) at road points plus 20 hidden collectibles
//            ("sun coins") spread across the districts; sets up the two
//            "Solmar Surplus" shops and the 4 stunt ramps.
//   updateEconomy(state, dt) — pickup collection (within 26 px), taxi fares
//            (drive a taxi, pick up the fare ped, drop them off for cash by
//            distance), stunt jumps (4 ramps; cross one at speed > 300 for
//            airtime cash + style), distance / fare stats.
//   buyItem(state, item) — 'armor' ($150) / 'ammo' ($50) at a Solmar
//            Surplus shop while on foot nearby (W1 calls this on E).
//   shopPrompt(state) — HUD prompt string when a shop is in reach, else null.
//
// state.economy = { fare, collectiblesFound, totalCollectibles, shops,
//                   ramps, nearShop, style, earned, ... }
// Pickups live in state.pickups [{x, y, kind}]; combat consumes ammo /
// health / armor, this module supplies them.
//
// Deterministic: only state.rng is used. No Date.now(), no Math.random().

import {
  nearestRoadPoint as cityNearestRoadPoint,
  isRoad as cityIsRoad,
  randomRoadPoint as cityRandomRoadPoint,
} from './city.js';

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

// A road point somewhere in the city (random road, random spot on it).
function randomRoadPoint(state) {
  const city = state.city;
  const rng = rngFn(state);
  if (city && typeof city.randomRoadPoint === 'function') {
    try {
      const p = city.randomRoadPoint();
      if (p && typeof p.x === 'number') return { x: p.x, y: p.y };
    } catch { /* fall through */ }
  }
  if (city) {
    try {
      const p = cityRandomRoadPoint(city, rng);
      if (p && typeof p.x === 'number') return { x: p.x, y: p.y };
    } catch { /* fall through to the derivation below */ }
  }
  const size = city && typeof city.size === 'number' ? city.size : 2000;
  const hRoads = [];
  const vRoads = [];
  if (city && city.roads) {
    for (const e of city.roads.h || []) hRoads.push(typeof e === 'number' ? e : (e.y ?? e.y0));
    for (const e of city.roads.v || []) vRoads.push(typeof e === 'number' ? e : (e.x ?? e.x0));
  }
  if (hRoads.length === 0 && vRoads.length === 0) {
    return { x: 60 + rng() * (size - 120), y: 60 + rng() * (size - 120) };
  }
  if (rng() < 0.5 && hRoads.length > 0) {
    return { x: 60 + rng() * (size - 120), y: hRoads[Math.floor(rng() * hRoads.length)] };
  }
  if (vRoads.length > 0) {
    return { x: vRoads[Math.floor(rng() * vRoads.length)], y: 60 + rng() * (size - 120) };
  }
  return { x: 60 + rng() * (size - 120), y: hRoads[Math.floor(rng() * hRoads.length)] };
}

function landmarksOf(city, kind) {
  if (!city || !Array.isArray(city.landmarks)) return [];
  return city.landmarks.filter((lm) => String(lm.kind || '').toLowerCase() === String(kind).toLowerCase());
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

function getPlayerCar(state) {
  const p = state.player;
  if (!p) return null;
  if (p.car && typeof p.car === 'object') return p.car;
  if ((typeof p.car === 'string' || typeof p.car === 'number') && Array.isArray(state.cars)) {
    return state.cars.find((c) => c.id === p.car) || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function initEconomy(state) {
  const city = state.city;
  const size = city && typeof city.size === 'number' ? city.size : 2000;
  if (!Array.isArray(state.pickups)) state.pickups = [];
  // Pickups at sensible roadside spots: cash bundles, health kits, armor
  // vests, ammo boxes — then 20 hidden sun coins across the districts.
  const plan = [
    ['cash', 6], ['health', 4], ['armor', 3], ['ammo', 4], ['suncoin', 20],
  ];
  for (const [kind, count] of plan) {
    for (let i = 0; i < count; i += 1) {
      // Keep pickups from stacking on one spot (a degenerate road helper
      // could otherwise pile them all on the same point).
      let pt = randomRoadPoint(state);
      for (let tries = 0; tries < 8 && state.pickups.some((pk) => dist(pk.x, pk.y, pt.x, pt.y) < 40); tries += 1) {
        pt = randomRoadPoint(state);
      }
      state.pickups.push({ x: pt.x, y: pt.y, kind });
    }
  }
  // Shops: the two Solmar Surplus stores (landmarks when W2 provides them,
  // otherwise spread across town on roads).
  let shops = landmarksOf(city, 'shop').slice(0, 2).map((lm) => ({ x: lm.x, y: lm.y }));
  if (shops.length < 2) {
    const fallbacks = [
      roadPoint(city, size * 0.45, size * 0.3),
      roadPoint(city, size * 0.55, size * 0.75),
    ];
    for (const fb of fallbacks) {
      if (shops.length >= 2) break;
      if (!shops.some((s) => dist(s.x, s.y, fb.x, fb.y) < 200)) shops.push(fb);
    }
  }
  // Stunt ramps: W2 landmarks of kind 'ramp', else four spread road points.
  let ramps = landmarksOf(city, 'ramp').slice(0, 4).map((lm) => ({ x: lm.x, y: lm.y, cooldown: 0 }));
  if (ramps.length < 4) {
    const spots = [
      { x: size * 0.3, y: size * 0.5 },
      { x: size * 0.7, y: size * 0.3 },
      { x: size * 0.7, y: size * 0.7 },
      { x: size * 0.3, y: size * 0.85 },
    ];
    for (const s of spots) {
      if (ramps.length >= 4) break;
      const pt = roadPoint(city, s.x, s.y);
      if (!ramps.some((r) => dist(r.x, r.y, pt.x, pt.y) < 200)) ramps.push({ x: pt.x, y: pt.y, cooldown: 0 });
    }
  }
  state.economy = {
    fare: null,
    collectiblesFound: 0,
    totalCollectibles: 20,
    shops,
    ramps,
    nearShop: null,
    style: 0,
    earned: 0,
    fareCooldown: 0,
    lastStunt: null,
  };
  return state.economy;
}

function ensureEconomy(state) {
  if (!state.economy || !Array.isArray(state.economy.shops)) initEconomy(state);
  if (!Array.isArray(state.pickups)) state.pickups = [];
  return state.economy;
}

// ---------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------

function applyPickup(state, pickup) {
  const p = state.player;
  const eco = state.economy;
  let amount = 0;
  switch (pickup.kind) {
    case 'cash':
      amount = 50;
      p.cash = (p.cash || 0) + amount;
      break;
    case 'health':
      p.health = Math.min(100, (p.health || 0) + 40);
      break;
    case 'armor':
      p.armor = Math.min(100, (p.armor || 0) + 50);
      break;
    case 'ammo': {
      const gain = p.weapon === 'smg' ? 60 : 24;
      p.ammo = (p.ammo || 0) + gain;
      break;
    }
    case 'suncoin':
      eco.collectiblesFound += 1;
      amount = 100;
      p.cash = (p.cash || 0) + amount;
      break;
    default:
      break;
  }
  eco.earned += amount;
  pushParticles(state, pickup.x, pickup.y, pickup.kind === 'suncoin' ? '#ffd94a' : '#7dff8a', 8, 120);
  state.events = state.events || [];
  state.events.push({ type: 'pickup', kind: pickup.kind, x: pickup.x, y: pickup.y, amount });
}

function updatePickups(state) {
  const p = state.player;
  if (!p) return;
  for (let i = state.pickups.length - 1; i >= 0; i -= 1) {
    const pk = state.pickups[i];
    if (dist(p.x, p.y, pk.x, pk.y) < 26) {
      applyPickup(state, pk);
      state.pickups.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Taxi fares
// ---------------------------------------------------------------------------

function spawnFare(state) {
  const p = state.player;
  const rng = rngFn(state);
  // Fare ped: a road point a short drive from the player.
  let pedPt = null;
  for (let tries = 0; tries < 12 && !pedPt; tries += 1) {
    const pt = randomRoadPoint(state);
    const d = dist(pt.x, pt.y, p.x, p.y);
    if (d > 120 && d < 450) pedPt = pt;
  }
  if (!pedPt) pedPt = randomRoadPoint(state);
  // Destination: a road point a good drive away from the ped.
  let dest = null;
  for (let tries = 0; tries < 16 && !dest; tries += 1) {
    const pt = randomRoadPoint(state);
    if (dist(pt.x, pt.y, pedPt.x, pedPt.y) > 600) dest = pt;
  }
  if (!dest) dest = randomRoadPoint(state);
  if (!Array.isArray(state.peds)) state.peds = [];
  state.peds.push({
    x: pedPt.x,
    y: pedPt.y,
    angle: rng() * Math.PI * 2,
    speed: 0,
    state: 'waiting-fare',
    color: '#ffd54a',
    fare: true,
  });
  state.economy.fare = {
    ped: { x: pedPt.x, y: pedPt.y },
    dest: { x: dest.x, y: dest.y },
    pickup: null,
    state: 'waiting',
  };
}

function cancelFare(state) {
  const eco = state.economy;
  if (!eco.fare) return;
  if (eco.fare.state === 'waiting' && Array.isArray(state.peds)) {
    for (let i = state.peds.length - 1; i >= 0; i -= 1) {
      if (state.peds[i].fare) state.peds.splice(i, 1);
    }
  }
  eco.fare = null;
  eco.fareCooldown = 5;
}

function updateFare(state, dt) {
  const eco = state.economy;
  const p = state.player;
  if (!p) return;
  if (eco.fareCooldown > 0) eco.fareCooldown -= dt;
  const car = getPlayerCar(state);
  const inTaxi = !!car && !p.onFoot && car.kind === 'taxi';
  if (!inTaxi) {
    if (eco.fare) cancelFare(state);
    return;
  }
  if (!eco.fare) {
    if (eco.fareCooldown <= 0) spawnFare(state);
    return;
  }
  const fare = eco.fare;
  if (fare.state === 'waiting') {
    if (dist(p.x, p.y, fare.ped.x, fare.ped.y) < 42) {
      // Ped boards: remove them from the street, ride begins.
      if (Array.isArray(state.peds)) {
        for (let i = state.peds.length - 1; i >= 0; i -= 1) {
          if (state.peds[i].fare) state.peds.splice(i, 1);
        }
      }
      fare.state = 'riding';
      fare.pickup = { x: fare.ped.x, y: fare.ped.y };
      state.events = state.events || [];
      state.events.push({ type: 'fare-pickup', x: fare.dest.x, y: fare.dest.y });
    }
  } else if (fare.state === 'riding') {
    if (dist(p.x, p.y, fare.dest.x, fare.dest.y) < 55) {
      const trip = fare.pickup ? dist(fare.pickup.x, fare.pickup.y, fare.dest.x, fare.dest.y) : 800;
      const pay = Math.round(40 + trip * 0.06);
      p.cash = (p.cash || 0) + pay;
      eco.earned += pay;
      if (state.stats) state.stats.fares = (state.stats.fares || 0) + 1;
      pushParticles(state, p.x, p.y, '#7dff8a', 10, 140);
      state.events = state.events || [];
      state.events.push({ type: 'fare-complete', amount: pay });
      eco.fare = null;
      eco.fareCooldown = 8;
    }
  }
}

// ---------------------------------------------------------------------------
// Stunt jumps + shops
// ---------------------------------------------------------------------------

function updateRamps(state, dt) {
  const eco = state.economy;
  const p = state.player;
  if (!p) return;
  const car = getPlayerCar(state);
  for (const ramp of eco.ramps) {
    if (ramp.cooldown > 0) ramp.cooldown -= dt;
    if (ramp.cooldown > 0) continue;
    if (p.onFoot || !car) continue;
    const speed = car.speed || 0;
    if (speed > 300 && dist(p.x, p.y, ramp.x, ramp.y) < 42) {
      ramp.cooldown = 10;
      const pay = 75;
      p.cash = (p.cash || 0) + pay;
      eco.earned += pay;
      eco.style += 100;
      eco.lastStunt = { x: ramp.x, y: ramp.y };
      pushParticles(state, ramp.x, ramp.y, '#ffd94a', 12, 200);
      state.events = state.events || [];
      state.events.push({ type: 'stunt', amount: pay, x: ramp.x, y: ramp.y });
    }
  }
}

function updateShops(state) {
  const eco = state.economy;
  const p = state.player;
  eco.nearShop = null;
  if (!p || !p.onFoot) return;
  for (const shop of eco.shops) {
    if (dist(p.x, p.y, shop.x, shop.y) < 70) {
      eco.nearShop = shop;
      return;
    }
  }
}

export function updateEconomy(state, dt) {
  const eco = ensureEconomy(state);
  const p = state.player;
  if (!p) return;
  // Distance stat: car speed while driving, foot speed while walking.
  const car = getPlayerCar(state);
  const speed = !p.onFoot && car ? (car.speed || 0) : (p.speed || 0);
  if (state.stats) state.stats.distance = (state.stats.distance || 0) + speed * dt;
  updatePickups(state);
  updateFare(state, dt);
  updateRamps(state, dt);
  updateShops(state);
}

// Buy armor ($150, sets armor to 100) or pistol/smg ammo ($50) at the
// Solmar Surplus shop the player is standing next to, on foot.
export function buyItem(state, item) {
  const eco = ensureEconomy(state);
  const p = state.player;
  if (!eco.nearShop) return { ok: false, reason: 'not near a shop' };
  if (!p) return { ok: false, reason: 'no player' };
  if (item === 'armor') {
    if ((p.cash || 0) < 150) return { ok: false, reason: 'not enough cash' };
    p.cash -= 150;
    p.armor = 100;
  } else if (item === 'ammo') {
    if ((p.cash || 0) < 50) return { ok: false, reason: 'not enough cash' };
    p.cash -= 50;
    p.ammo = (p.ammo || 0) + (p.weapon === 'smg' ? 60 : 24);
  } else {
    return { ok: false, reason: 'unknown item' };
  }
  state.events = state.events || [];
  state.events.push({ type: 'bought', item, x: eco.nearShop.x, y: eco.nearShop.y });
  return { ok: true, item };
}

// HUD prompt when a shop is in reach, else null.
export function shopPrompt(state) {
  const eco = state.economy;
  if (!eco || !eco.nearShop) return null;
  return 'E — Solmar Surplus: Armor $150 | Ammo $50';
}
