// 島嶼、棧橋、海面：全部依 JSON 的 axial 座標程式產生
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';

// pointy-top 六角格：格距 HEX_SIZE，島本身外接半徑 ISLAND_R（比格子小，留海面放棧橋）
export const HEX_SIZE = 6;
export const ISLAND_R = 4.4;
export const APOTHEM = ISLAND_R * Math.sqrt(3) / 2;

const SOIL_BOTTOM = -1.8;
const SOIL_TOP = 0.6;
const GRASS_TOP = 0.95;
export const GROUND_Y = GRASS_TOP;
const DECK_Y = 0.89; // 板面頂 ≈ GROUND_Y，小人走棧橋不用換高度

export function axialToWorld(q, r) {
  return new THREE.Vector3(
    HEX_SIZE * Math.sqrt(3) * (q + r / 2),
    0,
    HEX_SIZE * 1.5 * r,
  );
}

// 頂點朝 ±z 的六角形（與 axialToWorld 的 pointy-top 方向一致）
function hexShape(radius) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + i * Math.PI / 3;
    const x = radius * Math.cos(a);
    const y = radius * Math.sin(a);
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

// 帶圓角的六角柱，從 y=bottom 長到 y=top
function roundedHexPrism(radius, bottom, top, bevel) {
  const geo = new THREE.ExtrudeGeometry(hexShape(radius - bevel), {
    depth: top - bottom - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bottom + bevel, 0);
  return geo;
}

function buildIsland(materials) {
  const group = new THREE.Group();

  const soil = new THREE.Mesh(roundedHexPrism(ISLAND_R, SOIL_BOTTOM, SOIL_TOP, 0.18), materials.soil);
  soil.castShadow = true;
  soil.receiveShadow = true;
  group.add(soil);

  const grass = new THREE.Mesh(roundedHexPrism(ISLAND_R - 0.12, SOIL_TOP - 0.05, GRASS_TOP, 0.16), materials.grass);
  grass.castShadow = true;
  grass.receiveShadow = true;
  group.add(grass);

  return group;
}

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// 從 a 到 b 的木棧橋；長度與角度由兩島實際距離算出
function buildBridge(a, b, materials) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const dist = dir.length();
  const tuck = APOTHEM - 0.35; // 兩端塞進島緣一點
  const span = dist - tuck * 2;
  if (span <= 0.2) return null;

  const width = 1.5;
  const planks = [];
  const frame = [];

  const plankDepth = 0.34;
  const gap = 0.08;
  const count = Math.max(1, Math.floor(span / (plankDepth + gap)));
  const step = span / count;
  for (let i = 0; i < count; i++) {
    const x = -span / 2 + step * (i + 0.5);
    planks.push(box(plankDepth, 0.12, width, x, 0, 0));
  }

  // 底樑、扶手、樁
  for (const side of [-1, 1]) {
    const z = side * (width / 2 - 0.1);
    frame.push(box(span, 0.14, 0.14, 0, -0.12, z));
    frame.push(box(span, 0.08, 0.08, 0, 0.55, side * (width / 2 + 0.02)));
    const posts = Math.max(2, Math.round(span / 1.4) + 1);
    for (let i = 0; i < posts; i++) {
      const x = -span / 2 + (span * i) / (posts - 1);
      frame.push(box(0.14, 1.6, 0.14, x, -0.3, side * (width / 2 + 0.02)));
    }
  }

  const group = new THREE.Group();
  for (const [geos, mat] of [[planks, materials.wood], [frame, materials.woodDark]]) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  group.position.copy(a).add(b).multiplyScalar(0.5);
  group.position.y = DECK_Y;
  group.rotation.y = -Math.atan2(dir.z, dir.x);
  return group;
}

// 海面：波紋在 vertex shader 裡算（CPU 零負擔），平面著色靠片段導數自動得到正確法線
function buildSea() {
  const geo = new THREE.PlaneGeometry(320, 320, 160, 160);
  geo.rotateX(-Math.PI / 2);
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.sea, roughness: 0.55, metalness: 0, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y += 0.16 * sin(position.x * 0.45 + uTime * 0.7)
                       + 0.12 * sin(position.z * 0.6 - uTime * 0.5)
                       + 0.08 * sin((position.x + position.z) * 0.9 + uTime * 1.1);`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return { mesh, update(t) { uniforms.uTime.value = t; } };
}

export function buildWorld(scene, data) {
  const materials = {
    soil: new THREE.MeshStandardMaterial({ color: PALETTE.soil, roughness: 0.9 }),
    grass: new THREE.MeshStandardMaterial({ color: PALETTE.grass, roughness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.8 }),
    woodDark: new THREE.MeshStandardMaterial({ color: PALETTE.woodDark, roughness: 0.85 }),
  };

  const islands = new Map();
  for (const info of data.islands) {
    const group = buildIsland(materials);
    group.position.copy(axialToWorld(info.q, info.r));
    group.userData.islandId = info.id;
    scene.add(group);
    islands.set(info.id, { info, group, center: group.position.clone() });
  }

  // 每座外圍島各一座棧橋連到中央島
  const hub = islands.get('brand');
  if (hub) {
    for (const [id, island] of islands) {
      if (id === 'brand') continue;
      const bridge = buildBridge(hub.center, island.center, materials);
      if (bridge) scene.add(bridge);
    }
  }

  const sea = buildSea();
  scene.add(sea.mesh);

  // 群島範圍：extent 給陰影相機與霧用；points 是每座島的六個角（地面高度），給鏡頭精準取景
  let extent = 0;
  const points = [];
  for (const { center } of islands.values()) {
    extent = Math.max(extent, center.length());
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + i * Math.PI / 3;
      points.push(new THREE.Vector3(center.x + ISLAND_R * Math.cos(a), GROUND_Y, center.z + ISLAND_R * Math.sin(a)));
    }
  }
  extent += ISLAND_R;

  return { islands, extent, points, update: sea.update };
}
