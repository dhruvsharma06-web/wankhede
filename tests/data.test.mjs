import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// js/data.js is a plain ES module; load it via a data: URL so no package.json "type" is required.
const src = readFileSync(new URL('../js/data.js', import.meta.url), 'utf8');
const D = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const { seats, byId } = D.buildSeats();

test('total seat count is near real capacity', () => {
  assert.ok(seats.length >= 32500 && seats.length <= 33700, `got ${seats.length}`);
  assert.equal(byId.size, seats.length);
});

test('build is memoised and deterministic', async () => {
  assert.equal(D.buildSeats().seats, seats);
  // a second, independent module instance (different URL) must produce identical seats
  const D2 = await import('data:text/javascript;base64,' + Buffer.from(src + '\n//second').toString('base64'));
  assert.deepEqual(D2.buildSeats().seats, seats);
});

test('every seat id round-trips through findSeat', () => {
  for (const s of seats) assert.equal(D.findSeat(s.id), s);
  assert.equal(D.findSeat(seats[100].id.toLowerCase()), seats[100]);
});

test('loose queries resolve', () => {
  const id = (q) => D.findSeat(q)?.id;
  assert.equal(id('NS-L1-B-R12-S8'), 'NS-L1-B-R12-S08');
  assert.equal(id('north stand level 1 block b row 12 seat 8'), 'NS-L1-B-R12-S08');
  assert.equal(id('NS L1 B 12 8'), 'NS-L1-B-R12-S08');
  assert.equal(id('gavaskar l1 c r4 s17'), 'SG-L1-C-R04-S17');
  assert.equal(id('Tendulkar L2 Block A Row 3 Seat 10'), 'ST-L2-A-R03-S10');
  assert.doesNotThrow(() => D.findSeat('rohit sharma stand row 2 seat 5'));
});

test('nonsense returns null without throwing', () => {
  for (const q of ['', 'hello world', '???', 'NS L9 B 99 99', null, undefined, 42]) assert.equal(D.findSeat(q), null);
});

test('prices are within level range and multiples of 50', () => {
  for (const s of seats) {
    const L = D.STANDS.find((x) => x.id === s.standId).levels.find((l) => l.level === s.level);
    assert.ok(s.price >= L.price[0] && s.price <= L.price[1], s.id);
    assert.equal(s.price % 50, 0, s.id);
  }
});

test('sold ratio is about 62%', () => {
  const r = seats.filter((s) => s.status === 'sold').length / seats.length;
  assert.ok(r >= 0.55 && r <= 0.7, `ratio ${r}`);
});

test('blocks: one per stand/level/block, centroid and counts', () => {
  const blocks = D.getBlocks();
  assert.equal(D.getBlocks(), blocks);
  assert.equal(blocks.reduce((n, b) => n + b.seatCount, 0), seats.length);
  const b = blocks.find((x) => x.id === D.blockId('NS', 1, 'B'));
  assert.ok(b && b.available > 0 && b.minPrice <= b.maxPrice);
  assert.equal(D.querySeats({ standId: 'NS', level: 1, block: 'B' }).length, b.seatCount);
});

test('filterBlocks price overlap, levels, availability, sorting', () => {
  const all = D.getBlocks();
  const f = D.filterBlocks({ minPrice: 9000, maxPrice: 10000 });
  assert.ok(f.length > 0 && f.length < all.length);
  for (const b of f) assert.ok(b.maxPrice >= 9000 && b.minPrice <= 10000);
  for (const b of all) if (!f.includes(b)) assert.ok(b.maxPrice < 9000 || b.minPrice > 10000);
  assert.ok(D.filterBlocks({ levels: [4] }).every((b) => b.level === 4));
  assert.ok(D.filterBlocks({ standIds: ['SG'], availableOnly: true }).every((b) => b.standId === 'SG' && b.available > 0));
  const asc = D.filterBlocks({ sort: 'price-asc' });
  assert.ok(asc.every((b, i) => i === 0 || asc[i - 1].minPrice <= b.minPrice));
});

test('seatViewpoint: eye 1.15 m above seat, target near origin', () => {
  const s = seats[1234], v = D.seatViewpoint(s);
  assert.ok(Math.abs(v.eye.y - s.pos.y - 1.15) < 1e-9);
  assert.ok(Math.hypot(v.target.x, v.target.y, v.target.z) < 2);
});

test('yaw makes local -Z face the pitch centre', () => {
  for (const s of seats.filter((_, i) => i % 997 === 0)) {
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), len = Math.hypot(s.pos.x, s.pos.z);
    assert.ok(Math.abs(fx + s.pos.x / len) < 1e-9 && Math.abs(fz + s.pos.z / len) < 1e-9);
  }
});

test('seats in the same stand+level are not closer than 0.45 m', () => {
  const groups = new Map();
  for (const s of seats) {
    const k = s.standId + s.level;
    (groups.get(k) || groups.set(k, []).get(k)).push(s);
  }
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i += 7) {
      for (let j = 0; j < g.length; j++) {
        if (i === j) continue;
        const d = Math.hypot(g[i].pos.x - g[j].pos.x, g[i].pos.y - g[j].pos.y, g[i].pos.z - g[j].pos.z);
        assert.ok(d >= 0.45, `${g[i].id} vs ${g[j].id}: ${d}`);
      }
    }
  }
});

test('formatINR', () => {
  assert.equal(D.formatINR(1450), '₹1,450');
  assert.equal(D.formatINR(21000), '₹21,000');
});
