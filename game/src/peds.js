// peds.js — pedestrian AI: walk sidewalks, idle/chat, flee danger.
// Imports only city.js helpers. Peds never walk through buildings: movement
// is clamped to sidewalk/road-adjacent walkable areas.
import { collideBuildings, isRoad, nearestRoadPoint, pointInBuilding, randomRoadPoint } from './city.js';

const SHIRTS = ['#d81e3a', '#1e9ad8', '#3a9a4a', '#e8a13a', '#7a4a9a', '#e8e8e8', '#2e2e34', '#d85a9a', '#4aa8a0', '#c9c23a'];
const SKINS = ['#e8b88a', '#c98d5a', '#8a5a34', '#f0c8a0'];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// A sidewalk point near a road intersection: offset ~40px from the road centre
// (road half-width 32 + sidewalk), on a random side.
function sidewalkPoint(state, rng) {
  const pt = randomRoadPoint(state.city, rng);
  const alongH = rng() < 0.5;
  const side = rng() < 0.5 ? 1 : -1;
  if (alongH) return { x: pt.x + (rng() * 2 - 1) * 120, y: pt.y + side * 40 };
  return { x: pt.x + side * 40, y: pt.y + (rng() * 2 - 1) * 120 };
}

function pickWalkTarget(state, ped) {
  const rng = state.rng;
  // Walk to a nearby sidewalk point: from the nearest intersection, head
  // along one road for a stretch, staying on the sidewalk band.
  const base = nearestRoadPoint(state.city, ped.x, ped.y);
  const axisH = rng() < 0.5;
  const dir = rng() < 0.5 ? 1 : -1;
  const side = rng() < 0.5 ? 1 : -1;
  const dist = 90 + rng() * 190;
  let tx;
  let ty;
  if (axisH) {
    tx = clamp(base.x + dir * dist, 200, state.city.size - 40);
    ty = base.y + side * 40;
  } else {
    tx = base.x + side * 40;
    ty = clamp(base.y + dir * dist, 40, state.city.size - 40);
  }
  // Never target inside a building; fall back to the base road point.
  if (pointInBuilding(state.city, tx, ty)) {
    tx = base.x;
    ty = base.y;
  }
  return { x: tx, y: ty };
}

export function spawnPeds(state, n) {
  const rng = state.rng;
  let placed = 0;
  let guard = 0;
  while (placed < n && guard < n * 20) {
    guard++;
    const pt = sidewalkPoint(state, rng);
    if (pointInBuilding(state.city, pt.x, pt.y)) continue;
    const ped = {
      x: pt.x, y: pt.y,
      angle: rng() * Math.PI * 2,
      speed: 0,
      state: 'walk',
      color: pick(rng, SHIRTS),
      skin: pick(rng, SKINS),
      tx: pt.x, ty: pt.y,
      idle: 0, bob: rng() * 6,
      fx: 0, fy: 0, fleeT: 0,
      walkSpeed: 42 + rng() * 28,
    };
    const tgt = pickWalkTarget(state, ped);
    ped.tx = tgt.x;
    ped.ty = tgt.y;
    state.peds.push(ped);
    placed++;
  }
  return placed;
}

