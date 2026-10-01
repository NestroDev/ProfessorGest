import {
  PRG_FORMAT, PRG_VERSION, MAX_PRG_BYTES, MAX_CLASSES, MAX_STUDENTS, MAX_SCHOOLS, MAX_ASSIGNMENTS, MAX_ENROLLMENTS, PRG_MIME,
  createProjectId, validateAndParsePrg, validateProjectData
} from './src/prof-model.js';
import {
  writeLocalProjectRecord, readLocalProjectRecord, readLocalProjectRecordById, readLocalProjectRecords, deleteLocalProjectRecord, clearLocalProjectRecords, deleteRecoveryRecord,
  writeRecoveryRecord, readLatestRecoveryRecord, writeProjectBackup, readProjectBackups, readAllProjectBackups, deleteProjectBackup, clearProjectBackups, clearAllLocalData
} from './src/local-store.js';
import {
  readDriveBindings, writeDriveBindings, setDriveBinding, removeDriveBinding, getDriveBinding
} from './src/drive-bindings.js';
import {
  normalizePrgFileName, isAndroidDevice, supportsNativeFilePicker, supportsNativeSavePicker,
  readTextFileUtf8, prgOpenPickerTypes, prgSavePickerTypes, supportsFileShare, shareFile, downloadTextFile
} from './src/file-io.js';
import { driveFetch as driveHttpFetch, driveJson as driveHttpJson, driveText as driveHttpText } from './src/drive-http.js';
import { readDriveAccount, writeDriveAccount, clearDriveAccount, normalizeDriveAccount } from './src/drive-account.js';
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
import { createWelcomeViewRenderer } from './src/views-welcome.js';
import { createPlanningViewRenderer } from './src/views-planning.js';
import { studentsOf as selectStudentsOf, occurrencesOf as selectOccurrencesOf, activitiesOf as selectActivitiesOf, plansOf as selectPlansOf, assignmentsOf as selectAssignmentsOf, assignmentById as selectAssignmentById, schoolById as selectSchoolById, classById as selectClassById, studentById as selectStudentById, activeClasses as selectActiveClasses, activeStudents as selectActiveStudents, activeActivities as selectActiveActivities, studentStats as selectStudentStats, classStats as selectClassStats, activityStats as selectActivityStats, activityStatus as selectActivityStatus, classIdsOfStudent as selectClassIdsOfStudent } from './src/project-selectors.js';
import { parseDedPdfFiles } from './src/ded-pdf.js';
import { createSearchField, createEntityPickerOption, createEntityPickerEmpty } from './src/ui-search.js';
import { normalizeDedStudentName, normalizeDedClassKey, sameDedClassIdentity, normalizeExistingDedData } from './src/ded-parser.js';

/* ==================== ProfessorGest ====================
   PWA local-first. O arquivo .prg continua sendo a fonte de dados do
   usuário; a API é opcional e fica isolada pelo cliente central.
================================================================= */

const APP_BUILD = '2026.10.01.6-drive-manual-only';
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
    fileOpenPicker: typeof window.showOpenFilePicker === 'function',
    indexedDB: 'indexedDB' in window,
    origin: window.location?.origin || '',
    path: window.location?.pathname || '',
    viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
    currentFileName: typeof currentFileName !== 'undefined' ? (currentFileName || null) : null,
    currentStorageMode: typeof currentStorageMode !== 'undefined' ? currentStorageMode : null
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
    performAutomaticSave().catch(() => {});
  }
});
window.addEventListener('pagehide', () => {
  if (isDirty && !demoMode) performAutomaticSave().catch(() => {});
});

let state = null;
let isDirty = false;
let workspaceReady = false;
let demoMode = false;
let currentFileName = null;
let currentFileHandle = null;
let currentStorageMode = 'none'; // none | file | local | drive
let currentFileLastModified = 0;
let localProjectSaved = false;
let localProjectSavedAt = 0;
let driveAccessToken = null;
let driveTokenExpiresAt = 0;
let driveTokenClient = null;
let driveTokenPromise = null;
let driveAuthCancelled = false;
let drivePickerReady = false;
let driveSyncPromise = null;
let driveActionPromise = null;
let driveActionPending = false;
let lastDriveUploadRevision = null;
let driveBinding = null;
let driveBindingsByProject = {};
let driveAccount = readDriveAccount().account;
let driveSessionEpoch = 0;
let driveForceAccountPrompt = false;
let recoveryDraftCache = null;
let setupOrigin = 'welcome';
let currentView = 'dashboard';
let lastAttentionItems = [];
let localDraftSaveTimer = null;
let automaticSaveTimer = null;
let automaticSaveInFlight = null;
let automaticSaveRevision = -1;
let recoveryDraftTimestamp = null;
let recoveryWriteToken = 0;
let automaticBackupTimer = null;
let automaticBackupInFlight = null;
let automaticBackupRevision = -1;
let projectBackupsCache = [];
let saveUiState = 'idle';
function setSaveUiState(next) { saveUiState = transitionSaveState(saveUiState, next); return saveUiState; }
let deferredInstallPrompt = null;
let lastLocalSaveAt = 0;
let lastCloudSyncAt = 0;
let cloudSyncPending = false;
let dirtyRevision = 0;
const LOCAL_RECOVERY_KEY = 'professorgest-recovery-fallback';
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
    { key: 'arquivo', label: 'Arquivos', icon: 'folder' },
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
  driveBindingForCurrentProject,
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

/* ==================== estado "sujo" / proteção local ==================== */

async function saveLocalProjectSnapshot({
  stateData = null,
  storageMode = currentStorageMode,
  fileName = currentFileName,
  fileHandle = currentFileHandle,
  fileLastModified = currentFileLastModified,
  persistFileHandle = true,
  savedAt = null,
  driveBindingOverride = undefined,
  driveSyncPendingOverride = undefined,
} = {}) {
  if (!stateData && !state) return false;
  const payload = stateData || buildSavePayload();
  const effectiveDriveBinding = driveBindingOverride !== undefined
    ? (driveBindingOverride || null)
    : (driveBinding || driveBindingForCurrentProject() || null);
  const record = {
    schemaVersion: 1,
    savedAt: savedAt || new Date().toISOString(),
    currentFileName: fileName || null,
    storageMode: storageMode || 'local',
    fileLastModified: Number(fileLastModified) || 0,
    driveBinding: effectiveDriveBinding,
    // Esse sinal precisa sobreviver ao reload. Sem ele, um projeto que já foi
    // salvo localmente mas ainda aguardava o Drive voltava como "sincronizado".
    driveSyncPending: driveSyncPendingOverride !== undefined
      ? !!driveSyncPendingOverride
      : !!(effectiveDriveBinding?.fileId && cloudSyncPending),
    state: payload,
  };
  try {
    await writeLocalProjectRecord({
      ...record,
      fileHandle: persistFileHandle ? (fileHandle || null) : null,
    });
  } catch (err) {
    logError('storage.local.persist_failed', err, { hasFileHandle: !!fileHandle });
    if (fileHandle) {
      try {
        await writeLocalProjectRecord({ ...record, fileHandle: null });
      } catch (fallbackErr) {
        logError('storage.local.persist_fallback_failed', fallbackErr);
        console.warn('[ProfessorGest] Não foi possível persistir o projeto local.', fallbackErr);
        return false;
      }
    } else {
      console.warn('[ProfessorGest] Não foi possível persistir o projeto local.', err);
      return false;
    }
  }
  localProjectSaved = true;
  localProjectSavedAt = Date.parse(record.savedAt) || Date.now();
  return true;
}

async function restorePersistedProjectById(projectId, { navigateToDashboard = true } = {}) {
  const record = await readLocalProjectRecordById(projectId);
  if (!record?.state || record.state.format !== PRG_FORMAT) return false;

  if (record.storageMode === 'file' && record.fileHandle) {
    try {
      let permission = typeof record.fileHandle.queryPermission === 'function'
        ? await record.fileHandle.queryPermission({ mode: 'readwrite' })
        : 'prompt';
      if (permission !== 'granted' && typeof record.fileHandle.requestPermission === 'function') {
        permission = await record.fileHandle.requestPermission({ mode: 'readwrite' });
      }
      if (permission === 'granted') {
        const file = await record.fileHandle.getFile();
        const expectedLastModified = Number(record.fileLastModified) || 0;
        const actualLastModified = Number(file.lastModified) || 0;
        const externalChange = expectedLastModified > 0 && actualLastModified > 0
          && actualLastModified !== expectedLastModified;

        if (!externalChange) {
          const text = await readTextFileUtf8(file);
          const result = validateAndParsePrg(text);
          if (result.ok) {
            applyOpenedData(result.data, file.name, null, record.fileHandle, {
              storageMode: 'file',
              fileLastModified: actualLastModified,
              persistLocal: false,
              navigateToDashboard,
              warnings: result.warnings || [],
            });
            return true;
          }
        } else {
          // O snapshot local é a última versão que o ProfessorGest confirmou.
          // Se o arquivo físico mudou depois disso, não o carregue por cima da
          // cópia local: isso poderia apagar alterações feitas nesta sessão.
          console.warn('[ProfessorGest] O arquivo físico mudou desde o último snapshot local; mantendo a cópia local protegida.');
          applyOpenedData(record.state, record.currentFileName || file.name || 'Projeto local', null, null, {
            storageMode: 'local',
            fileLastModified: 0,
            persistLocal: false,
            driveBinding: record.driveBinding || null,
            driveSyncPending: !!record.driveSyncPending,
            navigateToDashboard,
            warnings: [],
          });
          isDirty = true;
          setSaveUiState('dirty');
          persistLocalRecoveryDraft();
          toast('O arquivo original mudou desde a última cópia local. Mantivemos sua versão local para evitar perda de dados.', 'info');
          updateSaveChrome();
          return true;
        }
      }
    } catch (err) {
      console.warn('[ProfessorGest] Não foi possível reabrir o arquivo local automaticamente.', err);
    }
  }

  applyOpenedData(record.state, record.currentFileName || 'Projeto local', null, null, {
    storageMode: 'local',
    fileLastModified: record.fileLastModified || 0,
    persistLocal: false,
    driveBinding: record.driveBinding || null,
    driveSyncPending: !!record.driveSyncPending,
    navigateToDashboard,
    warnings: [],
  });
  return true;
}

async function restorePersistedProject() {
  const records = await readLocalProjectRecords(1);
  return restorePersistedProjectById(records[0]?.state?.projectId || null);
}


/*
 * buildSavePayload() devolve uma cópia parcial (teacher e activities são objetos
 * novos). Trocar `state` por essa cópia depois de um await descartava qualquer
 * edição feita durante a gravação. Por isso só o carimbo de atualização é adotado.
 */
function adoptSavedPayload(payload) {
  if (state && payload?.updatedAt) state.updatedAt = payload.updatedAt;
}

function markDirty() {
  dirtyRevision += 1;
  isDirty = true;
  setSaveUiState('dirty');
  // O Drive é deliberadamente manual. Ao detectar uma alteração local,
  // apenas marcamos o vínculo como pendente e pedimos ao usuário que decida
  // quando quer enviar a versão atualizada para a nuvem.
  if (driveBindingForCurrentProject()) cloudSyncPending = true;
  scheduleLocalRecoveryDraft();
  scheduleAutomaticBackup();
  scheduleAutomaticSave();
  updateSaveChrome();
}

/**
 * Salvamento automático local-first. Toda alteração confirmada pelo aplicativo
 * entra no armazenamento interno sem exigir que o professor clique em
 * "Salvar". Se o projeto tiver um arquivo .prg aberto por File System Access
 * e a permissão já estiver concedida, a mesma alteração também é gravada nele.
 * O Google Drive é apenas uma atualização em nuvem acionada manualmente; ele
 * não participa do salvamento automático local.
 */
function scheduleAutomaticSave() {
  clearTimeout(automaticSaveTimer);
  automaticSaveTimer = setTimeout(() => {
    performAutomaticSave().catch(err => {
      logError('save.automatic_failed', err);
      setSaveUiState('dirty');
      updateSaveChrome();
    });
  }, 700);
}

/*
 * Serializa toda gravação no FileSystemFileHandle. Sem isso, o autosave (700 ms
 * após a edição) e o botão Salvar podiam chamar createWritable() ao mesmo tempo;
 * a segunda chamada falhava e o app descartava o vínculo com o arquivo .prg.
 */
let fileWriteLock = Promise.resolve();
function withFileWriteLock(task) {
  const run = fileWriteLock.then(task, task);
  fileWriteLock = run.catch(() => {});
  return run;
}

function writeCurrentFileHandleAutomatically(payload, options = {}) {
  const fileHandle = options.fileHandle || currentFileHandle;
  const projectId = options.projectId || state?.projectId || null;
  const expectedLastModified = Number(options.fileLastModified ?? currentFileLastModified) || 0;
  const fileName = options.fileName || currentFileName || null;
  return withFileWriteLock(() => writeCurrentFileHandleAutomaticallyUnlocked(payload, {
    fileHandle, projectId, expectedLastModified, fileName,
  }));
}

async function writeCurrentFileHandleAutomaticallyUnlocked(payload, { fileHandle, projectId, expectedLastModified, fileName } = {}) {
  if (!fileHandle) return false;
  try {
    // O lock pode esperar enquanto o usuário troca de projeto. Nunca escreva
    // o snapshot de um projeto antigo no handle do projeto novo.
    if (!projectId || state?.projectId !== projectId || currentFileHandle !== fileHandle || currentStorageMode !== 'file') return false;
    const permission = typeof fileHandle.queryPermission === 'function'
      ? await fileHandle.queryPermission({ mode: 'readwrite' })
      : 'granted';
    if (permission !== 'granted') return false;

    const file = await fileHandle.getFile();
    if (expectedLastModified && file.lastModified && file.lastModified !== expectedLastModified) {
      // Não sobrescreve silenciosamente uma alteração externa. O projeto
      // continua protegido no armazenamento interno e fica marcado como pendente.
      if (state?.projectId === projectId) cloudSyncPending = !!driveBindingForCurrentProject();
      return false;
    }

    if (state?.projectId !== projectId || currentFileHandle !== fileHandle) return false;
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([JSON.stringify(payload, null, 2)], { type: PRG_MIME }));
    await writable.close();
    const updated = await fileHandle.getFile();
    if (state?.projectId === projectId && currentFileHandle === fileHandle) {
      currentFileLastModified = updated.lastModified || Date.now();
    }
    return true;
  } catch (err) {
    logError('save.automatic_file_failed', err, { fileName });
    return false;
  }
}

