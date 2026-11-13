import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceElapsed,createSimulationClock} from '../../src/SequenceDojo/wwwroot/js/simulation-clock.js';
import {createState,createCurrent,stepSimulation} from '../../src/SequenceDojo/wwwroot/js/simulation.js';

for (const dt of [0,.02,.079,.1]) test(`ordinary ${dt}s tick preserves its exact single dt`,()=>{
  const seen=[];advanceElapsed(dt,v=>seen.push(v));assert.deepEqual(seen,[dt]);
});
test('a delayed tick uses 20ms steps and the remainder without losing elapsed time',()=>{
  const seen=[];advanceElapsed(.251,v=>seen.push(v));assert.equal(seen.length,13);
  assert.ok(seen.slice(0,-1).every(v=>v===.02));assert.ok(Math.abs(seen.at(-1)-.011)<1e-12);
  assert.ok(Math.abs(seen.reduce((a,b)=>a+b,0)-.251)<1e-12);
});
test('a long sleep catches up at most one second then starts from the new clock time',()=>{
  let now=1000;const steps=[],tick=createSimulationClock(v=>steps.push(v),()=>now);
  now=6000;tick();assert.equal(steps.length,50);assert.ok(steps.every(v=>v===.02));
  now=6020;tick();assert.equal(steps.at(-1),.02);assert.equal(steps.length,51);
});
test('a negative or invalid clock cannot move the conveyor backwards',()=>{
  const steps=[];for(const elapsed of [-.2,NaN,Infinity])advanceElapsed(elapsed,v=>steps.push(v));assert.deepEqual(steps,[]);
});
test('delayed substeps expose each LS transition and permit PLC stop before the full delay',()=>{
  const st=createState(),cur=createCurrent(),sent=[];
  st.works=[{x:63.5,screws:[false,false,false,true]}];
  advanceElapsed(.12,dt=>{
    st.manualY[1]=!cur.x[0];stepSimulation(st,cur,dt);sent.push([...cur.x]);
  });
  assert.equal(sent[0][0],false);assert.equal(sent[1][0],true);
  assert.ok(Math.abs(st.works[0].x-65.3)<1e-10);assert.deepEqual(st.relay,[false,false]);
});
