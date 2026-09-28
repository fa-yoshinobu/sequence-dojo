// シーケンス道場 3D — シーケンス制御作業 検定作業盤の 3D シミュレータ
// 座標系: 1 = 1mm。盤上面が y=0、手前(操作者側)が +z、右が +x。
import * as THREE from 'three';
import { OrbitControls } from '../vendor/addons/OrbitControls.js';
import { M, mat, box, cyl, label } from './gfx.js';
import { Wiring, PLC_MODELS, DEFAULT_MODEL } from './wiring.js';
import { TaskRunner, GRADE_TIME } from './tasks.js';

// ---------------------------------------------------------------- I/O 定義
// 盤入力 index 0..15 = TB1..16、盤出力 index 0..13 = TB20..33
const INPUT_NAMES = ['LS1 右端', 'LS2 左端', 'LS3 品番', 'LS4 品番', 'LS5 品番',
  'PB1', 'PB2', 'PB3', 'PB4', 'PB5 非常停止', 'SS1 連続', 'SS0 自動', 'DSW 1', 'DSW 2', 'DSW 4', 'DSW 8'];
const OUTPUT_NAMES = ['RY1 左行', 'RY2 右行', 'PL1', 'PL2', 'PL3', 'PL4',
  'DPL1 1', 'DPL1 2', 'DPL1 4', 'DPL1 8', 'DPL2 10', 'DPL2 20', 'DPL2 40', 'DPL2 80'];

// ---------------------------------------------------------------- 状態
const st = {
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
// 周期計算の結果（描画・判定が参照）
const cur = { x: new Array(16).fill(false), y: new Array(16).fill(false), out: new Array(14).fill(false), closed: new Array(16).fill(false) };

// ---------------------------------------------------------------- シーン
const container = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a3038);

const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.minDistance = 60;
controls.maxDistance = 1500;
controls.maxPolarAngle = Math.PI * 0.95;

scene.add(new THREE.HemisphereLight(0xffffff, 0x404850, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-250, 500, 300);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -380, right: 380, top: 380, bottom: -380, near: 10, far: 1600 });
scene.add(sun);

// 机
box(scene, 1400, 20, 900, mat(0x6b5a48, { roughness: 0.8 }), 0, -155, 0).castShadow = false;

// クリック可能な部品
const panelPickables = [];
function interactive(obj, action) {
  obj.traverse(o => { if (o.isMesh) { o.userData.action = action; panelPickables.push(o); } });
  return obj;
}

// ---------------------------------------------------------------- 盤本体 300W x 330D x 145H
box(scene, 300, 145, 330, M.panel, 0, -72.5, 0);
label(scene, 'SEQ-DOJO', 118, 158, { size: 6, color: '#555' });

// ---------------------------------------------------------------- TB 端子台
const TB = {}; // 端子番号 → ワールド座標
{
  box(scene, 176, 14, 34, M.tbBase, 0, 7, -131);
  const rows = [
    { z: -140, names: ['+', '+', '+', '+', ...Array.from({ length: 14 }, (_, i) => String(20 + i))] },
    { z: -123, names: ['-', '-', '-', '-', ...Array.from({ length: 16 }, (_, i) => String(1 + i))] },
  ];
  const pitch = 8.4;
  const x0 = -pitch * 9.5;
  for (const row of rows) {
    row.names.forEach((n, i) => {
      const x = x0 + i * pitch;
      box(scene, 7.6, 4, 13, M.dark, x, 16, row.z);
      cyl(scene, 2.6, 1.5, M.metal, x, 18.5, row.z - 2, 16);
      box(scene, 4.2, 0.6, 0.8, M.dark, x, 19.4, row.z - 2).rotation.y = 0.5;
      label(scene, n, x, row.z + 4.2, { size: 3.6, color: '#fff', y: 18.2, bold: true });
      const key = n === '+' || n === '-' ? `${n}${i + 1}` : n;
      TB[key] = new THREE.Vector3(x, 19.3, row.z - 2);
    });
  }
  box(scene, 78, 1, 6, M.dark, -45, 0.2, -95);
  box(scene, 78, 1, 6, M.dark, 45, 0.2, -95);
}

// ---------------------------------------------------------------- 電源スイッチ CP1
const powerRocker = new THREE.Group();
{
  box(scene, 26, 3, 36, M.dark, -104, 1.5, -39);
  powerRocker.position.set(-104, 4, -39);
  scene.add(powerRocker);
  box(powerRocker, 12, 5, 22, M.black);
  label(scene, 'ON', -104, -64, { size: 5 });
  label(scene, 'OFF', -104, -14, { size: 5 });
  label(scene, '電源', -104, -71, { size: 5 });
  interactive(powerRocker, { type: 'power' });
}

// ---------------------------------------------------------------- RY1 / RY2
const relayLed = [];
{
  [4, 33].forEach((x, i) => {
    box(scene, 22, 3, 30, M.dark, x, 1.5, -29);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(18, 30, 24),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.7, roughness: 0.15, thickness: 2, transparent: true, opacity: 0.55 }));
    shell.position.set(x, 18, -29);
    scene.add(shell);
    box(scene, 10, 18, 14, mat(0xb07a3a), x, 12, -29);
    const led = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), mat(0x551111, { emissive: 0x000000 }));
    led.position.set(x + 6, 30, -24);
    scene.add(led);
    relayLed.push(led);
    label(scene, `RY${i + 1}`, x, -50, { size: 5 });
  });
  label(scene, 'コンベア駆動リレー', 18, -9, { size: 4.5 });
}

// ---------------------------------------------------------------- コンベア
const CONV = { xMin: -118, xMax: 106, z: 48.5, belt: 49, top: 26, speed: 45 };
const WORK = { w: 49, d: 39, h: 20, xMin: -91, xMax: 80, gap: 0.5 };
const LS_X = { left: -84, right: 72 };
const SCREW_Z = [-13.5, -4.5, 4.5, 13.5].map(dz => CONV.z + dz); // LS5, LS4, LS3, 端
let beltTex;
{
  box(scene, CONV.xMax - CONV.xMin + 16, 4, 70, M.dark, (CONV.xMin + CONV.xMax) / 2, 2, CONV.z);
  for (const dz of [-30, 30]) box(scene, CONV.xMax - CONV.xMin + 20, 26, 5, M.alu, (CONV.xMin + CONV.xMax) / 2, 13, CONV.z + dz);
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 32;
  const c = cv.getContext('2d');
  c.fillStyle = '#12665f'; c.fillRect(0, 0, 256, 32);
  c.fillStyle = '#0e5751';
  for (let i = 0; i < 256; i += 16) c.fillRect(i, 0, 5, 32);
  beltTex = new THREE.CanvasTexture(cv);
  beltTex.wrapS = THREE.RepeatWrapping;
  beltTex.repeat.set(6, 1);
  beltTex.colorSpace = THREE.SRGBColorSpace;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(CONV.xMax - CONV.xMin, 2, CONV.belt),
    [M.dark, M.dark, new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.9 }), M.dark, M.dark, M.dark]);
  belt.position.set((CONV.xMin + CONV.xMax) / 2, CONV.top - 1, CONV.z);
  belt.receiveShadow = true;
  scene.add(belt);
  box(scene, 34, 30, 55, mat(0xc9ccd0, { metalness: 0.5 }), CONV.xMax + 12, 15, CONV.z);
  for (const [x, z] of [[-128, 12], [-128, 85], [118, 12], [118, 85], [-60, 5], [60, 5], [-60, 92], [60, 92]])
    cyl(scene, 3, 1.2, mat(0xa88a3a, { metalness: 0.7 }), x, 0.6, z);
}

