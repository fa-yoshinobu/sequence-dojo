import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const threeUrl = new URL('../../src/SequenceDojo/wwwroot/vendor/three.module.js', import.meta.url).href;

test('app assembles the real UI, form, communication and project modules', async t => {
  const elements = new Map(), intervals = [], frames = [], posted = [], messages = [];
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
    devicePixelRatio:1, location:{protocol:'http:',host:'localhost:5087'}, localStorage:{getItem:() => null,setItem() {},removeItem() {}},
    addEventListener() {}, removeEventListener() {}, alert:assert.fail, confirm:() => true,
    setInterval:cb => {intervals.push(cb);return 0;}, setTimeout:() => 0, requestAnimationFrame:cb => frames.push(cb),
    fetch:async url => ({json:async () => url.includes('profiles') ? { melsec:[{name:'melsec:iq-f',displayName:'iQ-F'}],keyence:[],gxSimulator:[],kvSimulator:[] } : []}),
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
  } finally { hooks.deregister(); }
});
