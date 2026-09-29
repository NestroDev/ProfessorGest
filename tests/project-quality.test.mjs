import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROF_FORMAT,
  CURRENT_VERSION,
  MAX_PROF_BYTES,
  createProjectId,
  isSafeId,
  validateProjectData,
  validateAndParseProf,
} from '../frontend/src/prof-model.js';
import {
  LOCAL_RECOVERY_STORE,
  LOCAL_BACKUP_STORE,
  LOCAL_DB_NAME,
  LOCAL_DB_VERSION,
  MAX_LOCAL_PROJECTS,
  writeRecoveryRecord,
  writeProjectBackup,
  readProjectBackups,
  readLatestRecoveryRecord,
  readLocalProjectRecordById,
  deleteLocalProjectRecord,
  clearLocalProjectRecords,
  readRecoveryRecordById,
  clearProjectBackups,
  clearAllLocalData,
} from '../frontend/src/local-store.js';
import {
  DRIVE_BINDINGS_KEY,
  LEGACY_DRIVE_BINDING_KEY,
  readDriveBindings,
  setDriveBinding,
  getDriveBinding,
  removeDriveBinding,
  clearLegacyDriveBinding,
} from '../frontend/src/drive-bindings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'frontend', 'style.css'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'frontend', 'sw.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const welcomeViewSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'views-welcome.js'), 'utf8');
const localStoreSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'local-store.js'), 'utf8');

function validProject(overrides = {}) {
  return {
    format: PROF_FORMAT,
    version: CURRENT_VERSION,
    projectId: createProjectId(),
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    teacher: { name: 'Professor', school: '', subject: '' },
    classes: [{ id: 'class-1', name: '1º A', archived: false }],
    students: [{ id: 'stu-1', name: 'Aluno 1', classId: 'class-1', notes: '', observations: [] }],
    activities: [{ id: 'act-1', name: 'Atividade', classId: 'class-1', dueDate: '2026-01-05', description: '' }],
    occurrences: [],
    ...overrides,
  };
}

test('modelo real expõe versão 3 e identidade permanente', () => {
  assert.equal(PROF_FORMAT, 'professorgest');
  assert.equal(CURRENT_VERSION, 3);
  assert.match(createProjectId(), /^[A-Za-z0-9_-]{1,80}$/);
  assert.equal(isSafeId('abc_123-xyz'), true);
  assert.equal(isSafeId('" onmouseover="alert(1)'), false);
});

test('o formato mantém v3 e ignora marcações de entrega legadas com aviso', () => {
  assert.equal(validateProjectData({ classes: [], students: [], activities: [], occurrences: [] }).ok, false);
  assert.equal(validateProjectData({ ...validProject(), version: 1 }).error, 'version');
  assert.equal(validateProjectData({ ...validProject(), version: 2 }).error, 'version');
  assert.equal(validateProjectData({ ...validProject(), version: 4 }).error, 'version');
  const legacyCompletions = validateProjectData(validProject({
    activities: [{ id: 'act-1', name: 'Atividade', classId: 'class-1', dueDate: '2026-01-05', description: '', completions: { 'stu-1': true } }]
  }));
  assert.equal(legacyCompletions.ok, true);
  assert.ok(legacyCompletions.warnings.some(w => /marcações de entrega legadas ignoradas/i.test(w)));
  assert.equal('completions' in legacyCompletions.data.activities[0], false);
});


test('importador valida estrutura, limites e referências', () => {
  const result = validateProjectData(validProject());
  assert.equal(result.ok, true);
  assert.equal(result.data.version, 3);
  assert.ok(result.data.projectId);

  const duplicate = validateProjectData(validProject({
    students: [
      { id: 'stu-1', name: 'A', classId: 'class-1', notes: '', observations: [] },
      { id: 'stu-1', name: 'B', classId: 'class-1', notes: '', observations: [] },
    ],
  }));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, 'integrity');

  const invalidDate = validateProjectData(validProject({
    activities: [{ id: 'act-1', name: 'Atividade', classId: 'class-1', dueDate: '2026-02-31', description: '', completions: {} }],
  }));
  assert.equal(invalidDate.ok, false);
  assert.equal(invalidDate.error, 'integrity');

  const invalidReference = validateProjectData(validProject({
    activities: [{ id: 'act-1', name: 'Atividade', classId: 'class-inexistente', dueDate: '2026-01-05', description: '', completions: {} }],
  }));
  assert.equal(invalidReference.ok, true);
  assert.equal(invalidReference.data.activities[0].classId, null);
  assert.ok(invalidReference.warnings.length > 0);
});

test('arquivo .prof malicioso não passa por IDs inseguros', () => {
  const malicious = validProject({
    classes: [{ id: '"><img src=x onerror=alert(1)>', name: 'X', archived: false }],
  });
  const result = validateAndParseProf(JSON.stringify(malicious));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'integrity');
});

test('limite de tamanho do .prof é aplicado', () => {
  const oversized = 'x'.repeat(MAX_PROF_BYTES + 1);
  const result = validateAndParseProf(oversized);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'size');
});