// リミットスイッチ（レバー付き）。lsLevers の並び = [LS1, LS2, LS3, LS4, LS5]
const lsLevers = [];
function makeLimitSwitch(x, z, mirror = false) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  scene.add(g);
  box(g, 16, 7, 6, M.black, 0, CONV.top + 26, 0);
  const lever = new THREE.Group();
  lever.position.set(mirror ? -6 : 6, CONV.top + 23, 0);
  g.add(lever);
  box(lever, 1.2, 1.2, 4, M.metal, mirror ? 4 : -4, -1, 0);
  box(lever, 10, 1, 2, M.metal, mirror ? 5 : -5, 0, 0).rotation.z = mirror ? 0.4 : -0.4;
  cyl(lever, 1.4, 2.4, M.metal, mirror ? 9 : -9, -3.5, 0, 12).rotation.x = Math.PI / 2;
  lsLevers.push({ lever, dir: mirror ? -1 : 1 });
}
{
  box(scene, 8, 34, 80, M.alu, LS_X.left - 12, 17, CONV.z);
  box(scene, 24, 4, 80, M.alu, LS_X.left - 2, CONV.top + 32, CONV.z);
  box(scene, 8, 34, 20, M.alu, LS_X.right + 14, 17, SCREW_Z[3]);
  box(scene, 24, 4, 20, M.alu, LS_X.right + 4, CONV.top + 32, SCREW_Z[3]);
  makeLimitSwitch(LS_X.right, SCREW_Z[3], true);
  makeLimitSwitch(LS_X.left, SCREW_Z[3]); // LS2
  makeLimitSwitch(LS_X.left, SCREW_Z[2]); // LS3
  makeLimitSwitch(LS_X.left, SCREW_Z[1]); // LS4
  makeLimitSwitch(LS_X.left, SCREW_Z[0]); // LS5
  ['LS5', 'LS4', 'LS3', 'LS2'].forEach((n, i) => label(scene, n, -141, SCREW_Z[i] + 1.5, { size: 4 }));
  label(scene, 'LS1', 133, SCREW_Z[3] + 1.5, { size: 4 });
}

// ---------------------------------------------------------------- ワークブロック
function createWork(x, screws) {
  const group = new THREE.Group();
  const body = box(group, WORK.w, WORK.h, WORK.d, mat(0xc7cbd1, { metalness: 0.55, roughness: 0.35 }), 0, WORK.h / 2, 0);
  const screwMeshes = SCREW_Z.map(z => {
    cyl(group, 1.6, 0.4, M.dark, 0, WORK.h + 0.1, z - CONV.z, 12);
    const s = new THREE.Group();
    s.position.set(0, WORK.h, z - CONV.z);
    cyl(s, 3.2, 2.4, M.metal, 0, 1.2, 0, 16);
    box(s, 4.5, 0.6, 1, M.dark, 0, 2.5, 0);
    box(s, 1, 0.6, 4.5, M.dark, 0, 2.5, 0);
    group.add(s);
    return s;
  });
  group.position.set(x, CONV.top, CONV.z);
  scene.add(group);
  const w = { x, screws, group, body, screwMeshes };
  group.traverse(o => { if (o.isMesh) o.userData.action = { type: 'work', work: w }; });
  return w;
}
function removeWork(w) {
  scene.remove(w.group);
  w.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } });
  st.works = st.works.filter(x => x !== w);
  if (st.selWork === w) selectWork(null);
}
function selectWork(w) {
  st.selWork = w;
  st.works.forEach(x => x.body.material.emissive.setHex(x === w ? 0x224466 : 0));
  if (w) screwBoxes.forEach((b, i) => { b.checked = w.screws[i]; });
  updateHinban();
}
function placeWork(at, screws) {
  const x = at === 'left' ? WORK.xMin : at === 'right' ? WORK.xMax : (WORK.xMin + WORK.xMax) / 2;
  if (!st.multiWork) clearWorks(); // 検定と同じく1個だけ: 置き直し
  if (st.works.some(w => Math.abs(w.x - x) < WORK.w + WORK.gap)) return null;
  const w = createWork(x, screws);
  st.works.push(w);
  selectWork(w);
  return w;
}
function clearWorks() { [...st.works].forEach(removeWork); }

// ベルト移動後にワーク同士が重ならないよう押し詰める
function resolveWorks(dir) {
  const ws = [...st.works].sort((a, b) => a.x - b.x);
  const pitch = WORK.w + WORK.gap;
  ws.forEach(w => { w.x = THREE.MathUtils.clamp(w.x, WORK.xMin, WORK.xMax); });
  if (dir <= 0) for (let i = 1; i < ws.length; i++) ws[i].x = Math.max(ws[i].x, ws[i - 1].x + pitch);
  if (dir >= 0) for (let i = ws.length - 2; i >= 0; i--) ws[i].x = Math.min(ws[i].x, ws[i + 1].x - pitch);
}

// ---------------------------------------------------------------- ランプ類
function makeLamp(x, z, color) {
  cyl(scene, 5.5, 2, M.metal, x, 1, z);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color, emissive: 0x000000, roughness: 0.25, transparent: true, opacity: 0.9 }));
  lens.position.set(x, 2, z);
  scene.add(lens);
  const light = new THREE.PointLight(color, 0, 40, 2);
  light.position.set(x, 8, z);
  scene.add(light);
  return { lens, light, color: new THREE.Color(color), offColor: new THREE.Color(color).multiplyScalar(0.18) };
}
const powerLamp = makeLamp(-116, 100, 0x33dd66);
label(scene, '電源', -116, 88, { size: 4.5 });
const lamps = [-67, -42, -18, 7].map((x, i) => {
  label(scene, `PL${i + 1}`, x, 88, { size: 4.5 });
  return makeLamp(x, 100, 0x33dd66);
});

// ---------------------------------------------------------------- 押しボタン PB1〜4 / PB5
const pbCaps = [];
[-67, -40, -14, 12].forEach((x, i) => {
  box(scene, 24, 3, 20, M.dark, x, 1.5, 140);
  const cap = box(scene, 21, 6, 17, M.white, x, 5, 140);
  interactive(cap, { type: 'pb', i });
  pbCaps.push({ mesh: cap, y: 5 });
  label(scene, `PB${i + 1}`, x, 126, { size: 4.5 });
});
{
  cyl(scene, 11, 3, M.dark, 40, 1.5, 140);
  const cap = cyl(scene, 10, 8, M.red, 40, 7, 140, 32);
  interactive(cap, { type: 'pb', i: 4 });
  pbCaps.push({ mesh: cap, y: 7 });
  label(scene, 'PB5', 40, 124, { size: 4.5 });
}

