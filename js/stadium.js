// Wankhede 3D scene: night-match bowl, city, sea, camera director, picking, heatmap. Contract: ARCHITECTURE.md
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GEOMETRY, blockId, seatViewpoint } from './data.js';

const ACCENT = new THREE.Color('#F5F5F7'); // monochrome highlight
const SOLD = new THREE.Color('#3b4458');
const HEAT = ['#1E2A40', '#6F7F99', '#F2F1EC'].map((c) => new THREE.Color(c));
const REC = /[?&]rec\b/.test(location.search); // video capture: fixed quality, projection hook
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const bearingOf = (x, z) => ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
const canvasTex = (w, h, draw, srgb = true) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
};

// ---------- textures ----------
function stripeTexture(o) {
  return canvasTex(1024, 1024, (g, w, h) => {
    const n = 12, r = rng(3);
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#3b6f37' : '#34652f'; g.fillRect((i * w) / n, 0, w / n + 1, h); }
    const img = g.getImageData(0, 0, w, h), d = img.data; // grass grain so the turf doesn't read as flat plastic
    for (let k = 0; k < d.length; k += 4) { const v = (r() - 0.5) * 18; d[k] += v * 0.6; d[k + 1] += v; d[k + 2] += v * 0.4; }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3; g.setLineDash([14, 10]);
    g.beginPath(); g.ellipse(w / 2, h / 2, (27.43 / o.rx) * (w / 2), (27.43 / o.rz) * (h / 2), 0, 0, Math.PI * 2); g.stroke();
  });
}
const glowTexture = () => canvasTex(128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,240,210,.55)'); gr.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
function windowsTexture() {
  const r = rng(7);
  const t = canvasTex(160, 128, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 4; y++) {
      if (r() > 0.45) continue;
      g.fillStyle = r() > 0.25 ? '#ffd48a' : '#bcd6ff'; g.globalAlpha = 0.5 + r() * 0.5;
      g.fillRect(x * 32 + 6, y * 32 + 7, 20, 17);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const ledTexture = () => canvasTex(512, 32, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, '#0b2a8f'); gr.addColorStop(0.45, '#1d5bff'); gr.addColorStop(0.55, '#d9dde6'); gr.addColorStop(1, '#0b2a8f');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 8; i++) g.fillRect(i * 64 + 22, 9, 20, 14);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
});

