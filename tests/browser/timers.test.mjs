import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createTimers} from '../../src/SequenceDojo/wwwroot/js/timers.js';

function nativeTimers(t) {
  const waits=[],intervals=[],reports=[],cleared=[];
  t.mock.method(globalThis,'setTimeout',(callback,ms)=>{waits.push({callback,ms});return waits.length;});
  t.mock.method(globalThis,'setInterval',(callback,ms)=>{intervals.push({callback,ms});return intervals.length;});
  t.mock.method(globalThis,'clearInterval',id=>cleared.push(id));
  const old=Object.getOwnPropertyDescriptor(globalThis,'__dojoReportClientError');
  Object.defineProperty(globalThis,'__dojoReportClientError',{value:m=>reports.push(m),configurable:true,writable:true});
  t.after(()=>old?Object.defineProperty(globalThis,'__dojoReportClientError',old):delete globalThis.__dojoReportClientError);
  return {waits,intervals,reports,cleared};
}
class FakeWorker {
  messages=[];terminated=0;
  postMessage(data){this.messages.push(data);}
  terminate(){this.terminated++;}
  emit(type,id){this.onmessage?.({data:{type,id}});}
}
test('worker ticks and task waits share one worker, and cancellation removes an interval',async t=>{
  nativeTimers(t);const worker=new FakeWorker();let factories=0,ticks=0;
  const timers=createTimers(()=>{factories++;return worker;});
  const cancel=timers.startInterval(()=>ticks++,20),wait=timers.sleep(200);
  assert.equal(factories,1);assert.deepEqual(worker.messages.map(m=>m.type),['interval','sleep']);
  worker.emit('tick',worker.messages[0].id);assert.equal(ticks,1);
  worker.emit('wake',worker.messages[1].id);await wait;
  cancel();assert.equal(worker.messages.at(-1).type,'cancel');
  worker.emit('tick',worker.messages[0].id);assert.equal(ticks,1);
});
test('worker unavailable keeps the dynamic setTimeout path used by headless replay',async t=>{
  const {waits,reports}=nativeTimers(t);const timers=createTimers(()=>null),wait=timers.sleep(321);
  assert.equal(waits[0].ms,321);waits[0].callback();await wait;assert.deepEqual(reports,[]);
});
test('constructor failure logs once and falls back to native interval and wait',async t=>{
  const {waits,intervals,reports,cleared}=nativeTimers(t);
  const timers=createTimers(()=>{throw new Error('worker blocked');});
  const cancel=timers.startInterval(()=>{},20),wait=timers.sleep(100);
  assert.equal(intervals[0].ms,20);assert.equal(waits[0].ms,100);assert.equal(reports.length,1);assert.match(reports[0],/worker blocked/);
  waits[0].callback();await wait;cancel();assert.deepEqual(cleared,[1]);
});
test('asynchronous worker failure preserves pending deadlines and switches every interval',async t=>{
  const {waits,intervals,reports}=nativeTimers(t);let now=100;
  t.mock.method(performance,'now',()=>now);
  const worker=new FakeWorker(),timers=createTimers(()=>worker);let ticks=0;
  timers.startInterval(()=>ticks++,20);const wait=timers.sleep(500);
  assert.equal(worker.messages[1].deadline,performance.timeOrigin+600);
  now=250;let prevented=false;const fail=worker.onerror;
  fail({message:'worker crashed',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(worker.terminated,1);assert.equal(worker.onmessage,null);
  assert.equal(intervals[0].ms,20);assert.equal(waits[0].ms,350);
  intervals[0].callback();assert.equal(ticks,1);waits[0].callback();await wait;
  fail({message:'duplicate'});assert.equal(reports.length,1);assert.equal(intervals.length,1);
});
test('a failed postMessage cannot lose the newly scheduled wait',async t=>{
  const {waits,intervals}=nativeTimers(t);t.mock.method(performance,'now',()=>100);
  const worker=new FakeWorker(),timers=createTimers(()=>worker);
  timers.startInterval(()=>{},20);worker.postMessage=()=>{throw new Error('post failed');};
  const wait=timers.sleep(400);assert.equal(waits[0].ms,400);assert.equal(intervals.length,1);
  waits[0].callback();await wait;
});
test('worker uses absolute monotonic deadlines and cancels its own interval',()=>{
  const waits=[],intervals=[],sent=[],cleared=[];
  const self={postMessage:message=>sent.push(message)};
  const source=readFileSync(new URL('../../src/SequenceDojo/wwwroot/js/timer-worker.js',import.meta.url),'utf8');
  vm.runInNewContext(source,{self,performance:{timeOrigin:1000,now:()=>200},
    setTimeout:(callback,ms)=>{waits.push({callback,ms});return 7;},setInterval:(callback,ms)=>{intervals.push({callback,ms});return 8;},clearTimeout(){},clearInterval:id=>cleared.push(id)});
  self.onmessage({data:{type:'sleep',id:1,deadline:1500}});assert.equal(waits[0].ms,300);
  waits[0].callback();assert.equal(sent[0].type,'wake');assert.equal(sent[0].id,1);
  self.onmessage({data:{type:'interval',id:2,ms:20}});intervals[0].callback();assert.equal(sent[1].type,'tick');
  self.onmessage({data:{type:'cancel',id:2}});assert.deepEqual(cleared,[8]);
});
