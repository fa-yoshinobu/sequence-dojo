import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as current from '../../src/SequenceDojo/wwwroot/js/simulation.js';
import * as legacy from './fixtures/legacy-simulation.mjs';
import { TaskRunner } from '../../src/SequenceDojo/wwwroot/js/tasks.js';
import { createPracticePlc } from './fixtures/practice-plc.mjs';

async function replay(t, impl, task, number) {
  const st = impl.createState(), cur = impl.createCurrent(), plc = createPracticePlc(number);
  let now = 0; const trace = [], log = [];
  const removeWork = w => { st.works = st.works.filter(v => v !== w); };
  const clearWorks = () => { st.works = []; };
  const placeWork = (at, screws) => {
    if (!st.multiWork) clearWorks();
    const x = at === 'left' ? impl.WORK.xMin : at === 'right' ? impl.WORK.xMax : (impl.WORK.xMin + impl.WORK.xMax) / 2;
    st.works.push({x, screws});
  };
  const api = impl.createTaskApi(st, cur, { clearWorks, removeWork, placeWork });
  const advance = ms => {
    while (ms > 0) {
      const dt = Math.min(ms,20); ms -= dt; now += dt;
      st.manualY = plc(cur.x, now);
      impl.stepSimulation(st, cur, dt / 1000);
      trace.push({ now, x:[...cur.x], out:[...cur.out], ls:[...st.ls], relay:[...st.relay], works:st.works.map(w => w.x) });
    }
  };
  const timer = t.mock.method(globalThis, 'setTimeout', (callback, ms) => { advance(ms); queueMicrotask(callback); return 0; });
  const clock = t.mock.method(performance, 'now', () => now);
  try {
    const result = await new TaskRunner(api).run(task, (...entry) => log.push(entry));
    return { result, log, trace, observe:api.observe() };
  } finally { timer.mock.restore(); clock.mock.restore(); }
}
for (const [index,name] of ['t01_selfhold.json','t02_conveyor.json','t03_hinban.json'].entries()) {
  test(`${name}: bundled scenario keeps all numeric samples and verdicts after extraction`, async t => {
    const task = JSON.parse(await readFile(new URL(`../../src/SequenceDojo/wwwroot/tasks/${name}`, import.meta.url)));
    const before = await replay(t, legacy, task, index+1), after = await replay(t, current, task, index+1);
    assert.deepEqual(after, before);
    assert.ok(after.result.total > 0);
    assert.equal(after.result.pass, after.result.total, JSON.stringify(after.log.filter(([level]) => level === 'ng')));
  });
}
