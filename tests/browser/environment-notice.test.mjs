import test from 'node:test';
import assert from 'node:assert/strict';
import {showPortNotice} from '../../src/SequenceDojo/wwwroot/js/environment-notice.js';

test('the default port keeps the notice hidden',()=>{
  let touched=false;
  assert.equal(showPortNotice({getElementById(){touched=true;}},{port:'5087'}),false);
  assert.equal(touched,false);
});
test('an alternate port displays restoration guidance outside all tabs',()=>{
  const notice={hidden:true,getBoundingClientRect:()=>({height:42})},style=[];
  const document={getElementById:id=>{assert.equal(id,'portNotice');return notice;},documentElement:{style:{setProperty:(...args)=>style.push(args)}}};
  assert.equal(showPortNotice(document,{port:'52713'}),true);
  assert.equal(notice.hidden,false);assert.match(notice.textContent,/52713/);assert.match(notice.textContent,/別扱い/);assert.match(notice.textContent,/\.sdojo/);
  assert.deepEqual(style,[['--port-notice-height','42px']]);
});
