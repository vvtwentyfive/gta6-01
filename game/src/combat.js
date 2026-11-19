// combat.js — Melee, shooting, bullets, player damage, wasted/respawn (W3).
//
// Weapons: 'fists' (start), 'pistol' (Mara hands it over after mission 1,
// 24 ammo), 'smg' (buyable / pickup ammo later, 60 ammo).
//   F punch: melee arc in front of the player, range 34, damage 25,
//            knockback, 0.35 s cooldown.
//   Mouse click: shoot when weapon != 'fists' and ammo > 0. Bullets damage
//            peds, cars and police; every shot pushes a {type:'gunshot'}
//            event (police.js turns that into heat) and makes nearby peds flee.
//   Player damage: armor absorbs first, then health. health <= 0 pushes
//            {type:'wasted'} and respawns the player at the hospital with a
//            cash penalty (missions.js fails the active mission off the event).
//
// Contract (W1 calls these):
//   initCombat(state)
//   updateCombat(state, dt, input) — input {punch, shoot, aimX, aimY}
//   drawCombat(ctx, state)
//   damagePlayer(state, amount) — also used by police rams / cop punches
//   WEAPONS — per-weapon tuning
//
// Deterministic: no Date.now(), no Math.random(); randomness (sparks) uses
// state.rng only.

export const WEAPONS = {
  fists: { damage: 25, rate: 0.35, range: 34, bulletSpeed: 0 },
  pistol: { damage: 34, rate: 0.25, bulletSpeed: 720, ammoPickup: 24 },
  smg: { damage: 20, rate: 0.09, bulletSpeed: 800, ammoPickup: 60 },
};

const MELEE_ARC = 1.1; // half-angle (radians) of the punch arc
const BULLET_LIFE = 0.9;

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

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
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

function addFloater(state, x, y, text, color) {
  const c = state.combat;
  if (!c) return;
  if (!Array.isArray(c.damageNumbers)) c.damageNumbers = [];
  if (c.damageNumbers.length > 24) c.damageNumbers.shift();
  c.damageNumbers.push({ x, y, text: String(text), color: color || '#ffffff', life: 0.9 });
}

function districtCenter(city, fragment) {
  if (!city || !Array.isArray(city.districts)) return null;
  const want = String(fragment).toLowerCase();
  for (const d of city.districts) {
    if (!String(d.name || '').toLowerCase().includes(want)) continue;
    if (typeof d.cx === 'number' && typeof d.cy === 'number') return { x: d.cx, y: d.cy };
    if (d.center && typeof d.center.x === 'number') return { x: d.center.x, y: d.center.y };
    if (typeof d.x === 'number' && typeof d.w === 'number') return { x: d.x + d.w / 2, y: d.y + d.h / 2 };
  }
  return null;
}

function hospitalPoint(state) {
  // Prefer the location missions.js already resolved, else the city.
  if (state.missions && state.missions.locations && state.missions.locations.hospital) {
    return state.missions.locations.hospital;
  }
  const city = state.city;
  if (city && Array.isArray(city.landmarks)) {
    for (const lm of city.landmarks) {
      if (String(lm.kind || '').toLowerCase() === 'hospital' || String(lm.name || '').toLowerCase().includes('hospital')) {
        return { x: lm.x, y: lm.y };
      }
    }
  }
  const dc = districtCenter(city, 'uptown');
  if (dc) return dc;
  if (city && city.spawnPoint) return { x: city.spawnPoint.x, y: city.spawnPoint.y };
  return { x: 100, y: 100 };
}

export function initCombat(state) {
  state.combat = {
    bullets: [],
    muzzle: 0,
    punchCooldown: 0,
    fireCooldown: 0,
    swing: 0,
    swingAngle: 0,
    damageNumbers: [],
  };
  return state.combat;
}

function ensureCombat(state) {
  if (!state.combat || !Array.isArray(state.combat.bullets)) initCombat(state);
  if (state.combat.damageNumbers === undefined) state.combat.damageNumbers = [];
  return state.combat;
}

// Armor absorbs damage first; the rest comes off health. At 0 health the
// player is wasted: cash penalty, hospital respawn, {type:'wasted'} event.
export function damagePlayer(state, amount) {
  const p = state.player;
  if (!p || amount <= 0) return;
  let rest = amount;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, rest);
    p.armor -= absorbed;
    rest -= absorbed;
  }
  if (rest > 0) p.health = Math.max(0, (p.health || 0) - rest);
  if (p.health <= 0) {
    const hosp = hospitalPoint(state);
    state.events = state.events || [];
    state.events.push({ type: 'wasted', x: p.x, y: p.y });
    p.cash = Math.max(0, (p.cash || 0) - 200);
    p.x = hosp.x;
    p.y = hosp.y;
    p.angle = 0;
    p.speed = 0;
    p.onFoot = true;
    p.car = null;
    p.health = 100;
    p.armor = 0;
    if (state.wanted) {
      state.wanted.stars = 0;
      state.wanted.heat = 0;
      state.wanted.hidden = 0;
    }
    state.policeSiren = false;
    if (Array.isArray(state.police)) state.police.length = 0;
    if (Array.isArray(state.cars)) {
      for (let i = state.cars.length - 1; i >= 0; i -= 1) {
        if (state.cars[i].driver === 'police') state.cars.splice(i, 1);
      }
    }
  }
}

