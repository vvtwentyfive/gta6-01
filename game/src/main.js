// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps (several in a slow frame, none in a fast one), and the
// renderer paints what is there. The game moves between four screens: title,
// play, paused and game over.
//
// ?seed=N fixes the city. ?shot=chase|street|mission|night (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { BEST_KEY, CAR, CLOCK_RATE, PED_COUNT, PLAYER, STEP, TRAFFIC_CARS, WORLD } from './config.js';
import { createRandom } from './random.js';
import {
  ACTION_CONFIRM,
  ACTION_ENTER_CAR,
  ACTION_MUSIC,
  ACTION_PAUSE,
  ACTION_PUNCH,
  ACTION_RESTART,
  ACTION_SHOOT,
  createInput,
} from './input.js';
import { createCamera, getView, updateCamera } from './camera.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { loadGame, saveGame } from './save.js';
import { stageShot } from './shots.js';
import { createCity } from './city.js';
import { spawnTrafficCars, updateCars } from './vehicles.js';
import { updateTraffic } from './traffic.js';
import { spawnPeds, updatePeds } from './peds.js';
import { advanceDialogue, initMissions, startMission, updateMissions } from './missions.js';
import { initPolice, updatePolice, updateWanted } from './police.js';
import { initCombat, updateCombat } from './combat.js';
import { initEconomy, updateEconomy } from './economy.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;
const START_CASH = 250;
/** Seconds each line of mission dialogue stays on screen before the next pops up. */
const DIALOGUE_SECONDS = 6;
/** Past this many kept events the log is compacted (see drainEvents). */
const EVENT_COMPACT_AT = 400;

/**
 * A fresh game state for `seed`: the city, the player on a street corner,
 * traffic, pedestrians, the first job, the police and the economy's
 * roadside pickups. This is the one shape every module agrees on (see the
 * shared contract). The player starts broke and unarmed — fists only; the
 * first job hands Rico Vega a pistol.
 */
export function createGameState(seed) {
  const rng = createRandom(seed);
  const city = createCity(rng);
  const spawn = city.spawnPoint;
  const state = {
    seed,
    rng,
    time: 0,
    clockMin: 8 * 60 + 15,
    screen: SCREEN_PLAY,
    city,
    player: {
      x: spawn.x,
      y: spawn.y,
      angle: rng.range(0, Math.PI * 2),
      speed: 0,
      onFoot: true,
      health: PLAYER.maxHealth,
      armor: 0,
      cash: START_CASH,
      weapon: 'fists',
      ammo: 0,
      car: null,
    },
    cars: [],
    peds: [],
    police: [],
    wanted: { stars: 0, heat: 0, hidden: 0 },
    missions: { index: 0, current: null, completed: [] },
    combat: { bullets: [], muzzle: 0 },
    particles: [],
    skidmarks: [],
    pickups: [],
    stats: { missionsDone: 0, carsStolen: 0, fares: 0, distance: 0, wantedMax: 0 },
    flags: { music: true },
    events: [],
    banner: null,
    _dialogueT: 0,
  };
  initMissions(state);
  initPolice(state);
  initEconomy(state);
  initCombat(state);
  spawnTrafficCars(state, TRAFFIC_CARS);
  spawnPeds(state, PED_COUNT);
  startMission(state, 0);
  return state;
}

/**
 * One fixed step, in the order the modules agree on: missions, police,
 * traffic, pedestrians, cars, combat, economy — then updateWanted last.
 * Wanted runs last on purpose: it consumes this tick's crime events
 * (theft, gunshots, peds down), which combat and the carjack only push
 * later in the step; run it first and a whole tick's crimes go unseen.
 * The player on foot moves here; in a car the car moves (updateCars) and
 * the player rides along, glued to it. The clock, particles, skidmarks and
 * the mission-dialogue timer are this file's own.
 *
 * `intent` follows the driving convention: mx steers (-1 left, +1 right)
 * and my is throttle (-1 forward, +1 brake/reverse) while driving; on foot
 * the same pair is the world-space move direction (up is -1). enter fires
 * on its rising edge inside updateCars.
 */