// ---------- environment ----------
function makeSky() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 vD;
      float hash(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }
      void main(){
        float h=clamp(vD.y,0.,1.);
        vec3 col=mix(vec3(.10,.12,.24),vec3(.018,.04,.11),smoothstep(0.,.2,h));
        col=mix(col,vec3(.004,.009,.03),smoothstep(.12,.75,h));
        float w=max(dot(normalize(vec3(vD.x,0.,vD.z)+1e-4),vec3(-1.,0.,0.)),0.);
        col+=vec3(.34,.13,.07)*pow(w,3.)*exp(-h*10.)*.85;
        float s=step(.9972,hash(floor(vD*260.)))*smoothstep(.12,.4,h);
        col+=vec3(.8,.85,1.)*s*.6;
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), m); mesh.renderOrder = -10; mesh.frustumCulled = false; return mesh;
}
function makeSea(cx, R) {
  const m = new THREE.ShaderMaterial({
    fog: true, transparent: false,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uShore: { value: cx + R } }]),
    vertexShader: `varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vec4 mvPosition=viewMatrix*w; gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform float uShore; varying vec3 vW;
      #include <fog_pars_fragment>
      void main(){
        float d=clamp((uShore-vW.x)/700.,0.,1.);
        vec3 col=mix(vec3(.012,.03,.06),vec3(.006,.014,.032),d);
        float a=sin(vW.x*.09+uTime*.8+sin(vW.z*.05))*sin(vW.z*.11-uTime*.6);
        float b=sin(vW.x*.31-uTime*1.3)*sin(vW.z*.27+uTime*1.1);
        float sp=smoothstep(.55,1.,a*.6+b*.5);
        col+=vec3(1.,.62,.28)*sp*exp(-d*5.)*.55+vec3(.1,.18,.34)*sp*.12;
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2), m);
  mesh.position.set(cx, 0.4, 0); return mesh;
}
function makeNecklace(cx, R) {
  const pts = [];
  for (let a = -0.95; a <= 0.95; a += 0.0065) pts.push(cx + R * Math.cos(a), 3.5, R * Math.sin(a));
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const m = new THREE.PointsMaterial({ size: 9, map: glowTexture(), color: 0xffc27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  return new THREE.Points(g, m);
}
// ---------- surroundings: street grid, plaza, traffic, trains, avenue trees ----------
// World: sea to the west (circle cx,R), Churchgate railway east at x = rail, stadium plaza ellipse (px,pz) around the bowl.
function makeSurroundings({ cx, R, rail, px, pz, tex, glow }) {
  const r = rng(21), S = 2600, W = 2048, k = W / S, G = 132, RW = 16, half = S / 2;
  const land = (x, z) => Math.hypot(x - cx, z) > R + 34;
  const inPlaza = (x, z, pad = 0) => (x / (px + pad)) ** 2 + (z / (pz + pad)) ** 2 < 1;
  const nearRail = (x, pad) => Math.abs(x - rail) < pad;
  const roads = []; for (let n = -10; n <= 10; n++) roads.push(n * G + 21);
  const lights = [];
  for (const X of roads) for (let z = -half; z < half; z += 34) for (const sd of [-1, 1]) { const x = X + sd * 9.5; if (land(x, z) && !inPlaza(x, z, 6) && !nearRail(x, 16)) lights.push(x, z); }
  for (const Z of roads) for (let x = -half; x < half; x += 34) for (const sd of [-1, 1]) { const z = Z + sd * 9.5; if (land(x, z) && !inPlaza(x, z, 6) && !nearRail(x, 16)) lights.push(x, z); }

  // ground map: everything flat is painted once into one texture (roads, lane marks, plaza, parking, rail bed, light pools)
  const map = canvasTex(W, W, (g) => {
    const U = (x) => (x + half) * k, V = (z) => (z + half) * k;
    g.fillStyle = '#101215'; g.fillRect(0, 0, W, W);
    for (let n = 0; n < 26000; n++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + r() * 0.035})`; g.fillRect(r() * W, r() * W, 1 + r() * 3, 1 + r() * 3); }
    g.fillStyle = '#18191c';
    for (const X of roads) g.fillRect(U(X - RW / 2), 0, RW * k, W);
    for (const Z of roads) g.fillRect(0, V(Z - RW / 2), W, RW * k);
    g.strokeStyle = 'rgba(200,196,180,.32)'; g.lineWidth = 1; g.setLineDash([5, 6]);
    for (const X of roads) { g.beginPath(); g.moveTo(U(X), 0); g.lineTo(U(X), W); g.stroke(); }
    for (const Z of roads) { g.beginPath(); g.moveTo(0, V(Z)); g.lineTo(W, V(Z)); g.stroke(); }
    g.setLineDash([]);
    // Marine Drive: promenade + six-lane road along the bay
    g.lineWidth = 8 * k; g.strokeStyle = '#2a2a2b'; g.beginPath(); g.arc(U(cx), V(0), (R + 6) * k, -1.2, 1.2); g.stroke();
    g.lineWidth = 20 * k; g.strokeStyle = '#1b1c1f'; g.beginPath(); g.arc(U(cx), V(0), (R + 20) * k, -1.2, 1.2); g.stroke();
    g.lineWidth = 1; g.strokeStyle = 'rgba(220,215,200,.4)'; g.setLineDash([6, 6]); g.beginPath(); g.arc(U(cx), V(0), (R + 20) * k, -1.2, 1.2); g.stroke(); g.setLineDash([]);
    // stadium precinct: concrete plaza with radial paving joints
    g.fillStyle = '#25272b'; g.beginPath(); g.ellipse(U(0), V(0), px * k, pz * k, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 48) { g.beginPath(); g.moveTo(U(Math.sin(a) * px * 0.7), V(-Math.cos(a) * pz * 0.7)); g.lineTo(U(Math.sin(a) * px), V(-Math.cos(a) * pz)); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.ellipse(U(0), V(0), px * k, pz * k, 0, 0, Math.PI * 2); g.stroke();
    // parking between the stadium and Marine Drive
    const cars = ['#2b2f36', '#4a4e55', '#6b6f75', '#1d2a3a', '#5a2a2a', '#c9c9c4', '#8a8d91'];
    for (let z = -95; z < 95; z += 5.5) for (let x = -(px + 70); x < -(px + 14); x += 2.6) {
      if (Math.abs(z) % 33 < 6) continue; g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(U(x), V(z), 0.15 * k + 0.5, 5 * k);
      if (r() < 0.72) { g.fillStyle = cars[(r() * cars.length) | 0]; g.fillRect(U(x + 0.4), V(z + 0.5), 1.8 * k, 4.3 * k); }
    }
    // Western Railway corridor: ballast + two tracks
    g.fillStyle = '#1a1814'; g.fillRect(U(rail - 13), 0, 26 * k, W);
    g.strokeStyle = 'rgba(150,150,150,.5)'; for (const dx of [-5.8, -4.2, 4.2, 5.8]) { g.beginPath(); g.moveTo(U(rail + dx), 0); g.lineTo(U(rail + dx), W); g.stroke(); }
    // sodium light pools
    g.globalCompositeOperation = 'lighter';
    for (let n = 0; n < lights.length; n += 2) {
      const x = U(lights[n]), y = V(lights[n + 1]), gr = g.createRadialGradient(x, y, 0, x, y, 11 * k);
      gr.addColorStop(0, 'rgba(255,170,90,.2)'); gr.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = gr; g.fillRect(x - 11 * k, y - 11 * k, 22 * k, 22 * k);
    }
    g.globalCompositeOperation = 'source-over';
  });
  map.anisotropy = 16;
  const grp = new THREE.Group(), up = [];
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map, roughness: 0.92 }));
  ground.position.y = -0.02; ground.receiveShadow = true; grp.add(ground);

  // street lights: glow heads
  const lp = []; for (let n = 0; n < lights.length; n += 2) lp.push(lights[n], 8, lights[n + 1]);
  grp.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)),
    new THREE.PointsMaterial({ size: 4.5, map: glow, color: 0xffb070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));

  // city blocks: 2x2 lots per block, low-rise near the ground, a few towers, water tanks on roofs
  const items = [];
  for (let a = 0; a < roads.length - 1; a++) for (let b = 0; b < roads.length - 1; b++) {
    const x0 = roads[a] + RW / 2 + 4, z0 = roads[b] + RW / 2 + 4, bs = G - RW - 8;
    for (const [lx, lz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      if (r() < 0.12) continue;
      const w = bs / 2 - 3 - r() * 12, d = bs / 2 - 3 - r() * 12, x = x0 + lx * bs / 2 + bs / 4, z = z0 + lz * bs / 2 + bs / 4, dist = Math.hypot(x, z);
      if (!land(x, z) || Math.hypot(x - cx, z) < R + 52 || inPlaza(x, z, 22) || nearRail(x, 24) || dist > 1250) continue;
      const tower = r() < 0.07 && dist > 420, h = tower ? 55 + r() * 70 : 9 + Math.pow(r(), 1.8) * 26 * (0.6 + dist / 1400);
      items.push({ x, z, w, d, h });
    }
  }
  const bmat = new THREE.MeshStandardMaterial({ roughness: 0.85, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.75 });
  bmat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_EMISSIVEMAP
      vEmissiveMapUv *= vec2(max(length(instanceMatrix[0].xyz),length(instanceMatrix[2].xyz))/10., length(instanceMatrix[1].xyz)/12.);
      #endif`);
  };
  const bgeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // roof face keeps the window map off: tex is black at uv origin rows
  const city = new THREE.InstancedMesh(bgeo, bmat, items.length), tanks = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.4, 1.4, 2.4, 8).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.8 }), items.length);
  const facade = ['#2a2d33', '#33302b', '#2b2f2c', '#3a3a3c', '#24262b', '#3b342c'].map((c) => new THREE.Color(c));
  const o = new THREE.Object3D(); let nt = 0;
  items.forEach((it, n) => {
    o.position.set(it.x, 0, it.z); o.rotation.set(0, 0, 0); o.scale.set(it.w, it.h, it.d); o.updateMatrix(); city.setMatrixAt(n, o.matrix); city.setColorAt(n, facade[(r() * facade.length) | 0]);
    if (r() < 0.45) { o.position.set(it.x + (r() - 0.5) * it.w * 0.5, it.h, it.z + (r() - 0.5) * it.d * 0.5); o.scale.setScalar(0.8 + r() * 0.6); o.updateMatrix(); tanks.setMatrixAt(nt++, o.matrix); }
  });
  tanks.count = nt; grp.add(city, tanks);

  // avenue trees along streets + a ring of rain trees in the plaza
  const tp = [];
  for (const X of roads) for (let z = -half; z < half; z += 15) for (const sd of [-1, 1]) { const x = X + sd * 12; if (r() < 0.42 && land(x, z) && !inPlaza(x, z, 8) && !nearRail(x, 18) && Math.hypot(x, z) < 1000) tp.push(x, z); }
  for (let a = 0; a < Math.PI * 2; a += 0.05) if (r() < 0.75) { const f = 0.93 + r() * 0.04, x = Math.sin(a) * px * f, z = -Math.cos(a) * pz * f; if (!nearRail(x, 18) && land(x, z)) tp.push(x, z); }
  const NT = tp.length / 2;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.4, 4, 5).translate(0, 2, 0), new THREE.MeshStandardMaterial({ color: 0x2a2219, roughness: 1 }), NT);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.2, 1).scale(1, 0.75, 1).translate(0, 5.6, 0), new THREE.MeshStandardMaterial({ color: 0x15261a, roughness: 1 }), NT);
  const leaf = ['#132318', '#182b1c', '#1d3020', '#10200f'].map((c) => new THREE.Color(c));
  for (let n = 0; n < NT; n++) {
    o.position.set(tp[2 * n], 0, tp[2 * n + 1]); o.rotation.set(0, r() * 6, 0); o.scale.setScalar(0.7 + r() * 0.7); o.updateMatrix(); trunks.setMatrixAt(n, o.matrix);
    o.scale.multiply(new THREE.Vector3(0.8 + r() * 0.5, 0.8 + r() * 0.4, 0.8 + r() * 0.5)); o.updateMatrix(); crowns.setMatrixAt(n, o.matrix); crowns.setColorAt(n, leaf[n % 4]);
  }
  grp.add(trunks, crowns);

  // traffic: head/tail light streams on the grid and Marine Drive
  const NC = 420, cars = [];
  for (let n = 0; n < NC; n++) {
    const kind = r() < 0.3 ? 'md' : r() < 0.5 ? 'x' : 'z', dir = r() < 0.5 ? 1 : -1;
    cars.push({ kind, dir, line: roads[(r() * roads.length) | 0], lane: dir * (2.2 + r() * 3.5), s: r(), v: (9 + r() * 8) / (kind === 'md' ? (R + 20) * 2.4 : S) });
  }
  const cpos = new Float32Array(NC * 3), ccol = new Float32Array(NC * 3);
  cars.forEach((c, n) => { const head = c.dir > 0; ccol.set(head ? [1, 0.95, 0.85] : [1, 0.12, 0.08], n * 3); });
  const cgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(cpos, 3)).setAttribute('color', new THREE.BufferAttribute(ccol, 3));
  grp.add(new THREE.Points(cgeo, new THREE.PointsMaterial({ size: 3.2, map: glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  up.push((t) => {
    cars.forEach((c, n) => {
      const u = (((c.s + c.v * t * c.dir) % 1) + 1) % 1; let x, z;
      if (c.kind === 'md') { const a = -1.15 + u * 2.3, rr = R + 20 + c.lane; x = cx + rr * Math.cos(a); z = rr * Math.sin(a); }
      else if (c.kind === 'x') { x = c.line + c.lane; z = -half + u * S; } else { z = c.line + c.lane; x = -half + u * S; }
      const ok = c.kind === 'md' || (land(x, z) && !inPlaza(x, z, 4) && !(c.kind === 'z' && nearRail(x, 14)));
      cpos[n * 3] = x; cpos[n * 3 + 1] = ok ? 1.1 : -50; cpos[n * 3 + 2] = z;
    });
    cgeo.attributes.position.needsUpdate = true;
  });

  // Mumbai locals on the Western line: lit carriages running both ways
  const wtex = canvasTex(256, 32, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffe6b8'; for (let i = 0; i < 10; i++) g.fillRect(8 + i * 25, 10, 15, 10); });
  const tmat = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.6, metalness: 0.3, emissive: 0xffffff, emissiveMap: wtex, emissiveIntensity: 1.1 });
  const carGeo = new THREE.BoxGeometry(3.6, 3.9, 20).translate(0, 2.2, 0);
  const trains = [-5, 5].map((dx, ti) => {
    const tr = new THREE.Group(); for (let n = 0; n < 12; n++) { const m = new THREE.Mesh(carGeo, tmat); m.position.z = n * 20.6; tr.add(m); }
    tr.position.x = rail + dx; grp.add(tr); return { tr, dir: ti ? -1 : 1, off: ti * 0.47 };
  });
  up.push((t) => trains.forEach(({ tr, dir, off }) => { const u = ((t / 70 + off) % 1); tr.position.z = dir > 0 ? -half + u * (S + 260) - 260 : half - u * (S + 260); }));
  return { group: grp, update: (t) => up.forEach((f) => f(t)) };
}

// Stadium exterior: concrete fins around the bowl and two warm concourse light bands.
function makeFacade(bx, bz, topY) {
  const grp = new THREE.Group(), N = 230, H = topY + 2;
  const fins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1, 1.6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.85 }), N);
  const o = new THREE.Object3D();
  for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; o.position.set(bx * Math.sin(a), 0, -bz * Math.cos(a)); o.rotation.set(0, Math.atan2(Math.sin(a) / bx, -Math.cos(a) / bz), 0); o.scale.set(1, H, 1); o.updateMatrix(); fins.setMatrixAt(i, o.matrix); }
  fins.castShadow = true; grp.add(fins);
  const band = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.25, 0.95), toneMapped: true });
  for (const y of [5.5, H * 0.55]) grp.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ellipsePts(bx - 0.9, bz - 0.9, 160, y), true), 320, 0.12, 4, true), band));
  return grp;
}

