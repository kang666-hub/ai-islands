// 各島裝飾與動態：全部程式產生，數值來自 islands.json 的 stats / visual
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from './palette.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GROUND_Y, ISLAND_R, APOTHEM } from './world.js';

const C = {
  wall: PALETTE.wall,
  roof: PALETTE.accent,
  text: PALETTE.text,
  wood: PALETTE.wood,
  woodDark: PALETTE.woodDark,
  metal: 0x8e9aa3,
  metalDark: 0x5b666e,
  glass: 0xbfe8ea,
  claude: 0xe0703f,
  codex: 0x6cbf84,
  agy: 0x5b8def,
  navy: 0x1d2b53,
  red: 0xd94b3c,
  yellow: 0xf3c64c,
  white: 0xffffff,
  book1: 0xe0703f,
  book2: 0x5b8def,
  book3: 0xf3c64c,
  book4: 0x6cbf84,
  concrete: 0xd9d3c7,
  smoke: 0xf4efe8,
};

const matCache = new Map();
function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
    m.userData.cached = true; // 可被靜態合併
    matCache.set(key, m);
  }
  return matCache.get(key);
}

// 圓角盒：塑膠模型感的基本積木
function rbox(w, h, d, color, radius = 0.12, extra) {
  const r = Math.min(radius, w / 2, h / 2, d / 2);
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat(color, extra));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(rTop, rBottom, h, color, seg = 12, extra) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat(color, extra));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function pyramid(radius, h, color) {
  const mesh = cyl(0, radius, h, color, 4);
  mesh.rotation.y = Math.PI / 4;
  return mesh;
}

function sphere(r, color, extra) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat(color, extra));
  mesh.castShadow = true;
  return mesh;
}

// 小房子：牆＋四角錐屋頂＋門
function house(w, h, d, roofColor = C.roof) {
  const g = new THREE.Group();
  const wall = rbox(w, h, d, C.wall, 0.1);
  wall.position.y = h / 2;
  g.add(wall);
  const roof = pyramid(Math.max(w, d) * 0.78, h * 0.65, roofColor);
  roof.position.y = h + h * 0.325;
  g.add(roof);
  const door = rbox(0.28, 0.42, 0.06, C.woodDark, 0.04);
  door.position.set(0, 0.21, d / 2 + 0.02);
  g.add(door);
  return g;
}

// 固定種子的亂數，重新整理也長一樣
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 草皮輕微起伏：幾個壓扁的小土丘
function mounds(group, seed, count = 4) {
  const rand = rng(seed);
  const list = [];
  for (let i = 0; i < count; i++) {
    const r = 0.5 + rand() * 0.4;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat(PALETTE.grass));
    m.scale.set(1, 0.1 + rand() * 0.08, 1);
    const a = (i / count) * Math.PI * 2 + rand() * 0.8;
    const d = 2.3 + rand() * 0.9;
    m.position.set(Math.cos(a) * d, 0.02, Math.sin(a) * d);
    m.receiveShadow = true;
    m.castShadow = false;
    group.add(m);
    list.push({ x: m.position.x, z: m.position.z, r: r * 0.98, sy: m.scale.y });
  }
  return list;
}

function statValue(info, key) {
  const s = info.stats?.find((x) => x.key === key);
  return typeof s?.value === 'number' ? s.value : null;
}

// 看板「KANG」：canvas 畫字貼成貼圖（字型載入完成後重畫一次）
function makeSignTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    ctx.fillStyle = '#2a2420';
    ctx.fillRect(0, 0, 256, 72);
    ctx.fillStyle = '#f3c64c';
    ctx.font = '900 52px "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('KANG', 128, 38);
    tex.needsUpdate = true;
  };
  draw();
  if (document.fonts?.ready) document.fonts.ready.then(draw);
  return tex;
}

/* ---------- 樹與街道家具 ---------- */

const CROWN = [0x6faa5a, 0x5c9a4d, 0x8fbf6a, 0x9cc46b];

