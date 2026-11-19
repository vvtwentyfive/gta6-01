// The screenshot scenes behind ?shot=chase|street|mission|night. Each one
// takes a fresh seeded state, arranges it into the scene, then plays the real
// rules forward for a fixed number of steps under a scripted autopilot, so
// the frame is what short play really looks like and the same seed always
// gives the same frame. Nothing here uses Math.random — only state.rng, by
// way of the modules it steps.
//
// Driving intents follow the car convention: my -1 is full forward, +1 is
// brake/reverse, and mx steers (-1 left, +1 right). On foot the same pair
// is the world-space move direction.
import { STEP } from './config.js';
import { SCREEN_PLAY } from './render.js';
import { MISSIONS, startMission } from './missions.js';
import { createCar } from './vehicles.js';
import { spawnCruiser } from './police.js';

const CHASE_SECONDS = 6;
const STREET_SECONDS = 6;
const MISSION_SECONDS = 3;
const NIGHT_SECONDS = 2;

/** Wrap an angle to [-PI, PI]. */
function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** Run the real step function forward, one intent per step, for `seconds`. */
function runSteps(state, stepGame, seconds, intentFor) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) stepGame(state, intentFor(i), STEP);
}

function idleIntent() {
  return { mx: 0, my: 0, enter: false, punch: false, shoot: false, aimX: 0, aimY: 0 };
}

/**
 * Stage the named scene on the fresh `state` main.js passes in (mutated in
 * place) and return the screen to draw over it, the best haul to show, and
 * the staged state. `stepGame` is main.js's fixed-step function. Any other
 * name stages the street scene.
 */
