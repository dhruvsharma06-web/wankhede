// Wankhede seat data: geometry, stands, deterministic seat generation, lookup and filtering. Pure ES module.

export const GEOMETRY = {
  outfield: { rx: 70, rz: 76 },
  boundary: { rx: 66, rz: 72 },
  standInner: { rx: 74, rz: 80 },
  seatWidth: 0.55, rowDepth: 0.85, rowRise: 0.42,
  levelGap: { rise: 4.2, back: 2.0 },
  baseY: 1.6,          // height of the front row of tier 1 above the ground
  roofHeight: 44,
};

const lv = (level, rows, blocks, price, label) => ({ level, rows, blocks, price, ...(label && { label }) });

export const STANDS = [
  { id: 'NS', name: 'North Stand', short: 'North', from: 305, to: 335, color: '#2A5BB8',
    levels: [lv(1, 16, 3, [1500, 2500]), lv(2, 12, 3, [1200, 2000])],
    tags: ['North Stand Gang', 'Loudest stand'] },
  { id: 'GP', name: 'Garware Pavilion', short: 'Garware', from: 335, to: 25, color: '#D6D0C2',
    levels: [lv(1, 16, 5, [5850, 7500]), lv(2, 12, 5, [7500, 10250]), lv(3, 10, 5, [8000, 10250])],
    tags: ['Pavilion End', 'Clubhouse'] },
  { id: 'GS', name: 'Grand Stand', short: 'Grand', from: 345, to: 15, color: '#B8AE96',
    levels: [lv(4, 10, 3, [10250, 15000])],
    tags: ['Above dressing rooms', 'Straight down the pitch'] },
  { id: 'MP', name: 'MCA Pavilion', short: 'MCA', from: 25, to: 55, color: '#8C2F3C',
    levels: [lv(1, 16, 3, [6500, 9000]), lv(2, 12, 3, [8000, 12000])],
    tags: ['Beside dressing rooms'] },
  { id: 'SG', name: 'Sunil Gavaskar Stand', short: 'Gavaskar', from: 55, to: 125, color: '#2E6B50',
    levels: [lv(1, 16, 7, [999, 1500])],
    tags: ['Open air', 'Railway side', 'Best value'] },
  { id: 'VD', name: 'Vithal Divecha Pavilion', short: 'Divecha', from: 125, to: 160, color: '#3D4C8C',
    levels: [lv(1, 16, 4, [3500, 4500]), lv(2, 12, 4, [4500, 6500]), lv(3, 10, 4, [3000, 4000], 'Rohit Sharma Stand')],
    tags: ['Cow corner'] },
  { id: 'ST', name: 'Sachin Tendulkar Stand', short: 'Tendulkar', from: 160, to: 218, color: '#1F5FA8',
    levels: [lv(1, 16, 6, [4250, 4875]), lv(2, 12, 6, [6000, 10250]), lv(3, 10, 6, [3500, 4250])],
    tags: ['Tata End', 'Largest stand'] },
  { id: 'DV', name: 'Dilip Vengsarkar Stand', short: 'Vengsarkar', from: 218, to: 252, color: '#2A6F86',
    levels: [lv(1, 16, 4, [4250, 4875]), lv(2, 12, 4, [9000, 21000]), lv(3, 10, 4, [3500, 4500])],
    tags: ['Sightscreen side'] },
  { id: 'VM', name: 'Vijay Merchant Stand', short: 'Merchant', from: 252, to: 305, color: '#C49A2E',
    levels: [lv(1, 16, 5, [2800, 3500]), lv(2, 12, 5, [3500, 4875]), lv(3, 10, 5, [2500, 3200])],
    tags: ['Sea-facing', 'Sunset side'] },
];

const RAD = Math.PI / 180;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// FNV-1a string hash -> [0,1)
function hash01(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h / 4294967296;
}

// Fixed per-tier profile (max rows per tier across stands) so every stand's tiers line up into one bowl.
const MAX_ROWS = {};
for (const s of STANDS) for (const l of s.levels) MAX_ROWS[l.level] = Math.max(MAX_ROWS[l.level] || 0, l.rows);
function tierBase(tier) {
  const g = GEOMETRY;
  let back = 0, rise = g.baseY;
  for (let k = 1; k < tier; k++) {
    back += (MAX_ROWS[k] || 0) * g.rowDepth + g.levelGap.back;
    rise += (MAX_ROWS[k] || 0) * g.rowRise + g.levelGap.rise;
  }
  return { back, rise };
}

