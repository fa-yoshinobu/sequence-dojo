import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';

const html = fs.readFileSync(new URL('../../src/SequenceDojo/wwwroot/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function fixture(fetch) {
  const nodes = new Map();
  const handlers = new Map();
  function element() {
    return {
      children: [], style: {},
      get lastChild() { return this.children.at(-1); },
      appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); },
      insertBefore(child) { this.children.unshift(child); },
      remove() { nodes.delete(this.id); },
    };
  }
  const document = { getElementById: id => nodes.get(id), createElement: element, body: element(), documentElement: element() };
  const context = { document, fetch, addEventListener: (name, action) => handlers.set(name, action) };
  vm.runInNewContext(script, context);
  return { handlers, nodes, report: message => context.__dojoReportClientError(message) };
}

test('screen errors are posted once to the same-origin authenticated endpoint', () => {
  const requests = [];
  const { handlers, nodes } = fixture((url, options) => { requests.push({ url, options }); return Promise.resolve({ ok: true }); });
  handlers.get('error')({ message: 'synthetic failure', filename: 'http://127.0.0.1/js/app.js', lineno: 12 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/client-errors');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(requests[0].options.body).message, 'synthetic failure（app.js:12）');
  assert.match(nodes.get('errorBar').children[0].textContent, /synthetic failure/);
});

test('unhandled rejection reports are bounded before JSON encoding', () => {
  let body;
  const { handlers } = fixture((_, options) => { body = options.body; return Promise.resolve({ ok: true }); });
  handlers.get('unhandledrejection')({ reason: 'あ'.repeat(5000) });
  assert.equal(JSON.parse(body).message.length, 2048);
  assert.ok(Buffer.byteLength(body) < 16 * 1024);
});

test('asynchronous report failure does not raise another unhandled rejection', async () => {
  let attempts = 0;
  const { handlers, nodes } = fixture(() => { attempts++; return Promise.reject(new Error('synthetic offline')); });
  handlers.get('error')({ message: 'visible error', filename: '', lineno: 0 });
  await setImmediate();
  assert.equal(attempts, 1);
  assert.ok(nodes.has('errorBar'));
});

test('synchronous report failure still renders the original error', () => {
  const { handlers, nodes } = fixture(() => { throw new Error('fetch unavailable'); });
  assert.doesNotThrow(() => handlers.get('error')({ message: 'visible error', filename: '', lineno: 0 }));
  assert.match(nodes.get('errorBar').children[0].textContent, /visible error/);
});


test('handled module errors can be logged without displaying an unhandled-error bar', () => {
  const messages = [];
  const { report, nodes } = fixture((_, options) => { messages.push(JSON.parse(options.body).message); return Promise.resolve({ ok: true }); });
  report('handled synthetic error');
  assert.deepEqual(messages, ['handled synthetic error']);
  assert.equal(nodes.has('errorBar'), false);
});
