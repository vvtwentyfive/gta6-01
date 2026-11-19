// traffic.js — traffic AI: cars drive the road grid, turn at intersections,
// queue behind slow traffic, brake for the player, pause briefly, and respawn
// near the player when they drift too far away. Uses city road data only.
import { isRoad, nearestRoadPoint, randomRoadPoint } from './city.js';

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function nearestIn(arr, v) {
  let best = arr[0];
  let bd = Math.abs(v - best);
  for (const a of arr) {
    const d = Math.abs(v - a);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

// Shortest-arc angle lerp.
function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function targetAngle(car) {
  if (car.axis === 'h') return car.dir > 0 ? 0 : Math.PI;
  return car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
}

// Make sure a traffic car has the fields the AI needs (also repairs cars
// created with createCar(..., 'traffic') that never went through spawn).
function ensureAi(car, state) {
  if (car.axis !== 'h' && car.axis !== 'v') {
    const pt = nearestRoadPoint(state.city, car.x, car.y);
    const dx = Math.abs(pt.x - car.x);
    const dy = Math.abs(pt.y - car.y);
    if (dx <= dy) { car.axis = 'v'; car.x = pt.x; car.dir = state.rng() < 0.5 ? 1 : -1; }
    else { car.axis = 'h'; car.y = pt.y; car.dir = state.rng() < 0.5 ? 1 : -1; }
  }
  if (car.dir !== 1 && car.dir !== -1) car.dir = 1;
  if (typeof car.pause !== 'number') car.pause = 0;
  if (typeof car.cruise !== 'number') {
    car.cruise = car.kind === 'sports' ? 140 : car.kind === 'truck' ? 90 : 110;
  }
  if (typeof car._turned !== 'boolean') car._turned = false;
}

export function updateTraffic(state, dt) {
  const city = state.city;
  const rng = state.rng;
  const p = state.player;
  const gridX1 = 192 + 10 * 284 + 64; // east edge of the last vertical road
  const gridY1 = 10 * 284 + 64; // south edge of the last horizontal road

  for (const car of state.cars) {
    if (car.driver !== 'traffic') continue;
    ensureAi(car, state);

    // Respawn far-away cars near the player so streets stay busy.
    if (p) {
      const pdx = car.x - p.x;
      const pdy = car.y - p.y;
      if (pdx * pdx + pdy * pdy > 1400 * 1400) {
        let pt = null;
        for (let tries = 0; tries < 12; tries++) {
          const cand = randomRoadPoint(city, rng);
          const cdx = cand.x - p.x;
          const cdy = cand.y - p.y;
          const cd = Math.sqrt(cdx * cdx + cdy * cdy);
          if (cd >= 500 && cd <= 1000) { pt = cand; break; }
          if (!pt) pt = cand;
        }
        car.x = pt.x;
        car.y = pt.y;
        car.axis = rng() < 0.5 ? 'h' : 'v';
        car.dir = rng() < 0.5 ? 1 : -1;
        car.speed = car.cruise * 0.5;
        car.pause = 0;
        car._turned = false;
        continue;
      }
    }

    // Off-road safety net: snap back onto the nearest road.
    if (!isRoad(city, car.x, car.y)) {
      const pt = nearestRoadPoint(city, car.x, car.y);
      car.x = pt.x;
      car.y = pt.y;
    }

    // Intersection detection: near both a vertical and a horizontal centre.
    const nearV = nearestIn(city.roads.v, car.x);
    const nearH = nearestIn(city.roads.h, car.y);
    const atCross = Math.abs(car.x - nearV) < 16 && Math.abs(car.y - nearH) < 16;

    if (atCross && !car._turned) {
      car._turned = true;
      const roll = rng();
      if (roll < 0.22) {
        // Turn: switch axis, random new direction.
        car.axis = car.axis === 'h' ? 'v' : 'h';
        car.dir = rng() < 0.5 ? 1 : -1;
        // Snap onto the cross road's centre line.
        if (car.axis === 'h') car.y = nearH;
        else car.x = nearV;
      } else if (roll < 0.28) {
        car.pause = 0.5 + rng() * 1.0;
      }
    } else if (!atCross) {
      car._turned = false;
    }

    // Desired speed: cruise, 0 while paused.
    let target = car.cruise;
    if (car.pause > 0) {
      car.pause -= dt;
      target = 0;
    }

    // Car close ahead on the same road/lane: slow / stop.
    for (const other of state.cars) {
      if (other === car) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      let ahead = 0;
      let lateral = 0;
      if (car.axis === 'h') { ahead = dx * car.dir; lateral = Math.abs(dy); }
      else { ahead = dy * car.dir; lateral = Math.abs(dx); }
      if (ahead > 0 && ahead < 70 && lateral < 26) {
        target = 0;
        break;
      } else if (ahead > 0 && ahead < 130 && lateral < 26) {
        target = Math.min(target, 45);
      }
    }

    // Avoid the player car: brake if it is close ahead; also brake for a
    // player on foot standing in front of the car.
    if (p && p.car) {
      const dx = p.car.x - car.x;
      const dy = p.car.y - car.y;
      const ahead = car.axis === 'h' ? dx * car.dir : dy * car.dir;
      const lateral = car.axis === 'h' ? Math.abs(dy) : Math.abs(dx);
      if (ahead > 0 && ahead < 100 && lateral < 30) target = 0;
    } else if (p && p.onFoot) {
      const dx = p.x - car.x;
      const dy = p.y - car.y;
      const ahead = car.axis === 'h' ? dx * car.dir : dy * car.dir;
      const lateral = car.axis === 'h' ? Math.abs(dy) : Math.abs(dx);
      if (ahead > 0 && ahead < 60 && lateral < 26) target = 0;
    }

    // Accelerate / brake toward target speed.
    if (car.speed < target) car.speed = Math.min(target, car.speed + 160 * dt);
    else if (car.speed > target) car.speed = Math.max(target, car.speed - 260 * dt);

    // Move along the current axis; ease onto the road centre line.
    if (car.axis === 'h') {
      car.x += car.dir * car.speed * dt;
      const centre = nearestIn(city.roads.h, car.y);
      car.y += (centre - car.y) * Math.min(1, 3 * dt);
      // End of the road: turn around.
      if (car.x < 224 - 20 || car.x > gridX1 - 20) {
        car.dir *= -1;
        car.x = clamp(car.x, 224, gridX1);
      }
    } else {
      car.y += car.dir * car.speed * dt;
      const centre = nearestIn(city.roads.v, car.x);
      car.x += (centre - car.x) * Math.min(1, 3 * dt);
      if (car.y < 32 - 20 || car.y > gridY1 - 20) {
        car.dir *= -1;
        car.y = clamp(car.y, 32, gridY1);
      }
    }

    // Face the direction of travel (smooth turn).
    car.angle = angleLerp(car.angle, targetAngle(car), Math.min(1, 8 * dt));
  }
}
