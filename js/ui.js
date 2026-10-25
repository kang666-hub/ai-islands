// UI：島名標籤（HTML 疊在 3D 上）、資訊卡、全景鈕、首次提示、點擊聚焦、流動線
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { PALETTE } from './palette.js';

const LANG = 'zh'; // 第一階段只顯示中文；切換鍵位置保留，先不做

function el(tag, className, parent, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

// stat.nullText：模板指定的空值文字（拳擊島用「—」）；stat.format === 'percent'：0～1 顯示成百分比
function formatValue(v, stat = {}) {
  if (v === null || v === undefined) return typeof stat.nullText === 'string' ? stat.nullText : '—（待接）';
  if (typeof v === 'number') {
    if (stat.format === 'percent') return `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;
    return v.toLocaleString('zh-Hant-TW');
  }
  return String(v);
}

function formatUpdated(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `資料更新 ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function buildUI({ world, data, camera, renderer, scene, reducedMotion, onFocus, onOverview }) {
  const root = el('div', 'ui', document.body);

  // 島名標籤
  const labelLayer = el('div', 'labels', root);
  const labels = [];
  for (const [id, island] of world.islands) {
    const label = el('button', 'label', labelLayer);
    label.type = 'button';
    el('span', 'label-no', label, island.info.no);
    el('span', 'label-name', label, island.info.name[LANG]);
    label.addEventListener('click', (e) => { e.stopPropagation(); focus(id); });
    labels.push({ id, island, label, anchor: island.center.clone().setY(3.4) });
  }

  // 全景鈕
  const overviewBtn = el('button', 'overview-btn', root, '全景');
  overviewBtn.type = 'button';
  overviewBtn.hidden = true;
  overviewBtn.addEventListener('click', () => overview());

  // 首次提示
  const hint = el('div', 'hint', root, '拖曳旋轉・點小島看數據');

  // 資訊卡
  const card = el('section', 'card', root);
  card.hidden = true;
  const cardHead = el('header', 'card-head', card);
  const cardNo = el('span', 'card-no', cardHead);
  const cardTitle = el('h2', 'card-title', cardHead);
  const closeBtn = el('button', 'card-close', cardHead, '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', '關閉');
  closeBtn.addEventListener('click', () => overview());
  const cardSummary = el('p', 'card-summary', card);
  const cardStats = el('dl', 'card-stats', card);
  const cardFoot = el('footer', 'card-foot', card);
  const cardUpdated = el('span', 'card-updated', cardFoot);
  const cardFlows = el('span', 'card-flows', cardFoot);

  function renderCard(island) {
    const info = island.info;
    cardNo.textContent = info.no;
    cardTitle.textContent = info.name[LANG];
    cardStats.replaceChildren();
    cardFlows.textContent = '';
    if (info.incomplete) {
      cardSummary.textContent = '資料更新中';
      cardSummary.classList.add('pending');
      cardUpdated.textContent = '';
    } else {
      cardSummary.classList.remove('pending');
      cardSummary.textContent = info.summary ? info.summary[LANG] : '';
      const shown = info.stats.slice(0, 3);
      cardStats.classList.toggle('single', shown.length === 1);
      for (const s of shown) {
        const item = el('div', 'stat', cardStats);
        el('dt', null, item, s.label[LANG]);
        const dd = el('dd', s.value === null || s.value === undefined ? 'pending' : null, item, formatValue(s.value, s));
        dd.classList.add('num');
      }
      cardUpdated.textContent = formatUpdated(data.updatedAt);
      const related = flows.filter((f) => f.from === info.id || f.to === info.id);
      if (related.length) cardFlows.textContent = related.map((f) => f.label?.[LANG] || '').filter(Boolean).join('　');
    }
  }

  // 數字格標籤：不換行；塞不下就縮字到 9px，還是塞不下就改兩格一列
  function fitStatLabels() {
    cardStats.classList.remove('two-col');
    const dts = [...cardStats.querySelectorAll('dt')];
    for (const dt of dts) dt.style.fontSize = '';
    let overflow = false;
    for (const dt of dts) {
      let size = 12;
      while (dt.scrollWidth > dt.clientWidth + 1 && size > 9) { size -= 0.5; dt.style.fontSize = `${size}px`; }
      if (dt.scrollWidth > dt.clientWidth + 1) overflow = true;
    }
    if (overflow) {
      cardStats.classList.add('two-col');
      for (const dt of dts) dt.style.fontSize = '';
    }
  }

  // 流動線：from → hub → to 的虛線弧，聚焦時才顯示；虛線往前跑表示方向
  const hub = world.islands.get('brand');
  const flows = data.flows.filter((f) => world.islands.has(f.from) && world.islands.has(f.to));
  const flowLines = flows.map((f) => {
    const a = world.islands.get(f.from).center.clone().setY(2.6);
    const b = world.islands.get(f.to).center.clone().setY(2.6);
    const pts = [a];
    if (hub && f.from !== 'brand' && f.to !== 'brand') pts.push(hub.center.clone().setY(3.4));
    pts.push(b);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const geo = new LineGeometry();
    geo.setPositions(curve.getPoints(48).flatMap((q) => [q.x, q.y, q.z]));
    // Line2：線寬以像素計（手機約 3px），虛線用世界單位
    const mat = new LineMaterial({ color: PALETTE.accent, linewidth: 3, dashed: true, dashSize: 0.7, gapSize: 0.45, worldUnits: false, transparent: true, opacity: 0.95, alphaToCoverage: false });
    mat.resolution.set(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.visible = false;
    line.renderOrder = 10;
    scene.add(line);
    // 終點小球
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: PALETTE.accent }));
    dot.position.copy(b);
    dot.visible = false;
    scene.add(dot);
    return { flow: f, line, dot };
  });

  window.addEventListener('resize', () => {
    for (const { line } of flowLines) line.material.resolution.set(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
  });

  function showFlows(islandId) {
    for (const { flow, line, dot } of flowLines) {
      const on = islandId !== null && (flow.from === islandId || flow.to === islandId);
      line.visible = on;
      dot.visible = on;
    }
  }

  // 聚焦狀態
  let focused = null;
  function focus(id) {
    const island = world.islands.get(id);
    if (!island) return;
    focused = id;
    renderCard(island);
    card.hidden = false;
    fitStatLabels();
    const cardHeight = card.offsetHeight + 12; // 含底部邊距，給鏡頭留可視區
    requestAnimationFrame(() => card.classList.add('open'));
    overviewBtn.hidden = false;
    showFlows(id);
    for (const l of labels) {
      l.label.classList.toggle('active', l.id === id);
      l.label.classList.toggle('dim', l.id !== id);
    }
    dismissHint();
    onFocus(island, cardHeight);
  }
  function overview() {
    focused = null;
    card.classList.remove('open');
    setTimeout(() => { if (focused === null) card.hidden = true; }, reducedMotion.matches ? 0 : 260);
    overviewBtn.hidden = true;
    showFlows(null);
    for (const l of labels) l.label.classList.remove('active', 'dim');
    onOverview();
  }

  let hintShown = true;
  function dismissHint() {
    if (!hintShown) return;
    hintShown = false;
    hint.classList.add('gone');
  }

  // 點擊 3D 島（與拖曳區分：按下到放開移動 < 6px 才算點）
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pickables = [];
  for (const island of world.islands.values()) {
    island.group.traverse((o) => { if (o.isMesh) { o.userData.islandId = island.info.id; pickables.push(o); } });
    island.decor?.traverse((o) => { if (o.isMesh) { o.userData.islandId = island.info.id; pickables.push(o); } });
  }
  let down = null;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; dismissHint(); });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (hit) focus(hit.object.userData.islandId);
  });

  // 每幀：標籤跟著島、流動線虛線前進
  const v = new THREE.Vector3();
  function update(t) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const l of labels) {
      v.copy(l.anchor).project(camera);
      const visible = v.z < 1;
      l.label.style.display = visible ? '' : 'none';
      if (!visible) continue;
      l.label.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    }
    if (!reducedMotion.matches) {
      for (const { line } of flowLines) if (line.visible) line.material.dashOffset = -t * 1.6;
    }
  }

  return { update, focus, overview, get focused() { return focused; } };
}