// ---------------------------------------------------------------- セレクタ SS0 / SS1
function makeSelector(x, z, name, top, left, right) {
  cyl(scene, 11, 4, M.black, x, 2, z);
  const knob = new THREE.Group();
  knob.position.set(x, 4, z);
  scene.add(knob);
  cyl(knob, 8, 6, M.black, 0, 3, 0);
  box(knob, 3.5, 5, 15, mat(0x333333), 0, 7, 0);
  box(knob, 1.2, 0.5, 6, M.white, 0, 9.6, -4);
  label(scene, name, x, z + 16, { size: 4.5 });
  label(scene, left, x - 9, z - 16, { size: 3.4 });
  label(scene, right, x + 9, z - 16, { size: 3.4 });
  label(scene, top, x, z - 22, { size: 3.4 });
  return knob;
}
const ss0Knob = makeSelector(-122, 140, 'SS0', '手動・自動', '手', '自');
const ss1Knob = makeSelector(-96, 140, 'SS1', '連続運転', '切', '入');
interactive(ss0Knob, { type: 'ss', i: 0 });
interactive(ss1Knob, { type: 'ss', i: 1 });

// ---------------------------------------------------------------- 7セグ（DSW 表示 / DPL）
const SEG = [[0, -1, 1], [1, -0.5, 0], [1, 0.5, 0], [0, 1, 1], [-1, 0.5, 0], [-1, -0.5, 0], [0, 0, 1]]; // a〜g
const DIGITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
function makeDigit(x, z, scale, color, offColor, y) {
  const W = 12 * scale, H = 11 * scale, T = 2.2 * scale;
  const segs = SEG.map(([sx, sz, horiz]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(horiz ? W : T, 0.6, horiz ? T : H),
      new THREE.MeshStandardMaterial({ color: offColor, emissive: 0x000000 }));
    m.position.set(x + sx * W / 2, y, z + sz * H);
    scene.add(m);
    return m;
  });
  return { segs, color: new THREE.Color(color), off: new THREE.Color(offColor) };
}
function showDigit(d, value) {
  const bits = value >= 0 && value <= 9 ? DIGITS[value] : 0;
  d.segs.forEach((m, i) => {
    const on = (bits >> i) & 1;
    m.material.emissive.copy(on ? d.color : new THREE.Color(0));
    m.material.color.copy(on ? d.color : d.off);
  });
}
let dswDigit;
{
  const x = 68, z = 136;
  box(scene, 18, 4, 30, M.black, x, 2, z);
  dswDigit = makeDigit(x, z, 0.55, 0xffffff, 0x333333, 4.2);
  const up = box(scene, 9, 3, 6, mat(0x555a60), x, 5, z - 11);
  const dn = box(scene, 9, 3, 6, mat(0x555a60), x, 5, z + 11);
  label(scene, '▲', x, z - 11, { size: 4, color: '#fff', y: 6.6 });
  label(scene, '▼', x, z + 11, { size: 4, color: '#fff', y: 6.6 });
  interactive(up, { type: 'dsw', d: 1 });
  interactive(dn, { type: 'dsw', d: -1 });
  label(scene, 'DSW', x, z - 24, { size: 4.5 });
}
const DPL = {};
{
  box(scene, 52, 4, 34, M.dark, 116, 2, 138);
  box(scene, 46, 1, 28, mat(0x1a0505, { roughness: 0.2 }), 116, 4.3, 138);
  DPL.d2 = makeDigit(105, 138, 1.2, 0xff3a2a, 0x2a0a0a, 4.9);
  DPL.d1 = makeDigit(127, 138, 1.2, 0xff3a2a, 0x2a0a0a, 4.9);
  label(scene, 'DPL2', 105, 116, { size: 4.5 });
  label(scene, 'DPL1', 127, 116, { size: 4.5 });
}

// ---------------------------------------------------------------- 配線（PLC モデル）
const wiring = new Wiring(scene, TB, restore('plcModel', DEFAULT_MODEL)); // 配線練習用 PLC（通信先とは別）

// ---------------------------------------------------------------- 視点
const VIEWS = {
  home: [[0, 480, 520], [0, -20, -40]],
  front: [[0, 160, 560], [0, 0, 20]],
  top: [[0, 620, 1], [0, 0, 0]],
  tb: [[0, 170, -30], [0, 10, -131]],
  wiring: [[0, 300, 10], [0, -10, -200]],
  conv: [[0, 190, 190], [-10, 20, 48]],
  ops: [[0, 190, 290], [0, 0, 125]],
};
let tween = null;
function goView(name) {
  const [p, t] = VIEWS[name];
  tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...p), t1: new THREE.Vector3(...t) };
}
camera.position.set(...VIEWS.home[0]);
controls.target.set(...VIEWS.home[1]);
document.querySelectorAll('#views button[data-view]').forEach(b => b.addEventListener('click', () => goView(b.dataset.view)));

// ---------------------------------------------------------------- ポインタ操作
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pressed = null;   // 押している PB
let dragWork = null;  // { work, dx }
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(CONV.top + WORK.h));

function currentPickables() {
  const list = [...panelPickables];
  for (const w of st.works) w.group.traverse(o => { if (o.isMesh) list.push(o); });
  if (st.wiringMode) list.push(...wiring.pickables, ...wiring.wirePickables);
  return list;
}
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(currentPickables(), false);
  return hits[0]?.object.userData.action ?? null;
}
function rayX() {
  const v = new THREE.Vector3();
  return ray.ray.intersectPlane(dragPlane, v) ? v.x : null;
}

// マウスの取込み（ポインタキャプチャ）が残ると、以後のクリックが全部 3D 画面に吸われて
// 左右のパネルが操作できなくなる。3D 画面以外を押したときは取込みを解除して、状態を戻す。
function resetPointerState(pointerId) {
  if (pointerId != null && renderer.domElement.hasPointerCapture?.(pointerId))
    renderer.domElement.releasePointerCapture(pointerId);
  if (pressed != null) { st.pb[pressed] = false; pressed = null; }
  dragWork = null;
  controls.enabled = true;
}
renderer.domElement.addEventListener('pointerdown', e => {
  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (under && under !== renderer.domElement) {
    // 残っていた取込みで 3D 画面に届いたクリック。解除して、押した場所へ渡し直す
    e.stopImmediatePropagation();
    resetPointerState(e.pointerId);
    under.focus?.();
    under.click?.();
    return;
  }
  controls.enabled = true;
  if (e.button !== 0) return;
  const a = pick(e);
  if (!a) return;
  controls.enabled = false; // OrbitControls より先に呼ばれるので回転を止められる
  switch (a.type) {
    case 'pb':
      if (e.shiftKey) st.pbLock[a.i] = !st.pbLock[a.i];
      else { st.pb[a.i] = true; pressed = a.i; }
      break;
    case 'ss':
      if (a.i === 0) st.ss0 = !st.ss0; else st.ss1 = !st.ss1;
      break;
    case 'dsw':
      st.dsw = (st.dsw + a.d + 10) % 10;
      break;
    case 'power':
      st.power = !st.power;
      break;
    case 'work': {
      selectWork(a.work);
      const x = rayX();
      if (x != null) dragWork = { work: a.work, dx: a.work.x - x };
      break;
    }
    case 'term':
      setWireMsg(wiring.clickTerm(a.key));
      break;
    case 'wire':
      wiring.select(a.wire);
      setWireMsg(`選択: ${wiring.name(a.wire.a)} ─ ${wiring.name(a.wire.b)}（Delete で削除）`);
      break;
  }
}, { capture: true });

