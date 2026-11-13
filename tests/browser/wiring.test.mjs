import test from 'node:test';
import assert from 'node:assert/strict';
import { PLC_MODELS, buildCircuit, evaluateCircuit, checkCircuit } from '../../src/SequenceDojo/wwwroot/js/wiring-circuit.js';

const bits = (...on) => Array.from({ length: 16 }, (_, i) => on.includes(i));
function standard(modelId = 'fx5s') {
  const model = PLC_MODELS[modelId];
  const wires = [{ a: 'T:+1', b: 'P:INCOM' }];
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
  assert.deepEqual(evaluateCircuit(circuit, bits(), bits(4, 12, 13)).out,
    Array.from({ length: 14 }, (_, i) => i === 4));
  assert.ok(checkCircuit(circuit, terms).some(result => result.level === 'err' && result.text.includes('COM3')));
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
