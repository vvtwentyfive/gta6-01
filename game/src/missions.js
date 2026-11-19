// missions.js — Story mission chain for Solmar City (W3).
//
// Original story only: the player is Rico Vega, a getaway driver new to
// Solmar City, working for Mara Solano, a fixer who runs the "Solmar Nights"
// garage. No Rockstar / GTA names, places, or characters appear anywhere.
//
// Contract (W1 calls these):
//   MISSIONS            — 6 mission templates (see below for step shapes)
//   initMissions(state) — sets state.missions {index, current, completed, ...}
//   startMission(state, i)
//   updateMissions(state, dt)
//   advanceDialogue(state) — pops and returns the current dialogue line
//   failMission(state, reason), retryMission(state) — failure + retry
//
// Step shapes (templates; startMission resolves them into concrete steps):
//   target: 'any-car'            — any drivable car
//           {kind:'sedan'}       — a car of that kind
//           {place:'garage'}     — a named city location (resolved at start)
//           {carId:'rival-sports'} — a specific spawned car (resolved live)
//           {x, y}               — a fixed point (snapped to the nearest road)
//   check:  'in-car' | 'in-car-kind' | 'reach' | 'deliver' (reach while in a
//           car) | 'dwell' (stay within radius for dwell seconds) |
//           'lost-heat' (wanted stars back to 0)
//   radius: metres in px around the target. timeLimit: whole-mission seconds.
//
// Mission targets are computed from state.city at init (districts /
// landmarks, snapped to roads with nearestRoadPoint). Nothing here uses
// hard-coded magic coordinates that could land inside a building.
//
// Deterministic: the only randomness source is state.rng. No Date.now(),
// no Math.random() anywhere in game logic.

import { addWanted } from './police.js';
import {
  nearestRoadPoint as cityNearestRoadPoint,
  isRoad as cityIsRoad,
} from './city.js';

// ---------------------------------------------------------------------------
// Small deterministic helpers (local copies so this module never depends on
// a file another worker has not landed yet).
// ---------------------------------------------------------------------------

