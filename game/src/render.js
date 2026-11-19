// Drawing only: the world's state and the current screen in, pixels out. The
// renderer sets the world transform once from the camera view, calls each
// domain's draw function in world coordinates, then resets the transform and
// draws the HUD and any screen panel in screen pixels.

import { FONT, PALETTE, PLAYER } from './config.js';
import { createCamera, getView, updateCamera } from './camera.js';
import { drawHUD } from './hud.js';
import { drawCity } from './city.js';
import { drawPeds } from './peds.js';
import { drawCars } from './vehicles.js';
import { drawPolice } from './police.js';
import { drawCombat } from './combat.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const PANEL = { width: 640, line: 32 };

function drawPickup(ctx, pickup) {
  const { x, y, kind } = pickup;
  ctx.save();
  ctx.translate(x, y);
  if (kind === 'cash') {
    ctx.fillStyle = '#1f7a2e';
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.cash;
    ctx.font = `700 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, 1);
  } else if (kind === 'health') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-9, -9, 18, 18);
    ctx.fillStyle = PALETTE.health;
    ctx.fillRect(-2.5, -7, 5, 14);
    ctx.fillRect(-7, -2.5, 14, 5);
  } else if (kind === 'armor') {
    ctx.fillStyle = PALETTE.armor;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(8, -6);
    ctx.lineTo(8, 2);
    ctx.quadraticCurveTo(8, 8, 0, 11);
    ctx.quadraticCurveTo(-8, 8, -8, 2);
    ctx.lineTo(-8, -6);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'ammo') {
    ctx.fillStyle = '#8a6f4d';
    ctx.fillRect(-8, -4, 16, 8);
    ctx.fillStyle = '#e8c33a';
    ctx.fillRect(6, -3, 4, 6);
  } else if (kind === 'suncoin') {
    // A hidden sun coin: a gold sun with rays.
    ctx.fillStyle = '#ffd94a';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffd94a';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i += 1) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
      ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13);
      ctx.stroke();
    }
    ctx.fillStyle = '#b8860b';
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Any other kind: a purple star.
    ctx.fillStyle = '#c96fd9';
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const r = i % 2 === 0 ? 11 : 5;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawPlayer(ctx, state) {
  const player = state.player;
  if (!player.onFoot) return; // Driving: the car sprite carries the player.
  const { x, y, angle } = player;
  ctx.save();
  ctx.translate(x, y);
  // Soft shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(2, 3, PLAYER.radius, PLAYER.radius * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(angle);
  // Body: shirt circle, head, and a gun barrel when armed.
  ctx.fillStyle = PALETTE.playerShirt;
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.player;
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER.radius * 0.45, 0, Math.PI * 2);
  ctx.fill();
  if (player.weapon !== 'fists') {
    ctx.fillStyle = '#222222';
    ctx.fillRect(PLAYER.radius * 0.5, -2, 12, 4);
  }
  // Facing tick so the direction reads at a glance.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(PLAYER.radius + 4, 0);
  ctx.lineTo(PLAYER.radius - 4, -4);
  ctx.lineTo(PLAYER.radius - 4, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawParticles(ctx, state) {
  for (const p of state.particles) {
    const frac = Math.max(0, p.life / (p.maxLife || 1));
    ctx.globalAlpha = frac;
    ctx.fillStyle = p.color || '#ffffff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, (p.size || 3) * frac + 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSkidmarks(ctx, state) {
  ctx.strokeStyle = 'rgba(20,16,12,0.5)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const mark of state.skidmarks) {
    const frac = Math.max(0, mark.life / (mark.maxLife || 1));
    ctx.globalAlpha = frac * 0.6;
    ctx.beginPath();
    ctx.moveTo(mark.x - Math.cos(mark.angle) * 7, mark.y - Math.sin(mark.angle) * 7);
    ctx.lineTo(mark.x + Math.cos(mark.angle) * 7, mark.y + Math.sin(mark.angle) * 7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const ownCamera = createCamera();
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
  }

  function text(value, x, y, size, color, align = 'center', bold = false) {
    if (!fonts.has(size + (bold ? 'b' : ''))) fonts.set(size + (bold ? 'b' : ''), `${bold ? '700 ' : ''}${size}px ${FONT}`);
    ctx.font = fonts.get(size + (bold ? 'b' : ''));
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  }

  function drawPanel(title, lines, prompt) {
    const W = canvas.clientWidth || canvas.width;
    const H = canvas.clientHeight || canvas.height;
    const height = 150 + lines.length * PANEL.line + 70;
    const x = (W - PANEL.width) / 2;
    const y = (H - height) / 2;
    ctx.fillStyle = PALETTE.panel;
    ctx.fillRect(x, y, PANEL.width, height);
    ctx.strokeStyle = PALETTE.panelBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, PANEL.width - 2, height - 2);
    ctx.textBaseline = 'alphabetic';
    text(title, W / 2, y + 78, 46, PALETTE.text, 'center', true);
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], W / 2, y + 140 + i * PANEL.line, 19, PALETTE.muted);
    }
    text(prompt, W / 2, y + height - 34, 21, PALETTE.banner, 'center', true);
  }

  /** Paint one frame. `cam` is the caller's camera when given, else the renderer's own. */
  function draw(state, screen, best, cam) {
    const camera = cam || ownCamera;
    const ratio = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    // Keep the camera over the player even on screens that never step the loop.
    if (state && state.player) {
      updateCamera(camera, {
        x: state.player.x,
        y: state.player.y,
        speed: state.player.speed || 0,
        driving: !state.player.onFoot,
      }, 1 / 60);
    }
    const view = getView(camera, canvas);

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(0, 0, cssW, cssH);
    // World transform: scale, then shift so the view's top-left lands at 0,0.
    ctx.setTransform(ratio * view.scale, 0, 0, ratio * view.scale, -view.x * view.scale * ratio, -view.y * view.scale * ratio);

    drawCity(ctx, state.city, view);
    drawSkidmarks(ctx, state);
    for (const pickup of state.pickups) drawPickup(ctx, pickup);
    drawPeds(ctx, state);
    drawCars(ctx, state);
    drawPlayer(ctx, state);
    drawPolice(ctx, state);
    drawCombat(ctx, state);
    drawParticles(ctx, state);

    // HUD and screens in screen pixels.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawHUD(ctx, state, view, screen);

    if (screen === SCREEN_TITLE) {
      const lines = [
        'A sun-soaked city. A fresh start. A reputation to build.',
        `Best haul so far: $${Math.floor(best || 0).toLocaleString('en-US')}`,
        '',
        'Mara Solano has a job for you — if you can stay ahead of the Solmar PD.',
      ];
      drawPanel('SOLMAR CITY', lines, 'Press Space to start');
    } else if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The city waits for no one — except right now.'], 'Press P to resume');
    } else if (screen === SCREEN_OVER) {
      const lines = [
        `Cash: $${Math.floor(state.player.cash).toLocaleString('en-US')}`,
        `Jobs finished: ${state.stats.missionsDone}    Cars stolen: ${state.stats.carsStolen}`,
        `Best haul: $${Math.floor(best || 0).toLocaleString('en-US')}`,
      ];
      drawPanel('Busted — or worse', lines, 'Press R or Space to start over');
    }

    // Mission-complete banner, briefly, over live play.
    if (state.banner && state.banner.timer > 0 && screen === SCREEN_PLAY) {
      const W = cssW;
      ctx.fillStyle = PALETTE.panel;
      const bw = 460;
      ctx.fillRect((W - bw) / 2, 110, bw, 52);
      ctx.strokeStyle = PALETTE.banner;
      ctx.lineWidth = 2;
      ctx.strokeRect((W - bw) / 2 + 1, 111, bw - 2, 50);
      text(state.banner.text, W / 2, 144, 22, PALETTE.banner, 'center', true);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