async function performAutomaticSave() {
  if (!state || demoMode || !workspaceReady || !state.projectId || !isDirty) return false;
  if (automaticSaveRevision === dirtyRevision) return true;
  if (automaticSaveInFlight) {
    try { await automaticSaveInFlight; } catch (_) {}
    if (!isDirty || automaticSaveRevision === dirtyRevision) return true;
  }

  const saveProjectId = state.projectId;
  const saveRevision = dirtyRevision;
  const payload = buildSavePayload();
  const payloadSavedAt = new Date().toISOString();
  const saveFileHandle = currentFileHandle;
  const saveStorageMode = currentStorageMode;
  const saveFileName = currentFileName;
  const saveFileLastModified = currentFileLastModified;
  const saveDriveBinding = driveBindingForCurrentProject();
  automaticSaveInFlight = (async () => {
    setSaveUiState('saving');
    updateSaveChrome();

    // O armazenamento interno é sempre atualizado primeiro. Assim, uma falha
    // de arquivo local ou de internet não perde o trabalho recém-feito.
    // Primeiro persistimos uma cópia autossuficiente. O handle físico só deve
    // entrar no IndexedDB depois que a gravação física for confirmada; caso
    // contrário, uma reinicialização poderia reabrir uma versão externa mais
    // nova e descartar silenciosamente a versão local protegida.
    const localPersisted = await saveLocalProjectSnapshot({
      stateData: payload,
      storageMode: saveStorageMode === 'none' ? 'local' : saveStorageMode,
      fileName: saveFileName,
      fileHandle: null,
      fileLastModified: saveFileLastModified,
      persistFileHandle: false,
      savedAt: payloadSavedAt,
      driveBindingOverride: saveDriveBinding,
    });

    if (!localPersisted) {
      setSaveUiState('dirty');
      updateSaveChrome();
      return false;
    }

    // Nunca troque o estado vivo pelo snapshot antigo depois de um await.
    // Se o usuário abriu outro projeto enquanto a gravação corria, o snapshot
    // antigo continua seguro no IndexedDB, mas não pode tocar no projeto novo.
    if (state?.projectId !== saveProjectId || !workspaceReady) return false;

    lastLocalSaveAt = Date.now();
    localProjectSaved = true;
    if (currentStorageMode === 'none') currentStorageMode = 'local';

    let physicalFileSaved = saveStorageMode !== 'file';
    if (saveStorageMode === 'file' && saveFileHandle) {
      // Só escreve no handle que existia quando o autosave começou.
      physicalFileSaved = await writeCurrentFileHandleAutomatically(payload, {
        fileHandle: saveFileHandle, projectId: saveProjectId, fileLastModified: saveFileLastModified, fileName: saveFileName,
      });
      if (physicalFileSaved) {
        // Atualiza o snapshot interno com o timestamp físico novo do arquivo.
        await saveLocalProjectSnapshot({
          stateData: payload,
          storageMode: 'file',
          fileName: saveFileName,
          fileHandle: saveFileHandle,
          fileLastModified: currentFileLastModified,
          persistFileHandle: true,
          savedAt: payloadSavedAt,
          driveBindingOverride: saveDriveBinding,
        });
      }
    }

    if (dirtyRevision === saveRevision && physicalFileSaved) {
      isDirty = false;
      cloudSyncPending = !!driveBindingForCurrentProject();
      discardLocalRecoveryDraft();
      automaticSaveRevision = saveRevision;
      setSaveUiState('saved');
    } else {
      isDirty = true;
      cloudSyncPending = !!driveBindingForCurrentProject();
      setSaveUiState('dirty');
    }

    updateSaveChrome();
    return true;
  })().finally(() => {
    automaticSaveInFlight = null;
  });

  return automaticSaveInFlight;
}

function clearDirty({ discardRecovery = true, expectedRevision = null } = {}) {
  if (expectedRevision !== null && dirtyRevision !== expectedRevision) {
    isDirty = true;
    setSaveUiState('dirty');
    updateSaveChrome();
    return false;
  }
  isDirty = false;
  setSaveUiState('saved');
  if (discardRecovery) discardLocalRecoveryDraft();
  updateSaveChrome();
  return true;
}

function buildRecoveryRecord() {
  if (!state || demoMode || !workspaceReady || !state.projectId) return null;
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    currentFileName: currentFileName || null,
    driveBinding: driveBindingForCurrentProject() || null,
    state: buildSavePayload(),
  };
}

function persistLocalRecoveryDraft() {
  if (!state || demoMode || !workspaceReady || !isDirty || !state.projectId) return false;
  try {
    const record = buildRecoveryRecord();
    const token = ++recoveryWriteToken;
    recoveryDraftCache = record;
    recoveryDraftTimestamp = record.savedAt;
    writeRecoveryRecord(record).then(async ok => {
      if (token !== recoveryWriteToken || !state?.projectId || state.projectId !== record.state.projectId || !isDirty) {
        if (token !== recoveryWriteToken) return;
        await deleteRecoveryRecord(record.state.projectId);
        return;
      }
      if (!ok) {
        try { localStorage.setItem(LOCAL_RECOVERY_KEY, JSON.stringify(record)); } catch (_) {}
      }
    }).catch(() => {});
    updateSaveChrome();
    renderWelcomeRecovery();
    return true;
  } catch (err) {
    console.warn('[ProfessorGest] Não foi possível guardar a cópia local de recuperação.', err);
    return false;
  }
}

function scheduleLocalRecoveryDraft() {
  clearTimeout(localDraftSaveTimer);
  localDraftSaveTimer = setTimeout(() => persistLocalRecoveryDraft(), 550);
}

function buildAutomaticBackupRecord(reason = 'Proteção automática') {
  if (!state || demoMode || !workspaceReady || !state.projectId) return null;
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    reason,
    currentFileName: currentFileName || null,
    storageMode: currentStorageMode || 'local',
    fileLastModified: Number(currentFileLastModified) || 0,
    driveBinding: driveBindingForCurrentProject() || null,
    state: buildSavePayload(),
  };
}

async function createAutomaticBackup(reason = 'Proteção automática', { force = false } = {}) {
  if (!state || demoMode || !workspaceReady || !state.projectId) return false;
  if (!force && automaticBackupRevision === dirtyRevision) return true;
  const record = buildAutomaticBackupRecord(reason);
  if (!record) return false;
  if (automaticBackupInFlight) {
    try { await automaticBackupInFlight; } catch (_) {}
    if (!force && automaticBackupRevision === dirtyRevision) return true;
  }
  automaticBackupInFlight = writeProjectBackup(record, 10).then(ok => {
    if (ok) {
      automaticBackupRevision = dirtyRevision;
      projectBackupsCache = [record, ...projectBackupsCache.filter(item => item?.backupId !== record.backupId)].slice(0, 10);
      if (state?.projectId === record.state.projectId) {
        readProjectBackups(record.state.projectId, 10).then(rows => { projectBackupsCache = rows; }).catch(() => {});
      }
    }
    return ok;
  }).catch(() => false);
  try { return await automaticBackupInFlight; } finally { automaticBackupInFlight = null; }
}

function scheduleAutomaticBackup() {
  clearTimeout(automaticBackupTimer);
  automaticBackupTimer = setTimeout(() => {
    if (isDirty) createAutomaticBackup('Proteção automática').catch(() => {});
  }, 1800);
}

async function refreshProjectBackups(projectId = state?.projectId) {
  if (!projectId) { projectBackupsCache = []; return []; }
  projectBackupsCache = await readProjectBackups(projectId, 10);
  return projectBackupsCache;
}

function getProjectBackups() { return projectBackupsCache; }

async function openBackupsModal({ global = false } = {}) {
  const backups = global ? await readAllProjectBackups(50) : await refreshProjectBackups();
  const fromWelcome = global;
  openModal(`
    <div class="modal-title">Cópias de segurança</div>
    <p class="confirm-body">O ProfessorGest guarda versões anteriores automaticamente neste dispositivo. Elas servem para recuperar um trabalho sem alterar o arquivo .prg original.</p>
    <div class="backup-toolbar">
      <span>${backups.length ? `${backups.length} ${backups.length === 1 ? 'cópia disponível' : 'cópias disponíveis'}` : 'Nenhuma cópia armazenada'}</span>
      ${backups.length ? '<button type="button" class="btn-ghost btn-sm danger" id="btnClearBackupsModal">Limpar cópias</button>' : ''}
    </div>
    <div class="backup-list">
      ${backups.length ? backups.map((backup, index) => {
        const teacher = backup.state?.teacher?.name ? ` · ${esc(backup.state.teacher.name)}` : '';
        const fileName = backup.currentFileName || 'Projeto sem nome';
        const actionLabel = fromWelcome ? 'Abrir esta cópia' : (index === 0 ? 'Restaurar' : 'Restaurar esta cópia');
        return `<div class="backup-item">
          <div><strong>${esc(fileName)}</strong><span>${formatRecoveryTime(backup.savedAt)}${teacher} · Backup automático</span></div>
          <button type="button" class="btn-secondary btn-sm" data-restore-backup="${esc(backup.backupId || '')}">${actionLabel}</button>
        </div>`;
      }).join('') : emptyState('Ainda não há cópias de segurança.', 'Tudo certo: as próximas cópias serão criadas automaticamente enquanto você trabalha em um projeto.')}
    </div>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Fechar</button></div>
  `);
  projectBackupsCache = backups;
  qAll('[data-restore-backup]').forEach(button => {
    button.onclick = () => restoreAutomaticBackup(button.dataset.restoreBackup, { fromWelcome });
  });
  onClick('#btnClearBackupsModal', () => {
    confirmModal({
      title: `Limpar ${backups.length} ${backups.length === 1 ? 'cópia' : 'cópias'} de segurança?`,
      body: 'As cópias automáticas armazenadas neste dispositivo serão removidas. Seu arquivo .prg original e o arquivo do Google Drive não serão alterados.',
      confirmLabel: 'Limpar cópias', danger: true,
      onConfirm: async () => {
        const ok = await clearProjectBackups(global ? null : state?.projectId || null);
        closeModal();
        if (ok) { projectBackupsCache = []; toast('As cópias de segurança foram removidas.', 'success'); }
        else toast('Não foi possível limpar as cópias de segurança.', 'error');
      }
    });
  });
}

async function restoreAutomaticBackup(backupId, { fromWelcome = false } = {}) {
  const backup = projectBackupsCache.find(item => item.backupId === backupId);
  if (!backup?.state) return;
  confirmModal({
    title: 'Restaurar esta cópia?',
    body: 'O conteúdo atual será substituído pela cópia escolhida nesta sessão. O original não será sobrescrito automaticamente.',
    confirmLabel: 'Restaurar',
    danger: true,
    onConfirm: async () => {
      if (state?.projectId && workspaceReady && !demoMode) {
        await createAutomaticBackup('Antes de restaurar uma cópia', { force: true });
      }
      const result = validateProjectData(backup.state);
      if (!result.ok) { toast('Essa cópia não pôde ser restaurada.', 'error'); return; }
      state = result.data;
      demoMode = false;
      workspaceReady = true;
      currentFileName = backup.currentFileName || currentFileName || null;
      currentFileHandle = null;
      currentStorageMode = 'local';
      currentFileLastModified = 0;
      clearDriveBinding();
      cloudSyncPending = false;
      resetContext();
      isDirty = true;
      dirtyRevision += 1;
      automaticBackupRevision = -1;
      await refreshProjectBackups(state.projectId);
      setSaveUiState('dirty');
      discardLocalRecoveryDraft();
      persistLocalRecoveryDraft();
      closeModal();
      enterWorkspace();
      navigate('dashboard');
      toast(fromWelcome ? 'Cópia aberta. Revise o projeto e salve quando estiver tudo certo.' : 'Cópia restaurada. Revise o projeto e salve quando estiver tudo certo.', 'info');
    }
  });
}

function discardLocalRecoveryDraft() {
  clearTimeout(localDraftSaveTimer);
  clearTimeout(automaticBackupTimer);
  recoveryWriteToken += 1;
  const projectId = state?.projectId || recoveryDraftCache?.state?.projectId || null;
  if (projectId) deleteRecoveryRecord(projectId);
  recoveryDraftCache = null;
  recoveryDraftTimestamp = null;
  try { localStorage.removeItem(LOCAL_RECOVERY_KEY); } catch (_) {}
  renderWelcomeRecovery();
}

function readLocalRecoveryDraft() {
  if (recoveryDraftCache?.state) return recoveryDraftCache;
  try {
    const raw = localStorage.getItem(LOCAL_RECOVERY_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record?.state?.format !== PRG_FORMAT) return null;
    return record;
  } catch (_) {
    return null;
  }
}

async function hydrateRecoveryCache() {
  try {
    const latest = await readLatestRecoveryRecord();
    recoveryDraftCache = latest?.state ? latest : null;
    recoveryDraftTimestamp = recoveryDraftCache?.savedAt || null;
    return recoveryDraftCache;
  } catch (_) {
    return null;
  }
}

