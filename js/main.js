import * as data from './data.js'; import { createStadium } from './stadium.js'; import { createUI } from './ui.js';
try {
  const { seats } = data.buildSeats();
  const stadium = createStadium(document.getElementById('scene'), { seats, blocks: data.getBlocks(), stands: data.STANDS });
  createUI({ data, stadium });
} catch (err) {
  console.error(err);
  const t = document.getElementById('toast');
  if (t) { t.textContent = 'Could not start the 3D view: ' + (err && err.message ? err.message : err) + '. Check that WebGL is enabled.'; t.hidden = false; t.classList.add('show', 'error'); }
  document.getElementById('loading')?.setAttribute('hidden', '');
}
