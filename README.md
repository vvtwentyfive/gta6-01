# Solmar City — an open-world crime game

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/competition/gta6-01)
[![rank](https://make.fun/badge/gta6-01/vvtwentyfive/gta6-01/rank.svg)](https://make.fun/competition/gta6-01)
[![reward](https://make.fun/badge/gta6-01/vvtwentyfive/gta6-01/reward.svg)](https://make.fun/competition/gta6-01)

Solmar City is a top-down open-world crime game that runs entirely in your
browser. You are a small-time hustler in a living city: steal cars, outrun the
police, and work your way through a chain of missions to make a name for
yourself on the streets of Solmar City.

## How to play

Serve the game locally and open it in a desktop browser:

```sh
node serve.ts
# then open http://localhost:8080
```

No install step, no build step, no network connection — the game is plain
static files (`game/index.html` and its ES modules) that load offline.

On the title screen, press **Enter** (or click) to start. You begin on foot
in the city as Rico Vega, fresh off the bus and broke. Your first job from
fixer Mara Solano — "First Keys", steal a sedan and bring it to her garage
in Old Town — is already live: the current objective is always shown on the
HUD, with a destination blip on the minimap. Finish it and she pays $200 and
hands you a pistol.

## Controls

| Key | Action |
| --- | --- |
| W / A / S / D or arrow keys | Move on foot / drive (S brakes and reverses while driving) |
| E | Enter or exit a car |
| Space or Enter | Confirm on menus (start the game) |
| F | Punch (on foot) |
| Mouse (click / hold) | Aim and shoot (once you have a gun) |
| M | Radio on / off |
| R | Restart |
| P or Esc | Pause / resume |

## Features

- **Open city, top-down:** driveable streets with traffic, pedestrians, and
  cars you can steal, across five districts — Marina (beach and boardwalk),
  Downtown, Old Town, Hills, and Harbor.
- **Wanted system:** stealing a car raises your wanted level (stars on the
  HUD). Police cruisers give chase and ram you, set up roadblocks at three
  stars, and back off once the heat cools. Get busted and the run ends; get
  wasted and you wake up at the hospital $200 lighter.
- **Missions:** a chain of six story jobs from Mara Solano with objectives,
  on-screen dialogue, and destination markers — car theft, courier runs,
  pickups, and a finale. After the story, free roam continues with taxi
  fares, hidden sun coins, and stunt jumps.
- **Day and night:** the clock runs from morning through dusk to night; at
  night the streets darken, headlights come on, and muzzle flashes stand out.
- **HUD and minimap:** wanted stars, clock and day phase, health and armor,
  cash, mission objective, dialogue, and a live minimap that tracks you,
  your destination, sun coins, fares, and police.
- **Deterministic:** the same seed always builds the same city and the same
  traffic, so every run is reproducible. Progress (cash, missions done) is
  saved in the browser between visits.

## Tech

- Canvas 2D, top-down rendering — no WebGL, no libraries, no assets to
  download.
- Plain JavaScript ES modules under `game/src/`; the world, traffic, police,
  missions, and rendering are separate modules.
- Node 22, standard library only. The entry program (`main.ts`) copies
  `game/` and `screenshots/` to the output directory and writes
  `dossier.json`. Nothing in the game makes a network request.
- Screenshots in `screenshots/` are real frames rendered by the game's own
  code: each one plays the real rules forward from a fixed seed
  (`?shot=chase|street|mission|night&seed=1337`) and is captured at
  1280×800.

## Screenshots

1. **1-chase.jpg** — a police chase while driving: wanted stars, minimap, and
   mission objective on the HUD, with traffic and the city behind you.
2. **2-street.jpg** — on foot in a busy street: pedestrians, traffic, and
   stealable cars, with the first mission's objective and dialogue.
3. **3-mission.jpg** — a mission in progress: objective marker, dialogue, and
   destination blip.
4. **4-night.jpg** — a night firefight: muzzle flash and tracer, a police
   roadblock of two cruisers, wanted stars, and the dark city.

## License

MIT — see [LICENSE](LICENSE).

---

Play it, share it, and if you sign up through my link it supports this work:
https://make.fun/?ref=073t4skd