renderer.domElement.addEventListener('pointermove', e => {
  if (dragWork) {
    pick(e);
    const x = rayX();
    if (x != null) {
      // 隣のワークを越えない範囲で動かす
      const w = dragWork.work;
      const pitch = WORK.w + WORK.gap;
      let lo = WORK.xMin, hi = WORK.xMax;
      for (const o of st.works) {
        if (o === w) continue;
        if (o.x < w.x) lo = Math.max(lo, o.x + pitch); else hi = Math.min(hi, o.x - pitch);
      }
      w.x = THREE.MathUtils.clamp(x + dragWork.dx, lo, hi);
    }
    return;
  }
  renderer.domElement.style.cursor = pick(e) ? 'pointer' : '';
});

window.addEventListener('pointerup', () => resetPointerState());
window.addEventListener('pointercancel', e => resetPointerState(e.pointerId));
// ウィンドウ外でボタンを離したり、ほかのウィンドウに切り替えたりしたときも戻す
window.addEventListener('blur', () => { resetPointerState(); navKeys.clear(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) resetPointerState(); });

// ---------------------------------------------------------------- 起動ロゴ
// ボタン君が押して PL1 が点灯するまで見せてから消す。クリック・キーでスキップ
function runSplash() {
  const el = document.getElementById('splash');
  if (!el) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      el.classList.add('hide');
      removeEventListener('keydown', end);
      setTimeout(() => { el.remove(); resolve(); }, 500);
    };
    el.addEventListener('click', end);
    addEventListener('keydown', end);
    setTimeout(end, 2600);
  });
}

// ---------------------------------------------------------------- ヘルプ
const helpDlg = document.getElementById('help');
const helpNoAuto = document.getElementById('helpNoAuto');
function toggleHelp(open = !helpDlg.open) {
  if (open && !helpDlg.open) helpDlg.showModal();
  else if (!open && helpDlg.open) helpDlg.close();
}
document.getElementById('btnHelp').onclick = () => toggleHelp(true);
helpDlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => toggleHelp(false)));
helpDlg.addEventListener('click', e => { if (e.target === helpDlg) toggleHelp(false); }); // 枠外クリックで閉じる
helpDlg.querySelectorAll('.help-nav a').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  helpDlg.querySelector(a.getAttribute('href')).scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
helpNoAuto.checked = restore('helpNoAuto', false);
helpNoAuto.addEventListener('change', () => store('helpNoAuto', helpNoAuto.checked));

// カーソルキーで視点操作（押している間なめらかに動く）
const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']);
const navKeys = new Set();
let navMods = { shift: false, ctrl: false };
window.addEventListener('keyup', e => { navKeys.delete(e.key); navMods = { shift: e.shiftKey, ctrl: e.ctrlKey }; });
window.addEventListener('blur', () => navKeys.clear());
const _sph = new THREE.Spherical();
const _off = new THREE.Vector3();
function keyboardNav(dt) {
  if (!navKeys.size) return;
  tween = null;
  const k = n => (navKeys.has(n) ? 1 : 0);
  const h = k('ArrowRight') - k('ArrowLeft');
  const v = k('ArrowUp') - k('ArrowDown');
  _off.subVectors(camera.position, controls.target);
  const dist = _off.length();
  let zoom = k('PageDown') - k('PageUp');
  if (navMods.ctrl) zoom -= v;
  if (!navMods.shift && !navMods.ctrl) {
    // 平行移動: 画面の左右と、奥行き方向（水平面上）
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
    const move = right.multiplyScalar(h).add(fwd.multiplyScalar(v)).multiplyScalar(dist * 0.8 * dt);
    camera.position.add(move);
    controls.target.add(move);
  } else if (navMods.shift && !navMods.ctrl) {
    // Shift: 回転
    _sph.setFromVector3(_off);
    _sph.theta -= h * 1.4 * dt;
    _sph.phi = THREE.MathUtils.clamp(_sph.phi - v * 1.0 * dt, 0.05, controls.maxPolarAngle);
    _off.setFromSpherical(_sph);
    camera.position.copy(controls.target).add(_off);
  }
  if (zoom) {
    const d = THREE.MathUtils.clamp(dist * Math.exp(zoom * 1.2 * dt), controls.minDistance, controls.maxDistance);
    _off.subVectors(camera.position, controls.target).setLength(d);
    camera.position.copy(controls.target).add(_off);
  }
}

const isTyping = e => e.target instanceof Element && !!e.target.closest('input, select, textarea');
window.addEventListener('keydown', e => {
  if (e.key === 'F1' || (e.key === '?' && !isTyping(e))) {
    e.preventDefault();
    toggleHelp();
    return;
  }
  if (helpDlg.open || isTyping(e)) return;
  if (NAV_KEYS.has(e.key)) { e.preventDefault(); navKeys.add(e.key); navMods = { shift: e.shiftKey, ctrl: e.ctrlKey }; return; }
  if (e.key === 'Escape') { wiring.cancel(); wiring.select(null); setWireMsg(''); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && wiring.selected) { wiring.removeWire(wiring.selected); setWireMsg('削除しました'); }
});

// ---------------------------------------------------------------- タブ
const tabs = document.querySelectorAll('.tabs button');
function showTab(name) {
  tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== name; });
  store('tab', name);
}
tabs.forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

function store(k, v) { try { localStorage.setItem(`seqdojo.${k}`, JSON.stringify(v)); } catch { } }
function restore(k, def) { try { return JSON.parse(localStorage.getItem(`seqdojo.${k}`)) ?? def; } catch { return def; } }

// ---------------------------------------------------------------- ワーク UI
const screwBoxes = [...document.querySelectorAll('[data-screw]')];
const readScrews = () => screwBoxes.map(b => b.checked);
function updateHinban() {
  const s = readScrews();
  document.getElementById('hinban').textContent = (s[2] ? 1 : 0) + (s[1] ? 2 : 0) + (s[0] ? 4 : 0);
}
screwBoxes.forEach(b => b.addEventListener('change', () => {
  if (st.selWork) st.selWork.screws = readScrews();
  updateHinban();
}));
for (const [id, at] of [['btnPlaceLeft', 'left'], ['btnPlaceCenter', 'center'], ['btnPlaceRight', 'right']])
  document.getElementById(id).onclick = () => { if (!placeWork(at, readScrews())) alert('その位置には既にワークがあります'); };
