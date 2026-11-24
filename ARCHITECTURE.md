# Wankhede Seat Explorer — architecture & contracts

Owner: lead agent. Every worker agent reads this first and codes **against these contracts exactly**.
Do not rename exports, IDs or CSS hooks listed here. If you need something not listed, add it but keep the listed ones.

## Product (what the user sees)

Inspired by a reference video: a 3D stadium sitting in its city, seen from the air. Hover a block → it lights up orange with a
label. Click → the camera flies down into that stand, seats become visible, sold seats are muted, free seats are
coloured. Click a seat → a paper ticket card slides in with stand / level / block / row / seat / price and a small
"view from this seat" preview. "Sit here" → camera drops to eye height at that seat, looking at the pitch; drag to look
around; Esc returns.

Plus: **Find my seat** search (free text *and* cascading selects) and a **Prices around the ground** panel that filters
blocks by budget / level / availability and shows each block's price range and the difference vs. *your* seat.

Unofficial fan-made explorer, prices are indicative. Say so in the footer. Never present as the official MCA/BCCI site.

## Stack (no build step)

- Static site. `index.html` loads ES modules. Import map maps `three` → `./node_modules/three/build/three.module.js`
  and `three/addons/` → `./node_modules/three/examples/jsm/`. three r187 is installed.
- Serve with `python -m http.server 5173` from this folder.
- Unit tests: `node --test tests/` (pure logic only).

## Files and owners

| File | Owner agent | Depends on |
|---|---|---|
| `js/data.js` | core-logic | nothing (pure; no DOM, no three) |
| `tests/data.test.mjs` | core-logic | data.js |
| `js/stadium.js` | 3d | three, data.js (imports only the exports below) |
| `index.html`, `css/styles.css`, `js/ui.js` | ui | data.js, stadium controller interface |
| `js/main.js` | lead | everything |

## World coordinates

Y up, metres, origin = centre of the pitch. **North = −Z**, East = +X.
Bearing θ (degrees, clockwise from north, as on a map). Point on an ellipse: `x = rx·sin θ`, `z = −rz·cos θ`.
Pitch runs north–south along Z (22-yard strip = 20.12 m between stumps). Arabian Sea / Marine Drive lie to the **west**.

## `js/data.js` contract

```js
export const GEOMETRY = {
  outfield: { rx, rz },        // grass edge ellipse
  boundary: { rx, rz },        // rope ellipse (inside outfield)
  standInner: { rx, rz },      // front edge of the lowest seat row
  seatWidth: 0.55, rowDepth: 0.85, rowRise: 0.42,
  levelGap: { rise: 4.2, back: 2.0 }, // vertical + radial gap between tiers
  roofHeight,                  // height of the canopy rim
};

export const STANDS = [ /* ordered clockwise from north */
  { id: 'NS', name: 'North Stand', short: 'North', from: 330, to: 30,   // bearings; may wrap past 360
    color: '#2F6FED',            // seat colour for this stand
    levels: [ { level: 1, rows: 18, blocks: 4, price: [990, 1800] }, ... ],
    tags: ['Behind the bowler', 'Roofed'] },
  ...
];

// Seat (plain object):
// { id: 'NS-L1-B-R12-S08', standId: 'NS', level: 1, block: 'B', row: 12, number: 8,
//   price: 1450, status: 'available' | 'sold',
//   pos: { x, y, z },          // seat-pan centre in world metres
//   yaw }                      // radians; rotation about Y so the seat faces the pitch centre

export function buildSeats(): { seats: Seat[], byId: Map<string, Seat> }   // memoised, deterministic
export function blockId(standId, level, block): string                     // 'NS-L1-B'
export function getBlocks(): Block[]
// Block: { id, standId, standName, level, block, rows, seatCount, available, minPrice, maxPrice,
//          bearingFrom, bearingTo, centroid: {x,y,z} }
export function findSeat(query: string): Seat | null
// accepts the canonical id, any case, and loose text such as
// "north stand level 1 block b row 12 seat 8", "NS L1 B 12 8", "gavaskar l2 c r4 s17"
export function querySeats({ standId?, level?, block?, row? }): Seat[]     // for cascading selects
export function filterBlocks({ minPrice?, maxPrice?, levels?: number[], standIds?: string[],
                               availableOnly?: boolean, sort?: 'price-asc'|'price-desc'|'bearing' }): Block[]
export function seatViewpoint(seat): { eye: {x,y,z}, target: {x,y,z} }   // eye = seat + 1.15 m up, looks at pitch centre
export function formatINR(n): string                                        // '₹1,450'
```

### Stand table (lead decision from research; prices = IPL 2025 BookMyShow levels, indicative)

Garware Pavilion End = north, Tata End = south. Churchgate rail tracks east, Marine Drive + sea west.

