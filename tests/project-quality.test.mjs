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
} from '../src/prof-model.js';
import {
  LOCAL_RECOVERY_STORE,
  LOCAL_DB_NAME,
  writeRecoveryRecord,
  readLatestRecoveryRecord,
  readLocalProjectRecordById,
  readRecoveryRecordById,
} from '../src/local-store.js';
import {
  DRIVE_BINDINGS_KEY,
  LEGACY_DRIVE_BINDING_KEY,
  readDriveBindings,
  setDriveBinding,
  getDriveBinding,
  removeDriveBinding,
  clearLegacyDriveBinding,
} from '../src/drive-bindings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

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
    activities: [{ id: 'act-1', name: 'Atividade', classId: 'class-1', dueDate: '2026-01-05', description: '', completions: { 'stu-1': 'pending' } }],
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

test('o formato legado não é convertido: somente a versão atual é aceita', () => {
  assert.equal(validateProjectData({ classes: [], students: [], activities: [], occurrences: [] }).ok, false);
  assert.equal(validateProjectData({ ...validProject(), version: 1 }).error, 'version');
  assert.equal(validateProjectData({ ...validProject(), version: 2 }).error, 'version');
  assert.equal(validateProjectData({ ...validProject(), version: 4 }).error, 'version');
  const legacyCompletions = validateProjectData(validProject({
    activities: [{ id: 'act-1', name: 'Atividade', classId: 'class-1', dueDate: '2026-01-05', description: '', completions: { 'stu-1': true } }]
  }));
  assert.equal(legacyCompletions.ok, false);
  assert.equal(legacyCompletions.error, 'integrity');
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
  assert.equal(LOCAL_DB_NAME, 'professorgest-local-v2');
  assert.equal(typeof writeRecoveryRecord, 'function');
  assert.equal(typeof readLatestRecoveryRecord, 'function');
  assert.equal(typeof readLocalProjectRecordById, 'function');
  assert.equal(typeof readRecoveryRecordById, 'function');
  assert.match(appSource, /from '\.\/src\/local-store\.js'/);
});