function tree(kind, rand) {
  const g = new THREE.Group();
  const h = 0.35 + rand() * 0.2;
  const trunk = cyl(0.05, 0.08, h, C.woodDark, 7);
  trunk.position.y = h / 2;
  g.add(trunk);
  const color = CROWN[Math.floor(rand() * CROWN.length)];
  if (kind === 0) {
    // 松樹：兩層圓錐
    const c1 = cyl(0, 0.42, 0.6, color, 7);
    c1.position.y = h + 0.28;
    const c2 = cyl(0, 0.3, 0.5, color, 7);
    c2.position.y = h + 0.65;
    g.add(c1, c2);
  } else if (kind === 1) {
    // 闊葉樹：低多邊形二十面體
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), mat(color, { flatShading: true }));
    crown.position.y = h + 0.4;
    crown.rotation.y = rand() * Math.PI;
    crown.castShadow = true;
    g.add(crown);
  } else {
    // 圓球樹：兩顆疊球
    const a = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 1), mat(color, { flatShading: true }));
    a.position.y = h + 0.34;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), mat(color, { flatShading: true }));
    b.position.set(0.12, h + 0.62, -0.08);
    a.castShadow = b.castShadow = true;
    g.add(a, b);
  }
  g.scale.setScalar(0.85 + rand() * 0.35);
  return g;
}

function lamp() {
  const g = new THREE.Group();
  const pole = cyl(0.035, 0.045, 1.15, C.metalDark, 8);
  pole.position.y = 0.575;
  const head = sphere(0.1, C.glass, { emissive: 0xfff1c4, emissiveIntensity: 0.9 });
  head.position.y = 1.2;
  const cap = cyl(0.04, 0.14, 0.08, C.roof, 8);
  cap.position.y = 1.3;
  g.add(pole, head, cap);
  return g;
}

function bench() {
  const g = new THREE.Group();
  g.userData.kind = 'bench';
  const seat = rbox(0.7, 0.06, 0.24, C.wood, 0.02);
  seat.position.y = 0.3;
  const back = rbox(0.7, 0.22, 0.05, C.wood, 0.02);
  back.position.set(0, 0.45, -0.1);
  back.rotation.x = -0.15;
  g.add(seat, back);
  for (const x of [-0.27, 0.27]) {
    const leg = rbox(0.05, 0.3, 0.2, C.metalDark, 0.01);
    leg.position.set(x, 0.15, 0);
    g.add(leg);
  }
  return g;
}

// 在島的外圈撒樹與家具：避開既有障礙、棧橋落點與碼頭方向，放好後登記成障礙
function scatterProps(group, obstacles, rand, blockedAngles) {
  const placed = [];
  const tryPlace = (make, radius, rMin, rMax) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      const a = rand() * Math.PI * 2;
      const d = rMin + rand() * (rMax - rMin);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (blockedAngles.some((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.42)) continue;
      if (obstacles.some((o) => Math.hypot(x - o[0], z - o[1]) < o[2] + radius + 0.45)) continue;
      const obj = make();
      obj.position.set(x, 0, z);
      obj.rotation.y = Math.atan2(-x, -z); // 家具面向島中心
      group.add(obj);
      obstacles.push([x, z, radius]);
      placed.push({ x, z, radius, ry: obj.rotation.y, kind: obj.userData.kind || 'tree' });
      return true;
    }
    return false;
  };
  const treeCount = 3 + Math.floor(rand() * 4); // 3～6 棵
  for (let i = 0; i < treeCount; i++) tryPlace(() => tree(Math.floor(rand() * 3), rand), 0.42, 2.2, 3.5);
  // 街道家具 1～2 件：路燈一定放，長椅看機率
  tryPlace(() => lamp(), 0.18, 1.7, 3.6) || tryPlace(() => lamp(), 0.18, 1.2, 3.7);
  tryPlace(() => bench(), 0.4, 1.8, 3.4) || tryPlace(() => bench(), 0.4, 1.3, 3.6);
  return placed;
}

/* ---------- 各島 ---------- */