export function updatePeds(state, dt) {
  const rng = state.rng;
  const p = state.player;

  for (const ped of state.peds) {
    // --- Threat scan ------------------------------------------------------
    let threat = null;
    let threatD2 = 230 * 230;
    const consider = (tx, ty, radius) => {
      const dx = ped.x - tx;
      const dy = ped.y - ty;
      const d2 = dx * dx + dy * dy;
      if (d2 < threatD2 && d2 < radius * radius) {
        threatD2 = d2;
        threat = { x: tx, y: ty };
      }
    };
    // Gunfire: muzzle flash or live bullets (threat = player / last bullet).
    if (state.combat && (state.combat.muzzle > 0 || (state.combat.bullets && state.combat.bullets.length > 0))) {
      if (state.combat.bullets && state.combat.bullets.length > 0) {
        const b = state.combat.bullets[state.combat.bullets.length - 1];
        consider(b.x, b.y, 260);
      } else if (p) {
        consider(p.x, p.y, 260);
      }
    }
    // Player car speeding close.
    if (p && p.car && Math.abs(p.car.speed) > 120) {
      consider(p.car.x, p.car.y, 200);
    }
    // Police pursuit nearby (any police car moving fast close by).
    for (const car of state.cars) {
      if (car.driver === 'police' && Math.abs(car.speed) > 100) {
        consider(car.x, car.y, 200);
      }
    }
    // A traffic car about to hit the ped also scares them.
    for (const car of state.cars) {
      if (car.driver === 'traffic' && Math.abs(car.speed) > 60) {
        consider(car.x, car.y, 55);
      }
    }

    if (threat) {
      ped.state = 'flee';
      ped.fx = threat.x;
      ped.fy = threat.y;
      ped.fleeT = 1.2;
    } else if (ped.state === 'flee') {
      ped.fleeT -= dt;
      if (ped.fleeT <= 0) {
        ped.state = 'walk';
        const tgt = pickWalkTarget(state, ped);
        ped.tx = tgt.x;
        ped.ty = tgt.y;
      }
    }

    // --- Behaviour --------------------------------------------------------
    if (ped.state === 'flee') {
      // Run directly away from the threat at ~220 px/s.
      let dx = ped.x - ped.fx;
      let dy = ped.y - ped.fy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= d;
      dy /= d;
      ped.angle = Math.atan2(dy, dx);
      ped.speed = 220;
      const nx = ped.x + dx * ped.speed * dt;
      const ny = ped.y + dy * ped.speed * dt;
      const fixed = movePed(state, ped, nx, ny);
      ped.x = fixed.x;
      ped.y = fixed.y;
      ped.bob += ped.speed * dt * 0.09;
    } else if (ped.state === 'idle') {
      ped.idle -= dt;
      ped.speed = 0;
      if (ped.idle <= 0) {
        ped.state = 'walk';
        const tgt = pickWalkTarget(state, ped);
        ped.tx = tgt.x;
        ped.ty = tgt.y;
      }
    } else {
      // Walk toward the waypoint.
      const dx = ped.tx - ped.x;
      const dy = ped.ty - ped.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 12) {
        // Arrived: sometimes idle/chat, otherwise pick a new waypoint.
        if (rng() < 0.22) {
          ped.state = 'idle';
          ped.idle = 2 + rng() * 3;
          ped.speed = 0;
        } else {
          const tgt = pickWalkTarget(state, ped);
          ped.tx = tgt.x;
          ped.ty = tgt.y;
        }
      } else {
        ped.angle = Math.atan2(dy, dx);
        ped.speed = ped.walkSpeed || 55;
        const nx = ped.x + (dx / d) * ped.speed * dt;
        const ny = ped.y + (dy / d) * ped.speed * dt;
        const fixed = movePed(state, ped, nx, ny);
        ped.x = fixed.x;
        ped.y = fixed.y;
        ped.bob += ped.speed * dt * 0.09;
      }
    }
  }
}

// Move a ped, keeping them out of buildings and on walkable ground.
// If the step would enter a building, the ped is held in place and (for
// walkers) gets a fresh waypoint next tick via the arrival check.
function movePed(state, ped, nx, ny) {
  const fixed = collideBuildings(state.city, nx, ny, 7);
  // If the correction moved us a lot, we hit a wall: nudge the waypoint so
  // the ped turns away instead of grinding against the building.
  if (Math.abs(fixed.x - nx) > 1 || Math.abs(fixed.y - ny) > 1) {
    if (ped.state === 'walk') {
      const tgt = pickWalkTarget(state, ped);
      ped.tx = tgt.x;
      ped.ty = tgt.y;
    }
  }
  // Keep peds near roads/sidewalks: if they somehow end up deep inside a
  // block (not on/near a road), steer them back toward the nearest road.
  if (!isRoad(state.city, fixed.x, fixed.y)) {
    // Check the sidewalk band: within roadW/2 + 16 of a road centre.
    const half = state.city.roadW / 2 + 16;
    let near = false;
    for (const cy of state.city.roads.h) {
      if (Math.abs(fixed.y - cy) <= half) { near = true; break; }
    }
    if (!near) {
      for (const cx of state.city.roads.v) {
        if (Math.abs(fixed.x - cx) <= half) { near = true; break; }
      }
    }
    if (!near) {
      const pt = nearestRoadPoint(state.city, fixed.x, fixed.y);
      return { x: fixed.x + (pt.x - fixed.x) * 0.2, y: fixed.y + (pt.y - fixed.y) * 0.2 };
    }
  }
  return fixed;
}

export function drawPeds(ctx, state) {
  for (const ped of state.peds) {
    const bob = Math.sin(ped.bob || 0) * (ped.state === 'flee' ? 2.5 : 1.2);
    const px = ped.x + Math.cos(ped.angle + Math.PI / 2) * bob;
    const py = ped.y + Math.sin(ped.angle + Math.PI / 2) * bob;
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(ped.x, ped.y + 3, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
    // Body (shirt colour).
    ctx.fillStyle = ped.color || '#d81e3a';
    ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Head.
    ctx.fillStyle = ped.skin || '#e8b88a';
    ctx.beginPath(); ctx.arc(px + Math.cos(ped.angle) * 2, py + Math.sin(ped.angle) * 2, 4, 0, Math.PI * 2); ctx.fill();
    // Fleeing peds get a small alarm mark.
    if (ped.state === 'flee') {
      ctx.fillStyle = '#ffd76a';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', px, py - 12);
      ctx.textAlign = 'left';
    }
  }
}