document.getElementById('btnRemoveSel').onclick = () => { if (st.selWork) removeWork(st.selWork); };
document.getElementById('btnRemoveAll').onclick = clearWorks;
const multiWorkBox = document.getElementById('multiWork');
function setMultiWork(on) {
  // 検定の範囲外の機能なので、アプリには記憶しない（起動時は常にオフ。*.sdojo を開いたときだけ復元）
  st.multiWork = on;
  multiWorkBox.checked = on;
  // 1個モードに戻したら選択中（なければ最初）のワークだけ残す
  if (!on && st.works.length > 1) {
    const keep = st.selWork ?? st.works[0];
    st.works.filter(w => w !== keep).forEach(removeWork);
  }
}
multiWorkBox.addEventListener('change', () => setMultiWork(multiWorkBox.checked));

// ---------------------------------------------------------------- 配線 UI
const wiringModeBox = document.getElementById('wiringMode');
function setWireMsg(t) { document.getElementById('wireMsg').textContent = t ?? ''; }
function setWiringMode(on) {
  st.wiringMode = on;
  wiringModeBox.checked = on;
  wiring.wireGroup.visible = on;
  if (!on) { wiring.cancel(); wiring.select(null); }
  store('wiringMode', on);
  buildIoTables();
}
wiringModeBox.addEventListener('change', () => setWiringMode(wiringModeBox.checked));
const plcModelSel = document.getElementById('plcModel');
plcModelSel.innerHTML = Object.entries(PLC_MODELS).map(([id, m]) => `<option value="${id}">${m.name}</option>`).join('');
plcModelSel.value = wiring.modelId;
plcModelSel.addEventListener('change', () => {
  const dropped = wiring.setModel(plcModelSel.value);
  store('plcModel', wiring.modelId);
  setWireMsg(dropped ? `機種を切り替えました（切替先に無い端子の配線 ${dropped} 本を外しました）` : '機種を切り替えました');
});
wiring.onChange = () => {
  markDirty();
  store('wires', wiring.toJSON());
  document.getElementById('wireCount').textContent = wiring.wires.length;
  buildIoTables();
};
document.getElementById('btnViewWiring').onclick = () => goView('wiring');
document.getElementById('btnAutoWire').onclick = () => {
  if (wiring.wires.length && !confirm('今の配線を消して標準配線を作りますか？')) return;
  wiring.autoStandard();
  setWireMsg('標準割付どおりに配線しました');
};
document.getElementById('btnDelWire').onclick = () => { if (wiring.selected) wiring.removeWire(wiring.selected); };
document.getElementById('btnClearWire').onclick = () => { if (confirm('ケーブルを全部外しますか？')) wiring.clear(); };
document.getElementById('btnCheck').onclick = () => {
  const ul = document.getElementById('checkResult');
  ul.innerHTML = '';
  for (const r of wiring.check()) {
    const li = document.createElement('li');
    li.className = r.level;
    li.textContent = r.text;
    ul.appendChild(li);
  }
};

// ---------------------------------------------------------------- 入出力計算
function panelContacts() {
  // 盤入力機器の接点が閉じているか（PB5 は b接点）
  const pb = i => st.pb[i] || st.pbLock[i];
  return [...st.ls, pb(0), pb(1), pb(2), pb(3), !pb(4), st.ss1, st.ss0,
    !!(st.dsw & 1), !!(st.dsw & 2), !!(st.dsw & 4), !!(st.dsw & 8)];
}

function updateLimitSwitches() {
  const any = (x0, i) => st.works.some(w => Math.abs(w.x - x0) <= 8 && w.screws[i]);
  st.ls = [any(LS_X.right, 3), any(LS_X.left, 3), any(LS_X.left, 2), any(LS_X.left, 1), any(LS_X.left, 0)];
}

// RY1/RY2 はお互いの b接点でインターロック: 先に入った方が優先
function updateRelays(out) {
  let [r1, r2] = st.relay;
  r1 = out[0] && !r2;
  r2 = out[1] && !r1;
  st.relay = [r1, r2];
}

const bcd = bits => (bits[0] ? 1 : 0) + (bits[1] ? 2 : 0) + (bits[2] ? 4 : 0) + (bits[3] ? 8 : 0);
const conveyorDir = () => (st.relay[0] ? -1 : st.relay[1] ? 1 : 0);

// 入出力とコンベアは描画と独立して一定周期で回す（タブが裏でも判定が止まらない）
let lastSent = '';
let lastTick = performance.now();
function simTick() {
  const now = performance.now();
  const dt = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;

  const plcY = st.connected ? st.serverY : st.manualY;
  const closed = st.power ? panelContacts() : new Array(16).fill(false);
  let x, out;
  if (st.wiringMode) ({ x, out } = wiring.evaluate(closed, plcY));
  else { x = closed; out = plcY.slice(0, 14); }
  if (!st.power) out = new Array(14).fill(false);
  Object.assign(cur, { x, y: plcY, out, closed });

  updateRelays(out);
  const dir = conveyorDir();
  if (dir) {
    beltTex.offset.x -= dir * CONV.speed * dt / ((CONV.xMax - CONV.xMin) / beltTex.repeat.x);
    for (const w of st.works) if (dragWork?.work !== w) w.x += dir * CONV.speed * dt;
    resolveWorks(dir);
  }
  updateLimitSwitches();

  const key = x.map(b => (b ? 1 : 0)).join('');
  if (key !== lastSent) { send({ type: 'inputs', bits: x }); lastSent = key; }
}
setInterval(simTick, 20);

// ---------------------------------------------------------------- 通信
let ws = null;
function connectWs() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { lastSent = ''; };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.type === 'state') applyServerState(m.state);
  };
  ws.onclose = () => { st.connected = false; setBadge('サーバ切断', 'err'); setTimeout(connectWs, 1500); };
}
function send(obj) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

function applyServerState(s) {
  const wasConnected = st.connected;
  st.connected = s.connected;
  st.serverY = s.outputs;
  if (!st.config) { st.config = s.config; buildIoTables(); }
  document.getElementById('connMsg').textContent = s.error ?? '';
  if (s.connected) setBadge(`接続中 ${s.scanMs.toFixed(0)}ms`, 'on');
  else setBadge(s.error ? 'エラー' : '未接続', s.error ? 'err' : 'off');
  document.getElementById('connBadge').title = s.endpoint ?? '';
  if (wasConnected !== s.connected) {
    document.querySelector('#ioOut').closest('table').classList.toggle('manual', !s.connected);
    document.getElementById('outHint').style.display = s.connected ? 'none' : '';
  }
}
function setBadge(text, cls) {
  const b = document.getElementById('connBadge');
  b.textContent = text;
  b.className = `badge ${cls}`;
}

