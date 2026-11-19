// vehicles.js — cars: kinds, spawning, player driving physics, stealing.
// Imports only city.js helpers. Never imports police/missions/combat/main.
import { collideBuildings, isRoad, randomRoadPoint } from './city.js';

export const CAR_KINDS = {
  sedan: { maxSpeed: 260, accel: 300, len: 46, w: 22, colors: ['#c23a2e', '#2e5a8a', '#5a5a60', '#8a8f96', '#3a6b4a'] },
  hatchback: { maxSpeed: 240, accel: 320, len: 40, w: 21, colors: ['#d8a13a', '#7a4a8a', '#4a9a8a', '#b0b6bd'] },
  taxi: { maxSpeed: 250, accel: 310, len: 46, w: 22, colors: ['#f7c948'] },
  van: { maxSpeed: 210, accel: 240, len: 54, w: 24, colors: ['#e8e8e8', '#5a6b7d', '#8a6f4a'] },
  sports: { maxSpeed: 380, accel: 420, len: 48, w: 22, colors: ['#d81e3a', '#e8e800', '#1e9ad8', '#222222'] },
  truck: { maxSpeed: 200, accel: 200, len: 60, w: 25, colors: ['#6b7d5a', '#8a7d6b', '#4a5a6b'] },
  police: { maxSpeed: 300, accel: 340, len: 48, w: 23, colors: ['#e8e8e8'] },
};

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function createCar(state, kind, x, y, angle, driver) {
  const def = CAR_KINDS[kind] || CAR_KINDS.sedan;
  const rng = state.rng;
  const id = (state._carSeq = (state._carSeq || 0) + 1);
  const color = kind === 'taxi' || kind === 'police'
    ? def.colors[0]
    : pick(rng, def.colors);
  const car = {
    id, x, y, angle, speed: 0,
    maxSpeed: def.maxSpeed,
    color, kind,
    driver: driver || null,
    health: 100,
    len: def.len, w: def.w,
    axis: 'h', dir: 1, pause: 0, cruise: 110,
  };
  return car;
}

export function spawnTrafficCars(state, n) {
  const rng = state.rng;
  const kinds = ['sedan', 'hatchback', 'van', 'sports', 'truck'];
  let taxis = 0;
  let placed = 0;
  let guard = 0;
  while (placed < n && guard < n * 40) {
    guard++;
    const pt = randomRoadPoint(state.city, rng);
    // Keep some space between spawned cars.
    let ok = true;
    for (const c of state.cars) {
      const dx = c.x - pt.x;
      const dy = c.y - pt.y;
      if (dx * dx + dy * dy < 90 * 90) { ok = false; break; }
    }
    if (!ok) continue;
    let kind;
    if (taxis < 2 && n >= 2 && placed >= n - 2) kind = 'taxi';
    else if (taxis < 2 && rng() < 0.12) kind = 'taxi';
    else kind = pick(rng, kinds);
    if (kind === 'taxi') taxis++;
    const axis = rng() < 0.5 ? 'h' : 'v';
    const dir = rng() < 0.5 ? 1 : -1;
    const angle = axis === 'h' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const car = createCar(state, kind, pt.x, pt.y, angle, 'traffic');
    car.axis = axis;
    car.dir = dir;
    car.cruise = kind === 'sports' ? 140 : kind === 'truck' ? 90 : 100 + rng() * 30;
    state.cars.push(car);
    placed++;
  }
  // Guarantee exactly 2 taxis when n >= 2 (convert trailing cars if needed).
  if (n >= 2) {
    let have = state.cars.filter((c) => c.kind === 'taxi' && c.driver === 'traffic').length;
    for (const c of state.cars) {
      if (have >= 2) break;
      if (c.driver === 'traffic' && c.kind !== 'taxi') {
        c.kind = 'taxi';
        c.color = '#f7c948';
        c.maxSpeed = CAR_KINDS.taxi.maxSpeed;
        have++;
      }
    }
  }
  return placed;
}

function pushParticle(state, x, y, vx, vy, life, color, size) {
  if (!state.particles) return;
  if (state.particles.length >= 400) state.particles.shift();
  state.particles.push({ x, y, vx, vy, life, color, size });
}

function pushSkid(state, x, y, angle) {
  if (!state.skidmarks) return;
  if (state.skidmarks.length >= 300) state.skidmarks.shift();
  state.skidmarks.push({ x, y, angle, life: 6 });
}

function carRadius(car) {
  return car.len * 0.42;
}

