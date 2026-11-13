import * as THREE from 'three';
import { OrbitControls } from '../vendor/addons/OrbitControls.js';
import { M, mat, box, cyl, label } from './gfx.js';
import { Wiring, DEFAULT_MODEL } from './wiring.js';
import { CONV, WORK, LS_X, bcd } from './simulation.js';
import { recordPlcEvent } from './plc-diagnostics.js';
export function createBoardView(st, cur, hooks, restore) {
  // ---------------------------------------------------------------- シーン
  const container = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
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
    hooks.selectWork?.(w);
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
    plc: [[0, 260, -264.99], [0, 0, -265]],
    conv: [[0, 190, 190], [-10, 20, 48]],
    ops: [[0, 190, 290], [0, 0, 125]],
  };
  let tween = null;
  function goView(name) {
    let [p, t] = VIEWS[name];
    if (name === 'wiring') {
      const scale = Math.max(1, (wiring.model.width ?? 180) / 180);
      p = [0, 300 * scale, -200 + 210 * scale];
    }
    if (name === 'plc') {
      const h = container.clientHeight;
      const docks = ['left','right'].reduce((sum, id) => sum + (document.getElementById(id)?.offsetWidth || 0), 0);
      const availableWidth = Math.max(160, container.clientWidth - docks - 60);
      const width = wiring.model.width ?? 170;
      const distance = 1.15 * Math.max(width * h / availableWidth, 120 * h / Math.max(160, h - 150)) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      p = [0, Math.max(160, distance), -264.99];
    }
    tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...p), t1: new THREE.Vector3(...t) };
  }
  camera.position.set(...VIEWS.home[0]);
  controls.target.set(...VIEWS.home[1]);
  document.querySelectorAll('#views button[data-view]').forEach(b => b.addEventListener('click', () => goView(b.dataset.view)));

  // ---------------------------------------------------------------- ポインタ操作
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tooltip = document.getElementById('terminalTooltip');
  const hideTooltip = () => { tooltip.hidden = true; };
  let pressed = null;   // 押している PB
  let dragWork = null;  // { work, dx }
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(CONV.top + WORK.h));

  function currentPickables() {
    const list = [...panelPickables];
    for (const w of st.works) w.group.traverse(o => { if (o.isMesh) list.push(o); });
    if (st.wiringMode) list.push(...wiring.pickables, ...wiring.wirePickables);
    return list;
  }
  function pick(e, inspectTerminal = false) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(inspectTerminal ? wiring.pickables : currentPickables(), false);
    return hits[0]?.object.userData.action ?? null;
  }
  function rayX() {
    const v = new THREE.Vector3();
    return ray.ray.intersectPlane(dragPlane, v) ? v.x : null;
  }

  // マウスの取込み（ポインタキャプチャ）が残ると、以後のクリックが全部 3D 画面に吸われて
  // 左右のパネルが操作できなくなる。3D 画面以外を押したときは取込みを解除して、状態を戻す。
  const capturedPointers = new Set();
  renderer.domElement.addEventListener('gotpointercapture', e => capturedPointers.add(e.pointerId));
  renderer.domElement.addEventListener('lostpointercapture', e => capturedPointers.delete(e.pointerId));
  function resetPointerState(pointerId) {
    for (const id of pointerId == null ? [...capturedPointers] : [pointerId]) {
      if (renderer.domElement.hasPointerCapture?.(id)) {
        // OrbitControls側のドラッグ状態も終了させる（ウィンドウ外でボタンを離した場合）。
        renderer.domElement.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id }));
        if (renderer.domElement.hasPointerCapture(id)) renderer.domElement.releasePointerCapture(id);
      }
      capturedPointers.delete(id);
    }
    if (pressed != null) { st.pb[pressed] = false; pressed = null; }
    dragWork = null;
    controls.enabled = true;
  }
  renderer.domElement.addEventListener('pointerdown', e => {
    hideTooltip();
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (under && under !== renderer.domElement) {
      // 残っていた取込みで 3D 画面に届いたクリック。解除して、押した場所へ渡し直す
      e.stopImmediatePropagation();
      resetPointerState(e.pointerId);
      recordPlcEvent('3Dのポインター取込みを解除', `押した要素=${under.id || under.tagName}`);
      under.focus?.();
      if (typeof under.showPicker === 'function') {
        try { under.showPicker(); } catch (error) { recordPlcEvent('選択一覧の再表示エラー', String(error)); }
      } else under.click?.();
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
        hooks.setWireMsg(wiring.clickTerm(a.key));
        break;
      case 'wire':
        wiring.select(a.wire);
        hooks.setWireMsg(`選択: ${wiring.name(a.wire.a)} ─ ${wiring.name(a.wire.b)}（Delete で削除）`);
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
    const terminal = !e.buttons && pick(e, true);
    if (terminal?.type === 'term') {
      tooltip.textContent = wiring.terminalDescription(terminal.key);
      tooltip.hidden = false;
      tooltip.style.left = `${Math.max(8, Math.min(e.clientX + 16, container.clientWidth - tooltip.offsetWidth - 12))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(e.clientY + 16, container.clientHeight - tooltip.offsetHeight - 12))}px`;
    } else hideTooltip();
  });
  renderer.domElement.addEventListener('pointerleave', hideTooltip);
  controls.addEventListener?.('change', hideTooltip);

  window.addEventListener('pointerup', () => resetPointerState());
  window.addEventListener('pointercancel', e => resetPointerState(e.pointerId));
  // ウィンドウ外でボタンを離したり、ほかのウィンドウに切り替えたりしたときも戻す
  window.addEventListener('blur', () => { resetPointerState(); navKeys.clear(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetPointerState(); });

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
  const isPanel = e => e.target instanceof Element && !!e.target.closest('.dock, dialog');
  window.addEventListener('focusin', e => { if (isPanel(e) || isTyping(e)) navKeys.clear(); });
  window.addEventListener('keydown', e => {
    if (e.key === 'F1' || (e.key === '?' && !isTyping(e))) {
      e.preventDefault();
      hooks.toggleHelp();
      return;
    }
    if (hooks.helpOpen() || isTyping(e) || isPanel(e)) { navKeys.clear(); return; }
    if (NAV_KEYS.has(e.key)) { e.preventDefault(); navKeys.add(e.key); navMods = { shift: e.shiftKey, ctrl: e.ctrlKey }; return; }
    if (e.key === 'Escape') { wiring.cancel(); wiring.select(null); hooks.setWireMsg(''); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && wiring.selected) { wiring.removeWire(wiring.selected); hooks.setWireMsg('削除しました'); }
  });

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

  function draw(dt) {
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



    renderer.render(scene, camera);

  }


  return { goView, camera, controls, navKeys, wiring, createWork, removeWork, selectWork, placeWork, clearWorks, draw, get draggedWork() { return dragWork?.work; }, moveBelt(dir, dt) { beltTex.offset.x -= dir * CONV.speed * dt / ((CONV.xMax - CONV.xMin) / beltTex.repeat.x); } };
}