function damagePed(state, ped, dmg, fromX, fromY) {
  if (!ped) return;
  ped.hp = (typeof ped.hp === 'number' ? ped.hp : 50) - dmg;
  // Knockback away from the attacker.
  const dx = ped.x - fromX;
  const dy = ped.y - fromY;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  ped.x += (dx / d) * 10;
  ped.y += (dy / d) * 10;
  addFloater(state, ped.x, ped.y - 14, `-${dmg}`, '#ffdd55');
  pushParticles(state, ped.x, ped.y, '#ff5555', 4, 90);
  if (ped.hp <= 0) {
    ped.state = 'down';
    ped.speed = 0;
    state.events = state.events || [];
    state.events.push({ type: 'ped-down', x: ped.x, y: ped.y });
  } else {
    ped.state = 'flee';
  }
}

function destroyCar(state, car) {
  if (!car) return;
  car.health = 0;
  pushParticles(state, car.x, car.y, '#ff8800', 14, 200);
  pushParticles(state, car.x, car.y, '#888888', 8, 60);
  state.events = state.events || [];
  if (car.driver === 'police') {
    state.events.push({ type: 'cop-down', x: car.x, y: car.y });
    const idx = state.cars.indexOf(car);
    if (idx >= 0) state.cars.splice(idx, 1);
    // Drop the matching on-foot record, if any.
    if (Array.isArray(state.police)) {
      for (let i = state.police.length - 1; i >= 0; i -= 1) {
        if (state.police[i].carId === car.id) state.police.splice(i, 1);
      }
    }
  } else {
    state.events.push({ type: 'car-destroyed', carId: car.id, x: car.x, y: car.y });
    car.speed = 0;
  }
}

function damageCar(state, car, dmg, fromX, fromY) {
  if (!car) return;
  car.health = (typeof car.health === 'number' ? car.health : 100) - dmg;
  addFloater(state, car.x, car.y - 16, `-${dmg}`, '#ffcc44');
  pushParticles(state, fromX, fromY, '#ffdd66', 5, 160);
  if (car.health <= 0) destroyCar(state, car);
}

function doPunch(state) {
  const c = ensureCombat(state);
  const p = state.player;
  if (!p) return;
  c.punchCooldown = WEAPONS.fists.rate;
  c.swing = 0.18;
  c.swingAngle = p.angle;
  const range = WEAPONS.fists.range;
  const dmg = WEAPONS.fists.damage;
  // Peds in the arc.
  if (Array.isArray(state.peds)) {
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      const d = dist(ped.x, ped.y, p.x, p.y);
      if (d > range) continue;
      const ang = Math.atan2(ped.y - p.y, ped.x - p.x);
      if (angleDiff(ang, p.angle) > MELEE_ARC) continue;
      damagePed(state, ped, dmg, p.x, p.y);
    }
  }
  // On-foot cops in the arc.
  if (Array.isArray(state.police)) {
    for (let i = state.police.length - 1; i >= 0; i -= 1) {
      const cop = state.police[i];
      if (!cop.onFoot) continue;
      const d = dist(cop.x, cop.y, p.x, p.y);
      if (d > range) continue;
      const ang = Math.atan2(cop.y - p.y, cop.x - p.x);
      if (angleDiff(ang, p.angle) > MELEE_ARC) continue;
      cop.hp = (typeof cop.hp === 'number' ? cop.hp : 60) - dmg;
      addFloater(state, cop.x, cop.y - 14, `-${dmg}`, '#ffdd55');
      if (cop.hp <= 0) {
        state.police.splice(i, 1);
        state.events = state.events || [];
        state.events.push({ type: 'cop-down', x: cop.x, y: cop.y });
      }
    }
  }
  // A car right in front of the player takes a dent.
  if (Array.isArray(state.cars)) {
    for (const car of state.cars) {
      const d = dist(car.x, car.y, p.x, p.y);
      if (d > 44) continue;
      const ang = Math.atan2(car.y - p.y, car.x - p.x);
      if (angleDiff(ang, p.angle) > MELEE_ARC) continue;
      damageCar(state, car, 10, p.x + Math.cos(p.angle) * 24, p.y + Math.sin(p.angle) * 24);
    }
  }
}

