import test from 'node:test';
import assert from 'node:assert/strict';
import { PLC_MODELS, buildCircuit, evaluateCircuit, checkCircuit } from '../../src/SequenceDojo/wwwroot/js/wiring-circuit.js';
import { terminalLayout } from '../../src/SequenceDojo/wwwroot/js/plc-models.js';

const bits = (...on) => Array.from({ length: 16 }, (_, i) => on.includes(i));
function standard(modelId = 'fx5s') {
  const model = PLC_MODELS[modelId];
  const wires = model.inputCommons.map((g, i) => ({ a: `T:+${i + 1}`, b: g.key }));
  model.outputPower.forEach((p, i) => wires.push({ a: `T:+${model.inputCommons.length + i + 1}`, b: p.key }));
  for (let i = 0; i < 16; i++) wires.push({ a: `T:${i + 1}`, b: `P:IN${i}` });
  for (let i = 0; i < 14; i++) wires.push({ a: `T:${20 + i}`, b: `P:OUT${i}` });
  model.groups.forEach((_, i) => wires.push({ a: `T:-${i + 1}`, b: `P:COM${i}` }));
  const terms = [
    ...Array.from({ length: 16 }, (_, i) => `T:${i + 1}`),
    ...Array.from({ length: 14 }, (_, i) => `T:${20 + i}`),
    ...Array.from({ length: 16 }, (_, i) => `P:IN${i}`),
    ...Array.from({ length: 16 }, (_, i) => `P:OUT${i}`),
    ...model.groups.map((_, i) => `P:COM${i}`),
    'P:INCOM', 'T:+1', 'T:+2', 'T:+3', 'T:+4', 'T:-1', 'T:-2', 'T:-3', 'T:-4',
  ];
  return { model, wires, terms };
}

for (const modelId of Object.keys(PLC_MODELS)) {
  test(`${modelId}: standard assignment follows every input and board output`, () => {
    const { model, wires, terms } = standard(modelId);
    const circuit = buildCircuit(model, wires);
    assert.deepEqual(checkCircuit(circuit, terms), [{ level: 'ok', text: '配線に問題は見つかりませんでした' }]);
    for (let i = 0; i < 16; i++) {
      const result = evaluateCircuit(circuit, bits(i), bits(i));
      assert.deepEqual(result.x, bits(i));
      assert.deepEqual(result.out, Array.from({ length: 14 }, (_, j) => j === i));
    }
  });
}

test('short circuit suppresses every input and output', () => {
  const { model, wires, terms } = standard();
  wires.push({ a: 'T:+2', b: 'T:-2' });
  const circuit = buildCircuit(model, wires);
  assert.equal(circuit.short, true);
  assert.deepEqual(evaluateCircuit(circuit, bits(0, 15), bits(0, 13)), { x: bits(), out: Array(14).fill(false) });
  assert.ok(checkCircuit(circuit, terms).some(result => result.level === 'err' && result.text.includes('短絡')));
});

test('unwired input common keeps inputs off and reports the missing power', () => {
  const { model, wires, terms } = standard();
  const circuit = buildCircuit(model, wires.filter(wire => wire.b !== 'P:INCOM'));
  assert.deepEqual(evaluateCircuit(circuit, bits(0, 3), bits()).x, bits());
  assert.ok(checkCircuit(circuit, terms).some(result => result.level === 'err' && result.text.includes('入力コモン')));
});

test('service power needs its zero volt connected to the panel minus', () => {
  const { model, wires, terms } = standard();
  wires[0] = { a: 'P:24V', b: 'P:INCOM' };
  const isolated = buildCircuit(model, wires);
  assert.deepEqual(evaluateCircuit(isolated, bits(2), bits()).x, bits());
  assert.ok(checkCircuit(isolated, terms).some(result => result.level === 'err' && result.text.includes('0V')));
  wires.push({ a: 'P:0V', b: 'T:-1' });
  assert.deepEqual(evaluateCircuit(buildCircuit(model, wires), bits(2), bits()).x, bits(2));
});

test('a missing output common disables only that group', () => {
  const { model, wires, terms } = standard();
  const circuit = buildCircuit(model, wires.filter(wire => wire.b !== 'P:COM3'));
  assert.deepEqual(evaluateCircuit(circuit, bits(), bits(4, 10, 11, 12, 13)).out,
    Array.from({ length: 14 }, (_, i) => [4, 10].includes(i)));
  assert.ok(checkCircuit(circuit, terms).some(result => result.level === 'err' && result.text.includes('COM3')));
});

test('NPN module needs its external +V as well as COM', () => {
  const { model, wires, terms } = standard('QX40+QY40P');
  const circuit = buildCircuit(model, wires.filter(w => w.b !== 'P:VPLUS0'));
  assert.deepEqual(evaluateCircuit(circuit, bits(1), bits(1)).out, Array(14).fill(false));
  assert.ok(checkCircuit(circuit, terms).some(r => r.level === 'err' && r.text.includes('+V')));
});