// 品牌島：街機塔＋KANG 看板（燈閃）、房子
function buildBrand(info) {
  const g = new THREE.Group();
  const tower = rbox(1.5, 2.6, 1.3, C.wall, 0.14);
  tower.position.set(0.3, 1.3, -0.4);
  g.add(tower);
  const screen = rbox(1.1, 0.9, 0.08, C.glass, 0.04, { emissive: 0x7fd9dd, emissiveIntensity: 0.35 });
  screen.position.set(0.3, 1.7, 0.27);
  g.add(screen);
  const cap = rbox(1.7, 0.3, 1.5, C.roof, 0.1);
  cap.position.set(0.3, 2.75, -0.4);
  g.add(cap);

  // 看板：板子＋一排燈
  const board = rbox(2.4, 0.8, 0.12, C.text, 0.05);
  board.position.set(0.3, 3.45, -0.4);
  g.add(board);
  const signTex = makeSignTexture();
  const letters = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 0.6),
    new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.45, roughness: 0.6 }),
  );
  letters.position.set(0.3, 3.45, -0.335);
  g.add(letters);
  const bulbMats = [];
  for (let i = 0; i < 8; i++) {
    const b = sphere(0.07, C.white, { emissive: 0xffe9a8, emissiveIntensity: 1 });
    b.material = b.material.clone(); // 每顆燈各自控制亮度
    b.userData.dynamic = true;
    b.position.set(0.3 - 1.05 + i * 0.3, 3.92, -0.4);
    g.add(b);
    bulbMats.push(b.material);
  }

  const h1 = house(0.9, 0.8, 0.9);
  h1.position.set(-1.6, 0, 0.9);
  h1.rotation.y = 0.4;
  g.add(h1);
  const h2 = house(0.8, 0.7, 0.8, C.yellow);
  h2.position.set(1.9, 0, 1.2);
  h2.rotation.y = -0.6;
  g.add(h2);
  const h3 = house(0.7, 0.6, 0.7);
  h3.position.set(-1.3, 0, -1.6);
  g.add(h3);

  return {
    group: g,
    update(t) {
      // 跑馬燈：一次亮三顆往右跑
      const head = Math.floor(t * 6) % 8;
      bulbMats.forEach((m, i) => {
        const on = i === head || i === (head + 7) % 8 || i === (head + 6) % 8;
        m.emissiveIntensity = on ? 1.6 : 0.15;
      });
    },
    obstacles: [[0.3, -0.4, 1.1], [-1.6, 0.9, 0.75], [1.9, 1.2, 0.7], [-1.3, -1.6, 0.6]],
  };
}

// AI 工坊：工廠、煙囪；煙量 ∝ running_sessions
function buildAi(info) {
  const g = new THREE.Group();
  const hall = rbox(2.6, 1.1, 1.8, C.wall, 0.12);
  hall.position.set(0, 0.55, 0.2);
  g.add(hall);
  // 鋸齒屋頂
  for (let i = 0; i < 3; i++) {
    const saw = pyramid(0.62, 0.5, C.roof);
    saw.rotation.y = 0;
    saw.scale.set(1, 1, 1.9);
    saw.position.set(-0.85 + i * 0.85, 1.35, 0.2);
    g.add(saw);
  }
  const annex = rbox(1.2, 0.8, 1.0, C.wall, 0.1);
  annex.position.set(-1.6, 0.4, -0.9);
  g.add(annex);

  const stacks = [];
  for (const [x, z, h] of [[1.0, -0.9, 2.2], [1.7, -0.5, 1.7]]) {
    const s = cyl(0.17, 0.22, h, C.concrete, 10);
    s.position.set(x, h / 2, z);
    g.add(s);
    const band = cyl(0.2, 0.2, 0.18, C.roof, 10);
    band.position.set(x, h - 0.2, z);
    g.add(band);
    stacks.push(new THREE.Vector3(x, h, z));
  }

  // 煙：一組半透明小球循環上升；同時可見顆數依 running_sessions 決定
  const running = Number.isFinite(info.visual?.running_sessions) ? Math.max(0, info.visual.running_sessions) : 0;
  const perStack = Math.min(8, Math.round(running * 3));
  const smokeMat = new THREE.MeshStandardMaterial({ color: C.smoke, transparent: true, opacity: 0.8, roughness: 1 });
  const puffs = [];
  stacks.forEach((top, si) => {
    for (let i = 0; i < perStack; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), smokeMat.clone());
      p.castShadow = false;
      p.userData.dynamic = true;
      g.add(p);
      puffs.push({ mesh: p, top, phase: (i / perStack) + si * 0.37, drift: (si ? -1 : 1) * 0.35 });
    }
  });

  return {
    group: g,
    update(t) {
      for (const p of puffs) {
        const k = (t * 0.28 + p.phase) % 1; // 0 → 1 上升
        p.mesh.position.set(p.top.x + k * p.drift + Math.sin(t * 2 + p.phase * 9) * 0.08, p.top.y + k * 1.9, p.top.z);
        const s = 0.5 + k * 1.3;
        p.mesh.scale.setScalar(s);
        p.mesh.material.opacity = 0.75 * (1 - k) ** 1.2;
      }
    },
    obstacles: [[0, 0.2, 1.7], [-1.6, -0.9, 0.85], [1.0, -0.9, 0.35], [1.7, -0.5, 0.35]],
  };
}

