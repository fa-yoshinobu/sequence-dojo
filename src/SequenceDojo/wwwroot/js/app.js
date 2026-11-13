import * as THREE from 'three';
import { createState, createCurrent, stepSimulation, createTaskApi } from './simulation.js';
import { createBoardView } from './board-view.js';
import { createScreenControls } from './screen-controls.js';
import { createCommunications } from './communications.js';
import { createConnectionForm } from './connection-form.js';
import { createProjects } from './projects.js';
import { createTaskControls } from './task-controls.js';
// ---------------------------------------------------------------- I/O 定義
// 盤入力 index 0..15 = TB1..16、盤出力 index 0..13 = TB20..33
const INPUT_NAMES = ['LS1 右端', 'LS2 左端', 'LS3 品番', 'LS4 品番', 'LS5 品番',
  'PB1', 'PB2', 'PB3', 'PB4', 'PB5 非常停止', 'SS1 連続', 'SS0 自動', 'DSW 1', 'DSW 2', 'DSW 4', 'DSW 8'];
const OUTPUT_NAMES = ['RY1 左行', 'RY2 右行', 'PL1', 'PL2', 'PL3', 'PL4',
  'DPL1 1', 'DPL1 2', 'DPL1 4', 'DPL1 8', 'DPL2 10', 'DPL2 20', 'DPL2 40', 'DPL2 80'];


const st = createState(), cur = createCurrent();
function store(k, v) { try { localStorage.setItem(`seqdojo.${k}`, JSON.stringify(v)); } catch { } }
function restore(k, def) { try { return JSON.parse(localStorage.getItem(`seqdojo.${k}`)) ?? def; } catch { return def; } }
const hooks = {};
const view = createBoardView(st, cur, hooks, restore);
const { camera, controls, navKeys, wiring } = view;
const ui = createScreenControls(st, view, hooks, store, restore);
Object.assign(hooks, { selectWork: ui.selectWork, setWireMsg: ui.setWireMsg, helpOpen: ui.helpOpen, toggleHelp: ui.toggleHelp, buildIoTables });
const { runSplash, toggleHelp, showTab, updateHinban, setWiringMode, setMultiWork } = ui;
const comm = createCommunications(st, { onOpen: () => { lastSent = ''; if (projects.isReady()) send({ type: 'project-ready' }); }, onFileOpened: m => projects.onOpened(m, send), buildIoTables });
const { send, connectWs } = comm;
const connection = createConnectionForm(st, { buildIoTables, send, setBadge: comm.setBadge }, store, restore);
const { fillForm, deviceName } = connection;
const sim = createTaskApi(st, cur, view);
const { runner, loadTasks } = createTaskControls(st, sim, store, restore);
const projects = createProjects(st, view, ui, connection, runner, store);
hooks.markDirty = projects.markDirty;
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

// 入出力とコンベアは描画と独立して一定周期で回す（タブが裏でも判定が止まらない）
let lastSent = '';
let lastTick = performance.now();
function simTick() {
  const now = performance.now();
  const dt = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;

  const dir = stepSimulation(st, cur, dt, { evaluateWiring: (closed, y) => wiring.evaluate(closed, y), draggedWork: view.draggedWork });
  if (dir) view.moveBelt(dir, dt);
  const x = cur.x;
  const key = x.map(b => (b ? 1 : 0)).join('');
  if (key !== lastSent) { send({ type: 'inputs', bits: x }); lastSent = key; }
}
setInterval(simTick, 20);


const clock = new THREE.Clock();
function frame() {
  view.draw(Math.min(clock.getDelta(), 0.1));
  inRows.forEach((tr, k) => tr.classList.toggle('on', cur.x[k]));
  outRows.forEach((tr, k) => tr.classList.toggle('on', cur.y[k]));
  requestAnimationFrame(frame);
}
// ---------------------------------------------------------------- 起動
window.__dojo = { st, cur, wiring, sim, runner, camera, controls, navKeys }; // デバッグ用
wiring.load(restore('wires', []));
setWiringMode(restore('wiringMode', false));
setMultiWork(false);
try { localStorage.removeItem('seqdojo.multiWork'); } catch { } // 以前の版で記憶した値を消す
showTab(restore('tab', 'conn'));
updateHinban();
loadTasks();
fillForm().then(() => { projects.ready(); send({ type: 'project-ready' }); });
runSplash().then(() => { if (!restore('helpNoAuto', false)) toggleHelp(true); });
connectWs();
requestAnimationFrame(frame);