export function stepGame(state, intent, dt) {
  const player = state.player;
  const prevX = player.x;
  const prevY = player.y;

  updateMissions(state, dt);
  updatePolice(state, dt);
  updateTraffic(state, dt);
  updatePeds(state, dt);
  updateCars(state, dt, intent);
  updateCombat(state, dt, intent);
  updateEconomy(state, dt);
  updateWanted(state, dt);

  if (player.onFoot) {
    const len = Math.hypot(intent.mx, intent.my);
    if (len > 0.01) {
      const speed = PLAYER.walkSpeed;
      player.x = Math.max(20, Math.min(WORLD.width - 20, player.x + (intent.mx / len) * speed * dt));
      player.y = Math.max(20, Math.min(WORLD.height - 20, player.y + (intent.my / len) * speed * dt));
      player.speed = speed;
      // Face the cursor once it has moved, else the direction of travel.
      if (intent.aimX !== undefined && intent.aimMoved && Math.hypot(intent.aimX - player.x, intent.aimY - player.y) > 24) {
        player.angle = Math.atan2(intent.aimY - player.y, intent.aimX - player.x);
      } else {
        player.angle = Math.atan2(intent.my, intent.mx);
      }
    } else {
      player.speed = 0;
    }
    state.stats.distance += Math.hypot(player.x - prevX, player.y - prevY);
  }
  if (state.wanted.stars > state.stats.wantedMax) state.stats.wantedMax = state.wanted.stars;

  // Mission dialogue paces itself: a line every few seconds, then silence.
  if (state.missions.current && state.missions.dialogue && state.missions.dialogue.length > 0) {
    state._dialogueT += dt;
    if (state._dialogueT >= DIALOGUE_SECONDS) {
      state._dialogueT = 0;
      advanceDialogue(state);
    }
  }

  // Clock, banner, particles and skidmarks.
  state.time += dt;
  state.clockMin += dt * CLOCK_RATE;
  if (state.banner && state.banner.timer > 0) state.banner.timer -= dt;
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const p = state.particles[i];
    if (p.maxLife === undefined) p.maxLife = Math.max(p.life, 0.01);
    p.life -= dt;
    p.x += (p.vx || 0) * dt;
    p.y += (p.vy || 0) * dt;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
  for (let i = state.skidmarks.length - 1; i >= 0; i -= 1) {
    const m = state.skidmarks[i];
    if (m.maxLife === undefined) m.maxLife = Math.max(m.life, 0.01);
    m.life -= dt;
    if (m.life <= 0) state.skidmarks.splice(i, 1);
  }
}

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const hasSeed = Number.isInteger(seedParam);
const seed = hasSeed ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const renderer = createRenderer(canvas);
const audio = createAudio();
const camera = createCamera();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best haul then lasts this visit only.
  }
}

function applySave(state) {
  const saved = loadGame();
  if (!saved) return false;
  if (typeof saved.cash === 'number') state.player.cash = Math.max(state.player.cash, saved.cash);
  if (Array.isArray(saved.missionsCompleted)) state.missions.completed = saved.missionsCompleted.slice();
  if (typeof saved.missionsDone === 'number') state.stats.missionsDone = saved.missionsDone;
  return true;
}