export function enterCar(state) {
  const p = state.player;
  if (!p || !p.onFoot) return false;
  let best = null;
  let bestD = 46;
  for (const car of state.cars) {
    const dx = car.x - p.x;
    const dy = car.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestD) { bestD = d; best = car; }
  }
  if (!best) return false;
  if (best.driver === 'traffic' || best.driver === 'police') {
    // Jack it: the driver flees on foot, the steal is reported as an event
    // (main.js / W3 turns it into wanted heat — no police.js import here).
    if (state.peds) {
      state.peds.push({
        x: best.x + 26, y: best.y + 10,
        angle: best.angle + Math.PI / 2, speed: 0,
        state: 'flee', color: '#d8a13a',
        tx: best.x + 200, ty: best.y + 120, idle: 0, bob: 0,
        fx: best.x, fy: best.y, fleeT: 3,
      });
    }
    if (state.events) state.events.push({ type: 'steal', carId: best.id, kind: best.kind });
    if (state.stats) state.stats.carsStolen = (state.stats.carsStolen || 0) + 1;
  }
  best.driver = 'player';
  p.car = best;
  p.onFoot = false;
  p.x = best.x;
  p.y = best.y;
  p.angle = best.angle;
  p.speed = best.speed;
  return true;
}

export function exitCar(state) {
  const p = state.player;
  if (!p || p.onFoot || !p.car) return false;
  const car = p.car;
  car.driver = null;
  car.speed = 0;
  // Step out to the car's left side.
  const side = car.angle + Math.PI / 2;
  let px = car.x + Math.cos(side) * 30;
  let py = car.y + Math.sin(side) * 30;
  const fixed = collideBuildings(state.city, px, py, 8);
  px = fixed.x;
  py = fixed.y;
  p.x = px;
  p.y = py;
  p.speed = 0;
  p.car = null;
  p.onFoot = true;
  return true;
}

export function updateCars(state, dt, intent) {
  const p = state.player;
  if (!p) return;
  intent = intent || {};
  // Enter/exit on the rising edge of intent.enter.
  if (intent.enter && !state._enterPrev) {
    if (p.onFoot) enterCar(state);
    else exitCar(state);
  }
  state._enterPrev = !!intent.enter;

  const car = p.car;
  if (!car || p.onFoot) return;

  const def = CAR_KINDS[car.kind] || CAR_KINDS.sedan;
  // intent.my: -1 = forward (W / up), +1 = brake/reverse (S / down).
  const throttle = clamp(-(intent.my || 0), -1, 1);
  const steer = clamp(intent.mx || 0, -1, 1);

  if (throttle > 0) {
    car.speed += def.accel * throttle * dt;
  } else if (throttle < 0) {
    if (car.speed > 5) car.speed += def.accel * 1.2 * throttle * dt; // brake
    else car.speed += def.accel * 0.55 * throttle * dt; // reverse
  } else {
    // Coast / drag.
    if (car.speed > 0) car.speed = Math.max(0, car.speed - 140 * dt);
    else car.speed = Math.min(0, car.speed + 140 * dt);
  }
  if (car.health <= 0) car.speed *= Math.max(0, 1 - 2 * dt);
  car.speed = clamp(car.speed, -130, car.maxSpeed);

  // Steering: turn rate scales down with speed; reversing flips it.
  const spd = Math.abs(car.speed);
  const spdFactor = clamp(spd / 120, 0, 1) * (1 - Math.min(spd / car.maxSpeed, 1) * 0.45);
  const dirSign = car.speed >= 0 ? 1 : -1;
  car.angle += steer * 2.6 * spdFactor * dirSign * dt;

  // Skidmarks when steering hard at speed.
  if (Math.abs(steer) > 0.7 && spd > 200) {
    pushSkid(state, car.x - Math.cos(car.angle) * car.len * 0.4, car.y - Math.sin(car.angle) * car.len * 0.4, car.angle);
  }

  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  const fixed = collideBuildings(state.city, nx, ny, 16);
  if (fixed.x !== nx || fixed.y !== ny) {
    // Slide along the wall: strip only the velocity component that points
    // into the building (correction vector = outward normal), keep the
    // tangential component so the car slides instead of grinding to a halt.
    const cx = fixed.x - nx;
    const cy = fixed.y - ny;
    const cl = Math.sqrt(cx * cx + cy * cy) || 1;
    const ox = cx / cl;
    const oy = cy / cl;
    const vx = Math.cos(car.angle) * car.speed;
    const vy = Math.sin(car.angle) * car.speed;
    const vn = vx * ox + vy * oy; // < 0 means moving into the wall
    if (vn < 0) {
      const impact = -vn;
      if (impact > 120) {
        for (let i = 0; i < 6; i++) {
          pushParticle(state, fixed.x, fixed.y,
            (state.rng() - 0.5) * 220, (state.rng() - 0.5) * 220,
            0.4, '#ffd76a', 2);
        }
        car.health = Math.max(0, car.health - 4);
      }
      const tx = vx - vn * ox;
      const ty = vy - vn * oy;
      const ts = Math.sqrt(tx * tx + ty * ty);
      if (ts > 1) {
        car.angle = Math.atan2(ty, tx);
        car.speed = (car.speed < 0 ? -1 : 1) * ts * 0.98;
      } else {
        car.speed *= 0.5;
      }
    }
  }
  car.x = fixed.x;
  car.y = fixed.y;

  // Collisions with other cars: bounce + damage + sparks.
  for (const other of state.cars) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const rr = carRadius(car) + carRadius(other);
    const d2 = dx * dx + dy * dy;
    if (d2 < rr * rr && d2 > 0.01) {
      const d = Math.sqrt(d2);
      const push = (rr - d) / 2;
      const ux = dx / d;
      const uy = dy / d;
      car.x -= ux * push;
      car.y -= uy * push;
      other.x += ux * push;
      other.y += uy * push;
      const rel = Math.abs(car.speed - (other.speed || 0));
      if (rel > 60) {
        car.health = Math.max(0, car.health - 6);
        other.health = Math.max(0, other.health - 6);
        for (let i = 0; i < 5; i++) {
          pushParticle(state, (car.x + other.x) / 2, (car.y + other.y) / 2,
            (state.rng() - 0.5) * 200, (state.rng() - 0.5) * 200,
            0.35, '#ffd76a', 2);
        }
        // Hard hit only: bounce. Gentle overlaps separate positionally
        // (above) without grinding either car's speed down every tick.
        car.speed *= 0.6;
        if (typeof other.speed === 'number') other.speed *= 0.7;
      } else {
        car.speed *= 0.98;
      }
    }
  }

  // Keep the player glued to the car; track distance driven.
  p.x = car.x;
  p.y = car.y;
  p.angle = car.angle;
  p.speed = car.speed;
  if (state.stats) state.stats.distance = (state.stats.distance || 0) + spd * dt;
}