// Players' tunnel under the Garware Pavilion (north), opening onto the field at the L1 fascia.
const TUNNEL = { x: 12, w: 4.4, h: 3.4, z0: -100, z1: -78.2 }; // beside the sightscreen, not behind it
const inTunnel = (x, y, z) => Math.abs(x - TUNNEL.x) < TUNNEL.w / 2 + 0.25 && z < TUNNEL.z1 + 0.4 && z > TUNNEL.z0 && y < TUNNEL.h + 0.35;
function makeTunnel() {
  const { x, w, h, z0, z1 } = TUNNEL, L = z1 - z0, g = new THREE.Group();
  const rep = (t, u, v) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(u, v); return t; };
  // walls: navy panels, dark dado, seams, a lit LED line, the ground's name in raised letters
  const wallDraw = (lit) => (q, W, H) => {
    q.fillStyle = lit ? '#000' : '#151a26'; q.fillRect(0, 0, W, H);
    if (!lit) { q.fillStyle = '#0d0f14'; q.fillRect(0, H * 0.72, W, H * 0.28); q.fillStyle = 'rgba(255,255,255,.07)'; for (let i = 0; i <= 4; i++) q.fillRect((i * W) / 4, 0, 2, H * 0.72); q.fillStyle = 'rgba(255,255,255,.13)'; q.font = '600 46px Inter, Arial, sans-serif'; q.textAlign = 'center'; q.fillText('WANKHEDE', W / 2, H * 0.5); }
    q.fillStyle = lit ? '#cfe0ff' : '#3a4152'; q.fillRect(0, H * 0.24, W, 5); q.fillRect(0, H * 0.72 - 3, W, 3);
  };
  const wallMap = rep(canvasTex(512, 256, wallDraw(false)), -L / 6, 1) /* BackSide faces mirror u; flip so the lettering reads correctly */, wallEm = rep(canvasTex(512, 256, wallDraw(true), false), L / 6, 1);
  const ceilDraw = (lit) => (q, W, H) => { q.fillStyle = lit ? '#000' : '#1a1d22'; q.fillRect(0, 0, W, H); q.fillStyle = lit ? '#fff' : '#d8d8d8'; q.fillRect(W * 0.3, H * 0.42, W * 0.4, H * 0.16); if (!lit) { q.fillStyle = 'rgba(0,0,0,.4)'; q.fillRect(0, 0, W, 3); } };
  const ceilMap = rep(canvasTex(128, 128, ceilDraw(false)), 1, L / 3), ceilEm = rep(canvasTex(128, 128, ceilDraw(true), false), 1, L / 3);
  const floorMap = rep(canvasTex(128, 256, (q, W, H) => { q.fillStyle = '#1d4a30'; q.fillRect(0, 0, W, H); q.fillStyle = '#163a26'; q.fillRect(0, 0, W * 0.12, H); q.fillRect(W * 0.88, 0, W * 0.12, H); q.fillStyle = 'rgba(255,255,255,.55)'; q.fillRect(W * 0.12, 0, 3, H); q.fillRect(W * 0.88 - 3, 0, 3, H); }), 1, L / 4);
  const wall = new THREE.MeshStandardMaterial({ map: wallMap, emissive: 0xffffff, emissiveMap: wallEm, emissiveIntensity: 1.6, roughness: 0.55, metalness: 0.2, side: THREE.BackSide });
  const ceil = new THREE.MeshStandardMaterial({ map: ceilMap, emissive: 0xffffff, emissiveMap: ceilEm, emissiveIntensity: 3.2, roughness: 0.8, side: THREE.BackSide });
  const floor = new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.95, side: THREE.BackSide, emissive: 0x060a07 });
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, L), [wall, wall, ceil, floor, hidden, wall]); // +z face open to the field
  box.position.set(x, h / 2 + 0.02, (z0 + z1) / 2); g.add(box);
  // portal: dark steel surround with a light line, so the mouth reads from the field
  const steel = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.6 });
  for (const [bw, bh, px, py] of [[w + 1, 0.6, 0, h + 0.3], [0.5, h + 0.6, -w / 2 - 0.25, h / 2], [0.5, h + 0.6, w / 2 + 0.25, h / 2]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.5), steel); m.position.set(x + px, py, z1 + 0.15); g.add(m); }
  const line = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.6), toneMapped: false }));
  line.position.set(x, h + 0.05, z1 + 0.42); g.add(line);
  return g;
}