test('vínculo do Drive é indexado por projectId e não pelo nome', () => {
  assert.equal(DRIVE_BINDINGS_KEY, 'professorgest-drive-bindings-v2');
  assert.equal(LEGACY_DRIVE_BINDING_KEY, 'professorgest-drive-binding');
  const first = setDriveBinding({}, { fileId: 'file-a', name: 'A.prof' }, 'project-a');
  const second = setDriveBinding(first.bindings, { fileId: 'file-b', name: 'A.prof' }, 'project-b');
  assert.equal(getDriveBinding(second.bindings, 'project-a')?.fileId, 'file-a');
  assert.equal(getDriveBinding(second.bindings, 'project-b')?.fileId, 'file-b');
  assert.equal(getDriveBinding(second.bindings, 'project-a')?.projectId, 'project-a');
  assert.equal(removeDriveBinding(second.bindings, 'project-a')['project-a'], undefined);
  const fakeStorage = new Map([[LEGACY_DRIVE_BINDING_KEY, '{\"fileId\":\"legacy\"}']]);
  const storageApi = { removeItem: key => fakeStorage.delete(key), getItem: key => fakeStorage.get(key) || null, setItem: (key, value) => fakeStorage.set(key, value) };
  assert.equal(clearLegacyDriveBinding(storageApi), true);
  assert.equal(fakeStorage.has(LEGACY_DRIVE_BINDING_KEY), false);
  assert.match(appSource, /getDriveBinding\(driveBindingsByProject, state\.projectId\)/);
  assert.doesNotMatch(appSource, /driveBinding\.name !== currentFileName/);
});

test('camada de armazenamento local está modularizada e usa IndexedDB', () => {
  assert.equal(LOCAL_RECOVERY_STORE, 'recovery');
  assert.equal(LOCAL_BACKUP_STORE, 'backups');
  assert.equal(LOCAL_DB_NAME, 'professorgest-local-v2');
  assert.equal(LOCAL_DB_VERSION, 3);
  assert.equal(MAX_LOCAL_PROJECTS, 4);
  assert.equal(typeof writeRecoveryRecord, 'function');
  assert.equal(typeof readLatestRecoveryRecord, 'function');
  assert.equal(typeof readLocalProjectRecordById, 'function');
  assert.equal(typeof readRecoveryRecordById, 'function');
  assert.equal(typeof writeProjectBackup, 'function');
  assert.equal(typeof deleteLocalProjectRecord, 'function');
  assert.equal(typeof clearProjectBackups, 'function');
  assert.equal(typeof clearAllLocalData, 'function');
  assert.equal(typeof clearLocalProjectRecords, 'function');
  assert.equal(typeof readProjectBackups, 'function');
  assert.match(appSource, /from '\.\/src\/local-store\.js'/);
});

test('versões locais são tratadas como cache limitado e podem ser limpas sem apagar o .prof', () => {
  assert.match(localStoreSource, /MAX_LOCAL_PROJECTS = 4/);
  assert.match(localStoreSource, /await pruneLocalProjectRecords\(\)/);
  assert.match(localStoreSource, /rows\.slice\(safeKeep\)/);
  assert.match(localStoreSource, /export async function clearLocalProjectRecords\(\)/);
  assert.match(appSource, /As versões locais foram removidas/);
  assert.match(appSource, /Seus arquivos \.prof não foram alterados/);
  assert.match(appSource, /Limite local: 4 projetos/);
});

