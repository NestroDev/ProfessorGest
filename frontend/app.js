import {
  PRG_FORMAT, PRG_VERSION, MAX_STUDENTS, createProjectId, validateProjectData
} from './src/prof-model.js';
import {
  createProjectStore, createIndexedDbAdapter, migrateLegacyIfNeeded, summarizeProject, isDrivePending, projectNameOf,
  MAX_BACKUPS_PER_PROJECT, IMPORT_MODES, LEGACY_DB_NAME,
} from './src/project-store.js';
import { exportProjectPrg, readPrgFile, prgFileNameForProject } from './src/prg-transfer.js';
import {
  SYNC_STATUS, DriveError, DRIVE_SCOPE, createDriveApi, discoverDriveProjects, mergeProjectLists, computeSyncStatus, syncLabel,
  syncProject, resolveConflictKeepLocal, resolveConflictUseRemote, pullRemoteIfNewer, addDriveProjectToDevice,
  trashProjectOnDrive, removeFromDeviceAndDrive, unlinkProjectFromDrive, classifyDriveError, isRemoteNewer,
} from './src/drive-sync.js';
import { projectsListHTML, cloudAccountSummary, statusTone, needsAttention } from './src/views-projects.js';
import { previewDedProjectUpdate } from './src/ded-project.js';
import { supportsFileShare, downloadTextFile } from './src/file-io.js';
import { driveFetch as driveHttpFetch, driveJson as driveHttpJson, driveText as driveHttpText } from './src/drive-http.js';
import { readDriveAccount, writeDriveAccount, clearDriveAccount, normalizeDriveAccount, driveAuthState } from './src/drive-account.js';
import { apiClient } from './src/services/api-client.js';
import { createNavigationController } from './src/ui-navigation.js';
import { transitionSaveState } from './src/save-state.js';
import { createCoreViewRenderers } from './src/views-core.js';
import { createModalController } from './src/ui-modal.js';
import { createStudentActivityRenderers } from './src/views-students-activities.js';
import { createCalendarOccurrenceRenderers } from './src/views-calendar-occurrences.js';
import { createReportRenderers } from './src/views-reports.js';
import { createFileSettingsRenderers } from './src/views-file-settings.js';
import { createClassViewRenderers } from './src/views-class.js';
import { createPlanningViewRenderer } from './src/views-planning.js';
import { studentsOf as selectStudentsOf, occurrencesOf as selectOccurrencesOf, activitiesOf as selectActivitiesOf, plansOf as selectPlansOf, assignmentsOf as selectAssignmentsOf, assignmentById as selectAssignmentById, schoolById as selectSchoolById, classById as selectClassById, studentById as selectStudentById, activeClasses as selectActiveClasses, activeStudents as selectActiveStudents, activeActivities as selectActiveActivities, studentStats as selectStudentStats, classStats as selectClassStats, activityStats as selectActivityStats, activityStatus as selectActivityStatus, classIdsOfStudent as selectClassIdsOfStudent } from './src/project-selectors.js';
import { parseDedPdfFiles } from './src/ded-pdf.js';
import { createSearchField, createEntityPickerOption, createEntityPickerEmpty } from './src/ui-search.js';
import { normalizeDedClassKey, normalizeExistingDedData } from './src/ded-parser.js';

/* ==================== ProfessorGest ====================
   PWA local-first. O projeto vive no IndexedDB deste dispositivo; o .prg é
   formato portátil de importação/exportação e o Drive é cópia/sincronização.
================================================================= */

const APP_BUILD = '2026.10.01.8-projects';
const DEV_LOG_KEY = 'professorgest-dev-log-v2';
const DEV_LOG_LEGACY_KEYS = ['professorgest-dev-log-v1'];
const DEV_LOG_MAX_ENTRIES = 50;

try {
  DEV_LOG_LEGACY_KEYS.forEach(key => localStorage.removeItem(key));
} catch (_) {}

function sanitizeLogValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (depth > 3) return '[truncated]';
  if (value instanceof Error || (typeof DOMException !== 'undefined' && value instanceof DOMException)) {
    return {
      name: value.name || 'Error',
      message: value.message || String(value),
      stack: typeof value.stack === 'string' ? value.stack.slice(0, 5000) : undefined,
      code: value.code || undefined
    };
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 40).map(v => sanitizeLogValue(v, depth + 1, seen));
    const out = {};
    Object.keys(value).slice(0, 40).forEach(key => {
      const lower = key.toLowerCase();
      out[key] = ['authorization', 'accesstoken', 'token', 'password', 'secret'].some(part => lower.includes(part))
        ? '[redacted]' : sanitizeLogValue(value[key], depth + 1, seen);
    });
    return out;
  }
  return String(value);
}

function getDevLogEntries() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEV_LOG_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const errorsOnly = parsed.filter(entry => entry && entry.level === 'error');
    if (errorsOnly.length !== parsed.length) {
      try {
        localStorage.setItem(DEV_LOG_KEY, JSON.stringify(errorsOnly.slice(-DEV_LOG_MAX_ENTRIES)));
      } catch (_) {}
    }
    return errorsOnly.slice(-DEV_LOG_MAX_ENTRIES);
  } catch (_) {
    return [];
  }
}

function getDevRuntimeContext() {
  const nav = window.navigator || {};
  return {
    appBuild: APP_BUILD,
    userAgent: nav.userAgent || '',
    platform: nav.userAgentData?.platform || nav.platform || '',
    language: nav.language || '',
    online: typeof nav.onLine === 'boolean' ? nav.onLine : null,
    standalone: window.matchMedia?.('(display-mode: standalone)')?.matches || false,
    android: /Android/i.test(nav.userAgent || ''),
    fileSystemAccess: typeof window.showSaveFilePicker === 'function',
    indexedDB: 'indexedDB' in window,
    origin: window.location?.origin || '',
    path: window.location?.pathname || '',
    viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
    storage: 'indexeddb',
    openProjectId: typeof state !== 'undefined' && state ? (state.projectId || null) : null
  };
}

function appendDevLog(level, source, message, details = null) {
  if (level !== 'error') return;
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level: 'error',
    source,
    message: String(message || ''),
    context: getDevRuntimeContext(),
    details: details === null ? null : sanitizeLogValue(details)
  };
  try {
    localStorage.setItem(DEV_LOG_KEY, JSON.stringify([...getDevLogEntries(), entry].slice(-DEV_LOG_MAX_ENTRIES)));
  } catch (_) {}
}