// ---------- field ----------
const ellipsePts = (rx, rz, n, y = 0) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return new THREE.Vector3(rx * Math.sin(a), y, -rz * Math.cos(a)); });
function makeField() {
  const { outfield: o, boundary: b, standInner: si } = GEOMETRY, g = new THREE.Group();
  // apron is a ring around the grass, never underneath it: overlapping coplanar discs z-fight into black streaks
  const apron = new THREE.Mesh(new THREE.RingGeometry(0.999, (si.rx + 1) / o.rx, 128, 1).rotateX(-Math.PI / 2).scale(o.rx, 1, o.rz), new THREE.MeshStandardMaterial({ color: 0x24352a, roughness: 1 }));
  apron.position.y = 0.02; apron.receiveShadow = true; g.add(apron);
  const grass = new THREE.Mesh(new THREE.CircleGeometry(1, 128).rotateX(-Math.PI / 2).scale(o.rx, 1, o.rz), new THREE.MeshStandardMaterial({ map: stripeTexture(o), roughness: 0.9 }));
  grass.position.y = 0.02; grass.receiveShadow = true; g.add(grass);
  const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ellipsePts(b.rx, b.rz, 160, 0.1), true), 320, 0.09, 6, true), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x666666, roughness: 0.6 }));
  g.add(rope);
  g.add(makeBoards(b));
  const pitch = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.06, 20.12 + 2.4), new THREE.MeshStandardMaterial({ color: 0xb59462, roughness: 0.95 }));
  pitch.position.y = 0.05; pitch.receiveShadow = true; g.add(pitch);
  const line = new THREE.MeshBasicMaterial({ color: 0xf4f1e8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), stump = new THREE.MeshStandardMaterial({ color: 0xe9d9a8, emissive: 0x3a3320 });
  const bar = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, d), line); m.position.set(x, 0.085, z); g.add(m); };
  for (const s of [-1, 1]) {
    const zb = s * 10.06, zp = s * (10.06 - 1.22);
    bar(2.64, 0.05, 0, zb); bar(3.4, 0.05, 0, zp); bar(0.05, 2.4, -1.32, zb + s * 1.2); bar(0.05, 2.4, 1.32, zb + s * 1.2);
    for (const x of [-0.1143, 0, 0.1143]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.71, 6), stump); st.position.set(x, 0.4, zb); st.castShadow = true; g.add(st);
    }
    const sc = new THREE.Group(); // sightscreen
    const panel = new THREE.Mesh(new THREE.BoxGeometry(15, 7, 0.4), new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.85 }));
    panel.position.y = 4.6; panel.castShadow = true;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(15.6, 7.6, 0.3), new THREE.MeshStandardMaterial({ color: 0x3a3e46, roughness: 0.8, metalness: 0.3 })); // IPL night: black face, steel back frame.position.set(0, 4.6, -s * 0.2);
    sc.add(frame, panel); sc.position.set(0, 0, s * (b.rz + (si.rz - b.rz) * 0.55)); if (s > 0) sc.rotation.y = Math.PI; g.add(sc);
  }
  return g;
}
function makeBoards(b) {
  const N = 200, pos = [], uv = [], idx = [], rx = b.rx + 1.3, rz = b.rz + 1.3;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, x = rx * Math.sin(a), z = -rz * Math.cos(a);
    pos.push(x, 0.02, z, x, 0.95, z); uv.push((i / N) * 10, 0, (i / N) * 10, 1);
    if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const t = ledTexture(); t.wrapS = THREE.RepeatWrapping;
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.3, 1.3, 1.3) }));
}