test('CSS possui apenas um tema claro canônico e um dark canônico', () => {
  assert.equal((cssSource.match(/^:root\{/gm) || []).length, 1);
  assert.equal((cssSource.match(/^html\[data-theme="dark"\]\{/gm) || []).length, 1);
  assert.match(cssSource, /--primary:#2563EB/);
});

test('planejamento é opcional e compatível com projetos atuais', () => {
  const withoutPlans = validateProjectData(validProject());
  assert.equal(withoutPlans.ok, true);
  assert.deepEqual(withoutPlans.data.plans, []);
  const withPlan = validateProjectData(validProject({
    plans: [{ id: 'plan-1', classId: 'class-1', date: '2026-01-06', title: 'Frações', content: 'Conteúdo', objectives: 'Objetivo', methodology: 'Metodologia', resources: 'Livro', assessment: 'Exercícios' }]
  }));
  assert.equal(withPlan.ok, true);
  assert.equal(withPlan.data.plans[0].title, 'Frações');
  assert.equal(typeof import.meta.url, 'string');
});

test('recursos novos estão conectados ao aplicativo', () => {
  assert.match(appSource, /createPlanningViewRenderer/);
  assert.match(appSource, /openMoveStudentModal/);
  assert.match(appSource, /writeProjectBackup/);
  assert.match(appSource, /classSearchInput/);
  assert.match(appSource, /activitySearchInput/);
  assert.match(cssSource, /planning-card/);
});

test('PDF é carregado sob demanda', () => {
  assert.doesNotMatch(htmlSource, /html2canvas\/1\.4\.1\/html2canvas\.min\.js/);
  assert.doesNotMatch(htmlSource, /jspdf\/2\.5\.1\/jspdf\.umd\.min\.js/);
  assert.match(appSource, /ensurePdfLibraries\(\)/);
});

test('overlays de erro ficam fora do app para funcionar na tela inicial', () => {
  const appStart = htmlSource.indexOf('<div id="app">');
  const overlaysStart = htmlSource.indexOf('<!-- UI overlays remain outside #app');
  const modalIndex = htmlSource.indexOf('id="modalRoot"', overlaysStart);
  const cmdkIndex = htmlSource.indexOf('id="cmdkRoot"', overlaysStart);
  const toastIndex = htmlSource.indexOf('id="toastRoot"', overlaysStart);
  assert.ok(appStart >= 0);
  assert.ok(overlaysStart > appStart);
  assert.ok(modalIndex > overlaysStart);
  assert.ok(cmdkIndex > overlaysStart);
  assert.ok(toastIndex > overlaysStart);
});

test('limpeza de cópias possui ação real e invalida o cache local', () => {
  assert.match(appSource, /id=\"btnClearBackupsModal\"/);
  assert.match(appSource, /clearProjectBackups\(global \? null : state\?\.projectId/);
  assert.match(appSource, /projectBackupsCache = \[\];/);
});

test('limpar todos os dados também redefine o estado em memória e os vínculos locais', () => {
  assert.match(appSource, /function resetInMemoryAfterLocalDataClear\(\)/);
  assert.match(appSource, /driveAccessToken = null/);
  assert.match(appSource, /driveBindingsByProject = \{\}/);
  assert.match(appSource, /localStorage\.removeItem\('professorgest-theme'\)/);
  assert.match(appSource, /await showWelcomeScreen\(\)/);
  assert.match(localStoreSource, /const stores = \[LOCAL_PROJECT_STORE, LOCAL_RECOVERY_STORE, LOCAL_META_STORE, LOCAL_BACKUP_STORE\]/);
});

test('controles de dados locais e configurações estão disponíveis também na tela inicial', () => {
  assert.match(htmlSource, /id="welcomeSettings"/);
  assert.match(htmlSource, /id="welcomeBackups"/);
  assert.match(appSource, /function openWelcomeSettingsModal\(\)/);
  assert.match(appSource, /function openLocalDataManager\(\)/);
  assert.match(appSource, /id="btnClearAllLocalData"/);
  assert.match(appSource, /id="btnClearAllBackups"/);
  assert.match(appSource, /id="btnClearAllLocalProjects"/);
  assert.match(appSource, /clearAllLocalProjectVersions\(\)/);
  assert.match(appSource, /clearAllLocalData\(\)/);
});

test('erros ao abrir arquivo são exibidos depois do loading, não escondidos pelo splash', () => {
  const openStart = appSource.indexOf('async function openFile');
  const inputStart = appSource.indexOf('async function handleFileOpenInput');
  assert.ok(openStart >= 0 && inputStart > openStart);
  const openBlock = appSource.slice(openStart, inputStart);
  const inputBlock = appSource.slice(inputStart);

  for (const block of [openBlock, inputBlock]) {
    const loadingIndex = block.indexOf("await withAppLoading('Abrindo seu arquivo...'");
    const errorIndex = block.indexOf('if (openError) showFileErrorModal(openError.message');
    assert.ok(loadingIndex >= 0);
    assert.ok(errorIndex > loadingIndex);
    const callbackScoped = block.slice(loadingIndex, errorIndex);
    assert.doesNotMatch(callbackScoped, /showFileErrorModal\(/);
  }
});

test('service worker inclui os módulos e não ativa atualização durante install', () => {
  assert.match(swSource, /CACHE_NAME = 'professorgest-shell-v47'/);
  assert.match(swSource, /\.\/api-config\.js/);
  assert.match(swSource, /\.\/src\/prof-model\.js/);
  assert.match(swSource, /\.\/src\/local-store\.js/);
  assert.match(swSource, /\.\/src\/file-io\.js/);
  assert.match(swSource, /\.\/src\/drive-http\.js/);
  assert.match(swSource, /\.\/src\/project-selectors\.js/);
  assert.match(swSource, /\.\/src\/ui-navigation\.js/);
  assert.match(swSource, /\.\/src\/ui-modal\.js/);
  assert.match(swSource, /\.\/src\/views-students-activities\.js/);
  assert.match(swSource, /\.\/src\/views-calendar-occurrences\.js/);
  assert.match(swSource, /\.\/src\/views-reports\.js/);
  assert.match(swSource, /\.\/src\/views-class\.js/);
  assert.match(swSource, /\.\/src\/views-file-settings\.js/);
  assert.match(swSource, /\.\/src\/views-welcome\.js/);
  assert.doesNotMatch(swSource, /then\(\(\) => self\.skipWaiting\(\)\)/);
  assert.match(swSource, /if \(response\.ok\)/);
});

test('app importa as camadas modulares e roda como ES module', () => {
  assert.match(appSource, /from '\.\/src\/prof-model\.js'/);
  assert.match(appSource, /from '\.\/src\/local-store\.js'/);
  assert.match(htmlSource, /<script type="module" src="app\.js"><\/script>/);
});

test('atributos data-* dinâmicos usam escape', () => {
  const unsafe = [...appSource.matchAll(/data-[a-z0-9_-]+=\"\$\{(?!esc\()[^}]+\}/g)];
  assert.equal(unsafe.length, 0, `Atributos potencialmente inseguros: ${unsafe.map(m => m[0]).join(', ')}`);
});





test('seletores e estatísticas do projeto são puros e testáveis', async () => {
  const selectors = await import('../frontend/src/project-selectors.js');
  const state = {
    classes: [
      { id: 'c1', name: '1º A', archived: false },
      { id: 'c2', name: '2º A', archived: true },
    ],
    students: [
      { id: 's1', name: 'Ana', classId: 'c1' },
      { id: 's2', name: 'Bia', classId: 'c1', observations: ['Registro pedagógico'] },
      { id: 's3', name: 'Caio', classId: 'c2' },
    ],
    activities: [
      { id: 'a1', classId: 'c1', title: 'Aula 1', dueDate: '2026-09-26' },
      { id: 'a2', classId: 'c1', title: 'Aula 2', dueDate: '2026-09-30' },
    ],
    occurrences: [
      { id: 'o1', studentId: 's2', type: 'observacao', note: 'Acompanhamento' },
      { id: 'o2', studentId: 's2', type: 'registro', note: 'Retorno' },
    ],
  };
  const today = () => '2026-09-27';
  assert.equal(selectors.studentsOf(state, 'c1').length, 2);
  assert.equal(selectors.activeStudents(state).length, 2);
  assert.equal(selectors.activeActivities(state).length, 2);
  assert.deepEqual(selectors.studentStats(state, state.students[1], today), {
    activityCount: 2,
    occurrenceCount: 2,
    observationCount: 1,
    totalFollowUps: 3,
  });
  const classSummary = selectors.classStats(state, state.classes[0], today);
  assert.equal(classSummary.alunos.length, 2);
  assert.equal(classSummary.acts.length, 2);
  assert.equal(classSummary.upcoming.id, 'a2');
  assert.equal(classSummary.occCount, 2);
  const activitySummary = selectors.activityStats(state, state.activities[0]);
  assert.equal(activitySummary.alunos.length, 2);
  assert.equal(activitySummary.occCount, 2);
  assert.equal(selectors.activityStatus(state, state.activities[0], today), 'atrasada');
  assert.equal(selectors.activityStatus(state, state.activities[1], today), 'proxima');
});

test('cliente de API centraliza chamadas e erros padronizados', async () => {
  const { createApiClient } = await import('../frontend/src/services/api-client.js');
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (String(url).endsWith('/health')) {
      return new Response(JSON.stringify({ status: 'ok', service: 'ProfessorGest API' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { code: 'EXAMPLE_ERROR', message: 'Falha de exemplo' } }), { status: 503, headers: { 'content-type': 'application/json' } });
  };
  try {
    const api = createApiClient('http://127.0.0.1:8787/');
    assert.equal(api.baseUrl, 'http://127.0.0.1:8787');
    assert.equal(api.enabled, true);
    assert.deepEqual(await api.health(), { status: 'ok', service: 'ProfessorGest API' });
    await assert.rejects(() => api.request('/api/v1/example'), error => {
      assert.equal(error.code, 'EXAMPLE_ERROR');
      assert.equal(error.status, 503);
      assert.equal(error.message, 'Falha de exemplo');
      return true;
    });
    assert.equal(calls[0].options.headers.Accept, 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('transporte HTTP do Drive renova token uma vez após 401', async () => {
  const { driveFetch } = await import('../frontend/src/drive-http.js');
  const originalFetch = globalThis.fetch;
  const responses = [
    new Response(JSON.stringify({ error: { message: 'token expired' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ];
  let tokenCalls = 0;
  let invalidations = 0;
  let fetchCount = 0;
  globalThis.fetch = async (_url, request) => {
    fetchCount++;
    assert.equal(request.headers.get('Authorization'), fetchCount === 1 ? 'Bearer token-1' : 'Bearer token-2');
    return responses.shift();
  };
  try {
    const response = await driveFetch('https://www.googleapis.com/drive/v3/files/x', {
      getAccessToken: async () => `token-${++tokenCalls}`,
      invalidateToken: () => { invalidations++; },
      options: { method: 'GET' },
    });
    assert.equal(response.status, 200);
    assert.equal(tokenCalls, 2);
    assert.equal(invalidations, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('camada de I/O de arquivos está modularizada', async () => {
  const fileIoSource = fs.readFileSync(path.join(root, 'frontend', 'src/file-io.js'), 'utf8');
  assert.match(appSource, /from '\.\/src\/file-io\.js'/);
  assert.match(fileIoSource, /export function normalizeProfFileName/);
  assert.match(fileIoSource, /export async function readTextFileUtf8/);
  assert.match(fileIoSource, /export async function shareFile/);
  assert.match(fileIoSource, /export function downloadTextFile/);

  const {
    normalizeProfFileName,
    supportsNativeFilePicker,
    supportsNativeSavePicker,
    supportsFileShare,
    isAndroidDevice,
    shareFile,
  } = await import('../frontend/src/file-io.js');

  assert.equal(normalizeProfFileName('Minha Aula.prof.json'), 'Minha Aula.prof');
  assert.equal(normalizeProfFileName('C:/temp/Projeto'), 'Projeto.prof');
  assert.equal(isAndroidDevice({ userAgent: 'Mozilla/5.0 Android 15 Chrome/153' }), true);
  assert.equal(isAndroidDevice({ userAgent: 'Mozilla/5.0 Windows NT 10.0' }), false);
  assert.equal(supportsNativeFilePicker({ showOpenFilePicker() {} }), true);
  assert.equal(supportsNativeSavePicker({ showSaveFilePicker() {} }, { userAgent: 'Android' }), false);
  assert.equal(supportsNativeSavePicker({ showSaveFilePicker() {} }, { userAgent: 'Windows' }), true);
  assert.equal(supportsFileShare({ share() {}, canShare() {} }, class FakeFile {}), true);
  assert.equal(supportsFileShare({ share() {} }, class FakeFile {}), true);

  let sharedData;
  class FakeFile {
    constructor(parts, name, options) {
      this.parts = parts;
      this.name = name;
      this.type = options.type;
    }
  }
  const fakeNavigator = {
    share(data) {
      sharedData = data;
      return Promise.resolve();
    }
  };
  const sharing = shareFile('arquivo serializado', 'turma.prof', 'application/vnd.professorgest', fakeNavigator, FakeFile);
  assert.ok(sharedData, 'navigator.share deve ser chamado durante a ativação do clique');
  assert.equal(sharedData.files[0].name, 'turma.prof');
  assert.equal(sharedData.files[0].type, 'application/vnd.professorgest');
  assert.deepEqual(sharedData.files[0].parts, ['arquivo serializado']);
  assert.equal(await sharing, true);
});

test('recovery cancela gravações assíncronas obsoletas', () => {
  assert.match(appSource, /recoveryWriteToken/);
  assert.match(appSource, /token !== recoveryWriteToken/);
  assert.match(appSource, /recoveryWriteToken \+= 1/);
});


test('camada de navegação é modular e preserva navegação por teclado', async () => {
  const navigationSource = fs.readFileSync(path.join(root, 'frontend', 'src/ui-navigation.js'), 'utf8');
  assert.match(appSource, /from '\.\/src\/ui-navigation\.js'/);
  assert.match(navigationSource, /export function createNavigationController/);
  const { createNavigationController } = await import('../frontend/src/ui-navigation.js');
  const controller = createNavigationController({
    navGroups: [{ label: 'Teste', items: [{ key: 'dashboard', label: 'Dashboard', icon: 'home' }] }],
    navItems: [{ key: 'dashboard', label: 'Dashboard', icon: 'home' }],
    mobileNavItems: [{ key: 'dashboard', label: 'Dashboard', icon: 'home', views: ['dashboard'] }],
    icons: { home: '<svg></svg>', menu: '<svg></svg>' },
    queryAll: () => [],
    escapeHtml: value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
    getState: () => ({ teacher: { name: 'Professor', school: '' } }),
    getContext: () => ({ bulkSelected: new Set() }),
    setContext: () => {},
    getCurrentView: () => 'dashboard',
    setCurrentView: () => {},
    render: () => {},
    openCommandPalette: () => {},
    closeCommandPalette: () => {},
    openModal: () => {},
    closeModal: () => {},
    driveBindingForCurrentProject: () => null,
  });
  assert.equal(typeof controller.navigate, 'function');
  assert.equal(controller.navItemHTML({ key: 'alunos', label: 'Alunos & <Teste>', icon: 'home' }).includes('&lt;Teste&gt;'), true);
});

test('primitivas de modal são modulares e mantêm foco', async () => {
  const modalSource = fs.readFileSync(path.join(root, 'frontend', 'src/ui-modal.js'), 'utf8');
  assert.match(appSource, /from '\.\/src\/ui-modal\.js'/);
  assert.match(modalSource, /export function createModalController/);
  const { createModalController } = await import('../frontend/src/ui-modal.js');
  const controller = createModalController({
    icons: { alert: '<svg></svg>', trash: '<svg></svg>' },
    escapeHtml: value => String(value),
    bindEvents: () => {},
    getMobileMenuCloser: () => {},
  });
  assert.equal(typeof controller.openModal, 'function');
  assert.equal(typeof controller.closeModal, 'function');
  assert.equal(typeof controller.confirmModal, 'function');
});


test('views de calendário e ocorrências estão fora do app monolítico', async () => {
  const { createCalendarOccurrenceRenderers } = await import('../frontend/src/views-calendar-occurrences.js');
  const state = {
    classes: [{ id: 'c1', name: '1º A', archived: false }],
    students: [{ id: 's1', name: 'Ana', classId: 'c1' }],
    activities: [{ id: 'a1', name: 'Atividade', classId: 'c1', dueDate: '2026-09-27' }],
    occurrences: [{ id: 'o1', studentId: 's1', date: '2026-09-27', type: 'faltou', description: '' }]
  };
  const ctx = { calMonth: '2026-09', calClassFilter: '', calSelectedDay: '2026-09-27', occClassFilter: '', occTypeFilter: '', occMonth: '' };
  const icons = { chevL: '<', chevR: '>', plus: '+', edit: 'e', trash: 't' };
  const views = createCalendarOccurrenceRenderers({
    getState: () => state, getCtx: () => ctx,
    esc: value => String(value), classNameOf: id => id ? '1º A' : 'Sem turma',
    studentById: id => state.students.find(s => s.id === id), studentsOf: () => state.students,
    initials: () => 'A', activityStatus: () => 'proxima', todayISO: () => '2026-09-27',
    fmtDate: value => String(value), monthLabel: value => value, weekdayShort: i => String(i), pad2: n => String(n).padStart(2, '0'),
    emptyState: text => `<div>${text}</div>`, badgeFor: () => '<span>badge</span>', ICONS: icons,
    occurrenceTypes: [{ key: 'faltou', label: 'Faltou', emoji: '⚠️' }]
  });
  assert.match(views.renderCalendario(), /Calendário/);
  assert.match(views.renderOcorrenciasLog(), /Ocorrências/);
});


test('views de relatórios estão fora do app monolítico', async () => {
  const { createReportRenderers } = await import('../frontend/src/views-reports.js');
  const state = {
    teacher: { name: 'Professor', school: 'Escola', subject: 'Português' },
    classes: [{ id: 'c1', name: '1º A', archived: false }],
    students: [{ id: 's1', name: 'Ana', classId: 'c1', notes: '', observations: [] }],
    activities: [], occurrences: []
  };
  const ctx = { reportStudentId: 's1', reportFrom: '2026-09-01', reportTo: '2026-09-30', reportOpts: { resumo:true, atividades:true, entregas:true, naoEntregas:true, ocorrencias:true, observacoes:true, linha:true }, reportSynthesis: '', classReportId: 'c1', classReportFrom: '2026-09-01', classReportTo: '2026-09-30' };
  const icons = { report: 'r', back: '<', edit: 'e', print: 'p', pdf: 'd' };
  const views = createReportRenderers({
    getState: () => state, getCtx: () => ctx, esc: value => String(value), classNameOf: () => '1º A', studentById: id => state.students.find(s => s.id === id),
    studentsOf: () => state.students, activitiesOf: () => [], occurrencesOf: () => [], getDeliveryState: () => 'pending',
    todayISO: () => '2026-09-27', addDays: () => '2026-07-29', fmtDate: value => String(value), emptyState: text => `<div>${text}</div>`,
    timelineEntriesHTML: () => '', studentTimelineEntries: () => [], occurrenceTypes: [], ICONS: icons
  });
  assert.match(views.renderRelatoriosHub(), /Relatórios/);
  assert.match(views.renderRelatorioIndividual(), /Relatório individual/);
  assert.match(views.renderRelatorioTurma(), /Relatório da turma/);
});


test('views preservam estado reatribuído por getters', async () => {
  const { createFileSettingsRenderers } = await import('../frontend/src/views-file-settings.js');
  let currentState = { createdAt: '2026-09-01', updatedAt: '2026-09-02', version: 3, teacher: { name: 'A', school: '', subject: '' } };
  let fileName = 'primeiro.prof';
  let dirty = false;
  let demo = false;
  const views = createFileSettingsRenderers({
    getState: () => currentState, esc: value => String(value), getDemoMode: () => demo,
    getCurrentFileName: () => fileName, getIsDirty: () => dirty, ICONS: { file:'', folder:'', save:'', copy:'', cloud:'', share:'', plus:'' },
    supportsFileShare: () => false, driveStatusTone: () => 'ok', driveStatusText: () => 'Local', driveBindingForCurrentProject: () => null,
    fmtDate: value => String(value), fmtDateTime: value => String(value), getThemeMode: () => 'light', getDevLogEntries: () => []
  });
  assert.match(views.renderArquivo(), /primeiro\.prof/);
  currentState = { createdAt: '2027-01-01', updatedAt: '2027-01-02', version: 3, teacher: { name: 'B', school: '', subject: '' } };
  fileName = 'segundo.prof';
  dirty = true;
  const next = views.renderArquivo();
  assert.match(next, /segundo\.prof/);
  assert.doesNotMatch(next, /primeiro\.prof/);
  assert.match(next, /Alterações não salvas/);
});


test('view de turma está fora do app monolítico', async () => {
  const { createClassViewRenderers } = await import('../frontend/src/views-class.js');
  let state = { classes: [{ id: 'c1', name: '1º A', archived: false }], students: [], activities: [], occurrences: [] };
  const ctx = { classId: 'c1', classTab: 'visao', bulkMode: false, bulkSelected: new Set() };
  const views = createClassViewRenderers({
    getState: () => state, getCtx: () => ctx, classById: id => state.classes.find(c => c.id === id),
    classStats: () => ({ alunos: [], acts: [], upcoming: null, occCount: 0 }), studentsOf: () => [], occurrencesOf: () => [], studentById: () => null,
    situacaoAluno: () => ({ tone: 'green', label: 'Em dia' }), initials: () => 'A', activityListItemHTML: () => '', esc: value => String(value),
    fmtDate: value => String(value), todayISO: () => '2026-09-27', emptyState: text => `<div>${text}</div>`, badgeFor: () => '',
    ICONS: { plus: '+', back: '<', edit: 'e', report: 'r' }
  });
  assert.match(views.renderTurmaDetail(), /1º A/);
  state = { classes: [{ id: 'c2', name: '2º B', archived: false }], students: [], activities: [], occurrences: [] };
  ctx.classId = 'c2';
  assert.match(views.renderTurmaDetail(), /2º B/);
});


test('view de boas-vindas está fora do app monolítico', async () => {
  const moduleSource = fs.readFileSync(path.join(root, 'frontend', 'src/views-welcome.js'), 'utf8');
  assert.match(moduleSource, /createWelcomeViewRenderer/);
  assert.match(moduleSource, /readLocalRecoveryDraft/);
  assert.match(moduleSource, /restorePersistedProject/);
  assert.doesNotMatch(appSource, /function renderWelcomeRecovery\(\)\s*\{[\s\S]*readLocalRecoveryDraft\(\)/);
});


test('cores semânticas principais mantêm contraste adequado no tema claro', () => {
  const token = name => {
    const match = cssSource.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
    assert.ok(match, `Token ausente: ${name}`);
    return match[1];
  };
  const luminance = hex => {
    const rgb = hex.slice(1).match(/.{2}/g).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const contrast = (a, b) => {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  for (const name of ['--success', '--danger', '--warning', '--info', '--text-muted']) {
    assert.ok(contrast(token(name), '#FFFFFF') >= 4.5, `${name} não atinge 4,5:1 no tema claro`);
  }
});

test('badges do relatório individual mantêm as cores semânticas em qualquer tema', () => {
  for (const tone of ['blue', 'green', 'red', 'amber', 'gray']) {
    const rule = cssSource.match(new RegExp(`\\.report-page \\.badge-${tone}\\s*\\{([^}]+)\\}`));
    assert.ok(rule, `Regra de badge ausente no relatório: ${tone}`);
    assert.match(rule[1], /color:\s*#[0-9A-Fa-f]{6}/);
    assert.match(rule[1], /background:\s*#[0-9A-Fa-f]{6}/);
    assert.match(rule[1], /border-color:\s*#[0-9A-Fa-f]{6}/);
    assert.doesNotMatch(rule[1], /var\(--/);
  }
});


test('labels de formulário dinâmicos permanecem associados', () => {
  assert.doesNotMatch(appSource, /<label class=\"form-label\">/);
  assert.match(appSource, /<label class=\"form-label\" for=\"quickSearchInput\">/);
});

test('recovery da tela inicial não depende de funções legadas ausentes', () => {
  assert.doesNotMatch(appSource, /readLegacyRecoveryDraft/);
  assert.match(appSource, /async function hydrateRecoveryCache/);
  assert.match(appSource, /readLatestRecoveryRecord\(\)/);
  assert.match(appSource, /Number\(record\.state\.version\) !== CURRENT_VERSION/);
});

test('cartão Criar novo arquivo não interpola background durante hover', () => {
  assert.match(cssSource, /\.welcome-card\.primary:hover\{background:linear-gradient/);
  assert.doesNotMatch(cssSource, /\.welcome-card\{[^}]*transition:[^}]*background/);
  assert.match(cssSource, /\.welcome-card\.primary,\.welcome-card\.primary:hover\{color:#fff/);
});

test('polimento de Arquivos preserva todas as ações de arquivo', () => {
  const view = fs.readFileSync(path.join(root, 'frontend', 'src', 'views-file-settings.js'), 'utf8');
  for (const id of ['btnOpenFile','btnSaveFile','btnOpenBackups','btnDriveOpen','btnDriveAction','btnExportProf','btnShareProf','btnExportCsv','btnImportCsv']) {
    assert.match(view, new RegExp(`id="${id}"`), `Ação ausente na tela de Arquivos: ${id}`);
  }
  assert.match(view, /btnGoFileFromSettings/);
});

test('reforma de aluno preserva ações individuais', () => {
  const view = fs.readFileSync(path.join(root, 'frontend', 'src', 'views-students-activities.js'), 'utf8');
  assert.match(view, /id="btnRegisterForStudent"/);
  assert.match(view, /id="btnStudentActions"/);
  assert.match(appSource, /function openStudentActionsModal/);
  assert.match(appSource, /studentActionMove/);
  assert.match(appSource, /studentActionReport/);
});

test('busca global inclui planejamento sem remover alunos, turmas e atividades', () => {
  assert.match(appSource, /data-cmdk-student/);
  assert.match(appSource, /data-cmdk-class/);
  assert.match(appSource, /data-cmdk-activity/);
  assert.match(appSource, /data-cmdk-plan/);
});

test('navegação reorganizada mantém todas as áreas do aplicativo', () => {
  for (const key of ['dashboard','turmas','alunos','atividades','planejamento','calendario','ocorrencias','relatorios','arquivo','configuracoes']) {
    assert.match(appSource, new RegExp(`key: '${key}'`), `Área ausente da navegação: ${key}`);
  }
});

test('tela inicial mostra somente o projeto local mais recente sem repetir o cartão durante a hidratação', () => {
  assert.match(welcomeViewSource, /Recuperação disponível/);
  assert.match(welcomeViewSource, /alterações protegidas/);
  assert.match(welcomeViewSource, /Último projeto neste dispositivo/);
  assert.match(welcomeViewSource, /readLocalProjectRecords/);
  assert.match(welcomeViewSource, /sameProject/);
  assert.match(welcomeViewSource, /Abrir versão salva/);
  assert.match(welcomeViewSource, /Continuar com a recuperação/);
  assert.match(welcomeViewSource, /readLocalProjectRecords\(4\)/);
  assert.match(welcomeViewSource, /renderToken/);
  assert.doesNotMatch(welcomeViewSource, /Projetos neste dispositivo/);
  assert.doesNotMatch(welcomeViewSource, /restorePersistedProjectById/);
});

test('tela inicial não duplica o acesso aos dados locais no cartão de trabalho recente', () => {
  assert.doesNotMatch(welcomeViewSource, /Gerenciar dados deste dispositivo/);
  assert.doesNotMatch(appSource, /welcomeManageData/);
  assert.match(htmlSource, /id="welcomeSettings"/);
  assert.match(appSource, /id="btnOpenLocalDataManager"/);
});

test('configurações da tela inicial troca o tema sem fechar e reabrir o modal', () => {
  const start = appSource.indexOf('function openWelcomeSettingsModal()');
  const end = appSource.indexOf('async function showWelcomeScreen', start);
  const block = appSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(block, /applyThemeMode\(nextMode\)/);
  assert.match(block, /classList\.toggle\('active', active\)/);
  assert.match(block, /aria-pressed/);
  assert.doesNotMatch(block, /closeModal\(\);\n\s*openWelcomeSettingsModal\(\)/);
});

test('tela inicial tem uma única rotina de preparação por chamada', () => {
  const start = appSource.indexOf('async function showWelcomeScreen');
  const end = appSource.indexOf('function showSetupScreen', start);
  const block = appSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(block.split("document.getElementById('welcomeScreen')?.classList.remove('is-hidden')").length - 1, 1);
  assert.equal((block.match(/hydrateRecoveryCache\(\)\.then\(\(\) => renderWelcomeRecovery\(\)\)/g) || []).length, 1);
});

test('cópias de segurança permanecem acessíveis mesmo quando ainda não existem', () => {
  assert.match(htmlSource, /<button class="welcome-secondary-action" id="welcomeBackups"/);
  assert.match(appSource, /button\.classList\.remove\('is-hidden'\)/);
  assert.match(appSource, /Ainda não há cópias de segurança/);
  assert.match(appSource, /welcomeBackups.*addEventListener\('click', \(\) => openBackupsModal\(\{ global: true \}\)\)/);
});

test('navegação usa histórico real e restaura rota após reload', () => {
  const navigationSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'ui-navigation.js'), 'utf8');
  assert.match(navigationSource, /history\.pushState/);
  assert.match(navigationSource, /history\.replaceState/);
  assert.match(navigationSource, /addEventListener\('popstate'/);
  assert.match(navigationSource, /history\.back\(\)/);
  assert.match(navigationSource, /sessionStorage\.setItem\(ROUTE_KEY/);
  assert.match(appSource, /restorePersistedProjectById\(savedRoute\.projectId/);
  assert.match(appSource, /navigation\.restoreWorkspaceRoute\(savedRoute\)/);
  assert.match(appSource, /getPersistedRoute\(\)/);
});

test('mudança de tela não contorna o router por atribuição direta de currentView', () => {
  const assignments = appSource.match(/currentView\s*=\s*[^=]/g) || [];
  assert.equal(assignments.length, 2);
  assert.match(appSource, /setCurrentView: value => \{ currentView = value; \}/);
});

test('mobile agrupa as telas por contexto e expõe a subnavegação de Aulas', () => {
  const navigationSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'ui-navigation.js'), 'utf8');
  assert.match(appSource, /MOBILE_NAV_ITEMS/);
  assert.match(appSource, /views: \['atividades', 'planejamento', 'calendario'\]/);
  assert.match(navigationSource, /toggleMobileContext/);
  assert.match(navigationSource, /mobile-context-action/);
  assert.match(htmlSource, /id="bottomNav"/);
  assert.match(htmlSource, /id="mobileContextNav"/);
});

test('modelo atual de acompanhamento não depende do fluxo de entrega', () => {
  const selectorSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'project-selectors.js'), 'utf8');
  const studentViewSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'views-students-activities.js'), 'utf8');
  const coreViewSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'views-core.js'), 'utf8');
  assert.doesNotMatch(selectorSource, /completions|delivered|not_delivered|pending/);
  assert.doesNotMatch(studentViewSource, /Entrega|entregou|não entregou|Não verificado|percentual/);
  assert.doesNotMatch(coreViewSource, /pendências de entrega|percentual de entrega/);
  assert.match(appSource, /map\(\(\{ completions, \.\.\.activity \}\) => activity\)/);
});

test('ações de seleção em massa incluem exclusão com confirmação e integridade relacionada', () => {
  assert.match(appSource, /btnBulkDelete/);
  assert.match(appSource, /btnStudentBulkDelete/);
  assert.match(appSource, /function deleteStudentsBulk\(studentIds\)/);
  assert.match(appSource, /relOcc/);
  assert.match(appSource, /relObs/);
  assert.match(appSource, /confirmModal\(/);
  assert.match(appSource, /state\.occurrences = \(state\.occurrences \|\| \[\]\)\.filter/);
});

test('ocorrência permite adicionar aluno no próprio fluxo', () => {
  assert.match(appSource, /quickAddStudentBtn/);
  assert.match(appSource, /openQuickAddStudentModal/);
  assert.match(appSource, /Adicionar e continuar/);
  assert.match(appSource, /continue o registro desta ocorrência/);
});

test('topbar e instalação mobile possuem estados visuais coerentes', () => {
  assert.match(cssSource, /\.topbar-save-button\s*\{/);
  assert.match(cssSource, /\.topbar-save-button\.needs-save\s*\{/);
  assert.match(cssSource, /#welcomeInstall\{/);
  assert.match(cssSource, /grid-column:1 \/ -1/);
  assert.match(cssSource, /justify-self:center/);
  assert.match(cssSource, /\.topbar-avatar\s*\{/);
  assert.match(cssSource, /background:var\(--surface-2\)/);
});

test('workflow de publicação usa a configuração pública correta do frontend', () => {
  const workflowSource = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-pages.yml'), 'utf8');
  assert.match(workflowSource, /frontend\/google-drive-config\.js/);
  assert.match(workflowSource, /npm run build:pages/);
  assert.doesNotMatch(workflowSource, /path = Path\('google-drive-config\.js'\)/);
});

test('não há estilos inline restantes no frontend', () => {
  const htmlFiles = [path.join(root, 'frontend', 'index.html'), path.join(root, 'frontend', 'termos.html'), path.join(root, 'frontend', 'privacidade.html')];
  const inlineCount = htmlFiles.reduce((total, file) => total + ((fs.readFileSync(file, 'utf8').match(/style="/g) || []).length), 0);
  const jsInlineCount = fs.readdirSync(path.join(root, 'frontend', 'src'))
    .filter(name => name.endsWith('.js'))
    .reduce((total, name) => total + ((fs.readFileSync(path.join(root, 'frontend', 'src', name), 'utf8').match(/style="/g) || []).length), 0);
  assert.equal(inlineCount + jsInlineCount, 0);
});
