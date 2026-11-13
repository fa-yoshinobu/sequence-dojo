import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function inlineScriptHashes(html) {
  return [...html.replace(/\r\n?/g, '\n').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(([, attributes]) => !/\bsrc\s*=/.test(attributes))
    .map(([, , source]) => `'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`);
}

export function updateCspHashes(html) {
  if (!/script-src\s+[^;"]+/.test(html)) throw new Error('CSP script-src is missing');
  return html.replace(/script-src\s+[^;"]+/, `script-src 'self' ${inlineScriptHashes(html).join(' ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const htmlPath = new URL('../../src/SequenceDojo/wwwroot/index.html', import.meta.url);
  const html = readFileSync(htmlPath, 'utf8');
  writeFileSync(htmlPath, updateCspHashes(html), 'utf8');
  console.log('Updated index.html CSP hashes');
}