// Discord 港：碼頭、燈塔、船；new_inbox > 0 時靠港
function buildPort(info, outward) {
  const g = new THREE.Group();
  const out = outward.clone();
  const side = new THREE.Vector3(-out.z, 0, out.x);

  // 碼頭：從島緣伸出海面
  const pierLen = 3.2;
  const pier = new THREE.Group();
  const deck = rbox(pierLen, 0.14, 1.0, C.wood, 0.03);
  deck.position.set(pierLen / 2, 0, 0);
  pier.add(deck);
  for (let i = 0; i <= 3; i++) {
    for (const z of [-0.42, 0.42]) {
      const post = cyl(0.07, 0.07, 1.2, C.woodDark, 6);
      post.position.set(i * (pierLen / 3), -0.45, z);
      pier.add(post);
    }
  }
  pier.position.copy(out).multiplyScalar(ISLAND_R - 0.9).setY(-0.1);
  pier.rotation.y = -Math.atan2(out.z, out.x);
  g.add(pier);

  // 燈塔
  const lhPos = side.clone().multiplyScalar(-1.7).add(out.clone().multiplyScalar(2.3));
  const lh = cyl(0.24, 0.34, 1.9, C.wall, 12);
  lh.position.copy(lhPos).setY(0.95);
  g.add(lh);
  for (const y of [0.45, 1.15]) {
    const stripe = cyl(0.33 - y * 0.05, 0.35 - y * 0.05, 0.26, C.red, 12);
    stripe.position.copy(lhPos).setY(y);
    g.add(stripe);
  }
  const lamp = cyl(0.2, 0.2, 0.32, C.glass, 10, { emissive: 0xfff2b0, emissiveIntensity: 0.6 });
  lamp.position.copy(lhPos).setY(2.05);
  g.add(lamp);
  const lampCap = pyramid(0.32, 0.32, C.roof);
  lampCap.position.copy(lhPos).setY(2.37);
  g.add(lampCap);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 1.6, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.rotation.z = Math.PI / 2;
  beam.position.x = 0.8;
  const beamPivot = new THREE.Group();
  beamPivot.userData.dynamic = true;
  beamPivot.position.copy(lhPos).setY(2.05);
  beamPivot.add(beam);
  g.add(beamPivot);

  // 倉庫
  const shed = house(1.4, 0.8, 1.1);
  shed.position.copy(side.clone().multiplyScalar(1.4)).add(out.clone().multiplyScalar(-0.2));
  shed.rotation.y = -Math.atan2(out.z, out.x);
  g.add(shed);
  const crates = [];
  for (let i = 0; i < 3; i++) {
    const crate = rbox(0.4, 0.4, 0.4, [C.yellow, C.agy, C.codex][i], 0.05);
    crates.push(crate);
    crate.position.copy(out.clone().multiplyScalar(ISLAND_R - 1.6 - i * 0.35)).add(side.clone().multiplyScalar(-0.9 + i * 0.5)).setY(0.2);
    crate.rotation.y = i * 0.5;
    g.add(crate);
  }

  // 船
  const boat = new THREE.Group();
  boat.userData.dynamic = true;
  const hull = rbox(1.4, 0.4, 0.7, C.navy, 0.14);
  hull.position.y = 0.2;
  boat.add(hull);
  const cabin = rbox(0.5, 0.4, 0.5, C.wall, 0.08);
  cabin.position.set(-0.15, 0.6, 0);
  boat.add(cabin);
  const funnel = cyl(0.08, 0.1, 0.35, C.roof, 8);
  funnel.position.set(0.25, 0.75, 0);
  boat.add(funnel);
  g.add(boat);

  // 航線：港外繞一圈 → 碼頭頭端；有新收件時在碼頭停留
  const dockPoint = out.clone().multiplyScalar(ISLAND_R - 0.9 + pierLen - 0.3).add(side.clone().multiplyScalar(0.95));
  const seaCenter = out.clone().multiplyScalar(ISLAND_R + 4.5).add(side.clone().multiplyScalar(2.2));
  const newInbox = typeof info.visual?.new_inbox === 'number' ? info.visual.new_inbox : info.visual?.new_inbox ? 1 : 0;
  const dwell = newInbox > 0 ? 6 : 0;
  const sail = 14;
  const period = sail + dwell;
  const curve = new THREE.CatmullRomCurve3([
    dockPoint.clone(),
    seaCenter.clone().add(side.clone().multiplyScalar(-2.5)),
    seaCenter.clone().add(out.clone().multiplyScalar(2.5)),
    seaCenter.clone().add(side.clone().multiplyScalar(2.5)),
    dockPoint.clone(),
  ], false, 'catmullrom', 0.3);
  const tmpPos = new THREE.Vector3();
  const tmpTan = new THREE.Vector3();

  return {
    group: g,
    seaLevel: true,
    update(t) {
      beamPivot.rotation.y = t * 0.9;
      lamp.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 3);

      const phase = t % period;
      let k;
      if (phase < dwell) k = 0; // 靠港停留
      else k = (phase - dwell) / sail;
      curve.getPointAt(k, tmpPos);
      boat.position.copy(tmpPos);
      boat.position.y = -0.05 + Math.sin(t * 1.7) * 0.05;
      if (k > 0.002 && k < 0.998) {
        curve.getTangentAt(k, tmpTan);
        boat.rotation.y = -Math.atan2(tmpTan.z, tmpTan.x);
      } else {
        boat.rotation.y = -Math.atan2(out.z, out.x) + Math.PI / 2;
      }
    },
    obstacles: [
      [lhPos.x, lhPos.z, 0.5],
      [shed.position.x, shed.position.z, 0.95],
      ...crates.map((c) => [c.position.x, c.position.z, 0.35]),
    ],
  };
}

