// Every tuning number and colour in one place. Solmar City is a fixed 3200x3200
// world of pixels; the camera shows a slice of it scaled to the window, so no
// rule below depends on the screen size.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** The whole city, in world pixels. */
export const WORLD = { width: 3200, height: 3200 };

/** The logical viewport the camera frames at zoom 1 (a 16:9 slice of the city). */
export const VIEWPORT = { width: 1280, height: 720 };

export const PLAYER = {
  radius: 13,
  walkSpeed: 170,
  runSpeed: 250,
  maxHealth: 100,
  maxArmor: 100,
  punchDamage: 25,
  punchRange: 34,
  punchCooldown: 0.35,
};

export const CAR = {
  accel: 420,
  brake: 620,
  reverseAccel: 220,
  maxSpeed: 520,
  policeMaxSpeed: 560,
  turnRate: 2.6,
  drag: 0.6,
};

export const WEAPONS = {
  // Mirrors combat.js's table (the one that deals damage); this copy is only
  // for the HUD's weapon name display, so the two must agree on names.
  fists: { name: 'Fists', damage: 25, rate: 0.35, range: 34, auto: false },
  pistol: { name: 'Pistol', damage: 34, rate: 0.25, range: 520, auto: false, bulletSpeed: 720 },
  smg: { name: 'SMG', damage: 20, rate: 0.09, range: 460, auto: true, bulletSpeed: 800 },
};

export const WANTED = {
  maxStars: 5,
  decayPerSecond: 0.02,
  heatPerCrime: 0.35,
  starsForHeat: [0.4, 1.0, 1.8, 2.8, 4.0],
};

/** Game minutes that pass per real second of play. */
export const CLOCK_RATE = 2;

/** How many traffic cars and pedestrians a fresh city starts with. */
export const TRAFFIC_CARS = 14;
export const PED_COUNT = 26;
export const PICKUP_COUNT = 10;

export const PALETTE = {
  backdrop: '#14100c',
  asphalt: '#3d3833',
  asphaltDark: '#322d29',
  roadLine: '#e8d98a',
  sidewalk: '#b8a88f',
  sand: '#e3c98f',
  grass: '#7da05c',
  water: '#2e8fa3',
  waterDeep: '#1f6f84',
  roofTerracotta: '#c96f4a',
  roofSand: '#d9a05b',
  roofTeal: '#3f8f8a',
  building: '#e8dcc8',
  buildingShadow: '#c9b89a',
  player: '#ffcf3f',
  playerShirt: '#2e86ff',
  police: '#1c4fd6',
  policeLight: '#ff3b30',
  text: '#f5efe4',
  muted: '#b8ab93',
  panel: 'rgba(20, 16, 12, 0.88)',
  panelBorder: '#e8d98a',
  cash: '#7ddc6a',
  health: '#ff5a5a',
  armor: '#5aa8ff',
  star: '#ffd23f',
  minimapBg: 'rgba(20, 16, 12, 0.82)',
  banner: '#ffd23f',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** District names, matching the districts the city generator lays out. */
export const DISTRICTS = [
  'Marina',
  'Hills',
  'Downtown',
  'Old Town',
  'Harbor',
];

/** Paint jobs traffic cars wear. */
export const CAR_COLORS = [
  '#d94f3d',
  '#3d7dd9',
  '#e8c33a',
  '#7ddc6a',
  '#f2f2f2',
  '#2b2b2b',
  '#c96fd9',
  '#e88a2e',
  '#3fb8a6',
  '#8a6f4d',
];

/** Where the best cash haul is kept between visits (this browser only). */
export const BEST_KEY = 'solmar-city.best';
/** Where a saved game is kept between visits (this browser only). */
export const SAVE_KEY = 'solmar-city.save';