function runShot(name) {
  const state = createGameState(seed);
  const scene = stageShot(name, state, stepGame);
  let painted = 0;
  function paint() {
    renderer.draw(scene.state, scene.screen, scene.best, camera);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let state = createGameState(seed);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let savedLoaded = false;
  // Index into state.events of the first event this loop has not announced
  // yet. Events are NOT cleared each step: the police and mission modules
  // read them through their own watermarks (_seenEvents) a tick after they
  // are pushed, so wiping the log would make whole crimes go unseen.
  // The log is compacted only once it grows long (compactEvents).
  let announced = 0;

  // Screen readers (and anyone watching the page's text) hear the screen changes and events.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    const freshSeed = hasSeed ? seed : Math.floor(Math.random() * 4294967296);
    state = createGameState(freshSeed);
    savedLoaded = applySave(state);
    announced = 0;
    accumulator = 0;
    screen = SCREEN_PLAY;
    state.screen = SCREEN_PLAY;
    audio.start();
    announce(savedLoaded ? 'Playing. Save loaded.' : 'Playing. Mara Solano has a job for you.');
  }

  function endGame(reason) {
    screen = SCREEN_OVER;
    state.screen = SCREEN_OVER;
    if (state.player.cash > best) {
      best = Math.floor(state.player.cash);
      saveBest(best);
    }
    saveGame(state);
    audio.siren(false);
    audio.setEngine(0);
    announce(`Game over — ${reason}. Cash $${Math.floor(state.player.cash)}. Best haul $${best}.`);
  }

  /** React to one drained event: announce it, play its sound, show its banner. */
  function handleEvent(event) {
    const message = event.message || event.text || '';
    if (message) announce(message);
    if (event.type === 'mission-complete') {
      state.banner = { text: `Job done — +$${event.reward || 0}`, timer: 3 };
      audio.jingle();
      saveGame(state);
    } else if (event.type === 'mission-start') {
      state._dialogueT = 0;
      announce(`New job: ${event.title}.`);
    } else if (event.type === 'mission-failed') {
      announce(`Job failed — ${event.reason || 'failed'}.`);
    } else if (event.type === 'pickup') {
      audio.blip();
    } else if (event.type === 'gunshot') {
      audio.shot();
    } else if (event.type === 'wanted') {
      announce(`Wanted level ${event.stars} — ${event.reason || 'the Solmar PD is on you'}.`);
    } else if (event.type === 'fare-pickup') {
      announce('Passenger aboard — take them to the marker.');
    } else if (event.type === 'fare-complete') {
      audio.blip();
      announce(`Fare complete — +$${event.amount || 0}.`);
    } else if (event.type === 'stunt') {
      audio.blip();
      announce(`Stunt — +$${event.amount || 0}.`);
    } else if (event.type === 'wasted') {
      announce('Wasted — you wake up at the hospital, $200 lighter.');
    } else if (event.type === 'busted') {
      // Arrest ends the run; being wasted only sends Rico to the hospital.
      endGame('busted by the Solmar PD');
    }
  }

  /** Drop the already-read head of the event log once it grows long, and
   * rewind every reader's watermark by the same amount so nobody re-reads
   * (or misses) an event. */
  function compactEvents() {
    const events = state.events;
    if (!events || events.length < EVENT_COMPACT_AT) return;
    const wSeen = (state.wanted && state.wanted._seenEvents) || 0;
    const mSeen = (state.missions && state.missions._seenEvents) || 0;
    const k = Math.min(announced, wSeen, mSeen);
    if (k <= 0) return;
    events.splice(0, k);
    announced -= k;
    if (state.wanted) state.wanted._seenEvents = Math.max(0, wSeen - k);
    if (state.missions) state.missions._seenEvents = Math.max(0, mSeen - k);
  }

  function drainEvents() {
    const events = state.events;
    if (!events) return;
    for (let i = announced; i < events.length; i += 1) {
      handleEvent(events[i]);
      if (screen !== SCREEN_PLAY) break;
    }
    announced = events.length;
    compactEvents();
  }

  function handleActions(actions) {
    if (actions & ACTION_MUSIC) {
      const on = audio.toggleMusic();
      state.flags.music = on;
      announce(on ? 'Radio on.' : 'Radio off.');
    }
    if (screen === SCREEN_TITLE || screen === SCREEN_OVER) {
      if (actions & (ACTION_CONFIRM | ACTION_RESTART)) startGame();
      return;
    }
    if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        state.screen = SCREEN_PLAY;
        announce('Playing.');
      }
      return;
    }
    if (actions & ACTION_PAUSE) {
      screen = SCREEN_PAUSED;
      state.screen = SCREEN_PAUSED;
      audio.siren(false);
      audio.setEngine(0);
      announce('Paused.');
    }
    // ENTER_CAR is not acted on here: it rides in the intent (below) and
    // updateCars fires it on the rising edge, so a held key never toggles
    // enter/exit twice in one frame.
  }

  /** The intent for this frame, built once and reused by every step in it. */
  function buildIntent(actions) {
    const dir = input.direction();
    const aim = input.aim();
    const view = getView(camera, canvas);
    return {
      mx: dir.x,
      my: dir.y,
      enter: !!(actions & ACTION_ENTER_CAR),
      punch: !!(actions & ACTION_PUNCH),
      shoot: input.isShooting() || !!(actions & ACTION_SHOOT),
      aimX: view.x + aim.x / view.scale,
      aimY: view.y + aim.y / view.scale,
      aimMoved: aim.moved,
    };
  }

  function step(actions) {
    if (screen === SCREEN_TITLE) {
      // Attract mode: the city lives, but nothing scores and no job runs.
      updateTraffic(state, STEP);
      updatePeds(state, STEP);
      return;
    }
    const intent = buildIntent(actions);
    stepGame(state, intent, STEP);
    drainEvents();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    // One take of the one-shot presses per frame: handleActions acts on them
    // and the same flags steer every fixed step inside this frame.
    const actions = input.takeActions();
    handleActions(actions);
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step(actions);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    // Live sound follows the chase, not the menus.
    if (screen === SCREEN_PLAY) {
      const driving = !state.player.onFoot && state.player.car !== null;
      const car = driving ? state.player.car : null;
      audio.setEngine(car ? Math.abs(car.speed) / CAR.maxSpeed : 0);
      audio.siren(state.wanted.stars > 0);
    }
    renderer.draw(state, screen, best, camera);
  }

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      state.screen = SCREEN_PAUSED;
      audio.siren(false);
      audio.setEngine(0);
      announce('Paused.');
    }
  });

  announce('Solmar City. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
