// city.js — procedural "Solmar City" for the top-down open-world game.
// Pure deterministic generation from the passed rng (a function returning [0,1)).
// No imports. W1 (main.js) calls createCity(rng) once at boot.
//
// Layout (world 3200x3200):
//   West strip: ocean (x 0..110) + beach/boardwalk (x 110..192).
//   Grid: 10x10 blocks, pitch 284 (220 block + 64 road), origin x=192, y=0.
//   South strip below the last road (y 2904..3200): Harbor docks.
//   Roads: 11 vertical centres, 11 horizontal centres, forming a connected grid.
export const WORLD_SIZE = 3200;
export const ROAD_W = 64;
export const PITCH = 284;
export const GRID_OX = 192;
export const GRID_COLS = 10;
export const GRID_ROWS = 10;

const DISTRICT_COLORS = {
  Downtown: '#7d8aa0',
  Marina: '#e8c98f',
  Harbor: '#8a7f72',
  Hills: '#a8b08a',
  'Old Town': '#c98f6b',
};

function districtNameAt(x, y) {
  if (y >= 2350) return 'Harbor';
  if (x < 760) return 'Marina';
  if (x >= 2260) return 'Old Town';
  if (y < 850) return 'Hills';
  return 'Downtown';
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function range(rng, a, b) {
  return a + rng() * (b - a);
}

function intRange(rng, a, b) {
  return a + Math.floor(rng() * (b - a + 1));
}

export function createCity(rng) {
  const size = WORLD_SIZE;
  const roadW = ROAD_W;

  // Road centre lines.
  const v = [];
  const h = [];
  for (let i = 0; i <= GRID_COLS; i++) v.push(GRID_OX + i * PITCH + roadW / 2);
  for (let i = 0; i <= GRID_ROWS; i++) h.push(i * PITCH + roadW / 2);

  const districts = [
    { name: 'Marina', x: 0, y: 0, w: 760, h: 2350, color: '#e8c98f' },
    { name: 'Hills', x: 760, y: 0, w: 1500, h: 850, color: '#a8b08a' },
    { name: 'Downtown', x: 760, y: 850, w: 1500, h: 1500, color: '#7d8aa0' },
    { name: 'Old Town', x: 2260, y: 0, w: 940, h: 2350, color: '#c98f6b' },
    { name: 'Harbor', x: 0, y: 2350, w: 3200, h: 850, color: '#8a7f72' },
  ];

  const blocks = [];
  // Special blocks: stadium (Hills, col 5 row 1), plaza (Old Town, col 8 row 3),
  // park (Hills, col 2 row 1).
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = GRID_OX + col * PITCH + roadW;
      const y = row * PITCH + roadW;
      const w = PITCH - roadW;
      const hgt = PITCH - roadW;
      const cx = x + w / 2;
      const cy = y + hgt / 2;
      const district = districtNameAt(cx, cy);
      let height = 10;
      let color = '#9aa0a8';
      let roof = '#6b7280';
      if (col === 5 && row === 1) {
        // Stadium block.
        blocks.push({ x, y, w, h: hgt, district, height: 18, color: '#5d7d4a', roof: '#3f6b34' });
        continue;
      }
      if (col === 8 && row === 3) {
        // Plaza block: no building, open stone square.
        blocks.push({ x, y, w, h: hgt, district, height: 0, color: '#d8cbb2', roof: '#d8cbb2' });
        continue;
      }
      if (col === 2 && row === 1) {
        // Park block.
        blocks.push({ x, y, w, h: hgt, district, height: 0, color: '#5d8a4a', roof: '#5d8a4a' });
        continue;
      }
      if (district === 'Downtown') {
        height = intRange(rng, 55, 140);
        color = pick(rng, ['#5b6b82', '#6b7d94', '#4a5a70', '#7d8aa0', '#54627a']);
        roof = pick(rng, ['#3a4556', '#2f3a4a', '#46586e', '#5a6b80']);
      } else if (district === 'Marina') {
        height = intRange(rng, 8, 22);
        color = pick(rng, ['#e8d5a8', '#f0e0c0', '#dcc08a', '#e8c9a0']);
        roof = pick(rng, ['#c96f4a', '#b85c3e', '#d8a05a', '#8fa8b8']);
      } else if (district === 'Harbor') {
        height = intRange(rng, 6, 14);
        color = pick(rng, ['#8a7f72', '#7a6f62', '#96897a', '#6e655c']);
        roof = pick(rng, ['#5c5348', '#4e463e', '#6b5f52']);
      } else if (district === 'Hills') {
        height = intRange(rng, 10, 20);
        color = pick(rng, ['#e0d0b0', '#d8c8a8', '#efe4c8', '#cbb890']);
        roof = pick(rng, ['#a8543a', '#8f4a34', '#b8763e', '#7a5a48']);
      } else {
        // Old Town: low terracotta roofs.
        height = intRange(rng, 8, 16);
        color = pick(rng, ['#d8b48f', '#e0c09a', '#cda67e', '#e8d0ae']);
        roof = pick(rng, ['#b85c38', '#a84e2e', '#c96f3e', '#96502f']);
      }
      blocks.push({ x, y, w, h: hgt, district, height, color, roof });
    }
  }

  // Landmarks (centres of their blocks / features).
  const stadiumBlock = blocks[1 * GRID_COLS + 5];
  const plazaBlock = blocks[3 * GRID_COLS + 8];
  const landmarks = [
    { name: 'Plaza del Sol', x: plazaBlock.x + plazaBlock.w / 2, y: plazaBlock.y + plazaBlock.h / 2, kind: 'plaza' },
    { name: 'Marina Pier', x: 60, y: 1400, kind: 'pier' },
    { name: 'Harbor Cranes', x: 1600, y: 3050, kind: 'cranes' },
    { name: 'Solmar Stadium', x: stadiumBlock.x + stadiumBlock.w / 2, y: stadiumBlock.y + stadiumBlock.h / 2, kind: 'stadium' },
  ];

  // Harbor containers in the south dock strip (y 2920..3180), deterministic.
  const containers = [];
  const contColors = ['#b8542e', '#2e6b8a', '#5a7d3a', '#8a6d2e', '#7a3a5a'];
  for (let i = 0; i < 46; i++) {
    const cx = 260 + rng() * 2700;
    const cy = 2930 + rng() * 220;
    containers.push({
      x: cx, y: cy,
      w: 52 + rng() * 30, h: 20 + rng() * 8,
      color: pick(rng, contColors),
      angle: rng() < 0.5 ? 0 : Math.PI / 2,
    });
  }

  // Props: palms on the beach/boardwalk, trees in park + hills, lamps at
  // intersections, benches at the plaza, hydrants near road corners.
  const props = [];
  for (let y = 60; y < size - 40; y += 130) {
    props.push({ x: 138 + rng() * 22, y: y + rng() * 40, kind: 'palm' });
    if (rng() < 0.6) props.push({ x: 168 + rng() * 12, y: y + 65 + rng() * 40, kind: 'palm' });
  }
  // Trees: park block + scattered hills blocks.
  const park = blocks[1 * GRID_COLS + 2];
  for (let i = 0; i < 14; i++) {
    props.push({ x: park.x + 20 + rng() * (park.w - 40), y: park.y + 20 + rng() * (park.h - 40), kind: 'tree' });
  }
  for (let i = 0; i < 40; i++) {
    const b = blocks[Math.floor(rng() * blocks.length)];
    if (b.height === 0) continue;
    if (b.district !== 'Hills' && b.district !== 'Marina') continue;
    props.push({ x: b.x + 8 + rng() * 12, y: b.y + 8 + rng() * (b.h - 16), kind: 'tree' });
  }
  // Lamps at a sample of intersections (offset to the corner).
  for (let i = 0; i < v.length; i++) {
    for (let j = 0; j < h.length; j++) {
      if (rng() < 0.45) {
        props.push({ x: v[i] + 40, y: h[j] - 40, kind: 'lamp' });
      }
    }
  }
  // Benches around the plaza fountain.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    props.push({
      x: plazaBlock.x + plazaBlock.w / 2 + Math.cos(a) * 62,
      y: plazaBlock.y + plazaBlock.h / 2 + Math.sin(a) * 62,
      kind: 'bench',
    });
  }
  // Hydrants near random road corners.
  for (let i = 0; i < 26; i++) {
    const vi = Math.floor(rng() * v.length);
    const hi = Math.floor(rng() * h.length);
    props.push({ x: v[vi] + 38, y: h[hi] + 38, kind: 'hydrant' });
  }

  const city = {
    size,
    blocks,
    roads: { h: [...h], v: [...v] },
    roadW,
    districts,
    landmarks,
    containers,
    spawnPoint: { x: v[5], y: h[5] },
    props,
    beach: { x: 110, y: 0, w: 82, h: size },
    water: { x: 0, y: 0, w: 110, h: size },
  };
  return city;
}

