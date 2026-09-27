import { cp, mkdir, rm, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'src'), { recursive: true });

const files = [
  'index.html',
  'style.css',
  'app.js',
  'sw.js',
  'manifest.webmanifest',
  'google-drive-config.js',
  'logo.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'privacidade.html',
  'termos.html',
  'google5a60ece83bb2f45a.html',
];

const modules = [
  'prof-model.js',
  'local-store.js',
  'drive-bindings.js',
  'drive-http.js',
  'file-io.js',
  'project-selectors.js',
  'ui-navigation.js',
  'ui-modal.js',
  'save-state.js',
  'views-core.js',
  'views-students-activities.js',
  'views-calendar-occurrences.js',
  'views-reports.js',
  'views-class.js',
  'views-file-settings.js',
  'views-welcome.js',
  'views-planning.js',
];

for (const file of files) {
  await cp(join(root, file), join(dist, file));
}

// O artefato de publicação nunca leva credenciais ou overrides locais.
// A configuração segura de exemplo é a única enviada ao GitHub Pages.
const localConfigFallback = join(root, 'config', 'google-drive-config.local.stub.js');
await cp(localConfigFallback, join(dist, 'google-drive-config.local.js'));

for (const file of modules) {
  await cp(join(root, 'src', file), join(dist, 'src', file));
}

console.log(`GitHub Pages artifact generated at ${dist}`);