export function stageShot(name, state, stepGame) {
  if (name === 'chase') {
    // Cover: Rico has just stolen a car and the Solmar PD is on him. The
    // cruisers arrive on their own: three stars makes updatePolice spawn
    // them near the player during the simulation.
    //
    // The chase runs EAST along one horizontal road in the middle of the
    // city (a straight road-following controller keeps the car on the
    // asphalt: the first version wandered north off the grid and the frame
    // was half empty grass). A sedan, so mission 1's first step is the
    // live objective while the chase is on.
    const roadY = state.city.roads.h[5];
    const startX = state.city.roads.v[2];
    const car = state.cars.find((c) => c.kind === 'sedan') || state.cars[0];
    if (car) {
      car.x = startX;
      car.y = roadY;
      car.angle = 0;
      car.driver = 'player';
      car.speed = 200;
      state.player.car = car;
      state.player.onFoot = false;
      state.player.x = car.x;
      state.player.y = car.y;
      state.player.angle = car.angle;
    }
    state.wanted.stars = 3;
    state.wanted.heat = 75;
    state.stats.wantedMax = 3;
    // One pursuer staged 350 px behind on the same road, so the cover
    // frame shows a cruiser in the chase, not just stars: the system's own
    // spawns start 560-720 px away and mostly stay out of frame. It is a
    // real cruiser under the real pursuit rules (it accelerates, steers,
    // and rams like any other); the system tops the count up to 4 anyway.
    if (car) spawnCruiser(state, startX - 350, roadY, 0, 'pursue');
    runSteps(state, stepGame, CHASE_SECONDS, () => {
      // Steer toward the road centreline and back to heading east.
      const err = state.player.y - roadY;
      const steer = clamp(-err / 60 - wrapAngle(state.player.angle) * 2, -1, 1);
      return {
        mx: steer,
        my: -1,
        enter: false,
        punch: false,
        shoot: false,
        aimX: state.player.x + Math.cos(state.player.angle) * 300,
        aimY: state.player.y + Math.sin(state.player.angle) * 300,
      };
    });
    // Mission 1 completes mid-chase (steal the sedan, then reach the
    // garage): the next mission only starts after its 4 s delay, so the
    // HUD would show no objective at all. Start it now so the cover shows
    // the live objective like the other shots do.
    if (!state.missions.current && state.missions.index < MISSIONS.length) {
      startMission(state, state.missions.index);
    }
    return { screen: SCREEN_PLAY, best: 0, state };
  }

  if (name === 'mission') {
    // A job is live: objective marker on the HUD and the briefing's first
    // line in the dialogue box (main.js paces the lines, so it is still
    // showing after the short simulation).
    startMission(state, 1);
    const mission = state.missions.current;
    if (mission && mission.blip) {
      state.player.x = mission.blip.x - 220;
      state.player.y = mission.blip.y + 120;
      state.player.angle = Math.atan2(mission.blip.y - state.player.y, mission.blip.x - state.player.x);
    }
    runSteps(state, stepGame, MISSION_SECONDS, () => idleIntent());
    return { screen: SCREEN_PLAY, best: 0, state };
  }

  if (name === 'night') {
    // 21:30, a firefight and a police roadblock ahead. The roadblock is two
    // parked cruisers in roadblock mode; three stars keeps them there.
    state.clockMin = 21 * 60 + 30;
    state.wanted.stars = 3;
    state.wanted.heat = 75;
    state.stats.wantedMax = 3;
    // Rico starts with fists and no ammo, so shoot intents dry-fire: hand
    // him the pistol for this scene so the firefight is real.
    state.player.weapon = 'pistol';
    state.player.ammo = 24;
    const perp = state.player.angle + Math.PI / 2;
    for (const off of [-40, 40]) {
      const cruiser = createCar(
        state,
        'police',
        state.player.x + 300,
        state.player.y + off,
        perp,
        'police',
      );
      cruiser.speed = 0;
      cruiser._police = { mode: 'roadblock', ramCooldown: 0, ttl: 8 };
      state.cars.push(cruiser);
    }
    state.combat.muzzle = 0.12;
    state.combat.bullets.push({
      x: state.player.x + 20,
      y: state.player.y,
      vx: 900,
      vy: 0,
      life: 0.5,
      damage: 34,
    });
    state.particles.push({
      x: state.player.x + 24,
      y: state.player.y,
      vx: 60,
      vy: -30,
      life: 0.25,
      maxLife: 0.25,
      color: '#ffd23f',
      size: 5,
    });
    runSteps(state, stepGame, NIGHT_SECONDS, () => ({
      mx: 0,
      my: 0,
      enter: false,
      punch: false,
      shoot: true,
      aimX: state.player.x + 400,
      aimY: state.player.y,
    }));
    // Re-arm a fresh muzzle flash and tracer AFTER the simulation: the
    // staged flash decayed during the 2 s run and its bullet had flown
    // 1800 px away, so the frame showed no fire at all.
    state.combat.muzzle = 0.12;
    state.combat.bullets.push({
      x: state.player.x + 26,
      y: state.player.y,
      vx: 900,
      vy: 0,
      life: 0.5,
      damage: 34,
    });
    return { screen: SCREEN_PLAY, best: 0, state };
  }

  // 'street' (and anything unknown): on foot in a busy street, peds and
  // parked cars around, the player strolling toward the first job. The
  // player walks EAST along one horizontal road (with a small weave); the
  // first version wandered in a straight line and ended up standing inside
  // a building block, because on-foot movement has no building collision.
  const streetY = state.city.roads.h[6];
  state.player.x = state.city.roads.v[3];
  state.player.y = streetY;
  state.player.angle = 0;
  runSteps(state, stepGame, STREET_SECONDS, (i) => {
    const weave = Math.sin(i * STEP * 0.7) * 0.25;
    const correct = clamp((streetY - state.player.y) / 40, -1, 1);
    return {
      mx: 0.9,
      my: correct + weave,
      enter: false,
      punch: false,
      shoot: false,
      aimX: state.player.x + 200,
      aimY: state.player.y,
    };
  });
  return { screen: SCREEN_PLAY, best: 0, state };
}