// Building rect for a block (inset sidewalk of 14px). Blocks with height 0
// (plaza / park / stadium field) have no solid building.
export function buildingRect(block) {
  if (!block || block.height <= 0) return null;
  return { x: block.x + 14, y: block.y + 14, w: block.w - 28, h: block.h - 28 };
}

export function pointInBuilding(city, x, y) {
  for (const b of city.blocks) {
    const r = buildingRect(b);
    if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

// Push a circle of radius r out of every building rect it overlaps.
// Returns a corrected {x, y} (new object; input untouched). Also clamps to world.
export function collideBuildings(city, x, y, r) {
  let nx = x;
  let ny = y;
  for (const b of city.blocks) {
    const rect = buildingRect(b);
    if (!rect) continue;
    const cx = Math.max(rect.x, Math.min(nx, rect.x + rect.w));
    const cy = Math.max(rect.y, Math.min(ny, rect.y + rect.h));
    const dx = nx - cx;
    const dy = ny - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        nx = cx + (dx / d) * r;
        ny = cy + (dy / d) * r;
      } else {
        // Centre inside the rect: push out along the smallest penetration axis.
        const left = nx - rect.x + r;
        const right = rect.x + rect.w - nx + r;
        const top = ny - rect.y + r;
        const bottom = rect.y + rect.h - ny + r;
        const m = Math.min(left, right, top, bottom);
        if (m === left) nx = rect.x - r;
        else if (m === right) nx = rect.x + rect.w + r;
        else if (m === top) ny = rect.y - r;
        else ny = rect.y + rect.h + r;
      }
    }
  }
  nx = Math.max(r, Math.min(city.size - r, nx));
  ny = Math.max(r, Math.min(city.size - r, ny));
  return { x: nx, y: ny };
}

