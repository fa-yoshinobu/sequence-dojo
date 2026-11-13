// Frozen pre-G10 app.js calculation. Do not update with the production implementation.
// 盤の計算。描画オブジェクトは参照せず、I/O → リレー → 移動 → LS の順を保つ。
export const CONV = { xMin: -118, xMax: 106, z: 48.5, belt: 49, top: 26, speed: 45 };
export const WORK = { w: 49, d: 39, h: 20, xMin: -91, xMax: 80, gap: 0.5 };
export const LS_X = { left: -84, right: 72 };
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function createState() { return {
  power: true,
  pb: [false, false, false, false, false],
  pbLock: [false, false, false, false, false],
  ss0: false, ss1: false, dsw: 0,
  ls: [false, false, false, false, false],
  works: [],                  // { x, screws:[LS5,LS4,LS3,端], group, body }
  selWork: null,
  relay: [false, false],      // 実際に励磁しているリレー（インターロック込み）
  connected: false,
  serverY: new Array(16).fill(false),
  manualY: new Array(16).fill(false),
  config: null,
  wiringMode: false,
  multiWork: false,           // true でワークを複数置ける（検定の範囲外の拡張）
};
}
// 周期計算の結果（描画・判定が参照）
export function createCurrent() { return { x: new Array(16).fill(false), y: new Array(16).fill(false), out: new Array(14).fill(false), closed: new Array(16).fill(false) };
}
export function panelContacts(st) {
  // 盤入力機器の接点が閉じているか（PB5 は b接点）
  const pb = i => st.pb[i] || st.pbLock[i];
  return [...st.ls, pb(0), pb(1), pb(2), pb(3), !pb(4), st.ss1, st.ss0,
    !!(st.dsw & 1), !!(st.dsw & 2), !!(st.dsw & 4), !!(st.dsw & 8)];
}

export function updateLimitSwitches(st) {
  const any = (x0, i) => st.works.some(w => Math.abs(w.x - x0) <= 8 && w.screws[i]);
  st.ls = [any(LS_X.right, 3), any(LS_X.left, 3), any(LS_X.left, 2), any(LS_X.left, 1), any(LS_X.left, 0)];
}

// RY1/RY2 はお互いの b接点でインターロック: 先に入った方が優先
export function updateRelays(st, out) {
  let [r1, r2] = st.relay;
  r1 = out[0] && !r2;
  r2 = out[1] && !r1;
  st.relay = [r1, r2];
}

export const bcd = bits => (bits[0] ? 1 : 0) + (bits[1] ? 2 : 0) + (bits[2] ? 4 : 0) + (bits[3] ? 8 : 0);
export const conveyorDir = st => (st.relay[0] ? -1 : st.relay[1] ? 1 : 0);

// ベルト移動後にワーク同士が重ならないよう押し詰める
export function resolveWorks(st, dir) {
  const ws = [...st.works].sort((a, b) => a.x - b.x);
  const pitch = WORK.w + WORK.gap;
  ws.forEach(w => { w.x = clamp(w.x, WORK.xMin, WORK.xMax); });
  if (dir <= 0) for (let i = 1; i < ws.length; i++) ws[i].x = Math.max(ws[i].x, ws[i - 1].x + pitch);
  if (dir >= 0) for (let i = ws.length - 2; i >= 0; i--) ws[i].x = Math.min(ws[i].x, ws[i + 1].x - pitch);
}


export function stepSimulation(st, cur, dt, { evaluateWiring, draggedWork } = {}) {
  const plcY = st.connected ? st.serverY : st.manualY;
  const closed = st.power ? panelContacts(st) : new Array(16).fill(false);
  let x, out;
  if (st.wiringMode) ({ x, out } = evaluateWiring(closed, plcY));
  else { x = closed; out = plcY.slice(0, 14); }
  if (!st.power) out = new Array(14).fill(false);
  Object.assign(cur, { x, y: plcY, out, closed });

  updateRelays(st, out);
  const dir = conveyorDir(st);
  if (dir) {
    for (const w of st.works) if (draggedWork !== w) w.x += dir * CONV.speed * dt;
    resolveWorks(st, dir);
  }
  updateLimitSwitches(st);

  return dir;
}

export function createTaskApi(st, cur, { clearWorks, placeWork, removeWork }) {
const api = {
  reset() {
    st.power = true;
    st.pb.fill(false); st.pbLock.fill(false);
    st.ss0 = false; st.ss1 = false; st.dsw = 0;
    clearWorks();
  },
  setPb(name, on) { st.pb[+name.slice(2) - 1] = on; },
  holdPb(name, on) { st.pbLock[+name.slice(2) - 1] = on; },
  setSs(i, v) { if (i === 0) st.ss0 = v; else st.ss1 = v; },
  setDsw(v) { st.dsw = v; },
  placeWork(at, screws) { clearWorksAt(at); placeWork(at, screws); },
  clearWorks,
  releaseAll() { st.pb.fill(false); st.pbLock.fill(false); },
  observe() {
    const o = cur.out;
    const d = bits => { const v = bcd(bits); return st.power && v <= 9 ? v : -1; };
    const obs = {
      RY1: o[0], RY2: o[1], PL1: o[2], PL2: o[3], PL3: o[4], PL4: o[5],
      DPL1: d(o.slice(6, 10)), DPL2: d(o.slice(10, 14)),
      conveyor: ['left', 'stop', 'right'][conveyorDir(st) + 1],
    };
    st.ls.forEach((v, i) => { obs[`LS${i + 1}`] = v; });
    return obs;
  },
};
function clearWorksAt(at) {
  const x = at === 'left' ? WORK.xMin : at === 'right' ? WORK.xMax : (WORK.xMin + WORK.xMax) / 2;
  st.works.filter(w => Math.abs(w.x - x) < WORK.w + WORK.gap).forEach(removeWork);
}

return api;
}
