// 小人：Q 版公仔（頭身比 1:2），部件用 InstancedMesh 分池，動畫用隱形骨架算矩陣再寫回
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GROUND_Y, APOTHEM } from './world.js';

const SKIN = [0xffd9b8, 0xf0c29a, 0xd8a079];
const BLUSH = 0xf59a8a;
const EYE = 0x2a2420;

// 角色外觀（顏色）與行為參數
const ROLES = {
  kang: { shirt: 0x1d2b53, pants: 0x3a3a46, hat: 'capBack', hatColor: 0x2f6fd6, mustache: true, idleP: 0.5 },
  'agent-claude': { shirt: 0xe0703f, pants: 0x4a4a58, antenna: 0xe0703f, idleP: 0.4 },
  'agent-codex': { shirt: 0x6cbf84, pants: 0x4a4a58, antenna: 0x6cbf84, idleP: 0.4 },
  'agent-agy': { shirt: 0x5b8def, pants: 0x4a4a58, antenna: 0x5b8def, idleP: 0.4 },
  pilot: { shirt: 0x3d4a5c, pants: 0x2a2f3a, goggles: true, idleP: 0.75 },
  boxer: { shirt: 0xfff3e4, pants: 0xd94b3c, gloves: true, headband: 0x2a2420, idleP: 0.6 },
  engineer: { shirt: 0x5b7fa6, pants: 0x3a3a46, hat: 'hardhat', hatColor: 0xf3c64c, vest: true, idleP: 0.5 },
  postman: { shirt: 0x4c7fd1, pants: 0x2a3a66, hat: 'cap', hatColor: 0x2f5fb8, bag: true, idleP: 0.1 },
  resident: { shirtPool: [0xf3c64c, 0xe08fb0, 0x8fd1c4, 0xf0a05a, 0xb59bd6], pants: 0x5a5a66, idleP: 0.45 },
};

/* ---------- 部件池 ---------- */

const plastic = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
const glow = new THREE.MeshBasicMaterial({ color: 0xffffff });
const lensMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.35 });