// 資產庫：圖書館＋書塔；層數 ∝ log(notes)，上限 20
function buildLib(info) {
  const g = new THREE.Group();
  const lib = rbox(2.4, 1.2, 1.6, C.wall, 0.12);
  lib.position.set(-0.6, 0.6, 0.4);
  g.add(lib);
  for (let i = 0; i < 4; i++) {
    const col = cyl(0.09, 0.09, 1.2, C.concrete, 8);
    col.position.set(-1.5 + i * 0.6, 0.6, 1.25);
    g.add(col);
  }
  const roof = rbox(2.7, 0.22, 1.9, C.roof, 0.08);
  roof.position.set(-0.6, 1.3, 0.4);
  g.add(roof);
  const dome = sphere(0.5, C.glass, { emissive: 0x7fd9dd, emissiveIntensity: 0.15 });
  dome.scale.y = 0.7;
  dome.position.set(-0.6, 1.5, 0.4);
  g.add(dome);

  const notes = statValue(info, 'notes');
  // 對數曲線：257 筆 → 12 層、2000 筆 → 20 層封頂（Kang 2026-10-25 決定）
  const A = 8 / (Math.log10(2000) - Math.log10(257));
  const layers = notes === null ? 1 : Math.max(1, Math.min(20, Math.round(12 + A * (Math.log10(Math.max(notes, 1)) - Math.log10(257)))));
  const colors = [C.book1, C.book2, C.book3, C.book4];
  const rand = rng(42);
  const layerH = 0.22;
  for (let i = 0; i < layers; i++) {
    const w = 0.9 + rand() * 0.3;
    const d = 0.6 + rand() * 0.25;
    const b = rbox(w, layerH, d, colors[i % 4], 0.04);
    b.position.set(1.3 + (rand() - 0.5) * 0.12, layerH / 2 + i * layerH, -0.6 + (rand() - 0.5) * 0.12);
    b.rotation.y = (rand() - 0.5) * 0.35;
    g.add(b);
  }
  g.userData.towerLayers = layers;
  return { group: g, update() {}, obstacles: [[-0.6, 0.4, 1.6], [1.3, -0.6, 0.8]] };
}

