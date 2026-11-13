import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateTask,parseTask,TaskRunner,MAX_TASK_BYTES} from '../../src/SequenceDojo/wwwroot/js/tasks.js';

for (const name of ['t01_selfhold.json','t02_conveyor.json','t03_hinban.json']) {
  test(`bundled ${name} passes the import schema`,async()=>{
    const text=await readFile(new URL('../../src/SequenceDojo/wwwroot/tasks/'+name,import.meta.url),'utf8');
    assert.deepEqual(validateTask(parseTask(text)),[]);
  });
}
const task=step=>({title:'test',grade:3,scenario:[step]});
for (const [label,value] of Object.entries({ missingTitle:{scenario:[{reset:true}]},emptyScenario:{title:'x',scenario:[]},badGrade:{...task({reset:true}),grade:4},
  missingScrews:task({work:{at:'left'}}),badScrew:task({work:{at:'left',screws:[0,0,2,1]}}),badCondition:task({expect:{PL5:true}}),numericBool:task({expect:{LS1:1}}),
  badDisplay:task({expect:{DPL1:10}}),badDirection:task({expect:{conveyor:'up'}}),badButton:task({press:'PB6'}),missingOn:task({hold:'PB1'}),
  unknown:task({unknown:true}),multiple:task({reset:true,wait:1}),negativeWait:task({wait:-1}),zeroWait:task({wait:0}),missingDuration:task({expectFor:{PL1:true}}),extra:task({press:'PB1',bogus:4}) })) {
  test(`schema rejects ${label}`,()=>assert.ok(validateTask(value).length));
}
test('schema error identifies the original multiline step even with brackets in a title',()=>{
  const text='{"title":"brace [ { \\\"","scenario":[\n {"note":"quoted } ["},\n {"work":{"at":"left"}}\n]}';
  assert.throws(()=>parseTask(text),/行 3: scenario\[1\]/);
});
test('import rejects malformed JSON and the UTF8 byte limit',()=>{
  assert.throws(()=>parseTask('{broken'),SyntaxError);
  assert.throws(()=>parseTask('あ'.repeat(Math.ceil(MAX_TASK_BYTES/3))),/5 MB/);
});
test('missing grade defaults to three',()=>assert.equal(parseTask('{"title":"x","scenario":[{"reset":true}]}').grade,3));
test('a corrupt builtin and user file do not hide other tasks',async t=>{
  const good=JSON.stringify(task({expect:{PL1:false}})),errors=[];
  const routes={ 'tasks/index.json':['good.json','broken.json','missing.json'],'tasks/good.json':good,'tasks/broken.json':'{broken',
    'api/tasks':{items:[{file:'valid-user.json',content:good},{file:'broken-user.json',content:'{}'}],errors:['locked.json: cannot read']} };
  t.mock.method(globalThis,'fetch',async url=>({ok:url in routes,status:404,json:async()=>routes[url],text:async()=>routes[url]}));
  const result=await TaskRunner.loadList(e=>errors.push(e));
  assert.deepEqual(result.map(t=>t.file),['good.json','valid-user.json']);
  for(const name of ['broken.json','missing.json','broken-user.json','locked.json'])assert.ok(errors.some(e=>e.includes(name)),name);
});