function logError(source, error, details = null) {
  const merged = details && typeof details === 'object'
    ? { ...sanitizeLogValue(details), error: sanitizeLogValue(error) }
    : { error: sanitizeLogValue(error) };
  appendDevLog('error', source, error?.message || String(error || 'Erro desconhecido'), merged);
}
function clearDevLog() { try { localStorage.removeItem(DEV_LOG_KEY); } catch (_) {} }
function exportDevLog() {
  const entries = getDevLogEntries();
  const payload = {
    app: 'ProfessorGest',
    build: APP_BUILD,
    generatedAt: new Date().toISOString(),
    entryCount: entries.length,
    runtime: getDevRuntimeContext(),
    entries
  };
  const filename = `professorgest-informacoes-suporte-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  downloadFallback(JSON.stringify(payload, null, 2), filename, 'application/json;charset=utf-8');
}

(function installGlobalDiagnostics() {
  window.addEventListener('error', event => {
    logError('window.error', event.error || new Error(event.message || 'Erro JavaScript não tratado.'), {
      filename: event.filename || null, line: event.lineno || null, column: event.colno || null
    });
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Promise rejeitada sem motivo.'));
    logError('window.unhandledrejection', reason);
  });
  window.addEventListener('securitypolicyviolation', event => {
    logError('window.securitypolicyviolation', new Error('Violação de Content Security Policy.'), {
      blockedURI: event.blockedURI || '', violatedDirective: event.violatedDirective || '', effectiveDirective: event.effectiveDirective || ''
    });
  });
})();

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && isDirty && !demoMode) {
    flushLocalSave().catch(() => {});
  }
});
window.addEventListener('pagehide', () => {
  if (isDirty && !demoMode) flushLocalSave().catch(() => {});
});

let state = null;
let isDirty = false;
let workspaceReady = false;
let demoMode = false;
let driveAccessToken = null;
let driveTokenExpiresAt = 0;
let driveTokenClient = null;
let driveTokenPromise = null;
let driveAuthCancelled = false;
let drivePickerReady = false;
let driveAccount = readDriveAccount().account;
let driveSessionEpoch = 0;
let driveForceAccountPrompt = false;
let setupOrigin = 'welcome';
let currentView = 'dashboard';
let lastAttentionItems = [];
let saveUiState = 'idle';
function setSaveUiState(next) { saveUiState = transitionSaveState(saveUiState, next); return saveUiState; }
let deferredInstallPrompt = null;
let dirtyRevision = 0;
let ctx = {
  classId: null, studentId: null, activityId: null,
  classTab: 'visao', studentTab: 'visao',
  histFilter: 'todos', histMonth: '',
  studentSearch: '', studentClassFilter: '', studentSort: 'nome',
  activityFilter: 'proximas', activityClassFilter: '',
  occSearch: '', occClassFilter: '', occTypeFilter: '', occMonth: '',
  calMonth: todayYM(), calSelectedDay: null, calClassFilter: '',
  bulkMode: false, bulkSelected: new Set(), bulkContext: null,
  assignmentId: null, reportStudentId: null, reportFrom: '', reportTo: '', reportOpts: null, reportSynthesis: '',
  classReportId: null, classReportFrom: '', classReportTo: '',
  classSearch: '', classComponentFilter: '', classSchoolFilter: '', classYearFilter: '', activitySearch: '',
  planningSearch: '', planningClassFilter: '', planningFrom: '', planningTo: '',
};

const OCCUR_TYPES = [
  { key: 'nao_atividade',     label: 'Não fez atividade',        tone: 'red' },
  { key: 'conversou',         label: 'Conversou durante a aula',  tone: 'amber' },
  { key: 'faltou',            label: 'Faltou',                    tone: 'gray' },
  { key: 'participou',        label: 'Participou da aula',        tone: 'green' },
  { key: 'bom_comportamento', label: 'Bom comportamento',         tone: 'green' },
  { key: 'observacao',        label: 'Outra observação',          tone: 'blue' },
];

const NAV_GROUPS = [
  { label: 'Início', items: [
    { key: 'dashboard', label: 'Início', icon: 'home' },
  ]},
  { label: 'Organização', items: [
    { key: 'turmas', label: 'Turmas', icon: 'users' },
    { key: 'alunos', label: 'Alunos', icon: 'user' },
    { key: 'escolas', label: 'Escolas', icon: 'school' },
  ]},
  { label: 'Aulas', items: [
    { key: 'atividades', label: 'Atividades', icon: 'clipboard' },
    { key: 'planejamento', label: 'Planejamento', icon: 'notebook' },
    { key: 'calendario', label: 'Calendário', icon: 'calendar' },
  ]},
  { label: 'Acompanhamento', items: [
    { key: 'ocorrencias', label: 'Registros', icon: 'bell' },
    { key: 'relatorios', label: 'Relatórios', icon: 'report' },
  ]},
  { label: 'Sistema', items: [
    { key: 'arquivo', label: 'Projeto', icon: 'folder' },
    { key: 'configuracoes', label: 'Configurações', icon: 'settings' },
  ]},
];
const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items);
// No celular, a navegação organiza as telas por contexto de trabalho.
const MOBILE_NAV_ITEMS = [
  { key: 'dashboard', label: 'Início', icon: 'home', views: ['dashboard'] },
  { key: 'pessoas', label: 'Pessoas', icon: 'users', views: ['turmas', 'alunos', 'escolas'] },
  { key: 'aulas', label: 'Aulas', icon: 'notebook', views: ['atividades', 'planejamento', 'calendario'] },
  { key: 'acompanhamento', label: 'Acomp.', icon: 'bell', views: ['ocorrencias', 'relatorios'] },
  { key: 'mais', label: 'Mais', icon: 'menu', views: ['arquivo', 'configuracoes'] },
];

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M22 20c0-2.6-2-4.8-4.7-5.5"/></svg>',  school: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-7h6v7M8 10h.01M12 10h.01M16 10h.01"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 011-1h4a1 1 0 011 1v1"/><path d="M9 11h6M9 15h6"/></svg>',
  notebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4.5h10.5A1.5 1.5 0 0 1 18 6v14H7.5A2.5 2.5 0 0 1 5 17.5v-11A2 2 0 0 1 7 4.5z"/><path d="M8 4.5V20M11 9h4M11 13h4"/><path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H18"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9a6 6 0 0112 0c0 4 1.5 5.5 1.5 6.5H4.5C4.5 14.5 6 13 6 9z"/><path d="M10 19a2 2 0 004 0"/></svg>',
  report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M9 13h6M9 17h6M9 9h2"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V6z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21a2 2 0 11-4 0v-.2a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.2a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.6V3a2 2 0 114 0v.2a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.6 1H21a2 2 0 110 4h-.2a1.7 1.7 0 00-1.6 1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0l1 13a1 1 0 001 1h6a1 1 0 001-1l1-13"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18l6-6-6-6"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h11l3 3v13a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z"/><path d="M8 4v5h7V4M8 14h8v6H8z"/></svg>',
  saveAction: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15"><path d="M12 3v11"/><path d="m8 10 4 4 4-4"/><path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 18h10.2a4.8 4.8 0 00.6-9.56A6.5 6.5 0 005.1 9.7 4.2 4.2 0 007 18z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 13h4"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>',
  move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h10l-3-3M17 17H7l3 3"/><path d="M17 7v4M7 13v4"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V3h12v6M6 18H4a1 1 0 01-1-1v-5a1 1 0 011-1h16a1 1 0 011 1v5a1 1 0 01-1 1h-2M6 14h12v7H6z"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5M9 15v-3h1.5a1 1 0 010 2H9M13 12v3h1.2a1.4 1.4 0 000-3H13M17 12v3M17 13.3h1.4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 12l5 5L20 6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2.5 17a1.6 1.6 0 001.4 2.4h16.2a1.6 1.6 0 001.4-2.4L13.7 3.9a1.6 1.6 0 00-2.8 0z"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M20 11a8 8 0 0 0-14.9-3.8L3 10"/><path d="M3 5v5h5"/><path d="M4 13a8 8 0 0 0 14.9 3.8L21 14"/><path d="M21 19v-5h-5"/></svg>',
  arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

let navigation = null;
const modalController = createModalController({
  icons: ICONS,
  escapeHtml: esc,
  bindEvents: () => bindModalEvents(),
  getMobileMenuCloser: () => navigation?.closeMobileMenu(),
});
const { openModal, closeModal, rerenderModalKeepFocus, showFileErrorModal, confirmModal } = modalController;
navigation = createNavigationController({
  navGroups: NAV_GROUPS,
  navItems: NAV_ITEMS,
  mobileNavItems: MOBILE_NAV_ITEMS,
  icons: ICONS,
  queryAll: qAll,
  escapeHtml: esc,
  getState: () => state,
  getContext: () => ctx,
  setContext: value => { ctx = value; },
  getCurrentView: () => currentView,
  setCurrentView: value => { currentView = value; },
  render,
  openCommandPalette,
  closeCommandPalette,
  openModal,
  closeModal,
  driveLinkForCurrentProject,
});
const { buildNav, openMobileMenu, closeMobileMenu, navigate, goBack, getPersistedRoute, clearPersistedRoute } = navigation;

/* ==================== datas ==================== */

function pad2(n) { return String(n).padStart(2, '0'); }
function formatLocalISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function todayISO() { return formatLocalISO(new Date()); }
function todayYM() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return formatLocalISO(d); }
function fmtDate(iso) {
  if (!iso || typeof iso !== 'string') return '-';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function fmtDateTime(iso) {
  if (!iso || typeof iso !== 'string') return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fmtDate(iso);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function monthLabel(ym) {
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const [y, m] = ym.split('-');
  return `${meses[parseInt(m, 10) - 1]} de ${y}`;
}
function weekdayShort(idx) { return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][idx]; }
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/* ==================== projetos: camada principal ====================
   Projeto = entidade principal. IndexedDB = armazenamento local.
   ".prg" = importação/exportação. Google Drive = cópia remota/sincronização.
   Backups e recovery pertencem a cada projectId. Nada aqui depende de
   FileHandle, File System Access API ou "modo de armazenamento". */

const projectStore = createProjectStore({ adapter: createIndexedDbAdapter() });
const RECOVERY_FALLBACK_PREFIX = 'professorgest-recovery-';
const PROJECT_NAME_MAX = 200;

let currentMeta = null;                 // metadados do projeto aberto
let projectsCache = [];                 // metadados leves para a listagem
let recoveryIdsCache = new Set();
let projectsRenderToken = 0;
let projectSearchQuery = '';
let saveInFlight = null;
let saveTimer = null;
let recoveryTimer = null;
let lastLocalSaveAt = 0;
let saveFailureNotified = false;
let driveActionPending = false;
let driveNeedsInteraction = false;
let driveAutoSyncTimer = null;
const driveSyncing = new Set();         // projectIds em sincronização
const driveRemoteMeta = {};             // projectId -> último metadado remoto conhecido
const driveLastError = {};              // projectId -> 'auth' | 'offline' | ...
let driveListing = { files: [], status: 'idle', message: '', tone: 'neutral' };

let lastBackupAtCache = null;
async function refreshBackupInfo() {
  if (!state?.projectId || demoMode) { lastBackupAtCache = null; return; }
  const backups = await projectStore.listBackups(state.projectId).catch(() => []);
  lastBackupAtCache = backups[0]?.savedAt || null;
}

function getProjectInfo() {
  const link = currentDriveLink();
  const status = currentSyncStatus();
  return {
    name: state?.name || projectNameOf(state),
    classCount: state?.classes?.length || 0,
    studentCount: state?.students?.length || 0,
    localLabel: localStatusLabel(),
    linked: !!link,
    syncLabel: link ? syncLabel(status) : '',
    tone: link ? statusTone(status) : 'neutral',
    driveFileName: link?.fileName || null,
    lastSyncAt: link?.lastSyncAt || null,
    lastBackupAt: lastBackupAtCache,
    updatedAt: currentMeta?.updatedAt || state?.updatedAt || null,
  };
}

function currentDriveLink() { return currentMeta?.driveLink || null; }
// Compatibilidade com módulos de visão que perguntam "há vínculo?".
function driveLinkForCurrentProject() { return currentDriveLink(); }

function currentSyncStatus(meta = currentMeta) {
  if (!meta) return SYNC_STATUS.LOCAL_ONLY;
  return computeSyncStatus(meta, driveRemoteMeta[meta.projectId] || null, {
    syncing: driveSyncing.has(meta.projectId),
    online: navigator.onLine,
    lastError: driveLastError[meta.projectId] || null,
    authState: currentDriveAuthState(),
  });
}

function currentDriveAuthState() {
  return driveAuthState({
    account: driveAccount, hasToken: !!driveAccessToken, tokenExpiresAt: driveTokenExpiresAt, needsInteraction: driveNeedsInteraction,
  });
}
function hasValidDriveToken() { return !!driveAccessToken && driveTokenExpiresAt > Date.now() + 60000; }

/* ---------- salvamento local automático ---------- */

function markDirty() {
  if (demoMode) return;
  dirtyRevision += 1;
  isDirty = true;
  setSaveUiState('dirty');
  scheduleRecoveryDraft();
  scheduleAutomaticSave();
  updateSaveChrome();
}

function scheduleAutomaticSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushLocalSave().catch(err => logError('save.automatic_failed', err));
  }, 700);
}

/** Grava o projeto aberto no IndexedDB. Nunca depende do Drive nem de arquivo físico. */
async function flushLocalSave() {
  if (!state || demoMode || !workspaceReady || !state.projectId) return false;
  clearTimeout(saveTimer);
  if (saveInFlight) { try { await saveInFlight; } catch (_) {} }
  if (!isDirty) return true;
  const projectId = state.projectId;
  const revision = dirtyRevision;
  const payload = buildSavePayload();
  saveInFlight = (async () => {
    setSaveUiState('saving');
    updateSaveChrome();
    let result;
    try {
      result = await projectStore.saveProject(payload);
    } catch (err) {
      if (err?.code === 'PROJECT_NOT_FOUND') {
        if (state?.projectId === projectId) handleProjectRemovedElsewhere(projectId);
        return false;
      }
      logError('save.local_failed', err, { projectId });
      if (state?.projectId === projectId) {
        setSaveUiState('dirty');
        updateSaveChrome();
        if (!saveFailureNotified) {
          saveFailureNotified = true;
          toast('Não foi possível salvar neste dispositivo agora. Suas alterações continuam abertas; vamos tentar novamente.', 'error');
        }
        scheduleAutomaticSave();
      }
      return false;
    }
    saveFailureNotified = false;
    // O projeto pode ter sido trocado durante a gravação: o dado antigo já está seguro.
    if (state?.projectId !== projectId) return true;
    if (result?.meta) currentMeta = result.meta;
    lastLocalSaveAt = Date.now();
    if (dirtyRevision === revision) {
      isDirty = false;
      setSaveUiState('saved');
      projectStore.discardRecovery(projectId).catch(() => {});
      clearRecoveryFallback(projectId);
      recoveryIdsCache.delete(projectId);
    } else {
      isDirty = true;
      setSaveUiState('dirty');
      scheduleAutomaticSave();
    }
    updateSaveChrome();
    projectStore.createBackupIfDue(projectId, 'Proteção automática').catch(() => {});
    scheduleDriveAutoSync();
    return true;
  })().finally(() => { saveInFlight = null; });
  return saveInFlight;
}

let removedElsewhereShown = false;
/** O projeto aberto foi excluído em outra aba/janela: nunca recriá-lo em silêncio. */
function handleProjectRemovedElsewhere(projectId) {
  clearTimeout(saveTimer); clearTimeout(recoveryTimer); clearTimeout(driveAutoSyncTimer);
  if (removedElsewhereShown) return;
  removedElsewhereShown = true;
  setSaveUiState('dirty');
  updateSaveChrome();
  openModal(`
    <div class="confirm-icon danger">${ICONS.alert}</div>
    <div class="modal-title">Este projeto foi removido deste dispositivo</div>
    <p class="confirm-body">“${esc(state?.name || 'O projeto')}” foi excluído em outra janela ou aba do ProfessorGest. Suas últimas alterações ainda estão abertas aqui. Escolha o que fazer:</p>
    <div class="choice-grid">
      <button type="button" class="choice-card primary" id="removedRestore"><span><strong>Restaurar este projeto</strong><small>Salva de novo, neste dispositivo, a versão que está aberta agora.</small></span></button>
      <button type="button" class="choice-card" id="removedExport"><span><strong>Exportar uma cópia .prg e fechar</strong><small>Guarda a versão aberta em um arquivo e volta para Seus projetos, sem recriar o projeto.</small></span></button>
      <button type="button" class="choice-card" id="removedDiscard"><span><strong>Descartar e fechar</strong><small>Fecha sem salvar. O projeto continua excluído.</small></span></button>
    </div>
  `);
  const finish = async () => {
    removedElsewhereShown = false;
    closeModal();
    state = null; currentMeta = null; workspaceReady = false; isDirty = false; resetContext();
    await showWelcomeScreen({ withLoading: false });
  };
  document.getElementById('removedRestore')?.addEventListener('click', async () => {
    removedElsewhereShown = false;
    try {
      const result = await projectStore.saveProject(buildSavePayload(), { recreate: true });
      if (result?.meta) currentMeta = result.meta;
      isDirty = false; setSaveUiState('saved'); closeModal(); updateSaveChrome();
      toast('Projeto restaurado neste dispositivo.', 'success');
    } catch (err) { logError('project.restore_failed', err); toast('Não foi possível restaurar o projeto.', 'error'); }
  });
  document.getElementById('removedExport')?.addEventListener('click', async () => {
    try { await exportProjectPrg(buildSavePayload()); } catch (err) { logError('export.failed', err); }
    await finish();
  });
  document.getElementById('removedDiscard')?.addEventListener('click', finish);
}

/** Salva e cria um backup antes de uma ação destrutiva. */
async function protectBeforeDestructive(reason) {
  if (!state?.projectId || demoMode || !workspaceReady) return false;
  await flushLocalSave();
  return !!(await projectStore.createBackup(state.projectId, reason).catch(() => null));
}

/* ---------- recovery (estado temporário por projeto) ---------- */

const recoveryFallbackKey = projectId => `${RECOVERY_FALLBACK_PREFIX}${projectId}`;
function clearRecoveryFallback(projectId) { try { localStorage.removeItem(recoveryFallbackKey(projectId)); } catch (_) {} }

function scheduleRecoveryDraft() {
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => persistRecoveryDraft(), 550);
}

function persistRecoveryDraft({ sync = false } = {}) {
  if (!state || demoMode || !workspaceReady || !isDirty || !state.projectId) return false;
  const projectId = state.projectId;
  const payload = buildSavePayload();
  projectStore.writeRecovery(projectId, payload).catch(() => {});
  if (sync) {
    // Em pagehide o IndexedDB pode não concluir: guarda também um fallback por projectId.
    try { localStorage.setItem(recoveryFallbackKey(projectId), JSON.stringify({ projectId, savedAt: new Date().toISOString(), state: payload })); } catch (_) {}
  }
  recoveryIdsCache.add(projectId);
  return true;
}

async function readRecoveryFor(projectId) {
  let best = null;
  try { best = await projectStore.readRecovery(projectId); } catch (_) {}
  try {
    const raw = localStorage.getItem(recoveryFallbackKey(projectId));
    if (raw) {
      const fb = JSON.parse(raw);
      const fbMs = Date.parse(fb?.savedAt || '') || 0;
      if (fb?.state?.projectId === projectId && fb.state.format === PRG_FORMAT && fbMs > (Number(best?.savedAtMs) || 0)) {
        best = { projectId, savedAt: fb.savedAt, savedAtMs: fbMs, state: fb.state };
      }
    }
  } catch (_) {}
  return best?.state ? best : null;
}

async function discardRecoveryFor(projectId) {
  await projectStore.discardRecovery(projectId).catch(() => {});
  clearRecoveryFallback(projectId);
  recoveryIdsCache.delete(projectId);
}

/* ---------- status na interface ---------- */

function localStatusLabel() {
  if (saveUiState === 'saving' || isDirty) return 'Salvando neste dispositivo…';
  return 'Salvo neste dispositivo';
}

function projectStatusLabel() {
  if (saveUiState === 'saving' || isDirty) return { text: 'Salvando neste dispositivo…', cls: 'saving' };
  if (!currentDriveLink()) return { text: 'Salvo neste dispositivo', cls: 'saved' };
  const status = currentSyncStatus();
  const tone = statusTone(status);
  return { text: syncLabel(status), cls: tone === 'ok' ? 'synced' : (tone === 'neutral' ? 'saved' : 'dirty') };
}

function updateTopbarDrive() {
  const topbarDrive = document.getElementById('topbarDriveBtn');
  if (topbarDrive) {
    const linked = !!currentDriveLink();
    const configured = isGoogleDriveConfigured();
    const status = currentSyncStatus();
    const busy = driveActionPending || driveSyncing.has(state?.projectId);
    const labels = {
      [SYNC_STATUS.SYNCED]: 'Sincronizado', [SYNC_STATUS.PENDING]: 'Sincronizar agora', [SYNC_STATUS.OFFLINE]: 'Sincronizar agora',
      [SYNC_STATUS.CONFLICT]: 'Resolver diferença', [SYNC_STATUS.REMOTE_NEWER]: 'Sincronizar agora', [SYNC_STATUS.RECONNECT]: 'Reconectar',
      [SYNC_STATUS.REMOTE_MISSING]: 'Revisar Drive', [SYNC_STATUS.SYNCING]: 'Sincronizando…',
    };
    topbarDrive.hidden = demoMode || !configured;
    topbarDrive.classList.toggle('connected', linked);
    topbarDrive.classList.toggle('pending', linked && status !== SYNC_STATUS.SYNCED);
    topbarDrive.disabled = !!busy;
    topbarDrive.setAttribute('aria-busy', busy ? 'true' : 'false');
    topbarDrive.querySelector('.topbar-drive-label').textContent = busy ? 'Sincronizando…' : (linked ? (labels[status] || 'Sincronizar agora') : 'Google Drive');
    topbarDrive.title = linked ? syncLabel(status) : (configured ? 'Enviar este projeto ao Google Drive (uma cópia na nuvem)' : 'Google Drive ainda não configurado');
    topbarDrive.setAttribute('aria-label', topbarDrive.title);
    topbarDrive.onclick = () => syncProjectNow(state?.projectId);
  }
}

function updateSaveChrome() {
  if (state && workspaceReady) {
    const file = document.getElementById('topbarFile');
    if (file) file.innerHTML = topbarFileHTML();
    updateTopbarDrive();
  }
  const chip = document.getElementById('topbarSaveStatus');
  if (!chip) return;
  if (demoMode) {
    chip.innerHTML = `<span class="save-chip neutral"><span class="save-chip-dot"></span>Demonstração</span>`;
    chip.title = 'Modo demonstração';
    return;
  }
  const { text, cls } = projectStatusLabel();
  chip.innerHTML = `<span class="save-chip ${cls}"><span class="save-chip-dot"></span><span>${esc(text)}</span></span>`;
  chip.title = text;
}

/* ---------- abrir / criar / fechar projetos ---------- */

function normalizeProjectName(value) { return String(value ?? '').trim().slice(0, PROJECT_NAME_MAX); }

async function applyProject(record, { navigateToDashboard = true, recovered = false } = {}) {
  const validated = validateProjectData(record.state);
  if (!validated.ok) { toast('Este projeto contém dados inválidos e não pôde ser aberto.', 'error'); return false; }
  const normalized = normalizeExistingDedData(validated.data);
  state = normalized.data;
  currentMeta = record.meta;
  demoMode = false;
  isDirty = false;
  dirtyRevision = 0;
  saveFailureNotified = false;
  setSaveUiState('saved');
  resetContext();
  enterWorkspace();
  if (navigateToDashboard) navigate('dashboard', true, { replace: true });
  if (recovered) { markDirty(); }
  updateSaveChrome();
  render();
  projectStore.createBackupIfDue(state.projectId, 'Projeto aberto', { minIntervalMs: 6 * 60 * 60 * 1000 }).catch(() => {}).finally(() => refreshBackupInfo());
  refreshBackupInfo().then(() => { if (state && workspaceReady && currentView === 'arquivo') render(); });
  return true;
}

function askRecoveryChoice(name) {
  return new Promise(resolve => {
    openModal(`
      <div class="confirm-icon info">${ICONS.refresh}</div>
      <div class="modal-title">Recuperação disponível</div>
      <p class="confirm-body">Encontramos alterações protegidas de <strong>${esc(name)}</strong> mais recentes que a versão salva. Elas podem ter ficado de uma sessão que foi interrompida.</p>
      <div class="form-actions form-actions-wrap-mobile">
        <button type="button" class="btn-secondary" id="recoveryUseSaved">Abrir versão salva</button>
        <button type="button" class="btn-primary" id="recoveryUseDraft">Continuar com a recuperação</button>
      </div>
      <div class="form-actions"><button type="button" class="btn-ghost" id="modalCancel">Cancelar</button></div>
    `, false);
    document.getElementById('recoveryUseDraft')?.addEventListener('click', () => { closeModal(); resolve('recover'); });
    document.getElementById('recoveryUseSaved')?.addEventListener('click', () => { closeModal(); resolve('saved'); });
    document.getElementById('modalCancel')?.addEventListener('click', () => resolve('cancel'));
  });
}

async function openProject(projectId, { navigateToDashboard = true, interactive = true } = {}) {
  if (!projectId) return false;
  if (state && workspaceReady && !demoMode && isDirty) await flushLocalSave();
  const record = await projectStore.getProject(projectId);
  if (!record) { toast('Não encontramos este projeto neste dispositivo.', 'error'); await refreshProjectsUI(); return false; }

  const recovery = await readRecoveryFor(projectId);
  const newer = recovery && (Number(recovery.savedAtMs) || 0) > (Number(record.meta.updatedAtMs) || 0) + 1000;
  if (!recovery) { /* nada a decidir */ }
  else if (!newer) { await discardRecoveryFor(projectId); }
  else if (interactive) {
    const choice = await askRecoveryChoice(record.meta.name);
    if (choice === 'cancel') return false;
    if (choice === 'recover') return applyProject({ meta: record.meta, state: recovery.state }, { navigateToDashboard, recovered: true });
    await discardRecoveryFor(projectId);
  } else {
    // Reabertura automática (reload): nunca descarte a recuperação em silêncio.
    return applyProject({ meta: record.meta, state: recovery.state }, { navigateToDashboard, recovered: true });
  }
  return applyProject(record, { navigateToDashboard });
}

/** Recarrega o projeto aberto a partir do IndexedDB (após restaurar backup ou usar a versão do Drive). */
async function reloadOpenProject() {
  if (!state?.projectId) return false;
  const record = await projectStore.getProject(state.projectId);
  if (!record) return false;
  const validated = validateProjectData(record.state);
  if (!validated.ok) return false;
  state = normalizeExistingDedData(validated.data).data;
  currentMeta = record.meta;
  isDirty = false;
  dirtyRevision += 1;
  setSaveUiState('saved');
  await discardRecoveryFor(state.projectId);
  render();
  return true;
}

async function createProjectFromState(newState) {
  const result = await projectStore.createProject(newState);
  return result.meta;
}

function setProjectName(name) {
  const clean = normalizeProjectName(name);
  if (!clean || !state) return false;
  state.name = clean;
  markDirty();
  return true;
}

async function closeCurrentProject() {
  if (demoMode) { exitDemoMode(); return; }
  if (isDirty) {
    const ok = await flushLocalSave();
    if (!ok && isDirty) persistRecoveryDraft({ sync: true });
  }
  clearTimeout(driveAutoSyncTimer);
  state = null;
  currentMeta = null;
  workspaceReady = false;
  isDirty = false;
  resetContext();
  await showWelcomeScreen();
}

function launchDemoMode() {
  state = loadDemoData();
  currentMeta = null;
  demoMode = true;
  workspaceReady = true;
  isDirty = false;
  setSaveUiState('saved');
  resetContext();
  enterWorkspace();
  navigate('dashboard');
}

function beginDemoMode() {
  if (workspaceReady && isDirty && !demoMode) flushLocalSave().catch(() => {});
  launchDemoMode();
}

function exitDemoMode() {
  demoMode = false;
  state = null;
  currentMeta = null;
  workspaceReady = false;
  isDirty = false;
  resetContext();
  showWelcomeScreen();
}

function openNewProjectChooser({ fromWorkspace = false } = {}) {
  openModal(`
    <div class="modal-title">Novo projeto</div>
    <p class="confirm-body">Como você quer começar? Em qualquer caso, o projeto é salvo automaticamente neste dispositivo.</p>
    <div class="choice-grid">
      <button type="button" class="choice-card primary" id="chooseDed"><span><strong>Importar do DED+ <em class="choice-tag">mais rápido</em></strong><small>Selecione um ou vários PDFs de lista nominal. O projeto já nasce com escola, turmas, componentes e alunos.</small></span></button>
      <button type="button" class="choice-card" id="chooseBlank"><span><strong>Projeto em branco</strong><small>Informe seu nome e o nome do projeto e cadastre turmas e alunos manualmente.</small></span></button>
      <button type="button" class="choice-card" id="chooseImport"><span><strong>Abrir um arquivo .prg</strong><small>Importe um projeto exportado antes, de outro aparelho ou de um backup.</small></span></button>
    </div>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button></div>
  `);
  document.getElementById('chooseDed')?.addEventListener('click', () => { closeModal(); openDedImportModal({ newProject: true }); });
  document.getElementById('chooseBlank')?.addEventListener('click', () => { closeModal(); beginNewProjectSetup(fromWorkspace); });
  document.getElementById('chooseImport')?.addEventListener('click', () => { closeModal(); pickPrgFile(); });
}

function runStartAction(key) {
  if (key === 'ded') openDedImportModal({ newProject: true });
  else if (key === 'blank') beginNewProjectSetup(false);
  else if (key === 'import') pickPrgFile();
  else if (key === 'demo') beginDemoMode();
}

function beginNewProjectSetup(fromWorkspace = false) {
  setupOrigin = fromWorkspace ? 'workspace' : 'welcome';
  if (fromWorkspace && isDirty) flushLocalSave().catch(() => {});
  hideSetupScreen();
  showSetupScreen(setupOrigin);
}

async function finishNewProjectSetup() {
  const teacher = document.getElementById('setupTeacherName')?.value.trim();
  if (!teacher) { document.getElementById('setupTeacherName')?.focus(); return; }
  const projectName = normalizeProjectName(document.getElementById('setupProjectName')?.value) || `Projeto de ${teacher}`;
  const fresh = emptyProjectData();
  fresh.teacher = { name: teacher };
  fresh.name = projectName;
  try {
    const meta = await createProjectFromState(fresh);
    await openProject(meta.projectId, { interactive: false });
    toast('Projeto criado. Ele já está salvo neste dispositivo.', 'success');
  } catch (err) {
    logError('project.create_failed', err);
    toast('Não foi possível criar o projeto neste dispositivo.', 'error');
  }
}

function cancelNewProjectSetup() {
  if (setupOrigin === 'workspace' && workspaceReady && state) { hideSetupScreen(); return; }
  showWelcomeScreen();
}

/* ---------- backups (por projeto) ---------- */

async function openBackupsModal(projectId = state?.projectId) {
  if (!projectId) return;
  if (state?.projectId === projectId && isDirty) await flushLocalSave();
  const meta = (await projectStore.getProjectMeta(projectId)) || currentMeta;
  const backups = await projectStore.listBackups(projectId);
  const isOpen = state?.projectId === projectId && workspaceReady;
  openModal(`
    <div class="modal-title">Cópias de segurança</div>
    <p class="confirm-body">Versões anteriores de <strong>${esc(meta?.name || 'este projeto')}</strong>, guardadas neste dispositivo. Cada projeto tem as suas próprias cópias (até ${MAX_BACKUPS_PER_PROJECT}).</p>
    <div class="backup-toolbar">
      <span>${backups.length ? plural(backups.length, 'cópia disponível', 'cópias disponíveis') : 'Nenhuma cópia armazenada'}</span>
      <span>
        <button type="button" class="btn-ghost btn-sm" id="btnCreateBackupNow">Criar cópia agora</button>
        ${backups.length ? '<button type="button" class="btn-ghost btn-sm danger" id="btnClearBackupsModal">Limpar cópias</button>' : ''}
      </span>
    </div>
    <div class="backup-list">
      ${backups.length ? backups.map(b => `<div class="backup-item">
          <div><strong>${esc(b.reason || 'Cópia automática')}</strong><span>${esc(formatRecoveryTime(b.savedAt))} · ${plural(b.summary?.classCount || 0, 'turma', 'turmas')} · ${plural(b.summary?.studentCount || 0, 'aluno', 'alunos')}</span></div>
          <button type="button" class="btn-secondary btn-sm" data-restore-backup="${esc(b.backupId)}">Restaurar</button>
        </div>`).join('') : emptyState('Ainda não há cópias de segurança.', 'Elas são criadas automaticamente enquanto você trabalha e antes de ações importantes.')}
    </div>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Fechar</button></div>
  `);
  qAll('[data-restore-backup]').forEach(button => {
    button.onclick = () => confirmRestoreBackup(projectId, button.dataset.restoreBackup);
  });
  onClick('#btnCreateBackupNow', async () => {
    const id = await projectStore.createBackup(projectId, 'Cópia manual');
    toast(id ? 'Cópia de segurança criada.' : 'Não foi possível criar a cópia.', id ? 'success' : 'error');
    openBackupsModal(projectId);
  });
  onClick('#btnClearBackupsModal', () => confirmModal({
    title: `Limpar ${plural(backups.length, 'cópia', 'cópias')} deste projeto?`,
    body: 'Apenas as cópias de segurança deste projeto serão removidas. O projeto, os arquivos .prg exportados e o Google Drive não serão alterados.',
    confirmLabel: 'Limpar cópias', danger: true,
    onConfirm: async () => { await projectStore.clearBackups(projectId); toast('As cópias deste projeto foram removidas.', 'success'); },
  }));
}

function confirmRestoreBackup(projectId, backupId) {
  confirmModal({
    title: 'Restaurar esta cópia?',
    body: 'O conteúdo atual do projeto será substituído pela cópia escolhida. Antes disso, o estado atual é guardado como uma nova cópia de segurança.',
    confirmLabel: 'Restaurar', danger: true,
    onConfirm: async () => {
      try {
        if (state?.projectId === projectId && isDirty) await flushLocalSave();
        await projectStore.restoreBackup(projectId, backupId);
        await discardRecoveryFor(projectId);
        if (state?.projectId === projectId && workspaceReady) { await reloadOpenProject(); navigate('dashboard'); }
        await refreshProjectsUI();
        toast('Cópia restaurada. O estado anterior ficou guardado nas cópias de segurança.', 'success');
      } catch (err) {
        logError('backup.restore_failed', err);
        toast('Essa cópia não pôde ser restaurada.', 'error');
      }
    },
  });
}

/* ---------- importar / exportar ".prg" ---------- */

function pickPrgFile() { document.getElementById('prgImportInput')?.click(); }

async function handlePrgImportInput(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  await importPrgFile(file);
}

async function importPrgFile(file) {
  let parsed;
  try { parsed = await withAppLoading('Lendo o arquivo .prg...', () => readPrgFile(file)); }
  catch (err) { logError('import.read_failed', err); showFileErrorModal('Não foi possível ler o arquivo selecionado.'); return; }
  if (!parsed.ok) { showFileErrorModal(parsed.message); return; }
  const inspect = await projectStore.inspectImport(parsed.data);
  if (!inspect.collision) { await finishPrgImport(parsed, IMPORT_MODES.NEW); return; }
  openImportCollisionModal(parsed, inspect.existing);
}

function openImportCollisionModal(parsed, existing) {
  const incoming = summarizeProject(parsed.data);
  openModal(`
    <div class="confirm-icon info">${ICONS.alert}</div>
    <div class="modal-title">Este projeto já existe neste dispositivo</div>
    <p class="confirm-body">O arquivo tem o mesmo identificador de um projeto que você já possui. Nada será sobrescrito sem a sua escolha.</p>
    <ul class="confirm-detail-list">
      <li><span>Neste dispositivo</span><strong>${esc(existing.name)} · ${plural(existing.classCount || 0, 'turma', 'turmas')} · ${plural(existing.studentCount || 0, 'aluno', 'alunos')} · atualizado ${esc(formatRecoveryTime(existing.updatedAt))}</strong></li>
      <li><span>No arquivo</span><strong>${esc(incoming.name)} · ${plural(incoming.classCount, 'turma', 'turmas')} · ${plural(incoming.studentCount, 'aluno', 'alunos')} · atualizado ${esc(formatRecoveryTime(parsed.data.updatedAt))}</strong></li>
    </ul>
    <div class="choice-grid">
      <button type="button" class="choice-card primary" id="importAsCopy"><span><strong>Importar como cópia</strong><small>Cria um novo projeto com novo identificador, chamado “${esc(incoming.name)} (cópia)”. Não herda o vínculo com o Google Drive.</small></span></button>
      <button type="button" class="choice-card" id="importReplace"><span><strong>Substituir projeto existente</strong><small>O projeto atual é trocado pelo conteúdo do arquivo. Uma cópia de segurança do atual é criada antes.</small></span></button>
    </div>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button></div>
  `);
  document.getElementById('importAsCopy')?.addEventListener('click', () => { closeModal(); finishPrgImport(parsed, IMPORT_MODES.COPY); });
  document.getElementById('importReplace')?.addEventListener('click', () => {
    closeModal();
    confirmModal({
      title: 'Substituir o projeto existente?',
      body: `“${existing.name}” será substituído pelo conteúdo do arquivo. Uma cópia de segurança do projeto atual será criada antes.`,
      confirmLabel: 'Substituir', danger: true,
      onConfirm: () => finishPrgImport(parsed, IMPORT_MODES.REPLACE),
    });
  });
}

async function finishPrgImport(parsed, mode) {
  try {
    if (mode === IMPORT_MODES.REPLACE && state?.projectId === parsed.data.projectId && workspaceReady) { await flushLocalSave(); }
    const result = await projectStore.importProject(parsed.data, { mode });
    clearRecoveryFallback(result.projectId);
    if (mode === IMPORT_MODES.REPLACE) { await discardRecoveryFor(result.projectId); if (state?.projectId === result.projectId && workspaceReady) await reloadOpenProject(); }
    await refreshProjectsUI();
    const name = (await projectStore.getProjectMeta(result.projectId))?.name || 'Projeto';
    const warn = parsed.warnings?.length ? ` ${plural(parsed.warnings.length, 'problema foi encontrado no arquivo e corrigido', 'problemas foram encontrados no arquivo e corrigidos')}.` : '';
    const how = mode === IMPORT_MODES.COPY ? `Importado como cópia: “${name}”.` : (mode === IMPORT_MODES.REPLACE ? `Projeto “${name}” substituído.` : `Projeto “${name}” importado.`);
    toast(how + warn, 'success');
    document.querySelector('[data-project-card="' + CSS.escape(result.projectId) + '"]')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  } catch (err) {
    logError('import.failed', err);
    if (err?.code === 'PROJECT_ID_COLLISION') { const existing = await projectStore.getProjectMeta(parsed.data.projectId); openImportCollisionModal(parsed, existing); return; }
    toast('Não foi possível importar o projeto.', 'error');
  }
}

/** Exporta uma cópia .prg do estado atual do projeto. Não altera o projeto local. */
async function exportProject(projectId, { share = false } = {}) {
  if (demoMode) { toast('A demonstração não pode ser exportada.', 'info'); return false; }
  try {
    let payload;
    if (state?.projectId === projectId && workspaceReady) {
      payload = buildSavePayload();
      flushLocalSave().catch(() => {});
    } else {
      payload = (await projectStore.getProject(projectId))?.state;
    }
    if (!payload) { toast('Projeto não encontrado.', 'error'); return false; }
    const result = await exportProjectPrg(payload, { share });
    if (!result.ok) {
      toast('O compartilhamento de arquivos não está disponível neste navegador. Use Exportar .prg.', 'info');
      return false;
    }
    toast(share ? 'Arquivo .prg compartilhado.' : `Arquivo ${result.filename} gerado. O projeto continua salvo neste dispositivo.`, 'success');
    return true;
  } catch (err) {
    logError('export.failed', err, { projectId });
    toast(err?.message || 'Não foi possível exportar o projeto.', 'error');
    return false;
  }
}

/* ---------- ações por projeto ---------- */

function entryFor(projectId) {
  return mergeProjectLists(projectsCache, driveListing.files).find(e => e.projectId === projectId && e.kind !== 'drive-only') || null;
}

async function openProjectActions(projectId) {
  const meta = await projectStore.getProjectMeta(projectId);
  if (!meta) return;
  const entry = entryFor(projectId);
  const link = meta.driveLink;
  const status = computeSyncStatus(meta, driveRemoteMeta[projectId] || entry?.remote || null, { syncing: driveSyncing.has(projectId), online: navigator.onLine, lastError: driveLastError[projectId] || null, authState: currentDriveAuthState() });
  const hasRecovery = recoveryIdsCache.has(projectId);
  const canLinkRemote = !link && !!entry?.remote;
  openModal(`
    <div class="modal-title">${esc(meta.name)}</div>
    <p class="confirm-body">${plural(meta.classCount || 0, 'turma', 'turmas')} · ${plural(meta.studentCount || 0, 'aluno', 'alunos')} · atualizado ${esc(formatRecoveryTime(meta.updatedAt))}<br><span class="project-sync tone-${statusTone(status)}"><span class="status-dot"></span>${esc(link ? syncLabel(status) : 'Salvo neste dispositivo')}</span></p>
    <div class="project-action-groups">
      <button type="button" class="btn-primary btn-block" data-pa="open">Abrir projeto</button>
      <section class="pa-group"><h4>Projeto</h4>
        <button type="button" class="btn-secondary" data-pa="rename">Renomear</button>
        <button type="button" class="btn-secondary" data-pa="backups">Cópias de segurança</button>
        ${hasRecovery ? '<button type="button" class="btn-secondary" data-pa="discard-recovery">Descartar recuperação</button>' : ''}
      </section>
      <section class="pa-group"><h4>Exportar</h4>
        <button type="button" class="btn-secondary" data-pa="export">Exportar .prg</button>
        ${supportsFileShare() ? '<button type="button" class="btn-secondary" data-pa="share">Compartilhar .prg</button>' : ''}
      </section>
      <section class="pa-group"><h4>Google Drive</h4>
        <button type="button" class="btn-secondary" data-pa="sync">${link ? 'Sincronizar agora' : 'Enviar ao Google Drive'}</button>
        ${canLinkRemote ? '<button type="button" class="btn-secondary" data-pa="link-remote">Vincular ao arquivo do Google Drive</button>' : ''}
        ${link ? '<button type="button" class="btn-ghost" data-pa="unlink">Desvincular</button><button type="button" class="btn-ghost danger" data-pa="trash">Mover arquivo para a lixeira do Drive</button>' : ''}
      </section>
      <section class="pa-group pa-danger"><h4>Remover</h4>
        <button type="button" class="btn-ghost danger" data-pa="delete">Excluir deste dispositivo</button>
        ${link ? '<button type="button" class="btn-ghost danger" data-pa="delete-both">Remover do dispositivo e do Drive</button>' : ''}
      </section>
    </div>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Fechar</button></div>
  `);
  const actions = {
    open: () => { closeModal(); openProject(projectId); },
    rename: () => { closeModal(); openRenameProjectModal(projectId); },
    export: () => { closeModal(); exportProject(projectId); },
    share: () => { closeModal(); exportProject(projectId, { share: true }); },
    backups: () => openBackupsModal(projectId),
    'discard-recovery': () => confirmModal({
      title: 'Descartar a recuperação?', body: 'As alterações protegidas de uma sessão interrompida serão removidas. A versão salva do projeto não muda.',
      confirmLabel: 'Descartar recuperação', danger: true,
      onConfirm: async () => { await discardRecoveryFor(projectId); await refreshProjectsUI(); toast('Recuperação descartada.', 'info'); },
    }),
    sync: () => { closeModal(); syncProjectNow(projectId); },
    'link-remote': () => { closeModal(); confirmLinkRemote(projectId, entry.remote); },
    unlink: () => { closeModal(); confirmUnlinkDrive(projectId); },
    trash: () => { closeModal(); confirmTrashOnDrive(projectId); },
    delete: () => { closeModal(); confirmDeleteLocalProject(projectId); },
    'delete-both': () => { closeModal(); confirmDeleteEverywhere(projectId); },
  };
  qAll('[data-pa]').forEach(button => {
    button.onclick = () => {
      if (button.dataset.pa === 'sync') { actions.sync(); return; }   // gesto do usuário preservado
      actions[button.dataset.pa]?.();
    };
  });
}

function openRenameProjectModal(projectId) {
  projectStore.getProjectMeta(projectId).then(meta => {
    if (!meta) return;
    openModal(`
      <div class="modal-title">Renomear projeto</div>
      <form id="renameProjectForm">
        <div class="form-group"><label class="form-label" for="renameProjectInput">Nome do projeto</label>
          <input class="form-input" id="renameProjectInput" maxlength="${PROJECT_NAME_MAX}" required value="${esc(meta.name)}"></div>
        <p class="form-hint">O nome do arquivo .prg exportado será “${esc(prgFileNameForProject(meta.name))}”, gerado a partir do nome do projeto.</p>
        <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="submit" class="btn-primary">Salvar nome</button></div>
      </form>`);
    document.getElementById('renameProjectForm').onsubmit = async event => {
      event.preventDefault();
      const name = normalizeProjectName(document.getElementById('renameProjectInput').value);
      if (!name) return;
      closeModal();
      if (state?.projectId === projectId && workspaceReady) { setProjectName(name); await flushLocalSave(); render(); }
      else await projectStore.renameProject(projectId, name);
      await refreshProjectsUI();
      toast('Projeto renomeado.', 'success');
    };
  });
}

function confirmDeleteLocalProject(projectId) {
  projectStore.getProjectMeta(projectId).then(meta => {
    if (!meta) return;
    confirmModal({
      title: 'Excluir este projeto do dispositivo?',
      body: `“${meta.name}” será removido deste dispositivo, junto com as cópias de segurança e a recuperação dele.${meta.driveLink ? ' O arquivo no Google Drive não será apagado.' : ''}`,
      detailList: [
        ['Será removido', 'Projeto, cópias de segurança e recuperação deste projeto'],
        ['Não será removido', meta.driveLink ? 'O arquivo no Google Drive e arquivos .prg exportados' : 'Arquivos .prg que você exportou'],
        ['Importante', 'Depois disso, só será possível recuperar importando um .prg ou o arquivo do Drive'],
      ],
      confirmLabel: 'Excluir do dispositivo', danger: true,
      onConfirm: async () => {
        await deleteLocalProjectEverywhereLocal(projectId);
        toast('Projeto removido deste dispositivo.', 'success');
      },
    });
  });
}

async function deleteLocalProjectEverywhereLocal(projectId) {
  if (state?.projectId === projectId) {
    clearTimeout(saveTimer); clearTimeout(recoveryTimer); clearTimeout(driveAutoSyncTimer);
    if (saveInFlight) { try { await saveInFlight; } catch (_) {} }
    state = null; currentMeta = null; workspaceReady = false; isDirty = false; resetContext();
  }
  await projectStore.deleteProject(projectId);
  clearRecoveryFallback(projectId);
  recoveryIdsCache.delete(projectId);
  delete driveRemoteMeta[projectId]; delete driveLastError[projectId];
  if (!workspaceReady) await showWelcomeScreen({ withLoading: false });
}

function confirmDeleteEverywhere(projectId) {
  projectStore.getProjectMeta(projectId).then(meta => {
    if (!meta?.driveLink) return;
    confirmModal({
      title: 'Remover do dispositivo e do Google Drive?',
      body: `Esta ação atinge dois lugares. O arquivo do Google Drive vai para a lixeira e “${meta.name}” é removido deste dispositivo, com cópias de segurança e recuperação.`,
      detailList: [['Neste dispositivo', 'Projeto, cópias de segurança e recuperação serão removidos'], ['No Google Drive', `${meta.driveLink.fileName || 'O arquivo do projeto'} será movido para a lixeira`], ['Se o Drive falhar', 'O projeto local NÃO será apagado']],
      confirmLabel: 'Remover dos dois lugares', danger: true,
      onConfirm: () => runDriveAction(async api => {
        const res = await removeFromDeviceAndDrive(projectStore, api, projectId, { online: navigator.onLine });
        if (!res.ok) { toast(driveFailureMessage(res), 'error'); return; }
        await deleteLocalProjectEverywhereLocal(projectId);
        toast('Projeto removido do dispositivo e do Google Drive.', 'success');
      }, { fromUser: true }),
    });
  });
}

function confirmUnlinkDrive(projectId) {
  confirmModal({
    title: 'Desvincular do Google Drive?',
    body: 'Só o vínculo será removido. O arquivo continua no Google Drive e o projeto continua neste dispositivo. As próximas alterações não serão sincronizadas.',
    confirmLabel: 'Desvincular',
    onConfirm: async () => {
      await unlinkProjectFromDrive(projectStore, projectId);
      delete driveRemoteMeta[projectId]; delete driveLastError[projectId];
      if (state?.projectId === projectId) currentMeta = await projectStore.getProjectMeta(projectId);
      await refreshProjectsUI(); refreshDriveStatusUI();
      toast('Projeto desvinculado do Google Drive.', 'info');
    },
  });
}

function confirmTrashOnDrive(projectId) {
  projectStore.getProjectMeta(projectId).then(meta => {
    if (!meta?.driveLink) return;
    confirmModal({
      title: 'Mover o arquivo do Drive para a lixeira?',
      body: `${meta.driveLink.fileName || 'O arquivo'} será movido para a lixeira do Google Drive e o vínculo será removido. A versão neste dispositivo continuará existindo.`,
      confirmLabel: 'Mover para a lixeira', danger: true,
      onConfirm: () => runDriveAction(async api => {
        const res = await trashProjectOnDrive(projectStore, api, projectId, { online: navigator.onLine });
        if (!res.ok) { toast(driveFailureMessage(res), 'error'); return; }
        delete driveRemoteMeta[projectId];
        if (state?.projectId === projectId) currentMeta = await projectStore.getProjectMeta(projectId);
        await refreshProjectsUI(); refreshDriveStatusUI();
        toast('Arquivo movido para a lixeira do Google Drive. O projeto continua neste dispositivo.', 'success');
      }, { fromUser: true }),
    });
  });
}

function confirmLinkRemote(projectId, remote) {
  confirmModal({
    title: 'Vincular ao arquivo do Google Drive?',
    body: `“${remote.name}” tem o mesmo identificador deste projeto. Depois de vincular, a próxima sincronização compara as duas versões e pede a sua escolha se forem diferentes.`,
    confirmLabel: 'Vincular',
    onConfirm: async () => {
      await projectStore.setDriveLink(projectId, { fileId: remote.id, fileName: remote.name, remoteModifiedTime: remote.modifiedTime, accountEmail: driveAccount?.email, accountPermissionId: driveAccount?.permissionId });
      await refreshProjectsUI();
      toast('Projeto vinculado. Use “Sincronizar agora”.', 'info');
    },
  });
}

function driveFailureMessage(res) {
  if (res?.reason === 'cannot-trash') return 'Sua conta não tem permissão para mover este arquivo para a lixeira do Google Drive.';
  switch (res?.error) {
    case 'offline': return 'Sem conexão com o Google Drive. Nada foi apagado neste dispositivo.';
    case 'auth': return 'Reconecte o Google Drive e tente novamente.';
    case 'forbidden': return 'O Google Drive recusou a operação (sem permissão). Nada foi apagado neste dispositivo.';
    default: return res?.message || 'Não foi possível concluir a operação no Google Drive.';
  }
}

/* ---------- Google Drive: sincronização por projeto ---------- */

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function driveHttp({ silent = false } = {}) {
  const getAccessToken = silent
    ? async () => { if (!hasValidDriveToken()) throw new DriveError('auth', 'A autorização do Google Drive precisa ser renovada.'); return driveAccessToken; }
    : getDriveAccessToken;
  const invalidateToken = () => { driveAccessToken = null; driveTokenExpiresAt = 0; };
  return {
    json: (url, options = {}) => driveHttpJson(url, { getAccessToken, invalidateToken, options }),
    text: (url, options = {}) => driveHttpText(url, { getAccessToken, invalidateToken, options }),
  };
}

function refreshDriveStatusUI() {
  updateSaveChrome();
  if (state && workspaceReady) { try { render(); } catch (_) {} }
  if (!workspaceReady) refreshProjectsUI({ reload: false }).catch(() => {});
}

/** Executa uma tarefa de Drive. A primeira chamada de token acontece no gesto do usuário. */
async function runDriveAction(task, { fromUser = true } = {}) {
  if (!isGoogleDriveConfigured()) { if (fromUser) showDriveNotConfigured(); return null; }
  const tokenPromise = fromUser && !hasValidDriveToken() ? getDriveAccessToken({ forceConsent: false }) : null;
  setDriveActionUI(true);
  try {
    if (tokenPromise) { await tokenPromise; driveNeedsInteraction = false; await refreshDriveAccountProfile(); }
    else if (!hasValidDriveToken()) throw new DriveError('auth', 'A autorização do Google Drive precisa ser renovada.');
    return await task(createDriveApi(driveHttp({ silent: !fromUser })));
  } catch (err) {
    const kind = classifyDriveError(err, { online: navigator.onLine });
    if (kind === 'auth') driveNeedsInteraction = true;
    if (fromUser && !isDriveAuthCancellationError(err)) toast(driveFailureMessage({ error: kind, message: err?.message }), 'error');
    return null;
  } finally {
    setDriveActionUI(false);
    refreshAccountUI();
  }
}

function scheduleDriveAutoSync() {
  clearTimeout(driveAutoSyncTimer);
  if (demoMode || !state?.projectId || !currentDriveLink() || !hasValidDriveToken()) return;
  const projectId = state.projectId;
  driveAutoSyncTimer = setTimeout(() => {
    if (state?.projectId === projectId && !isDirty && isDrivePending(currentMeta)) syncProjectNow(projectId, { fromUser: false }).catch(() => {});
  }, 15000);
}

/**
 * Sincroniza AGORA. A falha do Drive nunca impede nem desfaz o salvamento local.
 * Sem interação possível (fromUser=false) não abre popup: o projeto fica "precisando de atenção".
 */
async function syncProjectNow(projectId, { fromUser = true } = {}) {
  if (demoMode || !projectId || driveSyncing.has(projectId)) return null;
  if (!isGoogleDriveConfigured()) { if (fromUser) showDriveNotConfigured(); return null; }
  const tokenPromise = fromUser && !hasValidDriveToken() ? getDriveAccessToken({ forceConsent: false }) : null; // 1º: preserva o gesto
  driveSyncing.add(projectId);
  setDriveActionUI(true);
  refreshDriveStatusUI();
  let result = null;
  try {
    if (tokenPromise) { await tokenPromise; driveNeedsInteraction = false; await refreshDriveAccountProfile(); }
    else if (!hasValidDriveToken()) {
      driveLastError[projectId] = 'auth'; driveNeedsInteraction = true;
      if (fromUser) toast('Reconecte o Google Drive para sincronizar.', 'info');
      return null;
    }
    if (state?.projectId === projectId && isDirty) await flushLocalSave();
    const api = createDriveApi(driveHttp({ silent: !fromUser }));
    result = await syncProject(projectStore, api, projectId, { account: driveAccount, online: navigator.onLine });
    if (result.error) {
      driveLastError[projectId] = result.error;
      if (result.error === 'auth') driveNeedsInteraction = true;
      if (fromUser) toast(driveFailureMessage(result), result.error === 'offline' ? 'info' : 'error');
    } else {
      delete driveLastError[projectId];
    }
    if (result.remote) driveRemoteMeta[projectId] = result.remote;
    await handleSyncResult(projectId, result, { fromUser });
  } catch (err) {
    const kind = classifyDriveError(err, { online: navigator.onLine });
    driveLastError[projectId] = kind;
    if (kind === 'auth') driveNeedsInteraction = true;
    if (fromUser && !isDriveAuthCancellationError(err)) toast(driveFailureMessage({ error: kind, message: err?.message }), 'error');
  } finally {
    driveSyncing.delete(projectId);
    setDriveActionUI(false);
    if (state?.projectId === projectId) currentMeta = (await projectStore.getProjectMeta(projectId)) || currentMeta;
    projectsCache = await projectStore.listProjects().catch(() => projectsCache);
    refreshDriveStatusUI();
    refreshAccountUI();
  }
  return result;
}

async function handleSyncResult(projectId, result, { fromUser }) {
  switch (result.status) {
    case SYNC_STATUS.SYNCED:
      if (fromUser) toast(result.created ? 'Projeto enviado ao Google Drive.' : 'Sincronizado com o Google Drive.', 'success');
      break;
    case SYNC_STATUS.PENDING:
      if (fromUser && result.uploaded) toast('Sincronizado. Há alterações novas que serão enviadas na próxima sincronização.', 'info');
      break;
    case SYNC_STATUS.CONFLICT:
      if (fromUser) await showSyncConflictModal(projectId, result.remote);
      break;
    case SYNC_STATUS.REMOTE_NEWER: {
      const pulled = await pullRemoteIfNewer(projectStore, createDriveApi(driveHttp({ silent: !fromUser })), projectId, { online: navigator.onLine });
      if (pulled.ok) {
        delete driveRemoteMeta[projectId];
        if (state?.projectId === projectId && workspaceReady) await reloadOpenProject();
        toast('Havia uma versão mais nova no Google Drive. Ela foi aplicada e a versão anterior ficou nas cópias de segurança.', 'info');
      }
      break;
    }
    case SYNC_STATUS.REMOTE_MISSING:
      if (fromUser) showRemoteMissingModal(projectId);
      break;
    case SYNC_STATUS.RECONNECT:
      if (result.reason === 'account-mismatch' && fromUser) showAccountMismatchModal(projectId);
      break;
    default: break;
  }
}

async function showSyncConflictModal(projectId, remote) {
  const meta = await projectStore.getProjectMeta(projectId);
  if (!meta) return;
  openModal(`
    <div class="confirm-icon danger">${ICONS.alert}</div>
    <div class="modal-title">Há uma versão diferente no Google Drive</div>
    <p class="confirm-body">“${esc(meta.name)}” foi alterado neste dispositivo e também no Google Drive. Escolha qual versão deve continuar. A outra versão será guardada nas cópias de segurança quando for substituída aqui.</p>
    <ul class="confirm-detail-list">
      <li><span>Neste dispositivo</span><strong>${esc(formatRecoveryTime(meta.updatedAt))} · ${plural(meta.classCount || 0, 'turma', 'turmas')} · ${plural(meta.studentCount || 0, 'aluno', 'alunos')}</strong></li>
      <li><span>No Google Drive</span><strong>${esc(formatRecoveryTime(remote?.modifiedTime))} · ${esc(remote?.name || 'arquivo do projeto')}</strong></li>
    </ul>
    <div class="form-actions form-actions-wrap-mobile">
      <button type="button" class="btn-secondary" id="conflictUseRemote">Usar versão do Google Drive</button>
      <button type="button" class="btn-primary" id="conflictKeepLocal">Manter versão deste dispositivo</button>
    </div>
    <div class="form-actions"><button type="button" class="btn-ghost" id="modalCancel">Decidir depois</button></div>
  `, false);
  document.getElementById('conflictKeepLocal')?.addEventListener('click', () => {
    closeModal();
    runDriveAction(async api => {
      if (state?.projectId === projectId && isDirty) await flushLocalSave();
      const res = await resolveConflictKeepLocal(projectStore, api, projectId, { account: driveAccount, online: navigator.onLine });
      if (res.error) { toast(driveFailureMessage(res), 'error'); return; }
      if (res.remote) driveRemoteMeta[projectId] = res.remote;
      toast('Versão deste dispositivo mantida e enviada ao Google Drive.', 'success');
      await afterDriveResolution(projectId);
    });
  });
  document.getElementById('conflictUseRemote')?.addEventListener('click', () => {
    closeModal();
    runDriveAction(async api => {
      if (state?.projectId === projectId && isDirty) await flushLocalSave();
      const res = await resolveConflictUseRemote(projectStore, api, projectId, { online: navigator.onLine });
      if (!res.ok) { toast(driveFailureMessage(res), 'error'); return; }
      delete driveRemoteMeta[projectId];
      if (state?.projectId === projectId && workspaceReady) await reloadOpenProject();
      toast('Versão do Google Drive aplicada. A versão deste dispositivo ficou nas cópias de segurança.', 'success');
      await afterDriveResolution(projectId);
    });
  });
}

async function afterDriveResolution(projectId) {
  delete driveLastError[projectId];
  if (state?.projectId === projectId) currentMeta = await projectStore.getProjectMeta(projectId);
  projectsCache = await projectStore.listProjects();
  refreshDriveStatusUI();
}

function showRemoteMissingModal(projectId) {
  openModal(`
    <div class="confirm-icon info">${ICONS.cloud}</div>
    <div class="modal-title">O arquivo não está mais no Google Drive</div>
    <p class="confirm-body">O arquivo vinculado a este projeto foi removido ou não está mais acessível. O projeto continua salvo neste dispositivo.</p>
    <div class="form-actions form-actions-wrap-mobile">
      <button type="button" class="btn-secondary" id="modalCancel">Continuar neste dispositivo</button>
      <button type="button" class="btn-primary" id="remoteMissingRecreate">Criar novo arquivo no Drive</button>
    </div>
  `, false);
  document.getElementById('remoteMissingRecreate')?.addEventListener('click', async () => {
    closeModal();
    await unlinkProjectFromDrive(projectStore, projectId);
    delete driveRemoteMeta[projectId];
    syncProjectNow(projectId);
  });
}

function showAccountMismatchModal(projectId) {
  openModal(`
    <div class="modal-title">Este projeto está vinculado a outra conta</div>
    <p class="confirm-body">O arquivo deste projeto no Google Drive pertence a outra conta. Para não criar uma cópia sem intenção, nada foi enviado.</p>
    <div class="form-actions form-actions-wrap-mobile">
      <button type="button" class="btn-secondary" id="mismatchSwitch">Trocar de conta</button>
      <button type="button" class="btn-primary" id="mismatchRelink">Criar novo vínculo com esta conta</button>
    </div>
    <div class="form-actions"><button type="button" class="btn-ghost" id="modalCancel">Cancelar</button></div>
  `, false);
  document.getElementById('mismatchSwitch')?.addEventListener('click', () => { closeModal(); switchDriveAccount(); });
  document.getElementById('mismatchRelink')?.addEventListener('click', async () => {
    closeModal();
    await unlinkProjectFromDrive(projectStore, projectId);
    syncProjectNow(projectId);
  });
}

/* ---------- Google Drive: descoberta de projetos ---------- */

async function refreshDriveProjects({ fromUser = true } = {}) {
  if (!isGoogleDriveConfigured()) { if (fromUser) showDriveNotConfigured(); return; }
  if (driveListing.status === 'loading') return;
  const tokenPromise = fromUser && !hasValidDriveToken() ? getDriveAccessToken({ forceConsent: false }) : null;
  driveListing = { ...driveListing, status: 'loading', message: 'Atualizando a lista do Google Drive…', tone: 'info' };
  renderCloudPanel();
  refreshProjectsUI({ reload: false }).catch(() => {});
  const fail = (reason, message) => {
    const texts = {
      offline: 'Você está sem conexão. Os projetos deste dispositivo continuam disponíveis.',
      auth: 'Reconecte o Google Drive para atualizar a lista.',
      forbidden: 'O Google Drive recusou o acesso à lista (sem permissão).',
    };
    if (reason === 'auth') driveNeedsInteraction = true;
    driveListing = { ...driveListing, status: 'error', message: texts[reason] || message || 'Não foi possível atualizar a lista do Google Drive.', tone: reason === 'offline' ? 'neutral' : 'warn' };
    renderCloudPanel();
    refreshProjectsUI({ reload: false }).catch(() => {});
  };
  try {
    if (tokenPromise) { await tokenPromise; driveNeedsInteraction = false; await refreshDriveAccountProfile(); }
    else if (!hasValidDriveToken()) { fail('auth'); return; }
  } catch (err) {
    fail(isDriveAuthCancellationError(err) ? 'auth' : classifyDriveError(err, { online: navigator.onLine }), err?.message);
    return;
  }
  const api = createDriveApi(driveHttp({ silent: !fromUser }));
  const found = await discoverDriveProjects(api, { online: navigator.onLine });
  if (!found.ok) { fail(found.reason, found.message); return; }
  driveListing = {
    files: found.files, status: 'ready', at: Date.now(), tone: 'neutral',
    message: found.truncated ? 'Mostrando apenas os primeiros projetos encontrados no Google Drive.' : '',
  };
  projectsCache = await projectStore.listProjects();
  for (const meta of projectsCache) {
    if (!meta.driveLink) continue;
    const remote = found.files.find(f => f.id === meta.driveLink.fileId);
    if (remote) { driveRemoteMeta[meta.projectId] = remote; delete driveLastError[meta.projectId]; }
  }
  // Arquivo removido: confirma individualmente antes de marcar (nunca por ausência na lista).
  if (!found.truncated) {
    for (const meta of projectsCache.filter(m => m.driveLink && !m.driveLink.remoteMissing && !found.files.some(f => f.id === m.driveLink.fileId)).slice(0, 10)) {
      try {
        const remote = await api.getMeta(meta.driveLink.fileId);
        if (remote.trashed) await projectStore.markRemoteMissing(meta.projectId); else driveRemoteMeta[meta.projectId] = remote;
      } catch (err) {
        if (classifyDriveError(err) === 'notfound') await projectStore.markRemoteMissing(meta.projectId).catch(() => {});
      }
    }
    projectsCache = await projectStore.listProjects();
  }
  renderCloudPanel();
  await refreshProjectsUI({ reload: false });
  // Projetos já autorizados com pendências sincronizam sozinhos, sem popup.
  for (const meta of projectsCache.filter(m => isDrivePending(m) && !m.driveLink.remoteMissing)) {
    if (!hasValidDriveToken()) break;
    if (!isRemoteNewer(meta.driveLink, driveRemoteMeta[meta.projectId]?.modifiedTime)) await syncProjectNow(meta.projectId, { fromUser: false });
  }
}

function openCollisionModal({ existing, incoming, onCopy, onReplace }) {
  openModal(`
    <div class="confirm-icon info">${ICONS.alert}</div>
    <div class="modal-title">Este projeto já existe neste dispositivo</div>
    <p class="confirm-body">O projeto que você está adicionando tem o mesmo identificador de um projeto local. Nada será sobrescrito sem a sua escolha.</p>
    <ul class="confirm-detail-list">
      <li><span>Neste dispositivo</span><strong>${esc(existing?.name || 'Projeto')} · ${plural(existing?.classCount || 0, 'turma', 'turmas')} · ${plural(existing?.studentCount || 0, 'aluno', 'alunos')} · atualizado ${esc(formatRecoveryTime(existing?.updatedAt))}</strong></li>
      <li><span>Novo</span><strong>${esc(incoming.name)}${incoming.classCount != null ? ` · ${plural(incoming.classCount, 'turma', 'turmas')} · ${plural(incoming.studentCount, 'aluno', 'alunos')}` : ''}${incoming.updatedAt ? ` · atualizado ${esc(formatRecoveryTime(incoming.updatedAt))}` : ''}</strong></li>
    </ul>
    <div class="choice-grid">
      <button type="button" class="choice-card primary" id="collisionCopy"><span><strong>Importar como cópia</strong><small>Cria um novo projeto com novo identificador, chamado “${esc(incoming.name)} (cópia)”. Não herda o vínculo com o Google Drive.</small></span></button>
      <button type="button" class="choice-card" id="collisionReplace"><span><strong>Substituir projeto existente</strong><small>O projeto local é trocado por esta versão. Uma cópia de segurança do atual é criada antes.</small></span></button>
    </div>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button></div>
  `);
  document.getElementById('collisionCopy')?.addEventListener('click', () => { closeModal(); onCopy(); });
  document.getElementById('collisionReplace')?.addEventListener('click', () => {
    closeModal();
    confirmModal({
      title: 'Substituir o projeto existente?',
      body: `“${existing?.name || 'O projeto local'}” será substituído. Uma cópia de segurança do projeto atual será criada antes.`,
      confirmLabel: 'Substituir', danger: true, onConfirm: onReplace,
    });
  });
}

async function addDriveProjectToDeviceUI(fileId, mode = IMPORT_MODES.NEW) {
  await runDriveAction(async api => {
    const res = await addDriveProjectToDevice(projectStore, api, fileId, { account: driveAccount, mode, online: navigator.onLine });
    if (res.collision) {
      openCollisionModal({
        existing: res.existing,
        incoming: { name: String(res.remote?.name || 'Projeto').replace(/\.prg$/i, ''), updatedAt: res.remote?.modifiedTime },
        onCopy: () => addDriveProjectToDeviceUI(fileId, IMPORT_MODES.COPY),
        onReplace: () => addDriveProjectToDeviceUI(fileId, IMPORT_MODES.REPLACE),
      });
      return;
    }
    if (!res.ok) { toast(res.message ? driveFailureMessage(res) : 'Não foi possível adicionar o projeto.', 'error'); return; }
    if (res.mode === IMPORT_MODES.REPLACE) { await discardRecoveryFor(res.projectId); if (state?.projectId === res.projectId && workspaceReady) await reloadOpenProject(); }
    clearRecoveryFallback(res.projectId);
    projectsCache = await projectStore.listProjects();
    await refreshProjectsUI({ reload: false });
    toast(res.mode === IMPORT_MODES.COPY ? 'Projeto adicionado como cópia a este dispositivo.' : 'Projeto adicionado a este dispositivo.', 'success');
  });
}

/* ---------- tela inicial: gerenciador de projetos ---------- */

function entryStatus(entry) {
  if (entry.kind === 'drive-only') return SYNC_STATUS.DRIVE_ONLY;
  return computeSyncStatus(entry.meta, driveRemoteMeta[entry.projectId] || entry.remote || null, {
    syncing: driveSyncing.has(entry.projectId), online: navigator.onLine,
    lastError: driveLastError[entry.projectId] || null, authState: currentDriveAuthState(),
  });
}

async function refreshProjectsUI({ reload = true } = {}) {
  const token = ++projectsRenderToken;
  if (reload) {
    try {
      projectsCache = await projectStore.listProjects();
      recoveryIdsCache = new Set(await projectStore.listRecoveryIds());
    } catch (err) { logError('projects.list_failed', err); }
  }
  if (token !== projectsRenderToken) return;
  const root = document.getElementById('projectsList');
  if (!root) return;
  const entries = mergeProjectLists(projectsCache, driveListing.files);
  root.innerHTML = projectsListHTML(entries, {
    esc, ICONS, formatTime: formatRecoveryTime, query: projectSearchQuery, driveListing,
    statusFor: entryStatus, recoveryIds: recoveryIdsCache, busy: driveActionPending,
  });
  const lead = document.getElementById('welcomeLead');
  if (lead) lead.textContent = projectsCache.length
    ? `${plural(projectsCache.length, 'projeto salvo', 'projetos salvos')} neste dispositivo. Clique em um projeto para continuar.`
    : 'Bem-vindo! Escolha abaixo como começar.';
  const actions = document.querySelector('.welcome-projects-actions');
  if (actions) actions.classList.toggle('is-quiet', !projectsCache.length);
  const demoBtn = document.getElementById('welcomeDemo');
  if (demoBtn) demoBtn.hidden = !projectsCache.length;   // no estado vazio a demonstração já está no painel
  root.querySelectorAll('[data-open-project]').forEach(b => { b.onclick = () => openProject(b.dataset.openProject); });
  root.querySelectorAll('[data-start]').forEach(b => { b.onclick = () => runStartAction(b.dataset.start); });
  const toolbar = document.getElementById('projectsToolbar');
  if (toolbar) toolbar.hidden = projectsCache.length < 5 && !projectSearchQuery;
  root.querySelectorAll('[data-project-actions]').forEach(b => { b.onclick = () => openProjectActions(b.dataset.projectActions); });
  root.querySelectorAll('[data-add-drive-project]').forEach(b => { b.onclick = () => addDriveProjectToDeviceUI(b.dataset.addDriveProject); });
  updateWelcomeDriveNote(entries);
}

function updateWelcomeDriveNote(entries) {
  const attention = entries.filter(e => e.kind !== 'drive-only' && needsAttention(entryStatus(e), { hasRecovery: recoveryIdsCache.has(e.projectId) })).length;
  const el = document.getElementById('welcomeAttention');
  if (el) { el.hidden = !attention; el.textContent = attention ? `${plural(attention, 'projeto precisa', 'projetos precisam')} de atenção` : ''; }
}

function renderCloudPanel() {
  const root = document.getElementById('cloudPanel');
  if (!root) return;
  const configured = isGoogleDriveConfigured();
  // Sem integração configurada não há o que o professor possa fazer aqui: não ocupe espaço.
  root.hidden = !configured;
  if (!configured) { root.innerHTML = ''; return; }
  const authState = currentDriveAuthState();
  const summary = cloudAccountSummary({ configured, account: driveAccount, authState });
  const loading = driveListing.status === 'loading';
  root.innerHTML = `
    <div class="cloud-panel-head">
      <div class="cloud-panel-account tone-${summary.tone}">
        ${driveAccount ? driveAccountAvatarHTML({ className: 'drive-account-avatar-lg' }) : `<span class="cloud-panel-icon" aria-hidden="true">${ICONS.cloud}</span>`}
        <div><strong>${esc(summary.title)}</strong><span>${esc(summary.meta)}</span></div>
      </div>
      <div class="cloud-panel-actions">
        ${configured ? `<button type="button" class="btn-secondary btn-sm" id="cloudRefresh" ${loading ? 'disabled aria-busy="true"' : ''}>${ICONS.refresh} ${loading ? 'Atualizando…' : 'Atualizar lista do Drive'}</button>
        <button type="button" class="btn-secondary btn-sm" id="cloudImport">${ICONS.folder} Importar do Google Drive</button>` : ''}
        <button type="button" class="btn-ghost btn-sm" id="cloudAccount">${driveAccount ? 'Gerenciar conta' : (configured ? 'Conectar conta' : 'Saiba mais')}</button>
      </div>
    </div>
    <p class="cloud-panel-hint">O Google Drive guarda uma cópia dos seus projetos para sincronizar entre dispositivos. Seu trabalho continua salvo neste dispositivo, com ou sem o Drive.</p>`;
  document.getElementById('cloudRefresh')?.addEventListener('click', () => refreshDriveProjects({ fromUser: true }));
  document.getElementById('cloudImport')?.addEventListener('click', () => openDrivePicker());
  document.getElementById('cloudAccount')?.addEventListener('click', () => {
    if (!configured) showDriveNotConfigured();
    else if (driveAccount) openDriveAccountSettings();
    else connectGoogleDriveAccount();
  });
}
function updateWelcomeAccountControl() { renderCloudPanel(); }

async function showWelcomeScreen({ withLoading = true } = {}) {
  clearPersistedRoute();
  const loadingStartedAt = withLoading ? beginAppLoading('Preparando seus projetos...') : null;
  try {
    workspaceReady = false;
    demoMode = false;
    currentMeta = null;
    document.body.classList.remove('workspace-active');
    document.getElementById('welcomeScreen')?.classList.remove('is-hidden');
    document.getElementById('setupScreen')?.classList.add('is-hidden');
    updateThemeToggle();
    renderCloudPanel();
    await refreshProjectsUI();
  } finally {
    if (loadingStartedAt !== null) await finishAppLoading(loadingStartedAt);
  }
}

/* ---------- dados deste dispositivo ---------- */

async function openLocalDataManager() {
  const metas = await projectStore.listProjects();
  const recoveryIds = await projectStore.listRecoveryIds();
  openModal(`
    <div class="modal-title">Dados deste dispositivo</div>
    <p class="confirm-body">Seus projetos ficam salvos neste navegador (IndexedDB). O <strong>.prg</strong> é um formato portátil para importar e exportar, e o Google Drive é uma cópia opcional na nuvem.</p>
    <section class="local-data-section">
      <div class="local-data-section-head"><div><strong>Projetos</strong><span>${plural(metas.length, 'projeto salvo', 'projetos salvos')} · sem limite de quantidade. Cópias de segurança e recuperação pertencem a cada projeto e são geridas nas ações do projeto.</span></div></div>
      ${recoveryIds.length ? `<div class="local-data-row"><div><strong>Recuperações pendentes</strong><span>${plural(recoveryIds.length, 'projeto tem', 'projetos têm')} alterações protegidas de uma sessão interrompida.</span></div></div>` : ''}
    </section>
    <section class="local-data-danger">
      <div><strong>Apagar todos os dados deste dispositivo</strong><span>Remove todos os projetos, cópias de segurança, recuperações, a conta Google lembrada, registros de suporte e preferências.</span></div>
      <button type="button" class="btn-danger-solid btn-sm" id="btnClearAllLocalData">Apagar tudo</button>
    </section>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Fechar</button></div>
  `);
  onClick('#btnClearAllLocalData', () => confirmModal({
    title: 'Apagar todos os dados deste dispositivo?',
    body: 'Todos os projetos salvos neste dispositivo serão removidos permanentemente, com cópias de segurança e recuperações. Arquivos .prg que você exportou e arquivos no Google Drive não são apagados.',
    detailList: [
      ['Será apagado', `${plural(metas.length, 'projeto', 'projetos')}, cópias de segurança, recuperações, conta Google lembrada, registros e preferências`],
      ['Não será apagado', 'Arquivos .prg exportados e arquivos no Google Drive'],
      ['Importante', 'Depois disso, só será possível recuperar importando um .prg ou o arquivo do Drive'],
    ],
    confirmLabel: 'Apagar todos os dados', danger: true,
    onConfirm: () => clearAllDataAndReturnToWelcome(),
  }));
}

async function clearAllDataAndReturnToWelcome() {
  try {
    clearTimeout(saveTimer); clearTimeout(recoveryTimer); clearTimeout(driveAutoSyncTimer);
    await projectStore.clearEverything();
    try { indexedDB.deleteDatabase(LEGACY_DB_NAME); } catch (_) {}
    try { Object.keys(localStorage).filter(k => k.startsWith('professorgest')).forEach(k => localStorage.removeItem(k)); } catch (_) {}
  } catch (err) {
    logError('data.clear_failed', err);
    toast('Não foi possível apagar todos os dados deste dispositivo. Tente novamente.', 'error');
    return false;
  }
  state = null; currentMeta = null; workspaceReady = false; demoMode = false; isDirty = false; dirtyRevision = 0;
  projectsCache = []; recoveryIdsCache = new Set(); driveListing = { files: [], status: 'idle', message: '', tone: 'neutral' };
  Object.keys(driveRemoteMeta).forEach(k => delete driveRemoteMeta[k]);
  Object.keys(driveLastError).forEach(k => delete driveLastError[k]);
  invalidateDriveSession({ forgetAccount: true, refreshUI: false });
  resetContext();
  applyThemeMode('light', false);
  await showWelcomeScreen();
  toast('Os dados do ProfessorGest neste dispositivo foram apagados.', 'info');
  return true;
}

/** Migra, uma única vez e sem apagar nada, o banco antigo (centrado em arquivo) para projetos. */
async function migrateLegacyData() {
  try {
    const out = await migrateLegacyIfNeeded(projectStore);
    // O vínculo antigo do Drive agora vive dentro do projeto.
    if (!out.error) { try { localStorage.removeItem('professorgest-drive-bindings-v3'); } catch (_) {} }
    try {
      const raw = localStorage.getItem('professorgest-recovery-fallback');
      if (raw) {
        const record = JSON.parse(raw);
        const pid = record?.state?.projectId;
        if (pid && record.state.format === PRG_FORMAT && await projectStore.getProjectMeta(pid)) await projectStore.writeRecovery(pid, record.state);
        localStorage.removeItem('professorgest-recovery-fallback');
      }
    } catch (_) {}
    return out;
  } catch (err) { logError('migration.failed', err); return null; }
}

/* ---------- DED+ aplicado ao projeto ---------- */

function ensureEnrollment(student, classId, imported = null) {
  state.enrollments = Array.isArray(state.enrollments) ? state.enrollments : [];
  student.enrollmentIds = Array.isArray(student.enrollmentIds) ? student.enrollmentIds : [];
  let enrollment = state.enrollments.find(e => e.studentId === student.id && e.classId === classId && e.active !== false);
  if (!enrollment) {
    enrollment = { id: uid('enroll'), studentId: student.id, classId, active: true, dedCode: imported?.dedCode || '', sourceName: imported?.sourceName || '' };
    state.enrollments.push(enrollment);
  }
  if (!student.enrollmentIds.includes(enrollment.id)) student.enrollmentIds.push(enrollment.id);
  student.classId = classId;
  return enrollment;
}

function openDedImportModal(options = {}) { openDedPicker({ newProject: !!options.newProject }); }
// Atualizar uma turma é um caso particular de "Atualizar projeto com DED+".
function openDedUpdateModal() { openDedPicker({ newProject: false }); }

function openDedPicker({ newProject = false } = {}) {
  const title = newProject ? 'Criar projeto pelo DED+' : 'Atualizar projeto com DED+';
  const description = newProject
    ? 'Selecione um ou vários PDFs de lista nominal exportados pelo DED+. O ProfessorGest criará um novo projeto e preencherá os dados do professor que puder identificar.'
    : 'Selecione um ou vários PDFs do DED+. Turmas que já existem no projeto são atualizadas, turmas novas são adicionadas e nenhum aluno é apagado automaticamente — quem não aparece no PDF é preservado com todo o histórico.';
  openModal(`
    <div class="modal-title">${title}</div>
    <p class="confirm-body">${description}</p>
    <div class="ded-import-dropzone">
      <div class="ded-import-icon">${ICONS.file}</div>
      <strong>Selecione os PDFs do DED+</strong>
      <span>Você pode selecionar várias turmas de uma vez.</span>
      <button type="button" class="btn-primary" id="btnChooseDedPdf">Selecionar PDFs</button>
      <input type="file" id="dedPdfInput" class="visually-hidden" accept="application/pdf,.pdf" multiple>
    </div>
    <p class="form-hint">Os arquivos são processados localmente neste dispositivo. Nenhum PDF é enviado para um servidor.</p>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button></div>
  `, false, 'ded-import-modal');
  onClick('#btnChooseDedPdf', () => document.getElementById('dedPdfInput')?.click());
  const input = q('#dedPdfInput');
  if (input) input.addEventListener('change', event => handleDedImportInput(event, { newProject }), { once: true });
}

async function handleDedImportInput(event, { newProject = false } = {}) {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  openModal(`
    <div class="modal-title">Lendo PDFs do DED+</div>
    <div class="ded-import-progress"><progress id="dedProgressBar" class="ded-progress-meter" max="100" value="0"></progress><div id="dedProgressText">Preparando ${files.length} arquivo(s)...</div></div>
  `, false, 'ded-import-modal');
  const parsed = await parseDedPdfFiles(files, (done, total, name) => {
    const bar = q('#dedProgressBar'); const text = q('#dedProgressText');
    if (bar) bar.value = Math.round((done / total) * 100);
    if (text) text.textContent = `${done} de ${total}: ${name}`;
  });
  openDedImportReview(parsed.results, parsed.errors, { newProject });
}

function dedBaseState(newProject) { return newProject ? emptyProjectData() : state; }

function openDedImportReview(results, errors = [], { newProject = false } = {}) {
  const preview = previewDedProjectUpdate(dedBaseState(newProject), results);
  const { summary, reports = [], duplicates = [] } = preview;
  const cards = reports.map(r => {
    const status = r.classAdded ? 'Nova turma' : (r.assignmentAdded ? 'Adicionar disciplina à turma' : 'Atualizar turma');
    return `<div class="ded-import-item ${r.classAdded ? 'is-new' : 'is-existing'}"><div class="ded-import-item-head"><div><strong>${esc(r.className)}</strong><span>${esc(r.component || 'Componente não informado')}</span></div><span class="ded-import-status">${status}</span></div><div class="ded-import-meta"><span>${plural(r.newStudents.length, 'aluno novo', 'alunos novos')}</span><span>${plural(r.renamed.length, 'nome alterado', 'nomes alterados')}</span><span>${plural(r.missing.length, 'ausente preservado', 'ausentes preservados')}</span></div></div>`;
  }).join('');
  const errorList = errors.length ? `<div class="ded-import-errors"><strong>Não foi possível interpretar ${errors.length} arquivo(s)</strong><ul>${errors.map(item => `<li><strong>${esc(item.name)}</strong> — ${esc(item.message)}</li>`).join('')}</ul></div>` : '';
  const duplicateNotice = duplicates.length ? `<div class="ded-import-notice">${plural(duplicates.length, 'PDF repetido foi ignorado', 'PDFs repetidos foram ignorados')} (mesma turma e disciplina).</div>` : '';
  const renamed = reports.flatMap(r => r.renamed).slice(0, 8);
  const missing = reports.flatMap(r => r.missing).slice(0, 8);
  const sections = [
    renamed.length ? `<div class="ded-update-section"><strong>Nomes que mudaram</strong><ul>${renamed.map(x => `<li>${esc(x.from)} → <strong>${esc(x.to)}</strong></li>`).join('')}</ul></div>` : '',
    summary.preservedMissing ? `<div class="ded-import-notice">${plural(summary.preservedMissing, 'aluno do projeto não aparece', 'alunos do projeto não aparecem')} nos PDFs. Eles <strong>não serão excluídos</strong> nem perderão o histórico${missing.length ? `: ${missing.map(esc).join(', ')}${summary.preservedMissing > missing.length ? '…' : ''}` : ''}.</div>` : '',
  ].join('');
  const limitNotice = preview.ok ? '' : `<div class="ded-import-errors"><strong>Importação bloqueada</strong><div>${esc(preview.message)}</div></div>`;
  const canApply = reports.length && preview.ok;
  const yearGuess = (results.find(i => i.year) || {}).year;
  const nameField = newProject ? `<div class="form-group ded-name-field"><label class="form-label" for="dedProjectName">Nome do projeto</label><input class="form-input" id="dedProjectName" maxlength="${PROJECT_NAME_MAX}" value="${esc(yearGuess ? `Projeto ${yearGuess}` : 'Projeto DED+')}"><p class="form-hint">Você pode mudar depois, na página Projeto.${preview.profile?.teacher?.name ? ` Professor(a) identificado(a): ${esc(preview.profile.teacher.name)}.` : ''}</p></div>` : '';
  openModal(`<div class="modal-title">${newProject ? 'Revisar novo projeto pelo DED+' : 'Revisar atualização com DED+'}</div>
    <p class="confirm-body">${newProject ? 'Um novo projeto será criado com as turmas abaixo.' : 'Confira o que será feito. Uma cópia de segurança do projeto é criada antes de aplicar.'}</p>
    <div class="ded-update-summary" aria-label="Resumo da atualização">
      <div class="ded-update-summary-item"><strong>${summary.classesUpdated}</strong><span>${summary.classesUpdated === 1 ? 'turma atualizada' : 'turmas atualizadas'}</span></div>
      <div class="ded-update-summary-item"><strong>${summary.classesAdded}</strong><span>${summary.classesAdded === 1 ? 'turma adicionada' : 'turmas adicionadas'}</span></div>
      <div class="ded-update-summary-item"><strong>${summary.newStudents}</strong><span>${summary.newStudents === 1 ? 'aluno novo' : 'alunos novos'}</span></div>
      <div class="ded-update-summary-item"><strong>${summary.renamedStudents}</strong><span>${summary.renamedStudents === 1 ? 'nome alterado' : 'nomes alterados'}</span></div>
      <div class="ded-update-summary-item"><strong>${summary.preservedMissing}</strong><span>${summary.preservedMissing === 1 ? 'ausente preservado' : 'ausentes preservados'}</span></div>
    </div>
    <div class="ded-import-list">${cards || '<div class="ded-import-empty">Nenhuma turma válida foi encontrada.</div>'}</div>
    ${sections}${errorList}${duplicateNotice}${limitNotice}${nameField}
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="button" class="btn-primary" id="btnConfirmDedImport" ${canApply ? '' : 'disabled'}>${newProject ? 'Criar projeto' : 'Atualizar projeto'}</button></div>`, true, 'ded-import-modal');
  onClick('#btnConfirmDedImport', () => commitDedProject(results, { newProject }));
}

async function commitDedProject(items, { newProject = false } = {}) {
  if (newProject) {
    const preview = previewDedProjectUpdate(emptyProjectData(), items);
    if (!preview.ok || !preview.changed) { toast(preview.message || 'Nenhuma turma para criar.', 'error'); return; }
    const created = preview.state;
    const year = items.find(i => i.year)?.year;
    created.name = normalizeProjectName(document.getElementById('dedProjectName')?.value) || (year ? `Projeto ${year}` : 'Projeto DED+');
    try {
      const meta = await createProjectFromState(created);
      closeModal();
      await openProject(meta.projectId, { interactive: false });
      toast(`Projeto criado com ${plural(preview.summary.classesAdded, 'turma', 'turmas')} e ${plural(preview.summary.newStudents, 'aluno', 'alunos')}.`, 'success');
    } catch (err) {
      logError('ded.new_project_failed', err);
      toast('Não foi possível criar o projeto.', 'error');
    }
    return;
  }
  if (!state || demoMode) { toast('Abra um projeto para atualizá-lo com o DED+.', 'error'); return; }
  const preview = previewDedProjectUpdate(state, items);
  if (!preview.ok) { toast(preview.message, 'error'); return; }
  if (!preview.changed) { closeModal(); toast('Nenhuma alteração foi necessária.', 'info'); return; }
  await protectBeforeDestructive('Antes de atualizar com DED+');
  const fresh = previewDedProjectUpdate(state, items);   // reaplica sobre o estado mais recente
  state = fresh.state;
  markDirty();
  closeModal();
  navigate('turmas', false);
  showDedResultModal(fresh);
}

function showDedResultModal(result) {
  const s = result.summary;
  const missing = result.reports.flatMap(r => r.missing);
  openModal(`<div class="confirm-icon info">${ICONS.refresh}</div>
    <div class="modal-title">Projeto atualizado</div>
    <div class="ded-update-summary">
      <div class="ded-update-summary-item"><strong>${s.classesUpdated}</strong><span>${s.classesUpdated === 1 ? 'turma atualizada' : 'turmas atualizadas'}</span></div>
      <div class="ded-update-summary-item"><strong>${s.classesAdded}</strong><span>${s.classesAdded === 1 ? 'turma adicionada' : 'turmas adicionadas'}</span></div>
      <div class="ded-update-summary-item"><strong>${s.newStudents}</strong><span>${s.newStudents === 1 ? 'aluno novo' : 'alunos novos'}</span></div>
      <div class="ded-update-summary-item"><strong>${s.renamedStudents}</strong><span>${s.renamedStudents === 1 ? 'nome alterado' : 'nomes alterados'}</span></div>
      <div class="ded-update-summary-item"><strong>${s.preservedMissing}</strong><span>${s.preservedMissing === 1 ? 'ausente preservado' : 'ausentes preservados'}</span></div>
    </div>
    ${missing.length ? `<p class="confirm-body">Alunos que não apareceram nos PDFs foram mantidos, com o histórico: ${esc(missing.slice(0, 10).join(', '))}${missing.length > 10 ? '…' : ''}.</p>` : ''}
    <p class="form-hint">Salvo neste dispositivo. A versão anterior ficou nas cópias de segurança do projeto.</p>
    <div class="form-actions"><button type="button" class="btn-primary" id="modalCancel">Entendi</button></div>`);
}

/* ==================== estado "sujo" / proteção local ==================== */








/*
 * Serializa toda gravação no FileSystemFileHandle. Sem isso, o autosave (700 ms
 * após a edição) e o botão Salvar podiam chamar createWritable() ao mesmo tempo;
 * a segunda chamada falhava e o app descartava o vínculo com o arquivo .prg.
 */


















function formatRecoveryTime(iso) {
  if (!iso) return 'agora';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'recentemente';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}


// O Drive só é atualizado por uma ação explícita do usuário. A sessão do Google só é
// solicitada quando o professor clica em uma ação explícita de atualizar o Drive.








/* ==================== tema visual ==================== */

function getThemeMode() {
  try { return localStorage.getItem('professorgest-theme') || 'light'; }
  catch (_) { return 'light'; }
}

function resolvedTheme(mode = getThemeMode()) {
  if (mode === 'system') {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode === 'dark' ? 'dark' : 'light';
}

function applyThemeMode(mode, persist = true) {
  const safeMode = ['light', 'dark', 'system'].includes(mode) ? mode : 'light';
  document.documentElement.dataset.theme = resolvedTheme(safeMode);
  document.documentElement.dataset.themeMode = safeMode;
  if (persist) {
    try { localStorage.setItem('professorgest-theme', safeMode); } catch (_) {}
  }
  updateThemeColorMeta();
  updateThemeToggle();
}

function updateThemeToggle() {
  const actual = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const buttons = [document.getElementById('themeToggle'), document.getElementById('welcomeThemeToggle'), document.getElementById('setupThemeToggle')].filter(Boolean);
  buttons.forEach(btn => {
    btn.setAttribute('aria-label', actual === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro');
    btn.title = actual === 'dark' ? 'Tema escuro · mudar para claro' : 'Tema claro · mudar para escuro';
  });
}

function updateThemeColorMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  meta.content = document.documentElement.dataset.theme === 'dark' ? '#0A1220' : '#F5F8FC';
}

function toggleTheme() {
  const actual = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  applyThemeMode(actual === 'dark' ? 'light' : 'dark');
}

function initTheme() {
  applyThemeMode(getThemeMode(), false);
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq) {
    const onChange = () => { if (getThemeMode() === 'system') applyThemeMode('system', false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
}

/* ==================== GOOGLE DRIVE ==================== */

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

function googleDriveConfig() {
  const cfg = window.PROFESSORGEST_GOOGLE_CONFIG || {};
  return {
    clientId: String(cfg.clientId || '').trim(),
    apiKey: String(cfg.apiKey || '').trim(),
    appId: String(cfg.appId || '').trim(),
  };
}

function isGoogleDriveConfigured() {
  const cfg = googleDriveConfig();
  return !!(cfg.clientId && cfg.apiKey && cfg.appId);
}









function driveAccountLabel() {
  return driveAccount?.displayName || driveAccount?.email || 'Conta Google';
}

function driveAccountInitials() {
  const name = driveAccount?.displayName || driveAccount?.email || '';
  return initials(name) || 'G';
}

function driveAccountAvatarHTML({ className = '' } = {}) {
  const photo = driveAccount?.photoLink;
  const fallback = esc(driveAccountInitials());
  const classes = `drive-account-avatar${className ? ` ${className}` : ''}`;
  if (!photo) return `<span class=\"${classes} fallback\">${fallback}</span>`;
  return `<span class=\"${classes}\"><img src=\"${esc(photo)}\" alt=\"\" loading=\"lazy\" referrerpolicy=\"no-referrer\" onerror=\"this.hidden=true;this.nextElementSibling.hidden=false\"><span hidden>${fallback}</span></span>`;
}