// 拳擊島：擂台、沙包（擺動）
function buildBox(info) {
  const g = new THREE.Group();
  const floor = rbox(2.6, 0.3, 2.6, C.wall, 0.08);
  floor.position.set(-0.3, 0.15, 0.3);
  g.add(floor);
  const mat2 = rbox(2.3, 0.06, 2.3, C.glass, 0.02);
  mat2.position.set(-0.3, 0.33, 0.3);
  g.add(mat2);
  const postPos = [[-1.5, -0.9], [0.9, -0.9], [0.9, 1.5], [-1.5, 1.5]];
  for (const [x, z] of postPos) {
    const p = cyl(0.07, 0.07, 1.0, C.red, 8);
    p.position.set(x, 0.8, z);
    g.add(p);
  }
  for (let r = 0; r < 3; r++) {
    const y = 0.55 + r * 0.25;
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = postPos[i];
      const [x2, z2] = postPos[(i + 1) % 4];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const rope = cyl(0.025, 0.025, len, r === 1 ? C.white : C.red, 6);
      rope.rotation.z = Math.PI / 2;
      rope.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      rope.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
      rope.castShadow = false;
      g.add(rope);
    }
  }

  // 沙包架＋沙包
  const frame = new THREE.Group();
  const legA = cyl(0.06, 0.06, 2.2, C.metalDark, 8);
  legA.position.set(-0.5, 1.1, 0);
  const legB = legA.clone();
  legB.position.x = 0.5;
  const bar = cyl(0.05, 0.05, 1.0, C.metalDark, 8);
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 2.2;
  frame.add(legA, legB, bar);
  const pivot = new THREE.Group();
  pivot.userData.dynamic = true;
  pivot.position.y = 2.2;
  const chain = cyl(0.02, 0.02, 0.4, C.metal, 6);
  chain.position.y = -0.2;
  const bag = cyl(0.22, 0.25, 0.9, C.red, 12);
  bag.position.y = -0.85;
  pivot.add(chain, bag);
  frame.add(pivot);
  frame.position.set(2.0, 0, -0.6);
  frame.rotation.y = 0.5;
  g.add(frame);

  return {
    group: g,
    update(t) {
      pivot.rotation.x = Math.sin(t * 2.6) * 0.35;
      pivot.rotation.z = Math.cos(t * 1.9) * 0.12;
    },
    obstacles: [[-0.3, 0.3, 1.9], [2.0, -0.6, 0.8]],
  };
}

// FPV 島：起降台、兩道穿越門、無人機繞島穿門
function buildFpv(info) {
  const g = new THREE.Group();
  const padY = 0.3;
  const pad = cyl(1.0, 1.1, padY, C.concrete, 24);
  pad.position.set(0, padY / 2, 0);
  g.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 6, 24), mat(C.roof));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = padY + 0.01;
  g.add(ring);
  const hLetter = rbox(0.5, 0.03, 0.12, C.roof, 0.005);
  hLetter.position.y = padY + 0.01;
  g.add(hLetter);
  for (const x of [-0.19, 0.19]) {
    const l = rbox(0.12, 0.03, 0.5, C.roof, 0.005);
    l.position.set(x, padY + 0.01, 0);
    g.add(l);
  }
  // 機庫（半圓拱）＋小帳篷
  const hangar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.4, 14, 1, false, 0, Math.PI), mat(C.wall));
  hangar.rotation.z = Math.PI / 2;
  hangar.rotation.y = Math.PI / 2;
  hangar.position.set(-1.6, 0, -1.4);
  hangar.castShadow = true;
  hangar.receiveShadow = true;
  g.add(hangar);
  const hangarBack = new THREE.Mesh(new THREE.CircleGeometry(0.6, 14, 0, Math.PI), mat(C.roof, { side: THREE.DoubleSide }));
  hangarBack.position.set(-1.6, 0, -2.1);
  hangarBack.rotation.y = Math.PI;
  g.add(hangarBack);
  const tent = pyramid(0.6, 0.6, C.yellow);
  tent.position.set(1.7, 0.3, 1.2);
  g.add(tent);

  // 飛行路徑：橢圓繞島；門放在路徑上
  const path = { rx: 2.6, rz: 2.0, y: 1.6 };
  const gateAngles = [0.6, 0.6 + Math.PI];
  const gates = [];
  for (const a of gateAngles) {
    const gate = new THREE.Group();
    const frameMesh = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 8, 20), mat(C.roof));
    frameMesh.castShadow = true;
    gate.add(frameMesh);
    const flag = rbox(0.18, 0.12, 0.02, C.yellow, 0.01);
    flag.position.set(0, 0.72, 0);
    gate.add(flag);
    for (const sx of [-1, 1]) {
      const leg = cyl(0.03, 0.03, path.y, C.metalDark, 6);
      leg.position.set(sx * 0.55, -path.y / 2 + 0.15, 0);
      gate.add(leg);
    }
    gate.position.set(Math.cos(a) * path.rx, path.y, Math.sin(a) * path.rz);
    // 面向切線方向
    const tx = -Math.sin(a) * path.rx;
    const tz = Math.cos(a) * path.rz;
    gate.rotation.y = -Math.atan2(tz, tx) + Math.PI / 2;
    g.add(gate);
    gates.push(gate);
  }

  // 無人機
  const drone = new THREE.Group();
  drone.name = 'fpv-drone'; // audio.tick 用：算無人機到鏡頭的距離
  drone.userData.dynamic = true;
  drone.scale.setScalar(1.6);
  const body = rbox(0.3, 0.1, 0.3, C.text, 0.03);
  drone.add(body);
  const cam = rbox(0.08, 0.08, 0.08, C.red, 0.02);
  cam.position.set(0.17, 0, 0);
  drone.add(cam);
  const rotors = [];
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
    const arm = rbox(0.06, 0.04, 0.06, C.metalDark, 0.01);
    arm.position.set(x, 0, z);
    drone.add(arm);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.015, 10), mat(C.metal, { transparent: true, opacity: 0.55 }));
    rotor.position.set(x, 0.04, z);
    drone.add(rotor);
    rotors.push(rotor);
  }
  g.add(drone);

  const tmp = new THREE.Vector3();
  return {
    group: g,
    update(t) {
      const a = t * 0.9;
      drone.position.set(Math.cos(a) * path.rx, path.y + Math.sin(a * 2) * 0.18, Math.sin(a) * path.rz);
      tmp.set(-Math.sin(a) * path.rx, 0, Math.cos(a) * path.rz);
      drone.rotation.set(0, -Math.atan2(tmp.z, tmp.x), 0);
      drone.rotateZ(-0.35); // 前傾飛行
      for (const r of rotors) r.rotation.y = t * 40;
    },
    obstacles: [
      [0, 0, 1.25], [-1.6, -1.7, 0.95], [1.7, 1.2, 0.55],
      ...gateAngles.map((a) => [Math.cos(a) * path.rx, Math.sin(a) * path.rz, 0.75]),
    ],
  };
}