export const blockId = (standId, level, block) => `${standId}-L${level}-${block}`;
const pad2 = (n) => String(n).padStart(2, '0');
const roundTo50 = (v) => Math.round(v / 50) * 50;

let cache = null;
export function buildSeats() {
  if (cache) return cache;
  const g = GEOMETRY, seats = [], byId = new Map();
  for (const stand of STANDS) {
    const span = ((stand.to - stand.from) % 360 + 360) % 360 || 360;
    for (const L of stand.levels) {
      const { back: tb, rise: tr } = tierBase(L.level);
      const lo = Math.ceil(L.price[0] / 50) * 50, hi = Math.floor(L.price[1] / 50) * 50;
      for (let b = 0; b < L.blocks; b++) {
        const letter = String.fromCharCode(65 + b);
        const a0 = stand.from + (span * b) / L.blocks, a1 = stand.from + (span * (b + 1)) / L.blocks;
        for (let row = 1; row <= L.rows; row++) {
          const back = tb + (row - 1) * g.rowDepth, y = tr + (row - 1) * g.rowRise;
          const rx = g.standInner.rx + back, rz = g.standInner.rz + back;
          // cumulative arc length over [a0,a1] on this row's ellipse
          const N = 120, cum = [0];
          let px = rx * Math.sin(a0 * RAD), pz = -rz * Math.cos(a0 * RAD);
          for (let i = 1; i <= N; i++) {
            const t = (a0 + ((a1 - a0) * i) / N) * RAD, x = rx * Math.sin(t), z = -rz * Math.cos(t);
            cum.push(cum[i - 1] + Math.hypot(x - px, z - pz)); px = x; pz = z;
          }
          const n = Math.floor((cum[N] - g.seatWidth) / g.seatWidth); // one seat width left free as aisle
          let k = 0;
          for (let s = 1; s <= n; s++) {
            const d = g.seatWidth * (s - 0.5) + g.seatWidth / 2; // distance from block start
            while (k < N - 1 && cum[k + 1] < d) k++;
            const f = (d - cum[k]) / (cum[k + 1] - cum[k] || 1);
            const bearing = a0 + ((a1 - a0) * (k + f)) / N, t = bearing * RAD;
            const x = rx * Math.sin(t), z = -rz * Math.cos(t);
            const id = `${stand.id}-L${L.level}-${letter}-R${pad2(row)}-S${pad2(s)}`;
            // view quality: side-on to the pitch (east/west) beats behind the bowler; mid rows beat the front two
            const side = Math.abs(Math.sin(t));
            const rowQ = clamp01(1 - Math.abs(row - L.rows * 0.55) / (L.rows * 0.6)) * (row <= 2 ? 0.6 : 1);
            const price = roundTo50(lo + (hi - lo) * clamp01(0.6 * side + 0.4 * rowQ));
            const seat = {
              id, standId: stand.id, level: L.level, block: letter, row, number: s,
              price: Math.min(hi, Math.max(lo, price)),
              status: hash01(id) < 0.62 ? 'sold' : 'available',
              pos: { x, y, z },
              // yaw about +Y turns local -Z to (-sin yaw, -cos yaw); we want (-x, -z)/|p|, so yaw = atan2(x, z)
              yaw: Math.atan2(x, z),
            };
            seats.push(seat); byId.set(id, seat);
          }
        }
      }
    }
  }
  return (cache = { seats, byId });
}