function driveAccountStatusHTML() {
  if (!driveAccount) return '';
  return `${driveAccountAvatarHTML({ className: 'drive-account-avatar-lg' })}<div class=\"drive-account-copy\"><strong>${esc(driveAccountLabel())}</strong><span>${esc(driveAccount.email || 'Conta Google conectada')}</span></div>`;
}

function setDriveActionUI(pending) {
  driveActionPending = !!pending;
  qAll('#topbarDriveBtn, #btnDriveAction, #btnDriveActionSettings, #btnDashboardDrive').forEach(button => {
    button.disabled = driveActionPending;
    button.setAttribute('aria-busy', driveActionPending ? 'true' : 'false');
  });
}


/*
 * Atualiza TODA a interface que mostra a conta Google. A tela inicial e a área
 * de trabalho têm controles diferentes; antes, só render() era chamado, e ele
 * falha na tela inicial (não há projeto aberto), então nada mudava na tela.
 */
function refreshAccountUI() {
  try { updateWelcomeAccountControl(); } catch (err) { console.warn('[ProfessorGest] Falha ao atualizar a conta na tela inicial.', err); }
  if (state && workspaceReady) {
    try { render(); } catch (err) { console.warn('[ProfessorGest] Falha ao atualizar a conta na barra superior.', err); }
  }
}