| id | name | bearings | levels: [min, max] ₹ | tags |
|---|---|---|---|---|
| GP | Garware Pavilion | 335→25 | L1 [5850, 7500], L2 [7500, 10250], L3 [8000, 10250] | Pavilion End, Clubhouse |
| GS | Grand Stand | 345→15 | L4 [10250, 15000] | Above dressing rooms, Straight down the pitch |
| MP | MCA Pavilion | 25→55 | L1 [6500, 9000], L2 [8000, 12000] | Beside dressing rooms |
| SG | Sunil Gavaskar Stand | 55→125 | L1 [999, 1500] | Open air, Railway side, Best value |
| VD | Vithal Divecha Pavilion | 125→160 | L1 [3500, 4500], L2 [4500, 6500], L3 [3000, 4000] (L3 label "Rohit Sharma Stand") | Cow corner |
| ST | Sachin Tendulkar Stand | 160→218 | L1 [4250, 4875], L2 [6000, 10250], L3 [3500, 4250] | Tata End, Largest stand |
| DV | Dilip Vengsarkar Stand | 218→252 | L1 [4250, 4875], L2 [9000, 21000], L3 [3500, 4500] | Sightscreen side |
| VM | Vijay Merchant Stand | 252→305 | L1 [2800, 3500], L2 [3500, 4875], L3 [2500, 3200] | Sea-facing, Sunset side |
| NS | North Stand | 305→335 | L1 [1500, 2500], L2 [1200, 2000] | North Stand Gang, Loudest stand |

Level n sits at tier n (higher + further back); a stand may start at L4 (Grand Stand sits above Garware L3).
Tune rows/blocks so total ≈ 33,100. Optional per-level `label` field (e.g. Rohit Sharma Stand).

Rules: deterministic (seeded hash on seat id, no Math.random), ~62 % of seats sold, prices rounded to ₹50.
Price within a level = lerp(min, max, quality) where quality blends (a) side-on view of the pitch (square of the
wicket scores high, dead behind the bowler scores lower) and (b) row (mid rows best, front 2 rows slightly worse).
Total seats should land near the real capacity (~33,000). Each tier sits higher and further back than the one below.

## `js/stadium.js` contract

```js
export function createStadium(canvas, { seats, blocks, stands }) => controller
controller = {
  flyTo(target, { duration? }),        // 'aerial' | { standId } | { blockId } | { seatId }; returns Promise
  enterSeatView(seatId), exitSeatView(), // first-person at seatViewpoint; drag to look; returns Promise
  highlightBlock(blockId | null),      // orange glow, like the reference
  selectSeat(seatId | null),           // marks one seat (pulsing ring)
  setHeatmap(on: boolean),             // recolour available seats by price
  setDimmed(blockIds: Set | null),     // blocks outside current price filter fade
  snapshot(seatId, w=480, h=270): string,  // dataURL render from that seat's eye
  on(event, fn),                       // 'hoverBlock'(blockId|null, {x,y} screen px), 'clickBlock'(blockId),
                                       // 'clickSeat'(seatId), 'mode'('aerial'|'stand'|'seat')
  dispose(),
};
```

Rendering notes: InstancedMesh for seats (one draw call per material), raycast blocks via invisible per-block hit
meshes, seats are only clickable when the camera is close (mode 'stand'). Respect `prefers-reduced-motion` (instant
camera moves). Keep 60 fps on a laptop iGPU: shadows from one directional light only, pixel ratio capped at 2.

## UI hooks (`index.html` ids the lead's `main.js` relies on)

`#scene` (canvas), `#search-input`, `#search-form`, `#sel-stand`, `#sel-level`, `#sel-block`, `#sel-row`, `#sel-seat`,
`#price-panel`, `#ticket`, `#tooltip`, `#seat-hud`, `#toast`.

`js/ui.js` exports `createUI({ data, stadium })` and wires everything itself; `main.js` only does:

```js
import * as data from './data.js'; import { createStadium } from './stadium.js'; import { createUI } from './ui.js';
const { seats } = data.buildSeats();
const stadium = createStadium(document.getElementById('scene'), { seats, blocks: data.getBlocks(), stands: data.STANDS });
createUI({ data, stadium });
```

## Design direction (realistic, minimal, Apple-style chrome)

- Mood: a real IPL night match at Wankhede, with a floodlit bowl and Marine Drive glowing to the west over a dark sea. The lighting is restrained, the seat colours are muted plastics, and the sightscreens are black. The 3D scene is the page; the interface recedes.
- UI: monochrome. Text `#F5F5F7`, secondary `rgba(235,235,245,.6)`, dark material `rgba(28,28,30,.72)` with a blur behind floating controls. Primary buttons are white with black text. Selection is white, never a hue. Cheaper deltas use `#30D158`.
- Type: Inter (SF stack first), tabular numerals for prices. No monospace, no all-caps labels.
- Layout: a brand chip, a search pill and a bottom dock are visible by default. The prices drawer, the Pick popover and the ticket only open on demand. Seat view hides everything except Exit.
- 3D: post-processing renders to a 4x MSAA half-float target, then floodlight-only bloom (threshold 2.2), ACES, then vignette and grain. Seats use LOD: a box seat in the overview and a moulded bucket seat up close, with one instanced mesh per stand so off-screen stands are culled. The shadow map is baked once. Integrated GPUs start at pixel ratio 1, and the renderer drops resolution if frames run slow.
- Motion: drone-style arced camera flights (2.1 s cubic in-out), an opening fly-in, and panels that fade in 240 ms. Reduced motion is honoured.
- Accessible: everything reachable by keyboard, visible focus rings, `aria-live` on the ticket card and toast,
  4.5:1 contrast for text.
