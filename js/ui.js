// UI layer: plain DOM, event delegation. Talks to data.js (pure) and the stadium controller.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS_KEY = 'wankhede.mySeat';
const P_MIN = 1000, P_MAX = 21000;

export function createUI({ data, stadium }) {
  const { STANDS, formatINR } = data;
  const { byId: seatById } = data.buildSeats();
  const blocks = data.getBlocks();
  const standOf = (id) => STANDS.find((s) => s.id === id);
  const levelLabel = (seat) => standOf(seat.standId)?.levels?.find((l) => l.level === seat.level)?.label || '';
  const pad = (n) => String(n).padStart(2, '0');

  const el = {
    body: document.body, toast: $('#toast'), tooltip: $('#tooltip'), ticket: $('#ticket'), crumb: $('#crumb'),
    form: $('#search-form'), input: $('#search-input'), more: $('#search-more'), selWrap: $('#search-selects'),
    go: $('#pick-go'), search: $('#search'), panel: $('#price-panel'), pclose: $('#panel-close'), list: $('#block-list'),
    pmin: $('#price-min'), pmax: $('#price-max'), out: $('#budget-out'), avail: $('#f-avail'),
    sort: $('#f-sort'), count: $('#match-count'), hud: $('#seat-hud'), hudText: $('#hud-text'),
    ramp: $('#heat-ramp'), loading: $('#loading'),
    dOver: $('#dk-overview'), dFind: $('#dk-find'), dPrices: $('#dk-prices'), dHeat: $('#dk-heat'), dSeat: $('#dk-seat'),
  };
  const sels = ['stand', 'level', 'block', 'row', 'seat'].map((k) => $('#sel-' + k));
  const [selStand, selLevel, selBlock, selRow, selSeat] = sels;

  const st = { mode: 'aerial', mine: null, open: null, levels: new Set(), hoverRow: null, focusBlock: null, standId: null, snap: null, flight: null };
  try { const v = localStorage.getItem(LS_KEY); if (v && seatById.has(v)) st.mine = v; } catch { /* storage blocked */ }

  /* ---------- toast ---------- */
  let toastTimer, hideTimer;
  function toast(msg, ms = 4800) {
    el.toast.textContent = msg; el.toast.hidden = false;
    requestAnimationFrame(() => el.toast.classList.add('show'));
    clearTimeout(toastTimer); clearTimeout(hideTimer);
    toastTimer = setTimeout(() => { el.toast.classList.remove('show'); hideTimer = setTimeout(() => (el.toast.hidden = true), 250); }, ms);
  }

  /* ---------- crumb ---------- */
  function renderCrumb() {
    const parts = [['aerial', 'Overview']];
    const s = st.standId && standOf(st.standId);
    if (st.mode !== 'aerial' && s) parts.push(['stand', s.name]);
    el.crumb.innerHTML = parts.map(([k, t], i) =>
      `${i ? '<span class="sep" aria-hidden="true">›</span>' : ''}<button type="button" data-crumb="${k}"${i === parts.length - 1 ? ' aria-current="page"' : ''}>${esc(t)}</button>`).join('');
  }
  el.crumb.addEventListener('click', (e) => {
    const k = e.target.closest('[data-crumb]')?.dataset.crumb;
    if (k === 'aerial') { exitSeat(); closeTicket(); st.standId = null; fly('aerial'); }
    else if (k === 'stand' && st.standId) { exitSeat(); fly({ standId: st.standId }); }
  });

  const fly = (t) => { const p = Promise.resolve(stadium.flyTo(t)); st.flight = p.catch(() => {}); return p; };

  /* ---------- seats: go to / mine ---------- */
  function setMine(id) {
    st.mine = id;
    try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
    el.dSeat.hidden = false; updateDeltas(); renderTicket();
  }
  async function goSeat(seat, { mine = false } = {}) {
    clearTimeout(toastTimer); clearTimeout(hideTimer); el.toast.classList.remove('show'); el.toast.hidden = true;
    if (st.mode === 'seat') await stadium.exitSeatView?.();
    if (mine) setMine(seat.id);
    st.standId = seat.standId;
    openTicket(seat.id);
    try { await fly({ seatId: seat.id }); } catch { /* flight interrupted */ }
    if (st.open === seat.id) stadium.selectSeat(seat.id);
  }
  function exitSeat() { if (st.mode === 'seat') stadium.exitSeatView(); }

  /* ---------- search ---------- */
  function example() {
    const s = seatById.get('SG-L1-C-R04-S17') || [...seatById.values()][0];
    return s ? s.id : 'SG-L1-C-R04-S17';
  }
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = el.input.value.trim();
    if (!q) { toast(`Type your seat, e.g. "Gavaskar L1 C row 4 seat 17" or ${example()}.`); return; }
    const seat = data.findSeat(q);
    if (!seat) {
      // Block resolved but row/seat out of range? Re-try with row 1 seat 1 and say what exists.
      const b = data.findSeat(q.replace(/(\d+)(\D*?)(\d+)\s*$/, '1$21'));
      if (b) {
        const inBlock = data.querySeats({ standId: b.standId, level: b.level, block: b.block });
        const nums = (q.match(/\d+/g) || []).map(Number), row = nums[nums.length - 2];
        const rows = Math.max(...inBlock.map((s) => s.row)), inRow = inBlock.filter((s) => s.row === row).length;
        const where = `${standOf(b.standId)?.name ?? b.standId} L${b.level} Block ${b.block}`;
        return toast(inRow ? `${where}, row ${row} has seats 1–${inRow}.` : `${where} has rows 1–${rows}.`, 6500);
      }
    }
    if (!seat) return toast(`Couldn't find "${q}". Try stand, level, block, row and seat — e.g. "Gavaskar L1 C row 4 seat 17" or ${example()}.`, 6500);
    goSeat(seat, { mine: true });
  });
  function setPick(open) {
    el.selWrap.hidden = !open; el.more.setAttribute('aria-expanded', String(open));
    if (open) selStand.focus();
  }
  el.more.addEventListener('click', () => setPick(el.selWrap.hidden));
  document.addEventListener('pointerdown', (e) => { if (!el.selWrap.hidden && !el.search.contains(e.target)) setPick(false); });
  function pickGo() {
    if (!selStand.value) return toast('Pick a stand first.');
    setPick(false);
    if (sels.every((x) => x.value)) {
      const seat = data.querySeats({ standId: selStand.value, level: +selLevel.value, block: selBlock.value, row: +selRow.value }).find((s) => s.number === +selSeat.value);
      if (seat) goSeat(seat, { mine: true });
    } else if (selLevel.value && selBlock.value) {
      st.standId = selStand.value; fly({ blockId: data.blockId(selStand.value, +selLevel.value, selBlock.value) });
    } else { st.standId = selStand.value; fly({ standId: selStand.value }); }
  }
  el.go.addEventListener('click', pickGo);
  const fill = (sel, label, vals, fmt = String) => {
    sel.innerHTML = `<option value="">${esc(label)}</option>` + vals.map((v) => `<option value="${esc(v)}">${esc(fmt(v))}</option>`).join('');
    sel.disabled = !vals.length;
  };
  const uniq = (arr, f) => [...new Set(arr.map(f))].sort((a, b) => (typeof a === 'number' ? a - b : String(a).localeCompare(String(b))));
  fill(selStand, 'Stand', STANDS.map((s) => s.id), (id) => standOf(id).name);
  [selLevel, selBlock, selRow, selSeat].forEach((s, i) => fill(s, ['Level', 'Block', 'Row', 'Seat'][i], []));
  el.selWrap.addEventListener('change', (e) => {
    const i = sels.indexOf(e.target); if (i < 0) return;
    for (let j = i + 1; j < sels.length; j++) fill(sels[j], ['Level', 'Block', 'Row', 'Seat'][j - 1], []);
    if (!sels[i].value) return;
    const q = { standId: selStand.value };
    if (i >= 1) q.level = +selLevel.value;
    if (i >= 2) q.block = selBlock.value;
    if (i >= 3) q.row = +selRow.value;
    if (i === 4) return; // Go button commits
    const pool = data.querySeats(q);
    const nxt = [['Level', (s) => s.level, (l) => 'L' + l], ['Block', (s) => s.block, (b) => 'Block ' + b],
      ['Row', (s) => s.row, (r) => 'Row ' + r], ['Seat', (s) => s.number, (n) => 'Seat ' + n]][i];
    const vals = uniq(pool, nxt[1]);
    fill(sels[i + 1], nxt[0], vals, nxt[2]);
    if (i === 0 && vals.length === 1) { selLevel.value = String(vals[0]); selLevel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  // dock
  el.dOver.addEventListener('click', () => { exitSeat(); closeTicket(); st.standId = null; fly('aerial'); });
  el.dFind.addEventListener('click', () => { setPick(false); el.input.focus(); el.input.select(); });
  el.dPrices.addEventListener('click', () => setPanel(!el.panel.classList.contains('open')));
  el.dHeat.addEventListener('click', () => {
    const on = el.dHeat.getAttribute('aria-pressed') !== 'true';
    el.dHeat.setAttribute('aria-pressed', String(on)); el.body.dataset.heat = on ? '1' : ''; stadium.setHeatmap(on); el.ramp.hidden = !on;
  });
  el.dSeat.hidden = !st.mine;
  el.dSeat.addEventListener('click', () => { const s = seatById.get(st.mine); if (s) goSeat(s); });

  /* ---------- ticket ---------- */
  function renderTicket() {
    const seat = seatById.get(st.open); if (!seat) return;
    const stand = standOf(seat.standId), lbl = levelLabel(seat), isMine = st.mine === seat.id;
    el.ticket.innerHTML = `
      <figure class="view"><div class="skel"></div><img alt="View of the pitch from this seat" hidden></figure>
      <button type="button" class="tk-x" data-act="close" aria-label="Close ticket"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>
      <div class="tk-head"><h2>${esc(stand.name)}</h2><p>${esc(lbl || 'Level ' + seat.level)}${isMine ? ' · Your seat' : ''}</p></div>
      <div class="tk-body">
        <p class="tk-where">Level ${seat.level} · Block ${esc(seat.block)} · Row ${seat.row} · Seat ${seat.number}</p>
        <div class="tk-price"><b>${esc(formatINR(seat.price))}</b><span class="pill ${seat.status}">${seat.status === 'sold' ? 'Sold' : 'Available'}</span></div>
        <div class="tk-act">
          <button type="button" class="btn primary" data-act="sit">Sit here</button>
          <button type="button" class="btn" data-act="mine"${isMine ? ' disabled' : ''}>${isMine ? 'My seat' : 'Save seat'}</button>
          <button type="button" class="btn" data-act="compare">Prices</button>
        </div>
      </div>`;
    if (st.snap?.id === seat.id) {
      const img = $('.view img', el.ticket); img.src = st.snap.url; img.hidden = false; $('.skel', el.ticket)?.remove();
    }
  }
  function openTicket(id) {
    st.open = id; renderTicket(); el.ticket.hidden = false; el.body.dataset.ticket = '1';
    if (innerWidth < 1100) setPanel(false);
    $('.tk-x', el.ticket)?.focus({ preventScroll: true });
    renderCrumb();
    const token = id;
    if (st.snap?.id !== id) st.snap = null;
    requestAnimationFrame(() => setTimeout(() => {
      if (st.open !== token) return;
      const img = $('.view img', el.ticket), sk = $('.skel', el.ticket);
      try { if (st.snap?.id !== id) st.snap = { id, url: stadium.snapshot(id, 480, 270) }; img.src = st.snap.url; img.hidden = false; sk?.remove(); }
      catch { if (sk) sk.style.animation = 'none'; }
    }, 60));
  }
  function closeTicket() { st.open = null; el.ticket.hidden = true; delete el.body.dataset.ticket; stadium.selectSeat(null); renderCrumb(); }
  el.ticket.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
    const id = st.open;
    if (act === 'close') closeTicket();
    else if (act === 'mine') setMine(id);
    else if (act === 'sit') { const seat = seatById.get(id); st.standId = seat.standId; await st.flight; if (st.open === id) stadium.enterSeatView(id); }
    else if (act === 'compare') {
      const seat = seatById.get(id); if (innerWidth < 1100) closeTicket(); setPanel(true);
      const row = el.list.querySelector(`[data-block="${data.blockId(seat.standId, seat.level, seat.block)}"]`);
      if (row) { row.scrollIntoView({ block: 'center' }); setHover(row); }
    }
  });

  /* ---------- price panel ---------- */
  const scale = (p) => ((p - P_MIN) / (P_MAX - P_MIN)) * 100;
  const rows = new Map(), groups = new Map();
  for (const s of STANDS) {
    const g = document.createElement('section');
    g.innerHTML = `<div class="grp-h"><span>${esc(s.name)}</span><small>${esc((s.tags || []).join(' · '))}</small></div>`;
    groups.set(s.id, g); el.list.append(g);
  }
  for (const b of blocks) {
    const r = document.createElement('button');
    r.type = 'button'; r.className = 'blk'; r.dataset.block = b.id;
    const left = scale(b.minPrice), w = Math.max(scale(b.maxPrice) - left, 1);
    r.innerHTML = `<span class="nm">L${b.level} · Block ${esc(b.block)}</span>
      <span class="bar"><i style="left:${left.toFixed(1)}%;width:${w.toFixed(1)}%"></i></span>
      <span class="rng">${esc(formatINR(b.minPrice))} – ${esc(formatINR(b.maxPrice))}</span>
      <span class="meta"><span>${b.available} free</span><span class="delta"></span></span>`;
    rows.set(b.id, r); groups.get(b.standId)?.append(r);
  }
  const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No blocks match these filters.'; empty.hidden = true; el.list.append(empty);

  function updateDeltas() {
    const mine = seatById.get(st.mine);
    for (const b of blocks) {
      const d = rows.get(b.id).querySelector('.delta');
      if (!mine) { d.textContent = ''; continue; }
      const diff = Math.round(((b.minPrice + b.maxPrice) / 2 - mine.price) / 50) * 50;
      d.className = 'delta ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '');
      d.textContent = diff === 0 ? 'same as yours' : `${diff > 0 ? '+' : '−'}${formatINR(Math.abs(diff))} vs yours`;
    }
  }
  const filterActive = () => +el.pmin.value > P_MIN || +el.pmax.value < P_MAX || st.levels.size || el.avail.checked;
  let lastKey;
  function applyFilters() {
    let lo = +el.pmin.value, hi = +el.pmax.value;
    if (lo > hi) { if (document.activeElement === el.pmin) lo = el.pmin.value = hi; else hi = el.pmax.value = lo; }
    el.out.textContent = `${formatINR(lo)} – ${formatINR(hi)}`;
    const dual = el.pmin.parentElement, span = P_MAX - P_MIN || 1;
    dual.style.setProperty('--lo', (((lo - P_MIN) / span) * 100).toFixed(1) + '%'); dual.style.setProperty('--hi', (((hi - P_MIN) / span) * 100).toFixed(1) + '%');
    const match = new Set();
    for (const b of blocks) {
      const ok = b.maxPrice >= lo && b.minPrice <= hi && (!st.levels.size || st.levels.has(b.level)) && (!el.avail.checked || b.available > 0);
      rows.get(b.id).hidden = !ok; if (ok) match.add(b.id);
    }
    const sortKey = el.sort.value, byB = new Map(blocks.map((b) => [b.id, b]));
    const gl = [...groups.entries()].map(([id, g]) => {
      const list = blocks.filter((b) => b.standId === id);
      const key = sortKey === 'price-desc' ? Math.max(...list.map((b) => b.maxPrice)) : Math.min(...list.map((b) => b.minPrice));
      if (sortKey !== 'bearing') list.sort((a, b) => (sortKey === 'price-desc' ? b.maxPrice - a.maxPrice : a.minPrice - b.minPrice));
      list.forEach((b) => g.append(rows.get(b.id)));
      g.hidden = !list.some((b) => match.has(b.id));
      return [g, sortKey === 'price-desc' ? -key : key, STANDS.findIndex((s) => s.id === id)];
    });
    gl.sort((a, b) => (sortKey === 'bearing' ? a[2] - b[2] : a[1] - b[1])).forEach(([g]) => el.list.insertBefore(g, empty));
    empty.hidden = match.size > 0;
    el.count.textContent = `${match.size} / ${blocks.length} blocks`;
    lastMatch = match; syncDim();
    void byB;
  }
  let lastMatch = null;
  function syncDim() {
    const key = el.panel.classList.contains('open') && filterActive() ? [...lastMatch].join('|') : null;
    if (key !== lastKey) { lastKey = key; stadium.setDimmed(key === null ? null : lastMatch); }
  }
  $('.controls').addEventListener('input', () => applyFilters());
  $('.controls').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) {
      const l = +chip.dataset.level, on = !st.levels.has(l);
      on ? st.levels.add(l) : st.levels.delete(l); chip.setAttribute('aria-pressed', String(on)); applyFilters();
    }
    if (e.target.id === 'f-reset') {
      el.pmin.value = P_MIN; el.pmax.value = P_MAX; el.avail.checked = false; st.levels.clear(); el.sort.value = 'bearing';
      el.panel.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false')); applyFilters();
    }
  });
  function setHover(row) {
    if (st.hoverRow) st.hoverRow.classList.remove('on');
    st.hoverRow = row; row?.classList.add('on'); stadium.highlightBlock(row ? row.dataset.block : null);
  }
  el.list.addEventListener('mouseover', (e) => { const r = e.target.closest('.blk'); if (r !== st.hoverRow) setHover(r); });
  el.list.addEventListener('mouseleave', () => setHover(null));
  el.list.addEventListener('focusin', (e) => setHover(e.target.closest('.blk')));
  el.list.addEventListener('click', (e) => {
    const r = e.target.closest('.blk'); if (!r) return;
    const b = blocks.find((x) => x.id === r.dataset.block); st.standId = b.standId;
    fly({ blockId: b.id });
    if (matchMedia('(max-width:760px)').matches) setPanel(false);
  });
  function setPanel(open) {
    const was = el.panel.classList.contains('open');
    if (was === open) return;
    el.panel.classList.toggle('open', open); el.dPrices.setAttribute('aria-pressed', String(open));
    if (open) el.pclose.focus({ preventScroll: true });
    else if (el.panel.contains(document.activeElement)) el.dPrices.focus({ preventScroll: true });
    syncDim();
  }
  el.pclose.addEventListener('click', () => setPanel(false));

  /* ---------- stadium events ---------- */
  stadium.on('hoverBlock', (id, pt) => {
    const b = id && blocks.find((x) => x.id === id);
    if (!b || !pt || st.mode === 'seat') { el.tooltip.hidden = true; return; }
    const lbl = standOf(b.standId)?.levels?.find((l) => l.level === b.level)?.label;
    el.tooltip.innerHTML = `${esc(lbl || b.standName)} · L${b.level} · ${esc(b.block)}<span> · ${esc(formatINR(b.minPrice))} – ${esc(formatINR(b.maxPrice))}</span>`;
    el.tooltip.hidden = false;
    const w = el.tooltip.offsetWidth;
    el.tooltip.style.left = Math.min(pt.x, innerWidth - w - 24) + 'px'; el.tooltip.style.top = pt.y + 'px';
  });
  stadium.on('clickBlock', (id) => { const b = blocks.find((x) => x.id === id); if (b) { st.standId = b.standId; fly({ blockId: id }); renderCrumb(); } });
  stadium.on('clickSeat', (id) => { const s = seatById.get(id); if (s) { st.standId = s.standId; openTicket(id); stadium.selectSeat(id); } });
  let hintTimer;
  stadium.on('mode', (m) => {
    const was = st.mode; st.mode = m; el.body.dataset.mode = m;
    el.tooltip.hidden = true;
    clearTimeout(hintTimer);
    if (m === 'seat') {
      setPanel(false); setPick(false);
      el.hudText.classList.remove('gone'); el.hud.hidden = false; el.ticket.hidden = true;
      hintTimer = setTimeout(() => el.hudText.classList.add('gone'), 3000);
      $('#hud-exit')?.focus({ preventScroll: true });
    } else {
      el.hud.hidden = true;
      if (was === 'seat' && st.open) { el.ticket.hidden = false; $('[data-act="sit"]', el.ticket)?.focus({ preventScroll: true }); }
    }
    if (m === 'aerial') st.standId = null;
    renderCrumb(); firstFrame();
  });
  el.hud.addEventListener('click', (e) => { if (e.target.closest('#hud-exit')) exitSeat(); });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (st.mode === 'seat') exitSeat();
    else if (!el.selWrap.hidden) { setPick(false); el.more.focus({ preventScroll: true }); }
    else if (el.panel.classList.contains('open')) setPanel(false);
    else if (st.open) closeTicket();
  });

  /* ---------- loading ---------- */
  let loaded = false;
  function firstFrame() { if (loaded) return; loaded = true; el.loading.classList.add('done'); setTimeout(() => el.body.classList.add('chrome'), 600); setTimeout(() => (el.loading.hidden = true), 600); }
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(firstFrame, 400)));

  applyFilters(); updateDeltas(); renderCrumb();
  return { toast, goSeat };
}
