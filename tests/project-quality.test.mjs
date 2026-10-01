import test from 'node:test';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRG_FORMAT,
  PRG_VERSION,
  MAX_PRG_BYTES,
  createProjectId,
  isSafeId,
  validateProjectData,
  validateAndParsePrg,
} from '../frontend/src/prof-model.js';
import {
  isAndroidDevice,
  readTextFileUtf8,
} from '../frontend/src/file-io.js';
import {
  DRIVE_ACCOUNT_KEY,
  normalizeDriveAccount,
  readDriveAccount,
  writeDriveAccount,
  clearDriveAccount,
} from '../frontend/src/drive-account.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');



test('local frontend contains the PDF.js runtime used by the DED importer', () => {
  const pdfjs = path.join(root, 'frontend', 'vendor', 'pdfjs');
  assert.ok(fs.existsSync(path.join(pdfjs, 'pdf.mjs')));
  assert.ok(fs.existsSync(path.join(pdfjs, 'pdf.worker.mjs')));
});
const appSource = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const coreViewSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'views-core.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'frontend', 'style.css'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'frontend', 'sw.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');

function validProject(overrides = {}) {
  return {
    format: PRG_FORMAT,
    version: PRG_VERSION,
    projectId: createProjectId(),
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    teacher: { name: 'Professor' },
    schools: [{ id: 'school-1', name: 'Escola', code: '', sre: '', address: '' }],
    classes: [{ id: 'class-1', name: '1º A', archived: false, schoolId: 'school-1', year: '2026', shift: 'Manhã' }],
    assignments: [{ id: 'assign-1', classId: 'class-1', schoolId: 'school-1', subject: 'Língua Portuguesa', teacherName: 'Professor', year: '2026', ded: null }],
    enrollments: [{ id: 'enroll-1', studentId: 'stu-1', classId: 'class-1', active: true }],
    students: [{ id: 'stu-1', name: 'Aluno 1', classId: 'class-1', enrollmentIds: ['enroll-1'], notes: '', observations: [] }],
    activities: [{ id: 'act-1', name: 'Atividade', classId: 'class-1', dueDate: '2026-01-05', description: '' }],
    occurrences: [],
    plans: [],
    ...overrides,
  };
}

test('modelo PRG usa um formato novo e uma versão inicial limpa', () => {
  assert.equal(PRG_FORMAT, 'professorgest-prg');
  assert.equal(PRG_VERSION, 1);
  assert.match(createProjectId(), /^[A-Za-z0-9_-]{1,80}$/);
  assert.equal(isSafeId('abc_123-xyz'), true);
  assert.equal(isSafeId('" onmouseover="alert(1)'), false);
});

test('o formato PRG não converte versões antigas', () => {
  assert.equal(validateProjectData({ classes: [], students: [], activities: [], occurrences: [] }).ok, false);
  assert.equal(validateProjectData({ ...validProject(), version: 1 }).ok, true);
  assert.equal(validateProjectData({ ...validProject(), version: 2 }).error, 'version');
  assert.equal(validateProjectData({ ...validProject(), format: 'professorgest', version: 4 }).error, 'format');
});

test('o modelo representa escola, turma, atuação e matrícula separadamente', () => {
  const project = validProject({
    schools: [{ id: 'school-1', name: 'Escola A', code: '1', sre: '', address: '' }],
    classes: [{ id: 'class-1', name: '2º EM REG 2', archived: false, schoolId: 'school-1', classCode: '2076183', year: '2026', shift: 'Manhã' }],
    assignments: [
      { id: 'assign-1', classId: 'class-1', schoolId: 'school-1', subject: 'Língua Inglesa', teacherName: 'Rosangela', year: '2026', ded: null },
      { id: 'assign-2', classId: 'class-1', schoolId: 'school-1', subject: 'Matemática', teacherName: 'Rosangela', year: '2026', ded: null },
    ],
  });
  const result = validateProjectData(project);
  assert.equal(result.ok, true);
  assert.equal(result.data.schools.length, 1);
  assert.equal(result.data.classes.length, 1);
  assert.equal(result.data.assignments.length, 2);
  assert.equal(result.data.enrollments.length, 1);
  assert.deepEqual(result.data.assignments.map(a => a.subject), ['Língua Inglesa', 'Matemática']);
});

test('formato PRG rejeita explicitamente qualquer formato anterior', () => {
  const old = { ...validProject(), format: 'professorgest', version: 4 };
  const parsed = validateAndParsePrg(JSON.stringify(old));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'format');
});