test('terminal positions keep TS common placement', () => {
  const ts = PLC_MODELS['RX40C7-TS+RY40NT5P-TS'];
  assert.equal(ts.terminals.input.find(t => t.key === 'P:INCOM').pin, 'TB9');
  assert.equal(ts.terminals.input.find(t => t.key === 'P:IN8').pin, 'TB10');
  assert.equal(ts.terminals.output.find(t => t.key === 'P:VPLUS0').pin, 'TB9');

});

test('nonstandard input assignment is calculated and reported', () => {
  const { model, wires, terms } = standard();
  wires.find(wire => wire.a === 'T:1').b = 'P:IN1';
  wires.find(wire => wire.a === 'T:2').b = 'P:IN0';
  const circuit = buildCircuit(model, wires);
  assert.deepEqual(evaluateCircuit(circuit, bits(0), bits()).x, bits(1));
  assert.ok(checkCircuit(circuit, terms).some(result => result.level === 'info' && result.text.includes('標準割付')));
});

test('multiple PLC inputs on one panel terminal are rejected by the checker', () => {
  const { model, wires, terms } = standard();
  wires.push({ a: 'T:1', b: 'P:IN1' });
  assert.ok(checkCircuit(buildCircuit(model, wires), terms)
    .some(result => result.level === 'err' && result.text.includes('複数の入力')));
});

test('direct grounding turns on a connected sink input or board output', () => {
  const { model, wires } = standard();
  wires.push({ a: 'P:IN0', b: 'T:-1' }, { a: 'T:20', b: 'T:-2' });
  const result = evaluateCircuit(buildCircuit(model, wires), bits(), bits());
  assert.equal(result.x[0], true);
  assert.equal(result.out[0], true);
});

test('lineup is limited to 16 inputs and 14-16 outputs on terminal blocks', () => {
  for (const [id, model] of Object.entries(PLC_MODELS)) {
    assert.equal(model.inputCount, 16, id);
    assert.ok(model.outputCount >= 14 && model.outputCount <= 16, id);
    assert.ok(!model.connector && !model.inputConnector && !model.outputConnector, id);
  }
  for (const id of ['FX5S-40MR/ES', 'FX5U-80MT/ES', 'FX5UC-32MT/D', 'QX41+QY41P', 'RH42C4NT2P'])
    assert.equal(PLC_MODELS[id], undefined, id);
});

test('lineup uses AC100V-capable main supplies and excludes DC and EC variants', () => {
  const compact = Object.values(PLC_MODELS).filter(m => m.layout !== 'modules');
  assert.deepEqual(compact.map(m => m.title).sort(),
    ['FX5S-30MR/ES','FX5S-30MT/ES','FX5U-32MR/ES','FX5U-32MT/ES']);
  for (const m of Object.values(PLC_MODELS)) {
    assert.equal(m.powerSupply, 'AC100～240V');
    assert.ok(!m.title.includes('-EC'));
    if (m.layout === 'modules') assert.equal(m.displayPower, m.series === 'Q' ? 'Q61P' : 'R61P');
  }
  for (const id of ['FX5S-30MR/DS','FX5U-32MT/DS','FX5UC-32MR/DS-TS','MXF100-16-N32','MXF100-16-N32-EC'])
    assert.equal(PLC_MODELS[id], undefined, id);
});

test('rack lineup pairs only the same input and output terminal style', () => {
  assert.equal(Object.keys(PLC_MODELS).length, 18);
  for (const id of ['QX40+QY10-TS','QX40-TS+QY10','RX40C7+RY10R2-TS','RX40C7-TS+RY10R2'])
    assert.equal(PLC_MODELS[id], undefined, id);
  for (const id of ['q','QX40-TS+QY10-TS','iqr','RX40C7-TS+RY10R2-TS'])
    assert.ok(PLC_MODELS[id], id);
  for (const m of Object.values(PLC_MODELS).filter(m => m.layout === 'modules')) {
    const inputColumns = terminalLayout(m, 'input')[0].length;
    const outputColumns = terminalLayout(m, 'output')[0].length;
    assert.equal(inputColumns, outputColumns, m.title);
    assert.equal(m.terminalType, inputColumns === 2 ? '入出力とも差し込み式' : '入出力ともねじ止め式');
  }
});

test('physical terminal rows preserve the manual layout and all selectable contacts', () => {
  for (const [id,m] of Object.entries(PLC_MODELS)) {
    const keys = ['input','output'].flatMap(s => terminalLayout(m,s).flat().filter(t => t.key).map(t => t.key));
    assert.equal(new Set(keys).size,keys.length,id);
    assert.deepEqual([...keys].sort(),[...m.terminals.input,...m.terminals.output].filter(t => t.key).map(t => t.key).sort(),id);
  }
  const fx = terminalLayout(PLC_MODELS.fx5s,'output');
  assert.equal(fx[0][0].key,'P:0V');
  assert.equal(fx[1][0].key,'P:24V');
  assert.equal(fx[0][8].key,'P:OUT11');
  assert.equal(fx[1][8].key,'P:COM3');
  const ts = terminalLayout(PLC_MODELS['RX40C7-TS+RY40NT5P-TS'],'output');
  assert.equal(ts[8][0].key,'P:VPLUS0');
  assert.equal(ts[8][1].key,'P:COM0');
});
