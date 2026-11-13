// Three.js非依存の配線モデル・回路計算。描画側とnodeテストで同じ処理を使う。
export { PLC_MODELS, DEFAULT_MODEL } from './plc-models.js';
const range = n => Array.from({ length: n }, (_, i) => i);

export function buildCircuit(model, wires) {
    const circuit = { model, wires };
    const parent = new Map();
    const find = k => {
      if (!parent.has(k)) parent.set(k, k);
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r);
      parent.set(k, r);
      return r;
    };
    const union = (a, b) => parent.set(find(a), find(b));
    for (const [a, b] of model.aliases) union(a, b);
    for (let i = 1; i <= 4; i++) { union(`T:+${i}`, 'SRC:P+'); union(`T:-${i}`, 'SRC:P-'); }
    if (model.service) { union('P:24V', 'SRC:S+'); union('P:0V', 'SRC:S-'); }
    for (const w of wires) union(w.a, w.b);
    circuit.find = find;
    const same = (a, b) => find(a) === find(b);
    circuit.short = same('SRC:P+', 'SRC:P-') || same('SRC:S+', 'SRC:S-') ||
      (same('SRC:P+', 'SRC:S-') && same('SRC:P-', 'SRC:S+'));

    // 各入力が「どの盤入力」に、各盤出力が「どの出力」に繋がっているか
    circuit.xSources = range(16).map(k => {
      const net = find(`P:IN${k}`);
      return range(16).filter(i => find(`T:${i + 1}`) === net);
    });
    circuit.outSources = range(14).map(j => {
      const net = find(`T:${20 + j}`);
      return range(16).filter(k => find(`P:OUT${k}`) === net);
    });
    return circuit;
}

export function evaluateCircuit(circuit, panelClosed, plcY) {
    const find = circuit.find;
    const x = new Array(16).fill(false);
    const out = new Array(14).fill(false);
    if (circuit.short) return { x, out };
    const panelMinus = find('SRC:P-');
    for (let k = 0; k < 16; k++) {
      const common = find(circuit.model.inputCommons.find(g => g.indices.includes(k)).key);
      const srcs = [['SRC:P+', 'SRC:P-'], ...(circuit.model.service ? [['SRC:S+', 'SRC:S-']] : [])].filter(([p]) => find(p) === common);
      const net = find(`P:IN${k}`);
      x[k] = srcs.some(([, m]) => net === find(m) ||
        (find(m) === panelMinus && circuit.xSources[k].some(i => panelClosed[i])));
    }
    // 出力機器は盤+24V側に接続済み。反対側(TB)が 0V に落ちれば点灯
    for (let j = 0; j < 14; j++) {
      const net = find(`T:${20 + j}`);
      out[j] = net === panelMinus ||
        circuit.outSources[j].some(k => {
          const gi = circuit.model.groups.findIndex(ks => ks.includes(k));
          const powered = circuit.model.outputPower.filter(p => p.group === gi).every(p => find(p.key) === find('SRC:P+'));
          return plcY[k] && gi >= 0 && powered && find(`P:COM${gi}`) === panelMinus;
        });
    }
    return { x, out };
  }

export function checkCircuit(circuit, termKeys, name = key => key.startsWith('T:') ? `TB${key.slice(2)}` : `PLC ${key.slice(2)}`) {
    const countAt = key => circuit.wires.filter(w => w.a === key || w.b === key).length;
    const find = circuit.find, m = circuit.model;
    const res = [];
    const add = (level, text) => res.push({ level, text });
    if (circuit.short) add('err', '短絡しています（+ と − が直結）。実機ならヒューズが切れます');
    for (const g of m.inputCommons) {
      const common = find(g.key);
      const fromPanel = common === find('SRC:P+');
      const fromService = m.service && common === find('SRC:S+');
      if (!fromPanel && !fromService) add('err', `入力コモン（${g.label}）に +24V が配線されていません`);
      if (fromService && find('SRC:S-') !== find('SRC:P-'))
        add('err', `${g.label} をサービス電源 24V から取る場合、PLC の 0V と作業盤の − を接続してください`);
    }
    m.groups.forEach((ks, gi) => {
      const used = ks.some(k => circuit.wires.some(w => find(w.a) === find(`P:OUT${k}`) || find(w.b) === find(`P:OUT${k}`)));
      if (used && find(`P:COM${gi}`) !== find('SRC:P-')) add('err', `出力コモン ${m.comLabel(gi)} が作業盤の −（0V）に接続されていません`);
    });
    for (const p of m.outputPower) if (find(p.key) !== find('SRC:P+'))
      add('err', `出力外部電源 ${p.label} に作業盤の +24V が配線されていません`);
    for (let i = 1; i <= 16; i++) if (!countAt(`T:${i}`)) add('warn', `TB${i} が未配線です`);
    for (let j = 20; j <= 33; j++) if (!countAt(`T:${j}`)) add('warn', `TB${j} が未配線です`);
    for (const k of termKeys) if (countAt(k) > 2) add('warn', `${name(k)} に ${countAt(k)} 本つながっています（Y端子は2本まで）`);
    for (let i = 1; i <= 16; i++) {
      const xs = range(16).filter(k => find(`P:IN${k}`) === find(`T:${i}`)).map(m.x);
      if (xs.length && xs[0] !== m.x(i - 1)) add('info', `TB${i} → ${xs.join(',')}（標準割付は ${m.x(i - 1)}）`);
      if (xs.length > 1) add('err', `TB${i} が複数の入力 ${xs.join(',')} に接続されています`);
    }
    for (let j = 0; j < 14; j++) {
      const ys = circuit.outSources[j].map(m.y);
      if (ys.length && ys[0] !== m.y(j)) add('info', `TB${20 + j} → ${ys.join(',')}（標準割付は ${m.y(j)}）`);
      if (ys.length > 1) add('err', `TB${20 + j} が複数の出力 ${ys.join(',')} に接続されています`);
    }
    if (!res.some(r => r.level !== 'info')) add('ok', '配線に問題は見つかりませんでした');
    return res;
  }