let blockCache = null;
export function getBlocks() {
  if (blockCache) return blockCache;
  const map = new Map();
  for (const seat of buildSeats().seats) {
    const id = blockId(seat.standId, seat.level, seat.block);
    let b = map.get(id);
    if (!b) {
      const stand = STANDS.find((s) => s.id === seat.standId);
      const L = stand.levels.find((l) => l.level === seat.level);
      const span = ((stand.to - stand.from) % 360 + 360) % 360 || 360, i = seat.block.charCodeAt(0) - 65;
      b = { id, standId: stand.id, standName: stand.name, level: seat.level, block: seat.block, rows: L.rows,
        seatCount: 0, available: 0, minPrice: Infinity, maxPrice: -Infinity,
        bearingFrom: (stand.from + (span * i) / L.blocks) % 360, bearingTo: (stand.from + (span * (i + 1)) / L.blocks) % 360,
        centroid: { x: 0, y: 0, z: 0 } };
      map.set(id, b);
    }
    b.seatCount++; if (seat.status === 'available') b.available++;
    b.minPrice = Math.min(b.minPrice, seat.price); b.maxPrice = Math.max(b.maxPrice, seat.price);
    b.centroid.x += seat.pos.x; b.centroid.y += seat.pos.y; b.centroid.z += seat.pos.z;
  }
  for (const b of map.values()) { b.centroid.x /= b.seatCount; b.centroid.y /= b.seatCount; b.centroid.z /= b.seatCount; }
  return (blockCache = [...map.values()]);
}

export function querySeats({ standId, level, block, row } = {}) {
  return buildSeats().seats.filter((s) =>
    (standId == null || s.standId === standId) && (level == null || s.level === Number(level)) &&
    (block == null || s.block === block) && (row == null || s.row === Number(row)));
}

export function filterBlocks({ minPrice = 0, maxPrice = Infinity, levels, standIds, availableOnly, sort } = {}) {
  const out = getBlocks().filter((b) =>
    b.maxPrice >= minPrice && b.minPrice <= maxPrice &&
    (!levels || !levels.length || levels.includes(b.level)) &&
    (!standIds || !standIds.length || standIds.includes(b.standId)) &&
    (!availableOnly || b.available > 0));
  if (sort === 'price-asc') out.sort((a, b) => a.minPrice - b.minPrice);
  else if (sort === 'price-desc') out.sort((a, b) => b.maxPrice - a.maxPrice);
  else if (sort === 'bearing') out.sort((a, b) => a.bearingFrom - b.bearingFrom);
  return out;
}

// Loose parser: pulls out level / row / seat / block by keyword, then matches the stand by id or name word,
// then falls back to positional tokens ("NS L1 B 12 8").
export function findSeat(query) {
  try {
    if (typeof query !== 'string') return null;
    let s = ' ' + query.toUpperCase().replace(/[^A-Z0-9]+/g, ' ') + ' ';
    const take = (re) => { const m = s.match(re); if (m) s = s.replace(re, ' '); return m && m[1]; };
    const level = take(/\b(?:LEVEL|LVL|L)\s*(\d)\b/);
    const row = take(/\b(?:ROW|R)\s*(\d+)\b/);
    let seat = take(/\b(?:SEAT|NO|S)\s*(\d+)\b/);
    let block = take(/\bBLOCK\s*([A-Z])\b/);
    const words = s.split(' ').filter(Boolean);
    const stand = STANDS.find((st) => {
      const keys = [st.id, ...`${st.name} ${st.levels.map((l) => l.label || '').join(' ')}`.toUpperCase().split(' ')
        .filter((w) => w.length > 2 && !['STAND', 'END', 'PAVILION'].includes(w))];
      return words.some((w) => keys.includes(w));
    });
    if (!stand) return null;
    const rest = words.filter((w) => !/^[A-Z]{2,}$/.test(w));
    if (!block) block = (rest.find((w) => /^[A-Z]$/.test(w)) || null);
    const nums = rest.filter((w) => /^\d+$/.test(w));
    const rowN = row ?? nums.shift(), seatN = seat ?? nums.shift();
    const lvl = level ?? (stand.levels.length === 1 ? stand.levels[0].level : null);
    if (!block || rowN == null || seatN == null || lvl == null) return null;
    const id = `${stand.id}-L${Number(lvl)}-${block}-R${pad2(Number(rowN))}-S${pad2(Number(seatN))}`;
    return buildSeats().byId.get(id) || null;
  } catch { return null; }
}

export function seatViewpoint(seat) {
  const { x, y, z } = seat.pos;
  return { eye: { x, y: y + 1.15, z }, target: { x: 0, y: 0, z: 0 } };
}

export const formatINR = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
