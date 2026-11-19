// The heads-up display, drawn in screen pixels after the world transform is
// reset: health and armor bars, cash, wanted stars, the clock, the mission
// objective, the dialogue box, the minimap and the driving speed. The title
// screen gets a controls hint instead of the in-game bars.

import { PALETTE, FONT, WEAPONS } from './config.js';
import { drawMinimapBase } from './city.js';

const MINIMAP = 180;
const BAR_W = 190;
const BAR_H = 12;

function phaseOf(hour) {
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Day';
  if (hour >= 17 && hour < 21) return 'Evening';
  return 'Night';
}

function fmtClock(clockMin) {
  const total = ((Math.floor(clockMin) % 1440) + 1440) % 1440;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(hh)}:${pad(mm)}`;
}

function fmtCash(cash) {
  return `$${Math.floor(cash).toLocaleString('en-US')}`;
}

export function drawHUD(ctx, state, view, screen) {
  const W = ctx.canvas.clientWidth || ctx.canvas.width;
  const H = ctx.canvas.clientHeight || ctx.canvas.height;
  const player = state.player;
  ctx.textBaseline = 'alphabetic';

  function text(value, x, y, size, color, align = 'left', bold = false) {
    ctx.font = `${bold ? '700 ' : ''}${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  }

  function bar(x, y, w, h, frac, color, bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }

  if (screen === 'title') {
    text('WASD / Arrows — move & drive      E — enter / exit car', W / 2, H - 96, 16, PALETTE.text, 'center');
    text('Mouse — aim & shoot      F — punch      P — pause      M — radio      R — restart', W / 2, H - 68, 16, PALETTE.text, 'center');
    text('Steal a car. Outrun the law. Finish the jobs. Own Solmar City.', W / 2, H - 38, 16, PALETTE.muted, 'center');
    return;
  }
  if (screen === 'over') return;

  // Health + armor, bottom-left.
  bar(16, H - 52, BAR_W, BAR_H, player.health / 100, PALETTE.health, 'rgba(0,0,0,0.55)');
  text('HP', 16, H - 58, 12, PALETTE.text, 'left', true);
  bar(16, H - 30, BAR_W, BAR_H, player.armor / 100, PALETTE.armor, 'rgba(0,0,0,0.55)');
  text('ARMOR', 16, H - 36, 12, PALETTE.text, 'left', true);

  // Cash, top-left, with the weapon beside it.
  text(fmtCash(player.cash), 16, 34, 26, PALETTE.cash, 'left', true);
  const weapon = WEAPONS[player.weapon] || WEAPONS.fists;
  const ammoText = player.weapon === 'fists' ? 'Fists' : `${weapon.name}  ${player.ammo === Infinity ? '∞' : player.ammo}`;
  text(ammoText, 16, 60, 15, PALETTE.text);

  // Wanted stars, top-centre. They flash while heat is still climbing.
  const stars = state.wanted.stars;
  const flashing = state.wanted.heat > 0 && state.time % 0.5 < 0.25;
  for (let i = 0; i < 5; i += 1) {
    const lit = i < stars;
    const color = lit ? (flashing ? '#ffffff' : PALETTE.star) : 'rgba(255,255,255,0.25)';
    text('★', W / 2 - 62 + i * 26, 36, 26, color, 'left', true);
  }

  // Clock + day phase, top-centre under the stars.
  const hour = Math.floor(((state.clockMin % 1440) + 1440) % 1440 / 60);
  text(`${fmtClock(state.clockMin)}  ${phaseOf(hour)}`, W / 2, 62, 15, PALETTE.text, 'center');

  // Mission objective, under the clock.
  const mission = state.missions.current;
  if (mission) {
    text(`◆ ${mission.title}: ${mission.objective}`, W / 2, 88, 15, PALETTE.banner, 'center', true);
  }

  // Dialogue box, bottom-centre, while a mission line is showing. The
  // mission module owns the queue; main.js paces it line by line.
  const dialogue = mission && mission.dialogue && mission.dialogue.length > 0 ? mission.dialogue[0] : null;
  if (dialogue) {
    const boxW = Math.min(640, W - 40);
    const boxX = (W - boxW) / 2;
    const boxY = H - 148;
    ctx.fillStyle = PALETTE.panel;
    ctx.fillRect(boxX, boxY, boxW, 64);
    ctx.strokeStyle = PALETTE.panelBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW, 64);
    text(dialogue.speaker, boxX + 16, boxY + 24, 14, PALETTE.banner, 'left', true);
    text(dialogue.text, boxX + 16, boxY + 48, 15, PALETTE.text);
  }

  // Speed, bottom-right, while driving. player.car is the car object itself.
  if (!player.onFoot && player.car !== null && typeof player.car === 'object') {
    const speed = Math.abs(player.car.speed || 0);
    text(`${Math.round(speed * 0.32)} km/h`, W - 16, H - 24, 26, PALETTE.text, 'right', true);
  }

  // Minimap, top-right: roads from the city, then blips.
  const mapX = W - MINIMAP - 16;
  const mapY = 16;
  ctx.fillStyle = PALETTE.minimapBg;
  ctx.fillRect(mapX - 4, mapY - 4, MINIMAP + 8, MINIMAP + 8);
  const rect = { x: mapX, y: mapY, w: MINIMAP, h: MINIMAP };
  drawMinimapBase(ctx, state.city, rect);
  const size = state.city.size || 3200;
  const sx = MINIMAP / size;
  const sy = MINIMAP / size;
  const dot = (x, y, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(mapX + x * sx, mapY + y * sy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  // Mission target: a pulsing yellow diamond.
  if (mission && mission.blip) {
    const pulse = 5 + Math.sin(state.time * 4) * 2;
    ctx.fillStyle = PALETTE.banner;
    const bx = mapX + mission.blip.x * sx;
    const by = mapY + mission.blip.y * sy;
    ctx.beginPath();
    ctx.moveTo(bx, by - pulse);
    ctx.lineTo(bx + pulse, by);
    ctx.lineTo(bx, by + pulse);
    ctx.lineTo(bx - pulse, by);
    ctx.closePath();
    ctx.fill();
  }
  // Taxi fare, when the economy is offering one: the waiting passenger,
  // or the destination once they are riding.
  const fare = state.economy && state.economy.fare;
  if (fare) {
    if (fare.state === 'waiting') dot(fare.ped.x, fare.ped.y, 3, '#7ddc6a');
    else dot(fare.dest.x, fare.dest.y, 4, '#7ddc6a');
  }
  // Hidden sun coins.
  for (const pickup of state.pickups) {
    if (pickup.kind === 'suncoin') dot(pickup.x, pickup.y, 3, '#ffd94a');
  }
  // Police, as red dots.
  for (const cop of state.police) dot(cop.x, cop.y, 3, '#ff3b30');
  // Player arrow, rotated to face the direction of travel.
  ctx.save();
  ctx.translate(mapX + player.x * sx, mapY + player.y * sy);
  ctx.rotate(player.angle);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-5, -5);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = PALETTE.panelBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(mapX - 4.5, mapY - 4.5, MINIMAP + 8, MINIMAP + 8);
}
