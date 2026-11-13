import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjects } from '../../src/SequenceDojo/wwwroot/js/projects.js';
import { createState } from '../../src/SequenceDojo/wwwroot/js/simulation.js';

function setup(t) {
  const elements = new Map(), native = [], alerts = [], acks = [];
  const el = () => ({addEventListener(){},textContent:''});
  const globals = { window:{chrome:{webview:{postMessage:m => native.push(m),addEventListener(){}}},addEventListener(){}},
    document:{getElementById:id => {if(!elements.has(id))elements.set(id,el());return elements.get(id);}},
    alert:m => alerts.push(m),confirm:() => false,setTimeout:() => 0,clearTimeout(){} };
  for (const [name,value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
    t.after(() => previous ? Object.defineProperty(globalThis,name,previous) : delete globalThis[name]);
  }
  const st = createState(); st.config = {host:'original'};
  const wireLoads = [];
  const wiring = {modelId:'fx5s',toJSON:()=>[],load(wires){wireLoads.push(wires)},setModel(id){this.modelId=id}};
  const view = {wiring,clearWorks(){st.works=[]},createWork:(x,screws)=>({x,screws}),selectWork(){}};
  const ui = {plcModelSel:{},setWiringMode(){},setMultiWork:on=>{st.multiWork=on},multiWorkBox:el(),wiringModeBox:el(),screwBoxes:[]};
  const connection = {form:el(),readForm:()=>st.config,fillForm:async()=>{},normalizeConfig:c=>c};
  const projects = createProjects(st,view,ui,connection,{running:false},()=>{});
  projects.ready();
  return {st,projects,native,alerts,acks,ack:m=>acks.push(m),elements,wiring,wireLoads};
}
const request = content => ({requestId:'open-123',name:'next.sdojo',path:'next.sdojo',content:JSON.stringify(content)});
test('cancelled inbound file keeps project and dirty state but completes the handoff', async t => {
  const {st,projects,acks,ack,alerts} = setup(t);
  const original = {x:12,screws:[true,false,false,true]}; st.works=[original]; projects.markDirty();
  await projects.onOpened(request({format:'sequence-dojo',connection:{host:'new'},works:{items:[]}}),ack);
  assert.equal(st.config.host,'original'); assert.equal(st.works[0],original); assert.equal(window.__dojoDirty(),true);
  assert.deepEqual(acks,[{type:'file-open-completed',requestId:'open-123'}]); assert.deepEqual(alerts,[]);
});
test('accepted inbound file applies settings then acknowledges and clears dirty state', async t => {
  const {st,projects,acks,ack,elements} = setup(t); projects.markDirty(); globalThis.confirm=()=>true;
  await projects.onOpened(request({format:'sequence-dojo',connection:{host:'new'},works:{items:[{x:20,screws:[1,0,1,1]}]}}),ack);
  assert.equal(st.config.host,'new'); assert.equal(st.works[0].x,20); assert.equal(window.__dojoDirty(),false);
  assert.equal(elements.get('fileName').textContent,'next.sdojo'); assert.equal(acks.length,1);
});
test('invalid inbound file reports failure and completes the handoff', async t => {
  const {st,projects,acks,ack,alerts} = setup(t);
  await projects.onOpened(request({format:'other'}),ack);
  assert.equal(st.config.host,'original'); assert.equal(alerts.length,1); assert.equal(acks.length,1);
});

for (const [model, reason] of [
  ['FX5S-30MR/DS', 'DC電源'], ['MXF100-16-N32-EC', 'EC仕様'],
  ['QX40+QY10-TS', '混在'], ['unknown-plc', '対応一覧'], ['__proto__', '対応一覧'],
]) test(`unsupported saved model ${model} does not apply any project settings`, async t => {
  const {st,projects,wiring,wireLoads,acks,ack,alerts,elements} = setup(t);
  const work = {x:12,screws:[true,false,false,true]}; st.works=[work];
  await projects.onOpened(request({format:'sequence-dojo',connection:{host:'new'},
    wiring:{model,wires:[['T:1','P:IN0']]},works:{items:[]}}),ack);
  assert.equal(st.config.host,'original');
  assert.equal(st.works[0],work);
  assert.equal(wiring.modelId,'fx5s');
  assert.deepEqual(wireLoads,[]);
  assert.equal(elements.get('fileName').textContent,'');
  assert.equal(window.__dojoDirty(),false);
  assert.ok(alerts[0].includes(model) && alerts[0].includes(reason));
  assert.equal(acks.length,1);
});
