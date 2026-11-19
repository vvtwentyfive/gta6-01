// A small seeded random number generator (mulberry32): the same seed gives the
// same city, the same traffic and the same screenshot scenes, which is what
// makes the game repeatable. Nothing in game logic reads Math.random when a
// seed is in play; the only unseeded draw is the fallback seed itself, picked
// once in main.js when the URL carries no ?seed=.
//
// The generator is a callable function — the city, traffic and pedestrian
// modules call it as rng() — with the helpers attached as methods, so both
// spellings work: rng(), rng.next(), rng.range(a, b), rng.int(a, b),
// rng.pick(arr).

export function createRandom(seed) {
  let a = (seed | 0) >>> 0;
  function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** The next uniform draw in [0, 1). */
  random.next = function next() {
    return random();
  };
  /** A uniform draw in [lo, hi). */
  random.range = function range(lo, hi) {
    return lo + random() * (hi - lo);
  };
  /** A whole number in [lo, hi] inclusive. */
  random.int = function int(lo, hi) {
    return lo + Math.floor(random() * (hi - lo + 1));
  };
  /** One element of `arr`, uniformly. */
  random.pick = function pick(arr) {
    return arr[Math.floor(random() * arr.length)];
  };
  return random;
}
