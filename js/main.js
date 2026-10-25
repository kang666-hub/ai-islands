// 場景、鏡頭、燈光、主迴圈
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PALETTE } from './palette.js';
import { loadData } from './data.js';
import { buildWorld, ISLAND_R } from './world.js';
import { buildDecor } from './decor.js';
import { buildPeople } from './people.js';
import { buildUI } from './ui.js';

const stage = document.getElementById('stage');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function showError(message) {
  const el = document.getElementById('error');
  el.textContent = message;
  el.hidden = false;
}

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);
  return renderer;
}

function addLights(scene, extent) {
  scene.add(new THREE.HemisphereLight(0xfff6ea, PALETTE.soil, 1.9));

  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(extent * 0.9, extent * 1.3, extent * 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  const cam = sun.shadow.camera;
  const half = extent + 2;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 1;
  cam.far = extent * 5;
  cam.updateProjectionMatrix();
  scene.add(sun);
}

// 從某個方向看過去，要退到多遠才能讓所有取樣點都落在畫面的 FILL 範圍內（二分搜尋投影結果）
const FILL = 0.9;
const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
function fitDistance(camera, target, points, polar, azimuth) {
  _dir.setFromSphericalCoords(1, polar, azimuth);
  const fits = (dist) => {
    camera.position.copy(target).addScaledVector(_dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    for (const pt of points) {
      _p.copy(pt).project(camera);
      if (Math.abs(_p.x) > FILL || Math.abs(_p.y) > FILL) return false;
    }
    return true;
  };
  let lo = 1;
  let hi = 2000;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

// 直式畫面俯角陡一點，群島的六角花形會更圓、上下留白較少
const OVERVIEW_AZIMUTH = THREE.MathUtils.degToRad(35);
function overviewPolar(aspect) {
  return THREE.MathUtils.degToRad(aspect < 1 ? 40 : 52);
}

// 縮放範圍與霧都跟著取景距離走
function applyFit(camera, controls, scene, world, polar, azimuth) {
  const dist = fitDistance(camera, controls.target, world.points, polar, azimuth);
  controls.minDistance = dist * 0.35;
  controls.maxDistance = dist * 1.4;
  scene.fog.near = dist * 1.4 + world.extent;
  scene.fog.far = dist * 1.4 + world.extent * 6;
  return dist;
}

function placeOverview(camera, controls, scene, world) {
  controls.target.set(0, 0, 0);
  const polar = overviewPolar(camera.aspect);
  const dist = applyFit(camera, controls, scene, world, polar, OVERVIEW_AZIMUTH);
  camera.position.setFromSphericalCoords(dist, polar, OVERVIEW_AZIMUTH);
  controls.update();
}

async function init() {
  let data;
  try {
    data = await loadData();
  } catch (err) {
    console.warn('islands.json 讀取失敗', err);
    showError('群島資料暫時讀不到，請稍後重新整理。');
    return;
  }

  const renderer = createRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bg);

  const world = buildWorld(scene, data);
  const decor = buildDecor(scene, world);
  const people = buildPeople(scene, world, data);
  scene.fog = new THREE.Fog(PALETTE.bg, 1, 2);
  addLights(scene, world.extent);

  const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.5, 600);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = THREE.MathUtils.degToRad(20);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(68); // 不讓鏡頭低到看見島底
  placeOverview(camera, controls, scene, world);

  // 除錯用：?focus=<島id>[&polar=度][&az=度] 直接把鏡頭放到該島特寫（8-4 的點島聚焦會另外做）
  const params = new URLSearchParams(location.search);
  const isPerson = params.has('person');
  const polarP = THREE.MathUtils.degToRad(Number(params.get('polar')) || (isPerson ? 72 : 55));
  const azP = THREE.MathUtils.degToRad(params.has('az') ? Number(params.get('az')) : (isPerson ? 0 : 35));
  const focusIsland = world.islands.get(params.get('focus'));
  if (focusIsland) {
    controls.target.copy(focusIsland.center).setY(1.2);
    camera.position.setFromSphericalCoords(ISLAND_R * 3.2, polarP, azP).add(controls.target);
    controls.update();
  }

  // 除錯用：?person=<角色>[&dist=距離][&act=1] 鏡頭跟著該角色；act=1 讓他一直做招牌動作
  const followed = params.get('person') ? people.find(params.get('person'), Number(params.get('idx')) || 0) : null;
  const followDist = Number(params.get('dist')) || 3.2;
  if (followed && params.get('act')) people.forceAction(followed, params.get('act'));
  if (params.get('freeze') === '1') people.setFrozen(true);
  if (params.get('debug') === '1') window.__islands = { world, people, camera };

  // 鏡頭補間：聚焦某島 / 回全景（prefers-reduced-motion 時直接跳）
  const FOCUS_POLAR = THREE.MathUtils.degToRad(50);
  const FOCUS_FILL_X = 0.85; // 島寬佔畫面寬
  // 聚焦取景：投影島的六個角＋建物高度點，二分搜尋距離，再把島中心移到「卡片上方可視區」的中央
  const _fp = new THREE.Vector3();
  const _dir2 = new THREE.Vector3();
  function fitIsland(island, polar, theta, cardHeightPx) {
    const H = window.innerHeight;
    const regionCenterNdc = cardHeightPx / H; // 可視區（卡片以上）中心的 NDC y
    const regionHalfNdc = (H - cardHeightPx) / H; // 可視區高度的一半（NDC）
    const target = island.center.clone().setY(1.0);
    const corners = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + i * Math.PI / 3;
      corners.push(new THREE.Vector3(island.center.x + ISLAND_R * Math.cos(a), 0.95, island.center.z + ISLAND_R * Math.sin(a)));
      corners.push(new THREE.Vector3(island.center.x + ISLAND_R * 0.7 * Math.cos(a), 3.6, island.center.z + ISLAND_R * 0.7 * Math.sin(a)));
    }
    _dir2.setFromSphericalCoords(1, polar, theta);
    const measure = (dist) => {
      camera.position.copy(target).addScaledVector(_dir2, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      let maxX = 0; let minY = Infinity; let maxY = -Infinity;
      for (const c of corners) {
        _fp.copy(c).project(camera);
        maxX = Math.max(maxX, Math.abs(_fp.x));
        minY = Math.min(minY, _fp.y);
        maxY = Math.max(maxY, _fp.y);
      }
      return { maxX, height: maxY - minY, mid: (maxY + minY) / 2 };
    };
    let lo = 2; let hi = 200;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const m = measure(mid);
      if (m.maxX <= FOCUS_FILL_X && m.height <= regionHalfNdc * 2 * 0.86) hi = mid; else lo = mid;
    }
    const dist = hi;
    const m = measure(dist);
    // 把島的投影中點移到可視區中央：沿鏡頭「上」方向平移 target
    const shiftNdc = regionCenterNdc - m.mid;
    const worldPerNdc = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    target.addScaledVector(up, -shiftNdc * worldPerNdc);
    return { target, dist };
  }
  const _sph = new THREE.Spherical();
  const tween = { active: false, t: 0, dur: 0.8, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTarget: new THREE.Vector3(), toTarget: new THREE.Vector3() };
  function flyTo(targetPos, dist, polar) {
    _sph.setFromVector3(camera.position.clone().sub(controls.target));
    tween.fromPos.copy(camera.position);
    tween.fromTarget.copy(controls.target);
    tween.toTarget.copy(targetPos);
    tween.toPos.setFromSphericalCoords(dist, polar, _sph.theta).add(targetPos);
    tween.t = 0;
    tween.active = true;
    controls.enabled = false;
    if (reducedMotion.matches) finishTween();
  }
  function finishTween() {
    tween.active = false;
    camera.position.copy(tween.toPos);
    controls.target.copy(tween.toTarget);
    controls.enabled = true;
    controls.update();
  }
  let inOverview = true;
  const ui = buildUI({
    world, data, camera, renderer, scene, reducedMotion,
    onFocus(island, cardHeightPx) {
      inOverview = false;
      const theta = _sph.setFromVector3(camera.position.clone().sub(controls.target)).theta;
      const savedPos = camera.position.clone();
      const savedQuat = camera.quaternion.clone();
      const { target, dist } = fitIsland(island, FOCUS_POLAR, theta, cardHeightPx);
      camera.position.copy(savedPos); // fitIsland 會動到 camera，還原後再補間
      camera.quaternion.copy(savedQuat);
      flyTo(target, dist, FOCUS_POLAR);
    },
    onOverview() {
      inOverview = true;
      const polar = overviewPolar(camera.aspect);
      const dist = fitDistance(camera, new THREE.Vector3(0, 0, 0), world.points, polar, _sph.setFromVector3(camera.position.clone().sub(controls.target)).theta);
      // fitDistance 會動到 camera，先還原再補間
      camera.position.copy(tween.active ? tween.toPos : camera.position);
      flyTo(new THREE.Vector3(0, 0, 0), dist, polar);
    },
  });

  if (params.get('open')) ui.focus(params.get('open')); // 除錯：?open=<島id> 直接打開該島資訊卡

  // 視窗比例改變（含手機轉向）：全景狀態才重新取景；聚焦中只更新投影
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (!inOverview || tween.active) return;
    _sph.setFromVector3(camera.position.clone().sub(controls.target));
    const dist = applyFit(camera, controls, scene, world, _sph.phi, _sph.theta);
    camera.position.setFromSphericalCoords(dist, _sph.phi, _sph.theta).add(controls.target);
    controls.update();
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    const t = clock.getElapsedTime();
    if (!reducedMotion.matches) {
      world.update(t);
      decor.update(t);
      people.update(dt, t, camera);
    } else {
      people.update(0, t, camera);
    }
    if (followed) {
      controls.target.copy(followed.root.position).add(new THREE.Vector3(0, 0.55, 0));
      camera.position.setFromSphericalCoords(followDist, polarP, azP + followed.heading).add(controls.target);
      camera.lookAt(controls.target);
    } else if (tween.active) {
      tween.t = Math.min(1, tween.t + dt / tween.dur);
      const k = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - (-2 * tween.t + 2) ** 3 / 2; // easeInOutCubic
      camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
      camera.lookAt(controls.target);
      if (tween.t >= 1) finishTween();
    } else {
      controls.update();
    }
    ui.update(t);
    renderer.render(scene, camera);
  });
}

init();