function sameDriveAccount(a, b) {
  return (a?.permissionId || null) === (b?.permissionId || null)
    && (a?.email || null) === (b?.email || null)
    && (a?.displayName || null) === (b?.displayName || null)
    && (a?.photoLink || null) === (b?.photoLink || null);
}

async function refreshDriveAccountProfile() {
  if (!driveAccessToken) return driveAccount;
  try {
    const response = await fetch(`${DRIVE_API_BASE}/about?fields=user(displayName,emailAddress,photoLink,permissionId)`, {
      headers: { Authorization: `Bearer ${driveAccessToken}` },
    });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data?.error?.message || `Google Drive respondeu com ${response.status}.`);

    const user = data?.user || {};
    const previousAccount = driveAccount;
    const nextAccount = normalizeDriveAccount({
      displayName: user.displayName,
      email: user.emailAddress,
      photoLink: user.photoLink,
      permissionId: user.permissionId,
      lastVerifiedAt: new Date().toISOString(),
    });
    if (!nextAccount) return driveAccount;
    driveAccount = nextAccount;
    writeDriveAccount(driveAccount);
    if (!sameDriveAccount(previousAccount, driveAccount)) refreshAccountUI();
    return driveAccount;
  } catch (err) {
    console.warn('[ProfessorGest] Não foi possível carregar o perfil da conta Google.', err);
    return driveAccount;
  }
}

function invalidateDriveSession({ forgetAccount = false, refreshUI = true } = {}) {
  // Qualquer pedido de token iniciado antes disto passa a ser ignorado; sem
  // isso uma resposta atrasada da conta antiga reativava a sessão removida.
  driveSessionEpoch += 1;
  driveTokenPromise = null;
  driveAccessToken = null;
  driveTokenExpiresAt = 0;
  driveTokenClient = null;
  driveAuthCancelled = false;
  if (forgetAccount) {
    driveAccount = null;
    clearDriveAccount();
    // O Google reaproveita a sessão do navegador e escolheria a conta antiga
    // em silêncio. A próxima conexão deve mostrar o seletor de contas.
    driveForceAccountPrompt = true;
    if (refreshUI) refreshAccountUI();
  }
}

function connectGoogleDriveAccount() {
  if (!isGoogleDriveConfigured()) {
    showDriveNotConfigured();
    return false;
  }
  requestDriveAccessTokenFromClick({
    forceConsent: false,
    onToken: async () => {
      try {
        await refreshDriveAccountProfile();
        toast(driveAccount ? `Conta Google conectada: ${driveAccount.email || driveAccountLabel()}.` : 'Conta Google conectada.', 'success');
      } catch (err) {
        toast(err?.message || 'A conta foi autorizada, mas não foi possível carregar o perfil do Google.', 'error');
      } finally {
        updateWelcomeAccountControl();
      }
    },
    onError: (err) => {
      if (!isDriveAuthCancellationError(err)) {
        toast(err?.message || 'Não foi possível conectar a conta Google.', 'error');
      }
    },
  });
  return true;
}

function switchDriveAccount() {
  if (!isGoogleDriveConfigured()) { showDriveNotConfigured(); return false; }
  const previousAccount = driveAccount;
  // A conta antiga continua visível até o Google confirmar a nova.
  invalidateDriveSession({ forgetAccount: true, refreshUI: false });
  requestDriveAccessTokenFromClick({
    selectAccount: true,
    onToken: async () => {
      await refreshDriveAccountProfile();
      if (!driveAccount) {
        // Token obtido, mas o perfil não carregou: não finja que trocou.
        driveAccount = previousAccount || null;
        if (driveAccount) writeDriveAccount(driveAccount);
        toast('Conta autorizada, mas não foi possível identificá-la. Tente trocar novamente.', 'error');
      } else if (previousAccount?.permissionId && driveAccount.permissionId
          && previousAccount.permissionId !== driveAccount.permissionId) {
        toast('Conta Google alterada. O vínculo do projeto anterior continua protegido.', 'info');
      } else {
        toast('Conta Google confirmada.', 'success');
      }
      refreshAccountUI();
    },
    onError: err => {
      driveAccount = previousAccount || null;
      if (driveAccount) writeDriveAccount(driveAccount);
      toast(err?.message || 'Não foi possível trocar a conta do Google.', 'error');
      refreshAccountUI();
    },
  });
  return true;
}

function openDriveAccountSettings() {
  if (!driveAccount) { connectGoogleDriveAccount(); return; }
  openModal(`
    <div class=\"drive-account-modal-head\">
      ${driveAccountAvatarHTML({ className: 'drive-account-avatar-xl' })}
      <div><div class=\"modal-title\">Conta do Google</div><p class=\"confirm-body\">Esta é a conta usada pelo ProfessorGest para abrir e sincronizar arquivos no Google Drive.</p></div>
    </div>
    <div class=\"drive-account-profile-card\">${driveAccountStatusHTML()}</div>
    <div class=\"drive-account-actions\">
      <button type=\"button\" class=\"btn-secondary\" id=\"btnDriveSwitchAccount\">Trocar conta</button>
      <button type=\"button\" class=\"btn-ghost\" id=\"btnDriveForgetAccount\">Remover conta lembrada</button>
    </div>
    <p class=\"form-hint\">Remover a conta lembrada não apaga arquivos do Google Drive nem desvincula projetos.</p>
  `, false);
  document.getElementById('btnDriveSwitchAccount')?.addEventListener('click', () => { closeModal(); switchDriveAccount(); });
  document.getElementById('btnDriveForgetAccount')?.addEventListener('click', () => {
    closeModal();
    invalidateDriveSession({ forgetAccount: true });
    toast('A conta Google lembrada foi removida deste dispositivo.', 'success');
  });
}

function waitForGoogleIdentity(timeout = 10000) {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.google?.accounts?.oauth2) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > timeout) { clearInterval(timer); reject(new Error('Google Identity Services não carregou.')); }
    }, 80);
  });
}

function isDriveAuthCancellationError(error) {
  const message = String(error?.message || error || '');
  return /popup_closed|cancel|access_denied|interaction_required|login_required|account_selection_required|A autenticação do Google/i.test(message);
}

function initDriveTokenClient() {
  if (!isGoogleDriveConfigured() || !window.google?.accounts?.oauth2) return false;
  const cfg = googleDriveConfig();
  if (!driveTokenClient) {
    driveTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: DRIVE_SCOPE,
      callback: () => {},
      // Sem isto, popup bloqueado ou fechado pelo usuário nunca chamava nenhum
      // callback e o app ficava esperando até o timeout.
      error_callback: (err) => { driveTokenClient?.errorCallback?.(err); },
    });
  }
  return true;
}

function initGoogleDriveSdk() {
  initDriveTokenClient();
  if (window.gapi?.load) loadPickerApi(15000).catch(() => {});
}

function loadPickerApi(timeout = 10000) {
  if (drivePickerReady && window.google?.picker) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (window.gapi?.load) {
        clearInterval(poll);
        try {
          window.gapi.load('picker', () => {
            drivePickerReady = true;
            resolve();
          });
        } catch (err) { reject(err); }
      } else if (Date.now() - started > timeout) {
        clearInterval(poll);
        reject(new Error('Google Picker não carregou.'));
      }
    }, 80);
  });
}