function doShoot(state, input) {
  const c = ensureCombat(state);
  const p = state.player;
  if (!p) return;
  const weapon = p.weapon || 'fists';
  const spec = WEAPONS[weapon] || WEAPONS.pistol;
  if ((p.ammo || 0) <= 0) {
    c.fireCooldown = 0.25; // dry-fire click: brief pause, no bullet
    return;
  }
  c.fireCooldown = spec.rate;
  p.ammo -= 1;
  c.muzzle = 0.08;
  let dir = p.angle || 0;
  if (typeof input.aimX === 'number' && typeof input.aimY === 'number') {
    dir = Math.atan2(input.aimY - p.y, input.aimX - p.x);
    if (p.onFoot) p.angle = dir;
  }
  const mx = p.x + Math.cos(dir) * 22;
  const my = p.y + Math.sin(dir) * 22;
  state.combat.bullets.push({
    x: mx,
    y: my,
    vx: Math.cos(dir) * spec.bulletSpeed,
    vy: Math.sin(dir) * spec.bulletSpeed,
    life: BULLET_LIFE,
    damage: spec.damage,
  });
  state.events = state.events || [];
  state.events.push({ type: 'gunshot', x: p.x, y: p.y });
  // The noise makes nearby peds run.
  if (Array.isArray(state.peds)) {
    for (const ped of state.peds) {
      if (ped.state !== 'down' && dist(ped.x, ped.y, p.x, p.y) < 280) ped.state = 'flee';
    }
  }
}

function updateBullets(state, dt) {
  const c = state.combat;
  const bullets = c.bullets;
  for (let i = bullets.length - 1; i >= 0; i -= 1) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let dead = b.life <= 0;
    if (!dead && Array.isArray(state.peds)) {
      for (const ped of state.peds) {
        if (ped.state === 'down') continue;
        if (dist(ped.x, ped.y, b.x, b.y) < 14) {
          damagePed(state, ped, b.damage, b.x - b.vx * 0.02, b.y - b.vy * 0.02);
          dead = true;
          break;
        }
      }
    }
    if (!dead && Array.isArray(state.police)) {
      for (let j = state.police.length - 1; j >= 0; j -= 1) {
        const cop = state.police[j];
        if (!cop.onFoot) continue;
        if (dist(cop.x, cop.y, b.x, b.y) < 14) {
          cop.hp = (typeof cop.hp === 'number' ? cop.hp : 60) - b.damage;
          addFloater(state, cop.x, cop.y - 14, `-${b.damage}`, '#ffdd55');
          pushParticles(state, b.x, b.y, '#ff5555', 4, 90);
          if (cop.hp <= 0) {
            state.police.splice(j, 1);
            state.events = state.events || [];
            state.events.push({ type: 'cop-down', x: cop.x, y: cop.y });
          }
          dead = true;
          break;
        }
      }
    }
    if (!dead && Array.isArray(state.cars)) {
      // Iterate over a copy: damageCar may splice a destroyed police car.
      for (const car of state.cars.slice()) {
        if (dist(car.x, car.y, b.x, b.y) < 22) {
          damageCar(state, car, b.damage, b.x, b.y);
          dead = true;
          break;
        }
      }
    }
    if (dead) bullets.splice(i, 1);
  }
}

export function updateCombat(state, dt, input) {
  const c = ensureCombat(state);
  const inp = input || {};
  if (c.punchCooldown > 0) c.punchCooldown -= dt;
  if (c.fireCooldown > 0) c.fireCooldown -= dt;
  if (c.muzzle > 0) c.muzzle -= dt;
  if (c.swing > 0) c.swing -= dt;
  const p = state.player;
  if (p) {
    if (inp.punch && c.punchCooldown <= 0) doPunch(state);
    const weapon = p.weapon || 'fists';
    if (inp.shoot && weapon !== 'fists' && c.fireCooldown <= 0) doShoot(state, inp);
    // Aiming on foot turns Rico toward the cursor (driving keeps the car).
    if (p.onFoot && typeof inp.aimX === 'number' && typeof inp.aimY === 'number' && inp.shoot) {
      p.angle = Math.atan2(inp.aimY - p.y, inp.aimX - p.x);
    }
  }
  updateBullets(state, dt);
  // Damage numbers float up and fade.
  for (let i = c.damageNumbers.length - 1; i >= 0; i -= 1) {
    const f = c.damageNumbers[i];
    f.y -= 28 * dt;
    f.life -= dt;
    if (f.life <= 0) c.damageNumbers.splice(i, 1);
  }
}

export function drawCombat(ctx, state) {
  if (!ctx || !state.combat) return;
  const c = state.combat;
  const p = state.player;
  ctx.save();
  // Bullets: short tracer lines.
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffe08a';
  ctx.beginPath();
  for (const b of c.bullets) {
    ctx.moveTo(b.x - b.vx * 0.03, b.y - b.vy * 0.03);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  if (p) {
    // Muzzle flash.
    if (c.muzzle > 0) {
      const mx = p.x + Math.cos(p.angle) * 26;
      const my = p.y + Math.sin(p.angle) * 26;
      ctx.fillStyle = '#ffdf5e';
      ctx.beginPath();
      ctx.arc(mx, my, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff6bf';
      ctx.beginPath();
      ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Melee swing arc.
    if (c.swing > 0) {
      const a0 = (c.swingAngle || p.angle) - MELEE_ARC;
      const a1 = (c.swingAngle || p.angle) + MELEE_ARC;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, WEAPONS.fists.range, a0, a1);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, WEAPONS.fists.range, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Damage numbers.
  if (Array.isArray(c.damageNumbers)) {
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of c.damageNumbers) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / 0.9));
      ctx.fillStyle = f.color || '#ffffff';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