// 橋梁查驗島：橋墩、橋面、吊車；進度條 ∝ progress（只顯示進度）
function buildBridge(info) {
  const g = new THREE.Group();
  const span = 3.6;
  const deckY = 1.3;
  for (let i = 0; i < 4; i++) {
    const x = -span / 2 + (span * i) / 3;
    const pier = rbox(0.34, deckY, 0.7, C.concrete, 0.06);
    pier.position.set(x, deckY / 2, 0);
    g.add(pier);
  }
  const deck = rbox(span + 0.6, 0.22, 1.0, C.metal, 0.05);
  deck.position.set(0, deckY + 0.11, 0);
  g.add(deck);
  for (const z of [-0.5, 0.5]) {
    const rail = rbox(span + 0.6, 0.08, 0.06, C.metalDark, 0.02);
    rail.position.set(0, deckY + 0.45, z);
    g.add(rail);
  }
  // 拱肋
  const arch = new THREE.Mesh(new THREE.TorusGeometry(span / 2 - 0.1, 0.06, 8, 24, Math.PI), mat(C.roof));
  arch.position.set(0, deckY + 0.2, 0);
  g.add(arch);

  // 吊車
  const crane = new THREE.Group();
  const mast = rbox(0.22, 3.0, 0.22, C.yellow, 0.03);
  mast.position.y = 1.5;
  crane.add(mast);
  const jibPivot = new THREE.Group();
  jibPivot.userData.dynamic = true;
  jibPivot.position.y = 3.0;
  const jib = rbox(2.4, 0.14, 0.14, C.yellow, 0.03);
  jib.position.x = 0.8;
  const counter = rbox(0.5, 0.3, 0.3, C.metalDark, 0.04);
  counter.position.x = -0.5;
  const cable = cyl(0.015, 0.015, 1.2, C.metalDark, 4);
  cable.position.set(1.7, -0.6, 0);
  const hook = rbox(0.18, 0.18, 0.18, C.red, 0.03);
  hook.position.set(1.7, -1.25, 0);
  jibPivot.add(jib, counter, cable, hook);
  crane.add(jibPivot);
  crane.position.set(1.2, 0, -1.7);
  g.add(crane);

  // 進度條：底槽＋填充，進度由 visual.progress 決定
  const progressRaw = info.visual?.progress;
  const progress = Number.isFinite(progressRaw) ? THREE.MathUtils.clamp(progressRaw, 0, 1) : 0;
  const sign = new THREE.Group();
  const barW = 2.2;
  for (const x of [-0.9, 0.9]) {
    const post = cyl(0.05, 0.05, 1.0, C.woodDark, 6);
    post.position.set(x, 0.5, 0);
    sign.add(post);
  }
  const board = rbox(barW + 0.3, 0.6, 0.1, C.wall, 0.05);
  board.position.set(0, 1.05, 0);
  sign.add(board);
  const barBg = rbox(barW, 0.22, 0.06, C.concrete, 0.04);
  barBg.position.set(0, 0.95, 0.07);
  sign.add(barBg);
  const fillW = Math.max(0.001, (barW - 0.06) * progress);
  const fill = rbox(fillW, 0.16, 0.06, C.roof, 0.03, { emissive: 0xe0703f, emissiveIntensity: 0.25 });
  fill.position.set(-(barW - 0.06) / 2 + fillW / 2, 0.95, 0.1);
  fill.visible = progress > 0.01;
  sign.add(fill);
  const label = rbox(1.0, 0.1, 0.04, C.text, 0.01);
  label.position.set(-0.55, 1.22, 0.08);
  sign.add(label);
  sign.position.set(-0.6, 0, 1.9);
  g.add(sign);
  g.userData.progress = progress;

  return {
    group: g,
    update(t) {
      jibPivot.rotation.y = Math.sin(t * 0.25) * 0.9;
    },
    obstacles: [[-1.3, 0, 0.8], [0, 0, 0.8], [1.3, 0, 0.8], [1.2, -1.7, 0.45], [-1.2, 1.9, 0.5], [0, 1.9, 0.5]],
  };
}