/* Silencioso primeiro: o Google reutiliza a sessão/autorização existente quando possível. */
async function getDriveAccessToken({ forceConsent = false, timeoutMs = 120000 } = {}) {
  if (!isGoogleDriveConfigured()) throw new Error('Google Drive não está configurado para este aplicativo.');
  const now = Date.now();
  if (driveAccessToken && driveTokenExpiresAt > now + 60000) return driveAccessToken;
  if (driveTokenPromise) return driveTokenPromise;

  driveAuthCancelled = false;
  const requestEpoch = driveSessionEpoch;
  driveTokenPromise = (async () => {
    await waitForGoogleIdentity();
    if (!initDriveTokenClient()) throw new Error('Google Identity Services não está pronto. Recarregue a página e tente novamente.');
    return await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        fn(value);
      };
      const timeoutId = setTimeout(() => {
        driveAuthCancelled = true;
        settle(reject, new Error('A autenticação do Google foi encerrada ou não foi concluída. O arquivo continuará podendo ser salvo neste dispositivo.'));
      }, Math.max(1000, Number(timeoutMs) || 120000));

      driveTokenClient.errorCallback = (err) => {
        driveAuthCancelled = true;
        settle(reject, new Error(err?.type === 'popup_failed_to_open'
          ? 'A autenticação do Google foi cancelada: o navegador bloqueou a janela de login. Clique em Salvar novamente.'
          : 'A autenticação do Google foi cancelada. O arquivo continuará podendo ser salvo neste dispositivo.'));
      };

      driveTokenClient.callback = (response) => {
        if (requestEpoch !== driveSessionEpoch) {
          settle(reject, new Error('A sessão do Google foi alterada. Tente novamente.'));
          return;
        }
        if (!response || response.error) {
          const detail = response?.error_description || response?.error || 'Não foi possível autorizar o Google Drive.';
          const cancelled = isDriveAuthCancellationError(detail);
          driveAuthCancelled = cancelled;
          settle(reject, new Error(cancelled
            ? 'A autenticação do Google foi cancelada. O arquivo continuará podendo ser salvo neste dispositivo.'
            : detail));
          return;
        }
        driveAuthCancelled = false;
        driveForceAccountPrompt = false;
        driveAccessToken = response.access_token;
        driveTokenExpiresAt = Date.now() + ((Number(response.expires_in) || 3600) * 1000);
        settle(resolve, driveAccessToken);
      };
      try {
        driveTokenClient.requestAccessToken({
          prompt: forceConsent ? 'consent' : (driveForceAccountPrompt ? 'select_account' : ''),
          ...(driveAccount?.email && !driveForceAccountPrompt ? { login_hint: driveAccount.email } : {}),
        });
      } catch (err) {
        driveAuthCancelled = true;
        settle(reject, err);
      }
    });
  })().finally(() => { if (requestEpoch === driveSessionEpoch) driveTokenPromise = null; });

  return driveTokenPromise;
}

function requestDriveAccessTokenFromClick({ forceConsent = false, selectAccount = false, onToken, onError } = {}) {
  if (!isGoogleDriveConfigured()) {
    onError?.(new Error('Google Drive não está configurado para este aplicativo.'));
    return false;
  }
  if (driveAccessToken && driveTokenExpiresAt > Date.now() + 60000) {
    onToken?.(driveAccessToken);
    return true;
  }
  if (!initDriveTokenClient()) {
    onError?.(new Error('O Google ainda está carregando. Aguarde um instante e tente novamente.'));
    return false;
  }

  const chooseAccount = selectAccount || driveForceAccountPrompt;
  const request = (prompt, allowConsentFallback) => {
    driveTokenClient.errorCallback = (err) => {
      onError?.(new Error(err?.type === 'popup_failed_to_open'
        ? 'O navegador bloqueou a janela de login do Google. Permita pop-ups para este site e tente novamente.'
        : 'A autenticação do Google foi cancelada.'));
    };
    driveTokenClient.callback = (response) => {
      if (!response || response.error) {
        const error = String(response?.error || '').toLowerCase();
        const description = String(response?.error_description || '').toLowerCase();
        const requiresInteraction =
          error === 'interaction_required' ||
          error === 'login_required' ||
          error === 'account_selection_required' ||
          description.includes('interaction_required') ||
          description.includes('login_required');

        if (!chooseAccount && allowConsentFallback && requiresInteraction) {
          try {
            request('consent', false);
            return;
          } catch (err) {
            onError?.(err);
            return;
          }
        }

        onError?.(new Error(response?.error_description || response?.error || 'Não foi possível autorizar o Google Drive.'));
        return;
      }

      driveForceAccountPrompt = false;
      driveAccessToken = response.access_token;
      driveTokenExpiresAt = Date.now() + ((Number(response.expires_in) || 3600) * 1000);
      onToken?.(driveAccessToken);
    };

    try {
      driveTokenClient.requestAccessToken({
        prompt: chooseAccount ? 'select_account' : (prompt || ''),
        ...(chooseAccount ? {} : (driveAccount?.email ? { login_hint: driveAccount.email } : {})),
      });
      return true;
    } catch (err) {
      if (allowConsentFallback) {
        try {
          request('consent', false);
          return true;
        } catch (fallbackErr) {
          onError?.(fallbackErr);
          return false;
        }
      }
      onError?.(err);
      return false;
    }
  };

  return request(forceConsent ? 'consent' : '', !forceConsent);
}
async function driveFetch(url, options = {}, retry = true) {
  return driveHttpFetch(url, {
    getAccessToken: getDriveAccessToken,
    invalidateToken: () => { driveAccessToken = null; driveTokenExpiresAt = 0; },
    options,
    retry,
  });
}

async function driveJson(url, options = {}, retry = true) {
  return driveHttpJson(url, {
    getAccessToken: getDriveAccessToken,
    invalidateToken: () => { driveAccessToken = null; driveTokenExpiresAt = 0; },
    options,
    retry,
  });
}

async function driveText(url, options = {}, retry = true) {
  return driveHttpText(url, {
    getAccessToken: getDriveAccessToken,
    invalidateToken: () => { driveAccessToken = null; driveTokenExpiresAt = 0; },
    options,
    retry,
  });
}










function showDriveNotConfigured() {
  openModal(`
    <div class="confirm-icon info">${ICONS.cloud}</div>
    <div class="modal-title">Google Drive ainda não está configurado</div>
    <p class="confirm-body">O Google Drive ainda não está disponível para este site. Você pode continuar salvando seus arquivos neste dispositivo ou exportar uma cópia .prg.</p>
    <div class="cloud-setup-note"><strong>O arquivo continua funcionando normalmente sem isso.</strong><span>Você pode usar arquivos locais enquanto a integração não estiver ativa.</span></div>
    <div class="form-actions"><button type="button" class="btn-primary" id="modalCancel">Entendi</button></div>
  `);
}

function buildDrivePicker(token) {
  const cfg = googleDriveConfig();
  const view = new google.picker.DocsView(google.picker.ViewId.DOCS);
  // O arquivo .prg é criado no próprio Drive do professor. Não use
  // setOwnedByMe(false), pois false filtra justamente para itens compartilhados.
  // Também não restringimos MIME aqui: o Drive pode classificar um .prg como
  // application/json, text/plain ou outro tipo. A validação real acontece após a seleção.
  view.setOwnedByMe(true);
  if (google.picker.DocsViewMode?.LIST) view.setMode(google.picker.DocsViewMode.LIST);

  const picker = new google.picker.PickerBuilder()
    .setDeveloperKey(cfg.apiKey)
    .setAppId(cfg.appId)
    .setOAuthToken(token)
    .setOrigin(window.location.origin)
    .addView(view)
    .setCallback(async (data) => {
      if (data.action === google.picker.Action.CANCEL) return;
      if (data.action !== google.picker.Action.PICKED) return;
      const doc = data.docs?.[0];
      if (!doc?.id) return;
      try {
        await addDriveProjectToDeviceUI(doc.id);
      } catch (err) {
        showFileErrorModal(err.message || 'Não foi possível abrir o arquivo do Google Drive.');
      }
    })
    .build();
  picker.setVisible(true);
}

function openDrivePicker() {
  if (!isGoogleDriveConfigured()) {
    showDriveNotConfigured();
    return;
  }

  const showDriveError = (err) => {
    console.error('[ProfessorGest] Google Drive:', err);
    showFileErrorModal(err?.message || 'Não foi possível conectar ao Google Drive. Tente novamente ou continue usando o armazenamento neste dispositivo.');
  };

  requestDriveAccessTokenFromClick({
    forceConsent: false,
    onToken: async (token) => {
      await refreshDriveAccountProfile();
      loadPickerApi(15000)
        .then(() => buildDrivePicker(token))
        .catch(showDriveError);
    },
    onError: showDriveError,
  });
}






/* ==================== inicialização / tela de entrada ==================== */



function resetContext() {
  ctx = { ...ctx, classId: null, studentId: null, activityId: null, classTab: 'visao', studentTab: 'visao',
    histFilter: 'todos', histMonth: '', studentSearch: '', studentClassFilter: '', studentSort: 'nome',
    activityFilter: 'proximas', activityClassFilter: '', occSearch: '', occClassFilter: '', occTypeFilter: '', occMonth: '',
    calMonth: todayYM(), calSelectedDay: null, calClassFilter: '', bulkMode: false, bulkSelected: new Set(), bulkContext: null,
    assignmentId: null, reportStudentId: null, reportFrom: '', reportTo: '', reportOpts: null, reportSynthesis: '', classReportId: null, classReportFrom: '', classReportTo: ''
  };
}

function emptyProjectData() {
  const today = todayISO();
  return {
    format: PRG_FORMAT, version: PRG_VERSION, projectId: createProjectId(), createdAt: today, updatedAt: today,
    teacher: { name: '' }, schools: [], classes: [], assignments: [], enrollments: [], students: [], activities: [], occurrences: [], plans: [],
  };
}







function openWelcomeSettingsModal() {
  const mode = getThemeMode();
  openModal(`
    <div class="modal-title">Configurações</div>
    <p class="confirm-body">Preferências do aplicativo e dados armazenados neste dispositivo.</p>
    <section class="local-data-section">
      <div class="local-data-section-head"><div><strong>Aparência</strong><span>Escolha como o ProfessorGest aparece neste dispositivo.</span></div></div>
      <div class="theme-setting-grid">
        <button type="button" class="theme-option ${mode === 'light' ? 'active' : ''}" data-entry-theme-mode="light" aria-pressed="false"><div class="theme-preview light"></div><strong>Claro</strong><span>Visual leve e luminoso.</span></button>
        <button type="button" class="theme-option ${mode === 'dark' ? 'active' : ''}" data-entry-theme-mode="dark" aria-pressed="false"><div class="theme-preview dark"></div><strong>Escuro</strong><span>Confortável em ambientes com pouca luz.</span></button>
        <button type="button" class="theme-option ${mode === 'system' ? 'active' : ''}" data-entry-theme-mode="system" aria-pressed="false"><div class="theme-preview system"></div><strong>Sistema</strong><span>Segue a preferência do dispositivo.</span></button>
      </div>
    </section>
    <section class="local-data-section">
      <div class="local-data-section-head"><div><strong>Dados e cópias</strong><span>Gerencie o que o aplicativo guarda neste dispositivo.</span></div></div>
      <button type="button" class="btn-secondary btn-block" id="btnOpenLocalDataManager">${ICONS.settings || ICONS.folder} Gerenciar dados deste dispositivo</button>
    </section>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Fechar</button></div>
  `);
  const syncEntryThemeOptions = activeMode => {
    qAll('[data-entry-theme-mode]').forEach(option => {
      const active = option.dataset.entryThemeMode === activeMode;
      option.classList.toggle('active', active);
      option.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };
  syncEntryThemeOptions(mode);
  qAll('[data-entry-theme-mode]').forEach(el => el.onclick = () => {
    const nextMode = el.dataset.entryThemeMode;
    if (nextMode === getThemeMode()) return;
    applyThemeMode(nextMode);
    syncEntryThemeOptions(nextMode);
  });
  onClick('#btnOpenLocalDataManager', () => openLocalDataManager());
}


function showSetupScreen(origin = 'welcome') {
  setupOrigin = origin;
  document.getElementById('welcomeScreen')?.classList.add('is-hidden');
  document.getElementById('setupScreen')?.classList.remove('is-hidden');
  const form = document.getElementById('setupForm');
  if (form) form.reset();
  updateSetupPreview();
  requestAnimationFrame(() => document.getElementById('setupTeacherName')?.focus());
}

function hideSetupScreen() {
  document.getElementById('setupScreen')?.classList.add('is-hidden');
}

function enterWorkspace() {
  workspaceReady = true;
  document.body.classList.add('workspace-active');
  document.getElementById('welcomeScreen')?.classList.add('is-hidden');
  document.getElementById('setupScreen')?.classList.add('is-hidden');
}








function updateSetupPreview() {
  const name = document.getElementById('setupTeacherName')?.value.trim() || '';
  const avatar = document.getElementById('setupAvatar');
  const previewName = document.getElementById('setupPreviewName');
  const previewMeta = document.getElementById('setupPreviewMeta');
  const previewSchool = document.getElementById('setupPreviewSchool');
  const previewSubject = document.getElementById('setupPreviewSubject');
  if (avatar) avatar.textContent = initials(name || 'P') || 'P';
  if (previewName) previewName.textContent = name || 'Seu nome';
  if (previewMeta) previewMeta.textContent = 'Professor(a)';
  if (previewSchool) previewSchool.textContent = 'Definidas nas atuações';
  if (previewSubject) previewSubject.textContent = 'Definidas nas atuações';
}

function bindSetupEvents() {
  const form = document.getElementById('setupForm');
  if (form) form.onsubmit = (e) => { e.preventDefault(); finishNewProjectSetup(); };
  const back = document.getElementById('setupBackBtn');
  if (back) back.onclick = cancelNewProjectSetup;
  const ded = document.getElementById('setupDedBtn');
  if (ded) ded.onclick = () => openDedImportModal({ newProject: true });
  const theme = document.getElementById('setupThemeToggle');
  if (theme) theme.onclick = toggleTheme;
  qAll('#setupForm input').forEach(input => input.addEventListener('input', updateSetupPreview));
}


/* ==================== PWA ==================== */

function isStandaloneDisplayMode() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function updateInstallAction() {
  const btn = document.getElementById('welcomeInstall');
  if (!btn) return;
  const available = !!deferredInstallPrompt && !isStandaloneDisplayMode();
  btn.classList.toggle('is-hidden', !available);
  btn.setAttribute('aria-hidden', String(!available));
}

async function promptInstall() {
  if (!deferredInstallPrompt) return;
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  updateInstallAction();
  try {
    await promptEvent.prompt();
    await promptEvent.userChoice;
  } catch (err) {
    console.warn('[ProfessorGest] Instalação PWA não concluída.', err);
  }
  updateInstallAction();
}

function registerPwa() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallAction();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallAction();
  });
  if (window.matchMedia) {
    const display = window.matchMedia('(display-mode: standalone)');
    const onDisplayChange = () => updateInstallAction();
    display.addEventListener?.('change', onDisplayChange);
  }
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then((registration) => {
      registration.update().catch(() => {});
      if (registration.waiting && !isDirty) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller && !isDirty) {
            worker.postMessage({ type: 'SKIP_WAITING' });
          } else if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Uma atualização está pronta. Salve suas alterações antes de atualizar.', 'info');
          }
        });
      });
    })
    .catch((err) => console.warn('[ProfessorGest] Service Worker não disponível.', err));
  updateInstallAction();
}

/* ==================== boot ==================== */

const APP_BOOT_MIN_DURATION = 1200;

function setBootStatus(message) {
  const el = document.getElementById('appBootStatus');
  if (el) el.textContent = message;
}

async function waitForMinimumBootDuration(startedAt) {
  const start = Number(startedAt);
  if (!Number.isFinite(start)) return;

  const elapsed = performance.now() - start;
  const remaining = APP_BOOT_MIN_DURATION - elapsed;
  if (remaining <= 0) return;

  if (remaining > 300) setBootStatus('Finalizando...');
  await new Promise(resolve => window.setTimeout(resolve, remaining));
}

function beginAppLoading(message = 'Carregando...') {
  const screen = document.getElementById('appBootScreen');
  const startedAt = performance.now();
  if (!screen) return startedAt;

  setBootStatus(message);
  /* Esconde primeiro o conteúdo por baixo do splash e só então o mostra.
     A remoção do estado hidden é feita sem animação para que o loading apareça
     imediatamente, sem deixar a tela anterior vazar por um frame. */
  document.body.classList.add('app-booting');
  screen.style.transition = 'none';
  screen.classList.remove('is-hidden');
  void screen.offsetHeight;
  screen.style.transition = '';
  return startedAt;
}

async function finishAppLoading(startedAt) {
  await waitForMinimumBootDuration(startedAt);
  const screen = document.getElementById('appBootScreen');
  document.body.classList.remove('app-booting');
  if (!screen) return;
  screen.classList.add('is-hidden');
}

async function withAppLoading(message, task) {
  const startedAt = beginAppLoading(message);
  try {
    return await task();
  } finally {
    await finishAppLoading(startedAt);
  }
}

async function finishAppBoot() {
  const startedAt = Number(window.__PROFESSORGEST_BOOT_STARTED_AT);
  await finishAppLoading(startedAt);
}

async function startApp() {
  initTheme();
  setBootStatus('Carregando seu espaço...');
  buildNav();
  bindGlobalEvents();
  bindSetupEvents();
  setBootStatus('Preparando o ProfessorGest...');
  initGoogleDriveSdk();
  registerPwa();
  await migrateLegacyData();
  const savedRoute = getPersistedRoute();
  let restored = false;
  if (savedRoute?.projectId) {
    restored = await openProject(savedRoute.projectId, { navigateToDashboard: false, interactive: false });
    if (restored) {
      enterWorkspace();
      navigation.restoreWorkspaceRoute(savedRoute);
      render();
    }
  }
  if (!restored) await showWelcomeScreen({ withLoading: false });
  if (apiClient.enabled) apiClient.health().catch(err => console.warn('[ProfessorGest] API indisponível:', err));

  // Aguarda a primeira pintura útil para evitar o efeito de "interface montando".
  try {
    await Promise.race([
      document.fonts?.ready || Promise.resolve(),
      new Promise(resolve => setTimeout(resolve, 700)),
    ]);
  } catch (_) {}
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await finishAppBoot();
}

document.addEventListener('DOMContentLoaded', () => {
  startApp().catch(async (err) => {
    console.error('[ProfessorGest] Falha durante a inicialização.', err);
    setBootStatus('Abrindo o ProfessorGest...');
    await finishAppBoot();
  });
});

