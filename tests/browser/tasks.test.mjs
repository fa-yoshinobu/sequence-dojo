import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskRunner } from '../../src/SequenceDojo/wwwroot/js/tasks.js';

function fixture(observe = () => ({ PL1: true, conveyor: 'stop' })) {
  const calls = [];
  const log = [];
  const sim = {
    observe,
    releaseAll: () => calls.push(['releaseAll']),
    setPb: (...args) => calls.push(['setPb', ...args]),
    holdPb: (...args) => calls.push(['holdPb', ...args]),
    reset: () => calls.push(['reset']),
    setSs: (...args) => calls.push(['setSs', ...args]),
    setDsw: (...args) => calls.push(['setDsw', ...args]),
    placeWork: (...args) => calls.push(['placeWork', ...args]),
    clearWorks: () => calls.push(['clearWorks']),
  };
  const runner = new TaskRunner(sim);
  return { runner, calls, log, run: scenario => runner.run({ scenario }, (...args) => log.push(args)) };
}

test('expect compares observed values and reports each result', async () => {
  const { run, log, calls, runner } = fixture();
  assert.deepEqual(await run([{ expect: { PL1: true } }, { expect: { PL1: false }, msg: 'lamp off' }]), { pass: 1, total: 2 });
  assert.deepEqual(log.map(entry => entry[0]), ['ok', 'ng']);
  assert.match(log[1][1], /lamp off/);
  assert.equal(runner.running, false);
  assert.deepEqual(calls, [['releaseAll']]);
});

test('waitFor polls until the condition becomes true', async () => {
  let observations = 0;
  const { run, log } = fixture(() => ({ LS1: ++observations >= 2 }));
  assert.deepEqual(await run([{ waitFor: { LS1: true }, timeout: 2000 }]), { pass: 1, total: 1 });
  assert.ok(observations >= 2);
  assert.equal(log[0][0], 'ok');
});

test('waitFor reports a timeout when the condition stays false', async () => {
  const { run, log } = fixture(() => ({ LS1: false }));
  assert.deepEqual(await run([{ waitFor: { LS1: true }, timeout: 1 }]), { pass: 0, total: 1 });
  assert.match(log[0][1], /時間切れ/);
});

test('expectFor requires the condition throughout the interval', async () => {
  let observations = 0;
  const { run } = fixture(() => ({ conveyor: ++observations < 2 ? 'stop' : 'right' }));
  assert.deepEqual(await run([{ expectFor: { conveyor: 'stop' }, ms: 500 }]), { pass: 0, total: 1 });
});

test('expectFor passes for a stable condition', async () => {
  const { run } = fixture();
  assert.deepEqual(await run([{ expectFor: { conveyor: 'stop' }, ms: 25 }]), { pass: 1, total: 1 });
});

test('abort stops subsequent steps and releases pressed buttons', async () => {
  const { run, runner, calls, log } = fixture();
  const operation = run([{ press: 'PB1', ms: 10 }, { expect: { PL1: true } }]);
  runner.abort = true;
  assert.deepEqual(await operation, { pass: 0, total: 0 });
  assert.deepEqual(calls, [['setPb', 'PB1', true], ['setPb', 'PB1', false], ['releaseAll']]);
  assert.ok(log.some(entry => entry[0] === 'stop'));
  assert.equal(runner.running, false);
});

test('an observation failure still releases controls and clears running', async () => {
  const { run, runner, calls } = fixture(() => { throw new Error('observation failed'); });
  await assert.rejects(run([{ expect: { PL1: true } }]), /observation failed/);
  assert.deepEqual(calls, [['releaseAll']]);
  assert.equal(runner.running, false);
});