function rngFn(state) {
  if (typeof state.rng === 'function') return state.rng;
  if (state.rng && typeof state.rng.next === 'function') return () => state.rng.next();
  // Last-resort deterministic fallback: LCG seeded from state.seed.
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

// Nearest point on a road. Prefers a nearestRoadPoint method on the city
// object when one is provided, then W2's city.js helper, then a derivation
// from city.roads.h / city.roads.v (each entry a number or an object with
// .y / .x) — so this module keeps working on any city shape.
// The result is guaranteed to lie on a road: a nearest-road snap can keep
// an off-grid coordinate (e.g. south of the grid, in the harbor docks),
// so a non-road result falls back to the nearest intersection.
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

function districtCenter(city, fragment) {
  if (!city || !Array.isArray(city.districts)) return null;
  const want = String(fragment).toLowerCase();
  for (const d of city.districts) {
    const name = String(d.name || '').toLowerCase();
    if (!name.includes(want)) continue;
    if (typeof d.cx === 'number' && typeof d.cy === 'number') return { x: d.cx, y: d.cy };
    if (d.center && typeof d.center.x === 'number') return { x: d.center.x, y: d.center.y };
    if (typeof d.x === 'number' && typeof d.w === 'number') return { x: d.x + d.w / 2, y: d.y + d.h / 2 };
    if (d.bounds && typeof d.bounds.x === 'number') return { x: d.bounds.x + d.bounds.w / 2, y: d.bounds.y + d.bounds.h / 2 };
  }
  return null;
}

function landmarkPoint(city, kindOrName, opts) {
  if (!city || !Array.isArray(city.landmarks)) return null;
  const want = String(kindOrName).toLowerCase();
  const nameMatch = !opts || opts.nameMatch !== false;
  // Exact kind match first (a 'pier' is not a marina, even if its name
  // mentions one).
  for (const lm of city.landmarks) {
    if (String(lm.kind || '').toLowerCase() === want) return { x: lm.x, y: lm.y };
  }
  if (!nameMatch) return null;
  for (const lm of city.landmarks) {
    const name = String(lm.name || '').toLowerCase();
    if (name.includes(want)) return { x: lm.x, y: lm.y };
  }
  return null;
}

function citySize(city) {
  return city && typeof city.size === 'number' ? city.size : 2000;
}

// Resolve every named location from the live city. Called by initMissions
// and stored on state.missions.locations so startMission / retry / busted
// respawns all agree on the same spots.
export function resolveLocations(state) {
  const city = state.city || null;
  const size = citySize(city);
  const snap = (p) => roadPoint(city, p.x, p.y);
  const pick = (landmark, district, fallback) =>
    snap(landmarkPoint(city, landmark) || districtCenter(city, district) || fallback);

  const garage = pick('garage', 'old town', { x: size * 0.2, y: size * 0.2 });
  // Marina: never the pier landmark (it sits in the water) — the Marina
  // district centre, snapped to a road, is the safehouse.
  const marina = snap(landmarkPoint(city, 'marina', { nameMatch: false }) || districtCenter(city, 'marina') || { x: 120, y: size * 0.5 });
  const harbor = pick('harbor', 'harbor', { x: size * 0.5, y: size - 120 });
  const hospital = pick('hospital', 'uptown', { x: size * 0.75, y: size * 0.25 });
  const courierPickup = pick('courier', 'midtown', { x: size * 0.55, y: size * 0.3 });
  const courierDropoff = pick('dropoff', 'uptown', { x: size * 0.8, y: size * 0.2 });
  const crew = snap({
    x: garage.x + 180,
    y: garage.y + 120,
  });
  // Rival car: its own Downtown spot, not the vault's (both resolve from
  // the Downtown centre otherwise).
  const rival = snap(landmarkPoint(city, 'rival') || { x: size * 0.45, y: size * 0.45 });
  const vault = pick('vault', 'downtown', { x: size * 0.5, y: size * 0.5 });
  return { garage, marina, harbor, hospital, courierPickup, courierDropoff, crew, rival, vault, safehouse: marina };
}

// ---------------------------------------------------------------------------
// Mission templates
// ---------------------------------------------------------------------------

export const MISSIONS = [
  {
    id: 'first-keys',
    title: 'First Keys',
    giver: 'Mara Solano',
    briefing: [
      "Rico Vega, fresh off the bus and already broke. Good — hungry drivers drive fast.",
      'Rico: So what is the job?',
      'Borrow a sedan. Any sedan. Bring it to my garage in Old Town and do not scratch the paint.',
      'Rico: Borrow. Right.',
    ],
    completion: 'Clean work. The sedan is yours to keep for now — and take this pistol. Solmar rewards drivers who deliver.',
    reward: 200,
    steps: [
      {
        text: 'Steal a sedan (get in any sedan)',
        target: { kind: 'sedan' },
        radius: 0,
        check: 'in-car-kind',
        doneLine: 'Mara Solano: Good, you found one. Now bring it to the garage.',
      },
      {
        text: 'Drive the sedan to Mara\'s garage',
        target: { place: 'garage' },
        radius: 70,
        check: 'deliver',
      },
    ],
  },
  {
    id: 'courier-run',
    title: 'Courier Run',
    giver: 'Mara Solano',
    briefing: [
      'A package needs to cross town before the buyer loses patience. Ninety seconds. No sightseeing.',
      'Rico: Ninety seconds across town? That is not a delivery, that is a race.',
      'Then drive like it is one. Pick it up in Midtown, drop it in Uptown.',
    ],
    completion: 'On time, package intact. The buyer paid extra for the speed. Keep it.',
    reward: 350,
    timeLimit: 90,
    steps: [
      {
        text: 'Pick up the package in Midtown',
        target: { place: 'courierPickup' },
        radius: 60,
        check: 'reach',
        doneLine: 'Mara Solano: Package is in your hands. Uptown, now — the clock is running.',
      },
      {
        text: 'Deliver the package in Uptown before the timer ends',
        target: { place: 'courierDropoff' },
        radius: 60,
        check: 'reach',
      },
    ],
  },
  {
    id: 'the-pickup',
    title: 'The Pickup',
    giver: 'Mara Solano',
    briefing: [
      'Our wheelman, Dario, is waiting in an Old Town alley and the patrols are sniffing around.',
      'Rico: So I collect him while the law watches?',
      'Collect him, keep it quiet, and bring him back to the garage. One star of trouble is already on its way — do not make it two.',
    ],
    completion: 'Dario is in. He says you drive like his grandmother — and he means it as a compliment.',
    reward: 400,
    steps: [
      {
        text: 'Collect Dario in the Old Town alley',
        target: { place: 'crew' },
        radius: 60,
        check: 'reach',
        onComplete: 'wanted-1',
        doneLine: 'Dario: Patrol car just turned the corner! Drive, Rico, drive!',
      },
      {
        text: 'Bring Dario back to Mara\'s garage',
        target: { place: 'garage' },
        radius: 70,
        check: 'deliver',
      },
    ],
  },
  {
    id: 'harbor-lights',
    title: 'Harbor Lights',
    giver: 'Mara Solano',
    briefing: [
      'A truckload of cargo is sitting unguarded at the harbor. It will not stay unguarded.',
      'Rico: And the harbor patrol?',
      'Will notice. Steal the truck, lose the pursuit, and bring it home. Two stars, minimum — drive like you mean it.',
    ],
    completion: 'The harbor never saw you leave. The cargo is already sold. Beautiful.',
    reward: 600,
    steps: [
      {
        text: 'Steal a truck from the harbor',
        target: { kind: 'truck' },
        radius: 0,
        check: 'in-car-kind',
        onComplete: 'wanted-2',
        doneLine: 'Mara Solano: Harbor patrol is on you! Lose them before you come home.',
      },
      {
        text: 'Lose the 2-star pursuit (stay out of sight until the heat dies)',
        target: { place: 'garage' },
        radius: 0,
        check: 'lost-heat',
      },
      {
        text: 'Bring the truck to Mara\'s garage',
        target: { place: 'garage' },
        radius: 70,
        check: 'deliver',
      },
    ],
  },
  {
    id: 'the-setup',
    title: 'The Setup',
    giver: 'Mara Solano',
    briefing: [
      'A rival crew parks their flashy sports car in Downtown every night. I want a tracker on it — and proof.',
      'Rico: Proof? You want a photo of me planting a tracker?',
      'Get close to the car and stay close for five seconds. The tracker does the rest. Do not get spotted admiring it.',
    ],
    completion: 'Tracker is live and the photo is perfect. We will know everywhere that car goes. You are getting good at this, Rico.',
    reward: 750,
    steps: [
      {
        text: 'Find the rival sports car in Downtown',
        target: { carId: 'rival-sports' },
        radius: 110,
        check: 'reach',
        doneLine: 'Mara Solano: There it is. Stay close — five seconds, no more.',
      },
      {
        text: 'Stay near the sports car for 5 seconds to plant the tracker',
        target: { carId: 'rival-sports' },
        radius: 90,
        check: 'dwell',
        dwell: 5,
      },
    ],
  },
  {
    id: 'solmar-sunset',
    title: 'Solmar Sunset',
    giver: 'Mara Solano',
    briefing: [
      'This is the big one, Rico. The vault cash, one clean grab, and a sunset run to the marina safehouse.',
      'Rico: Three stars of trouble, Mara. You did not mention three stars.',
      'I am mentioning them now. Grab the cash, outrun the whole city, and meet me where the boats sleep. After this, you are not the new driver anymore. You are family.',
    ],
    completion: 'You did it, Rico Vega. Sunset, sirens behind you, cash in the trunk. Welcome to Solmar City — it is yours now.',
    reward: 1500,
    steps: [
      {
        text: 'Grab the cash at the Downtown vault',
        target: { place: 'vault' },
        radius: 60,
        check: 'reach',
        onComplete: 'wanted-3',
        doneLine: 'Mara Solano: Alarm is up! Every cruiser in the city is coming. Marina — GO!',
      },
      {
        text: 'Escape the 3-star pursuit — reach the marina safehouse',
        target: { place: 'marina' },
        radius: 80,
        check: 'reach',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// State setup
// ---------------------------------------------------------------------------

export function initMissions(state) {
  state.missions = {
    index: 0,
    current: null,
    completed: [],
    dialogue: [],
    freeRoam: false,
    nextDelay: 0,
    retry: null,
    locations: resolveLocations(state),
    _seenEvents: 0,
  };
  return state.missions;
}

function ensureMissions(state) {
  if (!state.missions || !state.missions.locations) initMissions(state);
  return state.missions;
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

function resolveStepTarget(state, step) {
  const m = state.missions;
  const t = step.target;
  if (t === 'any-car') return 'any-car';
  if (!t || typeof t !== 'object') return null;
  if (typeof t.x === 'number' && typeof t.y === 'number') {
    return roadPoint(state.city, t.x, t.y);
  }
  if (t.kind) return { kind: t.kind };
  if (t.carId) return { carId: t.carId };
  if (t.place && m.locations[t.place]) {
    const p = m.locations[t.place];
    return { x: p.x, y: p.y };
  }
  return null;
}

// Where a step's target is right now (static points stay put; a carId
// target follows its car).
function stepTargetPos(state, step) {
  const t = step._target;
  if (!t || typeof t !== 'object') return null;
  if (typeof t.x === 'number') return t;
  if (t.carId && Array.isArray(state.cars)) {
    const car = state.cars.find((c) => c.id === t.carId);
    if (car) return { x: car.x, y: car.y };
  }
  return null;
}

function spawnRivalCar(state) {
  if (!Array.isArray(state.cars)) state.cars = [];
  if (state.cars.some((c) => c.id === 'rival-sports')) return;
  const loc = state.missions.locations.rival;
  const rng = rngFn(state);
  state.cars.push({
    id: 'rival-sports',
    x: loc.x,
    y: loc.y,
    angle: rng() * Math.PI * 2,
    speed: 0,
    maxSpeed: 420,
    color: '#c0392b',
    kind: 'sports',
    driver: null,
    health: 100,
  });
}

export function startMission(state, i) {
  const m = ensureMissions(state);
  if (i < 0 || i >= MISSIONS.length) return null;
  const tpl = MISSIONS[i];
  const steps = tpl.steps.map((s) => {
    const step = { ...s, _target: null, _dwellLeft: typeof s.dwell === 'number' ? s.dwell : 0, _elapsed: 0 };
    step._target = resolveStepTarget(state, s);
    return step;
  });
  const firstPos = stepTargetPos(state, steps[0]);
  const dialogue = tpl.briefing.map((line) => {
    if (line.startsWith('Rico:')) return { speaker: 'Rico Vega', text: line.slice(5).trim() };
    return { speaker: tpl.giver, text: line };
  });
  m.index = i;
  m.retry = null;
  m.nextDelay = 0;
  m.current = {
    id: tpl.id,
    title: tpl.title,
    giver: tpl.giver,
    objective: steps[0].text,
    blip: firstPos ? { x: firstPos.x, y: firstPos.y } : null,
    dialogue,
    stage: 0,
    reward: tpl.reward,
    steps,
    timeLeft: typeof tpl.timeLimit === 'number' ? tpl.timeLimit : null,
    timeLimit: typeof tpl.timeLimit === 'number' ? tpl.timeLimit : null,
  };
  m.dialogue = dialogue;
  if (tpl.id === 'the-setup') spawnRivalCar(state);
  state.events = state.events || [];
  state.events.push({ type: 'mission-start', id: tpl.id, title: tpl.title });
  return m.current;
}

// Pops the current dialogue line (HUD shows dialogue[0]). Returns the
// popped line or null when the queue is empty.
export function advanceDialogue(state) {
  const m = state.missions;
  if (!m || !Array.isArray(m.dialogue) || m.dialogue.length === 0) return null;
  const line = m.dialogue.shift();
  if (m.current) m.current.dialogue = m.dialogue;
  return line;
}

function setDialogue(state, lines) {
  const m = state.missions;
  m.dialogue = lines.slice();
  if (m.current) m.current.dialogue = m.dialogue;
}

function applyOnComplete(state, step) {
  if (!step || !step.onComplete) return;
  // Scripted mission heat is an exact level ("a 2-star pursuit"), not a
  // stack on top of whatever heat the player was already carrying.
  const setWanted = (n, reason) => {
    if (state.wanted) {
      state.wanted.stars = 0;
      state.wanted.heat = 0;
      state.wanted.hidden = 0;
    }
    addWanted(state, n, reason);
  };
  if (step.onComplete === 'wanted-1') setWanted(1, 'Pickup spotted by patrol');
  else if (step.onComplete === 'wanted-2') setWanted(2, 'Harbor theft reported');
  else if (step.onComplete === 'wanted-3') setWanted(3, 'Vault alarm tripped');
}

export function failMission(state, reason) {
  const m = state.missions;
  if (!m || !m.current) return;
  const failed = m.current;
  const failedIndex = m.index;
  state.events = state.events || [];
  state.events.push({ type: 'mission-failed', id: failed.id, title: failed.title, reason: reason || 'failed' });
  m.current = null;
  m.index = failedIndex;
  m.retry = failedIndex;
  m.nextDelay = 0;
  setDialogue(state, [
    { speaker: 'Mara Solano', text: `That went sideways, Rico. (${reason || 'failed'}) The job is still open — come back to the garage and we run it again. Cash you already earned stays yours.` },
  ]);
}

// Retry the failed mission: reset the player to the garage, clear the heat
// and the pursuit, keep the cash, and start the mission again.
export function retryMission(state) {
  const m = ensureMissions(state);
  if (m.retry === null || m.retry === undefined) return null;
  const idx = m.retry;
  const loc = m.locations.garage;
  const p = state.player;
  if (p) {
    p.x = loc.x;
    p.y = loc.y;
    p.onFoot = true;
    p.car = null;
    p.health = 100;
    p.angle = 0;
    p.speed = 0;
  }
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
  return startMission(state, idx);
}

function completeMission(state) {
  const m = state.missions;
  const cur = m.current;
  const tpl = MISSIONS[m.index];
  const p = state.player;
  if (p) p.cash = (p.cash || 0) + cur.reward;
  if (state.stats) state.stats.missionsDone = (state.stats.missionsDone || 0) + 1;
  state.events = state.events || [];
  state.events.push({ type: 'mission-complete', id: cur.id, title: cur.title, reward: cur.reward });
  // Mission 1 reward: Mara hands Rico a pistol.
  if (cur.id === 'first-keys' && p) {
    p.weapon = 'pistol';
    p.ammo = (p.ammo || 0) + 24;
  }
  m.completed.push(cur.id);
  m.current = null;
  const nextIndex = m.index + 1;
  m.index = nextIndex;
  if (nextIndex >= MISSIONS.length) {
    m.freeRoam = true;
    m.nextDelay = 0;
    setDialogue(state, [
      { speaker: 'Mara Solano', text: tpl.completion },
      { speaker: 'Mara Solano', text: 'That is the whole story, Rico — Solmar City is yours now. Free roam: taxi fares, sun coins, stunt jumps, and whatever trouble you find.' },
    ]);
  } else {
    m.nextDelay = 4;
    setDialogue(state, [
      { speaker: 'Mara Solano', text: tpl.completion },
      { speaker: 'Mara Solano', text: `Next job is coming up. Give me a moment — or drive to the garage when you are ready.` },
    ]);
  }
}

function advanceStep(state) {
  const m = state.missions;
  const cur = m.current;
  const step = cur.steps[cur.stage];
  applyOnComplete(state, step);
  if (step.doneLine) {
    setDialogue(state, [{ speaker: cur.giver, text: step.doneLine }]);
  }
  cur.stage += 1;
  if (cur.stage >= cur.steps.length) {
    completeMission(state);
    return;
  }
  const next = cur.steps[cur.stage];
  cur.objective = next.text;
  const pos = stepTargetPos(state, next);
  cur.blip = pos ? { x: pos.x, y: pos.y } : null;
}

function stepSatisfied(state, step, dt) {
  const p = state.player;
  const car = getPlayerCar(state);
  const inCar = !!p && !p.onFoot && !!car;
  step._elapsed += dt;
  switch (step.check) {
    case 'in-car':
      return inCar;
    case 'in-car-kind': {
      if (!inCar) return false;
      const kind = step._target && step._target.kind;
      return !kind || car.kind === kind;
    }
    case 'reach': {
      const pos = stepTargetPos(state, step);
      if (!pos || !p) return false;
      return dist(p.x, p.y, pos.x, pos.y) < (step.radius || 60);
    }
    case 'deliver': {
      if (!inCar) return false;
      const pos = stepTargetPos(state, step);
      if (!pos || !p) return false;
      return dist(p.x, p.y, pos.x, pos.y) < (step.radius || 60);
    }
    case 'dwell': {
      const pos = stepTargetPos(state, step);
      if (!pos || !p) return false;
      if (dist(p.x, p.y, pos.x, pos.y) < (step.radius || 90)) {
        step._dwellLeft -= dt;
        return step._dwellLeft <= 0;
      }
      step._dwellLeft = typeof step.dwell === 'number' ? step.dwell : 5;
      return false;
    }
    case 'lost-heat': {
      const stars = state.wanted ? state.wanted.stars : 0;
      return stars === 0 && step._elapsed > 2;
    }
    default:
      return false;
  }
}

export function updateMissions(state, dt) {
  const m = ensureMissions(state);
  if (!m) return;
  // Auto-start the next mission a short beat after the previous one ends.
  if (!m.current) {
    if (m.nextDelay > 0) {
      m.nextDelay -= dt;
      if (m.nextDelay <= 0 && m.index < MISSIONS.length && m.retry === null) {
        startMission(state, m.index);
      }
    }
    return;
  }
  const cur = m.current;
  // Failure: mission timer ran out.
  if (cur.timeLeft !== null && cur.timeLeft !== undefined) {
    cur.timeLeft -= dt;
    if (cur.timeLeft <= 0) {
      failMission(state, 'time ran out');
      return;
    }
  }
  // Failure: busted / wasted / player's car destroyed (fresh events only).
  const events = state.events || [];
  let seen = m._seenEvents || 0;
  if (events.length < seen) seen = 0;
  for (let i = seen; i < events.length; i += 1) {
    const ev = events[i];
    if (ev.type === 'wasted') { m._seenEvents = events.length; failMission(state, 'wasted'); return; }
    if (ev.type === 'busted') { m._seenEvents = events.length; failMission(state, 'busted by the police'); return; }
    if (ev.type === 'car-destroyed') {
      const car = getPlayerCar(state);
      if (car && ev.carId === car.id) { m._seenEvents = events.length; failMission(state, 'car destroyed'); return; }
    }
  }
  m._seenEvents = events.length;
  // Failure: the car the mission needs was destroyed.
  const car = getPlayerCar(state);
  if (car && typeof car.health === 'number' && car.health <= 0) {
    failMission(state, 'car destroyed');
    return;
  }
  // Advance the current step when its check passes.
  const step = cur.steps[cur.stage];
  if (step && stepSatisfied(state, step, dt)) {
    advanceStep(state);
  }
}