// 把島上不會動、用共用材質的網格依材質合併成一個，大幅減少 draw call
function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const victims = [];
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.material?.userData?.cached) return;
    for (let o = obj; o && o !== group; o = o.parent) if (o.userData.dynamic) return;
    const geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    geo.applyMatrix4(new THREE.Matrix4().copy(inv).multiply(obj.matrixWorld));
    if (!buckets.has(obj.material)) buckets.set(obj.material, []);
    buckets.get(obj.material).push(geo);
    victims.push(obj);
  });
  for (const obj of victims) { obj.removeFromParent(); obj.geometry.dispose(); }
  for (const [material, geos] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    for (const g of geos) g.dispose();
  }
}

const BUILDERS = { brand: buildBrand, ai: buildAi, port: buildPort, lib: buildLib, box: buildBox, fpv: buildFpv, bridge: buildBridge };

export function buildDecor(scene, world) {
  const updaters = [];
  const hub = world.islands.get('brand');
  for (const [id, island] of world.islands) {
    const outward = island.center.lengthSq() > 0 ? island.center.clone().normalize() : new THREE.Vector3(1, 0, 0);
    const build = BUILDERS[id];
    const seed = id.length * 131 + island.info.q * 17 + island.info.r * 7;
    const g = new THREE.Group();
    g.position.copy(island.center);
    g.position.y = GROUND_Y;
    island.mounds = mounds(g, seed);
    island.obstacles = [];
    if (build) {
      const { group, update, obstacles } = build(island.info, outward);
      g.add(group);
      if (update) updaters.push(update);
      if (obstacles) island.obstacles.push(...obstacles);
    }
    // 棧橋落點方向不放東西；港口的碼頭方向也空出來
    const blocked = [];
    if (hub && island !== hub) blocked.push(Math.atan2(-outward.z, -outward.x));
    if (island === hub) for (const other of world.islands.values()) if (other !== hub) blocked.push(Math.atan2(other.center.z, other.center.x));
    if (id === 'port') blocked.push(Math.atan2(outward.z, outward.x));
    island.props = scatterProps(g, island.obstacles, rng(seed + 999), blocked);
    island.benches = island.props.filter((o) => o.kind === 'bench').map((b) => ({ x: b.x, z: b.z, ry: b.ry, taken: false }));
    mergeStatic(g);
    scene.add(g);
    island.decor = g;
  }
  return { update(t) { for (const u of updaters) u(t); } };
}