// ---------------------------------------------------------------- 接続フォーム（通信先 PLC）
// 通信方式ごとの既定値。方式を切り替えたときにポートと先頭デバイスをこの値にする
const PROTOCOLS = {
  melsec: { port: 5000, profile: 'melsec:iq-f', inputStart: 'X0', outputStart: 'Y0',
    hint: '例: X0 / Y0（iQ-F は 8 進、その他は 16 進）、M100 など' },
  keyence: { port: 8501, profile: 'keyence:kv-8000', inputStart: 'MR000', outputStart: 'MR100',
    hint: '例: MR000 / MR100、R000 / R500（XYM 表記の機種は X0 / Y0）' },
  modbus: { port: 502, profile: '', inputStart: 'C0', outputStart: 'C16',
    hint: '0 起点。入力先頭は C（16 コイル）か HR（1 レジスタの 16 ビット）、出力先頭は C / DI / HR / IR' },
};
const LEGACY_PROFILE = { IqF: 'melsec:iq-f', IqR: 'melsec:iq-r', IqL: 'melsec:iq-l', QnU: 'melsec:qnu', QnUDV: 'melsec:qnudv', LCpu: 'melsec:lcpu' };
let catalog = {
  melsec: [{ name: 'melsec:iq-f', displayName: 'MELSEC iQ-F' }, { name: 'melsec:iq-r', displayName: 'MELSEC iQ-R' }],
  keyence: [{ name: 'keyence:kv-8000', displayName: 'KEYENCE KV-8000' }],
  gxSimulator: ['melsec:iq-r', 'melsec:iq-l'], kvSimulator: ['keyence:kv-8000', 'keyence:kv-x500'],
};
const catalogReady = fetch('api/profiles').then(r => r.json()).then(c => { catalog = c; }).catch(() => { });

const form = document.getElementById('connForm');
const F = form.elements;

// 保存された設定・ファイルの設定に足りない項目を既定値で補う
function normalizeConfig(c) {
  const cfg = { protocol: 'melsec', host: '192.168.3.250', transport: 'Tcp', intervalMs: 30, unitId: 1, simulator: false, ...c };
  if (LEGACY_PROFILE[cfg.profile]) cfg.profile = LEGACY_PROFILE[cfg.profile];
  if (!PROTOCOLS[cfg.protocol]) cfg.protocol = 'melsec';
  const d = PROTOCOLS[cfg.protocol];
  cfg.port ||= d.port;
  cfg.inputStart ||= d.inputStart;
  cfg.outputStart ||= d.outputStart;
  return cfg;
}
function fillProfiles(protocol, selected) {
  const list = catalog[protocol] ?? [];
  F.profile.innerHTML = list.map(p => `<option value="${p.name}">${p.displayName}</option>`).join('');
  F.profile.value = list.some(p => p.name === selected) ? selected : (PROTOCOLS[protocol].profile || list[0]?.name || '');
}
// 通信方式・機種に応じて項目を出し分ける
function updateFormVisibility() {
  const protocol = F.protocol.value;
  form.querySelectorAll('[data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(protocol); });
  const simList = protocol === 'melsec' ? catalog.gxSimulator : protocol === 'keyence' ? catalog.kvSimulator : [];
  const canSim = simList.includes(F.profile.value);
  form.querySelector('[data-sim]').hidden = !canSim;
  if (!canSim) F.simulator.checked = false;
  document.getElementById('simLabel').textContent = protocol === 'melsec'
    ? 'GX Simulator 3 に接続（127.0.0.1:5511）' : 'KV STUDIO シミュレータに接続（127.0.0.1:8501）';
  form.querySelectorAll('[data-net] input, [data-net] select').forEach(el => { el.disabled = F.simulator.checked; });
  document.getElementById('addrHint').textContent = PROTOCOLS[protocol].hint;
}
async function fillForm() {
  await catalogReady;
  const cfg = normalizeConfig({ ...st.config, ...restore('config', {}) });
  F.protocol.value = cfg.protocol;
  fillProfiles(cfg.protocol, cfg.profile);
  for (const k of ['host', 'port', 'transport', 'inputStart', 'outputStart', 'intervalMs', 'unitId'])
    if (cfg[k] != null) F[k].value = cfg[k];
  if (!F.unitId.value) F.unitId.value = 1;
  F.simulator.checked = !!cfg.simulator;
  updateFormVisibility();
  st.config = readForm();
  buildIoTables();
}
function readForm() {
  return {
    protocol: F.protocol.value, profile: F.profile.value, simulator: F.simulator.checked,
    host: F.host.value.trim(), port: +F.port.value, transport: F.transport.value, unitId: +F.unitId.value || 0,
    inputStart: F.inputStart.value.trim().toUpperCase(), outputStart: F.outputStart.value.trim().toUpperCase(),
    intervalMs: +F.intervalMs.value || 30,
  };
}
F.protocol.addEventListener('change', () => {
  const d = PROTOCOLS[F.protocol.value];
  fillProfiles(F.protocol.value, d.profile);
  F.port.value = d.port;
  F.inputStart.value = d.inputStart;
  F.outputStart.value = d.outputStart;
  F.simulator.checked = false;
});
form.addEventListener('change', () => { updateFormVisibility(); st.config = readForm(); buildIoTables(); });
form.addEventListener('submit', e => {
  e.preventDefault();
  st.config = readForm();
  store('config', st.config);
  buildIoTables();
  setBadge('接続中…', 'off');
  send({ type: 'connect', config: st.config });
});
document.getElementById('btnDisconnect').onclick = () => send({ type: 'disconnect' });

// I/O モニタに出す通信先のデバイス名（先頭デバイスから offset 点目）
function deviceName(start, offset) {
  const cfg = st.config ?? {};
  const m = /^([A-Z]+)([0-9A-F]+)$/.exec(start ?? '');
  if (!m) return '?';
  const [, dev, num] = m;
  if (cfg.protocol === 'modbus') {
    if (dev === 'C' || dev === 'DI') return dev + (parseInt(num, 10) + offset);
    return `${dev}${parseInt(num, 10)}.${offset}`;             // HR / IR はレジスタ内のビット
  }
  if (cfg.protocol === 'keyence') {
    if (['R', 'MR', 'LR', 'CR'].includes(dev)) {                 // チャンネル＋ビット（R000〜R015、R100〜）
      const n = parseInt(num, 10), idx = Math.floor(n / 100) * 16 + (n % 100) + offset;
      return dev + Math.floor(idx / 16) + String(idx % 16).padStart(2, '0');
    }
    if (dev === 'X' || dev === 'Y') {                            // XYM 表記: 末尾 1 桁が 16 進
      const idx = parseInt(num.slice(0, -1) || '0', 10) * 16 + parseInt(num.slice(-1), 16) + offset;
      return dev + (Math.floor(idx / 16) || '') + (idx % 16).toString(16).toUpperCase();
    }
    if (dev === 'B' || dev === 'VB') return dev + (parseInt(num, 16) + offset).toString(16).toUpperCase();
    return dev + (parseInt(num, 10) + offset);
  }
  // MELSEC: iQ-F の X/Y は 8 進、その他の X/Y・B は 16 進、M などは 10 進
  const iqf = (cfg.profile ?? '').startsWith('melsec:iq-f');
  const base = dev === 'X' || dev === 'Y' ? (iqf ? 8 : 16) : dev === 'B' ? 16 : 10;
  return dev + (parseInt(num, base) + offset).toString(base).toUpperCase();
}

// ---------------------------------------------------------------- I/O モニタ（PLC 側から見た一覧）
let inRows = [], outRows = [];
function buildIoTables() {
  // 配線モードで配線エラーがあると入出力が PLC に届かないので、見出しで知らせる
  const wiringErr = st.wiringMode && wiring.check().some(r => r.level === 'err');
  const ioMode = document.getElementById('ioMode');
  ioMode.textContent = !st.wiringMode ? '（標準割付で内部結線）' : wiringErr ? '⚠ 配線に問題があります（配線タブで確認）' : '（ケーブル配線）';
  ioMode.classList.toggle('warn', wiringErr);
  const srcX = k => st.wiringMode ? wiring.describeX(k, INPUT_NAMES) : `TB${k + 1} ${INPUT_NAMES[k]}`;
  const srcY = k => st.wiringMode ? wiring.describeY(k, OUTPUT_NAMES) : (k < 14 ? `TB${20 + k} ${OUTPUT_NAMES[k]}` : '');
  // 通信先デバイス | 配線練習用 PLC の端子名 | つながっている盤の機器
  const mk = (tbody, n, start, term, src) => {
    tbody.innerHTML = '';
    return Array.from({ length: n }, (_, k) => {
      const tr = document.createElement('tr');
      const s = src(k) || '—';
      tr.innerHTML = `<td>${deviceName(start, k)}</td><td class="term">${term(k)}</td><td class="src" title="${s}">${s}</td><td class="dot"><i></i></td>`;
      tbody.appendChild(tr);
      return tr;
    });
  };
  inRows = mk(document.getElementById('ioIn'), 16, st.config?.inputStart ?? 'X0', k => wiring.termX(k), srcX);
  outRows = mk(document.getElementById('ioOut'), 16, st.config?.outputStart ?? 'Y0', k => wiring.termY(k), srcY);
  outRows.forEach((tr, k) => tr.addEventListener('click', () => { if (!st.connected) st.manualY[k] = !st.manualY[k]; }));
  document.querySelector('#ioOut').closest('table').classList.toggle('manual', !st.connected);
}

// ---------------------------------------------------------------- 課題モード
const sim = {
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
      conveyor: ['left', 'stop', 'right'][conveyorDir() + 1],
    };
    st.ls.forEach((v, i) => { obs[`LS${i + 1}`] = v; });
    return obs;
  },
};
function clearWorksAt(at) {
  const x = at === 'left' ? WORK.xMin : at === 'right' ? WORK.xMax : (WORK.xMin + WORK.xMax) / 2;
  st.works.filter(w => Math.abs(w.x - x) < WORK.w + WORK.gap).forEach(removeWork);
}
const runner = new TaskRunner(sim);
let taskList = [];
const taskSelect = document.getElementById('taskSelect');
const timerEl = document.getElementById('timer');
let timerStart = null;

