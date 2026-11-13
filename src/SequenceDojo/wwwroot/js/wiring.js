// 配線モード: 配線練習用 PLC の3Dモデル、ケーブル、回路計算、配線チェック
//
// 配線練習用 PLC（端子配列）は、通信する PLC とは別に選べる。
// 入力・出力は「何点目か」(0〜15) で扱い、通信先の入力先頭・出力先頭からの連番デバイスに対応する。
//
// 端子キー: 作業盤 'T:1'..'T:16' 'T:20'..'T:33' 'T:+1'..'T:+4' 'T:-1'..'T:-4'
//           PLC    'P:IN0'..'P:IN15'（入力）'P:INCOM'（入力コモン: S/S または COM）
//                  'P:OUT0'..'P:OUT15'（出力）'P:COM0'..（出力コモン。グループ番号順）
//                  'P:24V' 'P:0V'（サービス電源。ある機種のみ）
import * as THREE from 'three';
import { M, mat, box, cyl, label, tag } from './gfx.js';

import { PLC_MODELS, DEFAULT_MODEL, buildCircuit, evaluateCircuit, checkCircuit } from './wiring-circuit.js';
export { PLC_MODELS, DEFAULT_MODEL } from './wiring-circuit.js';
const range = n => Array.from({ length: n }, (_, i) => i);

// PLC の置き場所（盤の奥、天面が盤面と同じ高さになる台の上）
const PLC = { x: 0, z: -265, w: 150, h: 83, d: 90 };
const COLORS = { plus: 0xd42a2a, minus: 0x2b2b2b, input: 0x2f6fd6, output: 0xe0c020 };

export class Wiring {
  constructor(scene, tbPositions, modelId = DEFAULT_MODEL) {
    this.scene = scene;
    this.terms = new Map();      // key → { pos, mesh, ghost, label }
    this.wires = [];             // { a, b, mesh, tags }
    this.pending = null;         // 1本目の端子
    this.selected = null;        // 選択中のケーブル
    this.onChange = () => {};
    this.tbGroup = new THREE.Group();
    this.plcGroup = new THREE.Group();
    this.wireGroup = new THREE.Group();
    scene.add(this.tbGroup, this.plcGroup, this.wireGroup);

    for (const [key, p] of Object.entries(tbPositions)) this.#registerTerm(this.tbGroup, `T:${key}`, p.clone(), null, `TB${key}`);
    this.#buildPlc(PLC_MODELS[modelId] ? modelId : DEFAULT_MODEL);
    this.#rebuildNets();
  }

  get pickables() { return [...this.terms.values()].map(t => t.mesh); }
  get wirePickables() { return this.wires.map(w => w.mesh); }

