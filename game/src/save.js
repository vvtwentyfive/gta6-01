// Saving to localStorage, wrapped so a blocked store (private windows, full
// quota) never breaks the game: every call is safe to make and either works
// or quietly does nothing. Only plain numbers, strings and small arrays are
// stored — never functions, never the live state object.

import { SAVE_KEY } from './config.js';

export function saveGame(state) {
  try {
    const data = {
      version: 1,
      cash: state.player.cash,
      missionsDone: state.stats.missionsDone,
      missionsCompleted: state.missions.completed.slice(),
      stats: {
        missionsDone: state.stats.missionsDone,
        carsStolen: state.stats.carsStolen,
        fares: state.stats.fares,
        distance: Math.round(state.stats.distance),
        wantedMax: state.stats.wantedMax,
      },
      collectibles: state.economy ? state.economy.collectiblesFound : 0,
      clockMin: Math.round(state.clockMin),
      savedAt: state.time,
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadGame() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