async function loadTasks() {
  try { taskList = await TaskRunner.loadList(); } catch (e) { taskList = []; }
  taskSelect.innerHTML = taskList.map((t, i) => `<option value="${i}">${t.title}（${t.grade}級相当）</option>`).join('');
  taskSelect.value = restore('task', 0);
  showTask();
}
function currentTask() { return taskList[+taskSelect.value]; }
function showTask() {
  const t = currentTask();
  if (!t) return;
  store('task', +taskSelect.value);
  document.getElementById('taskDesc').textContent = t.description;
  const [std, cut] = GRADE_TIME[t.grade] ?? GRADE_TIME[3];
  const hm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  document.getElementById('timerLimit').textContent = `標準 ${hm(std)} / 打切り ${hm(cut)}`;
}
taskSelect.addEventListener('change', showTask);
document.getElementById('btnTimerStart').onclick = () => { timerStart = Date.now(); };
document.getElementById('btnTimerStop').onclick = () => { timerStart = null; };
setInterval(() => {
  if (timerStart == null) return;
  const s = Math.floor((Date.now() - timerStart) / 1000);
  timerEl.textContent = [s / 3600, (s / 60) % 60, s % 60].map(v => String(Math.floor(v)).padStart(2, '0')).join(':');
  const [std, cut] = GRADE_TIME[currentTask()?.grade] ?? GRADE_TIME[3];
  timerEl.className = s > cut * 60 ? 'over2' : s > std * 60 ? 'over1' : '';
}, 250);

document.getElementById('btnJudge').onclick = async () => {
  const t = currentTask();
  if (!t || runner.running) return;
  if (!st.connected && !confirm('PLC が未接続です。このまま判定しますか？（手動出力のまま判定されます）')) return;
  const ul = document.getElementById('judgeLog');
  const score = document.getElementById('judgeScore');
  ul.innerHTML = '';
  score.textContent = '判定中…';
  const log = (level, text) => {
    const li = document.createElement('li');
    li.className = level;
    li.textContent = text;
    ul.appendChild(li);
    li.scrollIntoView({ block: 'nearest' });
  };
  const { pass, total } = await runner.run(t, log);
  score.textContent = `結果: ${pass} / ${total} 合格${pass === total ? ' 🎉' : ''}`;
};
document.getElementById('btnJudgeStop').onclick = () => { runner.abort = true; };