  // ------------------------------------------------------------ 配線練習用 PLC の切替
  // 端子キーは機種共通なので、切替先にも存在する端子の配線は残る。消えた本数を返す
  setModel(id) {
    if (!PLC_MODELS[id] || id === this.modelId) return 0;
    const list = this.toJSON();
    for (const w of this.wires) this.#disposeWire(w);
    this.wires = [];
    this.selected = null;
    this.pending = null;
    for (const k of [...this.terms.keys()]) if (k.startsWith('P:')) this.terms.delete(k);
    this.plcGroup.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); });
    this.plcGroup.clear();
    this.#buildPlc(id);
    let dropped = 0;
    for (const [a, b] of list) {
      if (this.terms.has(a) && this.terms.has(b)) this.#pushWire(a, b); else dropped++;
    }
    this.#rebuildNets();
    this.onChange();
    return dropped;
  }

  // ------------------------------------------------------------ PLC モデル
  #buildPlc(id) {
    this.modelId = id;
    this.model = PLC_MODELS[id];
    this.leds = { x: [], y: [] };
    box(this.plcGroup, 170, -PLC.h + 145, 120, mat(0x8a9099), PLC.x, (-145 + (-PLC.h)) / 2, PLC.z); // 台
    if (this.model.layout === 'compact') this.#buildCompact();
    else this.#buildModules();
  }

  #ledMat() { return mat(0x1d3a22, { emissive: 0x000000 }); }

  // FX 系: 一体型。上段に入力端子台、下段に出力端子台
  #buildCompact() {
    const g = this.plcGroup, m = this.model, top = 0;
    box(g, PLC.w, PLC.h, PLC.d, mat(0xeeeeea), PLC.x, top - PLC.h / 2, PLC.z);
    label(g, `PLC（${m.title}）`, PLC.x + 30, PLC.z - 2, { size: 5, color: '#333', y: top + 0.2 });
    for (let k = 0; k < 16; k++) {
      const lx = PLC.x - 70 + (k % 8) * 5, lz = PLC.z - 10 + Math.floor(k / 8) * 5;
      this.leds.x.push(cyl(g, 1.3, 0.6, this.#ledMat(), lx, top + 0.3, lz, 10));
      this.leds.y.push(cyl(g, 1.3, 0.6, this.#ledMat(), lx, top + 0.3, lz + 14, 10));
    }
    label(g, 'IN', PLC.x - 78, PLC.z - 7.5, { size: 3.4, color: '#333', y: top + 0.2 });
    label(g, 'OUT', PLC.x - 79, PLC.z + 6.5, { size: 3.4, color: '#333', y: top + 0.2 });
    this.runLed = cyl(g, 1.8, 0.6, this.#ledMat(), PLC.x + 60, top + 0.3, PLC.z + 12, 12);
    label(g, 'RUN', PLC.x + 60, PLC.z + 18, { size: 3.4, color: '#333', y: top + 0.2 });

    const inRow = [['L'], ['N'], ['⏚'], ['P:INCOM', m.inCommon]];
    if (m.service) inRow.push(['P:0V', '0V'], ['P:24V', '24V']);
    range(16).forEach(k => inRow.push([`P:IN${k}`, m.x(k)]));
    const outRow = [];
    m.groups.forEach((ks, gi) => { outRow.push([`P:COM${gi}`, m.comLabel(gi)]); ks.forEach(k => outRow.push([`P:OUT${k}`, m.y(k)])); });

    const strip = (items, z) => {
      const pitch = 6.6;
      const x0 = PLC.x - pitch * (items.length - 1) / 2;
      box(g, pitch * items.length + 4, 6, 14, M.tbBase, PLC.x, top + 3, z);
      items.forEach(([key, text], i) => {
        const x = x0 + i * pitch;
        const n = text ?? key;
        box(g, 6, 2, 11, M.dark, x, top + 7, z);
        const screw = cyl(g, 2.2, 1.4, M.metal, x, top + 8.6, z - 2, 14);
        label(g, n, x, z + 4.3, { size: n.length > 3 ? 2.2 : 2.8, color: '#fff', y: top + 8.1, bold: true });
        if (text) this.#registerTerm(g, key, new THREE.Vector3(x, top + 9, z - 2), screw, n);
      });
    };
    strip(inRow, PLC.z - 32);
    strip(outRow, PLC.z + 32);
  }

  // Q / iQ-R 系: ベースユニットに 電源・CPU・入力・出力ユニット。各ユニットに 18 点端子台
  #buildModules() {
    const g = this.plcGroup, m = this.model, top = 0;
    const baseH = 20, modH = PLC.h - baseH, len = 112;
    box(g, 168, baseH, len + 8, mat(0x4a4f57), PLC.x, top - PLC.h + baseH / 2, PLC.z);
    const unit = (x, w, color, name) => {
      box(g, w, modH, len, mat(color), x, top - modH / 2, PLC.z);
      label(g, name, x, PLC.z - len / 2 + 6, { size: 3.6, color: '#222', y: top + 0.2, bold: true });
    };
    unit(PLC.x - 58, 50, 0xe8e8e4, '電源');
    unit(PLC.x - 17, 28, 0xe8e8e4, 'CPU');
    this.runLed = cyl(g, 1.8, 0.6, this.#ledMat(), PLC.x - 17, top + 0.3, PLC.z - 36, 12);
    label(g, 'RUN', PLC.x - 17, PLC.z - 31, { size: 3, color: '#333', y: top + 0.2 });
    label(g, `PLC（${m.title}）`, PLC.x - 58, PLC.z + 10, { size: 3.6, color: '#333', y: top + 0.2 });

    const ioUnit = (x, name, keys, labels, leds) => {
      unit(x, 28, 0xefefeb, name);
      for (let k = 0; k < 16; k++) leds.push(cyl(g, 1, 0.6, this.#ledMat(), x - 8 + (k % 8) * 2.3, top + 0.3, PLC.z - 44 + Math.floor(k / 8) * 3, 8));
      const pitch = 4.7, z0 = PLC.z - 30;
      box(g, 16, 5, pitch * 18 + 3, M.tbBase, x - 4, top + 2.5, z0 + pitch * 8.5);
      for (let i = 0; i < 18; i++) {
        const z = z0 + i * pitch;
        const screw = cyl(g, 1.9, 1.4, M.metal, x - 4, top + 5.7, z, 12);
        const text = labels[i];
        if (text) label(g, text, x + 8, z, { size: 2.4, color: '#222', y: top + 0.2 });
        if (keys[i]) this.#registerTerm(g, keys[i], new THREE.Vector3(x - 4, top + 6.4, z), screw, text);
      }
    };
    ioUnit(PLC.x + 25, m.modules[0],
      [...range(16).map(k => `P:IN${k}`), 'P:INCOM', null], [...range(16).map(m.x), m.inCommon, ''], this.leds.x);
    ioUnit(PLC.x + 62, m.modules[1],
      [...range(16).map(k => `P:OUT${k}`), 'P:COM0', null], [...range(16).map(m.y), m.comLabel(0), ''], this.leds.y);
  }

  #registerTerm(parent, key, pos, mesh, text) {
    const ghost = !mesh; // 盤側端子は透明の当たり判定だけ作る
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1.5, 12), new THREE.MeshBasicMaterial({ visible: false }));
      mesh.position.copy(pos).add(new THREE.Vector3(0, -0.5, 0));
      parent.add(mesh);
    } else {
      mesh.material = mesh.material.clone();
    }
    mesh.userData.action = { type: 'term', key };
    this.terms.set(key, { pos, mesh, ghost, label: text });
  }

  // ------------------------------------------------------------ 操作
  clickTerm(key) {
    if (!this.pending) { this.pending = key; this.#highlight(); return `${this.name(key)} を選択 → 接続先をクリック`; }
    const a = this.pending;
    this.pending = null;
    this.#highlight();
    if (a === key) return '選択を解除しました';
    if (this.wires.some(w => (w.a === a && w.b === key) || (w.a === key && w.b === a))) return '同じ配線が既にあります';
    const n = this.#countAt(a), m = this.#countAt(key);
    this.addWire(a, key);
    return (n >= 2 || m >= 2) ? '⚠ 1つの端子に3本以上つながっています' : `${this.name(a)} ─ ${this.name(key)} を配線`;
  }
  cancel() { this.pending = null; this.#highlight(); }

  #pushWire(a, b) {
    const w = { a, b };
    this.wires.push(w);
    this.#buildWireMesh(w);
    return w;
  }
  addWire(a, b) {
    const w = this.#pushWire(a, b);
    this.#rebuildNets();
    this.onChange();
    return w;
  }
  removeWire(w) {
    this.wires = this.wires.filter(x => x !== w);
    this.#disposeWire(w);
    if (this.selected === w) this.selected = null;
    this.#rebuildNets();
    this.onChange();
  }
  clear() {
    for (const w of this.wires) this.#disposeWire(w);
    this.wires = [];
    this.selected = null;
    this.#rebuildNets();
    this.onChange();
  }
  select(w) {
    if (this.selected) this.selected.mesh.material.emissive.setHex(0);
    this.selected = w;
    if (w) w.mesh.material.emissive.setHex(0x335577);
  }

  // 標準割付どおりの配線（TB1〜16 → 入力 1〜16 点目、TB20〜33 → 出力 1〜14 点目）
  autoStandard() {
    this.clear();
    this.#pushWire('T:+1', 'P:INCOM');                         // 入力コモン: 作業盤 +24V（シンク入力）
    for (let i = 1; i <= 16; i++) this.#pushWire(`T:${i}`, `P:IN${i - 1}`);
    this.model.groups.forEach((_, gi) => this.#pushWire(`T:-${(gi % 4) + 1}`, `P:COM${gi}`)); // 出力コモン → 0V
    for (let j = 0; j < 14; j++) this.#pushWire(`T:${20 + j}`, `P:OUT${j}`);
    this.#rebuildNets();
    this.onChange();
  }

  toJSON() { return this.wires.map(w => [w.a, w.b]); }
  load(list) {
    this.clear();
    for (let [a, b] of list ?? []) {
      [a, b] = [a, b].map(migrateKey);
      if (this.terms.has(a) && this.terms.has(b)) this.#pushWire(a, b);
    }
    this.#rebuildNets();
    this.onChange();
  }

  name(key) {
    const t = this.terms.get(key);
    return key.startsWith('T:') ? `TB${key.slice(2)}` : `PLC ${t?.label ?? key.slice(2)}`;
  }
  #countAt(key) { return this.wires.filter(w => w.a === key || w.b === key).length; }

  #highlight() {
    for (const [k, t] of this.terms) {
      const m = t.mesh.material;
      if (t.ghost) { // 選択時だけ見せる
        m.visible = k === this.pending;
        m.color.setHex(0x44ff88); m.transparent = true; m.opacity = 0.6;
      } else {
        m.emissive.setHex(k === this.pending ? 0x22aa55 : 0x000000);
      }
    }
  }

  // ------------------------------------------------------------ ケーブル描画
  #colorFor(w) {
    const ks = [w.a, w.b];
    if (ks.some(k => /^T:\+|^P:24V|^P:INCOM/.test(k))) return COLORS.plus;
    if (ks.some(k => /^T:-|^P:0V|^P:COM/.test(k))) return COLORS.minus;
    if (ks.some(k => /^P:OUT|^T:(2\d|3[0-3])$/.test(k))) return COLORS.output;
    return COLORS.input;
  }
  #buildWireMesh(w) {
    const a = this.terms.get(w.a).pos, b = this.terms.get(w.b).pos;
    const idxA = this.#countAt(w.a) - 1, idxB = this.#countAt(w.b) - 1; // 同じ端子の2本目は少しずらす
    const up = (p, i) => p.clone().add(new THREE.Vector3(i * 1.2, 14 + i * 3, 0));
    const pa = up(a, idxA), pb = up(b, idxB);
    const mid = pa.clone().lerp(pb, 0.5);
    mid.y = Math.max(pa.y, pb.y) + 12 + a.distanceTo(b) * 0.08;
    const curve = new THREE.CatmullRomCurve3([a.clone(), pa, mid, pb, b.clone()], false, 'catmullrom', 0.3);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.9, 6, false),
      new THREE.MeshStandardMaterial({ color: this.#colorFor(w), roughness: 0.5 }));
    mesh.castShadow = true;
    mesh.userData.action = { type: 'wire', wire: w };
    this.wireGroup.add(mesh);
    w.mesh = mesh;
    // マークチューブ（盤側の端子番号）
    const tb = [w.a, w.b].find(k => k.startsWith('T:'))?.slice(2) ?? '';
    w.tags = [];
    if (tb) {
      for (const p of [pa, pb]) {
        const t = tag(`${tb}.`, { size: 3.2 });
        t.position.copy(p).add(new THREE.Vector3(0, -4, 0));
        this.wireGroup.add(t);
        w.tags.push(t);
      }
    }
  }
  #disposeWire(w) {
    for (const o of [w.mesh, ...(w.tags ?? [])]) {
      this.wireGroup.remove(o);
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose();
    }
  }

  // ------------------------------------------------------------ 回路計算
  // 電源: 作業盤 DC24V (TB+ / TB-) と PLC サービス電源 (24V / 0V、ある機種のみ)
  #rebuildNets() { Object.assign(this, buildCircuit(this.model, this.wires)); }

  evaluate(panelClosed, plcY) { return evaluateCircuit(this, panelClosed, plcY); }

  check() { return checkCircuit(this, this.terms.keys(), key => this.name(key)); }

  // I/O モニタ用: 入力 k / 出力 k の端子名と、つながっている盤の機器
  termX(k) { return this.model.x(k); }
  termY(k) { return this.model.y(k); }
  describeX(k, inputNames) { return this.xSources[k].map(i => `TB${i + 1} ${inputNames[i]}`).join(', '); }
  describeY(k, outputNames) {
    return this.outSources.map((ks, j) => ks.includes(k) ? `TB${20 + j} ${outputNames[j]}` : null).filter(Boolean).join(', ');
  }

  updateLeds(x, y, running) {
    const on = (mesh, v) => { mesh.material.emissive.setHex(v ? 0x22ff55 : 0); mesh.material.color.setHex(v ? 0x66ff88 : 0x1d3a22); };
    this.leds.x.forEach((mesh, k) => on(mesh, x[k]));
    this.leds.y.forEach((mesh, k) => on(mesh, y[k]));
    on(this.runLed, running);
  }
}

// 旧形式（FX5 固定時代）の端子キーを変換: 'P:S/S' 'P:X17' 'P:Y5' など
function migrateKey(k) {
  if (k === 'P:S/S') return 'P:INCOM';
  const mx = /^P:X([0-7]+)$/.exec(k);
  if (mx) return `P:IN${parseInt(mx[1], 8)}`;
  const my = /^P:Y([0-7]+)$/.exec(k);
  if (my) return `P:OUT${parseInt(my[1], 8)}`;
  return k;
}
