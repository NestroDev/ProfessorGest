import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');

const required = new Set([
  'index.html',
  'style.css',
  'app.js',
  'sw.js',
  'manifest.webmanifest',
  'google-drive-config.js',
  'google-drive-config.local.js',
  'logo.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'privacidade.html',
  'termos.html',
  'google5a60ece83bb2f45a.html',
]);

test('GitHub Pages artifact contains only publishable root files and src modules', async () => {
  const entries = await readdir(dist, { withFileTypes: true });
  const names = new Set(entries.map(entry => entry.name));

  for (const name of required) assert.ok(names.has(name), `missing dist/${name}`);
  assert.deepEqual(names, new Set([...required, 'src']));

  const srcEntries = await readdir(join(dist, 'src'), { withFileTypes: true });
  assert.ok(srcEntries.length > 0);
  assert.ok(srcEntries.every(entry => entry.isFile() && entry.name.endsWith('.js')));

  assert.ok(!names.has('README.md'));
  assert.ok(!names.has('SECURITY.md'));
  assert.ok(!names.has('package.json'));
  assert.ok(!names.has('tests'));
  assert.ok(!names.has('config'));
  assert.ok(!names.has('.github'));

  const localConfig = await (await import('node:fs/promises')).readFile(join(dist, 'google-drive-config.local.js'), 'utf8');
  assert.doesNotMatch(localConfig, /SUA_API_KEY_LOCAL_RESTRITA/);
  assert.doesNotMatch(localConfig, /AIzaSy/);
});