class Pool {
  constructor(geo, capacity, material = plastic, shadow = true) {
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.castShadow = shadow;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.color = new THREE.Color();
  }
  alloc(color) {
    const i = this.mesh.count++;
    this.mesh.setColorAt(i, this.color.set(color));
    return i;
  }
  set(i, matrix) { this.mesh.setMatrixAt(i, matrix); }
  commit() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

function tr(geo, x, y, z) { return geo.translate(x, y, z); }

function makeGeometries() {
  const capBrim = tr(new THREE.BoxGeometry(0.24, 0.035, 0.2), 0, 0.14, 0.26);
  const capTop = tr(new THREE.CylinderGeometry(0.235, 0.24, 0.11, 14), 0, 0.185, 0);
  // 工程帽整體抬高，帽簷才不會切到眼睛
  // 反戴棒球帽：帽簷朝後、帽扣朝前
  const capBackTop = tr(new THREE.CylinderGeometry(0.235, 0.24, 0.11, 14), 0, 0.185, 0);
  const capBackBrim = tr(new THREE.BoxGeometry(0.24, 0.035, 0.2), 0, 0.14, -0.26);
  const capSnap = tr(new THREE.BoxGeometry(0.1, 0.05, 0.03), 0, 0.15, 0.235);
  const hatDome = tr(new THREE.SphereGeometry(0.27, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.1, 0);
  const hatBrim = tr(new THREE.CylinderGeometry(0.33, 0.33, 0.03, 14), 0, 0.11, 0);
  return {
    head: new THREE.SphereGeometry(0.225, 18, 14),
    eye: new THREE.SphereGeometry(0.03, 8, 6),
    blush: new THREE.SphereGeometry(1, 8, 6),
    body: new THREE.CapsuleGeometry(0.15, 0.16, 4, 14),
    arm: tr(new THREE.CapsuleGeometry(0.05, 0.12, 3, 10), 0, -0.1, 0),
    hand: tr(new THREE.SphereGeometry(0.065, 10, 8), 0, -0.21, 0),
    leg: tr(new THREE.CapsuleGeometry(0.055, 0.08, 3, 10), 0, -0.1, 0),
    shoe: tr(new THREE.SphereGeometry(1, 10, 8).scale(0.075, 0.05, 0.1), 0, -0.19, 0.025),
    cap: mergeGeometries([capTop, capBrim]),
    capBack: mergeGeometries([capBackTop, capBackBrim, capSnap]),
    mustache: tr(new THREE.BoxGeometry(0.13, 0.022, 0.03), 0, -0.065, 0.215),
    hardhat: mergeGeometries([hatDome, hatBrim]),
    headband: tr(new THREE.TorusGeometry(0.228, 0.035, 6, 18).rotateX(Math.PI / 2), 0, 0.07, 0),
    // 一體式盒狀 FPV 眼鏡：黑框＋深色略反光鏡面＋兩根向外斜立的扁天線
    gogFrame: tr(new RoundedBoxGeometry(0.48, 0.18, 0.16, 2, 0.05), 0, 0.03, 0.17),
    gogLens: tr(new RoundedBoxGeometry(0.42, 0.12, 0.03, 2, 0.012), 0, 0.03, 0.245),
    gogAnt: tr(new THREE.BoxGeometry(0.03, 0.24, 0.012), 0, 0.12, 0),
    antenna: tr(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 6), 0, 0.3, 0),
    bulb: tr(new THREE.SphereGeometry(0.05, 8, 6), 0, 0.41, 0),
    glove: tr(new THREE.SphereGeometry(0.155, 12, 10), 0, -0.26, 0),
    vest: new RoundedBoxGeometry(0.35, 0.3, 0.35, 2, 0.08),
    stripe: new THREE.BoxGeometry(0.37, 0.035, 0.37),
    bag: new RoundedBoxGeometry(0.12, 0.17, 0.09, 2, 0.03),
    ctrl: new RoundedBoxGeometry(0.24, 0.05, 0.14, 2, 0.02),
    stick: new THREE.CylinderGeometry(0.012, 0.012, 0.07, 6),
    tablet: new THREE.BoxGeometry(0.16, 0.21, 0.015),
    crate: new RoundedBoxGeometry(0.26, 0.26, 0.26, 2, 0.03),
    letter: new THREE.BoxGeometry(0.3, 0.02, 0.2),
    camera: new RoundedBoxGeometry(0.12, 0.08, 0.06, 2, 0.02),
  };
}

/* ---------- 導航圖 ---------- */

function segClear(ax, az, bx, bz, obstacles, margin) {
  for (const [ox, oz, r] of obstacles) {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = THREE.MathUtils.clamp(((ox - ax) * dx + (oz - az) * dz) / len2, 0, 1);
    const px = ax + dx * t;
    const pz = az + dz * t;
    if (Math.hypot(ox - px, oz - pz) < r + margin) return false;
  }
  return true;
}

function moundHeight(island, lx, lz) {
  let h = 0;
  for (const m of island.mounds || []) {
    const d = Math.hypot(lx - m.x, lz - m.z);
    if (d < m.r) h = Math.max(h, m.sy * m.r * Math.sqrt(1 - (d / m.r) ** 2));
  }
  return h;
}

// 每島三圈候選點 → 障礙過濾 → 線段無遮擋才連邊；棧橋兩端節點把全島接起來
function buildNavGraph(world) {
  const nodes = [];
  const adj = [];
  const hub = world.islands.get('brand');
  const byIsland = new Map();

  const addNode = (island, lx, lz, kind) => {
    const id = nodes.length;
    const pos = new THREE.Vector3(island.center.x + lx, GROUND_Y + moundHeight(island, lx, lz), island.center.z + lz);
    nodes.push({ id, island, lx, lz, pos, kind });
    adj.push([]);
    byIsland.get(island.info.id).push(id);
    return id;
  };
  const link = (a, b, bridge = false) => {
    adj[a].push({ to: b, bridge });
    adj[b].push({ to: a, bridge });
  };

  const landings = [];
  for (const island of world.islands.values()) {
    byIsland.set(island.info.id, []);
    const obs = island.obstacles || [];
    for (const r of [1.5, 2.5, 3.3]) {
      const n = r < 2 ? 8 : 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (r > 2 ? 0.1 : 0);
        const lx = Math.cos(a) * r;
        const lz = Math.sin(a) * r;
        if (obs.some(([ox, oz, orad]) => Math.hypot(lx - ox, lz - oz) < orad + 0.3)) continue;
        addNode(island, lx, lz, 'walk');
      }
    }
    // 棧橋落點
    if (hub && island !== hub) {
      const out = island.center.clone().normalize();
      const d = APOTHEM - 0.6;
      const a = addNode(island, -out.x * d, -out.z * d, 'landing');
      const b = addNode(hub, out.x * d, out.z * d, 'landing');
      landings.push([a, b]);
    }
  }
  // 島內連邊
  for (const ids of byIsland.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const A = nodes[ids[i]];
        const B = nodes[ids[j]];
        const d = Math.hypot(A.lx - B.lx, A.lz - B.lz);
        if (d > 2.3) continue;
        if (!segClear(A.lx, A.lz, B.lx, B.lz, A.island.obstacles || [], 0.22)) continue;
        link(A.id, B.id);
      }
    }
  }
  for (const [a, b] of landings) link(a, b, true);
  return { nodes, adj, byIsland };
}

