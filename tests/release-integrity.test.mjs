import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAVE_STATES, transitionSaveState } from '../src/save-state.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const functionDeclarations = new Set(
  [...app.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1])
);
const critical = [
  'openFile', 'saveFile', 'exportCurrentProfFile', 'shareCurrentProfFile',
  'handleFileOpenInput', 'render', 'bindViewEvents', 'bindModalEvents', 'buildSavePayload'
];

test('máquina de estados de salvamento rejeita estados desconhecidos', () => {
  assert.equal(transitionSaveState(SAVE_STATES.IDLE, SAVE_STATES.DIRTY), SAVE_STATES.DIRTY);
  assert.equal(transitionSaveState(SAVE_STATES.DIRTY, SAVE_STATES.SAVING), SAVE_STATES.SAVING);
  assert.equal(transitionSaveState(SAVE_STATES.SAVING, SAVE_STATES.SYNCED), SAVE_STATES.SYNCED);
  assert.throws(() => transitionSaveState('invalid', SAVE_STATES.SAVED));
  assert.throws(() => transitionSaveState(SAVE_STATES.IDLE, 'invalid'));
});

test('funções críticas do app continuam definidas após refatorações', () => {
  for (const name of critical) {
    assert.ok(functionDeclarations.has(name), `Função crítica ausente: ${name}`);
  }
});

test('service worker contém todos os módulos atuais', () => {
  assert.match(sw, /CACHE_NAME = 'professorgest-shell-v45'/);
  for (const module of [
    'prof-model', 'local-store', 'drive-bindings', 'file-io', 'drive-http',
    'project-selectors', 'ui-navigation', 'ui-modal', 'save-state', 'views-core', 'views-students-activities', 'views-calendar-occurrences', 'views-reports', 'views-class', 'views-file-settings', 'views-welcome'
  ]) {
    assert.match(sw, new RegExp(`\\.\\/src\\/${module}\\.js`));
  }
});



test('Google Picker mantém a lógica original de seleção do Drive', () => {
  assert.match(app, /const view = new google\.picker\.DocsView\(google\.picker\.ViewId\.DOCS\);[\s\S]*view\.setOwnedByMe\(true\);/);
  assert.doesNotMatch(app, /view\.setMimeTypes\(PROF_MIME\)/);
});

test('HTML não carrega bibliotecas PDF no caminho inicial', () => {
  assert.doesNotMatch(html, /html2canvas|jspdf/i);
});

test('pacote possui QA como gate de release', () => {
  assert.equal(packageJson.scripts.qa, 'npm run check && npm run build:pages && npm test');
  assert.match(packageJson.scripts.check, /save-state\.js/);
  const buildMatch = app.match(/const APP_BUILD = '([^']+)'/);
  assert.equal(buildMatch?.[1], packageJson.version);
  assert.equal(packageJson.version, '2026.09.27.31');
  const sourceModules = fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js'));
  for (const module of sourceModules) {
    assert.match(sw, new RegExp(`\.\/src\/${module.replace('.', '\\.')}`), `Módulo ausente do shell: ${module}`);
  }
});

test('botões semânticos não carregam role/tabindex redundantes', () => {
  assert.doesNotMatch(app, /<button[^>]+role="button"/);
  assert.doesNotMatch(app, /<button[^>]+tabindex="0"/i);
});


test('views core renderizam Dashboard e Turmas fora do app monolítico', async () => {
  const { createCoreViewRenderers } = await import('../src/views-core.js');
  const state = {
    teacher: { name: 'Professor' },
    classes: [{ id: 'c1', name: '1º A', archived: false }],
    students: [],
    activities: [],
    occurrences: []
  };
  const ctx = { showArchivedClasses: false };
  const icons = { plus: '+', users: '', user: '', clipboard: '', alert: '', sparkle: '', edit: '', copy: '', archive: '', trash: '' };
  const views = createCoreViewRenderers({
    getState: () => state, getCtx: () => ctx, setLastAttentionItems: () => {},
    activeStudents: () => [], activeActivities: () => [], activeClasses: () => state.classes,
    classStats: () => ({ alunos: [], acts: [], pct: 0, pend: 0, upcoming: null, occCount: 0 }),
    activityStats: () => ({ pending: 0, notDelivered: 0 }), studentById: () => null,
    classNameOf: () => '1º A', attentionItems: () => [], todayISO: () => '2026-09-27',
    greeting: () => 'Olá', esc: value => String(value), fmtDate: value => String(value),
    emptyState: text => `<div>${text}</div>`, progressBarHTML: pct => `<div>${pct}%</div>`,
    badgeFor: () => '', ICONS: icons
  });
  assert.match(views.renderDashboard(), /Seu espaço está pronto|Minhas turmas/);
  assert.match(views.renderTurmas(), /Turmas/);
});


test('todos os módulos-fonte têm entrada no shell e no check', () => {
  const sourceModules = fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js')).sort();
  for (const module of sourceModules) {
    assert.ok(sw.includes(`./src/${module}`), `Módulo ausente do Service Worker: ${module}`);
    assert.ok(packageJson.scripts.check.includes(`src/${module}`), `Módulo ausente do check: ${module}`);
  }
});

test('release final não contém pipeline de conversão de versões .prof', () => {
  assert.doesNotMatch(app, /SUPPORTED_VERSIONS|migrateLegacyToV1|migrateV1toV2|migrateV2toV3|migrateCompletions|migração automática/);
});