test('CSS possui apenas um tema claro canônico e um dark canônico', () => {
  assert.equal((cssSource.match(/^:root\{/gm) || []).length, 1);
  assert.equal((cssSource.match(/^html\[data-theme="dark"\]\{/gm) || []).length, 1);
  assert.match(cssSource, /--primary:#2563EB/);
});

test('PDF é carregado sob demanda', () => {
  assert.doesNotMatch(htmlSource, /html2canvas\/1\.4\.1\/html2canvas\.min\.js/);
  assert.doesNotMatch(htmlSource, /jspdf\/2\.5\.1\/jspdf\.umd\.min\.js/);
  assert.match(appSource, /ensurePdfLibraries\(\)/);
});

test('service worker inclui os módulos e não ativa atualização durante install', () => {
  assert.match(swSource, /CACHE_NAME = 'professorgest-shell-v39'/);
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
  const selectors = await import('../src/project-selectors.js');
  const state = {
    classes: [
      { id: 'c1', name: '1º A', archived: false },
      { id: 'c2', name: '2º A', archived: true },
    ],
    students: [
      { id: 's1', name: 'Ana', classId: 'c1' },
      { id: 's2', name: 'Bia', classId: 'c1' },
      { id: 's3', name: 'Caio', classId: 'c2' },
    ],
    activities: [
      { id: 'a1', classId: 'c1', dueDate: '2026-09-26', completions: { s1: 'delivered', s2: 'pending' } },
      { id: 'a2', classId: 'c1', dueDate: '2026-09-30', completions: { s1: 'not_delivered' } },
    ],
    occurrences: [{ id: 'o1', studentId: 's2' }],
  };
  const today = () => '2026-09-27';
  assert.equal(selectors.studentsOf(state, 'c1').length, 2);
  assert.equal(selectors.activeStudents(state).length, 2);
  assert.equal(selectors.activeActivities(state).length, 2);
  assert.equal(selectors.getDeliveryState(state.activities[1], 's2'), 'pending');
  assert.deepEqual(selectors.studentStats(state, state.students[1], today), {
    totalActs: 2,
    delivered: 0,
    notDelivered: 0,
    pendingOverdue: 1,
    pendingFuture: 1,
    pend: 1,
    occCount: 1,
  });
  assert.equal(selectors.activityStatus(state, state.activities[0], today), 'atrasada');
  assert.equal(selectors.activityStatus(state, state.activities[1], today), 'proxima');
});

test('transporte HTTP do Drive renova token uma vez após 401', async () => {
  const { driveFetch } = await import('../src/drive-http.js');
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
  const fileIoSource = fs.readFileSync(path.join(root, 'src/file-io.js'), 'utf8');
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
  } = await import('../src/file-io.js');

  assert.equal(normalizeProfFileName('Minha Aula.prof.json'), 'Minha Aula.prof');
  assert.equal(normalizeProfFileName('C:/temp/Projeto'), 'Projeto.prof');
  assert.equal(isAndroidDevice({ userAgent: 'Mozilla/5.0 Android 15 Chrome/153' }), true);
  assert.equal(isAndroidDevice({ userAgent: 'Mozilla/5.0 Windows NT 10.0' }), false);
  assert.equal(supportsNativeFilePicker({ showOpenFilePicker() {} }), true);
  assert.equal(supportsNativeSavePicker({ showSaveFilePicker() {} }, { userAgent: 'Android' }), false);
  assert.equal(supportsNativeSavePicker({ showSaveFilePicker() {} }, { userAgent: 'Windows' }), true);
  assert.equal(supportsFileShare({ share() {}, canShare() {} }, class FakeFile {}), true);
});

test('recovery cancela gravações assíncronas obsoletas', () => {
  assert.match(appSource, /recoveryWriteToken/);
  assert.match(appSource, /token !== recoveryWriteToken/);
  assert.match(appSource, /recoveryWriteToken \+= 1/);
});


test('camada de navegação é modular e preserva navegação por teclado', async () => {
  const navigationSource = fs.readFileSync(path.join(root, 'src/ui-navigation.js'), 'utf8');
  assert.match(appSource, /from '\.\/src\/ui-navigation\.js'/);
  assert.match(navigationSource, /export function createNavigationController/);
  const { createNavigationController } = await import('../src/ui-navigation.js');
  const controller = createNavigationController({
    navGroups: [{ label: 'Teste', items: [{ key: 'dashboard', label: 'Dashboard', icon: 'home' }] }],
    navItems: [{ key: 'dashboard', label: 'Dashboard', icon: 'home' }],
    mobileNavKeys: ['dashboard'],
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
  const modalSource = fs.readFileSync(path.join(root, 'src/ui-modal.js'), 'utf8');
  assert.match(appSource, /from '\.\/src\/ui-modal\.js'/);
  assert.match(modalSource, /export function createModalController/);
  const { createModalController } = await import('../src/ui-modal.js');
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
  const { createCalendarOccurrenceRenderers } = await import('../src/views-calendar-occurrences.js');
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
  const { createReportRenderers } = await import('../src/views-reports.js');
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
  const { createFileSettingsRenderers } = await import('../src/views-file-settings.js');
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
  const { createClassViewRenderers } = await import('../src/views-class.js');
  let state = { classes: [{ id: 'c1', name: '1º A', archived: false }], students: [], activities: [], occurrences: [] };
  const ctx = { classId: 'c1', classTab: 'visao', bulkMode: false, bulkSelected: new Set() };
  const views = createClassViewRenderers({
    getState: () => state, getCtx: () => ctx, classById: id => state.classes.find(c => c.id === id),
    classStats: () => ({ alunos: [], acts: [], pct: 0, pend: 0, occCount: 0 }), studentsOf: () => [], occurrencesOf: () => [], studentById: () => null,
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
  const moduleSource = fs.readFileSync(path.join(root, 'src/views-welcome.js'), 'utf8');
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