window.addEventListener('beforeunload', (e) => {
  if (isDirty && !demoMode) {
    persistRecoveryDraft({ sync: true });
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

window.addEventListener('pagehide', () => { if (isDirty && !demoMode) persistRecoveryDraft({ sync: true }); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && isDirty && !demoMode) persistRecoveryDraft({ sync: true }); });
window.addEventListener('online', () => { if (state?.projectId && currentDriveLink() && !demoMode) { scheduleDriveAutoSync(); } refreshDriveStatusUI(); });
window.addEventListener('offline', () => refreshDriveStatusUI());

function bindGlobalEvents() {
  document.getElementById('welcomeNewProject')?.addEventListener('click', () => openNewProjectChooser());
  document.getElementById('welcomeImportPrg')?.addEventListener('click', () => pickPrgFile());
  document.getElementById('projectSearch')?.addEventListener('input', event => { projectSearchQuery = event.target.value; refreshProjectsUI({ reload: false }); });
  document.getElementById('welcomeDemo').onclick = () => beginDemoMode();
  document.getElementById('welcomeSettings')?.addEventListener('click', () => openWelcomeSettingsModal());
  document.getElementById('welcomeInstall')?.addEventListener('click', promptInstall);
  document.getElementById('welcomeThemeToggle').onclick = () => toggleTheme();
  document.getElementById('quickRegisterBtnDesktop').onclick = () => openOccurrenceModal();
  document.getElementById('quickRegisterBtnMobile').onclick = () => openOccurrenceModal();
  document.getElementById('prgImportInput')?.addEventListener('change', handlePrgImportInput);
  document.getElementById('topbarSearchBtn').onclick = () => openCommandPalette('');
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) themeToggle.onclick = toggleTheme;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      flushLocalSave().catch(err => { console.warn('[ProfessorGest] Salvamento imediato falhou.', err); });
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette('');
    } else if (e.key === 'Tab' && document.getElementById('modalRoot').innerHTML) {
      const modal = document.querySelector('#modalRoot .modal-box');
      if (modal) {
        const focusable = [...modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
        if (focusable.length) {
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    } else if (e.key === 'Escape') {
      const setupVisible = !document.getElementById('setupScreen')?.classList.contains('is-hidden');
      if (setupVisible) { cancelNewProjectSetup(); return; }
      if (document.getElementById('cmdkRoot').innerHTML) closeCommandPalette();
      else if (document.querySelector('.mobile-menu-box')) closeMobileMenu();
      else if (document.getElementById('modalRoot').innerHTML) closeModal();
    }
  });
}

function uid(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }


/* ==================== toasts ==================== */

function toast(message, kind) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  const icon = kind === 'error' ? ICONS.alert : ICONS.check;
  el.innerHTML = `<span class="toast-icon">${icon}</span><span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  }, 3200);
}

/* ==================== nav ==================== */

const VIEW_TITLES = {
  dashboard: 'Início', turmas: 'Turmas', alunos: 'Alunos', escolas: 'Escolas', atividades: 'Atividades',
  calendario: 'Calendário', planejamento: 'Planejamento', ocorrencias: 'Ocorrências', relatorios: 'Relatórios',
  arquivo: 'Projeto', configuracoes: 'Configurações',
  turmaDetail: 'Turma', alunoDetail: 'Perfil do aluno', atividadeDetail: 'Atividade',
  relatorioIndividual: 'Relatório individual', relatorioTurma: 'Relatório da turma',
};

function render() {
  document.getElementById('viewTitle').textContent = VIEW_TITLES[currentView] || 'ProfessorGest';
  document.getElementById('topbarFile').innerHTML = topbarFileHTML();
  updateSaveChrome();
  updateTopbarDrive();
  const topbarAvatar = document.getElementById('topbarAvatar');
  if (topbarAvatar) {
    if (driveAccount?.photoLink) topbarAvatar.innerHTML = driveAccountAvatarHTML({ className: 'topbar-drive-avatar' });
    else topbarAvatar.textContent = initials((state.teacher && state.teacher.name) || 'Professor') || 'P';
    topbarAvatar.title = driveAccount ? `Conta Google: ${driveAccountLabel()}` : 'Perfil do professor';
    topbarAvatar.setAttribute('aria-label', topbarAvatar.title);
    topbarAvatar.classList.toggle('google-account', !!driveAccount?.photoLink);
    if (driveAccount) {
      topbarAvatar.onclick = openDriveAccountSettings;
      topbarAvatar.setAttribute('tabindex', '0');
      topbarAvatar.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); topbarAvatar.click(); } };
    } else {
      topbarAvatar.onclick = null;
      topbarAvatar.onkeydown = null;
      topbarAvatar.removeAttribute('tabindex');
    }
  }

  const c = document.getElementById('viewContainer');
  const renderers = {
    dashboard: renderDashboard, turmas: renderTurmas, alunos: renderAlunos, escolas: renderEscolas, atividades: renderAtividades,
    calendario: renderCalendario, planejamento: renderPlanejamento, ocorrencias: renderOcorrenciasLog, relatorios: renderRelatoriosHub,
    arquivo: renderArquivo, configuracoes: renderConfiguracoes,
    turmaDetail: renderTurmaDetail, alunoDetail: renderAlunoDetail, atividadeDetail: renderAtividadeDetail,
    relatorioIndividual: renderRelatorioIndividual, relatorioTurma: renderRelatorioTurma,
  };
  const wide = currentView === 'relatorioIndividual' || currentView === 'relatorioTurma' || currentView === 'calendario';
  c.className = 'view-container' + (wide ? ' wide' : '');
  c.innerHTML = (renderers[currentView] || renderDashboard)();
  bindViewEvents();
}

function topbarFileHTML() {
  if (demoMode) return `<div class="topbar-fileline demo-fileline">${ICONS.sparkle || ICONS.file}<span>Demonstração</span></div>`;
  const name = esc(state?.name || projectNameOf(state));
  const cloud = currentDriveLink() ? `<span class="topbar-cloud-badge" title="${esc(syncLabel(currentSyncStatus()))}">${ICONS.cloud}</span>` : '';
  return `<div class="topbar-fileline" title="${name}">${ICONS.folder}<span>${name}</span>${cloud}</div>`;
}

function rerenderKeepFocus() {
  const active = document.activeElement;
  const id = active && active.id;
  const start = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  const end = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
  render();
  if (id) {
    const el = document.getElementById(id);
    if (el) {
      el.focus();
      if (start !== null && el.setSelectionRange) { try { el.setSelectionRange(start, end); } catch (e) {} }
    }
  }
}

/* ==================== helpers de dados ==================== */

function studentsOf(classId) { return selectStudentsOf(state, classId); }
function occurrencesOf(studentId) { return selectOccurrencesOf(state, studentId); }
function activitiesOf(classId, assignmentId = '') { return selectActivitiesOf(state, classId, assignmentId); }
function plansOf(classId, assignmentId = '') { return selectPlansOf(state, classId, assignmentId); }
function assignmentsOf(classId) { return selectAssignmentsOf(state, classId); }
function assignmentById(id) { return selectAssignmentById(state, id); }
function schoolById(id) { return selectSchoolById(state, id); }
function classById(id) { return selectClassById(state, id); }
function studentById(id) { return selectStudentById(state, id); }
function classIdsOfStudent(id) { return selectClassIdsOfStudent(state, id); }
function schoolNameOf(classId) { const c = classById(classId); const school = c?.schoolId ? schoolById(c.schoolId) : null; return school?.name || c?.ded?.schoolName || 'Escola não informada'; }
function assignmentNameOf(assignmentId) { const a = assignmentById(assignmentId); return a?.subject || 'Atuação não informada'; }
function assignmentForClass(classId, preferredId = '') { const list = assignmentsOf(classId); return (preferredId && list.find(a => a.id === preferredId)) || list[0] || null; }
function classNameOf(classId) { const c = classById(classId); return c ? c.name : 'Sem turma'; }
function initials(name) { return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(''); }
function activeClasses() { return selectActiveClasses(state); }
function activeStudents() { return selectActiveStudents(state); }
function activeActivities() { return selectActiveActivities(state); }
function studentStats(s) { return selectStudentStats(state, s, todayISO); }
function classStats(c) { return selectClassStats(state, c, todayISO); }
function activityStats(a) { return selectActivityStats(state, a); }
function activityStatus(a) { return selectActivityStatus(state, a, todayISO); }

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function searchFieldHTML(id, placeholder, value = '', extraClass = '', ariaLabel = '') {
  return createSearchField({ id, placeholder, value, extraClass, ariaLabel });
}
function emptyState(msg, sub) {
  return `<div class="empty-state"><div class="empty-title">${esc(msg)}</div>${sub ? `<div>${esc(sub)}</div>` : ''}</div>`;
}
function badgeFor(typeKey) {
  const t = OCCUR_TYPES.find(x => x.key === typeKey) || { label: typeKey, tone: 'gray' };
  return `<span class="badge badge-${t.tone}"><span class="badge-symbol" aria-hidden="true">${ICONS.bell}</span><span>${t.label}</span></span>`;
}

const studentActivityRenderers = createStudentActivityRenderers({
  getState: () => state, getCtx: () => ctx, esc, initials, classNameOf, studentStats, activityStats, activityStatus,
  occurrencesOf, activitiesOf, assignmentNameOf, emptyState, fmtDate, monthLabel, badgeFor, todayISO, ICONS, searchFieldHTML
});


function renderAlunos() { return studentActivityRenderers.renderAlunos(); }
function renderAlunoDetail() { return studentActivityRenderers.renderAlunoDetail(); }
function renderAtividades() { return studentActivityRenderers.renderAtividades(); }
function renderAtividadeDetail() { return studentActivityRenderers.renderAtividadeDetail(); }
function activityListItemHTML(a) { return studentActivityRenderers.activityListItemHTML(a); }

const calendarOccurrenceRenderers = createCalendarOccurrenceRenderers({
  getState: () => state, getCtx: () => ctx, esc, classNameOf, assignmentNameOf, studentById, studentsOf, initials,
  activityStatus, todayISO, fmtDate, monthLabel, weekdayShort, pad2,
  emptyState, badgeFor, ICONS, occurrenceTypes: OCCUR_TYPES, searchFieldHTML, createEntityPickerOption, createEntityPickerEmpty
});

function renderCalendario() { return calendarOccurrenceRenderers.renderCalendario(); }
function renderPlanejamento() { return planningViewRenderer.renderPlanejamento(); }
function renderOcorrenciasLog() { return calendarOccurrenceRenderers.renderOcorrenciasLog(); }
function activitiesInMonth(ym) { return calendarOccurrenceRenderers.activitiesInMonth(ym); }

const reportRenderers = createReportRenderers({
  getState: () => state, getCtx: () => ctx, esc, classNameOf, schoolNameOf, assignmentNameOf, studentById, studentsOf, activitiesOf, occurrencesOf,
  todayISO, addDays, fmtDate, emptyState, searchFieldHTML, createEntityPickerOption, createEntityPickerEmpty,
  timelineEntriesHTML: studentActivityRenderers.timelineEntriesHTML,
  studentTimelineEntries: studentActivityRenderers.studentTimelineEntries,
  occurrenceTypes: OCCUR_TYPES, ICONS
});

function renderRelatoriosHub() { return reportRenderers.renderRelatoriosHub(); }
function renderRelatorioIndividual() { return reportRenderers.renderRelatorioIndividual(); }
function renderRelatorioTurma() { return reportRenderers.renderRelatorioTurma(); }

const fileSettingsRenderers = createFileSettingsRenderers({
  getState: () => state, esc, getDemoMode: () => demoMode, getIsDirty: () => isDirty, ICONS, getDriveActionPending: () => driveActionPending,
  supportsFileShare, getProjectInfo, getDriveAccount: () => driveAccount,
  fmtDate, fmtDateTime, getThemeMode, getDevLogEntries
});

function renderArquivo() { return fileSettingsRenderers.renderArquivo(); }
function renderConfiguracoes() { return fileSettingsRenderers.renderConfiguracoes(); }

const planningViewRenderer = createPlanningViewRenderer({
  getState: () => state, getCtx: () => ctx, esc, fmtDate, classNameOf, assignmentNameOf, emptyState, ICONS, searchFieldHTML
});

const classViewRenderers = createClassViewRenderers({
  getState: () => state, getCtx: () => ctx, classById, classStats, studentsOf, occurrencesOf, studentById, assignmentsOf, assignmentById, schoolNameOf,
  initials, activityListItemHTML, esc, fmtDate, todayISO, emptyState, badgeFor, ICONS
});




function renderTurmaDetail() { return classViewRenderers.renderTurmaDetail(); }
function renderClassStudentsTab(c) { return classViewRenderers.renderClassStudentsTab(c); }

/* ==================== DASHBOARD ==================== */

function attentionItems() {
  const items = [];
  const today = todayISO();
  (state.plans || []).filter(p => p.date === today).slice(0, 2).forEach(plan => {
    items.push({ tone: 'blue', title: `Planejamento de hoje: ${plan.title}`, sub: `${classNameOf(plan.classId)} · ${fmtDate(plan.date)}`, action: () => navigate('planejamento') });
  });
  activeActivities().filter(a => a.dueDate >= today && a.dueDate <= addDays(3)).sort((a,b) => a.dueDate.localeCompare(b.dueDate)).slice(0,3).forEach(a => {
    items.push({ tone: 'amber', title: `${a.name} acontece em breve`, sub: `${classNameOf(a.classId)} · ${fmtDate(a.dueDate)}`, action: () => { ctx.activityId = a.id; navigate('atividadeDetail', false); } });
  });
  const recentOcc = (state.occurrences || []).filter(o => o.date >= addDays(-7)).sort((a,b) => b.date.localeCompare(a.date));
  recentOcc.slice(0, 3).forEach(o => {
    const student = studentById(o.studentId);
    if (!student) return;
    items.push({ tone: 'red', title: `Registro recente: ${student.name}`, sub: `${classNameOf(student.classId)} · ${fmtDate(o.date)} · ${OCCUR_TYPES.find(t => t.key === o.type)?.label || o.type}`, action: () => { ctx.studentId = student.id; ctx.studentTab = 'historico'; navigate('alunoDetail', false); } });
  });
  activeActivities().filter(a => a.dueDate < today).sort((a,b) => b.dueDate.localeCompare(a.dueDate)).slice(0,2).forEach(a => {
    items.push({ tone: 'blue', title: `${a.name} já passou`, sub: `${classNameOf(a.classId)} · ${fmtDate(a.dueDate)} · confira seus registros se necessário`, action: () => { ctx.activityId = a.id; navigate('atividadeDetail', false); } });
  });
  return items.slice(0, 6);
}

const coreViewRenderers = createCoreViewRenderers({
  getState: () => state,
  getCtx: () => ctx,
  setLastAttentionItems: value => { lastAttentionItems = value; },
  activeStudents, activeActivities, activeClasses,
  classStats, activityStats, studentById, classNameOf, assignmentsOf, schoolById,
  attentionItems, todayISO, greeting, esc, fmtDate,
  emptyState, badgeFor, ICONS, searchFieldHTML, driveLinkForCurrentProject, getDriveAvailable: () => !demoMode && isGoogleDriveConfigured(), getDriveActionPending: () => driveActionPending, getDriveSyncPending: () => isDrivePending(currentMeta)
});

function renderDashboard() { return coreViewRenderers.renderDashboard(); }

/* ==================== TURMAS ==================== */
/* ==================== TURMAS ==================== */

function renderTurmas() { return coreViewRenderers.renderTurmas(); }
function renderEscolas() { return coreViewRenderers.renderEscolas(); }



/* ==================== ALUNOS ==================== */




/* ==================== PERFIL DO ALUNO ==================== */






/* ==================== ATIVIDADES ==================== */




/* ==================== CALENDÁRIO ==================== */



/* ==================== OCORRÊNCIAS (log global) ==================== */


/* ==================== RELATÓRIOS ==================== */


function reportStudentPickerHTML(searchTerm = '', selectedId = '') {
  const term = String(searchTerm || '').trim().toLowerCase();
  let list = state.students;
  if (term) list = list.filter(s => `${s.name} ${classNameOf(s.classId)}`.toLowerCase().includes(term));
  if (selectedId && !list.some(s => s.id === selectedId)) {
    const selected = studentById(selectedId);
    if (selected) list = [selected, ...list];
  }
  return list.map(s => createEntityPickerOption({
    id: s.id, name: s.name, secondary: classNameOf(s.classId), selected: s.id === selectedId,
    icon: `<span class="avatar sm">${initials(s.name)}</span>`, dataAttr: 'data-report-student'
  })).join('') || createEntityPickerEmpty('Nenhum aluno encontrado.');
}

function bindReportStudentPicker() {
  qAll('[data-report-student]').forEach(el => el.onclick = () => {
    ctx.reportStudentId = el.dataset.reportStudent;
    const input = document.getElementById('reportStudentSearch');
    if (input) input.value = studentById(ctx.reportStudentId)?.name || '';
    const hidden = document.getElementById('reportStudentId');
    if (hidden) hidden.value = ctx.reportStudentId || '';
    const list = document.getElementById('reportStudentResults');
    if (list) list.innerHTML = reportStudentPickerHTML(input?.value || '', ctx.reportStudentId);
    bindReportStudentPicker();
  });
}

function openIndividualReportConfig(presetStudentId) {
  ctx.reportStudentId = presetStudentId || ctx.reportStudentId || (state.students[0] && state.students[0].id) || null;
  ctx.reportFrom = ctx.reportFrom || addDays(-60);
  ctx.reportTo = ctx.reportTo || todayISO();
  ctx.reportOpts = ctx.reportOpts || { resumo: true, atividades: true, ocorrencias: true, observacoes: true, linha: true };
  const selectedStudent = studentById(ctx.reportStudentId);
  openModal(`
    <div class="modal-title">Relatório individual do aluno</div>
    <form id="reportConfigForm">
      <div class="form-group"><label class="form-label" for="reportStudentSearch">Aluno</label>
        ${searchFieldHTML('reportStudentSearch', 'Pesquisar aluno...', selectedStudent?.name || '')}
        <input type="hidden" id="reportStudentId" name="studentId" value="${esc(ctx.reportStudentId || '')}">
        <div class="entity-picker-results" id="reportStudentResults">${reportStudentPickerHTML(selectedStudent?.name || '', ctx.reportStudentId || '')}</div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="reportFrom">Período — de</label><input class="form-input" id="reportFrom" type="date" name="from" value="${ctx.reportFrom}"></div>
        <div class="form-group"><label class="form-label" for="reportTo">até</label><input class="form-input" id="reportTo" type="date" name="to" value="${ctx.reportTo}"></div>
      </div>
      <fieldset class="form-group report-options-fieldset"><legend class="form-label">Incluir no relatório</legend>
        ${reportOptCheckbox('resumo', 'Resumo')}${reportOptCheckbox('atividades', 'Atividades')}
        ${reportOptCheckbox('ocorrencias', 'Ocorrências')}${reportOptCheckbox('observacoes', 'Observações')}${reportOptCheckbox('linha', 'Linha do tempo')}
      </fieldset>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="submit" class="btn-primary">Visualizar relatório</button></div>
    </form>
  `);
  const studentSearch = document.getElementById('reportStudentSearch');
  if (studentSearch) studentSearch.oninput = () => {
    const list = document.getElementById('reportStudentResults');
    if (list) list.innerHTML = reportStudentPickerHTML(studentSearch.value, ctx.reportStudentId || '');
    bindReportStudentPicker();
  };
  bindReportStudentPicker();
}
function reportOptCheckbox(key, label) {
  return `<label class="checkbox-row"><input type="checkbox" name="opt_${key}" ${ctx.reportOpts[key] ? 'checked' : ''}> ${label}</label>`;
}


function reportClassPickerHTML(searchTerm = '', selectedId = '') {
  const term = String(searchTerm || '').trim().toLowerCase();
  let list = state.classes;
  if (term) list = list.filter(c => `${c.name} ${schoolNameOf(c.id)}`.toLowerCase().includes(term));
  if (selectedId && !list.some(c => c.id === selectedId)) {
    const selected = classById(selectedId);
    if (selected) list = [selected, ...list];
  }
  return list.map(c => createEntityPickerOption({
    id: c.id, name: c.name, secondary: schoolNameOf(c.id), selected: c.id === selectedId,
    icon: `<span class="avatar sm">${initials(c.name)}</span>`, dataAttr: 'data-report-class'
  })).join('') || createEntityPickerEmpty('Nenhuma turma encontrada.');
}

function bindReportClassPicker() {
  qAll('[data-report-class]').forEach(el => el.onclick = () => {
    ctx.classReportId = el.dataset.reportClass;
    const input = document.getElementById('classReportSearch');
    if (input) input.value = classById(ctx.classReportId)?.name || '';
    const hidden = document.getElementById('classReportId');
    if (hidden) hidden.value = ctx.classReportId || '';
    const list = document.getElementById('classReportResults');
    if (list) list.innerHTML = reportClassPickerHTML(input?.value || '', ctx.classReportId);
    bindReportClassPicker();
  });
}

function openClassReportConfig(presetClassId) {
  ctx.classReportId = presetClassId || ctx.classReportId || (state.classes[0] && state.classes[0].id) || null;
  ctx.classReportFrom = ctx.classReportFrom || addDays(-60);
  ctx.classReportTo = ctx.classReportTo || todayISO();
  const selectedClass = classById(ctx.classReportId);
  openModal(`
    <div class="modal-title">Relatório da turma</div>
    <form id="classReportConfigForm">
      <div class="form-group"><label class="form-label" for="classReportSearch">Turma</label>
        ${searchFieldHTML('classReportSearch', 'Pesquisar turma...', selectedClass?.name || '')}
        <input type="hidden" id="classReportId" name="classId" value="${esc(ctx.classReportId || '')}">
        <div class="entity-picker-results" id="classReportResults">${reportClassPickerHTML(selectedClass?.name || '', ctx.classReportId || '')}</div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="classReportFrom">Período — de</label><input class="form-input" id="classReportFrom" type="date" name="from" value="${ctx.classReportFrom}"></div>
        <div class="form-group"><label class="form-label" for="classReportTo">até</label><input class="form-input" id="classReportTo" type="date" name="to" value="${ctx.classReportTo}"></div>
      </div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="submit" class="btn-primary">Visualizar relatório</button></div>
    </form>
  `);
  const classSearch = document.getElementById('classReportSearch');
  if (classSearch) classSearch.oninput = () => {
    const list = document.getElementById('classReportResults');
    if (list) list.innerHTML = reportClassPickerHTML(classSearch.value, ctx.classReportId || '');
    bindReportClassPicker();
  };
  bindReportClassPicker();
}


function doPrintReport() { window.print(); }

function safeFileName(name) {
  return String(name || 'relatorio')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
    .toLowerCase() || 'relatorio';
}

async function loadScriptOnce(src, globalCheck) {
  if (globalCheck()) return true;
  const existing = document.querySelector(`script[data-lazy-src="${esc(src)}"]`);
  if (existing) {
    await new Promise((resolve, reject) => { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', reject, { once: true }); });
    return globalCheck();
  }
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.async = true; script.dataset.lazySrc = src;
    script.onload = resolve; script.onerror = () => reject(new Error(`Não foi possível carregar ${src}`));
    document.head.appendChild(script);
  });
  return globalCheck();
}

async function ensurePdfLibraries() {
  await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', () => typeof window.html2canvas === 'function');
  await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => !!window.jspdf?.jsPDF);
}

async function doExportPdf() {
  const area = document.getElementById('reportPrintArea');
  if (!area) return;
  try { await ensurePdfLibraries(); } catch (_) {
    toast('O exportador de PDF não pôde ser carregado. Use "Imprimir" e escolha "Salvar como PDF".', 'error');
    return;
  }
  toast('Gerando PDF...', null);
  try {
    const canvas = await window.html2canvas(area, {
      scale: Math.min(2, window.devicePixelRatio || 1.5),
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false
    });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.94);

    let remaining = imgH;
    let position = 0;
    pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH, undefined, 'FAST');
    remaining -= pageH;

    while (remaining > 0.5) {
      position = remaining - imgH;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH, undefined, 'FAST');
      remaining -= pageH;
    }

    const student = ctx.reportStudentId ? studentById(ctx.reportStudentId) : null;
    const turma = ctx.classReportId ? classById(ctx.classReportId) : null;
    const base = student ? `relatorio-${safeFileName(student.name)}` : turma ? `relatorio-${safeFileName(turma.name)}` : 'relatorio-professorgest';
    pdf.save(`${base}.pdf`);
    toast('Relatório exportado em PDF.', 'success');
  } catch (err) {
    logError('report.pdf.export_failed', err);
    toast('Não foi possível exportar o PDF. Tente "Imprimir".', 'error');
  }
}




function downloadFallback(content, filename, mime) {
  try {
    return downloadTextFile(content, filename, mime);
  } catch (err) {
    logError('file.download.failed', err, { filename, mime });
    throw err;
  }
}





/* ==================== ARQUIVO / CONFIGURAÇÕES ==================== */



/* ==================== MODAIS: formulários ==================== */

function classOptions(selectedId = '') {
  return `<option value="" ${selectedId ? '' : 'selected'}>Sem turma / definir depois</option>` + state.classes.filter(c => !c.archived || c.id === selectedId).map(c => `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}
function assignmentOptions(classId, selectedId = '') { const list = classId ? assignmentsOf(classId) : []; return `<option value="" ${selectedId ? '' : 'selected'}>${list.length ? 'Sem disciplina / contexto geral' : 'Sem disciplina cadastrada'}</option>` + list.map(a => `<option value="${esc(a.id)}" ${a.id === selectedId ? 'selected' : ''}>${esc(a.subject)}</option>`).join(''); }

function openAddClassModal() {
  openModal(`
    <div class="modal-title">Adicionar turma</div>
    <p class="confirm-body">Escolha como esta turma deve entrar no ProfessorGest. Importar do DED+ adiciona a turma ao seu arquivo e não substitui as que já existem.</p>
    <div class="choice-grid">
      <button type="button" class="choice-card" id="btnCreateClassManual">
        <span class="choice-card-icon">${ICONS.plus}</span>
        <span><strong>Criar manualmente</strong><small>Começar uma turma do zero.</small></span>
      </button>
      <button type="button" class="choice-card primary" id="btnImportDed">
        <span class="choice-card-icon">${ICONS.file}</span>
        <span><strong>Importar do DED+</strong><small>Adicionar uma ou várias turmas a partir de PDFs exportados pelo DED.</small></span>
      </button>
    </div>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button></div>
  `, false, 'class-choice-modal');
  onClick('#btnCreateClassManual', () => { closeModal(); openClassModal(null); });
  onClick('#btnImportDed', () => { closeModal(); openDedImportModal(); });
}













function openClassModal(existing) {
  const school = existing?.schoolId ? schoolById(existing.schoolId) : null;
  const assignment = assignmentsOf(existing?.id || '')[0] || null;
  openModal(`
    <div class="modal-title">${existing ? 'Editar turma' : 'Nova turma'}</div>
    <form id="classForm">
      <div class="form-group"><label class="form-label" for="classNameInput">Nome da turma</label><input class="form-input" id="classNameInput" name="name" required value="${existing ? esc(existing.name) : ''}" placeholder="Ex.: 2º Ano A"></div>
      <div class="form-row"><div class="form-group"><label class="form-label" for="classSchoolInput">Escola</label><input class="form-input" id="classSchoolInput" name="schoolName" value="${esc(school?.name || existing?.ded?.schoolName || '')}" placeholder="Ex.: Escola Estadual Aurora"></div><div class="form-group"><label class="form-label" for="classSubjectInput">Disciplina</label><input class="form-input" id="classSubjectInput" name="subject" value="${esc(assignment?.subject || existing?.ded?.component || '')}" placeholder="Ex.: Língua Inglesa"></div></div>
      <div class="form-row"><div class="form-group"><label class="form-label" for="classYearInput">Ano letivo</label><input class="form-input" id="classYearInput" name="year" value="${esc(existing?.year || existing?.ded?.year || '')}" placeholder="Ex.: 2026"></div><div class="form-group"><label class="form-label" for="classShiftInput">Turno</label><input class="form-input" id="classShiftInput" name="shift" value="${esc(existing?.shift || existing?.ded?.shift || '')}" placeholder="Ex.: Manhã"></div></div>
      <p class="form-hint">A escola e a disciplina são informações da atuação, não do perfil do professor. Uma turma pode ter várias disciplinas.</p>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="submit" class="btn-primary">${existing ? 'Salvar' : 'Criar turma'}</button></div>
    </form>
  `);
  document.getElementById('classForm').dataset.editId = existing ? existing.id : '';
}

function openStudentModal(existing, presetClassId) {
  openModal(`
    <div class="modal-title">${existing ? 'Editar aluno' : 'Novo aluno'}</div>
    <form id="studentForm">
      <div class="form-group"><label class="form-label" for="studentNameInput">Nome do aluno</label>
        <input class="form-input" id="studentNameInput" name="name" required value="${existing ? esc(existing.name) : ''}" placeholder="Nome completo"></div>
      <div class="form-group"><label class="form-label" for="studentClassInput">Turma</label><select class="form-select" id="studentClassInput" name="classId">${classOptions(existing ? existing.classId : presetClassId)}</select></div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button>
        <button type="submit" class="btn-primary">${existing ? 'Salvar' : 'Adicionar aluno'}</button></div>
    </form>
  `);
  document.getElementById('studentForm').dataset.editId = existing ? existing.id : '';
}

function openMoveStudentModal(studentIds) {
  const ids = [...new Set((studentIds || []).filter(Boolean))];
  const students = ids.map(studentById).filter(Boolean);
  if (!students.length) return;
  const currentClassIds = new Set(students.map(student => student.classId).filter(Boolean));
  const options = state.classes.filter(c => !c.archived || currentClassIds.has(c.id)).map(c => `<option value="${esc(c.id)}" ${students.length === 1 && students[0].classId === c.id ? 'selected' : ''}>${esc(c.name)}${c.archived ? ' — arquivada' : ''}</option>`).join('');
  openModal(`
    <div class="modal-title">${students.length > 1 ? 'Mudar alunos de turma' : 'Mudar aluno de turma'}</div>
    <p class="confirm-body">${students.length > 1 ? `<strong>${students.length} alunos</strong> serão movidos para a turma escolhida.` : `<strong>${esc(students[0].name)}</strong> será movido para a turma escolhida.`} O histórico de atividades, observações e ocorrências será mantido.</p>
    <form id="moveStudentForm">
      <input type="hidden" name="studentIds" value="${esc(ids.join(','))}">
      <div class="form-group"><label class="form-label" for="moveStudentClassInput">Nova turma</label><select class="form-select" id="moveStudentClassInput" name="classId" required>${options}</select></div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="submit" class="btn-primary">${students.length > 1 ? 'Mudar alunos' : 'Mudar de turma'}</button></div>
    </form>
  `);
}

function openActivityModal(existing, presetClassId) {
  const classId = existing?.classId || presetClassId || ctx.classId || '';
  openModal(`
    <div class="modal-title">${existing ? 'Editar atividade' : 'Nova atividade'}</div>
    <form id="activityForm">
      <div class="form-group"><label class="form-label" for="activityNameInput">Nome da atividade</label><input class="form-input" id="activityNameInput" name="name" required value="${existing ? esc(existing.name) : ''}" placeholder="Ex: Lista de exercícios"></div>
      <div class="form-row"><div class="form-group"><label class="form-label" for="studentClassInput">Turma</label><select class="form-select" id="studentClassInput" name="classId">${classOptions(classId)}</select></div><div class="form-group"><label class="form-label" for="activityAssignmentInput">Disciplina</label><select class="form-select" id="activityAssignmentInput" name="assignmentId">${assignmentOptions(classId, existing?.assignmentId || ctx.assignmentId || '')}</select></div></div>
      <div class="form-group"><label class="form-label" for="activityDueDateInput">Data da atividade</label><input class="form-input" id="activityDueDateInput" type="date" name="dueDate" required value="${existing ? existing.dueDate : todayISO()}"></div>
      <div class="form-group"><label class="form-label" for="activityDescriptionInput">Descrição</label><textarea class="form-textarea" id="activityDescriptionInput" name="description" placeholder="Opcional">${existing ? esc(existing.description || '') : ''}</textarea></div>
      <p class="form-hint">A disciplina define em qual atuação a atividade será organizada. Uma turma pode ter mais de uma disciplina.</p>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="submit" class="btn-primary">${existing ? 'Salvar alterações' : 'Criar atividade'}</button></div>
    </form>`);
  document.getElementById('activityForm').dataset.editId = existing ? existing.id : '';
  document.getElementById('studentClassInput')?.addEventListener('change', e => { const a=document.getElementById('activityAssignmentInput'); if(a) a.innerHTML=assignmentOptions(e.target.value,''); });
}

function openPlanningModal(existing, presetClassId = '') {
  const classId = existing?.classId || presetClassId || ctx.classId || '';
  openModal(`
    <div class="modal-title">${existing ? 'Editar planejamento' : 'Novo planejamento'}</div>
    <form id="planningForm">
      <div class="form-row"><div class="form-group"><label class="form-label" for="planningDateInput">Data da aula</label><input class="form-input" id="planningDateInput" type="date" name="date" required value="${existing ? existing.date : todayISO()}"></div><div class="form-group"><label class="form-label" for="planningClassInput">Turma</label><select class="form-select" id="planningClassInput" name="classId" required>${classOptions(classId)}</select></div><div class="form-group"><label class="form-label" for="planningAssignmentInput">Disciplina</label><select class="form-select" id="planningAssignmentInput" name="assignmentId">${assignmentOptions(classId, existing?.assignmentId || ctx.assignmentId || '')}</select></div></div>
      <div class="form-group"><label class="form-label" for="planningTitleInput">Tema da aula</label><input class="form-input" id="planningTitleInput" name="title" required value="${existing ? esc(existing.title) : ''}" placeholder="Ex.: Frações equivalentes"></div>
      <div class="form-group"><label class="form-label" for="planningContentInput">Conteúdo</label><textarea class="form-textarea" id="planningContentInput" name="content" placeholder="O que será trabalhado nesta aula?">${existing ? esc(existing.content || '') : ''}</textarea></div>
      <div class="form-group"><label class="form-label" for="planningObjectivesInput">Objetivos de aprendizagem</label><textarea class="form-textarea" id="planningObjectivesInput" name="objectives" placeholder="O que os alunos deverão compreender ou conseguir fazer?">${existing ? esc(existing.objectives || '') : ''}</textarea></div>
      <div class="form-group"><label class="form-label" for="planningMethodologyInput">Como será a aula?</label><textarea class="form-textarea" id="planningMethodologyInput" name="methodology" placeholder="Ex.: explicação, atividade em grupo, exercícios...">${existing ? esc(existing.methodology || '') : ''}</textarea></div>
      <div class="form-row"><div class="form-group"><label class="form-label" for="planningResourcesInput">Recursos</label><textarea class="form-textarea" id="planningResourcesInput" name="resources" placeholder="Livro, quadro, projetor...">${existing ? esc(existing.resources || '') : ''}</textarea></div><div class="form-group"><label class="form-label" for="planningAssessmentInput">Acompanhamento / avaliação</label><textarea class="form-textarea" id="planningAssessmentInput" name="assessment" placeholder="Como você pretende observar a aprendizagem?">${existing ? esc(existing.assessment || '') : ''}</textarea></div></div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="submit" class="btn-primary">${existing ? 'Salvar planejamento' : 'Criar planejamento'}</button></div>
    </form>` , true);
  document.getElementById('planningForm').dataset.editId = existing ? existing.id : '';
  document.getElementById('planningClassInput')?.addEventListener('change', e => { const a=document.getElementById('planningAssignmentInput'); if(a) a.innerHTML=assignmentOptions(e.target.value,''); });
}

function openPlanningViewModal(plan) {
  if (!plan) return;
  const field = (label, value) => `<section class="planning-detail-section"><div class="planning-detail-label">${label}</div><div class="planning-detail-value">${value ? esc(value).replace(/\n/g, '<br>') : '<span class="planning-detail-empty">Não preenchido</span>'}</div></section>`;
  openModal(`
    <div class="planning-detail-modal">
      <div class="modal-title">${esc(plan.title)}</div>
      <div class="planning-detail-meta">${fmtDate(plan.date)} · ${esc(classNameOf(plan.classId))}</div>
      ${field('Conteúdo', plan.content)}
      ${field('Objetivos de aprendizagem', plan.objectives)}
      ${field('Como será a aula?', plan.methodology)}
      ${field('Recursos', plan.resources)}
      ${field('Acompanhamento / avaliação', plan.assessment)}
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Fechar</button><button type="button" class="btn-primary" id="btnEditPlanningFromView">${ICONS.edit} Editar planejamento</button></div>
    </div>
  `, true);
  onClick('#btnEditPlanningFromView', () => { closeModal(); openPlanningModal(plan); });
}

function duplicatePlanning(planId) {
  const source = (state.plans || []).find(plan => plan.id === planId);
  if (!source) return;
  openPlanningModal({ ...source, id: '', date: source.date, title: `${source.title} — cópia` });
}

function openStudentActionsModal(student) {
  if (!student) return;
  openModal(`
    <div class="modal-title">Ações para ${esc(student.name)}</div>
    <p class="confirm-body">Escolha o que deseja fazer com este aluno.</p>
    <div class="action-list">
      <button type="button" class="action-list-item" id="studentActionEdit">${ICONS.edit}<span><strong>Editar aluno</strong><small>Atualizar nome ou turma</small></span></button>
      <button type="button" class="action-list-item" id="studentActionMove">${ICONS.move}<span><strong>Mudar de turma</strong><small>Transferir mantendo o histórico</small></span></button>
      <button type="button" class="action-list-item" id="studentActionReport">${ICONS.report}<span><strong>Gerar relatório</strong><small>Escolher período e conteúdo</small></span></button>
    </div>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Fechar</button></div>
  `);
  onClick('#studentActionEdit', () => { closeModal(); openStudentModal(student); });
  onClick('#studentActionMove', () => { closeModal(); openMoveStudentModal([student.id]); });
  onClick('#studentActionReport', () => { closeModal(); openIndividualReportConfig(student.id); });
}