function bfsPath(graph, from, to) {
  if (from === to) return [to];
  const prev = new Int32Array(graph.nodes.length).fill(-1);
  const seen = new Uint8Array(graph.nodes.length);
  const queue = [from];
  seen[from] = 1;
  while (queue.length) {
    const cur = queue.shift();
    for (const { to: nxt } of graph.adj[cur]) {
      if (seen[nxt]) continue;
      seen[nxt] = 1;
      prev[nxt] = cur;
      if (nxt === to) {
        const path = [to];
        let p = cur;
        while (p !== -1 && p !== from) { path.unshift(p); p = prev[p]; }
        return path;
      }
      queue.push(nxt);
    }
  }
  return null;
}

/* ---------- 角色 ---------- */

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

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

class Person {
  constructor(role, spec, pools, rand, index) {
    this.role = role;
    this.spec = spec;
    this.rand = rand;
    this.index = index;
    this.height = 1.0 * (0.95 + rand() * 0.1);
    this.speed = 0.75 * (0.85 + rand() * 0.3);
    this.skin = SKIN[Math.floor(rand() * SKIN.length)];
    this.shirt = spec.shirtPool ? spec.shirtPool[Math.floor(rand() * spec.shirtPool.length)] : spec.shirt;
    this.parts = []; // {pool, idx, node, local, detail, item}
    this.items = {}; // 可開關的道具
    this.buildSkeleton(pools);

    this.state = 'idle';
    this.path = [];
    this.node = -1;
    this.heading = rand() * Math.PI * 2;
    this.faceTarget = null;
    this.walkPhase = rand() * 10;
    this.idleT = 0;
    this.idleDur = 0;
    this.action = null;
    this.actionT = 0;
    this.blinkT = 3 + rand() * 3;
    this.blink = 0;
    this.carry = false;
    this.pose = { legL: 0, legR: 0, armL: 0, armR: 0, armLz: 0, armRz: 0, headX: 0, headZ: 0, bob: 0, hatY: 0, gogUp: 0, sit: 0 };
  }

  attach(node, pool, color, local, flags = {}) {
    const idx = pool.alloc(color);
    const part = { pool, idx, node, local: local || new THREE.Matrix4(), ...flags };
    this.parts.push(part);
    return part;
  }

