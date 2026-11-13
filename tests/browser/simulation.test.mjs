import test from 'node:test';
import assert from 'node:assert/strict';
import * as sim from '../../src/SequenceDojo/wwwroot/js/simulation.js';

test('relay interlock keeps the active direction and gives left priority from rest', () => {
  const st = sim.createState();
  sim.updateRelays(st, [true, true]); assert.deepEqual(st.relay, [true, false]);
  st.relay = [false, true]; sim.updateRelays(st, [true, true]); assert.deepEqual(st.relay, [false, true]);
  sim.updateRelays(st, [true, false]); assert.deepEqual(st.relay, [false, false]);
  sim.updateRelays(st, [true, false]); assert.deepEqual(st.relay, [true, false]);
});
test('limit switches use each screw and include only the eight millimetre boundary', () => {
  const st = sim.createState();
  st.works = [{ x: sim.LS_X.left - 8, screws: [true, false, true, true] }];
  sim.updateLimitSwitches(st); assert.deepEqual(st.ls, [false, true, true, false, true]);
  st.works[0].x -= .001; sim.updateLimitSwitches(st); assert.deepEqual(st.ls, Array(5).fill(false));
  st.works[0].x = sim.LS_X.right + 8; sim.updateLimitSwitches(st); assert.deepEqual(st.ls, [true, false, false, false, false]);
});
test('collisions preserve sorting, pitch and directional end stops', () => {
  const st = sim.createState();
  st.works = [{ x: 81 }, { x: 70 }, { x: 60 }]; sim.resolveWorks(st, 1);
  assert.deepEqual(st.works.map(w => w.x), [80, 30.5, -19]);
  st.works = [{ x: -92 }, { x: -80 }, { x: -70 }]; sim.resolveWorks(st, -1);
  assert.deepEqual(st.works.map(w => w.x), [-91, -41.5, 8]);
});
test('a step uses previous LS contacts before moving, then updates LS', () => {
  const st = sim.createState(), cur = sim.createCurrent();
  st.works = [{ x: 63.5, screws: [false, false, false, true] }];
  st.manualY[1] = true; sim.stepSimulation(st, cur, .02);
  assert.equal(st.works[0].x, 64.4); assert.equal(cur.x[0], false); assert.equal(st.ls[0], true);
  sim.stepSimulation(st, cur, .02, { draggedWork: st.works[0] });
  assert.equal(st.works[0].x, 64.4); assert.equal(cur.x[0], true);
});
test('power and wiring retain their IO override order', () => {
  const st = sim.createState(), cur = sim.createCurrent(); st.connected = true; st.serverY[0] = true;
  st.wiringMode = true; let seen;
  sim.stepSimulation(st, cur, .02, { evaluateWiring(c, y) { seen = [c,y]; return { x: Array(16).fill(true), out: y.slice(0,14) }; } });
  assert.equal(seen[1], st.serverY); assert.equal(cur.x[0], true); assert.equal(st.relay[0], true);
  st.power = false;
  sim.stepSimulation(st, cur, .02, { evaluateWiring(c, y) { assert.ok(c.every(v => !v)); return { x: Array(16).fill(true), out: y.slice(0,14) }; } });
  assert.ok(cur.out.every(v => !v)); assert.deepEqual(st.relay, [false,false]);
});