export function isRoad(city, x, y) {
  if (x < 0 || y < 0 || x > city.size || y > city.size) return false;
  const half = city.roadW / 2;
  // Horizontal roads span the grid x-range; vertical roads span the grid y-range.
  const gridX0 = GRID_OX;
  const gridX1 = GRID_OX + GRID_COLS * PITCH + city.roadW;
  const gridY1 = GRID_ROWS * PITCH + city.roadW;
  for (const cy of city.roads.h) {
    if (Math.abs(y - cy) <= half && x >= gridX0 - half && x <= gridX1) return true;
  }
  for (const cx of city.roads.v) {
    if (Math.abs(x - cx) <= half && y >= 0 && y <= gridY1) return true;
  }
  return false;
}

function nearestIn(arr, v) {
  let best = arr[0];
  let bd = Math.abs(v - best);
  for (const a of arr) {
    const d = Math.abs(v - a);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

export function nearestRoadPoint(city, x, y) {
  const nx = nearestIn(city.roads.v, x);
  const ny = nearestIn(city.roads.h, y);
  // Snap to the closer of: keep y, snap x to a vertical road; keep x, snap y
  // to a horizontal road. Prefer the nearer snap.
  const dx = Math.abs(nx - x);
  const dy = Math.abs(ny - y);
  if (dx <= dy) return { x: nx, y: Math.max(0, Math.min(city.size, y)) };
  return { x: Math.max(0, Math.min(city.size, x)), y: ny };
}

export function randomRoadPoint(city, rng) {
  const vi = Math.floor(rng() * city.roads.v.length);
  const hi = Math.floor(rng() * city.roads.h.length);
  return { x: city.roads.v[vi], y: city.roads.h[hi] };
}

export function districtAt(city, x, y) {
  return districtNameAt(x, y);
}

// ---- Drawing ---------------------------------------------------------------

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawCity(ctx, city, view) {
  const vx = view && view.x !== undefined ? view.x : (view && view.cx !== undefined ? view.cx - view.w / 2 : 0);
  const vy = view && view.y !== undefined ? view.y : (view && view.cy !== undefined ? view.cy - view.h / 2 : 0);
  const vw = view ? view.w : city.size;
  const vh = view ? view.h : city.size;
  const x0 = vx - 40, y0 = vy - 40, x1 = vx + vw + 40, y1 = vy + vh + 40;
  const inView = (x, y, w, h) => x + w >= x0 && x <= x1 && y + h >= y0 && y <= y1;

  // Ground: grass base.
  ctx.fillStyle = '#6f9a52';
  ctx.fillRect(vx, vy, vw, vh);

  // Ocean + beach on the west edge.
  if (inView(city.water.x, city.water.y, city.water.w, city.water.h)) {
    ctx.fillStyle = '#2e6f9e';
    ctx.fillRect(city.water.x, city.water.y, city.water.w, city.water.h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let wy = 0; wy < city.size; wy += 160) {
      ctx.fillRect(8, wy + 40, 94, 5);
    }
  }
  if (inView(city.beach.x, city.beach.y, city.beach.w, city.beach.h)) {
    ctx.fillStyle = '#e8d49a';
    ctx.fillRect(city.beach.x, city.beach.y, city.beach.w, city.beach.h);
    ctx.fillStyle = '#c9a86a';
    ctx.fillRect(GRID_OX - 6, 0, 6, city.size); // boardwalk edge
  }

  // Harbor dock strip (south).
  ctx.fillStyle = '#7d7468';
  ctx.fillRect(0, 2904, city.size, city.size - 2904);
  ctx.fillStyle = '#5d564e';
  ctx.fillRect(0, 2904, city.size, 8);
  // Dock water at the very south edge.
  ctx.fillStyle = '#2e6f9e';
  ctx.fillRect(0, 3150, city.size, 50);

  // Roads: asphalt bands.
  ctx.fillStyle = '#3c3f45';
  for (const cy of city.roads.h) {
    if (cy + city.roadW / 2 >= y0 && cy - city.roadW / 2 <= y1) {
      ctx.fillRect(GRID_OX - city.roadW / 2, cy - city.roadW / 2, GRID_COLS * PITCH + city.roadW * 2, city.roadW);
    }
  }
  for (const cx of city.roads.v) {
    if (cx + city.roadW / 2 >= x0 && cx - city.roadW / 2 <= x1) {
      ctx.fillRect(cx - city.roadW / 2, 0, city.roadW, GRID_ROWS * PITCH + city.roadW);
    }
  }

  // Sidewalks + buildings.
  for (const b of city.blocks) {
    if (!inView(b.x, b.y, b.w, b.h)) continue;
    // Sidewalk slab.
    ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    if (b.height <= 0) {
      // Plaza / park / stadium field: flat ground, no shadow.
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8);
      if (b.district === 'Hills' && b.color === '#5d8a4a') {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 46, 0, Math.PI * 2);
        ctx.stroke();
      }
      continue;
    }
    const r = buildingRect(b);
    // Long sun shadow to the south-east; length grows with height.
    const shx = b.height * 0.28;
    const shy = b.height * 0.34;
    ctx.fillStyle = 'rgba(20,24,30,0.30)';
    ctx.fillRect(r.x + shx, r.y + shy, r.w, r.h);
    // Roof.
    ctx.fillStyle = b.roof;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
    // Darker edge.
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    // Rooftop detail on tall towers.
    if (b.height > 60) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(r.x + r.w / 2 - 16, r.y + r.h / 2 - 16, 32, 32);
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.fillRect(r.x + 14, r.y + 14, 18, 18);
    }
  }

  // Centre dashes + crosswalks at intersections.
  ctx.fillStyle = '#d8c95a';
  for (const cy of city.roads.h) {
    if (cy < y0 || cy > y1) continue;
    for (let x = GRID_OX; x < GRID_OX + GRID_COLS * PITCH + city.roadW; x += 48) {
      // Skip dashes inside intersections.
      let inside = false;
      for (const cx of city.roads.v) if (Math.abs(x + 12 - cx) < city.roadW / 2 + 14) { inside = true; break; }
      if (!inside) ctx.fillRect(x, cy - 2, 24, 4);
    }
  }
  ctx.fillStyle = '#e8e8e8';
  for (const cx of city.roads.v) {
    for (const cy of city.roads.h) {
      if (!inView(cx - 40, cy - 40, 80, 80)) continue;
      for (let i = -3; i <= 3; i++) {
        ctx.fillRect(cx + i * 9 - 3, cy - city.roadW / 2 + 6, 5, 12);
        ctx.fillRect(cx + i * 9 - 3, cy + city.roadW / 2 - 18, 5, 12);
      }
    }
  }

  // Harbor containers.
  for (const c of city.containers) {
    if (!inView(c.x - 40, c.y - 40, 120, 80)) continue;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.fillStyle = c.color;
    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.restore();
  }

  // Landmarks.
  for (const lm of city.landmarks) {
    if (!inView(lm.x - 120, lm.y - 120, 240, 240)) continue;
    if (lm.kind === 'plaza') {
      ctx.fillStyle = '#4a90c2';
      ctx.beginPath(); ctx.arc(lm.x, lm.y, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#bfe0f2';
      ctx.beginPath(); ctx.arc(lm.x, lm.y, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(lm.x, lm.y, 5, 0, Math.PI * 2); ctx.fill();
    } else if (lm.kind === 'pier') {
      ctx.fillStyle = '#8a6b45';
      ctx.fillRect(0, lm.y - 14, 190, 28);
      ctx.fillStyle = '#6b4f30';
      for (let px = 20; px < 190; px += 30) ctx.fillRect(px, lm.y - 18, 6, 36);
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(150, lm.y - 26, 34, 12);
    } else if (lm.kind === 'cranes') {
      ctx.strokeStyle = '#c9a13a';
      ctx.lineWidth = 6;
      for (const off of [-260, 0, 260]) {
        const kx = lm.x + off;
        ctx.beginPath();
        ctx.moveTo(kx, lm.y + 60); ctx.lineTo(kx, lm.y - 90);
        ctx.moveTo(kx, lm.y - 90); ctx.lineTo(kx + 130, lm.y - 60);
        ctx.moveTo(kx, lm.y - 90); ctx.lineTo(kx - 70, lm.y - 55);
        ctx.stroke();
        ctx.fillStyle = '#8a6d2e';
        ctx.fillRect(kx - 16, lm.y + 40, 32, 22);
      }
    } else if (lm.kind === 'stadium') {
      ctx.fillStyle = '#3f6b34';
      ctx.beginPath(); ctx.ellipse(lm.x, lm.y, 92, 62, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(lm.x, lm.y, 92, 62, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#5d8a4a';
      ctx.beginPath(); ctx.ellipse(lm.x, lm.y, 70, 44, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(lm.x, lm.y - 44); ctx.lineTo(lm.x, lm.y + 44); ctx.stroke();
    }
  }

  // Props.
  for (const p of city.props) {
    if (!inView(p.x - 12, p.y - 12, 24, 24)) continue;
    if (p.kind === 'palm') {
      ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 3, p.y - 14); ctx.stroke();
      ctx.fillStyle = '#3f7d3a';
      ctx.beginPath(); ctx.arc(p.x + 3, p.y - 16, 8, 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'tree') {
      ctx.fillStyle = '#2f6b2f';
      ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a8a3a';
      ctx.beginPath(); ctx.arc(p.x - 3, p.y - 3, 5, 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'lamp') {
      ctx.fillStyle = '#2a2e35';
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      ctx.fillStyle = 'rgba(255,240,180,0.85)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'bench') {
      ctx.fillStyle = '#7a5a30';
      ctx.fillRect(p.x - 7, p.y - 3, 14, 6);
    } else if (p.kind === 'hydrant') {
      ctx.fillStyle = '#c23a2e';
      ctx.fillRect(p.x - 3, p.y - 4, 6, 8);
    }
  }

  // District labels (subtle).
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const d of city.districts) {
    const lx = d.x + d.w / 2;
    const ly = d.y + d.h / 2;
    if (lx >= x0 && lx <= x1 && ly >= y0 && ly <= y1) {
      ctx.fillText(d.name.toUpperCase(), lx, ly);
    }
  }
  ctx.textAlign = 'left';
}

export function drawMinimapBase(ctx, city, rect) {
  const s = rect.w / city.size;
  const sx = (x) => rect.x + x * s;
  const sy = (y) => rect.y + y * s;
  ctx.fillStyle = '#5d7d4a';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  // Water + beach.
  ctx.fillStyle = '#2e6f9e';
  ctx.fillRect(sx(city.water.x), sy(city.water.y), city.water.w * s, city.water.h * s);
  ctx.fillStyle = '#e8d49a';
  ctx.fillRect(sx(city.beach.x), sy(city.beach.y), city.beach.w * s, city.beach.h * s);
  // District blocks.
  for (const b of city.blocks) {
    ctx.fillStyle = DISTRICT_COLORS[b.district] || '#888888';
    ctx.fillRect(sx(b.x), sy(b.y), Math.max(1, b.w * s), Math.max(1, b.h * s));
  }
  // Roads.
  ctx.fillStyle = '#3c3f45';
  for (const cy of city.roads.h) ctx.fillRect(sx(GRID_OX - city.roadW / 2), sy(cy - city.roadW / 2), (GRID_COLS * PITCH + city.roadW * 2) * s, city.roadW * s);
  for (const cx of city.roads.v) ctx.fillRect(sx(cx - city.roadW / 2), sy(0), city.roadW * s, (GRID_ROWS * PITCH + city.roadW) * s);
  // Harbor strip.
  ctx.fillStyle = '#7d7468';
  ctx.fillRect(sx(0), sy(2904), city.size * s, (city.size - 2904) * s);
  // Landmarks.
  ctx.fillStyle = '#ffffff';
  for (const lm of city.landmarks) {
    ctx.fillRect(sx(lm.x) - 2, sy(lm.y) - 2, 4, 4);
  }
}