  buildSkeleton(pools) {
    const spec = this.spec;
    const root = new THREE.Object3D();
    const hips = new THREE.Object3D();
    hips.position.y = 0.22;
    const legL = new THREE.Object3D();
    legL.position.set(-0.075, 0, 0);
    const legR = new THREE.Object3D();
    legR.position.set(0.075, 0, 0);
    const torso = new THREE.Object3D();
    const shL = new THREE.Object3D();
    shL.position.set(-0.17, 0.36, 0);
    const shR = new THREE.Object3D();
    shR.position.set(0.17, 0.36, 0);
    const front = new THREE.Object3D();
    front.position.set(0, 0.3, 0.26);
    const head = new THREE.Object3D();
    head.position.set(0, 0.62, 0);
    const hat = new THREE.Object3D();
    const gog = new THREE.Object3D(); // 眼鏡：撥搖桿時推到額頭上
    root.add(hips);
    hips.add(legL, legR, torso);
    torso.add(shL, shR, front, head);
    head.add(hat, gog);
    root.scale.setScalar(this.height);
    Object.assign(this, { root, hips, legL, legR, torso, shL, shR, front, head, hat, gog });

    const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));

    this.attach(torso, pools.body, this.shirt, M(0, 0.2, 0));
    for (const [leg, sign] of [[legL, -1], [legR, 1]]) {
      this.attach(leg, pools.leg, spec.pants);
      this.attach(leg, pools.shoe, 0x3a3030);
      void sign;
    }
    for (const sh of [shL, shR]) {
      this.attach(sh, pools.arm, this.shirt);
      if (spec.gloves) this.attach(sh, pools.glove, 0xd94b3c);
      else this.attach(sh, pools.hand, this.skin);
    }
    this.attach(head, pools.head, this.skin);
    for (const sx of [-1, 1]) {
      this.eyeParts = this.eyeParts || [];
      this.eyeParts.push(this.attach(head, pools.eye, EYE, M(sx * 0.085, 0.02, 0.2), { detail: true }));
      this.attach(head, pools.blush, BLUSH, M(sx * 0.15, -0.05, 0.165, 0.05, 0.03, 0.02), { detail: true });
    }
    if (spec.hat === 'cap') this.attach(hat, pools.cap, spec.hatColor);
    if (spec.hat === 'capBack') this.attach(hat, pools.capBack, spec.hatColor);
    if (spec.hat === 'hardhat') this.attach(hat, pools.hardhat, spec.hatColor);
    if (spec.mustache) this.attach(head, pools.mustache, 0x5a3a22, undefined, { detail: true });
    if (spec.headband) this.attach(hat, pools.headband, spec.headband);
    if (spec.goggles) {
      this.attach(gog, pools.gogFrame, 0x2a2420);
      this.attach(gog, pools.gogLens, 0x2b3340);
      for (const sx of [-1, 1]) {
        const tilt = new THREE.Matrix4().makeRotationZ(-sx * 0.5);
        this.attach(gog, pools.gogAnt, 0x2a2420, new THREE.Matrix4().makeTranslation(sx * 0.19, 0.1, 0.17).multiply(tilt));
      }
    }
    if (spec.antenna) {
      this.attach(hat, pools.antenna, 0x5b666e);
      this.bulb = this.attach(hat, pools.bulb, spec.antenna, undefined, { bulb: true });
    }
    if (spec.vest) {
      this.attach(torso, pools.vest, 0xf07a2a, M(0, 0.19, 0));
      this.attach(torso, pools.stripe, 0xffffff, M(0, 0.12, 0));
      this.attach(torso, pools.stripe, 0xffffff, M(0, 0.25, 0));
    }
    if (spec.bag) this.attach(torso, pools.bag, 0x8a5a34, M(0.2, 0.08, 0.02));

    // 道具（預設隱藏）
    const item = (name, node, pool, color, local, flags = {}) => {
      this.items[name] = this.attach(node, pool, color, local, { item: true, visible: false, ...flags });
    };
    if (this.role === 'pilot') {
      item('ctrl', front, pools.ctrl, 0x2a2420, M(0, 0, 0));
      item('stickL', front, pools.stick, 0x9aa5ad, M(-0.06, 0.05, 0), { stick: -1, detail: true });
      item('stickR', front, pools.stick, 0x9aa5ad, M(0.06, 0.05, 0), { stick: 1, detail: true });
    }
    if (this.role === 'engineer') item('tablet', shL, pools.tablet, 0x3a3a46, M(0, -0.2, 0.06));
    if (this.role.startsWith('agent')) item('crate', front, pools.crate, 0xc79a6b, M(0, -0.02, 0.05));
    if (this.role === 'postman') item('letter', hat, pools.letter, 0xffffff, M(0, 0.265, 0.02));
    if (this.role === 'resident') item('camera', front, pools.camera, 0x2a2420, M(0, 0.25, 0));
  }

  setItem(name, on) {
    if (this.items[name]) this.items[name].visible = on;
  }
}

/* ---------- 主體 ---------- */

