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
function makeCity(ext, cxShore, tex) {
  const r = rng(11), N = 700, items = [];
  while (items.length < N) {
    const a = r() * Math.PI * 2, d = ext + 150 + Math.pow(r(), 0.7) * 1000;
    const x = Math.sin(a) * d, z = -Math.cos(a) * d;
    if (x < cxShore + 40 || Math.abs(x - (ext + 48)) < 14) continue;
    if (x < 0 && Math.abs(z) < 260 && x > cxShore && x < -(ext + 70) && r() < 0.5) continue;
    const w = 12 + r() * 26, dd = 12 + r() * 26, h = 7 + Math.pow(r(), 2.6) * 48 * (0.45 + d / 1100);
    items.push({ x, z, w, dd, h, ry: Math.round(r() * 3) * 0.2 });
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0x151a27, roughness: 0.9, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9 });
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_EMISSIVEMAP
      vEmissiveMapUv *= vec2(max(length(instanceMatrix[0].xyz),length(instanceMatrix[2].xyz))/10., length(instanceMatrix[1].xyz)/12.);
      #endif`);
  };
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, N);
  const o = new THREE.Object3D();
  items.forEach((it, i) => { o.position.set(it.x, 0, it.z); o.scale.set(it.w, it.h, it.dd); o.rotation.y = it.ry; o.updateMatrix(); mesh.setMatrixAt(i, o.matrix); });
  return mesh;
}
function makeTrees(ext) {
  const r = rng(5), N = 380, o = new THREE.Object3D();
  const cones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.4, 4, 5).translate(0, 2, 0), new THREE.MeshStandardMaterial({ color: 0x2a2219, roughness: 1 }), N);
  const balls = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.2, 1).scale(1, 0.75, 1).translate(0, 5.6, 0), new THREE.MeshStandardMaterial({ color: 0x142417, roughness: 1 }), N);
  for (let i = 0; i < N; i++) {
    const a = r() * Math.PI * 2, d = ext + 10 + r() * 45, s = 0.7 + r() * 0.8;
    o.position.set(Math.sin(a) * d * 1.02, 0, -Math.cos(a) * d * 1.1); o.scale.setScalar(s); o.updateMatrix();
    cones.setMatrixAt(i, o.matrix); o.scale.multiply(new THREE.Vector3(0.8 + r() * 0.5, 0.8 + r() * 0.4, 0.8 + r() * 0.5)); o.updateMatrix(); balls.setMatrixAt(i, o.matrix);
  }
  const g = new THREE.Group(); g.add(cones, balls); return g;
}
function makeRailway(ext) {
  const g = new THREE.Group(), m = new THREE.LineBasicMaterial({ color: 0x6d7480 });
  for (const dx of [-0.8, 0.8]) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ext + 48 + dx, 0.3, -2200), new THREE.Vector3(ext + 48 + dx, 0.3, 2200)]), m));
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(6, 4400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 1 }));
  bed.position.set(ext + 48, 0.1, 0); g.add(bed); return g;
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
  const quad = (a, b, c, d, k) => { col = k; tri(a, b, c); tri(a, c, d); };
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
function makeTowers(ext, topY, glow) {
  const g = new THREE.Group(), h = topY + 34, dist = ext + 16;
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a919c, roughness: 0.5, metalness: 0.5 });
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.6, 3.8), toneMapped: false });
  [20, 80, 140, 200, 260, 320].forEach((deg) => {
    const a = (deg * Math.PI) / 180, t = new THREE.Group(); t.position.set(Math.sin(a) * dist * 1.05, 0, -Math.cos(a) * dist * 1.12);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.5, h, 8).translate(0, h / 2, 0), steel); t.add(pole);
    const head = new THREE.Group(); head.position.y = h + 2;
    head.add(new THREE.Mesh(new THREE.BoxGeometry(11, 7, 0.6), new THREE.MeshStandardMaterial({ color: 0x20242b })));
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) { const l = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), lamp); l.position.set(-4.2 + i * 1.68, -2.55 + j * 1.7, 0.35); head.add(l); }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff0cc, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.5 }));
    sp.scale.setScalar(20); sp.position.z = 2; head.add(sp);
    t.add(head); head.lookAt(0, h * 0.3, 0);
    g.add(t);
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
  const ids = new Set(blocks.map((b) => b.id));

  // environment
  const R = 1300, shoreX = -(ext + 140), cx = shoreX - R;
  const sky = makeSky(), sea = makeSea(cx, R), glow = glowTexture();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.95 }));
  ground.position.y = -0.05; ground.receiveShadow = true;
  scene.add(sky, ground, sea, makeNecklace(cx, R), makeCity(ext, shoreX, windowsTexture()), makeTrees(ext), makeRailway(ext), makeField(), makeTowers(ext, topY, glow));

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
    const s = seats[i], { m, n } = ref[i]; dummy.position.set(s.pos.x, s.pos.y + (scale - 1) * 0.15, s.pos.z); dummy.rotation.set(0, myYaw[i], 0); dummy.scale.setScalar(scale); dummy.updateMatrix(); m.setMatrixAt(n, dummy.matrix);
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
  let heat = false, dimmed = null, hl = null;
  const ramp = (p) => { const t = Math.min(1, Math.max(0, (p - minP) / (maxP - minP || 1))) * 2, k = Math.min(1, Math.floor(t)); return tmpC.copy(HEAT[k]).lerp(HEAT[k + 1], t - k); };
  function paintSeat(i) {
    const s = seats[i], bid = bidOf[i];
    if (hl === bid) tmpC.copy(standColor.get(s.standId) || ACCENT).lerp(ACCENT, s.status === 'sold' ? 0.45 : 0.7);
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

  // selection marker
  const marker = new THREE.Group(); marker.visible = false;
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: false });
  marker.add(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 32).rotateX(Math.PI / 2).translate(0, 1.0, 0), ringMat));
  marker.add(new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 12).rotateX(Math.PI).translate(0, 0.6, 0), ringMat));
  marker.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 8, 1, true).translate(0, 4, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })));
  scene.add(marker);
  let selected = -1;

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
    const k = Math.min(1, (now - a.start) / a.dur), e = ease(k);
    camera.position.lerpVectors(a.p0, a.p1, e); controls.target.lerpVectors(a.t0, a.t1, e);
    camera.position.y += Math.sin(Math.PI * e) * a.arc; camera.lookAt(controls.target); // drone-style lift mid-flight
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
    for (const i of byBlock.get(h.object.userData.blockId).idx) { const d = ray.ray.distanceSqToPoint(P[i]); if (d < bd && P[i].distanceToSquared(h.point) < 4) { bd = d; best = i; } }
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
      ptr.x = e.clientX; ptr.y = e.clientY; ptr.inside = true;
      if (look.on && e.buttons) { look.dy = Math.max(-1.4, Math.min(1.4, look.dy - (e.movementX || 0) * 0.004)); look.dp = Math.max(-0.61, Math.min(0.61, look.dp - (e.movementY || 0) * 0.004)); applyLook(); }
      else if (!e.buttons) ptr.dirty = true;
    }],
    ['pointerleave', () => { ptr.inside = false; if (mode === 'aerial' && hl) { highlightBlock(null); emit('hoverBlock', null, { x: 0, y: 0 }); } setHoverSeat(-1); }],
    ['pointerdown', (e) => { ptr.down = { x: e.clientX, y: e.clientY }; if (mode === 'aerial') controls.autoRotate = false; }],
    ['pointerup', (e) => { const d = ptr.down; ptr.down = null; if (d && e.button === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) onClick(e); }],
    ['wheel', () => { if (mode === 'aerial') controls.autoRotate = false; }],
  ];
  listeners.forEach(([n, f]) => canvas.addEventListener(n, f, { passive: true }));

  // public setters
  const setHeatmap = (on) => { heat = !!on; paintAll(); };
  const setDimmed = (set) => { dimmed = set && set.size !== undefined ? set : null; paintAll(); };
  function selectSeat(id) { selected = id == null ? -1 : (seatIndex.get(id) ?? -1); marker.visible = selected >= 0; if (selected >= 0) { const p = seats[selected].pos; marker.position.set(p.x, p.y, p.z); } }

  function snapshot(seatId, w = 480, h = 270) {
    const i = seatIndex.get(seatId); if (i == null) return '';
    const vp = seatViewpoint(seats[i]), cam = new THREE.PerspectiveCamera(65, w / h, 0.3, 4000);
    cam.position.set(vp.eye.x, vp.eye.y, vp.eye.z); cam.lookAt(vp.target.x, vp.target.y, vp.target.z);
    const cw = canvas.clientWidth, ch = canvas.clientHeight, vw = Math.min(w, cw), vh = Math.min(Math.round((vw * h) / w), ch), pr = renderer.getPixelRatio();
    const wasMarker = marker.visible; marker.visible = false;
    renderer.setScissorTest(true); renderer.setViewport(0, 0, vw, vh); renderer.setScissor(0, 0, vw, vh); renderer.render(scene, cam);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    out.getContext('2d').drawImage(canvas, 0, canvas.height - vh * pr, vw * pr, vh * pr, 0, 0, w, h);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, cw, ch); marker.visible = wasMarker;
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
  const a0 = aerialView(); camera.position.copy(a0.pos).multiplyScalar(1.9).setY(a0.pos.y * 2.6); controls.target.copy(a0.target); applyLimits();
  moveCamera(a0.pos, a0.target, 3.4, () => { applyLimits(); controls.update(); }, 0); // opening drone shot
  let ft = 0, fn = 0, last = 0;
  function adapt(now) { // drop resolution on slow GPUs instead of stuttering
    if (last) { ft += now - last; fn++; } last = now;
    if (fn < 90) return; const avg = ft / fn; ft = fn = 0;
    if (avg > 24 && pixelRatio > 0.8) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
  }
  const nearFor = () => (mode === 'seat' || look.on ? 0.15 : THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.02, 0.2, 4));
  const clock = new THREE.Clock(); let raf = 0, disposed = false, frameN = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop); const t = clock.getElapsedTime(); adapt(now);
    if (anim) stepAnim(now); else if (controls.enabled) controls.update();
    if (mode !== 'seat') { camera.position.y = Math.max(camera.position.y, 1.2); controls.target.y = Math.max(controls.target.y, 0); }
    if (ptr.dirty || (mode === 'aerial' && controls.autoRotate && ptr.inside && (++frameN % 3 === 0))) processHover(); // re-pick while the bowl turns under a still cursor
    const nr = nearFor(); if (Math.abs(nr - camera.near) > camera.near * 0.1) { camera.near = nr; camera.updateProjectionMatrix(); }
    sea.material.uniforms.uTime.value = t;
    marker.visible = selected >= 0 && mode !== 'seat';
    if (marker.visible) { const d = camera.position.distanceTo(marker.position), s = Math.max(1, d / 30) * (1 + Math.sin(t * 4) * 0.12); marker.scale.setScalar(s); ringMat.color.setScalar(1.8 + Math.sin(t * 3) * 0.5); }
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

  return { flyTo, enterSeatView, exitSeatView, highlightBlock, selectSeat, setHeatmap, setDimmed, snapshot, on, dispose };
}