// ---------- bowl ----------
// Moulded bucket seat: side profile (x = forward toward the pitch, y = up) extruded across the seat width, on a stem.
function seatGeometry() {
  const p = new THREE.Shape();
  p.moveTo(0.22, -0.03); p.quadraticCurveTo(0.26, 0.01, 0.21, 0.045); p.lineTo(-0.12, 0.03);
  p.quadraticCurveTo(-0.2, 0.03, -0.215, 0.11); p.lineTo(-0.245, 0.43); p.quadraticCurveTo(-0.265, 0.475, -0.3, 0.44);
  p.lineTo(-0.275, 0.09); p.quadraticCurveTo(-0.255, -0.03, -0.15, -0.035); p.lineTo(0.22, -0.03);
  const shell = new THREE.ExtrudeGeometry(p, { depth: 0.42, bevelEnabled: false, curveSegments: 2 })
    .rotateY(-Math.PI / 2).translate(0.21, 0, 0);
  const stem = new THREE.CylinderGeometry(0.035, 0.05, 0.19, 5, 1, true).translate(0, -0.12, -0.06);
  for (const g of [shell, stem]) { g.deleteAttribute('uv'); }
  return mergeGeometries([shell.toNonIndexed(), stem.toNonIndexed()]);
}
// Far LOD for the overview: pan + back, 4 quads. Seats are a few pixels there, so the detail only costs vertices.
function seatGeometryLo() {
  const pan = new THREE.BoxGeometry(0.44, 0.06, 0.42, 1, 1, 1).translate(0, 0, 0.01);
  const back = new THREE.BoxGeometry(0.44, 0.4, 0.05).rotateX(-0.12).translate(0, 0.24, -0.24);
  for (const g of [pan, back]) g.deleteAttribute('uv');
  return mergeGeometries([pan.toNonIndexed(), back.toNonIndexed()]);
}
// Stepped terrace for one block: top + riser per row segment, back wall on last row.
function terraceGeometry(rows) {
  const P = [], C = [], depth = GEOMETRY.rowDepth, nrmRx = GEOMETRY.standInner.rx ** 2, nrmRz = GEOMETRY.standInner.rz ** 2;
  const maxRow = Math.max(...rows.keys()), minRow = Math.min(...rows.keys());
  let col = [0, 0, 0];
  const TREAD = [0.5, 0.51, 0.53], NOSE = [0.66, 0.64, 0.58], RISER = [0.27, 0.28, 0.3], WALL = [0.11, 0.115, 0.13], FASCIA = [0.13, 0.135, 0.15];
  const tri = (a, b, c) => { P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); C.push(...col, ...col, ...col); };
  const quad = (a, b, c, d, k) => { if (inTunnel((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2)) return; col = k; tri(a, b, c); tri(a, c, d); };
  for (const [row, list] of rows) {
    const c0 = list.reduce((s, q) => s + bearingOf(q.pos.x, q.pos.z), 0) / list.length;
    const ang = (q) => ((bearingOf(q.pos.x, q.pos.z) - c0 + 540) % 360) - 180;
    const s = list.slice().sort((a, b) => ang(a) - ang(b)).map((q) => q.pos);
    if (s.length < 2) continue;
    const ext = (a, b) => ({ x: a.x + (a.x - b.x) * 0.5, y: a.y, z: a.z + (a.z - b.z) * 0.5 });
    s.unshift(ext(s[0], s[1])); s.push(ext(s[s.length - 1], s[s.length - 2]));
    const fr = [], bk = [], gr = [], gb = [], nose = [];
    for (const p of s) {
      let nx = p.x / nrmRx, nz = p.z / nrmRz; const l = Math.hypot(nx, nz); nx /= l; nz /= l;
      const y = p.y - 0.2, yLow = row === minRow ? 0 : y - GEOMETRY.rowRise - 0.05;
      const f = (k, yy) => new THREE.Vector3(p.x + nx * depth * k, yy, p.z + nz * depth * k);
      fr.push(f(-0.5, y)); bk.push(f(0.5, y)); gr.push(f(-0.5, yLow)); gb.push(f(0.5, 0)); nose.push(f(-0.42, y));
    }
    for (let i = 0; i < s.length - 1; i++) {
      quad(fr[i], fr[i + 1], nose[i + 1], nose[i], NOSE);
      quad(nose[i], nose[i + 1], bk[i + 1], bk[i], TREAD);
      quad(fr[i], gr[i], gr[i + 1], fr[i + 1], row === minRow ? FASCIA : RISER);
      if (row === maxRow) quad(bk[i], bk[i + 1], gb[i + 1], gb[i], WALL);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
// Continuous elliptical tensile canopy over the whole bowl: back edge just outside the outermost seats, front edge a fixed depth in.
function makeRoof(seats) {
  const { rx, rz } = GEOMETRY.standInner;
  let e = 0, top = 0;
  for (const s of seats) { e = Math.max(e, Math.hypot(s.pos.x / rx, s.pos.z / rz)); top = Math.max(top, s.pos.y); }
  const bx = rx * e + 3, bz = rz * e + 3, depth = 24, Y = top + 5;
  const NB = 96, R = 8, pos = [], idx = [], masts = [], cables = [];
  for (let i = 0; i < NB; i++) {
    const th = (i / NB) * Math.PI * 2, sx = Math.sin(th), cz = -Math.cos(th);
    const back = new THREE.Vector3(bx * sx, 0, bz * cz), n = new THREE.Vector3(sx / bx, 0, cz / bz).normalize(); // outward normal
    const peak = Math.abs(Math.cos(((i % 4) / 4) * Math.PI)); // 1 at a mast, sags between masts
    const yB = Y + 3 + peak * 3.5, yF = Y + 1.5 + peak * 1.5;
    for (let k = 0; k < R; k++) { const t = k / (R - 1), p = back.clone().addScaledVector(n, -depth * t); pos.push(p.x, yB + (yF - yB) * t - Math.sin(t * Math.PI) * (1 - peak) * 1.6, p.z); }
    if (i % 4 === 0) {
      const foot = back.clone().addScaledVector(n, 1), headP = back.clone().addScaledVector(n, 0.5).setY(yB + 9), front = back.clone().addScaledVector(n, -depth).setY(yF + 0.2);
      masts.push(foot, headP); cables.push(headP, front);
    }
  }
  for (let i = 0; i < NB; i++) { const j = (i + 1) % NB; for (let k = 0; k < R - 1; k++) { const a = i * R + k, b = j * R + k; idx.push(a, b, a + 1, b, b + 1, a + 1); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xdcdcd6, emissive: 0x1a1a20, roughness: 0.95, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })));
  const mm = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.5, metalness: 0.4 });
  for (let i = 0; i < masts.length; i += 2) {
    const a = masts[i], b = masts[i + 1], len = a.distanceTo(b), m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, len, 6), mm);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); grp.add(m);
  }
  grp.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cables), new THREE.LineBasicMaterial({ color: 0xcfd6e0, transparent: true, opacity: 0.6 })));
  return grp;
}
// Floodlight masts: tapered steel lattice, a tilted head of 8x5 lamp housings, a catwalk.
function strut(a, b, r) { const d = b.clone().sub(a), g = new THREE.CylinderGeometry(r, r, d.length(), 4, 1, true); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); }
function makeTowers(ext, topY, glow) {
  const g = new THREE.Group(), h = topY + 34, dist = ext + 16, V = (x, y, z) => new THREE.Vector3(x, y, z);
  const corner = (y, sx, sz) => { const w = 1.7 - (y / h) * 1.05; return V(sx * w, y, sz * w); };
  const parts = [], C = [[-1, -1], [1, -1], [1, 1], [-1, 1]], step = 4.2;
  for (const [sx, sz] of C) parts.push(strut(corner(0, sx, sz), corner(h, sx, sz), 0.16));
  for (let y = 0; y < h - 0.1; y += step) for (let c = 0; c < 4; c++) {
    const [ax, az] = C[c], [bx, bz] = C[(c + 1) % 4], y2 = Math.min(h, y + step);
    parts.push(strut(corner(y, ax, az), corner(y2, bx, bz), 0.05), strut(corner(y, bx, bz), corner(y2, ax, az), 0.05), strut(corner(y2, ax, az), corner(y2, bx, bz), 0.06));
  }
  const mastGeo = mergeGeometries(parts.map((q) => q.toNonIndexed()));
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.45, metalness: 0.6 });
  // head: frame + housings (dark) + lenses (emissive), built once and shared
  const hous = [], lens = [], NX = 8, NY = 5, P = 1.45;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    const x = (i - (NX - 1) / 2) * P, y = (j - (NY - 1) / 2) * P;
    hous.push(new THREE.CylinderGeometry(0.62, 0.5, 0.8, 10, 1).rotateX(Math.PI / 2).translate(x, y, 0.1).toNonIndexed());
    lens.push(new THREE.CircleGeometry(0.52, 12).translate(x, y, 0.51).toNonIndexed());
  }
  const frame = [new THREE.BoxGeometry(NX * P + 0.8, 0.25, 0.3).translate(0, (NY * P) / 2 + 0.1, -0.3), new THREE.BoxGeometry(NX * P + 0.8, 0.25, 0.3).translate(0, -(NY * P) / 2 - 0.1, -0.3), new THREE.BoxGeometry(NX * P + 0.4, NY * P, 0.15).translate(0, 0, -0.4)].map((q) => q.toNonIndexed());
  const housGeo = mergeGeometries([...hous, ...frame]), lensGeo = mergeGeometries(lens);
  const housMat = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.5, metalness: 0.5 });
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.6, 4.8), toneMapped: false });
  const walk = new THREE.Mesh(new THREE.BoxGeometry(NX * P + 2, 0.12, 1.6), housMat);
  [20, 80, 140, 200, 260, 320].forEach((deg) => {
    const a = (deg * Math.PI) / 180, t = new THREE.Group(); t.position.set(Math.sin(a) * dist * 1.05, 0, -Math.cos(a) * dist * 1.12);
    t.add(new THREE.Mesh(mastGeo, steel));
    const head = new THREE.Group(); head.position.y = h + 3.5;
    head.add(new THREE.Mesh(housGeo, housMat), new THREE.Mesh(lensGeo, lamp));
    const wk = walk.clone(); wk.position.set(0, -(NY * P) / 2 - 0.9, 0.6); head.add(wk);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff0cc, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.45 }));
    sp.scale.set(NX * P * 1.6, NY * P * 1.8, 1); sp.position.z = 1.2; head.add(sp);
    t.add(head); g.add(t);
    const aim = V(t.position.x * 0.12, 0, t.position.z * 0.12);
    head.lookAt(aim); // world-space target: the near half of the field
  });
  return g;
}

