// 讀取並驗證 data/islands.json
// 座標壞掉的島不放進場景；其餘欄位缺漏只標記 incomplete，交給 UI 顯示「資料更新中」。

const DATA_URL = './data/islands.json';

function validateIsland(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  if (!Number.isInteger(raw.q) || !Number.isInteger(raw.r)) return null;

  const statsOk = Array.isArray(raw.stats) && raw.stats.length > 0 &&
    raw.stats.every((s) => s && typeof s.key === 'string' && s.label && typeof s.label.zh === 'string');
  const nameOk = raw.name && typeof raw.name.zh === 'string';

  return {
    id: raw.id,
    no: typeof raw.no === 'string' ? raw.no : '',
    q: raw.q,
    r: raw.r,
    name: nameOk ? raw.name : { zh: raw.id, en: raw.id },
    summary: raw.summary && typeof raw.summary.zh === 'string' ? raw.summary : null,
    stats: statsOk ? raw.stats : null,
    visual: raw.visual && typeof raw.visual === 'object' ? raw.visual : {},
    incomplete: !(statsOk && nameOk),
  };
}

export async function loadData() {
  const res = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  const islands = [];
  const taken = new Set();
  for (const raw of Array.isArray(json.islands) ? json.islands : []) {
    const island = validateIsland(raw);
    if (!island) continue;
    const cell = `${island.q},${island.r}`;
    if (taken.has(cell)) continue; // 同一格只放第一座
    taken.add(cell);
    islands.push(island);
  }
  if (islands.length === 0) throw new Error('no valid islands');

  return {
    updatedAt: typeof json.updatedAt === 'string' ? json.updatedAt : null,
    islands,
    people: Array.isArray(json.people) ? json.people : [],
    flows: Array.isArray(json.flows) ? json.flows : [],
  };
}
