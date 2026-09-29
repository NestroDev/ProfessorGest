import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const frontend = join(root, 'frontend');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'src', 'services'), { recursive: true });

const files = [
  'index.html',
  'style.css',
  'legal.css',
  'app.js',
  'api-config.js',
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
  await cp(join(frontend, file), join(dist, file));
}

// The backend is optional. An empty URL keeps GitHub Pages fully standalone.
// A public repository variable may provide an HTTPS API base URL for deployments
// that choose to use the optional backend. No secret belongs in this file.
const configuredApiBase = String(process.env.PROFESSORGEST_API_BASE_URL || '').trim().replace(/\/$/, '');
await cp(join(frontend, 'api-config.js'), join(dist, 'api-config.js'));
if (configuredApiBase) {
  const apiConfigPath = join(dist, 'api-config.js');
  const apiConfig = `globalThis.PROFESSORGEST_API_BASE_URL = ${JSON.stringify(configuredApiBase)};\n`;
  await writeFile(apiConfigPath, apiConfig, 'utf8');
}

// O artefato de publicação nunca leva credenciais ou overrides locais.
// A configuração segura de exemplo é a única enviada ao GitHub Pages.
const localConfigFallback = join(root, 'config', 'google-drive-config.local.stub.js');
await cp(localConfigFallback, join(dist, 'google-drive-config.local.js'));

for (const file of modules) {
  await cp(join(frontend, 'src', file), join(dist, 'src', file));
}

await cp(join(frontend, 'src', 'services', 'api-client.js'), join(dist, 'src', 'services', 'api-client.js'));
console.log(`GitHub Pages artifact generated at ${dist}`);