test('importador valida estrutura, limites e referências', () => {
  const result = validateProjectData(validProject());
  assert.equal(result.ok, true);
  assert.equal(result.data.version, 1);
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

test('arquivo .prg malicioso não passa por IDs inseguros', () => {
  const malicious = validProject({
    classes: [{ id: '"><img src=x onerror=alert(1)>', name: 'X', archived: false }],
  });
  const result = validateAndParsePrg(JSON.stringify(malicious));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'integrity');
});

test('limite de tamanho do .prg é aplicado', () => {
  const oversized = 'x'.repeat(MAX_PRG_BYTES + 1);
  const result = validateAndParsePrg(oversized);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'size');
});

test('conta Google lembrada persiste apenas identidade e normaliza os dados', () => {
  assert.equal(DRIVE_ACCOUNT_KEY, 'professorgest-drive-account-v1');
  const storage = { data: new Map(), getItem(key) { return this.data.get(key) ?? null; }, setItem(key, value) { this.data.set(key, value); }, removeItem(key) { this.data.delete(key); } };
  const account = normalizeDriveAccount({ displayName: ' Maria ', email: 'MARIA@EXAMPLE.COM ', photoLink: 'https://example.com/photo', permissionId: '123' });
  assert.deepEqual(account, { displayName: 'Maria', email: 'maria@example.com', photoLink: 'https://example.com/photo', permissionId: '123', lastVerifiedAt: null });
  assert.equal(writeDriveAccount(account, storage), true);
  assert.deepEqual(readDriveAccount(storage).account, account);
  assert.equal(clearDriveAccount(storage), true);
  assert.equal(readDriveAccount(storage).account, null);
  assert.equal(normalizeDriveAccount({ displayName: 'Sem identidade' }), null);
  assert.doesNotMatch(JSON.stringify(account), /access_token/i);
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
  assert.match(appSource, /projectStore\.createBackup/);
  assert.match(appSource, /classSearchInput/);
  assert.match(appSource, /activitySearchInput/);
  assert.match(cssSource, /planning-card/);
});
test('fluxo do DED preserva o modo de criação de novo projeto até a confirmação', () => {
  assert.match(appSource, /openDedImportModal\(\{ newProject: true \}\)|openDedPicker\(\{ newProject: true \}\)/);
  assert.match(appSource, /handleDedImportInput\(event, \{ newProject \}\), \{ once: true \}/);
  assert.match(appSource, /openDedImportReview\(parsed\.results, parsed\.errors, \{ newProject \}\)/);
  assert.match(appSource, /commitDedProject\(results, \{ newProject \}\)/);
});
test('resumo da atualização do DED mantém espaço e pluralização entre quantidade e descrição', () => {
  assert.match(appSource, /class="ded-update-summary-item"><strong>\$\{summary\.newStudents\}<\/strong><span>/);
  assert.match(appSource, /summary\.newStudents === 1 \? 'aluno novo' : 'alunos novos'/);
  assert.match(appSource, /summary\.renamedStudents === 1 \? 'nome alterado' : 'nomes alterados'/);
  assert.match(appSource, /summary\.preservedMissing === 1 \? 'ausente preservado' : 'ausentes preservados'/);
  assert.match(cssSource, /\.ded-update-summary-item\{[^}]*gap:7px/);
});
test('importação do DED usa identidade estável de escola + turma + ano e preenche perfil quando faltante', () => {
  const src = fs.readFileSync(path.join(root, 'frontend', 'src', 'ded-project.js'), 'utf8');
  assert.match(src, /sameDedClassIdentity\(c, data\)/);
  assert.match(src, /profile\.teacher\.name/);
  assert.match(src, /ensureSchool\(state, data, uid\)/);
  assert.match(src, /ensureAssignment\(state, data, cls, now, uid\)/);
  assert.match(appSource, /from '\.\/src\/ded-project\.js'/);
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

test('service worker inclui os módulos e não ativa atualização durante install', () => {
  assert.match(swSource, /CACHE_NAME = 'professorgest-shell-v66-projects'/);
  assert.match(swSource, /\.\/api-config\.js/);
  assert.match(swSource, /\.\/src\/prof-model\.js/);
  for (const mod of ['project-store', 'prg-transfer', 'drive-sync', 'ded-project', 'views-projects']) {
    assert.match(swSource, new RegExp(`\\./src/${mod}\\.js`));
  }
  assert.doesNotMatch(swSource, /local-store|drive-bindings|views-welcome/);
  assert.match(swSource, /\.\/src\/file-io\.js/);
  assert.match(swSource, /\.\/src\/ded-parser\.js/);
  assert.match(swSource, /\.\/src\/ded-pdf\.js/);
  assert.match(swSource, /\.\/vendor\/pdfjs\/pdf\.mjs/);
  assert.match(swSource, /\.\/src\/drive-http\.js/);
  assert.match(swSource, /\.\/src\/drive-account\.js/);
  assert.match(swSource, /\.\/src\/project-selectors\.js/);
  assert.match(swSource, /\.\/src\/ui-navigation\.js/);
  assert.match(swSource, /\.\/src\/ui-modal\.js/);
  assert.match(swSource, /\.\/src\/ui-search\.js/);
  assert.match(swSource, /\.\/src\/views-students-activities\.js/);
  assert.match(swSource, /\.\/src\/views-calendar-occurrences\.js/);
  assert.match(swSource, /\.\/src\/views-reports\.js/);
  assert.match(swSource, /\.\/src\/views-class\.js/);
  assert.match(swSource, /\.\/src\/views-file-settings\.js/);
  assert.doesNotMatch(swSource, /then\(\(\) => self\.skipWaiting\(\)\)/);
  assert.match(swSource, /if \(response\.ok\)/);
});

test('app importa as camadas modulares e roda como ES module', () => {
  assert.match(appSource, /from '\.\/src\/prof-model\.js'/);
  assert.match(appSource, /from '\.\/src\/project-store\.js'/);
  assert.match(appSource, /from '\.\/src\/drive-sync\.js'/);
  assert.match(appSource, /from '\.\/src\/prg-transfer\.js'/);
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
    occurrenceTypes: [{ key: 'faltou', label: 'Faltou', emoji: '⚠️' }],
    searchFieldHTML: (id, placeholder, value = '') => `<div class=\"search-field\"><input id=\"${id}\" placeholder=\"${placeholder}\" value=\"${value}\"></div>`
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
  let currentState = { createdAt: '2026-09-01', updatedAt: '2026-09-02', version: 3, teacher: { name: 'A' } };
  let info = { name: 'primeiro', classCount: 1, studentCount: 2, localLabel: 'Salvo neste dispositivo', linked: false, syncLabel: '', tone: 'neutral', lastBackupAt: null };
  let dirty = false;
  const views = createFileSettingsRenderers({
    getState: () => currentState, esc: value => String(value), getDemoMode: () => false,
    getIsDirty: () => dirty, ICONS: { file:'', folder:'', save:'', copy:'', cloud:'', share:'', plus:'', refresh:'', trash:'' },
    supportsFileShare: () => false, getProjectInfo: () => info, getDriveAccount: () => null,
    fmtDate: value => String(value), fmtDateTime: value => String(value), getThemeMode: () => 'light', getDevLogEntries: () => []
  });
  assert.match(views.renderArquivo(), /primeiro/);
  currentState = { createdAt: '2027-01-01', updatedAt: '2027-01-02', version: 3, teacher: { name: 'B' } };
  info = { ...info, name: 'segundo', localLabel: 'Salvando neste dispositivo…' };
  dirty = true;
  const next = views.renderArquivo();
  assert.match(next, /segundo/);
  assert.doesNotMatch(next, /primeiro/);
  assert.match(next, /Salvando neste dispositivo…/);
  assert.match(next, /Enviar ao Google Drive/);
  info = { ...info, linked: true, syncLabel: 'Alterações pendentes no Drive', driveFileName: 'segundo.prg' };
  const linked = views.renderArquivo();
  assert.match(linked, /Sincronizar agora/);
  assert.match(linked, /Desvincular/);
  assert.match(linked, /btnDeleteProjectEverywhere/);
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

test('navegação usa histórico real e restaura rota após reload', () => {
  const navigationSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'ui-navigation.js'), 'utf8');
  assert.match(navigationSource, /history\.pushState/);
  assert.match(navigationSource, /history\.replaceState/);
  assert.match(navigationSource, /addEventListener\('popstate'/);
  assert.match(navigationSource, /history\.back\(\)/);
  assert.match(navigationSource, /sessionStorage\.setItem\(ROUTE_KEY/);
  assert.match(appSource, /openProject\(savedRoute\.projectId/);
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


test('importação do DED possui pré-validação de limites e não permite excesso de dados', () => {
  const src = fs.readFileSync(path.join(root, 'frontend', 'src', 'ded-project.js'), 'utf8');
  assert.match(src, /O limite de \$\{MAX_CLASSES\} turmas seria ultrapassado/);
  assert.match(src, /O limite de \$\{MAX_STUDENTS\} alunos seria ultrapassado/);
  assert.match(src, /structuredClone\(state\)/);
  assert.match(appSource, /if \(!preview\.ok\)/);
});
test('carregamento do PDF.js pode ser tentado novamente depois de uma falha', () => {
  const pdfSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'ded-pdf.js'), 'utf8');
  assert.match(pdfSource, /pdfjsPromise = null;/);
  assert.match(pdfSource, /Atualize a página e tente novamente/);
  assert.match(pdfSource, /O PDF não contém texto legível/);
  assert.match(pdfSource, /MAX_DED_PAGES = 100/);
  assert.match(pdfSource, /páginas demais para uma lista do DED/);
  assert.match(pdfSource, /sort\(\(a, b\) => b\.y - a\.y \|\| a\.x - b\.x\)/);
});

test('pesquisa de ocorrência atualiza apenas a lista e não reabre o modal a cada caractere', () => {
  assert.match(appSource, /function occurrenceStudentListHTML/);
  assert.match(appSource, /const list = document\.getElementById\('quickStudentList'\)/);
  assert.doesNotMatch(appSource, /input\.oninput\s*=\s*\(\)\s*=>\s*rerenderModalKeepFocus\(\(\)\s*=>\s*openOccurrenceStep1/);
});

test('relatórios, ocorrências e listas usam o mesmo padrão visual de pesquisa e seleção', () => {
  assert.match(appSource, /searchFieldHTML\('reportStudentSearch'/);
  assert.match(appSource, /searchFieldHTML\('classReportSearch'/);
  assert.match(appSource, /searchFieldHTML\('quickSearchInput'/);
  assert.match(fs.readFileSync(path.join(root, 'frontend', 'src', 'views-calendar-occurrences.js'), 'utf8'), /searchFieldHTML\('occSearchInput'/);
  assert.match(appSource, /function reportStudentPickerHTML/);
  assert.match(appSource, /function reportClassPickerHTML/);
  assert.match(appSource, /createEntityPickerOption/);
  assert.match(appSource, /class="entity-picker-results"/);
  assert.doesNotMatch(appSource, /class="student-picker-results"/);
  assert.doesNotMatch(cssSource, /\.planning-search-field/);
  assert.doesNotMatch(appSource, /planning-search-field|entity-search-field/);
});

test('pesquisa global possui contenção própria para telas móveis', () => {
  assert.match(cssSource, /@media \(max-width: 560px\)[\s\S]*?\.cmdk-overlay[\s\S]*?\.cmdk-box[\s\S]*?100dvh/);
  assert.match(cssSource, /\.topbar-search \{ box-sizing: border-box; margin-left: 0; margin-right: 0; \}/);
});

test('pesquisa global possui botão explícito de fechamento também no mobile', () => {
  assert.match(appSource, /id=\"cmdkCloseBtn\"/);
  assert.match(appSource, /Fechar pesquisa/);
  assert.match(cssSource, /\.cmdk-close \{/);
  assert.match(cssSource, /\.cmdk-close svg/);
});

test('botão de pesquisa mobile mantém a mesma linguagem do botão de desktop', () => {
  assert.match(indexSource, /class=\"topbar-search\"[\s\S]*?topbar-search-label/);
  assert.match(cssSource, /\.topbar-search-label/);
  assert.match(cssSource, /@media \(max-width: 860px\)[\s\S]*?\.topbar-search \{ width: 82px;/);
});

test('pesquisa global é um overlay fixo e não participa do fluxo da página', () => {
  assert.match(cssSource, /\.cmdk-overlay \{[\s\S]*?position: fixed;[\s\S]*?inset: 0;[\s\S]*?display: flex;/);
  assert.match(cssSource, /#cmdkRoot \{[\s\S]*?z-index: 90;/);
  assert.match(cssSource, /\.cmdk-overlay \{[\s\S]*?overflow: auto;/);
});

test('campo de pesquisa tem uma única linguagem visual reutilizável', () => {
  assert.match(fs.readFileSync(path.join(root, 'frontend', 'src', 'ui-search.js'), 'utf8'), /createSearchField/);
  assert.match(cssSource, /\.search-field \{/);
  assert.match(cssSource, /\.search-field-icon/);
  assert.match(cssSource, /\.search-field-input\.form-input/);
  assert.match(cssSource, /\.entity-picker-option/);
  assert.match(cssSource, /\.entity-picker-empty/);
  assert.match(cssSource, /\.filter-bar-clean/);
});

test('barra da pesquisa global reserva espaço real para o botão de fechar sem sobrepor o placeholder', () => {
  assert.match(cssSource, /\.cmdk-input-row \{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;/);
  assert.match(cssSource, /\.cmdk-input \{[\s\S]*?width: auto;[\s\S]*?flex: 1 1 auto;[\s\S]*?box-sizing: border-box;/);
  assert.match(cssSource, /\.cmdk-close \{[\s\S]*?flex: 0 0 34px;/);
});

test('build e service worker incluem a primitiva compartilhada de pesquisa', () => {
  assert.ok(fs.existsSync(path.join(root, 'dist', 'src', 'ui-search.js')));
  assert.match(fs.readFileSync(path.join(root, 'frontend', 'sw.js'), 'utf8'), /\.\/src\/ui-search\.js/);
  assert.match(fs.readFileSync(path.join(root, 'scripts', 'build-pages.mjs'), 'utf8'), /'ui-search\.js'/);
});

test('Drive cria e atualiza o arquivo em uma única requisição multipart', () => {
  const src = fs.readFileSync(path.join(root, 'frontend', 'src', 'drive-sync.js'), 'utf8');
  assert.equal((src.match(/uploadType=multipart/g) || []).length, 2);
  assert.doesNotMatch(src, /uploadType=media/);
  assert.match(src, /appProperties/);
});
test('login do Google trata popup bloqueado/fechado via error_callback', () => {
  assert.match(appSource, /error_callback:/);
  assert.match(appSource, /driveTokenClient\.errorCallback = /);
  assert.match(appSource, /popup_failed_to_open/);
});

test('remover/trocar conta Google atualiza a tela inicial e a barra superior', () => {
  assert.match(appSource, /function refreshAccountUI\(\)/);
  const refresh = appSource.slice(appSource.indexOf('function refreshAccountUI'), appSource.indexOf('function sameDriveAccount'));
  assert.match(refresh, /updateWelcomeAccountControl\(\)/);
  assert.match(refresh, /if \(state && workspaceReady\)/);
  const handler = appSource.slice(appSource.indexOf("btnDriveForgetAccount')?.addEventListener"), appSource.indexOf('function waitForGoogleIdentity'));
  assert.doesNotMatch(handler, /\n\s*render\(\);/, 'render() quebra na tela inicial (state nulo)');
  assert.match(handler, /invalidateDriveSession\(\{ forgetAccount: true \}\)/);
});

test('após remover a conta, a próxima conexão mostra o seletor de contas', () => {
  assert.match(appSource, /driveForceAccountPrompt = true;/);
  assert.match(appSource, /driveForceAccountPrompt \? 'select_account' : ''/);
  assert.match(appSource, /const chooseAccount = selectAccount \|\| driveForceAccountPrompt;/);
});

test('resposta de login atrasada da conta antiga não reativa a sessão removida', () => {
  assert.match(appSource, /requestEpoch !== driveSessionEpoch/);
  assert.match(appSource, /driveSessionEpoch \+= 1;/);
});



test('políticas legais descrevem projetos locais, .prg portátil e o escopo drive.file', () => {
  const privacy = fs.readFileSync(path.join(root, 'frontend', 'privacidade.html'), 'utf8');
  const terms = fs.readFileSync(path.join(root, 'frontend', 'termos.html'), 'utf8');
  const sentence = /armazena os projetos localmente no dispositivo/;
  assert.match(privacy, sentence);
  assert.match(terms, sentence);
  for (const doc of [privacy, terms]) {
    assert.match(doc, /portátil para importação e exportação/);
    assert.match(doc, /armazenamento\/sincronização em nuvem/);
    assert.match(doc, /drive\.file/);
  }
  assert.match(privacy, /appProperties|propriedades privadas/);
  assert.doesNotMatch(privacy + terms, /arquivo \.prg continua sendo a cópia principal|abrir ou salvar um projeto no Google Drive/);
});

test('barra superior mostra o status uma única vez e o botão de volta leva a "Projetos"', () => {
  const fn = appSource.slice(appSource.indexOf('function topbarFileHTML'), appSource.indexOf('function rerenderKeepFocus'));
  assert.doesNotMatch(fn, /topbar-status/, 'topbarFileHTML não repete o status do chip');
  assert.match(htmlSource, /<span>Projetos<\/span>/);
  assert.match(htmlSource, /aria-label="Voltar para Seus projetos"/);
  assert.match(appSource, /topbarDrive\.hidden = demoMode \|\| !configured/);
});

test('listas de ações separam título e descrição em linhas distintas', () => {
  assert.match(cssSource, /\.action-list-item > span \{[^}]*flex-direction: column/);
  assert.match(cssSource, /\.choice-card strong\s*\{[^}]*display:\s*block|\.choice-card strong\{[^}]*display:block/);
});
