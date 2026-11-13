import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inlineScriptHashes,updateCspHashes } from '../../.github/scripts/update-csp-hashes.mjs';

const html = readFileSync(new URL('../../src/SequenceDojo/wwwroot/index.html', import.meta.url),'utf8');
const content = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
const directives = Object.fromEntries(content.split(';').filter(s=>s.trim()).map(s=>{const [name,...values]=s.trim().split(/\s+/);return [name,values];}));
test('CSP permits only same-origin modules and the exact two inline script hashes',()=>{
  const hashes=inlineScriptHashes(html);assert.equal(hashes.length,2);
  assert.deepEqual(directives['script-src'],["'self'",...hashes]);
  assert.ok(!content.includes("'unsafe-eval'"));
  assert.ok(!directives['script-src'].includes("'unsafe-inline'"));
  assert.deepEqual(directives['default-src'],["'self'"]);
  assert.deepEqual(directives['connect-src'],["'self'",'ws://localhost:*']);
  assert.deepEqual(directives['worker-src'],["'self'"]);
  assert.deepEqual(directives['style-src'],["'self'","'unsafe-inline'"]);
  assert.deepEqual(directives['img-src'],["'self'",'data:']);
  assert.deepEqual(directives['object-src'],["'none'"]);
  assert.deepEqual(directives['base-uri'],["'none'"]);
  assert.deepEqual(directives['form-action'],["'self'"]);
});
test('hash update normalizes HTML newlines and changes only script-src hashes',()=>{
  assert.deepEqual(inlineScriptHashes(html.replace(/\r?\n/g,'\r\n')),inlineScriptHashes(html));
  assert.equal(updateCspHashes(html),html);
  const changed=html.replace('const show = msg => {','const show = msg => {\n');
  assert.notDeepEqual(inlineScriptHashes(changed),inlineScriptHashes(html));
  assert.equal(updateCspHashes(changed).replace(/script-src [^;"]+/,''),changed.replace(/script-src [^;"]+/,''));
  assert.throws(()=>updateCspHashes('<html></html>'),/missing/);
});
test('the port notice is outside every tab and cannot hide when switching tabs',()=>{
  const notice=html.indexOf('<aside id="portNotice"'),tabs=html.indexOf('<div id="left"');
  assert.ok(notice>=0 && notice<tabs);
  assert.match(html,/<aside id="portNotice" role="status" hidden><\/aside>/);
});
