// The camera: a smooth follow that hangs over the player and pulls back (zooms
// out) as the player drives faster, so speed reads on screen. World
// coordinates are pixels; the city is about 3200x3200. getView returns the
// world rectangle currently visible plus the scale that maps it to the canvas.

import { VIEWPORT } from './config.js';

const FOLLOW_RATE = 5;
const ZOOM_RATE = 2.5;
const FOOT_ZOOM = 1.0;
const DRIVE_ZOOM = 0.62;

export function createCamera() {
  return { x: 0, y: 0, zoom: FOOT_ZOOM, targetZoom: FOOT_ZOOM, ready: false };
}

/**
 * Ease the camera toward `target` ({x, y, speed, driving}). `dt` is seconds.
 * The first call snaps straight onto the target so a fresh game never pans
 * in from the corner of the map.
 */
export function updateCamera(cam, target, dt) {
  const driving = !!target.driving;
  const speed = target.speed || 0;
  // Zoom out in proportion to speed while driving, back in on foot.
  cam.targetZoom = driving ? DRIVE_ZOOM + (FOOT_ZOOM - DRIVE_ZOOM) * Math.max(0, 1 - speed / 520) : FOOT_ZOOM;
  if (!cam.ready) {
    cam.x = target.x;
    cam.y = target.y;
    cam.zoom = cam.targetZoom;
    cam.ready = true;
    return;
  }
  const follow = 1 - Math.exp(-FOLLOW_RATE * dt);
  cam.x += (target.x - cam.x) * follow;
  cam.y += (target.y - cam.y) * follow;
  const zoomStep = 1 - Math.exp(-ZOOM_RATE * dt);
  cam.zoom += (cam.targetZoom - cam.zoom) * zoomStep;
}

/** The world rectangle the camera shows on `canvas`, and its scale. */
export function getView(cam, canvas) {
  const cssW = canvas.clientWidth || canvas.width || VIEWPORT.width;
  const cssH = canvas.clientHeight || canvas.height || VIEWPORT.height;
  const base = Math.min(cssW / VIEWPORT.width, cssH / VIEWPORT.height);
  const scale = Math.max(0.05, base * cam.zoom);
  const w = cssW / scale;
  const h = cssH / scale;
  return { x: cam.x - w / 2, y: cam.y - h / 2, w, h, scale };
}
