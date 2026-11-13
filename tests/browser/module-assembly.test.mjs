import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const threeUrl = new URL('../../src/SequenceDojo/wwwroot/vendor/three.module.js', import.meta.url).href;

test('app assembles the real UI, form, communication and project modules', async t => {
  const elements = new Map(), intervals = [], frames = [], posted = [], messages = [], reports = [];
  class Element {
    constructor() { this.value = ''; this.checked = false; this.open = false; this.dataset = {}; this.listeners = {}; this.style = {}; this.classList = { toggle() {}, add() {} }; }
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
    querySelectorAll() { return []; }
    querySelector() { return new Element(); }
    closest() { return this; }
    appendChild() {}
    getContext() { return { measureText: () => ({width:100}), fillText() {}, fillRect() {} }; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const form = get('connForm');
  form.elements = Object.fromEntries(['protocol','profile','host','port','transport','inputStart','outputStart','intervalMs','unitId','simulator'].map(k => [k,new Element()]));
  const document = { getElementById:get, querySelector:() => new Element(), querySelectorAll:() => [], createElement:() => new Element(), addEventListener() {} };
  for (const [name,value] of Object.entries({ Element, document, window:globalThis, chrome:{webview:{postMessage:m => posted.push(m),addEventListener:(_,cb) => messages.push(cb)}},
    devicePixelRatio:1, location:{protocol:'http:',host:'localhost:5087'}, localStorage:{getItem() {throw new Error('storage read denied')},setItem() {throw new Error('storage write denied')},removeItem() {throw new Error('storage delete denied')}}, __dojoReportClientError:message => reports.push(message),
    addEventListener() {}, removeEventListener() {}, alert:assert.fail, confirm:() => true,
    setInterval:cb => {intervals.push(cb);return 0;}, setTimeout:() => 0, requestAnimationFrame:cb => frames.push(cb),
    fetch:async url => { if (url.includes('profiles')) throw new Error('catalog unavailable'); return {json:async () => []}; },
    WebSocket:class { static OPEN = 1; readyState = 1; send() {} }
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
    t.after(() => descriptor ? Object.defineProperty(globalThis,name,descriptor) : delete globalThis[name]);
  }
  const stub = `export * from '${threeUrl}';
    export class WebGLRenderer {
      constructor(){this.domElement=document.createElement('canvas');this.shadowMap={};}
      setPixelRatio(){} setSize(){} render(){}
    }`;
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === 'three') return {url:'data:text/javascript,'+encodeURIComponent(stub),shortCircuit:true};
    if (specifier.endsWith('/OrbitControls.js')) return {url:'data:text/javascript,'+encodeURIComponent(`import {Vector3} from '${threeUrl}'; export class OrbitControls { constructor(){this.target=new Vector3()} update(){} }`),shortCircuit:true};
    return next(specifier,context);
  }});
  try {
    await import('../../src/SequenceDojo/wwwroot/js/app.js');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Object.keys(globalThis.__dojo), ['st','cur','wiring','sim','runner','camera','controls','navKeys']);
    assert.equal(globalThis.__dojo.st.config.protocol, 'melsec');
    const { PLC_MODELS } = await import('../../src/SequenceDojo/wwwroot/js/plc-models.js');
    const wiring = globalThis.__dojo.wiring;
    for (const id of Object.keys(PLC_MODELS)) {
      const predicted = wiring.previewModelChange(id).length;
      assert.equal(wiring.setModel(id), predicted, `${id}: dropped wire preview`);
      wiring.autoStandard();
      for (const term of [...wiring.model.terminals.input,...wiring.model.terminals.output])
        if (term.key) assert.ok(wiring.terms.has(term.key), `${id}: ${term.key}`);
      assert.ok(wiring.check().every(r => r.level === 'ok'), id);
      for (const t of wiring.terms.values()) assert.ok(Number.isFinite(t.pos.x) && Number.isFinite(t.pos.z), id);
      const savedWires = wiring.toJSON();
      wiring.load(savedWires);
      assert.deepEqual(wiring.toJSON(), savedWires, id);
    }
    wiring.setModel('fx5s');
    assert.equal(wiring.termY(14), '—');
    wiring.autoStandard();
    const before = wiring.toJSON();
    let confirmation;
    globalThis.confirm = message => { confirmation = message; return false; };
    get('plcModel').value = 'q';
    get('plcModel').listeners.change[0]();
    assert.match(confirmation, /3本/);
    assert.match(confirmation, /PLC COM1/);
    assert.equal(wiring.modelId, 'fx5s');
    assert.deepEqual(wiring.toJSON(), before);
    assert.equal(get('plcModel').value, 'fx5s');
    globalThis.confirm = () => true;
    get('plcModel').value = 'q';
    get('plcModel').listeners.change[0]();
    assert.equal(wiring.modelId, 'q');
    assert.equal(wiring.wires.length, before.length - 3);
    const qWires = wiring.toJSON(), setModel = wiring.setModel;
    wiring.setModel = function(id) { if (id === 'fx5u') throw new Error('synthetic switch failure'); return setModel.call(this,id); };
    get('plcModel').value = 'fx5u';
    get('plcModel').listeners.change[0]();
    wiring.setModel = setModel;
    assert.equal(wiring.modelId, 'q');
    assert.deepEqual(wiring.toJSON(), qWires);
    assert.match(get('plcEvents').textContent, /切替キャンセル/);
    assert.match(get('plcEvents').textContent, /切替完了/);
    assert.match(get('plcEvents').textContent, /synthetic switch failure/);
    get('plcSeries').value = 'FX5S';
    get('plcTerminal').value = 'spring';
    get('plcTerminal').listeners.change[0]();
    assert.equal(get('plcModel').disabled, true);
    assert.equal(wiring.modelId, 'q');
    get('plcSeries').value = 'iQ-R';
    get('plcOutput').value = 'relay';
    get('plcSeries').listeners.change[0]();
    assert.equal(get('plcModel').disabled, false);
    assert.match(get('plcModelCount').textContent, /^1件/);
    assert.match(get('plcModel').innerHTML, /RX40C7-TS\+RY10R2-TS/);
    assert.doesNotMatch(get('plcModel').innerHTML, /RY40NT5P/);
    get('btnResetPlcFilter').onclick();
    assert.match(get('plcModelCount').textContent, /^18件/);
    assert.equal(get('plcModel').value, 'q');
    assert.match(wiring.terminalDescription('P:IN0'), /X00.*TB1/);
    assert.match(wiring.terminalDescription('P:IN0'), /コモン COM/);
    assert.ok(posted.some(m => m.type === 'ready'));
    for (const tick of intervals) tick(); frames[0]();
    get('btnPlaceLeft').onclick();
    for (const listener of get('btnPlaceLeft').listeners.click) listener();
    assert.equal(globalThis.__dojo.st.works.length,1);
    frames[0]();
    get('btnSave').onclick();
    const saved = posted.find(m => m.type === 'file-save');
    assert.equal(JSON.parse(saved.content).format, 'sequence-dojo');
    assert.equal(globalThis.__dojoDirty(), true);
    assert.equal(messages.length,1);
    for (const context of ['設定の保存','設定の読込み','旧設定の削除','機種一覧の取得']) assert.ok(reports.some(message => message.includes(context)),context);
  } finally { hooks.deregister(); }
});