// ---------------------------------------------------------------- 描画ループ
const clock = new THREE.Clock();
function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function setLamp(l, on) {
  l.lens.material.color.copy(on ? l.color : l.offColor);
  l.lens.material.emissive.copy(on ? l.color : new THREE.Color(0));
  l.lens.material.emissiveIntensity = on ? 1.4 : 0;
  l.light.intensity = on ? 600 : 0;
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (tween) {
    tween.t = Math.min(1, tween.t + dt * 2.2);
    const k = 1 - Math.pow(1 - tween.t, 3);
    camera.position.lerpVectors(tween.p0, tween.p1, k);
    controls.target.lerpVectors(tween.t0, tween.t1, k);
    if (tween.t >= 1) tween = null;
  }
  keyboardNav(dt);
  controls.update();

  const { out, x, y } = cur;
  powerRocker.rotation.x = st.power ? -0.25 : 0.25;
  setLamp(powerLamp, st.power);
  lamps.forEach((l, i) => setLamp(l, out[2 + i]));
  relayLed.forEach((led, i) => led.material.emissive.setHex(st.relay[i] ? 0xff2222 : 0x000000));
  pbCaps.forEach((p, i) => { p.mesh.position.y = p.y - ((st.pb[i] || st.pbLock[i]) ? 2 : 0); });
  ss0Knob.rotation.y = st.ss0 ? -Math.PI / 4 : Math.PI / 4;
  ss1Knob.rotation.y = st.ss1 ? -Math.PI / 4 : Math.PI / 4;
  showDigit(dswDigit, st.dsw);
  showDigit(DPL.d1, st.power ? bcd(out.slice(6, 10)) : -1);
  showDigit(DPL.d2, st.power ? bcd(out.slice(10, 14)) : -1);
  for (const w of st.works) {
    w.group.position.x = w.x;
    w.screwMeshes.forEach((s, i) => { s.visible = w.screws[i]; });
  }
  lsLevers.forEach((l, i) => { l.lever.rotation.z = st.ls[i] ? 0.35 * l.dir : 0; });
  wiring.updateLeds(x, y, st.connected);

  inRows.forEach((tr, k) => tr.classList.toggle('on', x[k]));
  outRows.forEach((tr, k) => tr.classList.toggle('on', y[k]));

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- プロジェクトファイル（*.sdojo）
// 保存するもの: 接続設定・配線練習用 PLC・配線モード・配線・ワーク。スイッチ位置や判定結果は保存しない。
// Windows アプリでは C#（MainForm）がファイル選択と読み書きを行い、ブラウザではダウンロード／ファイル選択で代用する。
const PROJECT_FORMAT = 'sequence-dojo';
const APP_TITLE = 'シーケンス道場 3D';
const host = window.chrome?.webview ?? null;
const project = { path: null, name: null, dirty: false, applying: false, ready: false };

function markDirty() {
  if (!project.ready || project.applying || runner.running) return;
  if (!project.dirty) { project.dirty = true; updateTitle(); }
}
function updateTitle() {
  const name = project.name ?? (project.dirty ? '無題' : null);
  document.title = name ? `${name}${project.dirty ? ' *' : ''} - ${APP_TITLE}` : APP_TITLE;
  document.getElementById('fileName').textContent = name ? `${name}${project.dirty ? ' *' : ''}` : '';
}
function setFileStatus(text) {
  const el = document.getElementById('fileStatus');
  el.textContent = text;
  clearTimeout(setFileStatus.timer);
  setFileStatus.timer = setTimeout(() => { el.textContent = ''; }, 4000);
}
window.__dojoDirty = () => project.dirty; // 閉じるときに C# から確認する

function collectProject() {
  return {
    format: PROJECT_FORMAT, version: 1, app: APP_TITLE, savedAt: new Date().toISOString(),
    connection: readForm(),
    wiring: { model: wiring.modelId, mode: st.wiringMode, wires: wiring.toJSON() },
    works: { multi: st.multiWork, items: st.works.map(w => ({ x: Math.round(w.x * 10) / 10, screws: [...w.screws] })) },
  };
}

async function applyProject(p) {
  if (p?.format !== PROJECT_FORMAT) throw new Error('シーケンス道場のファイルではありません。');
  project.applying = true;
  try {
    const wasConnected = st.connected;
    if (p.connection) {
      st.config = normalizeConfig(p.connection);
      store('config', st.config);
      await fillForm();
    }
    if (p.wiring) {
      if (PLC_MODELS[p.wiring.model]) {
        wiring.setModel(p.wiring.model);
        plcModelSel.value = wiring.modelId;
        store('plcModel', wiring.modelId);
      }
      wiring.load(p.wiring.wires ?? []);
      setWiringMode(!!p.wiring.mode);
    }
    if (p.works) {
      setMultiWork(!!p.works.multi);
      clearWorks();
      const items = (p.works.items ?? []).slice(0, st.multiWork ? 4 : 1);
      for (const it of items) {
        const screws = [0, 1, 2, 3].map(i => !!it.screws?.[i]);
        st.works.push(createWork(THREE.MathUtils.clamp(+it.x || 0, WORK.xMin, WORK.xMax), screws));
      }
      resolveWorks(0);
      selectWork(null);
    }
    if (wasConnected) setFileStatus('接続設定を読み込みました。接続し直すと反映されます');
  } finally {
    project.applying = false;
  }
}

function saveProject(saveAs = false) {
  const content = JSON.stringify(collectProject(), null, 2);
  const name = project.name ?? 'シーケンス道場.sdojo';
  if (host) {
    host.postMessage({ type: 'file-save', path: saveAs ? null : project.path, name, content });
    return;
  }
  // ブラウザ: ダウンロードで保存
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  onSaved({ path: null, name });
}
function onSaved(m) {
  project.path = m.path;
  project.name = m.name;
  project.dirty = false;
  updateTitle();
  setFileStatus(`保存しました: ${m.name}`);
}
async function onOpened(m) {
  try {
    await applyProject(JSON.parse(m.content));
    project.path = m.path ?? null;
    project.name = m.name;
    project.dirty = false;
    updateTitle();
    setFileStatus(`開きました: ${m.name}`);
  } catch (e) {
    alert(`ファイルを開けませんでした。\n${e.message}`);
  }
}
function openProject() {
  if (project.dirty && !confirm('保存されていない変更があります。破棄して開きますか？')) return;
  if (host) { host.postMessage({ type: 'file-open' }); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.sdojo,application/json';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) onOpened({ path: null, name: f.name, content: await f.text() });
  };
  input.click();
}
host?.addEventListener('message', e => {
  const m = e.data;
  switch (m?.type) {
    case 'file-saved': onSaved(m); break;
    case 'file-opened': onOpened(m); break;
    case 'file-error': alert(m.message); break;
    case 'save-request': saveProject(false); break;   // 閉じる前の「保存する」
  }
});
document.getElementById('btnOpen').onclick = openProject;
document.getElementById('btnSave').onclick = () => saveProject(false);
document.getElementById('btnSaveAs').onclick = () => saveProject(true);
window.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); e.stopImmediatePropagation(); saveProject(e.shiftKey); }
  else if (k === 'o') { e.preventDefault(); e.stopImmediatePropagation(); openProject(); }
}, { capture: true });

// 変更の検知（ワークの移動やスイッチ操作は対象外）
form.addEventListener('change', markDirty);
multiWorkBox.addEventListener('change', markDirty);
wiringModeBox.addEventListener('change', markDirty);
screwBoxes.forEach(b => b.addEventListener('change', () => { if (st.selWork) markDirty(); }));
for (const id of ['btnPlaceLeft', 'btnPlaceCenter', 'btnPlaceRight', 'btnRemoveSel', 'btnRemoveAll'])
  document.getElementById(id).addEventListener('click', markDirty);

// ---------------------------------------------------------------- 起動
window.__dojo = { st, cur, wiring, sim, runner, camera, controls, navKeys }; // デバッグ用
wiring.load(restore('wires', []));
setWiringMode(restore('wiringMode', false));
setMultiWork(false);
try { localStorage.removeItem('seqdojo.multiWork'); } catch { } // 以前の版で記憶した値を消す
showTab(restore('tab', 'conn'));
updateHinban();
loadTasks();
fillForm().then(() => { project.ready = true; updateTitle(); host?.postMessage({ type: 'ready' }); });
runSplash().then(() => { if (!restore('helpNoAuto', false)) toggleHelp(true); });
connectWs();
requestAnimationFrame(frame);