// Night check shared with draw: clockMin is minutes since midnight.
export function isNight(state) {
  const m = state.clockMin || 720;
  return m < 330 || m >= 1140;
}

export function drawCars(ctx, state) {
  const night = isNight(state);
  for (const car of state.cars) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    const len = car.len;
    const w = car.w;
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(-len / 2 + 3, -w / 2 + 4, len, w);
    // Body.
    ctx.fillStyle = car.color;
    ctx.beginPath();
    const r = 7;
    ctx.moveTo(-len / 2 + r, -w / 2);
    ctx.arcTo(len / 2, -w / 2, len / 2, w / 2, r);
    ctx.arcTo(len / 2, w / 2, -len / 2, w / 2, r);
    ctx.arcTo(-len / 2, w / 2, -len / 2, -w / 2, r);
    ctx.arcTo(-len / 2, -w / 2, len / 2, -w / 2, r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (car.kind === 'police') {
      // Black-white livery: black hood + trunk bands, light bar.
      ctx.fillStyle = '#16181c';
      ctx.fillRect(len / 2 - 12, -w / 2 + 1, 11, w - 2);
      ctx.fillRect(-len / 2 + 1, -w / 2 + 1, 9, w - 2);
      ctx.fillStyle = '#d81e3a';
      ctx.fillRect(-4, -w / 2 + 2, 4, 5);
      ctx.fillStyle = '#1e5ad8';
      ctx.fillRect(0, -w / 2 + 2, 4, 5);
      ctx.fillStyle = '#1e5ad8';
      ctx.fillRect(-4, w / 2 - 7, 4, 5);
      ctx.fillStyle = '#d81e3a';
      ctx.fillRect(0, w / 2 - 7, 4, 5);
    }
    // Windshield + roof + rear window.
    ctx.fillStyle = 'rgba(30,60,90,0.85)';
    ctx.fillRect(len * 0.18, -w / 2 + 3, len * 0.14, w - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(-len * 0.08, -w / 2 + 3, len * 0.16, w - 6);
    ctx.fillStyle = 'rgba(30,60,90,0.85)';
    ctx.fillRect(-len * 0.34, -w / 2 + 3, len * 0.10, w - 6);
    // Headlights (front = +x) and taillights.
    if (night) {
      ctx.fillStyle = 'rgba(255,240,170,0.9)';
      ctx.beginPath(); ctx.arc(len / 2 - 1, -w / 2 + 4, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(len / 2 - 1, w / 2 - 4, 3, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#fff3b0';
      ctx.fillRect(len / 2 - 3, -w / 2 + 2, 3, 4);
      ctx.fillRect(len / 2 - 3, w / 2 - 6, 3, 4);
    }
    ctx.fillStyle = '#d81e3a';
    ctx.fillRect(-len / 2 + 1, -w / 2 + 2, 3, 4);
    ctx.fillRect(-len / 2 + 1, w / 2 - 6, 3, 4);
    // Damage smoke.
    if (car.health < 40) {
      const t = (state.time || 0) + car.id * 1.7;
      const s = 5 + 3 * Math.sin(t * 6);
      ctx.fillStyle = 'rgba(120,120,120,0.55)';
      ctx.beginPath(); ctx.arc(-len * 0.2 + Math.sin(t * 3) * 4, -Math.sin(t * 5) * 3, Math.max(2, s), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  void isRoad;
}