// ---------- controller ----------
export function createStadium(canvas, { seats, blocks, stands }) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }); // MSAA lives on the composer target
  const gpu = (() => { const gl = renderer.getContext(), d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : ''; })();
  const low = coarse || /Intel|UHD|Iris|Mali|Adreno|PowerVR|SwiftShader|llvmpipe/i.test(gpu); // integrated GPUs start leaner
  let pixelRatio = Math.min(devicePixelRatio || 1, low ? 1 : 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false; // static scene: bake once
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x0a1226, 0.00055);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.1; pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 6000);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.08;
  canvas.style.touchAction = 'none';

  // seat bookkeeping
  const standColor = new Map(stands.map((s) => [s.id, new THREE.Color(s.color)]));
  const bidOf = seats.map((s) => blockId(s.standId, s.level, s.block));
  const seatIndex = new Map(seats.map((s, i) => [s.id, i]));
  let ext = 0, topY = 0, minP = Infinity, maxP = 0;
  for (const s of seats) { ext = Math.max(ext, Math.hypot(s.pos.x, s.pos.z)); topY = Math.max(topY, s.pos.y); minP = Math.min(minP, s.price); maxP = Math.max(maxP, s.price); }
  const myYaw = seats.map((s) => Math.atan2(-s.pos.x, -s.pos.z));
  const cut = seats.map((s) => inTunnel(s.pos.x, s.pos.y, s.pos.z)); // seats removed where the players' tunnel comes out
  const ids = new Set(blocks.map((b) => b.id));

  // environment
  const R = 1300, shoreX = -(ext + 140), cx = shoreX - R;
  const sky = makeSky(), sea = makeSea(cx, R), glow = glowTexture();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 1 }));
  ground.position.y = -0.4;
  let eOut = 0; for (const s of seats) eOut = Math.max(eOut, Math.hypot(s.pos.x / GEOMETRY.standInner.rx, s.pos.z / GEOMETRY.standInner.rz));
  const bx = GEOMETRY.standInner.rx * eOut + 1.5, bz = GEOMETRY.standInner.rz * eOut + 1.5;
  const town = makeSurroundings({ cx, R, rail: ext + 48, px: bx + 36, pz: bz + 36, tex: windowsTexture(), glow });
  scene.add(sky, ground, sea, makeNecklace(cx, R), town.group, makeFacade(bx, bz, topY), makeTunnel(), makeField(), makeTowers(ext, topY, glow));

  // lights
  scene.add(new THREE.HemisphereLight(0x9fb0d0, 0x24201a, 0.6), new THREE.AmbientLight(0x39414f, 0.25));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.0); key.position.set(60, 130, 50); key.castShadow = true;
  const sc = key.shadow.camera, E = ext + 18; sc.left = -E; sc.right = E; sc.top = E; sc.bottom = -E; sc.near = 20; sc.far = 340;
  key.shadow.mapSize.setScalar(low ? 2048 : 4096); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.05; key.shadow.radius = 3; scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45); fill.position.set(-70, 110, -60); scene.add(fill);
  const wash = new THREE.SpotLight(0xfff6ea, 6500, 0, 0.95, 1, 1.6); wash.position.set(0, 70, 0); scene.add(wash, wash.target);

  // seats
  const seatGeo = { hi: seatGeometry(), lo: seatGeometryLo() };
  const seatMat = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0 });
  const groups = new Map(); // one instanced mesh per stand, so stands outside the view are culled
  seats.forEach((s, i) => { if (!groups.has(s.standId)) groups.set(s.standId, []); groups.get(s.standId).push(i); });
  const ref = new Array(seats.length);
  const seatMeshes = [...groups.values()].map((list) => {
    const m = new THREE.InstancedMesh(seatGeo.lo, seatMat, list.length); m.castShadow = true; m.receiveShadow = true;
    list.forEach((si, n) => { ref[si] = { m, n }; }); return m;
  });
  const setSeatLod = (hi) => seatMeshes.forEach((m) => { m.geometry = hi ? seatGeo.hi : seatGeo.lo; });
  const dummy = new THREE.Object3D(), tmpC = new THREE.Color();
  function setSeatMatrix(i, scale = 1) {
    const s = seats[i], { m, n } = ref[i]; dummy.position.set(s.pos.x, s.pos.y + (scale - 1) * 0.15, s.pos.z); dummy.rotation.set(0, myYaw[i], 0); dummy.scale.setScalar(cut[i] ? 0 : scale); dummy.updateMatrix(); m.setMatrixAt(n, dummy.matrix);
  }
  for (let i = 0; i < seats.length; i++) setSeatMatrix(i);
  seatMeshes.forEach((m) => m.computeBoundingSphere());
  const P = seats.map((s) => new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z));
  scene.add(...seatMeshes);

  // terraces + hit meshes (one per block)
  const byBlock = new Map();
  seats.forEach((s, i) => { let b = byBlock.get(bidOf[i]); if (!b) byBlock.set(bidOf[i], (b = { idx: [], rows: new Map() })); b.idx.push(i); if (!b.rows.has(s.row)) b.rows.set(s.row, []); b.rows.get(s.row).push(s); });
  const mats = {
    base: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    hl: new THREE.MeshStandardMaterial({ color: 0xe9e9ec, emissive: 0xffffff, emissiveIntensity: 0.18, roughness: 0.7, side: THREE.DoubleSide }),
    dim: new THREE.MeshStandardMaterial({ color: 0x2b2e36, roughness: 0.95, side: THREE.DoubleSide }),
  };
  const terraces = new Map(), hitMeshes = [];
  for (const [id, b] of byBlock) {
    const m = new THREE.Mesh(terraceGeometry(b.rows), mats.base); m.castShadow = true; m.receiveShadow = true; m.userData.blockId = id; scene.add(m); terraces.set(id, m); hitMeshes.push(m);
    b.center = new THREE.Vector3(); b.idx.forEach((i) => b.center.add(P[i])); b.center.divideScalar(b.idx.length);
    b.radius = Math.max(...b.idx.map((i) => b.center.distanceTo(P[i])));
  }
  const roof = makeRoof(seats); scene.add(roof);

  // colour state
  let heat = false, dimmed = null, hl = null, selected = -1;
  const ramp = (p) => { const t = Math.min(1, Math.max(0, (p - minP) / (maxP - minP || 1))) * 2, k = Math.min(1, Math.floor(t)); return tmpC.copy(HEAT[k]).lerp(HEAT[k + 1], t - k); };
  function paintSeat(i) {
    const s = seats[i], bid = bidOf[i];
    if (i === selected) tmpC.setRGB(1.5, 1.5, 1.52); // the chosen seat simply reads as lit white
    else if (hl === bid) tmpC.copy(standColor.get(s.standId) || ACCENT).lerp(ACCENT, s.status === 'sold' ? 0.45 : 0.7);
    else {
      if (heat) ramp(s.price); else tmpC.copy(standColor.get(s.standId) || ACCENT);
      if (s.status === 'sold') tmpC.lerp(SOLD, 0.72);
      if (dimmed && !dimmed.has(bid)) tmpC.multiplyScalar(0.2);
    }
    ref[i].m.setColorAt(ref[i].n, tmpC);
  }
  const flush = () => seatMeshes.forEach((m) => { if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  const paintBlock = (id) => { const b = byBlock.get(id); if (b) { b.idx.forEach(paintSeat); flush(); } };
  function paintTerraces() { for (const [id, m] of terraces) m.material = id === hl ? mats.hl : dimmed && !dimmed.has(id) ? mats.dim : mats.base; }
  const paintAll = () => { for (let i = 0; i < seats.length; i++) paintSeat(i); flush(); paintTerraces(); };
  paintAll();


  // events
  const handlers = {};
  const emit = (e, ...a) => (handlers[e] || []).forEach((f) => f(...a));
  const on = (e, f) => { (handlers[e] ||= []).push(f); return () => { handlers[e] = handlers[e].filter((x) => x !== f); }; };

  // camera director
  let mode = 'aerial', anim = null, prev = null, dest = null, hoverSeat = -1;
  const look = { on: false, yaw0: 0, pitch0: 0, dy: 0, dp: 0, eye: new THREE.Vector3() };
  const setMode = (m) => { if (m !== mode) { mode = m; setSeatLod(m !== 'aerial'); emit('mode', m); } };
  function applyLimits() {
    const aer = mode === 'aerial';
    controls.minDistance = aer ? 60 : 2.5; controls.maxDistance = aer ? ext * 7 : 260; controls.maxPolarAngle = aer ? 1.38 : 1.52;
    controls.autoRotate = aer; controls.autoRotateSpeed = 0.35; controls.enabled = mode !== 'seat';
  }
  const aerialView = () => { const k = Math.min(2.1, Math.max(1, 1.15 / camera.aspect)); return { pos: new THREE.Vector3(ext * 1.55 * k, ext * 0.95 * k, ext * 1.25 * k), target: new THREE.Vector3(0, 8, 0) }; }; // pull back on portrait screens
  function frame(center, radius, outward, extraUp = 0.3) {
    const inward = outward.clone().multiplyScalar(-1).setY(0).normalize(), d = Math.min(130, radius * 1.9 + 8);
    return { pos: center.clone().addScaledVector(inward, d).add(new THREE.Vector3(0, d * extraUp + 4, 0)), target: center.clone() };
  }
  const outwardAt = (c) => new THREE.Vector3(c.x / GEOMETRY.standInner.rx ** 2, 0, c.z / GEOMETRY.standInner.rz ** 2).normalize();
  function resolveTarget(t) {
    if (t === 'aerial' || !t) return { ...aerialView(), mode: 'aerial' };
    if (t.seatId != null) {
      const i = seatIndex.get(t.seatId); if (i == null) return null; const c = new THREE.Vector3(seats[i].pos.x, seats[i].pos.y, seats[i].pos.z);
      const f = frame(c, 0, outwardAt(c), 0.4); const inward = outwardAt(c).multiplyScalar(-7);
      return { pos: c.clone().add(inward).add(new THREE.Vector3(0, 3.6, 0)), target: c.add(new THREE.Vector3(0, 0.6, 0)), mode: 'stand', f };
    }
    if (t.blockId != null) { const b = byBlock.get(t.blockId); if (!b) return null; return { ...frame(b.center, b.radius, outwardAt(b.center)), mode: 'stand' }; }
    if (t.standId != null) {
      const idx = seats.map((s, i) => i).filter((i) => seats[i].standId === t.standId); if (!idx.length) return null;
      const c = new THREE.Vector3(); idx.forEach((i) => c.add(new THREE.Vector3(seats[i].pos.x, seats[i].pos.y, seats[i].pos.z))); c.divideScalar(idx.length);
      const r = Math.max(...idx.map((i) => c.distanceTo(new THREE.Vector3(seats[i].pos.x, seats[i].pos.y, seats[i].pos.z)))) * 0.8;
      return { ...frame(c, r, outwardAt(c), 0.45), mode: 'stand' };
    }
    return null;
  }
  function moveCamera(pos, target, dur, done, arc) {
    if (anim) anim.resolve();
    controls.autoRotate = false; controls.enabled = false;
    return new Promise((resolve) => {
      if (reduced || dur <= 0) { camera.position.copy(pos); controls.target.copy(target); camera.lookAt(target); anim = null; done(); resolve(); return; }
      anim = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), start: performance.now(), dur: dur * 1000, done, resolve, arc: arc ?? Math.min(40, camera.position.distanceTo(pos) * 0.18) };
    });
  }
  function stepAnim(now) {
    const a = anim; if (!a) return;
    const k = Math.min(1, (now - a.start) / a.dur), e = a.path ? a.warp(k) : ease(k);
    if (a.path) { a.path.getPoint(e, camera.position); a.tpath.getPoint(e, controls.target); camera.lookAt(controls.target); }
    else { camera.position.lerpVectors(a.p0, a.p1, e); controls.target.lerpVectors(a.t0, a.t1, e); camera.position.y += Math.sin(Math.PI * e) * a.arc; camera.lookAt(controls.target); } // drone-style lift mid-flight
    if (k >= 1) { anim = null; a.done(); a.resolve(); }
  }
  function flyTo(t, { duration = 2.1 } = {}) {
    const r = resolveTarget(t); if (!r) return Promise.resolve();
    if (mode === 'seat') { setFov(45); look.on = false; }
    setMode(r.mode); setHoverSeat(-1); if (r.mode !== 'aerial') { highlightBlock(null); emit('hoverBlock', null, { x: 0, y: 0 }); }
    dest = { pos: r.pos.clone(), target: r.target.clone() };
    return moveCamera(r.pos, r.target, duration, () => { camera.position.copy(r.pos); controls.target.copy(r.target); applyLimits(); controls.update(); });
  }
  const setFov = (f) => { camera.fov = f; camera.updateProjectionMatrix(); };
  function enterSeatView(seatId) {
    const i = seatIndex.get(seatId); if (i == null) return Promise.resolve();
    if (mode !== 'seat') prev = anim && dest ? dest : { pos: camera.position.clone(), target: controls.target.clone() };
    const vp = seatViewpoint(seats[i]), eye = new THREE.Vector3(vp.eye.x, vp.eye.y, vp.eye.z), tg = new THREE.Vector3(vp.target.x, vp.target.y, vp.target.z);
    const dir = tg.clone().sub(eye).normalize(); look.yaw0 = Math.atan2(dir.x, dir.z); look.pitch0 = Math.asin(dir.y); look.dy = look.dp = 0; look.eye.copy(eye);
    setFov(62); setMode('seat'); look.on = false; setHoverSeat(-1);
    return moveCamera(eye, eye.clone().addScaledVector(dir, 30), 1.6, () => { look.on = true; controls.enabled = false; applyLook(); });
  }
  function applyLook() {
    const y = look.yaw0 + look.dy, p = look.pitch0 + look.dp;
    camera.lookAt(look.eye.x + Math.cos(p) * Math.sin(y), look.eye.y + Math.sin(p), look.eye.z + Math.cos(p) * Math.cos(y));
  }
  function exitSeatView() {
    if (mode !== 'seat' || !prev) return Promise.resolve();
    look.on = false; setFov(45); setMode('stand'); const p = prev;
    return moveCamera(p.pos, p.target, 1.5, () => { camera.position.copy(p.pos); controls.target.copy(p.target); applyLimits(); controls.update(); });
  }

  // picking
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ptr = { x: 0, y: 0, inside: false, dirty: false, down: null };
  const setNdc = (x, y) => { const r = canvas.getBoundingClientRect(); ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
  function pickBlock() { const h = ray.intersectObjects(hitMeshes, false)[0]; return h ? h.object.userData.blockId : null; }
  // Raycasting 33k seat instances per mouse move stalled the frame; hit the block's terrace, then take the seat nearest the ray.
  function pickSeat() {
    ray.far = 320; const h = ray.intersectObjects(hitMeshes, false)[0]; ray.far = Infinity; if (!h) return -1;
    let best = -1, bd = 0.6 * 0.6;
    for (const i of byBlock.get(h.object.userData.blockId).idx) { if (cut[i]) continue; const d = ray.ray.distanceSqToPoint(P[i]); if (d < bd && P[i].distanceToSquared(h.point) < 4) { bd = d; best = i; } }
    return best;
  }
  function highlightBlock(id) { if (id === hl) return; const old = hl; hl = id && byBlock.has(id) ? id : null; if (old) paintBlock(old); if (hl) paintBlock(hl); paintTerraces(); }
  function setHoverSeat(i) {
    if (i === hoverSeat) return; if (hoverSeat >= 0) { setSeatMatrix(hoverSeat); ref[hoverSeat].m.instanceMatrix.needsUpdate = true; }
    hoverSeat = i; if (i >= 0) { setSeatMatrix(i, 1.45); ref[i].m.instanceMatrix.needsUpdate = true; }
    canvas.style.cursor = i >= 0 ? 'pointer' : '';
  }
  function processHover() {
    ptr.dirty = false; if (!ptr.inside || anim) return;
    setNdc(ptr.x, ptr.y);
    if (mode === 'aerial') { const id = pickBlock(); if (id !== hl) { highlightBlock(id); emit('hoverBlock', id, { x: ptr.x, y: ptr.y }); } else if (id) emit('hoverBlock', id, { x: ptr.x, y: ptr.y }); canvas.style.cursor = id ? 'pointer' : ''; }
    else if (mode === 'stand') setHoverSeat(pickSeat());
  }
  function onClick(e) {
    if (anim) return; setNdc(e.clientX, e.clientY);
    if (mode === 'aerial') { const id = pickBlock(); if (id) emit('clickBlock', id); }
    else if (mode === 'stand') { const i = pickSeat(); if (i >= 0) emit('clickSeat', seats[i].id); }
  }
  const listeners = [
    ['pointermove', (e) => {
      const mx = e.clientX - ptr.x, my = e.clientY - ptr.y; // deltas from positions: movementX is 0 for some synthetic/touch input
      ptr.x = e.clientX; ptr.y = e.clientY; ptr.inside = true;
      if (look.on && e.buttons) { look.dy = Math.max(-1.4, Math.min(1.4, look.dy - mx * 0.004)); look.dp = Math.max(-0.61, Math.min(0.61, look.dp - my * 0.004)); applyLook(); }
      else if (!e.buttons) ptr.dirty = true;
    }],
    ['pointerleave', () => { ptr.inside = false; if (mode === 'aerial' && hl) { highlightBlock(null); emit('hoverBlock', null, { x: 0, y: 0 }); } setHoverSeat(-1); }],
    ['pointerdown', (e) => { ptr.down = { x: e.clientX, y: e.clientY }; ptr.x = e.clientX; ptr.y = e.clientY; if (mode === 'aerial') controls.autoRotate = false; }],
    ['pointerup', (e) => { const d = ptr.down; ptr.down = null; if (d && e.button === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) onClick(e); }],
    ['wheel', () => { if (mode === 'aerial') controls.autoRotate = false; }],
  ];
  listeners.forEach(([n, f]) => canvas.addEventListener(n, f, { passive: true }));

  // public setters
  const setHeatmap = (on) => { heat = !!on; paintAll(); };
  const setDimmed = (set) => { dimmed = set && set.size !== undefined ? set : null; paintAll(); };
  function selectSeat(id) { const old = selected; selected = id == null ? -1 : (seatIndex.get(id) ?? -1); if (old >= 0) paintSeat(old); if (selected >= 0) paintSeat(selected); flush(); }

  function snapshot(seatId, w = 480, h = 270) {
    const i = seatIndex.get(seatId); if (i == null) return '';
    const vp = seatViewpoint(seats[i]), cam = new THREE.PerspectiveCamera(65, w / h, 0.3, 4000);
    cam.position.set(vp.eye.x, vp.eye.y, vp.eye.z); cam.lookAt(vp.target.x, vp.target.y, vp.target.z);
    const cw = canvas.clientWidth, ch = canvas.clientHeight, vw = Math.min(w, cw), vh = Math.min(Math.round((vw * h) / w), ch), pr = renderer.getPixelRatio();
    renderer.setScissorTest(true); renderer.setViewport(0, 0, vw, vh); renderer.setScissor(0, 0, vw, vh); renderer.render(scene, cam);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    out.getContext('2d').drawImage(canvas, 0, canvas.height - vh * pr, vw * pr, vh * pr, 0, 0, w, h);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, cw, ch);
    return out.toDataURL('image/jpeg', 0.85);
  }

  // resize + loop
  // post: MSAA HDR target -> bloom on floodlights/LEDs -> tone map -> vignette + grain
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: low ? 2 : 4 });
  const composer = new EffectComposer(renderer, rt);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 2.2);
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
      void main(){ vec4 c=texture2D(tDiffuse,vUv); vec2 q=vUv-.5; c.rgb*=mix(1.,.62,smoothstep(.25,.85,dot(q,q)*2.2));
        float n=fract(sin(dot(vUv*vec2(1.,1.3)+fract(uTime),vec2(12.9898,78.233)))*43758.5453); c.rgb+=(n-.5)*.018; gl_FragColor=c; }`,
  });
  composer.addPass(new RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(new OutputPass()); composer.addPass(grade);
  function resize() { const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1; renderer.setSize(w, h, false); composer.setPixelRatio(pixelRatio); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  renderer.shadowMap.needsUpdate = true;
  // Opening: walk out of the players' tunnel onto the grass, then rise into the overview.
  const a0 = aerialView(); let intro = true;
  const endIntro = () => { if (!intro) return; intro = false; setSeatLod(mode !== 'aerial'); applyLimits(); controls.update(); emit('introEnd'); };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const path = new THREE.CatmullRomCurve3([V3(12, 1.75, -98), V3(12, 1.75, -88), V3(12, 1.85, -77), V3(10.5, 2.6, -64), V3(8, 9, -46), V3(a0.pos.x * 0.45, a0.pos.y * 0.55, -10), a0.pos], false, 'centripetal');
  const tpath = new THREE.CatmullRomCurve3([V3(12, 1.8, -60), V3(11, 2.6, -40), V3(6, 3, -20), V3(0, 2, 0), V3(0, 2, 8), V3(0, 6, 4), a0.target], false, 'centripetal');
  setSeatLod(true); // the walkout passes right by the front rows
  camera.position.copy(path.getPoint(0)); controls.target.copy(tpath.getPoint(0)); camera.lookAt(controls.target); applyLimits(); controls.enabled = false; controls.autoRotate = false;
  if (reduced) { camera.position.copy(a0.pos); controls.target.copy(a0.target); setTimeout(endIntro, 0); }
  else { // slow walk in the tunnel, then accelerate into the rise and settle
    const warp = (k) => (k < 0.3 ? 0.3 * (k / 0.3) : 0.3 + 0.7 * ease((k - 0.3) / 0.7));
    anim = { path, tpath, warp, start: performance.now() + 300, dur: 8500, done: endIntro, resolve: () => {} };
  }
  canvas.addEventListener('pointerdown', () => { if (intro && anim?.path) { anim = null; flyTo('aerial', { duration: 1.4 }).then(endIntro); } }, { once: true });
  let ft = 0, fn = 0, last = 0;
  function adapt(now) { // drop resolution on slow GPUs instead of stuttering
    if (last) { ft += now - last; fn++; } last = now;
    if (fn < 90 || REC) return; const avg = ft / fn; ft = fn = 0;
    if (avg > 24 && pixelRatio > 0.8) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
  }
  const nearFor = () => (mode === 'seat' || look.on ? 0.15 : THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.02, 0.2, 4));
  const clock = new THREE.Clock(); let raf = 0, disposed = false, frameN = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop); const t = clock.getElapsedTime(); adapt(now);
    if (anim && now >= anim.start) stepAnim(now); else if (!anim && controls.enabled) controls.update();
    if (mode !== 'seat') { camera.position.y = Math.max(camera.position.y, 1.2); controls.target.y = Math.max(controls.target.y, 0); }
    if (ptr.dirty || (mode === 'aerial' && controls.autoRotate && ptr.inside && (++frameN % 3 === 0))) processHover(); // re-pick while the bowl turns under a still cursor
    const nr = nearFor(); if (Math.abs(nr - camera.near) > camera.near * 0.1) { camera.near = nr; camera.updateProjectionMatrix(); }
    sea.material.uniforms.uTime.value = t; town.update(t);
    grade.uniforms.uTime.value = t; composer.render();
  }
  const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden && !disposed) { clock.getDelta(); raf = requestAnimationFrame(loop); } };
  document.addEventListener('visibilitychange', onVis); raf = requestAnimationFrame(loop);

  function dispose() {
    disposed = true; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis);
    listeners.forEach(([n, f]) => canvas.removeEventListener(n, f)); controls.dispose();
    const done = new Set();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      for (const m of [].concat(o.material || [])) { if (done.has(m)) continue; done.add(m); for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); }
    });
    seatMeshes.forEach((m) => m.dispose()); seatGeo.hi.dispose(); seatGeo.lo.dispose(); composer.dispose(); rt.dispose(); scene.environment?.dispose(); renderer.dispose();
  }

  if (REC) window.__wk = { project(id) { const i = seatIndex.get(id); if (i == null) return null; const v = P[i].clone().project(camera), r = canvas.getBoundingClientRect(); return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }; } }; // recording hook only
  return { flyTo, enterSeatView, exitSeatView, highlightBlock, selectSeat, setHeatmap, setDimmed, snapshot, on, dispose };
}
