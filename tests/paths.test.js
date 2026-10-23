import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const rootAbsolute = (s) => typeof s === 'string' && s.startsWith('/') && !s.startsWith('//');

test('index.html asset URLs are relative', () => {
  const urls = [...read('../index.html').matchAll(/\b(?:href|src)\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(urls.filter(rootAbsolute), []);
  assert.ok(urls.includes('js/app.js'));
  assert.ok(urls.includes('manifest.webmanifest'));
  assert.ok(urls.includes('css/app.css'));
});

test('manifest start_url, scope, and icons stay relative', () => {
  const manifest = JSON.parse(read('../manifest.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.icons.length >= 2);
  assert.deepEqual(manifest.icons.map((icon) => icon.src).filter(rootAbsolute), []);
});

test('service worker precache list is relative and the cache name is v6', () => {
  const sw = read('../sw.js');
  assert.match(sw, /const CACHE = 'empro-ironworker-v6'/);
  const list = sw.match(/const ASSETS = (\[[\s\S]*?\]);/);
  assert.ok(list, 'ASSETS array missing');
  const assets = JSON.parse(list[1].replace(/'/g, '"'));
  assert.deepEqual(assets.filter(rootAbsolute), []);
  assert.ok(assets.includes('./'));
  assert.ok(assets.includes('data/materials.json'));
  assert.ok(assets.includes('icons/icon-512.png'));
  assert.equal([...sw.matchAll(/['"`]\/[A-Za-z0-9_./]/g)].length, 0);
});

test('data loading and service worker registration use relative URLs', () => {
  assert.match(read('../js/data.js'), /base = '\.\/data\/'/);
  const app = read('../js/app.js');
  assert.match(app, /serviceWorker\.register\('\.\/sw\.js', \{ scope: '\.\/' \}\)/);
  assert.equal([...app.matchAll(/['"`]\/[A-Za-z0-9_./]/g)].length, 0);
});
