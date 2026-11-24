# Wankhede Seat Explorer

An unofficial, fan-made 3D seat explorer for Wankhede Stadium, Mumbai. Night-match bowl beside the Arabian Sea and
Marine Drive. Hover a block, fly into the stand, pick a seat, see the ticket with a live "view from this seat"
render, then sit in it and look around. Search your own seat and compare prices around the ground.

Prices are indicative (IPL 2025 listings); seat availability is simulated.

## Run

```
python serve.py
```

Open http://localhost:5173. No build step; three.js is loaded from `node_modules` (run `npm install` once if the folder is missing).

## Use

- **Find my seat**: type it loosely, e.g. `Gavaskar L1 C row 4 seat 17`, `NS L1 B 12 8`, or `ST-L2-C-R09-S20`, or use **Pick** for dropdowns.
- **Prices around the ground**: budget range, level chips, available-only, sort; shows each block's range and the difference vs. your seat. Price heatmap recolours the bowl.
- **Seat view**: "Sit here" on a ticket. Drag to look around, Esc to leave.

## Layout

| Path | What |
|---|---|
| `js/data.js` | Stands, seat generation (~33,100 seats), pricing, search. Pure, no DOM. |
| `js/stadium.js` | three.js scene and camera director (`createStadium` controller). |
| `js/ui.js` | Search, price panel, ticket card, HUD. |
| `tests/data.test.mjs` | `npm test` |
| `ARCHITECTURE.md` | Contracts between the modules. |