export function buildPeople(scene, world, data) {
  const graph = buildNavGraph(world);
  const pools = {};
  const geos = makeGeometries();
  const caps = {
    head: 30, eye: 60, blush: 60, body: 30, arm: 60, hand: 60, leg: 60, shoe: 60, cap: 8, hardhat: 6, headband: 6,
    gogFrame: 6, gogLens: 6, gogAnt: 12, capBack: 2, mustache: 2, antenna: 12, bulb: 12, glove: 10, vest: 6, stripe: 12, bag: 6, ctrl: 6, stick: 12,
    tablet: 6, crate: 12, letter: 6, camera: 8,
  };
  for (const [name, geo] of Object.entries(geos)) {
    const material = name === 'bulb' ? glow : name === 'gogLens' ? lensMat : plastic;
    pools[name] = new Pool(geo, caps[name] || 30, material, !(name === 'eye' || name === 'blush' || name === 'stick' || name === 'mustache'));
    scene.add(pools[name].mesh);
  }

  const people = [];
  const rand = rng(20261025);
  const usedStart = new Set();
  let total = 0;
  for (const entry of data.people) {
    const spec = ROLES[entry.role];
    if (!spec || !Number.isInteger(entry.count)) continue;
    const island = world.islands.get(entry.island) || world.islands.get('brand');
    for (let i = 0; i < entry.count && total < 30; i++) {
      const p = new Person(entry.role, spec, pools, rand, people.length);
      p.home = island;
      const ids = graph.byIsland.get(island.info.id) || [];
      const walkIds = ids.filter((id) => graph.nodes[id].kind === 'walk');
      const free = walkIds.filter((id) => !usedStart.has(id));
      const pick = free.length ? free : walkIds.length ? walkIds : ids;
      p.node = pick[Math.floor(rand() * pick.length)];
      usedStart.add(p.node);
      p.root.position.copy(graph.nodes[p.node].pos);
      p.idleDur = rand() * 3;
      people.push(p);
      total++;
    }
  }

  const islandWalkNodes = (islandId) => (graph.byIsland.get(islandId) || []).filter((id) => graph.nodes[id].kind === 'walk');
  const pickDestination = (p) => {
    const r = p.rand;
    if (p.role === 'postman') {
      // 港口 ↔ 資產庫
      const target = p.carry ? 'lib' : 'port';
      const ids = islandWalkNodes(target);
      return ids[Math.floor(r() * ids.length)];
    }
    if (p.role === 'resident' && r() < 0.3) {
      // 找一張沒人坐的長椅，走到離它最近的節點
      const island = graph.nodes[p.node].island;
      const candidates = [island, ...world.islands.values()].filter((isl) => (isl.benches || []).some((b) => !b.taken));
      if (candidates.length) {
        const isl = candidates[Math.floor(r() * candidates.length)];
        const b = isl.benches.find((bb) => !bb.taken);
        let best = null; let bd = Infinity;
        for (const id of islandWalkNodes(isl.info.id)) { const n = graph.nodes[id]; const d = Math.hypot(n.lx - b.x, n.lz - b.z); if (d < bd) { bd = d; best = id; } }
        if (best !== null) return best;
      }
    }
    if (p.role === 'resident' && r() < 0.35) {
      const islands = [...world.islands.keys()];
      const ids = islandWalkNodes(islands[Math.floor(r() * islands.length)]);
      if (ids.length) return ids[Math.floor(r() * ids.length)];
    }
    const ids = islandWalkNodes(p.home.info.id);
    return ids.length ? ids[Math.floor(r() * ids.length)] : p.node;
  };

  const pickAction = (p) => {
    const r = p.rand();
    switch (p.role) {
      case 'kang': return 'wave';
      case 'pilot': return 'pilot';
      case 'boxer': return 'jab';
      case 'engineer': return 'point';
      case 'postman': return p.carry ? 'deliver' : 'pickup';
      case 'resident': return r < 0.5 ? 'gaze' : 'photo';
      default: return r < 0.5 ? 'carry' : 'wave';
    }
  };

  // 目的地互相預留，避免兩個人站到同一個點上
  const reserved = new Set();
  const startWalk = (p) => {
    if (p.dest !== undefined) reserved.delete(p.dest);
    let dest = pickDestination(p);
    for (let i = 0; i < 6 && (reserved.has(dest) || dest === p.node); i++) dest = pickDestination(p);
    p.dest = dest;
    reserved.add(dest);
    const path = bfsPath(graph, p.node, dest);
    if (!path || path.length === 0) { p.state = 'idle'; p.idleDur = 2; p.idleT = 0; return; }
    p.path = path;
    p.state = 'walk';
    p.segT = 0;
    p.action = null;
    // agent 走路時有時搬箱子
    if (p.role.startsWith('agent')) p.setItem('crate', p.rand() < 0.4);
  };

  // 居民：附近有空長椅就走過去坐
  const seatPoint = (island, b) => new THREE.Vector3(island.center.x + b.x + Math.sin(b.ry) * 0.06, GROUND_Y + 0.33 - 0.2, island.center.z + b.z + Math.cos(b.ry) * 0.06);
  const trySit = (p) => {
    const island = graph.nodes[p.node].island;
    const here = p.root.position;
    const b = (island.benches || []).find((bb) => !bb.taken && Math.hypot(island.center.x + bb.x - here.x, island.center.z + bb.z - here.z) < 2.6);
    if (!b) return false;
    b.taken = true;
    p.bench = b;
    p.benchIsland = island;
    p.sitPos = seatPoint(island, b);
    p.returnPos = here.clone();
    p.state = 'tosit';
    p.action = 'sit';
    p.actionT = 0;
    p.idleT = 0;
    p.idleDur = 6 + p.rand() * 6;
    return true;
  };

  const startIdle = (p) => {
    if (p.role === 'resident' && p.rand() < 0.8 && trySit(p)) return;
    p.state = 'idle';
    p.idleT = 0;
    p.idleDur = 4 + p.rand() * 6;
    p.action = pickAction(p);
    p.actionT = 0;
    const island = graph.nodes[p.node].island;
    const toCenter = island.center.clone().sub(p.root.position);
    // 招牌動作面向：工廠／橋／擂台在島中心；看海面向外
    if (p.action === 'gaze') p.faceTarget = Math.atan2(-toCenter.x, -toCenter.z);
    else if (['wave', 'point', 'pilot', 'jab'].includes(p.action)) p.faceTarget = Math.atan2(toCenter.x, toCenter.z);
    else p.faceTarget = null;
    if (p.action === 'carry') p.setItem('crate', true);
    if (p.action === 'photo') p.setItem('camera', true);
    if (p.action === 'pilot') { p.setItem('ctrl', true); p.setItem('stickL', true); p.setItem('stickR', true); }
  };

  const endIdle = (p) => {
    if (p.action === 'deliver') { p.carry = false; p.setItem('letter', false); }
    if (p.action === 'pickup') { p.carry = true; p.setItem('letter', true); }
    p.setItem('camera', false);
    p.setItem('crate', false);
    p.setItem('ctrl', false); p.setItem('stickL', false); p.setItem('stickR', false);
    p.action = null;
    startWalk(p);
  };

  for (const p of people) {
    if (p.role === 'postman') { p.carry = true; p.setItem('letter', true); }
    if (p.role === 'engineer') p.setItem('tablet', true);
  }

  const tmp = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const LOD_FAR = 26;
  const ease = (a, b, k) => a + (b - a) * k;
  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function animate(p, dt, t) {
    const pose = p.pose;
    const target = { legL: 0, legR: 0, armL: 0, armR: 0, armLz: 0, armRz: 0, headX: 0, headZ: 0, bob: 0, hatY: 0, gogUp: 0, sit: 0 };
    const k = Math.min(1, dt * 10);

    if (p.state === 'walk' || p.state === 'tosit' || p.state === 'fromsit') {
      p.walkPhase += dt * p.speed * 9;
      const s = Math.sin(p.walkPhase);
      target.legL = s * 0.7;
      target.legR = -s * 0.7;
      target.armL = -s * 0.5;
      target.armR = s * 0.5;
      target.bob = Math.abs(Math.cos(p.walkPhase)) * 0.04;
      if (p.items.crate?.visible) { target.armL = target.armR = -1.3; }
      if (p.role === 'engineer') target.armL = -0.6;
      if (p.role === 'pilot') { target.armL = target.armR = -0.3; }
    } else if (p.state === 'sit') {
      target.sit = 1;
      target.legL = target.legR = -1.45;
      target.armL = target.armR = -0.35;
      target.headZ = Math.sin(p.actionT * 0.6) * 0.12;
    } else {
      const a = p.actionT;
      switch (p.action) {
        case 'wave':
          target.armR = -2.6;
          target.armRz = Math.sin(a * 8) * 0.5 - 0.3;
          target.headZ = Math.sin(a * 2) * 0.15;
          target.hatY = Math.max(0, Math.sin(a * 2)) * 0.05;
          break;
        case 'carry':
          target.armL = target.armR = -1.3;
          target.bob = Math.abs(Math.sin(a * 3)) * 0.02;
          break;
        case 'pilot':
          target.gogUp = 1;
          target.armL = target.armR = -1.25;
          target.armLz = 0.35; target.armRz = -0.35;
          target.headX = -0.45 + Math.sin(a * 1.3) * 0.1;
          target.headZ = Math.sin(a * 0.7) * 0.12;
          break;
        case 'jab': {
          const beat = a * 7;
          const left = Math.max(0, Math.sin(beat));
          const right = Math.max(0, Math.sin(beat + Math.PI));
          target.armL = -1.2 - left * 1.0;
          target.armR = -1.2 - right * 1.0;
          target.armLz = 0.25; target.armRz = -0.25;
          target.bob = Math.abs(Math.sin(beat * 0.5)) * 0.05;
          target.headZ = (left - right) * 0.1;
          break;
        }
        case 'point':
          target.armR = -1.6 + Math.sin(a * 2) * 0.15;
          target.armRz = -0.4;
          target.armL = -0.9;
          target.headX = -0.15;
          break;
        case 'deliver':
        case 'pickup':
          target.armL = target.armR = -2.2 + Math.min(1, a) * 0.8;
          break;
        case 'gaze':
          target.armR = -2.5; target.armRz = -0.9;
          target.headX = -0.1;
          target.headZ = Math.sin(a * 0.8) * 0.2;
          break;
        case 'photo':
          target.armL = target.armR = -2.0;
          target.armLz = 0.3; target.armRz = -0.3;
          target.headX = -0.05;
          break;
        default:
          break;
      }
    }
    for (const key in target) pose[key] = ease(pose[key], target[key], k);

    p.legL.rotation.x = pose.legL;
    p.legR.rotation.x = pose.legR;
    p.shL.rotation.set(pose.armL, 0, pose.armLz);
    p.shR.rotation.set(pose.armR, 0, pose.armRz);
    p.head.rotation.set(pose.headX, 0, pose.headZ);
    p.hat.position.y = pose.hatY;
    p.gog.position.y = pose.gogUp * 0.13;
    p.gog.rotation.x = -pose.gogUp * 0.55;
    p.hips.position.y = 0.22 + pose.bob - pose.sit * 0.02;
    // 走路時身體微側擺
    p.torso.rotation.z = p.state === 'walk' ? Math.sin(p.walkPhase) * 0.04 : 0;

    // 眨眼
    p.blinkT -= dt;
    if (p.blinkT <= 0) { p.blink = 0.13; p.blinkT = 3 + p.rand() * 3; }
    if (p.blink > 0) p.blink -= dt;
  }

  function step(p, dt, t) {
    if (p.state === 'walk') {
      const from = graph.nodes[p.node];
      const to = graph.nodes[p.path[0]];
      const len = from.pos.distanceTo(to.pos);
      p.segT += (dt * p.speed) / Math.max(len, 0.001);
      if (p.segT >= 1) {
        p.node = to.id;
        p.path.shift();
        p.segT = 0;
        p.root.position.copy(to.pos);
        if (p.path.length === 0) {
          if (p.role === 'postman' || p.rand() < p.spec.idleP) startIdle(p);
          else startWalk(p);
        }
      } else {
        p.root.position.lerpVectors(from.pos, to.pos, p.segT);
        tmp.subVectors(to.pos, from.pos);
        p.faceTarget = Math.atan2(tmp.x, tmp.z);
      }
    } else if (p.state === 'tosit' || p.state === 'fromsit') {
      const goal = p.state === 'tosit' ? p.sitPos : p.returnPos;
      tmp.subVectors(goal, p.root.position);
      tmp.y = 0;
      const d = tmp.length();
      const stepLen = dt * p.speed * 0.8;
      if (d <= stepLen) {
        if (p.state === 'tosit') {
          p.root.position.copy(p.sitPos);
          p.state = 'sit';
          p.faceTarget = p.bench.ry;
        } else {
          p.root.position.copy(p.returnPos);
          p.bench.taken = false;
          p.bench = null;
          startWalk(p);
        }
      } else {
        p.root.position.addScaledVector(tmp.normalize(), stepLen);
        p.root.position.y = goal.y;
        p.faceTarget = Math.atan2(tmp.x, tmp.z);
      }
    } else if (p.state === 'sit') {
      p.idleT += dt;
      p.actionT += dt;
      if (p.idleT >= p.idleDur && !p.forceAction) {
        p.state = 'fromsit';
        p.action = null;
        p.root.position.y = p.returnPos.y;
      }
    } else {
      p.idleT += dt;
      p.actionT += dt;
      if (p.forceAction && p.actionT > 3) p.actionT = 0;
      if (p.idleT >= p.idleDur && !p.forceAction) {
        if (p.action === null) startWalk(p); else endIdle(p);
      }
    }
    if (p.faceTarget !== null) {
      const diff = wrapAngle(p.faceTarget - p.heading);
      p.heading += diff * Math.min(1, dt * 7);
    }
    p.root.rotation.y = p.heading;
  }

  function writeMatrices(p, camera) {
    p.root.updateMatrixWorld(true);
    const far = camPos.distanceTo(p.root.position) > LOD_FAR;
    for (const part of p.parts) {
      let hidden = part.item && !part.visible;
      if (part.detail && far) hidden = true;
      if (hidden) {
        _m.makeScale(0, 0, 0);
        part.pool.set(part.idx, _m);
        continue;
      }
      _m.multiplyMatrices(part.node.matrixWorld, part.local);
      if (part.pool === pools.eye && p.blink > 0) {
        _m.scale(_s.set(1, 0.15, 1));
      }
      if (part.stick) {
        // 搖桿撥動
        const rot = new THREE.Matrix4().makeRotationX(Math.sin(p.actionT * 9 + part.stick) * 0.5);
        _m.multiply(rot);
      }
      part.pool.set(part.idx, _m);
    }
    if (p.bulb) {
      // 天線燈閃爍
      const on = Math.sin(p.index * 1.7 + performance.now() * 0.004) > 0;
      pools.bulb.mesh.setColorAt(p.bulb.idx, new THREE.Color(p.spec.antenna).multiplyScalar(on ? 1.6 : 0.45));
    }
  }

  let frozen = false;
  return {
    people,
    graph,
    setFrozen(v) { frozen = v; },
    find(role, idx = 0) { return people.filter((p) => p.role === role)[idx]; },
    // 除錯：讓某人立刻開始並一直重複招牌動作
    forceAction(p, action) {
      p.forceAction = true;
      p.path = [];
      p.root.position.copy(graph.nodes[p.node].pos);
      if (action === 'sit') {
        // 搬到有長椅的島、離長椅最近的節點再去坐
        const island = [...world.islands.values()].find((isl) => (isl.benches || []).length) || graph.nodes[p.node].island;
        const b = (island.benches || [])[0];
        if (b) {
          const ids = graph.byIsland.get(island.info.id);
          let best = p.node; let bd = Infinity;
          for (const id of ids) { const n = graph.nodes[id]; const d = Math.hypot(n.lx - b.x, n.lz - b.z); if (d < bd) { bd = d; best = id; } }
          p.node = best;
          p.root.position.copy(graph.nodes[best].pos);
          if (trySit(p)) return;
        }
      }
      startIdle(p);
    },
    update(dt, t, camera) {
      camera.getWorldPosition(camPos);
      dt = Math.min(dt, 0.05);
      for (const p of people) {
        if (!frozen) { step(p, dt, t); animate(p, dt, t); }
        writeMatrices(p, camera);
      }
      for (const pool of Object.values(pools)) pool.commit();
    },
  };
}
