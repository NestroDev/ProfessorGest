import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

// `URL.pathname` keeps a leading slash before a Windows drive letter, which
// makes the child process cwd invalid on Windows. Convert the file URL first.
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const execFileAsync = promisify(execFile);

const required = new Set([
  'index.html',
  'style.css',
  'app.js',
  'api-config.js',
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
  'legal.css',
  'google5a60ece83bb2f45a.html',
]);

test('GitHub Pages artifact contains only publishable root files and src modules', async () => {
  await execFileAsync(process.execPath, ['scripts/build-pages.mjs'], { cwd: root });
  const entries = await readdir(dist, { withFileTypes: true });
  const names = new Set(entries.map(entry => entry.name));

  for (const name of required) assert.ok(names.has(name), `missing dist/${name}`);
  assert.deepEqual(names, new Set([...required, 'src', ...(names.has('vendor') ? ['vendor'] : [])]));

  const srcEntries = await readdir(join(dist, 'src'), { withFileTypes: true });
  assert.ok(srcEntries.length > 0);
  assert.ok(srcEntries.some(entry => entry.isFile() && entry.name === 'api-client.js') || srcEntries.some(entry => entry.isDirectory() && entry.name === 'services'));
  const serviceEntries = await readdir(join(dist, 'src', 'services'), { withFileTypes: true });
  assert.ok(serviceEntries.some(entry => entry.isFile() && entry.name === 'api-client.js'));

  assert.ok(!names.has('README.md'));
  assert.ok(!names.has('SECURITY.md'));
  assert.ok(!names.has('package.json'));
  assert.ok(!names.has('tests'));
  assert.ok(!names.has('config'));
  assert.ok(!names.has('.github'));

  const apiConfig = await (await import('node:fs/promises')).readFile(join(dist, 'api-config.js'), 'utf8');
  assert.match(apiConfig, /PROFESSORGEST_API_BASE_URL/);
  assert.match(apiConfig, /= ''/);

  const driveAccountModule = await (await import('node:fs/promises')).readFile(join(dist, 'src', 'drive-account.js'), 'utf8');
  assert.match(driveAccountModule, /DRIVE_ACCOUNT_KEY/);
  const sw = await (await import('node:fs/promises')).readFile(join(dist, 'sw.js'), 'utf8');
  assert.match(sw, /src\/drive-account\.js/);

  const localConfig = await (await import('node:fs/promises')).readFile(join(dist, 'google-drive-config.local.js'), 'utf8');
  assert.doesNotMatch(localConfig, /SUA_API_KEY_LOCAL_RESTRITA/);
  assert.doesNotMatch(localConfig, /AIzaSy/);
});
