import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskControls} from '../../src/SequenceDojo/wwwroot/js/task-controls.js';

function setup(t) {
  const nodes=new Map(), posts=[], title='<img src=x onerror=alert(1)>', user=[];
  class Node {
    constructor(){this.children=[];this.listeners={};this.value='';this._text='';}
    set textContent(text){this._text=text;this.children=[];}
    get textContent(){return this._text;}
    set innerHTML(value){assert.equal(value,'','Imported task text must never reach innerHTML');this.children=[];}
    addEventListener(type,callback){this.listeners[type]=callback;}
    appendChild(child){this.children.push(child);}
    click(){this.clicked=true;}
    scrollIntoView(){}
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
  const content=JSON.stringify({title,scenario:[{expect:{PL1:false}}]});
  const properties={document:{getElementById:get,createElement:()=>new Node()},setInterval:()=>0,
    fetch:async (url,options)=>{
      if(options?.method==='POST') { posts.push({url,options}); if(url==='api/tasks')user.push({file:'generated.json',content:options.body});return {ok:true,json:async()=>({file:'generated.json'})}; }
      return {ok:true,json:async()=>url==='tasks/index.json'?[]:{items:user,errors:[]}};
    }};
  for(const [name,value]of Object.entries(properties)){
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
    t.after(()=>descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name]);
  }
  const controls=createTaskControls({connected:true},{observe:()=>({PL1:false}),releaseAll(){}},()=>{},()=>0);
  return {get,controls,content,title,posts};
}
test('import saves through same-origin HTTP and displays an untrusted title as text',async t=>{
  const {get,controls,content,title,posts}=setup(t);
  await controls.loadTasks();
  get('taskFile').files=[{name:'../../../chosen.json',size:content.length,text:async()=>content}];
  await get('taskFile').listeners.change();
  assert.equal(posts[0].url,'api/tasks');assert.equal(posts[0].options.body,content);
  assert.equal(get('taskSelect').children[0].textContent,`${title}（3級相当）`);
  assert.equal(get('taskSelect').value,0);assert.match(get('taskImportStatus').textContent,/読み込みました/);
  await get('btnJudge').onclick();assert.match(get('judgeScore').textContent,/1 \/ 1 合格/);
});
test('invalid imported task is explained before any save request',async t=>{
  const {get,posts}=setup(t);
  get('taskFile').files=[{name:'invalid.json',size:2,text:async()=>'{}'}];
  await get('taskFile').listeners.change();assert.equal(posts.length,0);assert.match(get('taskImportStatus').textContent,/title/);
});
test('folder button uses a POST to the authenticated endpoint',async t=>{
  const {get,posts}=setup(t);await get('btnTaskFolder').onclick();
  assert.equal(posts[0].url,'api/tasks/open-folder');assert.equal(posts[0].options.method,'POST');
});