function formatRecoveryTime(iso) {
  if (!iso) return 'agora';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'recentemente';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function recoverLocalDraft() {
  const record = readLocalRecoveryDraft();
  if (!record) { toast('Não encontramos uma cópia local válida.', 'error'); return; }
  try {
    const result = validateProjectData(record.state);
    if (!result.ok) throw new Error('A cópia de recuperação não passou pela validação.');
    state = result.data;
    demoMode = false;
    workspaceReady = true;
    currentFileName = record.currentFileName || null;
    currentFileHandle = null;
    currentStorageMode = 'local';
    currentFileLastModified = 0;
    localProjectSaved = false;
    localProjectSavedAt = 0;
    if (record.driveBinding?.fileId) saveDriveBinding(record.driveBinding);
    cloudSyncPending = !!driveBindingForCurrentProject();
    isDirty = true;
    setSaveUiState('dirty');
    resetContext();
    enterWorkspace();
    navigate('dashboard');
    toast('Cópia local recuperada. O salvamento automático continuará a partir daqui.', 'info');
    render();
  } catch (err) {
    console.error('[ProfessorGest] Erro ao recuperar cópia local:', err);
    toast('Não foi possível recuperar a cópia local.', 'error');
  }
}

// O Drive só é atualizado por uma ação explícita do usuário. A sessão do Google só é
// solicitada quando o professor clica em uma ação explícita de atualizar o Drive.

function updateSaveChrome() {
  const status = document.getElementById('topbarSaveStatus');
  if (!status) return;

  if (demoMode) {
    status.innerHTML = `<span class="save-chip neutral"><span class="save-chip-dot"></span>Demonstração</span>`;
    status.title = 'Modo demonstração';
    return;
  }

  let label = 'Ainda não salvo';
  let cls = 'neutral';

  if (saveUiState === 'saving') {
    label = 'Salvando neste dispositivo…'; cls = 'saving';
  } else if (saveUiState === 'syncing') {
    label = 'Atualizando o Google Drive…'; cls = 'syncing';
  } else if (isDirty) {
    label = 'Salvando neste dispositivo…'; cls = 'dirty';
  } else if (cloudSyncPending && driveBindingForCurrentProject()) {
    label = 'Salvo neste dispositivo · atualize o Drive'; cls = 'dirty';
  } else if (driveBindingForCurrentProject()) {
    label = 'Salvo neste dispositivo · Drive atualizado'; cls = 'synced';
  } else if (currentStorageMode === 'local' || currentFileName) {
    label = 'Salvo automaticamente neste dispositivo'; cls = 'saved';
  }

  status.innerHTML = `<span class="save-chip ${cls}"><span class="save-chip-dot"></span><span>${label}</span></span>`;
  status.title = label;
}

async function savePrimaryAction() {
  if (demoMode || !workspaceReady || !state) return;
  setSaveUiState('saving');
  updateSaveChrome();
  try {
    await saveFile({ fromPrimarySave: true });
  } catch (_) {
    setSaveUiState('dirty');
    updateSaveChrome();
  }
}

function updateWelcomeAccountControl() {
  const control = document.getElementById('welcomeAccountControl');
  const avatar = document.getElementById('welcomeAccountAvatar');
  const name = document.getElementById('welcomeAccountName');
  const meta = document.getElementById('welcomeAccountMeta');
  if (!control || !avatar || !name || !meta) return;

  const configured = isGoogleDriveConfigured();
  if (driveAccount) {
    avatar.className = 'welcome-account-avatar';
    avatar.innerHTML = driveAccountAvatarHTML({ className: 'welcome-account-avatar-image' });
    name.textContent = driveAccountLabel();
    meta.textContent = driveAccount.email || 'Conta Google conectada';
    control.classList.add('connected');
    control.title = 'Gerenciar conta Google';
    control.setAttribute('aria-label', `Conta Google: ${driveAccountLabel()}`);
  } else {
    avatar.className = 'welcome-account-avatar welcome-account-avatar-drive';
    avatar.innerHTML = `<span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M7 18h10.2a4.8 4.8 0 0 0 .6-9.56A6.5 6.5 0 0 0 5.1 9.7 4.2 4.2 0 0 0 7 18z"/></svg></span>`;
    name.textContent = configured ? 'Google Drive' : 'Google Drive';
    meta.textContent = configured ? 'Conectar conta' : 'Não configurado';
    control.classList.remove('connected');
    control.title = configured ? 'Conectar uma conta Google ao ProfessorGest' : 'Google Drive ainda não configurado';
    control.setAttribute('aria-label', control.title);
  }
}

function updateWelcomeExperience(returningUser) {
  const screen = document.getElementById('welcomeScreen');
  const newFile = document.getElementById('welcomeNewFile');
  const openFile = document.getElementById('welcomeOpenFile');
  const title = document.querySelector('.welcome-content-minimal h1');
  const lead = document.querySelector('.welcome-content-minimal .welcome-lead');
  updateWelcomeAccountControl();
  if (!screen || !newFile || !openFile) return;
  screen.classList.toggle('welcome-returning', !!returningUser);
  newFile.classList.toggle('primary', !returningUser);
  openFile.classList.toggle('primary', !!returningUser);
  if (returningUser) {
    if (title) title.textContent = 'Continue seu trabalho.';
    if (lead) lead.textContent = 'Abra um arquivo existente ou comece um novo.';
    openFile.querySelector('.welcome-card-copy strong')?.replaceChildren(document.createTextNode('Abrir meu arquivo'));
  } else {
    if (title) title.textContent = 'Vamos começar.';
    if (lead) lead.textContent = 'Abra seu arquivo ou crie um novo espaço de trabalho.';
    openFile.querySelector('.welcome-card-copy strong')?.replaceChildren(document.createTextNode('Abrir arquivo'));
  }
}


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

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

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

function loadDriveBinding() {
  const loaded = readDriveBindings();
  driveBindingsByProject = loaded.bindings;
  driveBinding = state?.projectId ? getDriveBinding(driveBindingsByProject, state.projectId) : null;
  return driveBindingsByProject;
}

function persistDriveBindings() {
  writeDriveBindings(driveBindingsByProject);
}

function saveDriveBinding(binding) {
  const result = setDriveBinding(driveBindingsByProject, {
    ...binding,
    accountPermissionId: driveAccount?.permissionId || null,
    accountEmail: driveAccount?.email || null,
  }, state?.projectId);
  if (!result.binding) return false;
  driveBindingsByProject = result.bindings;
  driveBinding = result.binding;
  persistDriveBindings();
  return true;
}

function clearDriveBinding() {
  const projectId = state?.projectId;
  driveBindingsByProject = removeDriveBinding(driveBindingsByProject, projectId);
  if (projectId) persistDriveBindings();
  driveBinding = null;
}

function loadDriveBindingForProject(projectId) {
  driveBinding = getDriveBinding(driveBindingsByProject, projectId);
  return driveBinding;
}

function driveStatusText() {
  const binding = driveBindingForCurrentProject();
  if (!isGoogleDriveConfigured()) return 'Integração não configurada';
  if (!binding) return 'Google Drive disponível';
  if (saveUiState === 'syncing') return 'Atualizando o Google Drive…';
  if (isDirty || cloudSyncPending) return 'Há alterações que ainda não foram enviadas ao Drive';
  return 'Drive atualizado';
}

function driveStatusTone() {
  const binding = driveBindingForCurrentProject();
  if (!isGoogleDriveConfigured()) return 'neutral';
  if (!binding) return 'neutral';
  if (saveUiState === 'syncing') return 'saved';
  if (isDirty || cloudSyncPending) return 'dirty';
  return 'saved';
}

function driveBindingForCurrentProject() {
  if (!state?.projectId) return null;
  const binding = driveBindingsByProject[state.projectId] || driveBinding;
  if (!binding?.fileId || binding.projectId !== state.projectId) return null;
  if (driveBindingAccountMismatch(binding)) return null;
  if ((binding.accountPermissionId || binding.accountEmail) && !driveAccount) return null;
  return binding;
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

function driveBindingAccountMismatch(binding) {
  if (!binding || !driveAccount) return false;
  if (binding.accountPermissionId && driveAccount.permissionId
      && binding.accountPermissionId !== driveAccount.permissionId) return true;
  if (binding.accountEmail && driveAccount.email
      && binding.accountEmail !== driveAccount.email) return true;
  return false;
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
    if (previousAccount?.permissionId && driveAccount?.permissionId
        && previousAccount.permissionId !== driveAccount.permissionId) {
      driveBinding = state?.projectId ? getDriveBinding(driveBindingsByProject, state.projectId) : null;
    }
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
  if (!driveAccount) { openDrivePicker(); return; }
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

function remoteFileName() {
  return currentFileName ? normalizePrgFileName(currentFileName) : `professorgest-${teacherBase}.prg`;
}

const DRIVE_FILE_FIELDS = 'id,name,mimeType,modifiedTime';

/*
 * Envia metadados e conteúdo na MESMA requisição (multipart). O fluxo anterior
 * criava o arquivo como "Untitled" e só depois o renomeava; se a segunda
 * chamada falhasse, sobrava um arquivo órfão no Drive sem vínculo no app, e
 * cada nova tentativa criava mais um.
 */
function buildDriveMultipartBody(metadata, content) {
  const boundary = `professorgest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

async function createDriveFileFromCurrent() {
  if (demoMode) throw new Error('A demonstração não pode ser sincronizada.');
  await getDriveAccessToken({ forceConsent: false });
  const name = remoteFileName();
  lastDriveUploadRevision = dirtyRevision;
  const json = JSON.stringify(buildSavePayload(), null, 2);
  const { body, contentType } = buildDriveMultipartBody({ name, mimeType: PRG_MIME }, json);
  const meta = await driveJson(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=${DRIVE_FILE_FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
  currentFileName = name;
  saveDriveBinding({ fileId: meta.id, name: meta.name, modifiedTime: meta.modifiedTime, lastSyncAt: new Date().toISOString() });
  return meta;
}

async function updateDriveFile(fileId) {
  // A gravação pode atravessar awaits de rede. Registre qual revisão entrou
  // efetivamente no payload para que o chamador não marque como sincronizadas
  // alterações feitas depois desse snapshot.
  lastDriveUploadRevision = dirtyRevision;
  const json = JSON.stringify(buildSavePayload(), null, 2);
  const name = currentFileName ? normalizePrgFileName(currentFileName) : (driveBinding?.name || remoteFileName());
  const { body, contentType } = buildDriveMultipartBody({ name, mimeType: PRG_MIME }, json);
  const meta = await driveJson(`${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=${DRIVE_FILE_FIELDS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': contentType },
    body,
  });
  saveDriveBinding({ fileId: meta.id, name: meta.name || name, modifiedTime: meta.modifiedTime, lastSyncAt: new Date().toISOString() });
  return meta;
}

async function getDriveMeta(fileId) {
  return driveJson(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,capabilities(canEdit),trashed`);
}

async function getDriveFileContent(fileId) {
  return driveText(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`);
}

function errorMessage(code) {
  switch (code) {
    case 'size': return 'O arquivo é maior do que o limite permitido pelo ProfessorGest.';
    case 'json': return 'O arquivo não é um JSON válido.';
    case 'format': return 'O arquivo não parece ser um projeto válido do ProfessorGest.';
    case 'version': return 'Este arquivo usa uma versão do ProfessorGest que ainda não é suportada por este aplicativo.';
    case 'projectId': return 'O arquivo não possui um identificador de projeto válido.';
    case 'shape': return 'O arquivo está incompleto ou corrompido (faltam dados essenciais como turmas, alunos, atividades ou ocorrências).';
    case 'limits': return 'O arquivo excede os limites de quantidade de turmas, alunos, escolas ou atividades suportados.';
    case 'integrity': return 'O arquivo contém registros duplicados ou inconsistentes e não pôde ser aberto com segurança.';
    default: return 'O arquivo não parece ser um projeto válido do ProfessorGest.';
  }
}

async function openDriveFileById(fileId, fallbackName = 'ProfessorGest.prg') {
  const meta = await getDriveMeta(fileId);
  if (meta.trashed) throw new Error('Esse arquivo está na lixeira do Google Drive.');
  if (meta.capabilities && meta.capabilities.canEdit === false) throw new Error('Este arquivo pode ser aberto, mas sua conta não tem permissão para editá-lo.');
  const text = await getDriveFileContent(fileId);
  const result = validateAndParsePrg(text);
  if (!result.ok) throw new Error(errorMessage(result.error));
  currentFileHandle = null;
  applyOpenedData(result.data, meta.name || fallbackName, {
    fileId: meta.id,
    name: meta.name || fallbackName,
    modifiedTime: meta.modifiedTime || null,
    lastSyncAt: new Date().toISOString(),
  }, null, { storageMode: 'drive', fileLastModified: 0, persistLocal: true, warnings: result.warnings || [] });
  return meta;
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
        await withAppLoading('Abrindo seu arquivo...', async () => {
          await openDriveFileById(doc.id, doc.name || 'ProfessorGest.prg');
        });
        toast('Arquivo aberto do Google Drive.', 'success');
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

async function syncCurrentProjectToDrive({ force = false, silent = false, skipTokenRefresh = false } = {}) {
  if (driveSyncPromise) {
    if (!force) return driveSyncPromise;
    // "Manter este dispositivo" precisa sobrescrever de fato. Reaproveitar uma
    // sincronização sem force em andamento devolvia o resultado dela (conflito).
    try { await driveSyncPromise; } catch (_) {}
    if (driveSyncPromise) return syncCurrentProjectToDrive({ force, silent, skipTokenRefresh });
  }
  driveSyncPromise = (async () => {
    if (demoMode) return false;
    if (!driveBindingForCurrentProject()?.fileId) return false;
    if (!skipTokenRefresh) await getDriveAccessToken({ forceConsent: false });
    if (!driveAccessToken) throw new Error('A autorização do Google Drive precisa ser renovada.');
    const binding = driveBindingForCurrentProject();
    if (!binding?.fileId) return false;
    const remote = await getDriveMeta(binding.fileId);
    const remoteChanged = binding.modifiedTime && remote.modifiedTime && new Date(remote.modifiedTime).getTime() > new Date(binding.modifiedTime).getTime() + 1000;
    if (remoteChanged && !force) {
      showDriveConflict(remote);
      return false;
    }
    if (force && isDirty) {
      await saveLocalProjectSnapshot({ stateData: buildSavePayload(), storageMode: 'local', fileName: currentFileName, fileHandle: null, fileLastModified: currentFileLastModified });
    }
    await updateDriveFile(binding.fileId);
    if (!silent) toast('Drive atualizado.', 'success');
    render();
    return true;
  })().finally(() => { driveSyncPromise = null; });
  return driveSyncPromise;
}

function showDriveConflict(remoteMeta) {
  const bindingId = driveBindingForCurrentProject()?.fileId;
  if (!bindingId) return;
  const conflictRevision = dirtyRevision;
  openModal(`
    <div class="confirm-icon danger">${ICONS.alert}</div>
    <div class="modal-title">O arquivo mudou no Google Drive</div>
    <p class="confirm-body">Existe uma versão mais recente do arquivo na nuvem. Escolha qual versão deve continuar sendo usada.</p>
    <ul class="confirm-detail-list">
      <li><span>Neste dispositivo</span><strong>${esc(currentFileName || 'Projeto atual')}</strong></li>
      <li><span>No Drive</span><strong>${esc(remoteMeta.name || currentFileName || 'Projeto')}</strong></li>
    </ul>
    <div class="form-actions form-actions-wrap-mobile">
      <button type="button" class="btn-secondary" id="driveUseRemote">Usar versão do Drive</button>
      <button type="button" class="btn-primary" id="driveKeepLocal">Manter este dispositivo</button>
    </div>
  `);
  document.getElementById('driveUseRemote').onclick = async () => {
    closeModal();
    try { await openDriveFileById(bindingId, remoteMeta.name); toast('Versão do Drive carregada.', 'success'); }
    catch (err) { toast(err.message || 'Não foi possível carregar a versão do Drive.', 'error'); }
  };
  document.getElementById('driveKeepLocal').onclick = async () => {
    closeModal();
    try {
      setSaveUiState('syncing');
      updateSaveChrome();

      const synced = await syncCurrentProjectToDrive({ force: true, silent: true });
      if (!synced) {
        cloudSyncPending = true;
        isDirty = true;
        setSaveUiState('dirty');
        updateSaveChrome();
        return;
      }

      lastCloudSyncAt = Date.now();
      lastLocalSaveAt = Date.now();

      // Só limpe o estado de alteração se nada novo foi editado
      // enquanto o diálogo de conflito estava aberto.
      if (dirtyRevision === conflictRevision) {
        cloudSyncPending = false;
        clearDirty({ expectedRevision: conflictRevision });
        setSaveUiState('synced');
        toast('Versão deste dispositivo mantida e enviada para o Google Drive.', 'success');
      } else {
        cloudSyncPending = true;
        isDirty = true;
        setSaveUiState('dirty');
        toast('A versão deste dispositivo foi enviada, mas há alterações novas pendentes.', 'info');
      }

      updateSaveChrome();
      render();
    } catch (err) {
      cloudSyncPending = true;
      isDirty = true;
      setSaveUiState('dirty');
      updateSaveChrome();
      toast(err.message || 'Não foi possível atualizar o Drive.', 'error');
    }
  };
}

async function saveCurrentToGoogleDrive({ fromPrimarySave = false } = {}) {
  if (driveActionPromise) return driveActionPromise;

  driveActionPromise = saveCurrentToGoogleDriveUnlocked({ fromPrimarySave })
    .catch(err => {
      logError('drive.action.failed', err, { projectId: state?.projectId || null });
      return false;
    })
    .finally(() => {
      driveActionPromise = null;
      setDriveActionUI(false);
      updateSaveChrome();
      if (state && workspaceReady) render();
    });

  return driveActionPromise;
}

async function saveCurrentToGoogleDriveUnlocked({ fromPrimarySave = false } = {}) {
  if (demoMode) { toast('A demonstração não pode ser sincronizada.', 'info'); return false; }
  if (!state?.projectId || !workspaceReady) return false;
  if (!isGoogleDriveConfigured()) { showDriveNotConfigured(); return false; }

  setDriveActionUI(true);
  setSaveUiState('syncing');
  updateSaveChrome();

  // Antes de mandar algo para a nuvem, garanta que o estado atual já esteja
  // protegido localmente. Isso evita que o botão do Drive vire um segundo
  // caminho de salvamento que ignore o local-first.
  if (isDirty) {
    const localSaved = await performAutomaticSave();
    if (!localSaved || isDirty) {
      cloudSyncPending = !!driveBindingForCurrentProject();
      setSaveUiState('dirty');
      updateSaveChrome();
      return false;
    }
  }

  // A revisão é capturada imediatamente antes da operação de nuvem. Se o
  // professor editar durante login/rede/upload, a nova alteração continuará
  // marcada como pendente, em vez de ser apagada pelo sync anterior.
  const syncRevision = dirtyRevision;
  await getDriveAccessToken({ forceConsent: false });
  await refreshDriveAccountProfile();

  const rawBinding = state?.projectId ? getDriveBinding(driveBindingsByProject, state.projectId) : null;
  if (driveBindingAccountMismatch(rawBinding)) {
    openModal(`
      <div class="modal-title">Este projeto está vinculado a outra conta</div>
      <p class="confirm-body">O projeto atual foi associado a uma conta Google diferente da que está conectada agora. Isso evita criar uma cópia no Drive sem intenção.</p>
      <div class="confirm-detail-list"><li><span>Conta vinculada</span><strong>${esc(rawBinding.accountEmail || 'Conta anterior')}</strong></li><li><span>Conta atual</span><strong>${esc(driveAccount?.email || 'Conta Google')}</strong></li></div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="btnDriveConflictSwitchBack">Trocar conta</button><button type="button" class="btn-primary" id="btnDriveCreateNewLink">Criar novo vínculo</button></div>
    `, false);
    document.getElementById('btnDriveConflictSwitchBack')?.addEventListener('click', () => { closeModal(); switchDriveAccount(); });
    document.getElementById('btnDriveCreateNewLink')?.addEventListener('click', async () => {
      closeModal();
      try {
        setDriveActionUI(true);
        setSaveUiState('syncing');
        updateSaveChrome();
        const linkRevision = dirtyRevision;
        const meta = await createDriveFileFromCurrent();
        currentStorageMode = 'drive';
        lastCloudSyncAt = Date.now();
        await saveLocalProjectSnapshot({ stateData: buildSavePayload(), storageMode: 'drive', fileName: currentFileName, fileHandle: null, fileLastModified: 0 });
        const linkStillCurrent = lastDriveUploadRevision === dirtyRevision;
        if (linkStillCurrent) {
          cloudSyncPending = false;
          clearDirty({ expectedRevision: linkRevision });
          setSaveUiState('synced');
        } else {
          cloudSyncPending = true;
          isDirty = true;
          setSaveUiState('dirty');
          }
        await saveLocalProjectSnapshot({
          stateData: buildSavePayload(),
          storageMode: 'drive',
          fileName: currentFileName,
          fileHandle: null,
          fileLastModified: 0,
          driveBindingOverride: driveBindingForCurrentProject(),
          driveSyncPendingOverride: !linkStillCurrent,
        });
        toast(`Novo vínculo criado no Google Drive como ${meta.name}.`, 'success');
        render();
      } catch (err) {
        cloudSyncPending = !!driveBindingForCurrentProject();
        setSaveUiState(isDirty ? 'dirty' : 'saved');
        toast(err?.message || 'Não foi possível criar o novo vínculo.', 'error');
      } finally {
        setDriveActionUI(false);
        updateSaveChrome();
        render();
      }
    });
    setSaveUiState(isDirty ? 'dirty' : 'saved');
    return false;
  }

  const binding = driveBindingForCurrentProject();
  try {
    if (binding?.fileId) {
      const synced = await syncCurrentProjectToDrive({ silent: true, skipTokenRefresh: true });
      if (!synced) {
        cloudSyncPending = true;
        setSaveUiState(isDirty ? 'dirty' : 'saved');
        updateSaveChrome();
        return false;
      }
      lastCloudSyncAt = Date.now();
      lastLocalSaveAt = Date.now();
      currentStorageMode = 'drive';
      const localPersisted = await saveLocalProjectSnapshot({
        stateData: buildSavePayload(), storageMode: 'drive', fileName: currentFileName,
        fileHandle: null, fileLastModified: 0,
      });
      if (!localPersisted) {
        cloudSyncPending = true;
        isDirty = true;
        setSaveUiState('dirty');
        toast('O Drive foi atualizado, mas a cópia local não pôde ser atualizada. O projeto continuará marcado como pendente até uma nova gravação local.', 'error');
        return false;
      }
      const syncStillCurrent = lastDriveUploadRevision === dirtyRevision;
      if (syncStillCurrent) {
        cloudSyncPending = false;
        clearDirty({ expectedRevision: syncRevision });
        setSaveUiState('synced');
      } else {
        cloudSyncPending = true;
        isDirty = true;
        setSaveUiState('dirty');
      }
      await saveLocalProjectSnapshot({
        stateData: buildSavePayload(),
        storageMode: 'drive',
        fileName: currentFileName,
        fileHandle: null,
        fileLastModified: 0,
        driveBindingOverride: driveBindingForCurrentProject(),
        driveSyncPendingOverride: !syncStillCurrent,
      });
      toast(syncStillCurrent ? 'Drive atualizado.' : 'Drive atualizado. Há novas alterações locais que precisam ser enviadas.', syncStillCurrent ? 'success' : 'info');
      render();
      return true;
    }

    const meta = await createDriveFileFromCurrent();
    lastCloudSyncAt = Date.now();
    lastLocalSaveAt = Date.now();
    currentStorageMode = 'drive';
    const localPersisted = await saveLocalProjectSnapshot({
      stateData: buildSavePayload(), storageMode: 'drive', fileName: currentFileName,
      fileHandle: null, fileLastModified: 0,
    });
    if (!localPersisted) {
      isDirty = true;
      cloudSyncPending = true;
      setSaveUiState('dirty');
      toast('O arquivo foi criado no Google Drive, mas não consegui atualizar a cópia local. Tente salvar novamente neste dispositivo.', 'error');
      return false;
    }
    const syncStillCurrent = lastDriveUploadRevision === dirtyRevision;
    if (syncStillCurrent) {
      cloudSyncPending = false;
      clearDirty({ expectedRevision: syncRevision });
      setSaveUiState('synced');
    } else {
      cloudSyncPending = true;
      isDirty = true;
      setSaveUiState('dirty');
    }
    await saveLocalProjectSnapshot({
      stateData: buildSavePayload(),
      storageMode: 'drive',
      fileName: currentFileName,
      fileHandle: null,
      fileLastModified: 0,
      driveBindingOverride: driveBindingForCurrentProject(),
      driveSyncPendingOverride: !syncStillCurrent,
    });
    toast(syncStillCurrent ? `Salvo no Google Drive como ${meta.name}.` : `Drive atualizado como ${meta.name}. Há novas alterações pendentes.`, syncStillCurrent ? 'success' : 'info');
    render();
    return true;
  } catch (err) {
    driveAuthCancelled = isDriveAuthCancellationError(err);
    cloudSyncPending = !!driveBindingForCurrentProject()?.fileId;
    setSaveUiState(isDirty ? 'dirty' : 'saved');
    updateSaveChrome();
    if (err?.status === 404 && binding?.fileId) {
      openModal(`
        <div class="confirm-icon info">${ICONS.cloud}</div>
        <div class="modal-title">O arquivo do Drive não está mais disponível</div>
        <p class="confirm-body">O vínculo deste projeto aponta para um arquivo que foi removido ou não está mais acessível. O projeto local continua preservado.</p>
        <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Continuar neste dispositivo</button><button type="button" class="btn-primary" id="btnDriveRecreateLink">Criar novo arquivo no Drive</button></div>
      `, false);
      document.getElementById('btnDriveRecreateLink')?.addEventListener('click', async () => {
        closeModal();
        try { await saveCurrentToGoogleDrive({ fromPrimarySave }); }
        catch (_) {}
      });
    } else if (!driveAuthCancelled) {
      toast(err.message || 'Não foi possível salvar no Google Drive.', 'error');
    }
    return false;
  }
}

function disconnectCurrentDriveFile() {
  clearDriveBinding();
  cloudSyncPending = false;
  toast('Vínculo com o Google Drive removido deste projeto.', 'info');
  render();
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

async function resetInMemoryAfterLocalDataClear() {
  clearTimeout(localDraftSaveTimer);
  clearTimeout(automaticBackupTimer);
  recoveryWriteToken += 1;
  state = null;
  demoMode = false;
  workspaceReady = false;
  currentFileName = null;
  currentFileHandle = null;
  currentStorageMode = 'none';
  currentFileLastModified = 0;
  localProjectSaved = false;
  localProjectSavedAt = 0;
  recoveryDraftCache = null;
  recoveryDraftTimestamp = null;
  projectBackupsCache = [];
  automaticBackupRevision = -1;
  cloudSyncPending = false;
  driveAccessToken = null;
  driveTokenExpiresAt = 0;
  driveTokenClient = null;
  driveAuthCancelled = false;
  driveAccount = null;
  clearDriveAccount();
  driveBinding = null;
  driveBindingsByProject = {};
  lastLocalSaveAt = 0;
  lastCloudSyncAt = 0;
  dirtyRevision = 0;
  isDirty = false;
  saveUiState = 'idle';
  try { localStorage.removeItem(LOCAL_RECOVERY_KEY); } catch (_) {}
  try { localStorage.removeItem(DEV_LOG_KEY); } catch (_) {}
  try { localStorage.removeItem('professorgest-theme'); } catch (_) {}
  writeDriveBindings({});
  resetContext();
}

async function clearAllDataAndReturnToWelcome() {
  const cleared = await clearAllLocalData();
  if (!cleared) {
    toast('Não foi possível apagar todos os dados deste dispositivo. Tente novamente.', 'error');
    return false;
  }
  await resetInMemoryAfterLocalDataClear();
  applyThemeMode('light', false);
  await showWelcomeScreen();
  toast('Os dados do ProfessorGest neste dispositivo foram apagados.', 'info');
  return true;
}

async function discardSavedLocalProject(projectId) {
  if (!projectId) return false;
  const ok = await deleteLocalProjectRecord(projectId);
  if (!ok) { toast('Não foi possível remover a versão local.', 'error'); return false; }
  if (state?.projectId === projectId) {
    localProjectSaved = false;
    localProjectSavedAt = 0;
  }
  await renderWelcomeRecovery();
  toast('A versão local foi removida. O arquivo .prg original não foi alterado.', 'info');
  return true;
}

async function clearAllLocalProjectVersions() {
  const ok = await clearLocalProjectRecords();
  if (!ok) {
    toast('Não foi possível limpar as versões locais.', 'error');
    return false;
  }
  localProjectSaved = false;
  localProjectSavedAt = 0;
  await renderWelcomeRecovery();
  toast('As versões locais foram removidas. Seus arquivos .prg não foram alterados.', 'success');
  return true;
}

async function discardRecoveryForProject(projectId) {
  if (!projectId) return false;
  const ok = await deleteRecoveryRecord(projectId);
  try { localStorage.removeItem(LOCAL_RECOVERY_KEY); } catch (_) {}
  if (!ok) { toast('Não foi possível descartar a recuperação.', 'error'); return false; }
  if (recoveryDraftCache?.state?.projectId === projectId) {
    recoveryDraftCache = null;
    recoveryDraftTimestamp = null;
  }
  await renderWelcomeRecovery();
  toast('A recuperação protegida foi descartada. O arquivo .prg original não foi alterado.', 'info');
  return true;
}

async function openLocalDataManager() {
  const recovery = readLocalRecoveryDraft();
  let localRecords = [];
  try { localRecords = await readLocalProjectRecords(4); } catch (_) {}
  const backups = await readAllProjectBackups(50);
  const recoveryProjectId = recovery?.state?.projectId || null;
  const matchingLocal = localRecords.find(record => record?.state?.projectId === recoveryProjectId) || null;
  const localProjectLabel = record => esc(record?.currentFileName || 'Projeto sem nome');

  openModal(`
    <div class="modal-title">Dados deste dispositivo</div>
    <p class="confirm-body">Aqui você controla o que o ProfessorGest mantém neste navegador. O <strong>arquivo .prg</strong> continua sendo a cópia principal do seu trabalho; limpar essas versões locais não apaga seus arquivos.</p>

    <section class="local-data-section">
      <div class="local-data-section-head"><div><strong>Versões locais</strong><span>Até 4 cópias de apoio para reabrir trabalhos sem substituir seus arquivos .prg.</span></div>${localRecords.length ? '<button type="button" class="btn-ghost btn-sm danger" id="btnClearAllLocalProjects">Limpar versões locais</button>' : ''}</div>
      ${recovery ? `<div class="local-data-row"><div><strong>Recuperação automática</strong><span>${esc(recovery.currentFileName || 'Projeto sem nome')} · ${formatRecoveryTime(recovery.savedAt)}</span></div><button type="button" class="btn-ghost btn-sm danger" id="btnDiscardRecovery">Descartar</button></div>` : ''}
      ${localRecords.length ? `<div class="local-data-items">
          ${localRecords.map(record => {
            const projectId = record?.state?.projectId || '';
            const current = projectId === state?.projectId;
            return `<div class="local-data-row"><div><strong>${localProjectLabel(record)}${current ? ' · atual' : ''}</strong><span>Versão local · ${formatRecoveryTime(record.savedAt)}</span></div><button type="button" class="btn-ghost btn-sm danger" data-discard-local-project="${esc(projectId)}">Remover</button></div>`;
          }).join('')}
        </div>
        ${matchingLocal && recovery ? '<p class="form-hint">A recuperação automática pertence ao mesmo projeto e pode conter alterações mais recentes que a versão local salva.</p>' : ''}
        ${localRecords.length >= 4 ? '<p class="form-hint">Limite local: 4 projetos. Ao guardar um quinto, o ProfessorGest remove automaticamente a versão local mais antiga. Isso não apaga nenhum arquivo .prg.</p>' : ''}
      ` : '<div class="local-data-empty">Nenhuma versão local está guardada neste dispositivo.</div>'}
    </section>

    <section class="local-data-section">
      <div class="local-data-section-head"><div><strong>Cópias de segurança</strong><span>${backups.length} ${backups.length === 1 ? 'cópia disponível' : 'cópias disponíveis'}</span></div><button type="button" class="btn-secondary btn-sm" id="btnManageBackups">Ver cópias</button></div>
      ${backups.length ? `<div class="local-data-inline"><span>Proteção automática ativa</span><button type="button" class="btn-ghost btn-sm danger" id="btnClearAllBackups">Limpar todas</button></div>` : '<div class="local-data-empty">As cópias são criadas automaticamente enquanto você trabalha.</div>'}
    </section>

    <section class="local-data-danger">
      <div><strong>Apagar todos os dados deste dispositivo</strong><span>Remove versões locais, recuperação, cópias de segurança, vínculos com o Drive, registros de suporte e preferências locais.</span></div>
      <button type="button" class="btn-danger-solid btn-sm" id="btnClearAllLocalData">Apagar tudo</button>
    </section>

    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Fechar</button></div>
  `);

  onClick('#btnDiscardRecovery', async () => {
    const projectId = recovery?.state?.projectId;
    if (!projectId) return;
    confirmModal({
      title: 'Descartar recuperação?',
      body: 'A cópia protegida será removida deste dispositivo. O arquivo .prg original não será alterado.',
      confirmLabel: 'Descartar recuperação', danger: true,
      onConfirm: async () => { closeModal(); await discardRecoveryForProject(projectId); }
    });
  });

  qAll('[data-discard-local-project]').forEach(button => {
    button.addEventListener('click', () => {
      const projectId = button.dataset.discardLocalProject;
      if (!projectId) return;
      const record = localRecords.find(item => item?.state?.projectId === projectId);
      confirmModal({
        title: 'Remover versão local?',
        body: `A versão local de ${record?.currentFileName || 'este projeto'} será removida deste dispositivo. O arquivo .prg original e o Google Drive não serão alterados.`,
        confirmLabel: 'Remover versão', danger: true,
        onConfirm: async () => { closeModal(); await discardSavedLocalProject(projectId); }
      });
    });
  });

  onClick('#btnClearAllLocalProjects', () => {
    const count = localRecords.length;
    confirmModal({
      title: `Limpar ${count} ${count === 1 ? 'versão local' : 'versões locais'}?`,
      body: 'As cópias de trabalho locais serão removidas deste dispositivo. Recuperações, backups, arquivos .prg e arquivos do Google Drive não serão alterados.',
      detailList: [
        ['Será apagado', `${count} ${count === 1 ? 'versão local' : 'versões locais'} guardadas pelo ProfessorGest`],
        ['Não será apagado', 'Seus arquivos .prg e arquivos do Google Drive'],
      ],
      confirmLabel: 'Limpar versões locais', danger: true,
      onConfirm: async () => { closeModal(); await clearAllLocalProjectVersions(); }
    });
  });

  onClick('#btnManageBackups', () => openBackupsModal({ global: true }));
  onClick('#btnClearAllBackups', async () => {
    confirmModal({
      title: `Limpar ${backups.length} ${backups.length === 1 ? 'cópia' : 'cópias'} de segurança?`,
      body: 'As cópias automáticas armazenadas neste dispositivo serão removidas. O trabalho atual e os arquivos .prg externos não serão alterados.',
      confirmLabel: 'Limpar cópias', danger: true,
      onConfirm: async () => {
        const ok = await clearProjectBackups();
        closeModal();
        if (ok) { projectBackupsCache = []; toast('As cópias de segurança foram removidas.', 'success'); }
        else toast('Não foi possível limpar as cópias de segurança.', 'error');
      }
    });
  });
  onClick('#btnClearAllLocalData', () => {
    confirmModal({
      title: 'Apagar todos os dados deste dispositivo?',
      body: 'Esta ação remove permanentemente os dados que o ProfessorGest mantém neste navegador, incluindo alterações não salvas que existam apenas nesta sessão. Ela não apaga arquivos .prg nas suas pastas nem arquivos no Google Drive.',
      detailList: [
        ['Será apagado', 'Versões locais, recuperação, cópias de segurança, vínculos do Drive, registros de suporte e preferências'],
        ['Também pode ser perdido', 'Qualquer alteração ainda não salva que exista apenas no ProfessorGest'],
        ['Não será apagado', 'Arquivos .prg fora do aplicativo e arquivos no Google Drive'],
        ['Importante', 'Depois disso, não será possível recuperar essas cópias pelo ProfessorGest'],
      ],
      confirmLabel: 'Apagar todos os dados', danger: true,
      onConfirm: async () => { closeModal(); await clearAllDataAndReturnToWelcome(); }
    });
  });
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

async function showWelcomeScreen({ withLoading = true } = {}) {
  clearPersistedRoute();
  const loadingStartedAt = withLoading ? beginAppLoading('Preparando a tela inicial...') : null;
  try {
    workspaceReady = false;
    demoMode = false;
    currentStorageMode = 'none';
    currentFileHandle = null;
    currentFileLastModified = 0;
    driveBinding = null;
    document.body.classList.remove('workspace-active');
    document.getElementById('welcomeScreen')?.classList.remove('is-hidden');
    document.getElementById('setupScreen')?.classList.add('is-hidden');
    updateThemeToggle();
    updateWelcomeAccountControl();
    await hydrateRecoveryCache();
    await renderWelcomeRecovery();
  } finally {
    if (loadingStartedAt !== null) await finishAppLoading(loadingStartedAt);
  }
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

function beginDemoMode() {
  if (workspaceReady && isDirty) {
    confirmModal({
      title: 'Abrir demonstração?',
      body: 'O projeto atual possui alterações que ainda não foram salvas. A demonstração abre um ambiente de exemplo separado desta sessão.',
      detailList: [['Projeto atual', currentFileName || 'Novo projeto'], ['Modo', 'Demonstração']],
      confirmLabel: 'Abrir demonstração', danger: true, onConfirm: () => launchDemoMode(),
    });
    return;
  }
  launchDemoMode();
}

function launchDemoMode() {
  state = loadDemoData();
  demoMode = true;
  workspaceReady = true;
  currentFileName = null;
  currentFileHandle = null;
  currentStorageMode = 'none';
  currentFileLastModified = 0;
  localProjectSaved = false;
  localProjectSavedAt = 0;
  clearDriveBinding();
  cloudSyncPending = false;
  discardLocalRecoveryDraft();
  clearDirty();
  resetContext();
  document.body.classList.add('workspace-active');
  document.getElementById('welcomeScreen')?.classList.add('is-hidden');
  document.getElementById('setupScreen')?.classList.add('is-hidden');
  navigate('dashboard');
}

function exitDemoMode() {
  demoMode = false;
  state = null;
  currentFileName = null;
  currentFileHandle = null;
  currentStorageMode = 'none';
  currentFileLastModified = 0;
  localProjectSaved = false;
  localProjectSavedAt = 0;
  clearDriveBinding();
  clearDirty();
  resetContext();
  showWelcomeScreen();
}

function closeCurrentFile() {
  const close = () => {
    if (isDirty) persistLocalRecoveryDraft();
    state = null;
    demoMode = false;
    workspaceReady = false;
    currentFileName = null;
    currentFileHandle = null;
    currentStorageMode = 'none';
    currentFileLastModified = 0;
    driveBinding = null;
    cloudSyncPending = false;
    clearDirty({ discardRecovery: false });
    resetContext();
    showWelcomeScreen();
  };

  if (isDirty) {
    performAutomaticSave().then(() => {
      if (!isDirty) close();
      else confirmModal({
      title: 'Fechar arquivo?',
      body: 'O salvamento automático está sendo concluído. Se a gravação do arquivo .prg externo não puder ser concluída, o projeto continuará protegido neste dispositivo.',
      detailList: [['Arquivo atual', currentFileName || 'Novo projeto'], ['Próxima tela', 'Abertura de arquivo']],
      confirmLabel: 'Fechar arquivo',
      onConfirm: close,
    });
    });
    return;
  }
  close();
}

function beginNewProjectSetup(fromWorkspace = false) {
  const openSetup = () => {
    setupOrigin = fromWorkspace ? 'workspace' : 'welcome';
    hideSetupScreen();
    showSetupScreen(setupOrigin);
  };

  if (fromWorkspace && isDirty) {
    confirmModal({
      title: 'Criar um novo arquivo?',
      body: 'O projeto atual está sendo salvo automaticamente. Criar um arquivo novo vai substituir o projeto que está aberto nesta sessão.',
      detailList: [['Projeto atual', currentFileName || 'Novo projeto'], ['Destino', 'Novo arquivo em branco']],
      confirmLabel: 'Continuar', danger: true, onConfirm: openSetup,
    });
    return;
  }
  openSetup();
}

function finishNewProjectSetup() {
  const name = document.getElementById('setupTeacherName')?.value.trim();
  if (!name) {
    document.getElementById('setupTeacherName')?.focus();
    return;
  }

  demoMode = false;
  state = emptyProjectData();
  state.teacher = { name };
  currentFileName = null;
  currentFileHandle = null;
  currentStorageMode = 'none';
  currentFileLastModified = 0;
  clearDriveBinding();
  cloudSyncPending = false;
  localProjectSaved = false;
  localProjectSavedAt = 0;
  clearDirty();
  discardLocalRecoveryDraft();
  lastLocalSaveAt = 0;
  resetContext();
  enterWorkspace();
  markDirty();
  render();
  navigate('dashboard');
}

function cancelNewProjectSetup() {
  if (setupOrigin === 'workspace' && workspaceReady && state) {
    hideSetupScreen();
    return;
  }
  showWelcomeScreen();
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
  loadDriveBinding();
  buildNav();
  bindGlobalEvents();
  bindSetupEvents();
  setBootStatus('Preparando o ProfessorGest...');
  initGoogleDriveSdk();
  registerPwa();
  const savedRoute = getPersistedRoute();
  let restored = false;
  if (savedRoute?.projectId) {
    restored = await restorePersistedProjectById(savedRoute.projectId, { navigateToDashboard: false });
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
  if (isDirty) {
    persistLocalRecoveryDraft();
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

window.addEventListener('pagehide', () => { if (isDirty) persistLocalRecoveryDraft(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && isDirty) persistLocalRecoveryDraft(); });

function bindGlobalEvents() {
  document.getElementById('welcomeNewFile').onclick = () => beginNewProjectSetup(false);
  document.getElementById('welcomeNewFromDed')?.addEventListener('click', () => openDedNewProjectModal());
  document.getElementById('welcomeOpenFile').onclick = () => openFile();
  document.getElementById('welcomeAccountControl')?.addEventListener('click', () => {
    if (driveAccount) openDriveAccountSettings();
    else openDrivePicker();
  });
  document.getElementById('welcomeDemo').onclick = () => beginDemoMode();
  document.getElementById('welcomeDrive')?.addEventListener('click', openDrivePicker);
  document.getElementById('welcomeBackups')?.addEventListener('click', () => openBackupsModal({ global: true }));
  document.getElementById('welcomeSettings')?.addEventListener('click', () => openWelcomeSettingsModal());
  document.getElementById('welcomeInstall')?.addEventListener('click', promptInstall);
  document.getElementById('welcomeThemeToggle').onclick = () => toggleTheme();
  document.getElementById('quickRegisterBtnDesktop').onclick = () => openOccurrenceModal();
  document.getElementById('quickRegisterBtnMobile').onclick = () => openOccurrenceModal();
  document.getElementById('fileInput').addEventListener('change', handleFileOpenInput);
  document.getElementById('topbarSearchBtn').onclick = () => openCommandPalette('');
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) themeToggle.onclick = toggleTheme;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      performAutomaticSave().catch(err => { console.warn('[ProfessorGest] Salvamento imediato falhou.', err); });
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
  arquivo: 'Arquivos', configuracoes: 'Configurações',
  turmaDetail: 'Turma', alunoDetail: 'Perfil do aluno', atividadeDetail: 'Atividade',
  relatorioIndividual: 'Relatório individual', relatorioTurma: 'Relatório da turma',
};

function render() {
  document.getElementById('viewTitle').textContent = VIEW_TITLES[currentView] || 'ProfessorGest';
  document.getElementById('topbarFile').innerHTML = topbarFileHTML();
  updateSaveChrome();
  const topbarDrive = document.getElementById('topbarDriveBtn');
  if (topbarDrive) {
    const connected = !!driveBindingForCurrentProject();
    const configured = isGoogleDriveConfigured();
    const pending = connected && cloudSyncPending;
    topbarDrive.classList.toggle('connected', connected);
    topbarDrive.classList.toggle('pending', pending);
    topbarDrive.disabled = driveActionPending;
    topbarDrive.setAttribute('aria-busy', driveActionPending ? 'true' : 'false');
    topbarDrive.querySelector('.topbar-drive-label').textContent = driveActionPending || (connected && saveUiState === 'syncing')
      ? 'Atualizando…'
      : (connected ? (pending || isDirty ? 'Atualizar Drive' : 'Drive atualizado') : (driveAccount ? `Drive · ${driveAccount.displayName || 'conta'}` : 'Google Drive'));
    topbarDrive.title = connected
      ? (pending || isDirty ? 'Há alterações salvas neste dispositivo. Clique para atualizar o Google Drive' : 'O Drive está atualizado. Clique para enviar novamente se necessário')
      : (configured ? 'Conectar este projeto ao Google Drive' : 'Google Drive ainda não configurado');
    topbarDrive.setAttribute('aria-label', topbarDrive.title);
    topbarDrive.onclick = () => saveCurrentToGoogleDrive();
  }
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
  if (demoMode) {
    return `<div class="topbar-file demo-topbar-file"><div class="topbar-fileline demo-fileline">${ICONS.sparkle || ICONS.file}<span>Demonstração</span></div>` +
      `<div class="topbar-status demo-status"><span class="status-dot"></span>Modo demonstração</div></div>`;
  }
  const name = currentFileName ? esc(currentFileName) : 'Novo projeto (não salvo)';
  let statusLine, cls;
  if (isDirty) { statusLine = 'Alterações não salvas'; cls = 'dirty'; }
  else if (cloudSyncPending && driveBindingForCurrentProject()) { statusLine = 'Atualize o Drive'; cls = 'dirty'; }
  else if (driveBindingForCurrentProject()) { statusLine = 'Drive atualizado'; cls = 'saved'; }
  else if (currentFileName) { statusLine = 'Salvo'; cls = 'saved'; }
  else { statusLine = 'Novo projeto'; cls = 'neutral'; }
  const cloud = driveBindingForCurrentProject() ? `<span class="topbar-cloud-badge" title="Drive atualizado">${ICONS.cloud}</span>` : '';
  return `<div class="topbar-fileline">${ICONS.file}<span>${name}</span>${cloud}</div>` +
    `<div class="topbar-status ${cls}"><span class="status-dot"></span>${statusLine}</div>`;
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

async function renderWelcomeRecovery() {
  await Promise.all([
    welcomeViewRenderer.renderWelcomeRecovery(),
    updateWelcomeBackupAction()
  ]);
}

async function updateWelcomeBackupAction() {
  const button = document.getElementById('welcomeBackups');
  if (!button) return;
  button.classList.remove('is-hidden');
  try {
    const backups = await readAllProjectBackups(1);
    button.title = backups.length ? 'Ver suas cópias de segurança' : 'Ver como funcionam as cópias de segurança';
    button.setAttribute('aria-label', backups.length ? 'Ver suas cópias de segurança' : 'Ver como funcionam as cópias de segurança');
  } catch (_) {
    button.title = 'Cópias de segurança';
    button.setAttribute('aria-label', 'Cópias de segurança');
  }
}
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
  getState: () => state, esc, getDemoMode: () => demoMode, getCurrentFileName: () => currentFileName, getIsDirty: () => isDirty, ICONS, getDriveActionPending: () => driveActionPending,
  supportsFileShare, driveStatusTone, driveStatusText, driveBindingForCurrentProject, getDriveAccount: () => driveAccount,
  fmtDate, fmtDateTime, getThemeMode, getDevLogEntries, getProjectBackups
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

const welcomeViewRenderer = createWelcomeViewRenderer({
  readLocalRecoveryDraft,
  readLocalProjectRecords,
  recoverLocalDraft,
  restorePersistedProject,
  restorePersistedProjectById,
  formatRecoveryTime,
  updateWelcomeExperience,
  toast,
  escapeHtml: esc,
  ICONS,
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
  emptyState, badgeFor, ICONS, searchFieldHTML, driveBindingForCurrentProject, getDriveActionPending: () => driveActionPending, getDriveSyncPending: () => cloudSyncPending
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

// O seletor nativo é mantido para abertura de arquivos porque o Chrome
// Android consegue devolver um FileSystemFileHandle para leitura. Para salvar,
// porém, o Android fica deliberadamente no caminho de download tradicional.
// A especificação do showSaveFilePicker estabelece que a seleção pode criar
// ou limpar o arquivo antes de o conteúdo ser gravado; em implementações
// móveis com falha de commit isso pode deixar um arquivo físico de 0 bytes.
// Como um fallback automático depois dessa etapa criaria um segundo arquivo,
// o Android usa apenas uma estratégia de exportação.
function applyOpenedData(data, fileName, cloudMeta = null, fileHandle = null, options = {}) {
  const validated = validateProjectData(data);
  if (!validated.ok) { toast('O projeto não pôde ser aberto porque seus dados são inválidos ou incompatíveis.', 'error'); return false; }
  const normalized = normalizeExistingDedData(validated.data);
  state = normalized.data;
  demoMode = false;
  currentFileName = normalizePrgFileName(fileName);
  currentFileHandle = fileHandle || null;
  currentStorageMode = cloudMeta?.fileId ? 'drive' : (options.storageMode || (fileHandle ? 'file' : 'local'));
  currentFileLastModified = Number(options.fileLastModified) || 0;
  localProjectSaved = false;
  localProjectSavedAt = 0;
  // O vínculo salvo no localStorage é a fonte persistente mais recente do
  // estado de sincronização. Um snapshot IndexedDB pode ter sido salvo antes
  // do último upload; não deixe um metadado antigo sobrescrever um vínculo
  // mais novo na abertura seguinte.
  loadDriveBindingForProject(state.projectId);
  if (cloudMeta?.fileId) {
    saveDriveBinding({ ...cloudMeta, projectId: state.projectId });
  } else if (options.driveBinding?.fileId) {
    const incomingBinding = { ...options.driveBinding, projectId: state.projectId };
    const currentBinding = getDriveBinding(driveBindingsByProject, state.projectId);
    const currentSyncAt = Date.parse(currentBinding?.lastSyncAt || '') || 0;
    const incomingSyncAt = Date.parse(incomingBinding.lastSyncAt || '') || 0;
    const sameFile = currentBinding?.fileId && String(currentBinding.fileId) === String(incomingBinding.fileId);
    if (!currentBinding || !sameFile || incomingSyncAt >= currentSyncAt) {
      // O snapshot local é uma fonte persistente, mas nunca deve ser tratado
      // como mais novo que um vínculo atualizado pelo Drive depois dele.
      saveDriveBinding(incomingBinding);
    } else {
      driveBinding = currentBinding;
    }
  }
  cloudSyncPending = !!options.driveSyncPending && !!driveBindingForCurrentProject();
  lastLocalSaveAt = Date.now();
  clearDirty();
  discardLocalRecoveryDraft();
  
  resetContext();
  enterWorkspace();
  if (options.navigateToDashboard !== false) navigate('dashboard', true, { replace: true });
  const warnings = Array.isArray(options.warnings) ? options.warnings : [];
  if (warnings.length) {
    isDirty = true;
    setSaveUiState('dirty');
    toast(`Arquivo aberto, mas ${warnings.length} problema(s) foram encontrados e não serão ignorados silenciosamente. Revise antes de salvar.`, 'info');
    persistLocalRecoveryDraft();
  } else {
    toast('Arquivo aberto com sucesso.', 'success');
    if (options.persistLocal !== false) {
      saveLocalProjectSnapshot({ stateData: state, storageMode: currentStorageMode, fileName: currentFileName, fileHandle: currentFileHandle, fileLastModified: currentFileLastModified }).then(async ok => {
        if (!ok) console.warn('[ProfessorGest] A cópia local do arquivo aberto não pôde ser persistida.');
        await refreshProjectBackups(state.projectId);
        await createAutomaticBackup('Arquivo aberto', { force: true });
      });
    }
  }
  updateSaveChrome();
  render();
}

async function openFile(skipConfirm = false) {
  if (!skipConfirm && workspaceReady && isDirty) {
    confirmModal({
      title: 'Abrir outro arquivo?',
      body: 'O projeto atual possui alterações que ainda não foram salvas. Abrir outro arquivo vai substituir o projeto que está aberto nesta sessão.',
      detailList: [['Projeto atual', currentFileName || 'Novo projeto'], ['Próxima ação', 'Abrir outro arquivo .prg']],
      confirmLabel: 'Continuar', danger: true, onConfirm: () => openFile(true),
    });
    return;
  }

  if (supportsNativeFilePicker()) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: prgOpenPickerTypes(),
        excludeAcceptAllOption: false,
        multiple: false
      });
      if (!handle) return;

      let openError = null;
      await withAppLoading('Abrindo seu arquivo...', async () => {
        try {
          const file = await handle.getFile();
          const text = await readTextFileUtf8(file);
          const result = validateAndParsePrg(text);
          if (!result.ok) {
            logError('file.open.invalid', new Error('Arquivo selecionado não passou na validação.'), {
              filename: file.name, mime: file.type || '', size: file.size, errorCode: result.error || 'invalid'
            });
            openError = { message: errorMessage(result.error), details: result.details || [] };
            return false;
          }
          applyOpenedData(result.data, file.name, null, /\.prg$/i.test(file.name) ? handle : null, {
            storageMode: 'file',
            fileLastModified: file.lastModified,
            persistLocal: true,
            navigateToDashboard: true,
            warnings: result.warnings || [],
          });
          return true;
        } catch (err) {
          logError('file.open.native_failed', err, { nativePicker: true, android: isAndroidDevice() });
          openError = { message: 'Não foi possível carregar o arquivo selecionado.', details: [String(err?.message || err || 'Erro desconhecido durante a abertura.')] };
          return false;
        }
      });
      if (openError) showFileErrorModal(openError.message, openError.details || []);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      logError('file.open.native_picker_failed', err, { nativePicker: true, android: isAndroidDevice() });
      showFileErrorModal('Não foi possível abrir o arquivo selecionado.');
      return;
    }
  }

  document.getElementById('fileInput').click();
}

async function handleFileOpenInput(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  let openError = null;
  await withAppLoading('Abrindo seu arquivo...', async () => {
    try {
      const text = await readTextFileUtf8(file);
      const result = validateAndParsePrg(text);
      if (!result.ok) {
        logError('file.open.invalid', new Error('Arquivo selecionado não passou na validação.'), {
          filename: file.name, mime: file.type || '', size: file.size, errorCode: result.error || 'invalid'
        });
        openError = { message: errorMessage(result.error), details: result.details || [] };
        return;
      }
      applyOpenedData(result.data, file.name, null, null, {
        storageMode: 'local',
        fileLastModified: file.lastModified,
        persistLocal: true,
        warnings: result.warnings || [],
      });
    } catch (err) {
      logError('file.open.read_failed', err, {
        filename: file?.name || '', mime: file?.type || '', size: file?.size || 0
      });
      openError = { message: 'Não foi possível abrir o arquivo selecionado.' };
    }
  });

  if (openError) showFileErrorModal(openError.message, openError.details || []);
}

async function shareFileFallback(content, filename, mime) {
  try {
    return await shareFile(content, filename, mime);
  } catch (err) {
    if (err?.name === 'AbortError') return true;
    logError('file.share.failed', err, { filename });
    return false;
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

async function shareCurrentPrgFile() {
  if (demoMode || !state) return false;
  const payload = buildSavePayload();
  const json = JSON.stringify(payload, null, 2);
  const name = normalizePrgFileName(currentFileName || `professorgest-${safeFileName(state?.teacher?.name || 'professorgest')}.prg`);
  const sharePromise = shareFileFallback(json, name, PRG_MIME);
  createAutomaticBackup('Antes de compartilhar').catch(err => {
    logError('file.share.backup_failed', err, { filename: name });
  });
  const shared = await sharePromise;
  if (shared) { toast('Arquivo .prg compartilhado com sucesso.', 'success'); return true; }
  toast('O compartilhamento de arquivos não está disponível neste navegador. Use Exportar cópia .prg.', 'info');
  return false;
}

async function exportCurrentPrgFile() {
  if (demoMode || !state) return false;
  const exportRevision = dirtyRevision;
  const payload = buildSavePayload();
    const json = JSON.stringify(payload, null, 2);
  // Verifica o conteúdo exato que será exportado antes de iniciar o download.
  try {
    const check = JSON.parse(json);
    if (!check || check.format !== PRG_FORMAT || Number(check.version) !== PRG_VERSION) {
      throw new Error('Não foi possível preparar a cópia do arquivo.');
    }
  } catch (err) {
    logError('file.export.prepare_failed', err);
    toast(err?.message || 'Não foi possível preparar a cópia do arquivo.', 'error');
    return false;
  }
  const teacherBase = safeFileName(state?.teacher?.name || 'professorgest');
  const suggestedName = saveFileName ? normalizePrgFileName(saveFileName) : `professorgest-${safeFileName(payload?.teacher?.name || 'professorgest')}.prg`;

  let nativeHandleAcquired = false;
  if (supportsNativeSavePicker()) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types: prgSavePickerTypes(), excludeAcceptAllOption: false });
      nativeHandleAcquired = true;
      const writable = await handle.createWritable();
      await writable.write(new Blob([json], { type: PRG_MIME }));
      await writable.close();

      const verifyFile = await handle.getFile();
      const verifyText = await readTextFileUtf8(verifyFile);
      const verifyResult = validateAndParsePrg(verifyText);
      if (!verifyResult.ok || verifyFile.size <= 0) {
        const details = { filename: handle.name, size: verifyFile.size, validation: verifyResult.error || 'invalid' };
        logError('file.export.native_invalid', new Error('O arquivo nativo não pôde ser confirmado como válido.'), details);
        currentFileHandle = null;
        currentStorageMode = 'local';
        toast('O navegador não conseguiu confirmar a gravação do arquivo. O projeto foi preservado no armazenamento interno; não foi criado um segundo arquivo automaticamente.', 'error');
        await saveLocalProjectSnapshot({ stateData: payload, storageMode: 'local', fileName: suggestedName, fileHandle: null, fileLastModified: 0 });
        return false;
      }

      currentFileHandle = handle;
      currentFileName = normalizePrgFileName(handle.name);
      currentStorageMode = 'file';
            currentFileLastModified = verifyFile.lastModified || 0;
      await saveLocalProjectSnapshot({ stateData: payload, storageMode: 'file', fileName: currentFileName, fileHandle: currentFileHandle, fileLastModified: currentFileLastModified });
      adoptSavedPayload(payload);
      lastLocalSaveAt = Date.now();
      clearDirty({ expectedRevision: exportRevision });
      updateSaveChrome();
      render();
      toast('Cópia .prg exportada com sucesso.', 'success');
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') {
                return false;
      }
      logError('file.export.native_failed', err, {
        suggestedName, android: isAndroidDevice(), handleAcquired: nativeHandleAcquired
      });
      currentFileHandle = null;
      currentStorageMode = 'local';

      // Depois que showSaveFilePicker() devolve um handle, o navegador já pode
      // ter criado um arquivo físico. Nunca faça um segundo download nesse
      // cenário, pois isso produz exatamente o par “arquivo vazio + arquivo válido”.
      if (nativeHandleAcquired) {
        toast('O navegador falhou ao gravar o arquivo escolhido. O projeto foi preservado no armazenamento interno; nenhum segundo arquivo foi criado.', 'error');
        await saveLocalProjectSnapshot({ stateData: payload, storageMode: 'local', fileName: suggestedName, fileHandle: null, fileLastModified: 0 });
        return false;
      }
    }
  }

  const fallbackMime = PRG_MIME;
    downloadFallback(json, suggestedName, fallbackMime);
  currentFileName = normalizePrgFileName(suggestedName);
  adoptSavedPayload(payload);
  currentStorageMode = currentStorageMode === 'drive' ? 'drive' : 'local';
  lastLocalSaveAt = Date.now();
  await saveLocalProjectSnapshot({ stateData: payload, storageMode: currentStorageMode, fileName: currentFileName, fileHandle: null, fileLastModified: 0 });
  clearDirty({ expectedRevision: exportRevision });
  updateSaveChrome();
  render();
  toast('Cópia .prg exportada. O projeto continua salvo neste dispositivo.', 'success');
  return true;
}

async function checkExternalFileConflict(forceOverwrite = false) {
  if (forceOverwrite || !currentFileHandle || !currentFileLastModified) return false;
  try {
    const permission = typeof currentFileHandle.queryPermission === 'function'
      ? await currentFileHandle.queryPermission({ mode: 'readwrite' })
      : 'granted';
    if (permission !== 'granted') return false;
    const file = await currentFileHandle.getFile();
    if (file.lastModified && file.lastModified !== currentFileLastModified) {
      confirmModal({
        title: 'O arquivo mudou fora do ProfessorGest',
        body: 'Este arquivo foi alterado desde a última vez em que o ProfessorGest o leu. Para não apagar alterações externas, escolha recarregar o arquivo ou confirmar a substituição.',
        detailList: [['Arquivo', currentFileName || 'Projeto atual'], ['Última versão lida', new Date(currentFileLastModified).toLocaleString('pt-BR')], ['Arquivo atual', new Date(file.lastModified).toLocaleString('pt-BR')]],
        confirmLabel: 'Substituir mesmo assim',
        danger: true,
        onConfirm: () => saveFile({ fromPrimarySave: false, forceOverwrite: true }),
        cancelLabel: 'Cancelar',
      });
      return true;
    }
  } catch (err) {
    console.warn('[ProfessorGest] Não foi possível verificar alterações externas do arquivo.', err);
  }
  return false;
}

async function saveFile({ fromPrimarySave = false, forceOverwrite = false, skipCloudSync = false } = {}) {
  if (demoMode) { toast('A demonstração é apenas para explorar o sistema.', 'info'); return false; }
  const saveProjectId = state?.projectId || null;
  const saveRevision = dirtyRevision;
  const payload = buildSavePayload();
  const payloadSavedAt = new Date().toISOString();
  const saveFileHandle = currentFileHandle;
  const saveStorageMode = currentStorageMode;
  const saveFileName = currentFileName;
  const saveFileLastModified = currentFileLastModified;
  const saveDriveBinding = driveBindingForCurrentProject();
  const hadLocalChangesAtSaveStart = isDirty;
  const driveWasAlreadyPending = cloudSyncPending;
  const isSameOpenProject = () => !!saveProjectId && state?.projectId === saveProjectId && workspaceReady;
  await createAutomaticBackup('Antes de salvar');
  const json = JSON.stringify(payload, null, 2);
  const teacherBase = safeFileName(state?.teacher?.name || 'professorgest');
  const suggestedName = currentFileName ? normalizePrgFileName(currentFileName) : `professorgest-${teacherBase}.prg`;

  if (saveFileHandle && !forceOverwrite) {
    const conflict = await checkExternalFileConflict(false);
    if (conflict) {
      setSaveUiState('dirty');
      updateSaveChrome();
      return false;
    }
  }

  const afterLocalSave = async ({ storageMode = saveStorageMode, fileLastModified = saveFileLastModified, fileHandle = saveFileHandle, fileName = saveFileName } = {}) => {
    const unchangedSinceSaveStarted = dirtyRevision === saveRevision;
    const localPersisted = await saveLocalProjectSnapshot({
      stateData: payload,
      storageMode,
      fileName,
      fileHandle,
      fileLastModified,
      savedAt: payloadSavedAt,
      driveBindingOverride: saveDriveBinding,
    });

    // A troca de projeto pode acontecer enquanto o salvamento aguarda backup,
    // permissão ou I/O. Nesse caso, proteja o snapshot antigo e não altere o
    // estado/handle/UI do projeto que acabou de ser aberto.
    if (!isSameOpenProject()) return localPersisted;

    lastLocalSaveAt = Date.now();
    currentStorageMode = storageMode;
    currentFileLastModified = Number(fileLastModified) || 0;
    currentFileHandle = fileHandle || null;
    if (fileName) currentFileName = fileName;

    if (!unchangedSinceSaveStarted) {
      isDirty = true;
      cloudSyncPending = !!driveBindingForCurrentProject();
      setSaveUiState('dirty');
      persistLocalRecoveryDraft();
      updateSaveChrome();
      render();
      return !!localPersisted;
    }

    if (!localPersisted && currentStorageMode === 'local') {
      isDirty = true;
      setSaveUiState('dirty');
      persistLocalRecoveryDraft();
      updateSaveChrome();
      toast('Não foi possível salvar no armazenamento deste dispositivo. As alterações continuam protegidas; tente novamente.', 'error');
      render();
      return false;
    }
    discardLocalRecoveryDraft();
    clearDirty({ expectedRevision: saveRevision });

    // Salvar localmente nunca atualiza o Drive por conta própria. Caso exista
    // um vínculo, preservamos/ativamos o estado pendente para que a ação
    // explícita "Atualizar Drive" fique disponível.
    cloudSyncPending = !!driveBindingForCurrentProject()
      && (driveWasAlreadyPending || hadLocalChangesAtSaveStart);
    setSaveUiState('saved');
    updateSaveChrome();
    toast(
      cloudSyncPending
        ? 'Alterações salvas neste dispositivo. Clique em Atualizar Drive quando quiser enviar esta versão.'
        : (currentStorageMode === 'local' ? 'Alterações salvas neste dispositivo.' : 'Arquivo salvo com sucesso.'),
      'success'
    );
    render();
    return true;
  };

  if (saveFileHandle && /\.prg$/i.test(saveFileHandle.name || '')) {
    try {
      const permission = typeof saveFileHandle.queryPermission === 'function'
        ? await saveFileHandle.queryPermission({ mode: 'readwrite' })
        : 'granted';
      if (permission !== 'granted' && typeof saveFileHandle.requestPermission === 'function') {
        const requested = await saveFileHandle.requestPermission({ mode: 'readwrite' });
        if (requested !== 'granted') throw new DOMException('Permissão para salvar o arquivo foi negada.', 'NotAllowedError');
      }
      setSaveUiState('saving'); updateSaveChrome();
      const handleToWrite = saveFileHandle;
      const verifyFile = await withFileWriteLock(async () => {
        const writable = await handleToWrite.createWritable();
        await writable.write(json);
        await writable.close();
        // Mesma verificação pós-gravação do export: evita confiar num arquivo
        // que "salvou sem erro" mas ficou vazio/truncado no disco.
        const written = await handleToWrite.getFile();
        const verifyText = await readTextFileUtf8(written);
        if (!validateAndParsePrg(verifyText).ok) {
          throw new Error('O arquivo foi salvo, mas o conteúdo gravado não pôde ser confirmado como válido.');
        }
        return written;
      });
      const fileLastModified = verifyFile.lastModified || Date.now();
      return await afterLocalSave({ storageMode: 'file', fileLastModified, fileHandle: saveFileHandle, fileName: normalizePrgFileName(saveFileHandle.name) });
    } catch (err) {
      logError('file.save.native_failed', err, { filename: saveFileName || suggestedName, android: isAndroidDevice() });
      if (!isSameOpenProject()) return false;
      currentFileHandle = null;
      currentStorageMode = 'local';
      if (err && err.name === 'AbortError') { setSaveUiState('dirty'); updateSaveChrome(); return false; }
      if (err && err.name !== 'NotAllowedError') {
        toast('Não foi possível atualizar o arquivo original. As alterações continuarão protegidas neste dispositivo.', 'error');
      } else {
        toast('Permissão para atualizar o arquivo negada. As alterações ficarão salvas neste dispositivo.', 'error');
      }
      return await afterLocalSave({ storageMode: 'local', fileLastModified: saveFileLastModified, fileHandle: null, fileName: saveFileName });
    }
  }

  // Sem File System Access API (comum em navegadores móveis):
  // Salvar = persistir o projeto no armazenamento interno. Não fingimos que o .prg externo foi atualizado.
  if (!isSameOpenProject()) {
    return await saveLocalProjectSnapshot({
      stateData: payload,
      storageMode: 'local',
      fileName: suggestedName,
      fileHandle: null,
      fileLastModified: saveFileLastModified,
      savedAt: payloadSavedAt,
      driveBindingOverride: saveDriveBinding,
    });
  }
  currentStorageMode = 'local';
  currentFileHandle = null;
  if (!currentFileName) currentFileName = normalizePrgFileName(suggestedName);
  return await afterLocalSave({ storageMode: 'local', fileLastModified: currentFileLastModified, fileHandle: null, fileName: currentFileName });
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

function openDedImportModal(options = {}) {
  const { newProject = false } = options;
  const title = newProject ? 'Criar arquivo pelo DED+' : 'Importar turma do DED+';
  const description = newProject
    ? 'Selecione um ou vários PDFs de lista nominal exportados pelo DED+. O ProfessorGest criará um novo arquivo e preencherá automaticamente os dados do professor que puder identificar.'
    : 'Selecione um ou vários PDFs de lista nominal exportados pelo DED+. Cada PDF representa uma turma; o ProfessorGest adicionará as turmas ao arquivo atual.';
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
    const percent = Math.round((done / total) * 100);
    const bar = q('#dedProgressBar');
    const text = q('#dedProgressText');
    if (bar) bar.value = percent;
    if (text) text.textContent = `${done} de ${total}: ${name}`;
  });
  openDedImportReview(parsed.results, parsed.errors, { newProject });
}

function dedClassIdentityKey(data) {
  return [data?.schoolCode, data?.classCode, data?.year].map(normalizeDedClassKey).join('|');
}
function dedAssignmentIdentityKey(data, classId = '') {
  return [classId || dedClassIdentityKey(data), data?.component].map(normalizeDedClassKey).join('|');
}
function dedClassForImport(data) {
  if (!state?.classes) return null;
  return state.classes.find(c => {
    if (c?.ded?.key && data?.dedKey && c.ded.key === data.dedKey) return true;
    return sameDedClassIdentity(c, data);
  }) || null;
}
function dedFallbackClassForImport(data) {
  if (!state?.classes) return null;
  const className = normalizeDedStudentName(data.displayName || data.className);
  const schoolName = normalizeDedStudentName(data.schoolName);
  return state.classes.find(c => normalizeDedStudentName(c.name) === className && normalizeDedStudentName(schoolNameOf(c.id)) === schoolName) || null;
}
function ensureSchoolFromDed(data) {
  state.schools = Array.isArray(state.schools) ? state.schools : [];
  const key = normalizeDedClassKey(data.schoolCode || data.schoolName);
  let school = state.schools.find(s => normalizeDedClassKey(s.code || s.name) === key || normalizeDedClassKey(s.name) === normalizeDedClassKey(data.schoolName));
  if (!school) {
    school = { id: uid('school'), name: data.schoolName || 'Escola não informada', code: data.schoolCode || '', sre: data.sre || '', address: data.address || '' };
    state.schools.push(school);
  } else {
    school.name = data.schoolName || school.name;
    school.code = data.schoolCode || school.code || '';
    school.sre = data.sre || school.sre || '';
    school.address = data.address || school.address || '';
  }
  return school;
}
function ensureClassFromDed(data, now = new Date().toISOString()) {
  const school = ensureSchoolFromDed(data);
  let cls = dedClassForImport(data) || dedFallbackClassForImport(data);
  if (!cls) {
    cls = { id: uid('class'), name: data.displayName || data.className, archived: false, schoolId: school.id, classCode: data.classCode || '', year: data.year || '', shift: data.shift || '', ded: {} };
    state.classes.push(cls);
  }
  cls.schoolId = school.id;
  cls.classCode = data.classCode || cls.classCode || '';
  cls.year = data.year || cls.year || '';
  cls.shift = data.shift || cls.shift || '';
  cls.name = data.displayName || data.className || cls.name;
  cls.archived = false;
  cls.ded = { ...(cls.ded || {}), className: cls.name, schoolCode: data.schoolCode, schoolName: data.schoolName, sre: data.sre, classCode: data.classCode, year: data.year, shift: data.shift, teacher: data.teacher, address: data.address, component: data.component, key: data.dedKey, importedAt: now, sourceName: data.sourceName };
  return cls;
}
function assignmentForDedImport(data, cls, now = new Date().toISOString()) {
  state.assignments = Array.isArray(state.assignments) ? state.assignments : [];
  const key = dedAssignmentIdentityKey(data, cls.id);
  let assignment = state.assignments.find(a => (a?.ded?.key && a.ded.key === key) || (a.classId === cls.id && normalizeDedClassKey(a.subject) === normalizeDedClassKey(data.component)));
  if (!assignment) {
    assignment = { id: uid('assign'), classId: cls.id, schoolId: cls.schoolId || null, subject: data.component || 'Componente não informado', teacherName: data.teacher || state.teacher?.name || '', year: data.year || cls.year || '', ded: {} };
    state.assignments.push(assignment);
  }
  assignment.classId = cls.id;
  assignment.schoolId = cls.schoolId || assignment.schoolId || null;
  assignment.subject = data.component || assignment.subject || 'Componente não informado';
  assignment.teacherName = data.teacher || assignment.teacherName || state.teacher?.name || '';
  assignment.year = data.year || cls.year || assignment.year || '';
  assignment.ded = { ...(assignment.ded || {}), ...cls.ded, key, component: assignment.subject, importedAt: now, sourceName: data.sourceName };
  return assignment;
}
function ensureEnrollment(student, classId, imported = null) {
  state.enrollments = Array.isArray(state.enrollments) ? state.enrollments : [];
  student.enrollmentIds = Array.isArray(student.enrollmentIds) ? student.enrollmentIds : [];
  let enrollment = state.enrollments.find(e => e.studentId === student.id && e.classId === classId && e.active !== false);
  if (!enrollment) {
    enrollment = { id: uid('enroll'), studentId: student.id, classId, active: true, dedCode: imported?.dedCode || '', sourceName: imported?.sourceName || '' };
    state.enrollments.push(enrollment);
  } else if (imported) {
    enrollment.dedCode = imported.dedCode || enrollment.dedCode || '';
    enrollment.sourceName = imported.sourceName || enrollment.sourceName || '';
  }
  if (!student.enrollmentIds.includes(enrollment.id)) student.enrollmentIds.push(enrollment.id);
  student.classId = classId;
  return enrollment;
}
function dedStudentDiff(cls, data) {
  const current = studentsOf(cls.id);
  const byCode = new Map(current.filter(s => s?.ded?.studentCode).map(s => [String(s.ded.studentCode), s]));
  const byName = new Map(current.map(s => [normalizeDedStudentName(s.name), s]));
  const matched = [], added = [], renamed = [];
  for (const imported of data.students) {
    let student = byCode.get(String(imported.dedCode)) || null;
    if (!student) { const candidate = byName.get(normalizeDedStudentName(imported.name)); if (candidate && (!candidate.ded?.studentCode || String(candidate.ded.studentCode) === String(imported.dedCode))) student = candidate; }
    if (student) { matched.push(student); if (student.name !== imported.name) renamed.push({ student, imported }); }
    else added.push(imported);
  }
  const importedCodes = new Set(data.students.map(s => String(s.dedCode)));
  const missing = current.filter(s => s?.ded?.studentCode && !importedCodes.has(String(s.ded.studentCode)));
  return { current, matched, added, renamed, missing };
}

function deriveDedTeacherProfile(items) {
  const values = key => [...new Map(items.map(item => [normalizeDedClassKey(item?.[key]), String(item?.[key] || '').trim()]).filter(([k,v]) => k && v)).values()];
  const names = values('teacher');
  return { teacher: { name: names.length === 1 ? names[0] : '' }, schools: values('schoolName'), subjects: values('component'), conflicts: { teacher: names.length > 1 } };
}

function openDedImportReview(results, errors = [], options = {}) {
  const { newProject = false } = options;
  const unique = [], duplicateFiles = [], seen = new Set();
  for (const item of results) {
    const dedKey = `${item.dedKey}|${normalizeDedClassKey(item.component)}`;
    if (seen.has(dedKey)) { duplicateFiles.push(item.sourceName); continue; }
    seen.add(dedKey); unique.push(item);
  }
  const cards = unique.map(data => {
    const existingClass = newProject ? null : (dedClassForImport(data) || dedFallbackClassForImport(data));
    const existingAssignment = existingClass ? state?.assignments?.find(a => a.classId === existingClass.id && normalizeDedClassKey(a.subject) === normalizeDedClassKey(data.component)) : null;
    const status = existingAssignment ? 'Atualizar disciplina' : existingClass ? 'Adicionar disciplina à turma' : 'Nova turma';
    return `<div class="ded-import-item ${existingAssignment ? 'is-existing' : existingClass ? 'is-existing' : 'is-new'}"><div class="ded-import-item-head"><div><strong>${esc(data.displayName || data.className)}</strong><span>${esc(data.component || 'Componente não informado')} · ${esc(data.schoolName)}</span></div><span class="ded-import-status">${status}</span></div><div class="ded-import-meta"><span>${data.students.length} ${data.students.length === 1 ? 'aluno' : 'alunos'}</span><span>${esc(data.shift || 'Turno não informado')}</span><span>Código DED: ${esc(data.classCode)}</span></div></div>`;
  }).join('');
  const errorList = errors.length ? `<div class="ded-import-errors"><strong>Não foi possível interpretar ${errors.length} arquivo(s)</strong><ul>${errors.map(item => `<li><strong>${esc(item.name)}</strong> — ${esc(item.message)}</li>`).join('')}</ul></div>` : '';
  const duplicateNotice = duplicateFiles.length ? `<div class="ded-import-notice">${duplicateFiles.length} PDF(s) repetido(s) foram ignorados porque representam a mesma turma e disciplina.</div>` : '';
  const capacity = planDedImport(unique, { newProject });
  const capacityNotice = capacity.ok ? `<div class="ded-import-notice">Após a importação: <strong>${capacity.projectedClasses}</strong> ${capacity.projectedClasses === 1 ? 'turma' : 'turmas'}, <strong>${capacity.projectedAssignments}</strong> ${capacity.projectedAssignments === 1 ? 'disciplina' : 'disciplinas'} e <strong>${capacity.projectedStudents}</strong> ${capacity.projectedStudents === 1 ? 'aluno' : 'alunos'}.</div>` : `<div class="ded-import-errors"><strong>Importação bloqueada</strong><div>${esc(capacity.message)}</div></div>`;
  const profile = newProject ? deriveDedTeacherProfile(unique) : null;
  const profileValues = profile ? [profile.teacher.name ? `Professor(a): ${profile.teacher.name}` : 'Professor(a): será preenchido depois', `${profile.schools.length} ${profile.schools.length === 1 ? 'escola identificada' : 'escolas identificadas'}`, `${profile.subjects.length} ${profile.subjects.length === 1 ? 'disciplina identificada' : 'disciplinas identificadas'}`] : [];
  openModal(`<div class="modal-title">Revisar importação do DED+</div><p class="confirm-body">Os dados do PDF serão lidos e organizados. Turma, escola e disciplina serão mantidas separadamente.</p>${profileValues.length ? `<div class="ded-import-notice"><strong>Dados identificados</strong><div class="ded-import-meta">${profileValues.map(v=>`<span>${esc(v)}</span>`).join('')}</div>${profile.conflicts.teacher ? '<div class="form-hint">Há mais de um professor nos arquivos. O nome do perfil ficará para preenchimento manual.</div>' : ''}</div>` : ''}<div class="ded-import-list">${cards || '<div class="ded-import-empty">Nenhuma turma válida foi encontrada.</div>'}</div>${errorList}${duplicateNotice}${capacityNotice}<div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="button" class="btn-primary" id="btnConfirmDedImport" ${unique.length && capacity.ok ? '' : 'disabled'}>${unique.length ? (newProject ? `Criar arquivo com ${unique.length} ${unique.length === 1 ? 'disciplina' : 'disciplinas'}` : `Importar ${unique.length} ${unique.length === 1 ? 'disciplina' : 'disciplinas'}`) : 'Nenhuma atuação para importar'}</button></div>`, true, 'ded-import-modal');
  onClick('#btnConfirmDedImport', () => newProject ? commitDedNewProject(unique) : commitDedImport(unique));
}

function commitDedImport(items) {
  if (!state || !Array.isArray(state.classes) || !Array.isArray(state.students)) { toast('Não há um projeto aberto para receber a importação do DED+.', 'error'); return; }
  const capacity = planDedImport(items); if (!capacity.ok) { toast(capacity.message, 'error'); return; }
  let addedClasses=0, updatedClasses=0, addedStudents=0, updatedStudents=0, addedAssignments=0;
  const now=new Date().toISOString();
  const profile=deriveDedTeacherProfile(items);
  if (!String(state.teacher?.name||'').trim() && profile.teacher.name) state.teacher.name=profile.teacher.name;
  for(const data of items){
    const before=dedClassForImport(data)||dedFallbackClassForImport(data);
    const cls=ensureClassFromDed(data,now); if(before) updatedClasses++; else addedClasses++;
    const beforeAssignment=state.assignments.find(a=>a.classId===cls.id&&normalizeDedClassKey(a.subject)===normalizeDedClassKey(data.component));
    const assignment=assignmentForDedImport(data,cls,now); if(!beforeAssignment) addedAssignments++;
    const classStudents=studentsOf(cls.id), byCode=new Map(classStudents.filter(s=>s?.ded?.studentCode).map(s=>[String(s.ded.studentCode),s])), byName=new Map(classStudents.map(s=>[normalizeDedStudentName(s.name),s]));
    for(const imported of data.students){
      let student=byCode.get(String(imported.dedCode))||null;
      if(!student){const candidate=byName.get(normalizeDedStudentName(imported.name));if(candidate&&(!candidate.ded?.studentCode||String(candidate.ded.studentCode)===String(imported.dedCode)))student=candidate;}
      if(student){if(student.name!==imported.name){student.name=imported.name;updatedStudents++;}student.ded={...(student.ded||{}),studentCode:imported.dedCode,sourceName:data.sourceName};ensureEnrollment(student,cls.id,{dedCode:imported.dedCode,sourceName:data.sourceName});}
      else{student={id:uid('stu'),name:imported.name,classId:cls.id,notes:'',observations:[],ded:{studentCode:imported.dedCode,sourceName:data.sourceName},enrollmentIds:[]};state.students.push(student);ensureEnrollment(student,cls.id,{dedCode:imported.dedCode,sourceName:data.sourceName});addedStudents++;}
      byCode.set(String(imported.dedCode),student);byName.set(normalizeDedStudentName(imported.name),student);
    }
    void assignment;
  }
  if(!addedClasses&&!updatedClasses&&!addedStudents&&!updatedStudents&&!addedAssignments){closeModal();toast('Nenhuma alteração foi necessária.','info');return;}
  markDirty();closeModal();navigate('turmas',false);toast(`${addedClasses} ${addedClasses === 1 ? 'turma adicionada' : 'turmas adicionadas'}, ${addedAssignments} ${addedAssignments === 1 ? 'disciplina' : 'disciplinas'} e ${addedStudents} ${addedStudents === 1 ? 'aluno importado' : 'alunos importados'}.`,'success');
}

function planDedImport(items,{newProject=false}={}){
  const uniqueItems=Array.isArray(items)?items:[],baseClasses=newProject?[]:(state?.classes||[]),baseStudents=newProject?[]:(state?.students||[]),baseAssignments=newProject?[]:(state?.assignments||[]);
  let projectedClasses=baseClasses.length,projectedStudents=baseStudents.length,projectedAssignments=baseAssignments.length,addedClasses=0,addedStudents=0;
  const classKeys=new Set(baseClasses.map(c=>c?.ded?.key||`${c.schoolId}|${c.classCode}|${c.year}`));
  const assignmentKeys=new Set(baseAssignments.map(a=>`${a.classId}|${normalizeDedClassKey(a.subject)}`));
  for(const data of uniqueItems){const classKey=dedClassIdentityKey(data);const classExists=classKeys.has(classKey)||(!newProject&&!!dedClassForImport(data));if(!classExists){projectedClasses++;addedClasses++;classKeys.add(classKey);}const cls=!newProject?dedClassForImport(data):null;const assignmentKey=`${cls?.id||classKey}|${normalizeDedClassKey(data.component)}`;if(!assignmentKeys.has(assignmentKey)){projectedAssignments++;assignmentKeys.add(assignmentKey);}const currentStudents=cls?studentsOf(cls.id):[];const byCode=new Set(currentStudents.filter(s=>s?.ded?.studentCode).map(s=>String(s.ded.studentCode)));const byName=[...currentStudents];for(const imported of data.students||[]){const code=String(imported?.dedCode||''),name=normalizeDedStudentName(imported?.name||'');if(code&&byCode.has(code))continue;const candidate=byName.find(s=>normalizeDedStudentName(s?.name)===name);if(candidate&&(!candidate.ded?.studentCode||String(candidate.ded.studentCode)===code))continue;projectedStudents++;addedStudents++;if(code)byCode.add(code);byName.push({name:imported.name,ded:code?{studentCode:code}:null});}}
  const limits=[];if(projectedClasses>MAX_CLASSES)limits.push(`O limite de ${MAX_CLASSES} turmas seria ultrapassado (${projectedClasses}).`);if(projectedStudents>MAX_STUDENTS)limits.push(`O limite de ${MAX_STUDENTS} alunos seria ultrapassado (${projectedStudents}).`);if(projectedAssignments>MAX_ASSIGNMENTS)limits.push(`O limite de ${MAX_ASSIGNMENTS} atuações seria ultrapassado (${projectedAssignments}).`);
  return {ok:!limits.length,message:limits.join(' '),projectedClasses,projectedAssignments,projectedStudents,addedClasses,addedStudents};
}

function openDedNewProjectModal() {
  openDedImportModal({ newProject: true });
}

function commitDedNewProject(items) {
  if (!items.length) return;
  const capacity=planDedImport(items,{newProject:true}); if(!capacity.ok){toast(capacity.message,'error');return;}
  const profile=deriveDedTeacherProfile(items);
  state=emptyProjectData(); state.teacher={name:profile.teacher.name||''};
  currentFileName=null;currentFileHandle=null;currentStorageMode='none';currentFileLastModified=0;clearDriveBinding();cloudSyncPending=false;localProjectSaved=false;localProjectSavedAt=0;clearDirty();discardLocalRecoveryDraft();lastLocalSaveAt=0;resetContext();enterWorkspace();
  for(const item of items){const cls=ensureClassFromDed(item);assignmentForDedImport(item,cls);const classStudents=studentsOf(cls.id),byCode=new Map(classStudents.filter(s=>s?.ded?.studentCode).map(s=>[String(s.ded.studentCode),s])),byName=new Map(classStudents.map(s=>[normalizeDedStudentName(s.name),s]));for(const imported of item.students){let student=byCode.get(String(imported.dedCode))||null;if(!student){const candidate=byName.get(normalizeDedStudentName(imported.name));if(candidate&&(!candidate.ded?.studentCode||String(candidate.ded.studentCode)===String(imported.dedCode)))student=candidate;}if(!student){student={id:uid('stu'),name:imported.name,classId:cls.id,notes:'',observations:[],ded:{studentCode:imported.dedCode,sourceName:item.sourceName},enrollmentIds:[]};state.students.push(student);}else{student.name=imported.name;student.ded={...(student.ded||{}),studentCode:imported.dedCode,sourceName:item.sourceName};}ensureEnrollment(student,cls.id,{dedCode:imported.dedCode,sourceName:item.sourceName});byCode.set(String(imported.dedCode),student);byName.set(normalizeDedStudentName(imported.name),student);}}
  markDirty();closeModal();navigate('dashboard',false);toast(`${items.length} ${items.length===1?'disciplina criada':'disciplinas criadas'} a partir do DED+.`,'success');
}

function openDedUpdateModal(classId, assignmentId = '') {
  const cls = classById(classId);
  const assignment = assignmentById(assignmentId) || assignmentsOf(classId).find(a => a?.ded?.key) || null;
  if (!cls || !assignment?.ded?.key) {
    toast('Esta turma não possui vínculo com o DED+. Importe-a pelo DED primeiro.', 'info');
    return;
  }
  openModal(`
    <div class="modal-title">Atualizar turma com DED+</div>
    <p class="confirm-body">Selecione o PDF mais recente desta turma. O ProfessorGest vai comparar os alunos pelo código do DED e não excluirá automaticamente quem deixar de aparecer na lista.</p>
    <div class="ded-import-dropzone">
      <div class="ded-import-icon">${ICONS.refresh}</div>
      <strong>Selecionar PDF da turma</strong>
      <span>${esc(cls.name)} · ${esc(assignment.subject || 'Disciplina')} · DED ${esc(assignment.ded.classCode || cls.ded?.classCode || '')}</span>
      <button type="button" class="btn-primary" id="btnChooseDedUpdatePdf">Selecionar PDF</button>
      <input type="file" id="dedUpdatePdfInput" class="visually-hidden" accept="application/pdf,.pdf">
    </div>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button></div>
  `, false, 'ded-import-modal');
  onClick('#btnChooseDedUpdatePdf', () => document.getElementById('dedUpdatePdfInput')?.click());
  const input = q('#dedUpdatePdfInput');
  if (input) input.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const { results, errors } = await parseDedPdfFiles([file]);
      if (errors.length || !results.length) throw new Error(errors[0]?.message || 'Não foi possível interpretar o PDF.');
      const data = results[0];
      if (data.dedKey !== assignment.ded.key && !sameDedClassIdentity(cls, data)) {
        throw new Error('Este PDF pertence a outra turma. Selecione o PDF exportado para esta mesma turma.');
      }
      const diff = dedStudentDiff(cls, data);
      openDedUpdateReview(cls, data, diff, assignment);
    } catch (error) {
      toast(error?.message || 'Não foi possível ler o PDF.', 'error');
    }
  }, { once: true });
}

function openDedUpdateReview(cls, data, diff, assignment = null) {
  const renameList = diff.renamed.map(item => `<li>${esc(item.student.name)} → <strong>${esc(item.imported.name)}</strong></li>`).join('');
  const addedList = diff.added.slice(0, 8).map(item => `<li>${esc(item.name)}</li>`).join('');
  const missingList = diff.missing.slice(0, 8).map(item => `<li>${esc(item.name)}</li>`).join('');
  openModal(`
    <div class="modal-title">Revisar atualização</div>
    <p class="confirm-body"><strong>${esc(cls.name)}</strong> · ${diff.matched.length} ${diff.matched.length === 1 ? 'aluno reconhecido' : 'alunos reconhecidos'}, ${diff.added.length} ${diff.added.length === 1 ? 'novo' : 'novos'}.</p>
    <div class="ded-update-summary" aria-label="Resumo da atualização">
      <div class="ded-update-summary-item"><strong>${diff.added.length}</strong><span>${diff.added.length === 1 ? 'novo' : 'novos'}</span></div>
      <div class="ded-update-summary-item"><strong>${diff.renamed.length}</strong><span>${diff.renamed.length === 1 ? 'nome alterado' : 'nomes alterados'}</span></div>
      <div class="ded-update-summary-item"><strong>${diff.missing.length}</strong><span>${diff.missing.length === 1 ? 'não encontrado no PDF' : 'não encontrados no PDF'}</span></div>
    </div>
    ${renameList ? `<div class="ded-update-section"><strong>Nomes que mudaram</strong><ul>${renameList}</ul></div>` : ''}
    ${addedList ? `<div class="ded-update-section"><strong>Novos alunos</strong><ul>${addedList}${diff.added.length > 8 ? `<li>+ ${diff.added.length - 8} outro(s)</li>` : ''}</ul></div>` : ''}
    ${missingList ? `<div class="ded-import-notice">${diff.missing.length} ${diff.missing.length === 1 ? 'aluno' : 'alunos'} do ProfessorGest não aparecem no PDF atual. Eles <strong>não serão excluídos</strong> nem perderão seu histórico.</div>` : ''}
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="button" class="btn-primary" id="btnConfirmDedUpdate">${ICONS.refresh} Atualizar turma</button></div>
  `, true, 'ded-import-modal');
  onClick('#btnConfirmDedUpdate', () => commitDedUpdate(cls, data, assignment));
}

function commitDedUpdate(cls, data, assignment = null) {
  const diff = dedStudentDiff(cls, data);
  ensureClassFromDed(data);
  assignmentForDedImport(data, cls);
  const byCode = new Map(studentsOf(cls.id).filter(s => s?.ded?.studentCode).map(s => [String(s.ded.studentCode), s]));
  const byName = new Map(studentsOf(cls.id).map(s => [normalizeDedStudentName(s.name), s]));
  let added = 0, renamed = 0;
  for (const imported of data.students) {
    let student = byCode.get(String(imported.dedCode)) || null;
    if (!student) {
      const candidate = byName.get(normalizeDedStudentName(imported.name));
      if (candidate && (!candidate.ded?.studentCode || String(candidate.ded.studentCode) === String(imported.dedCode))) student = candidate;
    }
    if (student) {
      if (student.name !== imported.name) { student.name = imported.name; renamed += 1; }
      student.ded = { ...(student.ded || {}), studentCode: imported.dedCode, sourceName: data.sourceName };
      ensureEnrollment(student, cls.id, { dedCode: imported.dedCode, sourceName: data.sourceName });
    } else {
      student = { id: uid('stu'), name: imported.name, classId: cls.id, notes: '', observations: [], ded: { studentCode: imported.dedCode, sourceName: data.sourceName }, enrollmentIds: [] };
      state.students.push(student); ensureEnrollment(student, cls.id, { dedCode: imported.dedCode, sourceName: data.sourceName }); added += 1;
    }
    byCode.set(String(imported.dedCode), student);
    byName.set(normalizeDedStudentName(imported.name), student);
  }
  markDirty();
  closeModal();
  render();
  toast(`Turma atualizada: ${added} ${added === 1 ? 'aluno adicionado' : 'alunos adicionados'}, ${renamed} ${renamed === 1 ? 'nome atualizado' : 'nomes atualizados'}. ${diff.missing.length} ${diff.missing.length === 1 ? 'aluno preservado' : 'alunos preservados'} fora da lista atual.`, 'success');
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
    { icon: 'folder', label: 'Abrir arquivo', run: () => openFile() },
    { icon: 'file', label: 'Criar novo arquivo', run: () => beginNewProjectSetup(true) },
    { icon: 'sparkle', label: 'Explorar demonstração', run: () => beginDemoMode() },
    { icon: 'cloud', label: driveBindingForCurrentProject() ? 'Atualizar no Google Drive' : 'Conectar ao Google Drive', run: () => saveCurrentToGoogleDrive() },
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
  onClick('#btnDashboardDrive', () => saveCurrentToGoogleDrive());
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
  onClick('#btnNewFile', () => beginNewProjectSetup(true));
  onClick('#topbarHomeBtn', () => closeCurrentFile());
  onClick('#btnOpenFile', () => openFile());
  onClick('#btnOpenBackups', () => openBackupsModal());
  onClick('#btnExportPrg', () => exportCurrentPrgFile());
  onClick('#btnSharePrg', () => shareCurrentPrgFile());
  onClick('#btnDriveOpen', openDrivePicker);
  onClick('#btnDriveAction', saveCurrentToGoogleDrive);
  onClick('#btnDriveDisconnect', disconnectCurrentDriveFile);
  onClick('#btnDriveAccountSettings', openDriveAccountSettings);
  onClick('#btnDriveOpenSettings', openDrivePicker);
  onClick('#btnDriveActionSettings', saveCurrentToGoogleDrive);
  onClick('#btnDriveDisconnectSettings', disconnectCurrentDriveFile);
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