function openObservationModal(student, existing) {
  openModal(`
    <div class="modal-title">${existing ? 'Editar observação' : 'Nova observação'}</div>
    <form id="observationForm">
      <div class="form-group"><label class="form-label" for="observationDateInput">Data</label><input class="form-input" id="observationDateInput" type="date" name="date" value="${existing ? existing.date : todayISO()}"></div>
      <div class="form-group"><label class="form-label" for="observationTextInput">Observação</label><textarea class="form-textarea" id="observationTextInput" name="text" required placeholder="Ex: Demonstrou avanço em leitura esta semana.">${existing ? esc(existing.text) : ''}</textarea></div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button>
        <button type="submit" class="btn-primary">${existing ? 'Salvar' : 'Adicionar'}</button></div>
    </form>
  `);
  document.getElementById('observationForm').dataset.studentId = student.id;
  document.getElementById('observationForm').dataset.editId = existing ? existing.id : '';
}

/* --- registro rápido: "Quem?" -> "O que aconteceu?" (também usado em massa) --- */

function openOccurrenceModal(presetStudentId, editingOcc) {
  if (editingOcc) { openOccurrenceStep2([editingOcc.studentId], editingOcc); return; }
  if (presetStudentId) { openOccurrenceStep2([presetStudentId], null); return; }
  openOccurrenceStep1('');
}

function occurrenceStudentListHTML(searchTerm = '', presetClassId = '') {
  const term = (searchTerm || '').trim().toLowerCase();
  let list = presetClassId ? studentsOf(presetClassId) : state.students;
  if (term) list = list.filter(s => `${s.name} ${classNameOf(s.classId)}`.toLowerCase().includes(term));
  return {
    term,
    html: list.map(s => createEntityPickerOption({
      id: s.id, name: s.name, secondary: classNameOf(s.classId),
      icon: `<span class="avatar sm">${initials(s.name)}</span>`, dataAttr: 'data-pick-student'
    })).join('') || createEntityPickerEmpty(term ? 'Nenhum aluno encontrado.' : 'Nenhum aluno acompanhado ainda.')
  };
}

function bindOccurrenceStudentPicker(presetClassId = '') {
  qAll('[data-pick-student]').forEach(el => el.onclick = () => openOccurrenceStep2([el.dataset.pickStudent], null));
}

function openOccurrenceStep1(searchTerm, presetClassId = '') {
  const result = occurrenceStudentListHTML(searchTerm, presetClassId);
  openModal(`
    <div class="modal-title">Registrar ocorrência</div>
    <div class="form-group"><label class="form-label" for="quickSearchInput">Quem?</label>
      ${searchFieldHTML('quickSearchInput', 'Pesquisar aluno...', searchTerm || '')}</div>
    <div class="list-card quick-student-list" id="quickStudentList">${result.html}</div>
    <div class="quick-add-student" id="quickAddStudentWrap">${result.term ? `<button type="button" class="btn-secondary btn-sm" id="quickAddStudentBtn">${ICONS.plus} Adicionar “${esc(String(searchTerm || '').trim())}” como aluno</button>` : '<span class="form-hint">Adicione o aluno somente quando precisar acompanhá-lo.</span>'}</div>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button></div>
  `);
  const input = document.getElementById('quickSearchInput');
  input.oninput = () => {
    const next = occurrenceStudentListHTML(input.value, presetClassId);
    const list = document.getElementById('quickStudentList');
    if (list) list.innerHTML = next.html;
    const wrap = document.getElementById('quickAddStudentWrap');
    if (wrap) wrap.innerHTML = next.term ? `<button type="button" class="btn-secondary btn-sm" id="quickAddStudentBtn">${ICONS.plus} Adicionar “${esc(input.value.trim())}” como aluno</button>` : '<span class="form-hint">Adicione o aluno somente quando precisar acompanhá-lo.</span>';
    bindOccurrenceStudentPicker(presetClassId);
    onClick('#quickAddStudentBtn', () => openQuickAddStudentModal(input.value, presetClassId));
  };
  bindOccurrenceStudentPicker(presetClassId);
  onClick('#quickAddStudentBtn', () => openQuickAddStudentModal(searchTerm, presetClassId));
}

function openQuickAddStudentModal(suggestedName = '', presetClassId = '') {
  openModal(`
    <div class="modal-title">Adicionar aluno</div>
    <p class="confirm-body">Adicione somente o aluno que você precisa acompanhar agora. Depois, continue o registro desta ocorrência.</p>
    <form id="quickStudentCreateForm">
      <div class="form-group"><label class="form-label" for="quickStudentName">Nome do aluno</label><input class="form-input" id="quickStudentName" name="name" required value="${esc(suggestedName)}"></div>
      <div class="form-group"><label class="form-label" for="quickStudentClass">Turma</label><select class="form-select" id="quickStudentClass" name="classId">${classOptions(presetClassId)}</select></div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Voltar</button><button type="submit" class="btn-primary">Adicionar e continuar</button></div>
    </form>`);
}

function openOccurrenceStep2(studentIds, editingOcc) {
  const students = studentIds.map(studentById).filter(Boolean);
  if (!students.length) { openOccurrenceStep1(''); return; }
  const occurrenceIcons = { nao_atividade: ICONS.alert, conversou: ICONS.bell, faltou: ICONS.calendar, participou: ICONS.check, bom_comportamento: ICONS.check, observacao: ICONS.file };
  const opts = OCCUR_TYPES.map(t => `<button type="button" class="quick-opt ${editingOcc && editingOcc.type === t.key ? 'selected' : ''}" data-occ-type="${esc(t.key)}"><span class="quick-opt-icon" aria-hidden="true">${occurrenceIcons[t.key] || ICONS.file}</span><span>${t.label}</span></button>`).join('');
  const multi = students.length > 1;
  openModal(`
    <div class="modal-title">${editingOcc ? 'Editar ocorrência' : 'O que aconteceu?'}</div>
    <div class="list-item-sub student-selection-summary">
      ${multi ? `Alunos selecionados: <strong>${students.length}</strong>` : `Aluno: <strong>${esc(students[0].name)}</strong>`}
      ${(editingOcc || multi) ? '' : `<button type="button" class="btn-icon change-student-button" id="changeStudentBtn">trocar aluno</button>`}
    </div>
    <form id="occurForm">
      <input type="hidden" name="studentIds" value="${studentIds.join(',')}">
      <div class="form-group"><div class="quick-options" id="occTypeOptions">${opts}</div>
        <input type="hidden" name="type" value="${editingOcc ? editingOcc.type : ''}" required></div>
      <div class="form-group"><label class="form-label" for="observationDateInput">Data</label><input class="form-input" id="observationDateInput" type="date" name="date" value="${editingOcc ? editingOcc.date : todayISO()}"></div>
      <div class="form-row"><div class="form-group"><label class="form-label" for="occurrenceClassInput">Turma</label><select class="form-select" id="occurrenceClassInput" name="classId">${classOptions(students[0]?.classId || editingOcc?.classId || ctx.classId || '')}</select></div><div class="form-group"><label class="form-label" for="occurrenceAssignmentInput">Disciplina</label><select class="form-select" id="occurrenceAssignmentInput" name="assignmentId">${assignmentOptions(students[0]?.classId || editingOcc?.classId || ctx.classId || '', editingOcc?.assignmentId || ctx.assignmentId || '')}</select></div></div>
      <div class="form-group"><label class="form-label" for="occurrenceDescriptionInput">Descrição (opcional)</label><textarea class="form-textarea" id="occurrenceDescriptionInput" name="description" placeholder="Detalhes...">${editingOcc ? esc(editingOcc.description || '') : ''}</textarea></div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button>
        <button type="submit" class="btn-primary">${editingOcc ? 'Salvar alterações' : (multi ? 'Registrar para todos' : 'Registrar')}</button></div>
    </form>
  `);
  document.getElementById('occurForm').dataset.editId = editingOcc ? editingOcc.id : '';
  document.getElementById('occurrenceClassInput')?.addEventListener('change', e => { const a=document.getElementById('occurrenceAssignmentInput'); if(a) a.innerHTML=assignmentOptions(e.target.value,''); });
  const changeBtn = document.getElementById('changeStudentBtn');
  if (changeBtn) changeBtn.onclick = () => openOccurrenceStep1('', ctx.classId || '');
}

function bindModalEvents() {
  const cancel = document.getElementById('modalCancel');
  if (cancel) cancel.onclick = closeModal;

  const classForm = document.getElementById('classForm');
  if (classForm) classForm.onsubmit = e => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const schoolName = e.target.schoolName.value.trim();
    const subject = e.target.subject.value.trim();
    const year = e.target.year.value.trim();
    const shift = e.target.shift.value.trim();
    const editId = classForm.dataset.editId;
    let cls = editId ? classById(editId) : null;
    if (!cls) { cls = { id: uid('class'), name, archived: false, schoolId: null, year, shift, classCode: '' }; state.classes.push(cls); }
    cls.name = name; cls.year = year; cls.shift = shift;
    if (schoolName) {
      const key = normalizeDedClassKey(schoolName);
      let school = state.schools.find(item => normalizeDedClassKey(item.name) === key);
      if (!school) { school = { id: uid('school'), name: schoolName, code: '', sre: '', address: '' }; state.schools.push(school); }
      cls.schoolId = school.id;
    }
    if (subject) {
      state.assignments = Array.isArray(state.assignments) ? state.assignments : [];
      let assignment = state.assignments.find(a => a.classId === cls.id && normalizeDedClassKey(a.subject) === normalizeDedClassKey(subject));
      if (!assignment) { assignment = { id: uid('assign'), classId: cls.id, schoolId: cls.schoolId || null, subject, teacherName: state.teacher?.name || '', year, ded: null }; state.assignments.push(assignment); }
      else { assignment.subject = subject; assignment.schoolId = cls.schoolId || assignment.schoolId || null; assignment.year = year || assignment.year || ''; }
    }
    toast(editId ? 'Turma salva com sucesso.' : 'Turma criada com sucesso.', 'success');
    markDirty(); closeModal(); render();
  };

  const quickStudentCreateForm = document.getElementById('quickStudentCreateForm');
  if (quickStudentCreateForm) quickStudentCreateForm.onsubmit = e => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const classId = e.target.classId.value || null;
    const student = { id: uid('stu'), name, classId, notes: '', observations: [], enrollmentIds: [] };
    state.students.push(student); if (classId) ensureEnrollment(student, classId);
    markDirty();
    toast('Aluno adicionado. Agora registre a ocorrência.', 'success');
    openOccurrenceStep2([student.id], null);
  };

  const studentForm = document.getElementById('studentForm');
  if (studentForm) studentForm.onsubmit = e => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const classId = e.target.classId.value || null;
    const editId = studentForm.dataset.editId;
    if (editId) { const s = studentById(editId); s.name = name; s.classId = classId; toast('Aluno salvo com sucesso.', 'success'); }
    else { const student = { id: uid('stu'), name, classId, notes: '', observations: [], enrollmentIds: [] }; state.students.push(student); if (classId) ensureEnrollment(student, classId); toast('Aluno adicionado com sucesso.', 'success'); }
    markDirty(); closeModal(); render();
  };

  const moveStudentForm = document.getElementById('moveStudentForm');
  if (moveStudentForm) moveStudentForm.onsubmit = e => {
    e.preventDefault();
    const ids = String(e.target.studentIds.value || '').split(',').filter(Boolean);
    const classId = e.target.classId.value;
    const targetClass = classById(classId);
    if (!targetClass || targetClass.archived) { toast('Escolha uma turma ativa.', 'error'); return; }
    let moved = 0;
    ids.forEach(id => {
      const student = studentById(id);
      if (student && student.classId !== classId) { student.classId = classId; ensureEnrollment(student, classId); moved++; }
    });
    if (!moved) { toast('Nenhum aluno precisou ser movido.', 'info'); closeModal(); return; }
    markDirty(); closeModal();
    ctx.bulkMode = false; ctx.bulkSelected = new Set();
    toast(`${moved} ${moved === 1 ? 'aluno movido' : 'alunos movidos'} para ${targetClass.name}. O histórico foi mantido.`, 'success');
    render();
  };

  const activityForm = document.getElementById('activityForm');
  if (activityForm) activityForm.onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    const editId = activityForm.dataset.editId;
    if (editId) {
      const a = state.activities.find(x => x.id === editId);
      a.name = f.name.value.trim(); a.classId = f.classId.value; a.assignmentId = f.assignmentId.value || null; a.dueDate = f.dueDate.value; a.description = f.description.value.trim();
      toast('Atividade salva com sucesso.', 'success');
    } else {
      state.activities.push({ id: uid('act'), name: f.name.value.trim(), classId: f.classId.value || null, assignmentId: f.assignmentId.value || null, dueDate: f.dueDate.value, description: f.description.value.trim() });
      toast('Atividade criada com sucesso.', 'success');
    }
    markDirty(); closeModal(); render();
  };

  const planningForm = document.getElementById('planningForm');
  if (planningForm) planningForm.onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    const title = f.title.value.trim();
    if (!title || !f.date.value || !f.classId.value) return;
    state.plans = Array.isArray(state.plans) ? state.plans : [];
    const editId = planningForm.dataset.editId;
    const data = {
      date: f.date.value, classId: f.classId.value, assignmentId: f.assignmentId.value || null, title,
      content: f.content.value.trim(), objectives: f.objectives.value.trim(),
      methodology: f.methodology.value.trim(), resources: f.resources.value.trim(),
      assessment: f.assessment.value.trim()
    };
    if (editId) {
      const plan = state.plans.find(item => item.id === editId);
      if (plan) Object.assign(plan, data);
      toast('Planejamento atualizado.', 'success');
    } else {
      state.plans.push({ id: uid('plan'), ...data });
      toast('Planejamento criado.', 'success');
    }
    markDirty(); closeModal(); render();
  };

  const observationForm = document.getElementById('observationForm');
  if (observationForm) observationForm.onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    const s = studentById(observationForm.dataset.studentId);
    if (!s) return;
    s.observations = s.observations || [];
    const editId = observationForm.dataset.editId;
    if (editId) { const o = s.observations.find(x => x.id === editId); o.date = f.date.value || todayISO(); o.text = f.text.value.trim(); }
    else s.observations.push({ id: uid('obs'), date: f.date.value || todayISO(), text: f.text.value.trim() });
    markDirty(); closeModal(); toast('Observação salva com sucesso.', 'success'); render();
  };

  document.querySelectorAll('[data-occ-type]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-occ-type]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.querySelector('#occurForm input[name="type"]').value = btn.dataset.occType;
    };
  });

  const occurForm = document.getElementById('occurForm');
  if (occurForm) occurForm.onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    if (!f.type.value) { toast('Selecione o tipo de ocorrência.', 'error'); return; }
    const editId = occurForm.dataset.editId;
    if (editId) {
      const o = state.occurrences.find(x => x.id === editId);
      o.date = f.date.value || todayISO(); o.type = f.type.value; o.classId = f.classId.value || o.classId || null; o.assignmentId = f.assignmentId.value || o.assignmentId || null; o.description = f.description.value.trim();
      toast('Ocorrência atualizada com sucesso.', 'success');
    } else {
      const ids = f.studentIds.value.split(',').filter(Boolean);
      ids.forEach(sid => state.occurrences.push({ id: uid('occ'), studentId: sid, classId: f.classId.value || studentById(sid)?.classId || null, assignmentId: f.assignmentId.value || null, date: f.date.value || todayISO(), type: f.type.value, description: f.description.value.trim() }));
      toast(ids.length > 1 ? `Ocorrência registrada para ${ids.length} alunos.` : 'Ocorrência registrada com sucesso.', 'success');
    }
    markDirty(); closeModal();
    ctx.bulkMode = false; ctx.bulkSelected = new Set();
    render();
  };

  qAll('[data-pick-student]').forEach(el => el.onclick = () => openOccurrenceStep2([el.dataset.pickStudent], null));

  const reportConfigForm = document.getElementById('reportConfigForm');
  if (reportConfigForm) reportConfigForm.onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    const from = f.from.value || addDays(-60);
    const to = f.to.value || todayISO();
    if (from > to) { toast('A data inicial não pode ser posterior à data final.', 'error'); return; }
    const changedStudent = ctx.reportStudentId !== f.studentId.value;
    ctx.reportStudentId = f.studentId.value;
    ctx.reportFrom = from;
    ctx.reportTo = to;
    ctx.reportOpts = {
      resumo: f.opt_resumo.checked, atividades: f.opt_atividades.checked,
      ocorrencias: f.opt_ocorrencias.checked, observacoes: f.opt_observacoes.checked,
      linha: f.opt_linha.checked
    };
    if (changedStudent) ctx.reportSynthesis = '';
    closeModal(); navigate('relatorioIndividual', false);
  };

  const classReportConfigForm = document.getElementById('classReportConfigForm');
  if (classReportConfigForm) classReportConfigForm.onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    const from = f.from.value || addDays(-60);
    const to = f.to.value || todayISO();
    if (from > to) { toast('A data inicial não pode ser posterior à data final.', 'error'); return; }
    ctx.classReportId = f.classId.value;
    ctx.classReportFrom = from;
    ctx.classReportTo = to;
    closeModal(); navigate('relatorioTurma', false);
  };
}

/* ==================== COMMAND PALETTE (Ctrl+K) ==================== */

function openCommandPalette(term) {
  if (!state) return;
  const root = document.getElementById('cmdkRoot');
  const t = (term || '').trim().toLowerCase();

  const actions = [
    { icon: 'plus', label: 'Registrar ocorrência', run: () => openOccurrenceModal() },
    { icon: 'users', label: 'Nova turma', run: () => openClassModal(null) },
    { icon: 'user', label: 'Novo aluno', run: () => openStudentModal(null, null) },
    { icon: 'clipboard', label: 'Nova atividade', run: () => openActivityModal(null) },
    { icon: 'notebook', label: 'Novo planejamento', run: () => openPlanningModal(null, '') },
    { icon: 'folder', label: 'Seus projetos', run: () => closeCurrentProject() },
    { icon: 'file', label: 'Novo projeto', run: () => openNewProjectChooser({ fromWorkspace: true }) },
    { icon: 'refresh', label: 'Atualizar projeto com DED+', run: () => openDedPicker({ newProject: false }) },
    { icon: 'sparkle', label: 'Explorar demonstração', run: () => beginDemoMode() },
    { icon: 'cloud', label: currentDriveLink() ? 'Sincronizar agora com o Google Drive' : 'Enviar ao Google Drive', run: () => syncProjectNow(state.projectId) },
  ].filter(a => !t || a.label.toLowerCase().includes(t));

  const classes = state.classes.filter(c => !t || c.name.toLowerCase().includes(t)).slice(0, 5);
  const students = state.students.filter(s => !t || s.name.toLowerCase().includes(t)).slice(0, 6);
  const activities = state.activities.filter(a => !t || [a.name, a.description, classNameOf(a.classId)].some(v => String(v || '').toLowerCase().includes(t))).slice(0, 5);
  const plans = (state.plans || []).filter(plan => !t || [plan.title, plan.content, plan.objectives, plan.methodology, classNameOf(plan.classId)]
    .some(v => String(v || '').toLowerCase().includes(t))).slice(0, 5);

  const hasResults = actions.length || classes.length || students.length || activities.length || plans.length;

  root.innerHTML = `
    <div class="cmdk-overlay" id="cmdkOverlay">
      <div class="cmdk-box">
        <div class="cmdk-input-row">
          ${ICONS.search}
          <input class="cmdk-input" id="cmdkInput" placeholder="Buscar alunos, turmas, atividades, planejamentos ou ações..." value="${esc(term || '')}">
          <span class="cmdk-esc">ESC</span>
          <button class="cmdk-close" id="cmdkCloseBtn" type="button" aria-label="Fechar pesquisa" title="Fechar pesquisa">${ICONS.x}</button>
        </div>
        <div class="cmdk-results">
          ${!hasResults ? `<div class="cmdk-empty">Nenhum resultado encontrado.</div>` : `
          ${students.length ? `<div class="cmdk-group-label">ALUNOS</div>${students.map(s => `<div class="cmdk-item" data-cmdk-student="${esc(s.id)}">${ICONS.user}<span>${esc(s.name)}</span><span class="cmdk-item-sub">${esc(classNameOf(s.classId))}</span></div>`).join('')}` : ''}
          ${classes.length ? `<div class="cmdk-group-label">TURMAS</div>${classes.map(c => `<div class="cmdk-item" data-cmdk-class="${esc(c.id)}">${ICONS.users}<span>${esc(c.name)}</span></div>`).join('')}` : ''}
          ${activities.length ? `<div class="cmdk-group-label">ATIVIDADES</div>${activities.map(a => `<div class="cmdk-item" data-cmdk-activity="${esc(a.id)}">${ICONS.clipboard}<span>${esc(a.name)}</span><span class="cmdk-item-sub">${esc(classNameOf(a.classId))} · ${fmtDate(a.dueDate)}</span></div>`).join('')}` : ''}
          ${plans.length ? `<div class="cmdk-group-label">PLANEJAMENTOS</div>${plans.map(plan => `<div class="cmdk-item" data-cmdk-plan="${esc(plan.id)}">${ICONS.calendar}<span>${esc(plan.title)}</span><span class="cmdk-item-sub">${esc(classNameOf(plan.classId))} · ${fmtDate(plan.date)}</span></div>`).join('')}` : ''}
          ${actions.length ? `<div class="cmdk-group-label">AÇÕES</div>${actions.map((a, i) => `<div class="cmdk-item" data-cmdk-action="${esc(i)}">${ICONS[a.icon]}<span>${esc(a.label)}</span></div>`).join('')}` : ''}
          `}
        </div>
      </div>
    </div>`;

  document.getElementById('cmdkOverlay').addEventListener('mousedown', e => { if (e.target.id === 'cmdkOverlay') closeCommandPalette(); });
  document.getElementById('cmdkCloseBtn').onclick = closeCommandPalette;
  const input = document.getElementById('cmdkInput');
  input.oninput = () => openCommandPalette(input.value);
  input.focus();
  if (term) input.setSelectionRange(term.length, term.length);

  qAll('[data-cmdk-student]').forEach(el => el.onclick = () => { closeCommandPalette(); ctx.studentId = el.dataset.cmdkStudent; ctx.studentTab = 'visao'; navigate('alunoDetail', false); });
  qAll('[data-cmdk-class]').forEach(el => el.onclick = () => { closeCommandPalette(); ctx.classId = el.dataset.cmdkClass; ctx.classTab = 'visao'; navigate('turmaDetail', false); });
  qAll('[data-cmdk-activity]').forEach(el => el.onclick = () => { closeCommandPalette(); ctx.activityId = el.dataset.cmdkActivity; navigate('atividadeDetail', false); });
  qAll('[data-cmdk-plan]').forEach(el => el.onclick = () => { closeCommandPalette(); const plan = (state.plans || []).find(item => item.id === el.dataset.cmdkPlan); if (plan) openPlanningViewModal(plan); });
  qAll('[data-cmdk-action]').forEach(el => el.onclick = () => { const a = actions[Number(el.dataset.cmdkAction)]; closeCommandPalette(); if (a) a.run(); });
}

function closeCommandPalette() { document.getElementById('cmdkRoot').innerHTML = ''; }

/* ==================== interações da view ==================== */

function bindViewEvents() {
  const keyboardTargets = qAll('[data-open-class],[data-open-student],[data-open-activity],[data-pick-student],[data-quick-occ-student],[data-edit-obs],[data-del-obs],[data-cmdk-student],[data-cmdk-class],[data-cmdk-activity],[data-cmdk-action]');
  keyboardTargets.forEach(el => {
    if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
    if (!el.getAttribute('role')) el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      el.click();
    });
  });

  qAll('[data-open-class]').forEach(el => el.onclick = () => { ctx.classId = el.dataset.openClass; ctx.assignmentId = assignmentsOf(ctx.classId)[0]?.id || null; ctx.classTab = 'visao'; navigate('turmaDetail', false); });
  qAll('[data-class-assignment]').forEach(el => el.onclick = () => { ctx.assignmentId = el.dataset.classAssignment; render(); });
  qAll('[data-open-student]').forEach(el => el.onclick = () => { ctx.studentId = el.dataset.openStudent; ctx.studentTab = 'visao'; ctx.histFilter = 'todos'; ctx.histMonth = ''; navigate('alunoDetail', false); });
  qAll('[data-open-activity]').forEach(el => el.onclick = () => { ctx.activityId = el.dataset.openActivity; navigate('atividadeDetail', false); });
  qAll('[data-view-plan]').forEach(el => el.onclick = e => { e.stopPropagation(); const plan = (state.plans || []).find(item => item.id === el.dataset.viewPlan); openPlanningViewModal(plan); });

  qAll('[data-attention-idx]').forEach(el => el.onclick = () => { const it = lastAttentionItems[Number(el.dataset.attentionIdx)]; if (it) it.action(); });

  const back = q('#btnBack');
  if (back) back.onclick = () => goBack('dashboard');

  onClick('#btnEmptyNewClass', () => openClassModal(null));
  onClick('#btnEmptyNewStudent', () => openStudentModal(null));
  onClick('#btnQuickRegisterTop', () => openOccurrenceModal());
  onClick('#btnQuickRegisterOcc', () => openOccurrenceModal());
  onClick('#btnDashboardPlanning', () => openPlanningModal(null));
  onClick('#btnDashboardDrive', () => syncProjectNow(state.projectId));
  onClick('#btnDashboardCalendar', () => navigate('calendario'));
  onClick('#btnDashboardOccurrences', () => navigate('ocorrencias'));
  onClick('#btnDashboardClasses', () => navigate('turmas'));

  /* --- turmas --- */
  onClick('#btnNewClass', () => openAddClassModal());
  onClick('#btnImportDed', () => openDedImportModal());
  onClick('#btnToggleArchivedClasses', () => { ctx.showArchivedClasses = !ctx.showArchivedClasses; render(); });
  const classSearchInput = q('#classSearchInput');
  if (classSearchInput) classSearchInput.oninput = () => { ctx.classSearch = classSearchInput.value; rerenderKeepFocus(); };
  const classComponentFilter = q('#classComponentFilter');
  if (classComponentFilter) classComponentFilter.onchange = () => { ctx.classComponentFilter = classComponentFilter.value; render(); };
  const classSchoolFilter = q('#classSchoolFilter');
  if (classSchoolFilter) classSchoolFilter.onchange = () => { ctx.classSchoolFilter = classSchoolFilter.value; render(); };
  const classYearFilter = q('#classYearFilter');
  if (classYearFilter) classYearFilter.onchange = () => { ctx.classYearFilter = classYearFilter.value; render(); };
  qAll('[data-edit-class]').forEach(el => el.onclick = e => { e.stopPropagation(); openClassModal(classById(el.dataset.editClass)); });
  qAll('[data-dup-class]').forEach(el => el.onclick = e => { e.stopPropagation(); duplicateClass(el.dataset.dupClass); });
  qAll('[data-archive-class]').forEach(el => el.onclick = e => { e.stopPropagation(); toggleArchiveClass(el.dataset.archiveClass); });
  qAll('[data-del-class]').forEach(el => el.onclick = e => { e.stopPropagation(); deleteClass(el.dataset.delClass); });
  onClick('#btnEditThisClass', () => openClassModal(classById(ctx.classId)));
  onClick('#btnUpdateClassFromDed', () => openDedUpdateModal(ctx.classId, ctx.assignmentId));
  onClick('#btnRegisterForClass', () => {
    const alunos = studentsOf(ctx.classId);
    if (!alunos.length) { toast('Esta turma ainda não tem alunos.', 'error'); return; }
    openOccurrenceStep1('', ctx.classId);
  });
  onClick('#btnGoClassReport', () => openClassReportConfig(ctx.classId));
  qAll('[data-class-tab]').forEach(el => el.onclick = () => { ctx.classTab = el.dataset.classTab; ctx.bulkMode = false; ctx.bulkSelected = new Set(); render(); });
  onClick('#btnNewActivityHere', () => openActivityModal(null, ctx.classId));

  /* --- seleção em massa (alunos da turma) --- */
  onClick('#btnToggleBulk', () => { ctx.bulkMode = !ctx.bulkMode; ctx.bulkSelected = new Set(); render(); });
  qAll('[data-bulk-student]').forEach(el => el.onchange = () => {
    if (el.checked) ctx.bulkSelected.add(el.dataset.bulkStudent); else ctx.bulkSelected.delete(el.dataset.bulkStudent);
    render();
  });
  onClick('#btnBulkSelectAll', () => {
    const activity = currentView === 'atividadeDetail' ? state.activities.find(a => a.id === ctx.activityId) : null;
    const ids = activity ? studentsOf(activity.classId).map(s => s.id) : studentsOf(ctx.classId).map(s => s.id);
    ctx.bulkSelected = new Set(ids); render();
  });
  onClick('#btnBulkDelete', () => deleteStudentsBulk([...ctx.bulkSelected]));
  onClick('#btnBulkClear', () => { ctx.bulkSelected = new Set(); render(); });
  onClick('#btnBulkMoveStudents', () => {
    if (!ctx.bulkSelected.size) { toast('Selecione ao menos um aluno.', 'error'); return; }
    openMoveStudentModal([...ctx.bulkSelected]);
  });
  onClick('#btnBulkOccurrence', () => {
    if (!ctx.bulkSelected.size) { toast('Selecione ao menos um aluno.', 'error'); return; }
    openOccurrenceStep2([...ctx.bulkSelected], null);
  });


  /* --- alunos --- */
  onClick('#btnNewStudent', () => openStudentModal(null, null));
  onClick('#btnToggleStudentBulk', () => { ctx.bulkMode = !ctx.bulkMode; ctx.bulkSelected = new Set(); render(); });
  qAll('#studentListBody [data-bulk-student]').forEach(el => el.onchange = () => {
    if (el.checked) ctx.bulkSelected.add(el.dataset.bulkStudent); else ctx.bulkSelected.delete(el.dataset.bulkStudent);
    render();
  });
  onClick('#btnStudentBulkSelectAll', () => {
    const ids = [...qAll('#studentListBody [data-bulk-student]')].map(el => el.dataset.bulkStudent);
    ctx.bulkSelected = new Set(ids);
    render();
  });
  onClick('#btnStudentBulkOccurrence', () => {
    if (!ctx.bulkSelected.size) { toast('Selecione ao menos um aluno.', 'error'); return; }
    openOccurrenceStep2([...ctx.bulkSelected], null);
  });
  onClick('#btnStudentBulkDelete', () => deleteStudentsBulk([...ctx.bulkSelected]));
  onClick('#btnStudentBulkClear', () => { ctx.bulkSelected = new Set(); render(); });
  onClick('#btnStudentBulkMove', () => {
    if (!ctx.bulkSelected.size) { toast('Selecione ao menos um aluno.', 'error'); return; }
    openMoveStudentModal([...ctx.bulkSelected]);
  });
  onClick('#btnAddStudentHere', () => openStudentModal(null, ctx.classId));
  qAll('[data-edit-student]').forEach(el => el.onclick = e => { e.stopPropagation(); openStudentModal(studentById(el.dataset.editStudent)); });
  qAll('[data-move-student]').forEach(el => el.onclick = e => { e.stopPropagation(); openMoveStudentModal([el.dataset.moveStudent]); });
  qAll('[data-quick-occ-student]').forEach(el => el.onclick = e => { e.stopPropagation(); openOccurrenceModal(el.dataset.quickOccStudent); });
  qAll('[data-del-student]').forEach(el => el.onclick = e => { e.stopPropagation(); deleteStudent(el.dataset.delStudent); });
  onClick('#btnStudentActions', () => openStudentActionsModal(studentById(ctx.studentId)));
  onClick('#btnRegisterForStudent', () => openOccurrenceModal(ctx.studentId));

  const studentSearchInput = q('#studentSearchInput');
  if (studentSearchInput) studentSearchInput.oninput = () => { ctx.studentSearch = studentSearchInput.value; rerenderKeepFocus(); };
  const studentClassFilterSelect = q('#studentClassFilterSelect');
  if (studentClassFilterSelect) studentClassFilterSelect.onchange = () => { ctx.studentClassFilter = studentClassFilterSelect.value; render(); };
  const studentSortSelect = q('#studentSortSelect');
  if (studentSortSelect) studentSortSelect.onchange = () => { ctx.studentSort = studentSortSelect.value; render(); };

  /* --- perfil do aluno --- */
  qAll('[data-student-tab]').forEach(el => el.onclick = () => { ctx.studentTab = el.dataset.studentTab; render(); });
  onClick('#btnGoStudentReport', () => openIndividualReportConfig(ctx.studentId));
  onClick('#btnGoStudentReportTop', () => openIndividualReportConfig(ctx.studentId));
  onClick('#btnEditNotes', () => {
    const s = studentById(ctx.studentId);
    const display = document.getElementById('notesDisplay');
    display.innerHTML = `<textarea class="form-textarea" id="notesTextarea" placeholder="Ex: Tem dificuldade em matemática. Precisa de acompanhamento nas atividades.">${esc(s.notes || '')}</textarea>
      <div class="form-actions"><button type="button" class="btn-secondary btn-sm" id="notesCancel">Cancelar</button><button type="button" class="btn-primary btn-sm" id="notesSave">Salvar</button></div>`;
    document.getElementById('notesCancel').onclick = () => render();
    document.getElementById('notesSave').onclick = () => { s.notes = document.getElementById('notesTextarea').value.trim(); markDirty(); toast('Observação geral salva.', 'success'); render(); };
    document.getElementById('notesTextarea').focus();
  });
  onClick('#btnNewObservation', () => openObservationModal(studentById(ctx.studentId), null));
  qAll('[data-edit-obs]').forEach(el => el.onclick = () => { const s = studentById(ctx.studentId); openObservationModal(s, (s.observations || []).find(o => o.id === el.dataset.editObs)); });
  qAll('[data-del-obs]').forEach(el => el.onclick = () => {
    confirmModal({ title: 'Excluir observação', body: 'Esta observação será excluída permanentemente.', confirmLabel: 'Excluir', danger: true, onConfirm: () => {
      const s = studentById(ctx.studentId); s.observations = (s.observations || []).filter(o => o.id !== el.dataset.delObs);
      markDirty(); toast('Observação excluída.', 'success'); render();
    }});
  });

  qAll('[data-hist-filter]').forEach(el => el.onclick = () => { ctx.histFilter = el.dataset.histFilter; render(); });
  const monthSelect = q('#histMonthSelect');
  if (monthSelect) monthSelect.onchange = () => { ctx.histMonth = monthSelect.value; render(); };

  qAll('[data-edit-occ]').forEach(el => el.onclick = () => openOccurrenceModal(null, state.occurrences.find(o => o.id === el.dataset.editOcc)));
  qAll('[data-del-occ]').forEach(el => el.onclick = () => {
    confirmModal({ title: 'Excluir ocorrência', body: 'Este registro será excluído permanentemente.', confirmLabel: 'Excluir', danger: true, onConfirm: () => {
      state.occurrences = state.occurrences.filter(o => o.id !== el.dataset.delOcc);
      markDirty(); toast('Ocorrência excluída.', 'success'); render();
    }});
  });

  /* --- atividades --- */
  onClick('#btnNewActivity', () => openActivityModal(null));
  onClick('#btnEditActivity', () => openActivityModal(state.activities.find(a => a.id === ctx.activityId)));
  qAll('[data-del-activity]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    confirmModal({ title: 'Excluir atividade', body: 'O registro da atividade será removido da agenda.', confirmLabel: 'Excluir', danger: true, onConfirm: () => {
      state.activities = state.activities.filter(a => a.id !== el.dataset.delActivity);
      markDirty(); toast('Atividade excluída.', 'success');
      if (ctx.activityId === el.dataset.delActivity) navigate('atividades'); else render();
    }});
  });
  qAll('[data-activity-filter]').forEach(el => el.onclick = () => { ctx.activityFilter = el.dataset.activityFilter; render(); });
  const activitySearchInput = q('#activitySearchInput');
  if (activitySearchInput) activitySearchInput.oninput = () => { ctx.activitySearch = activitySearchInput.value; rerenderKeepFocus(); };
  const activityClassFilterSelect = q('#activityClassFilterSelect');
  if (activityClassFilterSelect) activityClassFilterSelect.onchange = () => { ctx.activityClassFilter = activityClassFilterSelect.value; render(); };

  /* --- planejamento --- */
  onClick('#btnNewPlan', () => openPlanningModal(null, ctx.classId || ''));
  qAll('[data-edit-plan]').forEach(el => el.onclick = () => openPlanningModal((state.plans || []).find(plan => plan.id === el.dataset.editPlan)));
  qAll('[data-dup-plan]').forEach(el => el.onclick = () => duplicatePlanning(el.dataset.dupPlan));
  qAll('[data-del-plan]').forEach(el => el.onclick = () => {
    confirmModal({ title: 'Excluir planejamento', body: 'Este planejamento será excluído permanentemente.', confirmLabel: 'Excluir', danger: true, onConfirm: () => {
      state.plans = (state.plans || []).filter(plan => plan.id !== el.dataset.delPlan);
      markDirty(); toast('Planejamento excluído.', 'success'); render();
    }});
  });
  const planningSearchInput = q('#planningSearchInput');
  if (planningSearchInput) planningSearchInput.oninput = () => { ctx.planningSearch = planningSearchInput.value; rerenderKeepFocus(); };
  const planningClassFilterSelect = q('#planningClassFilterSelect');
  if (planningClassFilterSelect) planningClassFilterSelect.onchange = () => { ctx.planningClassFilter = planningClassFilterSelect.value; render(); };
  const planningFromInput = q('#planningFromInput');
  if (planningFromInput) planningFromInput.onchange = () => { ctx.planningFrom = planningFromInput.value; render(); };
  const planningToInput = q('#planningToInput');
  if (planningToInput) planningToInput.onchange = () => { ctx.planningTo = planningToInput.value; render(); };

  /* --- calendário --- */
  const calClassFilterSelect = q('#calClassFilterSelect');
  if (calClassFilterSelect) calClassFilterSelect.onchange = () => { ctx.calClassFilter = calClassFilterSelect.value; render(); };
  onClick('#btnCalPrev', () => { ctx.calMonth = shiftMonth(ctx.calMonth, -1); ctx.calSelectedDay = null; render(); });
  onClick('#btnCalNext', () => { ctx.calMonth = shiftMonth(ctx.calMonth, 1); ctx.calSelectedDay = null; render(); });
  qAll('[data-cal-day]').forEach(el => el.onclick = () => { ctx.calSelectedDay = ctx.calSelectedDay === el.dataset.calDay ? null : el.dataset.calDay; render(); });

  /* --- ocorrências (log) --- */
  const occSearchInput = q('#occSearchInput');
  if (occSearchInput) occSearchInput.oninput = () => { ctx.occSearch = occSearchInput.value; rerenderKeepFocus(); };
  const occClassFilterSelect = q('#occClassFilterSelect');
  if (occClassFilterSelect) occClassFilterSelect.onchange = () => { ctx.occClassFilter = occClassFilterSelect.value; render(); };
  const occTypeFilterSelect = q('#occTypeFilterSelect');
  if (occTypeFilterSelect) occTypeFilterSelect.onchange = () => { ctx.occTypeFilter = occTypeFilterSelect.value; render(); };

  /* --- relatórios --- */
  onClick('#btnOpenIndividualConfig', () => openIndividualReportConfig(null));
  onClick('#btnOpenClassConfig', () => openClassReportConfig(null));
  onClick('#btnGoAtividadesPrint', () => navigate('atividades'));
  onClick('#btnGoOcorrenciasPrint', () => navigate('ocorrencias'));
  onClick('#btnEditReportConfig', () => openIndividualReportConfig(ctx.reportStudentId));
  onClick('#btnEditClassReportConfig', () => openClassReportConfig(ctx.classReportId));
  onClick('#btnPrintReport', () => doPrintReport());
  onClick('#btnExportPdfReport', () => doExportPdf());
  const reportSynthesisText = q('#reportSynthesisText');
  if (reportSynthesisText) reportSynthesisText.oninput = () => { ctx.reportSynthesis = reportSynthesisText.value; };

  qAll('[data-theme-mode]').forEach(el => el.onclick = () => {
    const nextMode = el.dataset.themeMode;
    if (nextMode === getThemeMode()) return;
    applyThemeMode(nextMode);
    render();
  });

  /* --- arquivo / configurações --- */
  onClick('#btnExitDemo', () => exitDemoMode());
  onClick('#btnExitDemoSecondary', () => exitDemoMode());
  onClick('#topbarHomeBtn', () => closeCurrentProject());
  onClick('#btnBackToProjects', () => closeCurrentProject());
  onClick('#btnNewProject', () => openNewProjectChooser({ fromWorkspace: true }));
  onClick('#btnOpenBackups', () => openBackupsModal());
  onClick('#btnExportPrg', () => exportProject(state.projectId));
  onClick('#btnSharePrg', () => exportProject(state.projectId, { share: true }));
  onClick('#btnRenameProject', () => openRenameProjectModal(state.projectId));
  onClick('#btnDedProjectUpdate', () => openDedPicker({ newProject: false }));
  onClick('#btnDriveSync', () => syncProjectNow(state.projectId));
  onClick('#btnDriveAccountSettings', openDriveAccountSettings);
  onClick('#btnDriveUnlink', () => confirmUnlinkDrive(state.projectId));
  onClick('#btnDriveTrash', () => confirmTrashOnDrive(state.projectId));
  onClick('#btnDeleteProject', () => confirmDeleteLocalProject(state.projectId));
  onClick('#btnDeleteProjectEverywhere', () => confirmDeleteEverywhere(state.projectId));
  onClick('#btnDriveImport', () => openDrivePicker());
  onClick('#btnExportDevLog', () => exportDevLog());
  onClick('#btnGoFileFromSettings', () => navigate('arquivo'));
  onClick('#btnOpenLocalDataSettings', () => openLocalDataManager());
  onClick('#btnClearDevLog', () => {
    clearDevLog();
    toast('Registros de problemas apagados.', 'success');
    render();
  });
  onClick('#btnExportCsv', () => exportStudentsCsv());
  onClick('#btnImportCsv', () => document.getElementById('csvInput').click());
  const csvInput = q('#csvInput');
  if (csvInput) csvInput.addEventListener('change', handleCsvImportInput);
  onClick('#btnSaveTeacherName', () => {
    state.teacher = state.teacher || {};
    state.teacher.name = document.getElementById('teacherNameInput').value.trim() || 'Professor(a)';
    markDirty(); toast('Nome do professor atualizado.', 'success'); render();
  });
}

function onClick(sel, fn) { const el = q(sel); if (el) el.onclick = fn; }
function q(sel) { return document.querySelector(sel); }
function qAll(sel) { return document.querySelectorAll(sel); }
function shiftMonth(ym, delta) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }

/* ==================== ações de turma / aluno ==================== */

function deleteClass(classId) {
  const cls = classById(classId);
  if (!cls) return;
  const relStudents = studentsOf(classId);
  const relActivities = state.activities.filter(a => a.classId === classId);
  const relPlans = (state.plans || []).filter(p => p.classId === classId);
  const relAssignments = (state.assignments || []).filter(a => a.classId === classId);
  const relStudentIds = new Set(relStudents.map(s => s.id));
  const relOccurrences = state.occurrences.filter(o => relStudentIds.has(o.studentId) && (!o.classId || o.classId === classId));

  confirmModal({
    title: `Excluir turma "${cls.name}"?`,
    body: 'Os alunos, atividades e ocorrências relacionadas também serão excluídos para não deixar registros soltos. Esta ação não pode ser desfeita.',
    detailList: [['Alunos', relStudents.length], ['Disciplinas', relAssignments.length], ['Atividades', relActivities.length], ['Planejamentos', relPlans.length], ['Ocorrências', relOccurrences.length]],
    confirmLabel: 'Excluir turma', danger: true,
    onConfirm: () => {
      state.classes = state.classes.filter(c => c.id !== classId);
      state.assignments = (state.assignments || []).filter(a => a.classId !== classId);
      state.enrollments = (state.enrollments || []).filter(e => e.classId !== classId);
      state.students = state.students.filter(s => s.classId !== classId);
      state.activities = state.activities.filter(a => a.classId !== classId);
      state.plans = (state.plans || []).filter(p => p.classId !== classId);
      state.occurrences = state.occurrences.filter(o => !relStudentIds.has(o.studentId));
      markDirty(); toast('Turma excluída.', 'success');
      if (ctx.classId === classId) navigate('turmas'); else render();
    },
  });
}

function duplicateClass(classId) {
  const cls = classById(classId);
  if (!cls) return;
  const newClass = { id: uid('class'), name: cls.name + ' (cópia)', archived: false, schoolId: cls.schoolId || null, year: cls.year || '', shift: cls.shift || '', classCode: '' };
  state.classes.push(newClass);
  assignmentsOf(classId).forEach(a => state.assignments.push({ ...a, id: uid('assign'), classId: newClass.id, schoolId: newClass.schoolId || a.schoolId || null }));
  studentsOf(classId).forEach(s => { const ns = { id: uid('stu'), name: s.name, classId: newClass.id, notes: '', observations: [], enrollmentIds: [] }; state.students.push(ns); ensureEnrollment(ns, newClass.id); });
  markDirty(); toast(`Turma duplicada como "${newClass.name}".`, 'success'); render();
}

function toggleArchiveClass(classId) {
  const cls = classById(classId);
  if (!cls) return;
  cls.archived = !cls.archived;
  markDirty(); toast(cls.archived ? 'Turma arquivada.' : 'Turma reativada.', 'success'); render();
}

function deleteStudentsBulk(studentIds) {
  const ids = [...new Set((studentIds || []).filter(Boolean))];
  const students = ids.map(studentById).filter(Boolean);
  if (!students.length) { toast('Selecione ao menos um aluno.', 'error'); return; }
  const idSet = new Set(students.map(s => s.id));
  const relOcc = (state.occurrences || []).filter(o => idSet.has(o.studentId)).length;
  const relObs = students.reduce((total, s) => total + (Array.isArray(s.observations) ? s.observations.length : 0), 0);
  confirmModal({
    title: `Excluir ${students.length} aluno${students.length === 1 ? '' : 's'}?`,
    body: 'Os alunos selecionados sairão deste projeto. Ocorrências e observações vinculadas também serão removidas.',
    detailList: [['Alunos', students.length], ['Ocorrências', relOcc], ['Observações', relObs]],
    confirmLabel: `Excluir ${students.length === 1 ? 'aluno' : 'alunos'}`, danger: true,
    onConfirm: () => {
      state.students = state.students.filter(s => !idSet.has(s.id));
      state.occurrences = (state.occurrences || []).filter(o => !idSet.has(o.studentId));
      ctx.bulkMode = false; ctx.bulkSelected = new Set();
      markDirty();
      if (ids.includes(ctx.studentId)) { ctx.studentId = null; navigate('alunos'); return; }
      toast(`${students.length} aluno${students.length === 1 ? '' : 's'} excluído${students.length === 1 ? '' : 's'}.`, 'success');
      render();
    },
  });
}

function deleteStudent(studentId) {
  const s = studentById(studentId);
  if (!s) return;
  const relOcc = occurrencesOf(studentId).length;
  const relObs = Array.isArray(s.observations) ? s.observations.length : 0;
  confirmModal({
    title: `Excluir "${s.name}"?`,
    body: 'O aluno e todos os seus registros (ocorrências e observações) serão excluídos permanentemente.',
    detailList: [['Ocorrências', relOcc], ['Observações', relObs]],
    confirmLabel: 'Excluir aluno', danger: true,
    onConfirm: () => {
      state.students = state.students.filter(x => x.id !== studentId);
      state.occurrences = state.occurrences.filter(o => o.studentId !== studentId);
      markDirty(); toast('Aluno excluído.', 'success');
      if (ctx.studentId === studentId) navigate('alunos'); else render();
    },
  });
}

/* ==================== CSV ==================== */

function csvEscape(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

function exportStudentsCsv() {
  const rows = [['nome', 'turma']];
  state.students.forEach(s => rows.push([s.name, classNameOf(s.classId)]));
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  downloadFallback(csv, 'alunos.csv', 'text/csv;charset=utf-8');
  toast('Alunos exportados em CSV.', 'success');
}

function parseCSV(text, delimiter = ',') {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]; const next = text[i + 1];
    if (ch === '"') {
      if (quoted && next === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) { row.push(field.trim()); field = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field.trim()); if (row.some(v => v !== '')) rows.push(row); }
  return rows;
}


function handleCsvImportInput(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('O CSV excede o limite de 10 MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = evt => {
    const text = String(evt.target.result || '').replace(/^\uFEFF/, '');
    const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
    const comma = (sample.match(/,/g) || []).length;
    const semi = (sample.match(/;/g) || []).length;
    const delimiter = semi > comma ? ';' : ',';
    const rows = parseCSV(text, delimiter);
    if (!rows.length) { toast('O CSV está vazio.', 'error'); return; }
    const first = rows[0].map(v => v.toLowerCase());
    const hasHeader = first.some(v => v === 'nome' || v === 'aluno' || v === 'turma');
    const dataRows = hasHeader ? rows.slice(1) : rows;
    let added = 0, skipped = 0, createdClasses = 0;
    dataRows.slice(0, MAX_STUDENTS).forEach(parts => {
      const name = parts[0] || '';
      if (!name) { skipped++; return; }
      const className = parts[1] || '';
      let cls = className ? state.classes.find(c => c.name.toLowerCase() === className.toLowerCase()) : null;
      if (className && !cls) { cls = { id: uid('class'), name: className.slice(0, 500), archived: false }; state.classes.push(cls); createdClasses++; }
      const student = { id: uid('stu'), name: name.slice(0, 500), classId: cls?.id || null, notes: '', observations: [], enrollmentIds: [] }; state.students.push(student); if (cls?.id) ensureEnrollment(student, cls.id);
      added++;
    });
    if (dataRows.length > MAX_STUDENTS) skipped += dataRows.length - MAX_STUDENTS;
    if (!added) { toast('Nenhum aluno válido foi encontrado no CSV.', 'error'); return; }
    markDirty();
    toast(`${added} ${added === 1 ? 'aluno importado' : 'alunos importados'} do CSV.${createdClasses ? ` ${createdClasses} ${createdClasses === 1 ? 'turma criada' : 'turmas criadas'}.` : ''}${skipped ? ` ${skipped} ${skipped === 1 ? 'linha ignorada' : 'linhas ignoradas'}.` : ''}`, 'success');
    render();
  };
  reader.onerror = () => toast('Não foi possível ler o arquivo CSV.', 'error');
  reader.readAsText(file, 'utf-8');
}

/* ==================== arquivo .prg: abrir, validar, salvar ==================== */

function buildSavePayload() {
  return {
    format: PRG_FORMAT,
    version: PRG_VERSION,
    projectId: state.projectId || createProjectId(),
    ...(String(state.name || '').trim() ? { name: String(state.name).trim().slice(0, PROJECT_NAME_MAX) } : {}),
    createdAt: state.createdAt || todayISO(),
    updatedAt: new Date().toISOString(),
    teacher: { name: state.teacher?.name || 'Professor' },
    schools: Array.isArray(state.schools) ? state.schools : [],
    classes: state.classes,
    assignments: Array.isArray(state.assignments) ? state.assignments : [],
    enrollments: Array.isArray(state.enrollments) ? state.enrollments : [],
    students: state.students,
    activities: (state.activities || []).map(({ completions, ...activity }) => activity),
    occurrences: state.occurrences,
    plans: Array.isArray(state.plans) ? state.plans : [],
  };
}

/* ==================== dados de demonstração ==================== */

function loadDemoData() {
  const c1 = uid('class'), c2 = uid('class');
  const s = [
    { id: uid('stu'), name: 'Ana Beatriz Souza', classId: c1, notes: '', observations: [] },
    { id: uid('stu'), name: 'Carlos Eduardo Lima', classId: c1, notes: 'Tem dificuldade em matemática. Precisa de acompanhamento nas atividades.', observations: [{ id: uid('obs'), date: addDays(-10), text: 'Combinado com a família reforço em casa duas vezes por semana.' }] },
    { id: uid('stu'), name: 'Fernanda Oliveira', classId: c1, notes: '', observations: [] },
    { id: uid('stu'), name: 'João Pedro Santos', classId: c2, notes: '', observations: [] },
    { id: uid('stu'), name: 'Maria Clara Costa', classId: c2, notes: '', observations: [] },
  ];
  const act1 = uid('act'), act2 = uid('act'), act3 = uid('act');
  const activities = [
    { id: act1, name: 'Lista de exercícios — Frações', classId: c1, dueDate: addDays(3), description: 'Exercícios 1 a 10 do livro.' },
    { id: act2, name: 'Redação — Meio ambiente', classId: c2, dueDate: addDays(-2), description: 'Texto dissertativo, mínimo 20 linhas.' },
    { id: act3, name: 'Prova — Sistemas do corpo humano', classId: c1, dueDate: addDays(-6), description: '' },
  ];
  const occurrences = [
    { id: uid('occ'), studentId: s[0].id, date: addDays(-4), type: 'participou', description: '' },
    { id: uid('occ'), studentId: s[1].id, date: addDays(-8), type: 'conversou', description: 'Conversou bastante durante a explicação.' },
    { id: uid('occ'), studentId: s[1].id, date: addDays(-1), type: 'nao_atividade', description: '' },
    { id: uid('occ'), studentId: s[1].id, date: addDays(-15), type: 'observacao', description: 'Registro de acompanhamento anterior.' },
    { id: uid('occ'), studentId: s[3].id, date: addDays(-6), type: 'bom_comportamento', description: '' },
    { id: uid('occ'), studentId: s[4].id, date: addDays(-2), type: 'faltou', description: '' },
  ];
  const school = { id: uid('school'), name: 'Colégio Horizonte', code: '', sre: '', address: '' };
  const a1 = { id: uid('assign'), classId: c1, schoolId: school.id, subject: 'Língua Portuguesa', teacherName: 'Mariana Alves', year: String(new Date().getFullYear()), ded: null };
  const a2 = { id: uid('assign'), classId: c2, schoolId: school.id, subject: 'Língua Portuguesa', teacherName: 'Mariana Alves', year: String(new Date().getFullYear()), ded: null };
  const enrollments = s.map(student => ({ id: uid('enroll'), studentId: student.id, classId: student.classId, active: true }));
  s.forEach((student,i)=>student.enrollmentIds=[enrollments[i].id]);
  activities.forEach(a => a.assignmentId = a.classId === c1 ? a1.id : a2.id);
  occurrences.forEach(o => { const student = s.find(x=>x.id===o.studentId); o.classId = student?.classId || null; o.assignmentId = student?.classId === c1 ? a1.id : a2.id; });
  return {
    format: PRG_FORMAT, version: PRG_VERSION, projectId: createProjectId(),
    createdAt: todayISO(), updatedAt: todayISO(),
    teacher: { name: 'Mariana Alves' },
    schools: [school],
    classes: [{ id: c1, name: '1º Ano A', archived: false, schoolId: school.id, year: String(new Date().getFullYear()), shift: 'Manhã' }, { id: c2, name: '2º Ano A', archived: false, schoolId: school.id, year: String(new Date().getFullYear()), shift: 'Manhã' }],
    assignments: [a1, a2], enrollments,
    students: s, activities, occurrences,
    plans: [
      { id: uid('plan'), classId: c1, assignmentId: a1.id, date: addDays(1), title: 'Leitura e interpretação de texto', content: 'Leitura compartilhada de uma crônica curta.', objectives: 'Identificar ideia principal e informações explícitas.', methodology: 'Leitura em duplas seguida de conversa coletiva.', resources: 'Livro e quadro.', assessment: 'Perguntas de compreensão e participação.' },
      { id: uid('plan'), classId: c2, assignmentId: a2.id, date: addDays(2), title: 'Produção de texto', content: 'Planejamento e escrita de um pequeno texto.', objectives: 'Organizar ideias antes da escrita.', methodology: 'Roteiro no quadro e produção individual.', resources: 'Caderno e quadro.', assessment: 'Revisão inicial do texto.' },
    ],
  };
}
