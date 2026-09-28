import {
  PROF_FORMAT, CURRENT_VERSION, MAX_PROF_BYTES, MAX_STUDENTS, PROF_MIME,
  createProjectId, validateAndParseProf, validateProjectData
} from './src/prof-model.js';
import {
  writeLocalProjectRecord, readLocalProjectRecord, readLocalProjectRecordById, readLocalProjectRecords, deleteLocalProjectRecord, clearLocalProjectRecords, deleteRecoveryRecord,
  writeRecoveryRecord, readLatestRecoveryRecord, writeProjectBackup, readProjectBackups, readAllProjectBackups, deleteProjectBackup, clearProjectBackups, clearAllLocalData
} from './src/local-store.js';
import {
  readDriveBindings, writeDriveBindings, setDriveBinding, removeDriveBinding, getDriveBinding, clearLegacyDriveBinding
} from './src/drive-bindings.js';
import {
  normalizeProfFileName, isAndroidDevice, supportsNativeFilePicker, supportsNativeSavePicker,
  readTextFileUtf8, profOpenPickerTypes, profSavePickerTypes, supportsFileShare, shareFile, downloadTextFile
} from './src/file-io.js';
import { driveFetch as driveHttpFetch, driveJson as driveHttpJson, driveText as driveHttpText } from './src/drive-http.js';
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
import { studentsOf as selectStudentsOf, occurrencesOf as selectOccurrencesOf, activitiesOf as selectActivitiesOf, classById as selectClassById, studentById as selectStudentById, activeClasses as selectActiveClasses, activeStudents as selectActiveStudents, activeActivities as selectActiveActivities, getDeliveryState as selectDeliveryState, studentStats as selectStudentStats, classStats as selectClassStats, activityStats as selectActivityStats, activityStatus as selectActivityStatus } from './src/project-selectors.js';

/* ==================== ProfessorGest ====================
   HTML + CSS + JS puro, sem backend. Dados em memória, salvos/abertos
   através de um arquivo .prof (JSON por dentro).
================================================================= */

const APP_BUILD = '2026.09.28.03';
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
let driveBinding = null;
let driveBindingsByProject = {};
let legacyDriveBindingCandidate = null;
let recoveryDraftCache = null;
let setupOrigin = 'welcome';
let currentView = 'dashboard';
let lastAttentionItems = [];
let localDraftSaveTimer = null;
let cloudAutoSyncTimer = null;
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
  studentSearch: '', studentClassFilter: '', studentSituacao: '', studentSort: 'nome',
  activityFilter: 'proximas', activityClassFilter: '',
  occClassFilter: '', occTypeFilter: '', occMonth: '',
  calMonth: todayYM(), calSelectedDay: null, calClassFilter: '',
  bulkMode: false, bulkSelected: new Set(), bulkContext: null,
  reportStudentId: null, reportFrom: '', reportTo: '', reportOpts: null, reportSynthesis: '',
  classReportId: null, classReportFrom: '', classReportTo: '',
  classSearch: '', activitySearch: '',
  planningSearch: '', planningClassFilter: '', planningFrom: '', planningTo: '',
};

const OCCUR_TYPES = [
  { key: 'nao_atividade',     label: 'Não fez atividade',        tone: 'red',   emoji: '🔴' },
  { key: 'nao_entregou',      label: 'Não entregou trabalho',     tone: 'red',   emoji: '📄' },
  { key: 'conversou',         label: 'Conversou durante a aula',  tone: 'amber', emoji: '💬' },
  { key: 'faltou',            label: 'Faltou',                    tone: 'gray',  emoji: '🚫' },
  { key: 'participou',        label: 'Participou da aula',        tone: 'green', emoji: '⭐' },
  { key: 'bom_comportamento', label: 'Bom comportamento',         tone: 'green', emoji: '✅' },
  { key: 'observacao',        label: 'Outra observação',          tone: 'blue',  emoji: '📝' },
];

const NAV_GROUPS = [
  { label: 'Início', items: [
    { key: 'dashboard', label: 'Início', icon: 'home' },
  ]},
  { label: 'Pessoas', items: [
    { key: 'turmas', label: 'Turmas', icon: 'users' },
    { key: 'alunos', label: 'Alunos', icon: 'user' },
  ]},
  { label: 'Aulas', items: [
    { key: 'atividades', label: 'Atividades', icon: 'clipboard' },
    { key: 'planejamento', label: 'Planejamento', icon: 'calendar' },
    { key: 'calendario', label: 'Calendário', icon: 'calendar' },
  ]},
  { label: 'Acompanhamento', items: [
    { key: 'ocorrencias', label: 'Registros', icon: 'bell' },
    { key: 'relatorios', label: 'Relatórios', icon: 'report' },
  ]},
  { label: 'Meu espaço', items: [
    { key: 'arquivo', label: 'Arquivos', icon: 'folder' },
    { key: 'configuracoes', label: 'Configurações', icon: 'settings' },
  ]},
];
const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items);
const MOBILE_NAV_KEYS = ['dashboard', 'turmas', 'alunos', 'atividades', 'ocorrencias'];

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M22 20c0-2.6-2-4.8-4.7-5.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 011-1h4a1 1 0 011 1v1"/><path d="M9 11h6M9 15h6"/></svg>',
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
  mobileNavKeys: MOBILE_NAV_KEYS,
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
const { buildNav, openMobileMenu, closeMobileMenu, navigate } = navigation;

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

async function saveLocalProjectSnapshot({ stateData = null, storageMode = currentStorageMode, fileName = currentFileName, fileHandle = currentFileHandle, fileLastModified = currentFileLastModified } = {}) {
  if (!stateData && !state) return false;
  const payload = stateData || buildSavePayload();
  const record = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    currentFileName: fileName || null,
    storageMode: storageMode || 'local',
    fileLastModified: Number(fileLastModified) || 0,
    driveBinding: driveBindingForCurrentProject() || null,
    state: payload,
  };
  try {
    await writeLocalProjectRecord({ ...record, fileHandle: fileHandle || null });
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

async function restorePersistedProjectById(projectId) {
  const record = await readLocalProjectRecordById(projectId);
  if (!record?.state || record.state.format !== PROF_FORMAT) return false;

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
        const text = await readTextFileUtf8(file);
        const result = validateAndParseProf(text);
        if (result.ok) {
          applyOpenedData(result.data, file.name, null, record.fileHandle, {
            storageMode: 'file',
            fileLastModified: file.lastModified,
            persistLocal: false,
            warnings: result.warnings || [],
          });
          return true;
        }
      }
    } catch (err) {
      console.warn('[ProfessorGest] Não foi possível reabrir o arquivo local automaticamente.', err);
    }
  }

  applyOpenedData(record.state, record.currentFileName || 'Projeto local', record.driveBinding || null, null, {
    storageMode: 'local',
    fileLastModified: record.fileLastModified || 0,
    persistLocal: false,
    driveBinding: record.driveBinding || null,
    warnings: [],
  });
  return true;
}

async function restorePersistedProject() {
  const records = await readLocalProjectRecords(1);
  return restorePersistedProjectById(records[0]?.state?.projectId || null);
}

function forgetPersistedProjectOnNewSession() {
  localProjectSaved = false;
  localProjectSavedAt = 0;
}

function markDirty() {
  dirtyRevision += 1;
  isDirty = true;
  setSaveUiState('dirty');
  if (driveBindingForCurrentProject()) cloudSyncPending = true;
  scheduleLocalRecoveryDraft();
  scheduleAutomaticBackup();
  scheduleCloudAutoSync();
  updateSaveChrome();
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
    <p class="confirm-body">O ProfessorGest guarda versões anteriores automaticamente neste dispositivo. Elas servem para recuperar um trabalho sem alterar o arquivo .prof original.</p>
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
      body: 'As cópias automáticas armazenadas neste dispositivo serão removidas. Seu arquivo .prof original e o arquivo do Google Drive não serão alterados.',
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
    if (record?.state?.format !== PROF_FORMAT || Number(record.state.version) !== CURRENT_VERSION) return null;
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
    isDirty = true;
    setSaveUiState('dirty');
    resetContext();
    enterWorkspace();
    navigate('dashboard');
    toast('Cópia local recuperada. Salve o arquivo para confirmar as alterações.', 'info');
    render();
  } catch (err) {
    console.error('[ProfessorGest] Erro ao recuperar cópia local:', err);
    toast('Não foi possível recuperar a cópia local.', 'error');
  }
}

function scheduleCloudAutoSync() {
  clearTimeout(cloudAutoSyncTimer);
  cloudAutoSyncTimer = setTimeout(async () => {
    if (!isDirty || demoMode || !driveBindingForCurrentProject() || !driveAccessToken) return;
    if (driveTokenExpiresAt && Date.now() > driveTokenExpiresAt - 45000) return;
    const syncRevision = dirtyRevision;
    try {
      setSaveUiState('syncing');
      updateSaveChrome();
      const synced = await syncCurrentProjectToDrive({ silent: true, skipTokenRefresh: true });
      if (synced) {
        lastCloudSyncAt = Date.now();
        lastLocalSaveAt = Date.now();
        if (dirtyRevision === syncRevision) {
          cloudSyncPending = false;
          clearDirty({ expectedRevision: syncRevision });
          setSaveUiState('synced');
        } else {
          cloudSyncPending = true;
          isDirty = true;
          setSaveUiState('dirty');
          scheduleCloudAutoSync();
        }
      }
      updateSaveChrome();
    } catch (err) {
      setSaveUiState('dirty');
      updateSaveChrome();
      console.warn('[ProfessorGest] Sincronização automática não concluída.', err);
    }
  }, 8500);
}

function updateSaveChrome() {
  const status = document.getElementById('topbarSaveStatus');
  const action = document.getElementById('topbarSaveAction');
  if (!status && !action) return;

  if (demoMode) {
    if (status) status.innerHTML = `<span class="save-chip neutral"><span class="save-chip-dot"></span>Demonstração</span>`;
    if (action) action.innerHTML = '';
    return;
  }

  let label = 'Ainda não salvo';
  let cls = 'neutral';
  let buttonLabel = currentFileName ? 'Salvar' : 'Salvar';
  let disabled = false;

  if (saveUiState === 'saving') {
    label = 'Salvando…'; cls = 'saving'; buttonLabel = 'Salvando'; disabled = true;
  } else if (saveUiState === 'syncing') {
    label = 'Sincronizando…'; cls = 'syncing'; buttonLabel = 'Sincronizando'; disabled = true;
  } else if (isDirty) {
    label = recoveryDraftTimestamp ? 'Não salvo · protegido neste dispositivo' : 'Alterações não salvas';
    cls = 'dirty';
  } else if (cloudSyncPending && driveBindingForCurrentProject()) {
    label = 'Salvo neste dispositivo · Drive pendente'; cls = 'dirty';
    buttonLabel = 'Sincronizar';
  } else if (driveBindingForCurrentProject()) {
    label = 'Sincronizado com Google Drive'; cls = 'synced';
  } else if (currentStorageMode === 'local') {
    label = 'Salvo neste dispositivo'; cls = 'saved';
  } else if (currentFileName) {
    label = lastLocalSaveAt ? 'Salvo neste dispositivo' : 'Salvo'; cls = 'saved';
  }

  if (status) {
    status.innerHTML = `<span class="save-chip ${cls}"><span class="save-chip-dot"></span><span>${label}</span></span>`;
    status.title = label;
  }
  if (action) {
    action.innerHTML = `<button type="button" class="topbar-save-button" id="topbarSaveBtn" ${disabled ? 'disabled' : ''}>${ICONS.save}<span>${buttonLabel}</span></button>`;
    const btn = document.getElementById('topbarSaveBtn');
    if (btn) btn.onclick = savePrimaryAction;
  }
}

async function savePrimaryAction() {
  if (demoMode || !workspaceReady || !state) return;
  setSaveUiState('saving');
  updateSaveChrome();
  try {
    if (driveBindingForCurrentProject() && !currentFileHandle) {
      const synced = await saveCurrentToGoogleDrive({ fromPrimarySave: true });
      if (!synced && driveAuthCancelled) {
        await saveFile({ fromPrimarySave: true, skipCloudSync: true });
        toast('Login do Google fechado. As alterações foram salvas neste dispositivo.', 'info');
        return;
      }
      if (!synced) {
        setSaveUiState('dirty');
        updateSaveChrome();
        return;
      }
    } else {
      await saveFile({ fromPrimarySave: true });
    }
  } catch (err) {
    setSaveUiState('dirty');
    updateSaveChrome();
    if (driveAuthCancelled) {
      try {
        await saveFile({ fromPrimarySave: true, skipCloudSync: true });
        toast('Login do Google fechado. As alterações foram salvas neste dispositivo.', 'info');
      } catch (_) {}
    }
  }
}

function updateWelcomeExperience(returningUser) {
  const screen = document.getElementById('welcomeScreen');
  const newFile = document.getElementById('welcomeNewFile');
  const openFile = document.getElementById('welcomeOpenFile');
  const title = document.querySelector('.welcome-content-minimal h1');
  const lead = document.querySelector('.welcome-content-minimal .welcome-lead');
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
  legacyDriveBindingCandidate = loaded.legacyCandidate;
  driveBinding = state?.projectId ? getDriveBinding(driveBindingsByProject, state.projectId) : null;
  return driveBindingsByProject;
}

function persistDriveBindings() {
  writeDriveBindings(driveBindingsByProject);
}

function saveDriveBinding(binding) {
  const result = setDriveBinding(driveBindingsByProject, binding, state?.projectId);
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
  if (isDirty) return 'Alterações locais pendentes';
  return 'Sincronizado com Google Drive';
}

function driveStatusTone() {
  const binding = driveBindingForCurrentProject();
  if (!isGoogleDriveConfigured()) return 'neutral';
  if (!binding) return 'neutral';
  if (isDirty) return 'dirty';
  return 'saved';
}

function driveBindingForCurrentProject() {
  if (!state?.projectId) return null;
  const binding = driveBindingsByProject[state.projectId] || driveBinding;
  if (!binding?.fileId || binding.projectId !== state.projectId) return null;
  return binding;
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
async function getDriveAccessToken({ forceConsent = false } = {}) {
  if (!isGoogleDriveConfigured()) throw new Error('Google Drive não está configurado para este aplicativo.');
  const now = Date.now();
  if (driveAccessToken && driveTokenExpiresAt > now + 60000) return driveAccessToken;
  if (driveTokenPromise) return driveTokenPromise;

  driveAuthCancelled = false;
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
      }, 20000);

      driveTokenClient.callback = (response) => {
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
        driveAccessToken = response.access_token;
        driveTokenExpiresAt = Date.now() + ((Number(response.expires_in) || 3600) * 1000);
        settle(resolve, driveAccessToken);
      };
      try {
        driveTokenClient.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
      } catch (err) {
        driveAuthCancelled = true;
        settle(reject, err);
      }
    });
  })().finally(() => { driveTokenPromise = null; });

  return driveTokenPromise;
}

function requestDriveAccessTokenFromClick({ forceConsent = false, onToken, onError } = {}) {
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

  const request = (prompt, allowConsentFallback) => {
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

        if (allowConsentFallback && requiresInteraction) {
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

      driveAccessToken = response.access_token;
      driveTokenExpiresAt = Date.now() + ((Number(response.expires_in) || 3600) * 1000);
      onToken?.(driveAccessToken);
    };

    try {
      driveTokenClient.requestAccessToken({
        prompt: prompt || '',
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
  const teacherBase = safeFileName(state?.teacher?.name || 'professorgest');
  return currentFileName ? normalizeProfFileName(currentFileName) : `professorgest-${teacherBase}.prof`;
}

async function createDriveFileFromCurrent() {
  if (demoMode) throw new Error('A demonstração não pode ser sincronizada.');
  const token = await getDriveAccessToken({ forceConsent: false });
  const json = JSON.stringify(buildSavePayload(), null, 2);
  const response = await driveFetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=media&fields=id,name,mimeType,modifiedTime`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: json,
  });
  if (!response.ok) {
    let message = `Google Drive respondeu com ${response.status}.`;
    try { message = (await response.json())?.error?.message || message; } catch (_) {}
    throw new Error(message);
  }
  const created = await response.json();
  const name = remoteFileName();
  const meta = await driveJson(`${DRIVE_API_BASE}/files/${encodeURIComponent(created.id)}?fields=id,name,mimeType,modifiedTime`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: PROF_MIME }),
  });
  currentFileName = name;
  saveDriveBinding({ fileId: meta.id, name: meta.name, modifiedTime: meta.modifiedTime, lastSyncAt: new Date().toISOString() });
  return meta;
}

async function updateDriveFile(fileId) {
  const json = JSON.stringify(buildSavePayload(), null, 2);
  const response = await driveFetch(`${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,mimeType,modifiedTime`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: json,
  });
  let meta = null;
  try { meta = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(meta?.error?.message || `Não foi possível atualizar o arquivo (${response.status}).`);
  if (meta?.name !== currentFileName) {
    meta = await driveJson(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: currentFileName || remoteFileName(), mimeType: PROF_MIME }),
    });
  }
  saveDriveBinding({ fileId: meta.id, name: meta.name || currentFileName, modifiedTime: meta.modifiedTime, lastSyncAt: new Date().toISOString() });
  return meta;
}

async function getDriveMeta(fileId) {
  return driveJson(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,capabilities(canEdit),trashed`);
}

async function getDriveFileContent(fileId) {
  return driveText(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`);
}

async function openDriveFileById(fileId, fallbackName = 'ProfessorGest.prof') {
  const meta = await getDriveMeta(fileId);
  if (meta.trashed) throw new Error('Esse arquivo está na lixeira do Google Drive.');
  if (meta.capabilities && meta.capabilities.canEdit === false) throw new Error('Este arquivo pode ser aberto, mas sua conta não tem permissão para editá-lo.');
  const text = await getDriveFileContent(fileId);
  const result = validateAndParseProf(text);
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
    <p class="confirm-body">O Google Drive ainda não está disponível para este site. Você pode continuar salvando seus arquivos neste dispositivo ou exportar uma cópia .prof.</p>
    <div class="cloud-setup-note"><strong>O arquivo continua funcionando normalmente sem isso.</strong><span>Você pode usar arquivos locais enquanto a integração não estiver ativa.</span></div>
    <div class="form-actions"><button type="button" class="btn-primary" id="modalCancel">Entendi</button></div>
  `);
}

function buildDrivePicker(token) {
  const cfg = googleDriveConfig();
  const view = new google.picker.DocsView(google.picker.ViewId.DOCS);
  // O arquivo .prof é criado no próprio Drive do professor. Não use
  // setOwnedByMe(false), pois false filtra justamente para itens compartilhados.
  // Também não restringimos MIME aqui: o Drive pode classificar um .prof como
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
          await openDriveFileById(doc.id, doc.name || 'ProfessorGest.prof');
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
    onToken: (token) => {
      loadPickerApi(15000)
        .then(() => buildDrivePicker(token))
        .catch(showDriveError);
    },
    onError: showDriveError,
  });
}

function openDriveSyncHelp() {
  openModal(`
    <div class="confirm-icon info">${ICONS.cloud}</div>
    <div class="modal-title">Sincronização com Google Drive</div>
    <p class="confirm-body">Você pode manter o mesmo arquivo do ProfessorGest no computador e no celular usando o Google Drive. O ProfessorGest continua funcionando localmente e o Drive fica opcional.</p>
    <div class="cloud-steps">
      <div><b>1</b><span>Conecte sua conta Google.</span></div>
      <div><b>2</b><span>Salve este projeto no Drive.</span></div>
      <div><b>3</b><span>No outro dispositivo, use “Abrir do Google Drive”.</span></div>
    </div>
    <div class="form-actions"><button type="button" class="btn-primary" id="modalCancel">Entendi</button></div>
  `);
}

async function syncCurrentProjectToDrive({ force = false, silent = false, skipTokenRefresh = false } = {}) {
  if (driveSyncPromise) return driveSyncPromise;
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
    if (!silent) toast('Sincronizado com Google Drive.', 'success');
    render();
    return true;
  })().finally(() => { driveSyncPromise = null; });
  return driveSyncPromise;
}

function showDriveConflict(remoteMeta) {
  const bindingId = driveBindingForCurrentProject()?.fileId;
  if (!bindingId) return;
  openModal(`
    <div class="confirm-icon danger">${ICONS.alert}</div>
    <div class="modal-title">O arquivo mudou no Google Drive</div>
    <p class="confirm-body">Existe uma versão mais recente do arquivo na nuvem. Escolha qual versão deve continuar sendo usada.</p>
    <ul class="confirm-detail-list">
      <li><span>Neste dispositivo</span><strong>${esc(currentFileName || 'Projeto atual')}</strong></li>
      <li><span>No Drive</span><strong>${esc(remoteMeta.name || currentFileName || 'Projeto')}</strong></li>
    </ul>
    <div class="form-actions" style="flex-wrap:wrap;">
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
    try { await syncCurrentProjectToDrive({ force: true }); }
    catch (err) { toast(err.message || 'Não foi possível atualizar o Drive.', 'error'); }
  };
}

async function saveCurrentToGoogleDrive({ fromPrimarySave = false } = {}) {
  if (demoMode) { toast('A demonstração não pode ser sincronizada.', 'info'); return false; }
  if (!isGoogleDriveConfigured()) { showDriveNotConfigured(); return false; }
  try {
    const syncRevision = dirtyRevision;
    await getDriveAccessToken({ forceConsent: false });
    if (driveBindingForCurrentProject()?.fileId) {
      const synced = await syncCurrentProjectToDrive({ silent: true, skipTokenRefresh: true });
      if (!synced) {
        cloudSyncPending = true;
        setSaveUiState('dirty');
        updateSaveChrome();
        return false;
      }
      lastCloudSyncAt = Date.now();
      lastLocalSaveAt = Date.now();
      currentStorageMode = 'drive';
      await saveLocalProjectSnapshot({ stateData: buildSavePayload(), storageMode: 'drive', fileName: currentFileName, fileHandle: null, fileLastModified: 0 });
      if (dirtyRevision === syncRevision) {
        cloudSyncPending = false;
        clearDirty({ expectedRevision: syncRevision });
        setSaveUiState('synced');
      } else {
        cloudSyncPending = true;
        isDirty = true;
        setSaveUiState('dirty');
      }
      toast('Sincronizado com Google Drive.', 'success');
      render();
      return true;
    }
    const meta = await createDriveFileFromCurrent();
    lastCloudSyncAt = Date.now();
    lastLocalSaveAt = Date.now();
    currentStorageMode = 'drive';
    await saveLocalProjectSnapshot({ stateData: buildSavePayload(), storageMode: 'drive', fileName: currentFileName, fileHandle: null, fileLastModified: 0 });
    if (dirtyRevision === syncRevision) {
      cloudSyncPending = false;
      clearDirty({ expectedRevision: syncRevision });
      setSaveUiState('synced');
    } else {
      cloudSyncPending = true;
      isDirty = true;
      setSaveUiState('dirty');
    }
    toast(`Salvo no Google Drive como ${meta.name}.`, 'success');
    render();
    return true;
  } catch (err) {
    driveAuthCancelled = isDriveAuthCancellationError(err);
    cloudSyncPending = !!driveBindingForCurrentProject()?.fileId;
    setSaveUiState('dirty');
    updateSaveChrome();
    if (!driveAuthCancelled) toast(err.message || 'Não foi possível salvar no Google Drive.', 'error');
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
    histFilter: 'todos', histMonth: '', studentSearch: '', studentClassFilter: '', studentSituacao: '', studentSort: 'nome',
    activityFilter: 'proximas', activityClassFilter: '', occClassFilter: '', occTypeFilter: '', occMonth: '',
    calMonth: todayYM(), calSelectedDay: null, calClassFilter: '', bulkMode: false, bulkSelected: new Set(), bulkContext: null,
    reportStudentId: null, reportFrom: '', reportTo: '', reportOpts: null, reportSynthesis: '', classReportId: null, classReportFrom: '', classReportTo: ''
  };
}

function emptyProjectData() {
  const today = todayISO();
  return {
    format: PROF_FORMAT, version: CURRENT_VERSION, projectId: createProjectId(), createdAt: today, updatedAt: today,
    teacher: { name: '', school: '', subject: '' }, classes: [], students: [], activities: [], occurrences: [], plans: [],
  };
}

async function resetInMemoryAfterLocalDataClear() {
  clearTimeout(localDraftSaveTimer);
  clearTimeout(automaticBackupTimer);
  clearTimeout(cloudAutoSyncTimer);
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
  driveBinding = null;
  driveBindingsByProject = {};
  legacyDriveBindingCandidate = null;
  lastLocalSaveAt = 0;
  lastCloudSyncAt = 0;
  dirtyRevision = 0;
  isDirty = false;
  saveUiState = 'idle';
  try { localStorage.removeItem(LOCAL_RECOVERY_KEY); } catch (_) {}
  try { localStorage.removeItem(DEV_LOG_KEY); } catch (_) {}
  try { localStorage.removeItem('professorgest-theme'); } catch (_) {}
  writeDriveBindings({});
  clearLegacyDriveBinding();
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
  toast('A versão local foi removida. O arquivo .prof original não foi alterado.', 'info');
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
  toast('As versões locais foram removidas. Seus arquivos .prof não foram alterados.', 'success');
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
  toast('A recuperação protegida foi descartada. O arquivo .prof original não foi alterado.', 'info');
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
    <p class="confirm-body">Aqui você controla o que o ProfessorGest mantém neste navegador. O <strong>arquivo .prof</strong> continua sendo a cópia principal do seu trabalho; limpar essas versões locais não apaga seus arquivos.</p>

    <section class="local-data-section">
      <div class="local-data-section-head"><div><strong>Versões locais</strong><span>Até 4 cópias de apoio para reabrir trabalhos sem substituir seus arquivos .prof.</span></div>${localRecords.length ? '<button type="button" class="btn-ghost btn-sm danger" id="btnClearAllLocalProjects">Limpar versões locais</button>' : ''}</div>
      ${recovery ? `<div class="local-data-row"><div><strong>Recuperação automática</strong><span>${esc(recovery.currentFileName || 'Projeto sem nome')} · ${formatRecoveryTime(recovery.savedAt)}</span></div><button type="button" class="btn-ghost btn-sm danger" id="btnDiscardRecovery">Descartar</button></div>` : ''}
      ${localRecords.length ? `<div class="local-data-items">
          ${localRecords.map(record => {
            const projectId = record?.state?.projectId || '';
            const current = projectId === state?.projectId;
            return `<div class="local-data-row"><div><strong>${localProjectLabel(record)}${current ? ' · atual' : ''}</strong><span>Versão local · ${formatRecoveryTime(record.savedAt)}</span></div><button type="button" class="btn-ghost btn-sm danger" data-discard-local-project="${esc(projectId)}">Remover</button></div>`;
          }).join('')}
        </div>
        ${matchingLocal && recovery ? '<p class="form-hint">A recuperação automática pertence ao mesmo projeto e pode conter alterações mais recentes que a versão local salva.</p>' : ''}
        ${localRecords.length >= 4 ? '<p class="form-hint">Limite local: 4 projetos. Ao guardar um quinto, o ProfessorGest remove automaticamente a versão local mais antiga. Isso não apaga nenhum arquivo .prof.</p>' : ''}
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
      body: 'A cópia protegida será removida deste dispositivo. O arquivo .prof original não será alterado.',
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
        body: `A versão local de ${record?.currentFileName || 'este projeto'} será removida deste dispositivo. O arquivo .prof original e o Google Drive não serão alterados.`,
        confirmLabel: 'Remover versão', danger: true,
        onConfirm: async () => { closeModal(); await discardSavedLocalProject(projectId); }
      });
    });
  });

  onClick('#btnClearAllLocalProjects', () => {
    const count = localRecords.length;
    confirmModal({
      title: `Limpar ${count} ${count === 1 ? 'versão local' : 'versões locais'}?`,
      body: 'As cópias de trabalho locais serão removidas deste dispositivo. Recuperações, backups, arquivos .prof e arquivos do Google Drive não serão alterados.',
      detailList: [
        ['Será apagado', `${count} ${count === 1 ? 'versão local' : 'versões locais'} guardadas pelo ProfessorGest`],
        ['Não será apagado', 'Seus arquivos .prof e arquivos do Google Drive'],
      ],
      confirmLabel: 'Limpar versões locais', danger: true,
      onConfirm: async () => { closeModal(); await clearAllLocalProjectVersions(); }
    });
  });

  onClick('#btnManageBackups', () => openBackupsModal({ global: true }));
  onClick('#btnClearAllBackups', async () => {
    confirmModal({
      title: `Limpar ${backups.length} ${backups.length === 1 ? 'cópia' : 'cópias'} de segurança?`,
      body: 'As cópias automáticas armazenadas neste dispositivo serão removidas. O trabalho atual e os arquivos .prof externos não serão alterados.',
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
      body: 'Esta ação remove permanentemente os dados que o ProfessorGest mantém neste navegador, incluindo alterações não salvas que existam apenas nesta sessão. Ela não apaga arquivos .prof nas suas pastas nem arquivos no Google Drive.',
      detailList: [
        ['Será apagado', 'Versões locais, recuperação, cópias de segurança, vínculos do Drive, registros de suporte e preferências'],
        ['Também pode ser perdido', 'Qualquer alteração ainda não salva que exista apenas no ProfessorGest'],
        ['Não será apagado', 'Arquivos .prof fora do aplicativo e arquivos no Google Drive'],
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
  const loadingStartedAt = withLoading ? beginAppLoading('Carregando seus dados...') : null;
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

    // O conteúdo de recuperação/projetos é assíncrono (IndexedDB). Nunca
    // mostre a tela inicial antes de terminar essa leitura, caso contrário
    // o usuário vê a interface "montando" depois que o splash some.
    setBootStatus('Carregando seus dados...');
    await hydrateRecoveryCache();

    setBootStatus('Preparando a tela inicial...');
    await renderWelcomeRecovery();
    await updateWelcomeBackupAction();

    // Aguarda os elementos visuais realmente utilizados pela primeira tela.
    await waitForInitialVisuals();
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

function beginNewProjectSetup(fromWorkspace = false) {
  const openSetup = () => {
    setupOrigin = fromWorkspace ? 'workspace' : 'welcome';
    hideSetupScreen();
    showSetupScreen(setupOrigin);
  };

  if (fromWorkspace && isDirty) {
    confirmModal({
      title: 'Criar um novo arquivo?',
      body: 'O projeto atual possui alterações que ainda não foram salvas. Criar um arquivo novo vai substituir o projeto que está aberto nesta sessão.',
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
  state.teacher = {
    name,
    school: document.getElementById('setupSchool')?.value.trim() || '',
    subject: document.getElementById('setupSubject')?.value.trim() || '',
  };
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
  const school = document.getElementById('setupSchool')?.value.trim() || '';
  const subject = document.getElementById('setupSubject')?.value.trim() || '';
  const avatar = document.getElementById('setupAvatar');
  const previewName = document.getElementById('setupPreviewName');
  const previewMeta = document.getElementById('setupPreviewMeta');
  const previewSchool = document.getElementById('setupPreviewSchool');
  const previewSubject = document.getElementById('setupPreviewSubject');
  if (avatar) avatar.textContent = initials(name || 'P') || 'P';
  if (previewName) previewName.textContent = name || 'Seu nome';
  if (previewMeta) previewMeta.textContent = subject || 'Professor(a)';
  if (previewSchool) previewSchool.textContent = school || 'Não informado';
  if (previewSubject) previewSubject.textContent = subject || 'Não informada';
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

async function waitForInitialVisuals() {
  const waits = [];

  // Aguarda as fontes usadas pela primeira tela, sem impor um timeout
  // artificial que faria o conteúdo aparecer antes de estar pronto.
  if (document.fonts?.ready) {
    waits.push(Promise.resolve(document.fonts.ready).catch(() => {}));
  }

  // Aguarda imagens já presentes no documento. Isso evita a troca tardia
  // de tamanho/forma quando logos ou ícones terminam de carregar.
  const images = Array.from(document.images || []);
  waits.push(Promise.all(images.map(img => {
    if (img.complete) {
      return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
    }
    return new Promise(resolve => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  })));

  await Promise.all(waits);
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
  bindProjectInfo();
  bindSetupEvents();
  setBootStatus('Preparando o ProfessorGest...');
  initGoogleDriveSdk();
  registerPwa();

  // O splash só termina depois que a primeira tela e seus dados locais
  // estiverem prontos. A duração mínima de 1,2 s continua sendo aplicada
  // por finishAppBoot(), evitando flashes/efeitos de "interface montando".
  await showWelcomeScreen({ withLoading: false });

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

function bindProjectInfo() {
  const button = document.getElementById('projectAboutButton');
  const modal = document.getElementById('projectInfoModal');
  if (!button || !modal) return;

  const setOpen = (open) => {
    modal.classList.toggle('is-open', open);
    modal.setAttribute('aria-hidden', String(!open));
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      modal.querySelector('.project-info-close')?.focus();
    } else {
      button.focus();
    }
  };

  button.addEventListener('click', () => setOpen(true));
  modal.querySelectorAll('[data-project-info-close]').forEach(el => {
    el.addEventListener('click', () => setOpen(false));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) {
      setOpen(false);
    }
  });
}

function bindGlobalEvents() {
  document.getElementById('welcomeNewFile').onclick = () => beginNewProjectSetup(false);
  document.getElementById('welcomeOpenFile').onclick = () => openFile();
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
      savePrimaryAction();
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
  dashboard: 'Início', turmas: 'Turmas', alunos: 'Alunos', atividades: 'Atividades',
  calendario: 'Calendário', planejamento: 'Planejamento', ocorrencias: 'Ocorrências', relatorios: 'Relatórios',
  arquivo: 'Arquivo', configuracoes: 'Configurações',
  turmaDetail: 'Turma', alunoDetail: 'Perfil do aluno', atividadeDetail: 'Atividade',
  relatorioIndividual: 'Relatório individual', relatorioTurma: 'Relatório da turma',
};

function render() {
  document.getElementById('viewTitle').textContent = VIEW_TITLES[currentView] || 'ProfessorGest';
  document.getElementById('topbarFile').innerHTML = topbarFileHTML();
  updateSaveChrome();
  document.getElementById('topbarAvatar').textContent = initials((state.teacher && state.teacher.name) || 'Professor') || 'P';

  const c = document.getElementById('viewContainer');
  const renderers = {
    dashboard: renderDashboard, turmas: renderTurmas, alunos: renderAlunos, atividades: renderAtividades,
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
  else if (driveBindingForCurrentProject()) { statusLine = 'Sincronizado'; cls = 'saved'; }
  else if (currentFileName) { statusLine = 'Salvo'; cls = 'saved'; }
  else { statusLine = 'Novo projeto'; cls = 'neutral'; }
  const cloud = driveBindingForCurrentProject() ? `<span class="topbar-cloud-badge" title="Sincronizado com Google Drive">${ICONS.cloud}</span>` : '';
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
function activitiesOf(classId) { return selectActivitiesOf(state, classId); }
function classById(id) { return selectClassById(state, id); }
function studentById(id) { return selectStudentById(state, id); }
function classNameOf(classId) { const c = classById(classId); return c ? c.name : 'Sem turma'; }
function initials(name) { return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(''); }
function activeClasses() { return selectActiveClasses(state); }
function activeStudents() { return selectActiveStudents(state); }
function activeActivities() { return selectActiveActivities(state); }
function getDeliveryState(activity, studentId) { return selectDeliveryState(activity, studentId); }
function studentStats(s) { return selectStudentStats(state, s, todayISO); }
function classStats(c) { return selectClassStats(state, c, todayISO); }
function activityStats(a) { return selectActivityStats(state, a); }
function activityStatus(a) { return selectActivityStatus(state, a, todayISO); }

function situacaoAluno(s) {
  const st = studentStats(s);
  if (st.pend >= 3) return { key: 'critico', label: 'Muitas pendências', tone: 'red' };
  if (st.pend > 0) return { key: 'pendencia', label: 'Com pendências', tone: 'amber' };
  return { key: 'ok', label: 'Em dia', tone: 'green' };
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function emptyState(msg, sub) {
  return `<div class="empty-state"><div class="empty-title">${esc(msg)}</div>${sub ? `<div>${esc(sub)}</div>` : ''}</div>`;
}
function badgeFor(typeKey) {
  const t = OCCUR_TYPES.find(x => x.key === typeKey) || { label: typeKey, tone: 'gray', emoji: '' };
  return `<span class="badge badge-${t.tone}">${t.emoji} ${t.label}</span>`;
}
function deliveryBadge(st) {
  if (st === 'delivered') return '<span class="badge badge-green">✅ Entregou</span>';
  if (st === 'not_delivered') return '<span class="badge badge-red">❌ Não entregou</span>';
  return '<span class="badge badge-gray">◯ Não verificado</span>';
}
function progressBarHTML(pct, extraClass) {
  const cls = pct >= 80 ? '' : pct >= 50 ? 'warn' : 'danger';
  return `<div class="progress-track"><div class="progress-fill ${extraClass || cls}" style="width:${pct}%"></div></div>`;
}

const studentActivityRenderers = createStudentActivityRenderers({
  getState: () => state, getCtx: () => ctx, esc, initials, classNameOf, studentStats, activityStats, activityStatus,
  situacaoAluno, occurrencesOf, activitiesOf, getDeliveryState, deliveryBadge,
  progressBarHTML, emptyState, fmtDate, monthLabel, badgeFor, todayISO, ICONS
});

function renderWelcomeRecovery() {
  welcomeViewRenderer.renderWelcomeRecovery();
  updateWelcomeBackupAction();
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
  getState: () => state, getCtx: () => ctx, esc, classNameOf, studentById, studentsOf, initials,
  activityStatus, todayISO, fmtDate, monthLabel, weekdayShort, pad2,
  emptyState, badgeFor, ICONS, occurrenceTypes: OCCUR_TYPES
});

function renderCalendario() { return calendarOccurrenceRenderers.renderCalendario(); }
function renderPlanejamento() { return planningViewRenderer.renderPlanejamento(); }
function renderOcorrenciasLog() { return calendarOccurrenceRenderers.renderOcorrenciasLog(); }
function activitiesInMonth(ym) { return calendarOccurrenceRenderers.activitiesInMonth(ym); }

const reportRenderers = createReportRenderers({
  getState: () => state, getCtx: () => ctx, esc, classNameOf, studentById, studentsOf, activitiesOf, occurrencesOf,
  getDeliveryState, todayISO, addDays, fmtDate, emptyState,
  timelineEntriesHTML: studentActivityRenderers.timelineEntriesHTML,
  studentTimelineEntries: studentActivityRenderers.studentTimelineEntries,
  occurrenceTypes: OCCUR_TYPES, ICONS
});

function renderRelatoriosHub() { return reportRenderers.renderRelatoriosHub(); }
function renderRelatorioIndividual() { return reportRenderers.renderRelatorioIndividual(); }
function renderRelatorioTurma() { return reportRenderers.renderRelatorioTurma(); }

const fileSettingsRenderers = createFileSettingsRenderers({
  getState: () => state, esc, getDemoMode: () => demoMode, getCurrentFileName: () => currentFileName, getIsDirty: () => isDirty, ICONS,
  supportsFileShare, driveStatusTone, driveStatusText, driveBindingForCurrentProject,
  fmtDate, fmtDateTime, getThemeMode, getDevLogEntries, getProjectBackups
});

function renderArquivo() { return fileSettingsRenderers.renderArquivo(); }
function renderConfiguracoes() { return fileSettingsRenderers.renderConfiguracoes(); }

const planningViewRenderer = createPlanningViewRenderer({
  getState: () => state, getCtx: () => ctx, esc, fmtDate, classNameOf, emptyState, ICONS
});

const classViewRenderers = createClassViewRenderers({
  getState: () => state, getCtx: () => ctx, classById, classStats, studentsOf, occurrencesOf, studentById,
  situacaoAluno, initials, activityListItemHTML, esc, fmtDate, todayISO, emptyState, badgeFor, ICONS
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
});


function renderTurmaDetail() { return classViewRenderers.renderTurmaDetail(); }
function renderClassStudentsTab(c) { return classViewRenderers.renderClassStudentsTab(c); }

/* ==================== DASHBOARD ==================== */

function attentionItems() {
  const items = [];
  const today = todayISO();
  const overdueActs = activeActivities().filter(a => a.dueDate < today).filter(a => {
    const st = activityStats(a);
    return st.notDelivered + st.pending > 0;
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  overdueActs.slice(0, 3).forEach(a => {
    const st = activityStats(a);
    items.push({ tone: 'red', title: `${a.name} está atrasada`,
      sub: `${classNameOf(a.classId)} · ${st.notDelivered + st.pending} aluno(s) sem entrega confirmada`,
      action: () => { ctx.activityId = a.id; navigate('atividadeDetail', false); } });
  });

  const dueSoon = activeActivities().filter(a => a.dueDate >= today && a.dueDate <= addDays(3))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  dueSoon.slice(0, 3).forEach(a => {
    items.push({ tone: 'amber', title: `${a.name} vence em breve`,
      sub: `${classNameOf(a.classId)} · entrega ${fmtDate(a.dueDate)}`,
      action: () => { ctx.activityId = a.id; navigate('atividadeDetail', false); } });
  });

  const criticos = activeStudents().filter(s => studentStats(s).pend >= 3);
  criticos.slice(0, 3).forEach(s => {
    const st = studentStats(s);
    items.push({ tone: 'red', title: `${s.name} tem ${st.pend} pendências`,
      sub: `${classNameOf(s.classId)} · acompanhar entregas e ocorrências`,
      action: () => { ctx.studentId = s.id; ctx.studentTab = 'visao'; navigate('alunoDetail', false); } });
  });

  const activeStudentIds = new Set(activeStudents().map(s => s.id));
  const recentOcc = state.occurrences.filter(o => activeStudentIds.has(o.studentId) && o.date >= addDays(-3) && (o.type === 'nao_atividade' || o.type === 'nao_entregou' || o.type === 'faltou'));
  recentOcc.slice(0, 2).forEach(o => {
    const s = studentById(o.studentId);
    if (!s) return;
    items.push({ tone: 'blue', title: `Novo registro para ${s.name}`,
      sub: `${fmtDate(o.date)} · ${OCCUR_TYPES.find(t => t.key === o.type)?.label || o.type}`,
      action: () => { ctx.studentId = s.id; ctx.studentTab = 'historico'; navigate('alunoDetail', false); } });
  });

  return items.slice(0, 6);
}

const coreViewRenderers = createCoreViewRenderers({
  getState: () => state,
  getCtx: () => ctx,
  setLastAttentionItems: value => { lastAttentionItems = value; },
  activeStudents, activeActivities, activeClasses,
  classStats, activityStats, studentById, classNameOf,
  attentionItems, todayISO, greeting, esc, fmtDate,
  emptyState, progressBarHTML, badgeFor, ICONS
});

function renderDashboard() { return coreViewRenderers.renderDashboard(); }

/* ==================== TURMAS ==================== */
/* ==================== TURMAS ==================== */

function renderTurmas() { return coreViewRenderers.renderTurmas(); }



/* ==================== ALUNOS ==================== */




/* ==================== PERFIL DO ALUNO ==================== */






/* ==================== ATIVIDADES ==================== */




/* ==================== CALENDÁRIO ==================== */



/* ==================== OCORRÊNCIAS (log global) ==================== */


/* ==================== RELATÓRIOS ==================== */


function openIndividualReportConfig(presetStudentId) {
  ctx.reportStudentId = presetStudentId || ctx.reportStudentId || (state.students[0] && state.students[0].id) || null;
  ctx.reportFrom = ctx.reportFrom || addDays(-60);
  ctx.reportTo = ctx.reportTo || todayISO();
  ctx.reportOpts = ctx.reportOpts || { resumo: true, atividades: true, entregas: true, naoEntregas: true, ocorrencias: true, observacoes: true, linha: true };
  openModal(`
    <div class="modal-title">Relatório individual do aluno</div>
    <form id="reportConfigForm">
      <div class="form-group"><label class="form-label" for="reportStudentId">Aluno</label>
        <select class="form-select" id="reportStudentId" name="studentId">${state.students.map(s => `<option value="${esc(s.id)}" ${s.id === ctx.reportStudentId ? 'selected' : ''}>${esc(s.name)} — ${esc(classNameOf(s.classId))}</option>`).join('')}</select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="reportFrom">Período — de</label><input class="form-input" id="reportFrom" type="date" name="from" value="${ctx.reportFrom}"></div>
        <div class="form-group"><label class="form-label" for="reportTo">até</label><input class="form-input" id="reportTo" type="date" name="to" value="${ctx.reportTo}"></div>
      </div>
      <fieldset class="form-group" style="border:0;padding:0;"><legend class="form-label">Incluir no relatório</legend>
        ${reportOptCheckbox('resumo', 'Resumo')}${reportOptCheckbox('atividades', 'Atividades')}${reportOptCheckbox('entregas', 'Entregas')}
        ${reportOptCheckbox('naoEntregas', 'Não entregas')}${reportOptCheckbox('ocorrencias', 'Ocorrências')}${reportOptCheckbox('observacoes', 'Observações')}${reportOptCheckbox('linha', 'Linha do tempo')}
      </fieldset>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="submit" class="btn-primary">Visualizar relatório</button></div>
    </form>
  `);
}
function reportOptCheckbox(key, label) {
  return `<label class="checkbox-row"><input type="checkbox" name="opt_${key}" ${ctx.reportOpts[key] ? 'checked' : ''}> ${label}</label>`;
}


function openClassReportConfig(presetClassId) {
  ctx.classReportId = presetClassId || ctx.classReportId || (state.classes[0] && state.classes[0].id) || null;
  ctx.classReportFrom = ctx.classReportFrom || addDays(-60);
  ctx.classReportTo = ctx.classReportTo || todayISO();
  openModal(`
    <div class="modal-title">Relatório da turma</div>
    <form id="classReportConfigForm">
      <div class="form-group"><label class="form-label" for="classReportId">Turma</label>
        <select class="form-select" id="classReportId" name="classId">${state.classes.map(c => `<option value="${esc(c.id)}" ${c.id === ctx.classReportId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="classReportFrom">Período — de</label><input class="form-input" id="classReportFrom" type="date" name="from" value="${ctx.classReportFrom}"></div>
        <div class="form-group"><label class="form-label" for="classReportTo">até</label><input class="form-input" id="classReportTo" type="date" name="to" value="${ctx.classReportTo}"></div>
      </div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="submit" class="btn-primary">Visualizar relatório</button></div>
    </form>
  `);
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
  state = { ...data, version: CURRENT_VERSION };
  demoMode = false;
  currentFileName = normalizeProfFileName(fileName);
  currentFileHandle = fileHandle || null;
  currentStorageMode = cloudMeta?.fileId ? 'drive' : (options.storageMode || (fileHandle ? 'file' : 'local'));
  currentFileLastModified = Number(options.fileLastModified) || 0;
  localProjectSaved = false;
  localProjectSavedAt = 0;
  loadDriveBindingForProject(state.projectId);
  if (cloudMeta?.fileId) saveDriveBinding({ ...cloudMeta, projectId: state.projectId });
  else if (options.driveBinding?.fileId) saveDriveBinding({ ...options.driveBinding, projectId: state.projectId });
  else if (!driveBinding && legacyDriveBindingCandidate && (!legacyDriveBindingCandidate.name || normalizeProfFileName(legacyDriveBindingCandidate.name) === currentFileName)) {
    saveDriveBinding({ ...legacyDriveBindingCandidate, projectId: state.projectId });
    clearLegacyDriveBinding();
    legacyDriveBindingCandidate = null;
  }
  cloudSyncPending = false;
  lastLocalSaveAt = Date.now();
  clearDirty();
  discardLocalRecoveryDraft();
  resetContext();
  enterWorkspace();
  navigate('dashboard');
  const warnings = Array.isArray(options.warnings) ? options.warnings : [];
  if (warnings.length) {
    isDirty = true;
    setSaveUiState('dirty');
    toast(`Arquivo aberto, mas ${warnings.length} problema(s) foram encontrados e não serão ignorados silenciosamente. Revise antes de salvar.`, 'info');
    persistLocalRecoveryDraft();
  } else {
    toast('Arquivo aberto com sucesso.', 'success');
    if (options.persistLocal !== false) {
      saveLocalProjectSnapshot({ stateData: data, storageMode: currentStorageMode, fileName: currentFileName, fileHandle: currentFileHandle, fileLastModified: currentFileLastModified }).then(async ok => {
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
      detailList: [['Projeto atual', currentFileName || 'Novo projeto'], ['Próxima ação', 'Abrir outro arquivo .prof']],
      confirmLabel: 'Continuar', danger: true, onConfirm: () => openFile(true),
    });
    return;
  }

  if (supportsNativeFilePicker()) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: profOpenPickerTypes(),
        excludeAcceptAllOption: false,
        multiple: false
      });
      if (!handle) return;

      let openError = null;
      await withAppLoading('Abrindo seu arquivo...', async () => {
        try {
          const file = await handle.getFile();
          const text = await readTextFileUtf8(file);
          const result = validateAndParseProf(text);
          if (!result.ok) {
            logError('file.open.invalid', new Error('Arquivo selecionado não passou na validação.'), {
              filename: file.name, mime: file.type || '', size: file.size, errorCode: result.error || 'invalid'
            });
            openError = { message: errorMessage(result.error), details: result.details || [] };
            return false;
          }
          applyOpenedData(result.data, file.name, null, /\.prof$/i.test(file.name) ? handle : null, {
            storageMode: 'file',
            fileLastModified: file.lastModified,
            persistLocal: true,
            warnings: result.warnings || [],
          });
          return true;
        } catch (err) {
          logError('file.open.native_failed', err, { nativePicker: true, android: isAndroidDevice() });
          openError = { message: 'Não foi possível ler o arquivo selecionado.' };
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
      const result = validateAndParseProf(text);
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

function profDownloadName(filename) {
  // Mantemos apenas ".prof" (sem sufixo extra). O fallback usa um MIME próprio
  // do formato, evitando que Android/Chrome o trate como JSON por extensão.
  return normalizeProfFileName(filename);
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

async function shareCurrentProfFile() {
  if (demoMode || !state) return false;
  const payload = buildSavePayload();
  await createAutomaticBackup('Antes de salvar');
  const json = JSON.stringify(payload, null, 2);
  const name = normalizeProfFileName(currentFileName || `professorgest-${safeFileName(state?.teacher?.name || 'professorgest')}.prof`);
  const shared = await shareFileFallback(json, name, PROF_MIME);
  if (shared) { toast('Arquivo .prof compartilhado com sucesso.', 'success'); return true; }
  toast('O compartilhamento de arquivos não está disponível neste navegador. Use Exportar cópia .prof.', 'info');
  return false;
}

async function exportCurrentProfFile() {
  if (demoMode || !state) return false;
  const payload = buildSavePayload();
    const json = JSON.stringify(payload, null, 2);
  // Verifica o conteúdo exato que será exportado antes de iniciar o download.
  try {
    const check = JSON.parse(json);
    if (!check || check.format !== PROF_FORMAT || Number(check.version) !== CURRENT_VERSION) {
      throw new Error('Não foi possível preparar a cópia do arquivo.');
    }
  } catch (err) {
    logError('file.export.prepare_failed', err);
    toast(err?.message || 'Não foi possível preparar a cópia do arquivo.', 'error');
    return false;
  }
  const teacherBase = safeFileName(state?.teacher?.name || 'professorgest');
  const suggestedName = currentFileName ? normalizeProfFileName(currentFileName) : `professorgest-${teacherBase}.prof`;

  let nativeHandleAcquired = false;
  if (supportsNativeSavePicker()) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types: profSavePickerTypes(), excludeAcceptAllOption: false });
      nativeHandleAcquired = true;
      const writable = await handle.createWritable();
      await writable.write(new Blob([json], { type: PROF_MIME }));
      await writable.close();

      const verifyFile = await handle.getFile();
      const verifyText = await readTextFileUtf8(verifyFile);
      const verifyResult = validateAndParseProf(verifyText);
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
      currentFileName = normalizeProfFileName(handle.name);
      currentStorageMode = 'file';
            currentFileLastModified = verifyFile.lastModified || 0;
      await saveLocalProjectSnapshot({ stateData: payload, storageMode: 'file', fileName: currentFileName, fileHandle: currentFileHandle, fileLastModified: currentFileLastModified });
      state = payload;
      lastLocalSaveAt = Date.now();
      clearDirty();
      updateSaveChrome();
      render();
      toast('Cópia .prof exportada com sucesso.', 'success');
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

  const fallbackMime = PROF_MIME;
    downloadFallback(json, suggestedName, fallbackMime);
  currentFileName = normalizeProfFileName(suggestedName);
  state = payload;
  currentStorageMode = currentStorageMode === 'drive' ? 'drive' : 'local';
  lastLocalSaveAt = Date.now();
  await saveLocalProjectSnapshot({ stateData: payload, storageMode: currentStorageMode, fileName: currentFileName, fileHandle: null, fileLastModified: 0 });
  clearDirty();
  updateSaveChrome();
  render();
  toast('Cópia .prof exportada. O projeto continua salvo neste dispositivo.', 'success');
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
  const saveRevision = dirtyRevision;
  const payload = buildSavePayload();
  await createAutomaticBackup('Antes de salvar');
  const json = JSON.stringify(payload, null, 2);
  const teacherBase = safeFileName(state?.teacher?.name || 'professorgest');
  const suggestedName = currentFileName ? normalizeProfFileName(currentFileName) : `professorgest-${teacherBase}.prof`;

  if (currentFileHandle && !forceOverwrite) {
    const conflict = await checkExternalFileConflict(false);
    if (conflict) {
      setSaveUiState('dirty');
      updateSaveChrome();
      return false;
    }
  }

  const afterLocalSave = async ({ storageMode = currentStorageMode, fileLastModified = currentFileLastModified } = {}) => {
    state = payload;
    lastLocalSaveAt = Date.now();
    currentStorageMode = storageMode;
    currentFileLastModified = Number(fileLastModified) || 0;
    const unchangedSinceSaveStarted = dirtyRevision === saveRevision;

    if (!unchangedSinceSaveStarted) {
      isDirty = true;
      cloudSyncPending = !!driveBindingForCurrentProject();
      setSaveUiState('dirty');
      persistLocalRecoveryDraft();
      updateSaveChrome();
      render();
      return true;
    }

    const localPersisted = await saveLocalProjectSnapshot({ stateData: payload, storageMode: currentStorageMode, fileName: currentFileName, fileHandle: currentFileHandle, fileLastModified: currentFileLastModified });
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
    if (!driveBindingForCurrentProject() || skipCloudSync) {
      cloudSyncPending = skipCloudSync ? !!driveBindingForCurrentProject() : false;
      setSaveUiState('saved');
      updateSaveChrome();
      toast(skipCloudSync && driveBindingForCurrentProject() ? 'Alterações salvas neste dispositivo. A sincronização com o Drive ficou pendente.' : (currentStorageMode === 'local' ? 'Alterações salvas neste dispositivo.' : 'Arquivo salvo com sucesso.'), 'success');
      render();
      return true;
    }
    try {
      const synced = await syncCurrentProjectToDrive({ silent: true });
      if (synced) {
        cloudSyncPending = false;
        lastCloudSyncAt = Date.now();
        setSaveUiState('synced');
        toast('Arquivo salvo e sincronizado com Google Drive.', 'success');
      } else {
        cloudSyncPending = true;
        setSaveUiState('saved');
        toast('Arquivo salvo neste dispositivo. A sincronização com o Drive ficou pendente.', 'info');
      }
    } catch (err) {
      cloudSyncPending = true;
      setSaveUiState('saved');
      toast(err.message || 'Arquivo salvo neste dispositivo, mas não foi sincronizado.', 'error');
    }
    updateSaveChrome();
    render();
    return true;
  };

  if (currentFileHandle && /\.prof$/i.test(currentFileHandle.name || '')) {
    try {
      const permission = typeof currentFileHandle.queryPermission === 'function'
        ? await currentFileHandle.queryPermission({ mode: 'readwrite' })
        : 'granted';
      if (permission !== 'granted' && typeof currentFileHandle.requestPermission === 'function') {
        const requested = await currentFileHandle.requestPermission({ mode: 'readwrite' });
        if (requested !== 'granted') throw new DOMException('Permissão para salvar o arquivo foi negada.', 'NotAllowedError');
      }
      setSaveUiState('saving'); updateSaveChrome();
      const writable = await currentFileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      // Mesma verificação pós-gravação do export: evita confiar num arquivo
      // que "salvou sem erro" mas ficou vazio/truncado no disco.
      const verifyFile = await currentFileHandle.getFile();
      const verifyText = await readTextFileUtf8(verifyFile);
      if (!validateAndParseProf(verifyText).ok) {
        throw new Error('O arquivo foi salvo, mas o conteúdo gravado não pôde ser confirmado como válido.');
      }
      currentFileName = normalizeProfFileName(currentFileHandle.name);
      const fileLastModified = verifyFile.lastModified || Date.now();
      return await afterLocalSave({ storageMode: 'file', fileLastModified });
    } catch (err) {
      logError('file.save.native_failed', err, { filename: currentFileName || suggestedName, android: isAndroidDevice() });
      currentFileHandle = null;
      currentStorageMode = 'local';
      if (err && err.name === 'AbortError') { setSaveUiState('dirty'); updateSaveChrome(); return false; }
      if (err && err.name !== 'NotAllowedError') {
        toast('Não foi possível atualizar o arquivo original. As alterações continuarão protegidas neste dispositivo.', 'error');
      } else {
        toast('Permissão para atualizar o arquivo negada. As alterações ficarão salvas neste dispositivo.', 'error');
      }
      return await afterLocalSave({ storageMode: 'local', fileLastModified: currentFileLastModified });
    }
  }

  // Sem File System Access API (comum em navegadores móveis):
  // Salvar = persistir o projeto no armazenamento interno. Não fingimos que o .prof externo foi atualizado.
  currentStorageMode = 'local';
  currentFileHandle = null;
  if (!currentFileName) currentFileName = normalizeProfFileName(suggestedName);
  return await afterLocalSave({ storageMode: 'local', fileLastModified: currentFileLastModified });
}

/* ==================== ARQUIVO / CONFIGURAÇÕES ==================== */



/* ==================== MODAIS: formulários ==================== */

function classOptions(selectedId) {
  return state.classes.map(c => `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function openClassModal(existing) {
  openModal(`
    <div class="modal-title">${existing ? 'Editar turma' : 'Nova turma'}</div>
    <form id="classForm">
      <div class="form-group"><label class="form-label" for="classNameInput">Nome da turma</label>
        <input class="form-input" id="classNameInput" name="name" required value="${existing ? esc(existing.name) : ''}" placeholder="Ex: 2º Ano A"></div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button>
        <button type="submit" class="btn-primary">${existing ? 'Salvar' : 'Criar turma'}</button></div>
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
  openModal(`
    <div class="modal-title">${existing ? 'Editar atividade' : 'Nova atividade'}</div>
    <form id="activityForm">
      <div class="form-group"><label class="form-label" for="activityNameInput">Nome da atividade</label>
        <input class="form-input" id="activityNameInput" name="name" required value="${existing ? esc(existing.name) : ''}" placeholder="Ex: Lista de exercícios"></div>
      <div class="form-group"><label class="form-label" for="studentClassInput">Turma</label><select class="form-select" id="studentClassInput" name="classId">${classOptions(existing ? existing.classId : (presetClassId || ctx.classId))}</select></div>
      <div class="form-group"><label class="form-label" for="activityDueDateInput">Data de entrega</label><input class="form-input" id="activityDueDateInput" type="date" name="dueDate" required value="${existing ? existing.dueDate : todayISO()}"></div>
      <div class="form-group"><label class="form-label" for="activityDescriptionInput">Descrição</label><textarea class="form-textarea" id="activityDescriptionInput" name="description" placeholder="Opcional">${existing ? esc(existing.description || '') : ''}</textarea></div>
      ${existing ? '<p class="form-hint">As marcações de entrega já registradas serão mantidas.</p>' : ''}
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button>
        <button type="submit" class="btn-primary">${existing ? 'Salvar alterações' : 'Criar atividade'}</button></div>
    </form>
  `);
  document.getElementById('activityForm').dataset.editId = existing ? existing.id : '';
}

function openPlanningModal(existing, presetClassId = '') {
  openModal(`
    <div class="modal-title">${existing ? 'Editar planejamento' : 'Novo planejamento'}</div>
    <form id="planningForm">
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="planningDateInput">Data da aula</label><input class="form-input" id="planningDateInput" type="date" name="date" required value="${existing ? existing.date : todayISO()}"></div>
        <div class="form-group"><label class="form-label" for="planningClassInput">Turma</label><select class="form-select" id="planningClassInput" name="classId" required>${classOptions(existing ? existing.classId : (presetClassId || ctx.classId || ''))}</select></div>
      </div>
      <div class="form-group"><label class="form-label" for="planningTitleInput">Tema da aula</label><input class="form-input" id="planningTitleInput" name="title" required value="${existing ? esc(existing.title) : ''}" placeholder="Ex.: Frações equivalentes"></div>
      <div class="form-group"><label class="form-label" for="planningContentInput">Conteúdo</label><textarea class="form-textarea" id="planningContentInput" name="content" placeholder="O que será trabalhado nesta aula?">${existing ? esc(existing.content || '') : ''}</textarea></div>
      <div class="form-group"><label class="form-label" for="planningObjectivesInput">Objetivos de aprendizagem</label><textarea class="form-textarea" id="planningObjectivesInput" name="objectives" placeholder="O que os alunos deverão compreender ou conseguir fazer?">${existing ? esc(existing.objectives || '') : ''}</textarea></div>
      <div class="form-group"><label class="form-label" for="planningMethodologyInput">Como será a aula?</label><textarea class="form-textarea" id="planningMethodologyInput" name="methodology" placeholder="Ex.: explicação, atividade em grupo, exercícios...">${existing ? esc(existing.methodology || '') : ''}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="planningResourcesInput">Recursos</label><textarea class="form-textarea" id="planningResourcesInput" name="resources" placeholder="Livro, quadro, projetor...">${existing ? esc(existing.resources || '') : ''}</textarea></div>
        <div class="form-group"><label class="form-label" for="planningAssessmentInput">Acompanhamento / avaliação</label><textarea class="form-textarea" id="planningAssessmentInput" name="assessment" placeholder="Como você pretende observar a aprendizagem?">${existing ? esc(existing.assessment || '') : ''}</textarea></div>
      </div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="submit" class="btn-primary">${existing ? 'Salvar planejamento' : 'Criar planejamento'}</button></div>
    </form>
  `, true);
  document.getElementById('planningForm').dataset.editId = existing ? existing.id : '';
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

function openOccurrenceStep1(searchTerm, presetClassId = '') {
  const term = (searchTerm || '').trim().toLowerCase();
  let list = presetClassId ? studentsOf(presetClassId) : state.students;
  if (term) list = list.filter(s => s.name.toLowerCase().includes(term));
  openModal(`
    <div class="modal-title">Registrar ocorrência</div>
    <div class="form-group"><label class="form-label" for="quickSearchInput">Quem?</label>
      <input class="form-input input-search" id="quickSearchInput" placeholder="Pesquisar aluno..." value="${esc(searchTerm || '')}"></div>
    <div class="list-card" id="quickStudentList" style="max-height:280px;overflow-y:auto;">
      ${list.map(s => `<div class="list-item"><div class="list-item-main" data-pick-student="${esc(s.id)}" role="button" tabindex="0">
        <div class="list-item-title">${esc(s.name)}</div><div class="list-item-sub">${esc(classNameOf(s.classId))}</div></div></div>`).join('') || emptyState('Nenhum aluno encontrado.')}
    </div>
    <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button></div>
  `);
  const input = document.getElementById('quickSearchInput');
  input.oninput = () => rerenderModalKeepFocus(() => openOccurrenceStep1(input.value, presetClassId));
}

function openOccurrenceStep2(studentIds, editingOcc) {
  const students = studentIds.map(studentById).filter(Boolean);
  if (!students.length) { openOccurrenceStep1(''); return; }
  const opts = OCCUR_TYPES.map(t => `<button type="button" class="quick-opt ${editingOcc && editingOcc.type === t.key ? 'selected' : ''}" data-occ-type="${esc(t.key)}">${t.emoji} ${t.label}</button>`).join('');
  const multi = students.length > 1;
  openModal(`
    <div class="modal-title">${editingOcc ? 'Editar ocorrência' : 'O que aconteceu?'}</div>
    <div class="list-item-sub" style="margin-bottom:12px;">
      ${multi ? `Alunos selecionados: <strong>${students.length}</strong>` : `Aluno: <strong>${esc(students[0].name)}</strong>`}
      ${(editingOcc || multi) ? '' : `<button type="button" class="btn-icon" id="changeStudentBtn" style="margin-left:6px;">trocar aluno</button>`}
    </div>
    <form id="occurForm">
      <input type="hidden" name="studentIds" value="${studentIds.join(',')}">
      <div class="form-group"><div class="quick-options" id="occTypeOptions">${opts}</div>
        <input type="hidden" name="type" value="${editingOcc ? editingOcc.type : ''}" required></div>
      <div class="form-group"><label class="form-label" for="observationDateInput">Data</label><input class="form-input" id="observationDateInput" type="date" name="date" value="${editingOcc ? editingOcc.date : todayISO()}"></div>
      <div class="form-group"><label class="form-label" for="occurrenceDescriptionInput">Descrição (opcional)</label><textarea class="form-textarea" id="occurrenceDescriptionInput" name="description" placeholder="Detalhes...">${editingOcc ? esc(editingOcc.description || '') : ''}</textarea></div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button>
        <button type="submit" class="btn-primary">${editingOcc ? 'Salvar alterações' : (multi ? 'Registrar para todos' : 'Registrar')}</button></div>
    </form>
  `);
  document.getElementById('occurForm').dataset.editId = editingOcc ? editingOcc.id : '';
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
    const editId = classForm.dataset.editId;
    if (editId) { classById(editId).name = name; toast('Turma salva com sucesso.', 'success'); }
    else { state.classes.push({ id: uid('class'), name, archived: false }); toast('Turma criada com sucesso.', 'success'); }
    markDirty(); closeModal(); render();
  };

  const studentForm = document.getElementById('studentForm');
  if (studentForm) studentForm.onsubmit = e => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const classId = e.target.classId.value;
    const editId = studentForm.dataset.editId;
    if (editId) { const s = studentById(editId); s.name = name; s.classId = classId; toast('Aluno salvo com sucesso.', 'success'); }
    else { state.students.push({ id: uid('stu'), name, classId, notes: '', observations: [] }); toast('Aluno adicionado com sucesso.', 'success'); }
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
      if (student && student.classId !== classId) { student.classId = classId; moved++; }
    });
    if (!moved) { toast('Nenhum aluno precisou ser movido.', 'info'); closeModal(); return; }
    markDirty(); closeModal();
    ctx.bulkMode = false; ctx.bulkSelected = new Set();
    toast(`${moved} aluno(s) movido(s) para ${targetClass.name}. O histórico foi mantido.`, 'success');
    render();
  };

  const activityForm = document.getElementById('activityForm');
  if (activityForm) activityForm.onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    const editId = activityForm.dataset.editId;
    if (editId) {
      const a = state.activities.find(x => x.id === editId);
      a.name = f.name.value.trim(); a.classId = f.classId.value; a.dueDate = f.dueDate.value; a.description = f.description.value.trim();
      toast('Atividade salva com sucesso.', 'success');
    } else {
      state.activities.push({ id: uid('act'), name: f.name.value.trim(), classId: f.classId.value, dueDate: f.dueDate.value, description: f.description.value.trim(), completions: {} });
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
      date: f.date.value, classId: f.classId.value, title,
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
      o.date = f.date.value || todayISO(); o.type = f.type.value; o.description = f.description.value.trim();
      toast('Ocorrência atualizada com sucesso.', 'success');
    } else {
      const ids = f.studentIds.value.split(',').filter(Boolean);
      ids.forEach(sid => state.occurrences.push({ id: uid('occ'), studentId: sid, date: f.date.value || todayISO(), type: f.type.value, description: f.description.value.trim() }));
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
      resumo: f.opt_resumo.checked, atividades: f.opt_atividades.checked, entregas: f.opt_entregas.checked,
      naoEntregas: f.opt_naoEntregas.checked, ocorrencias: f.opt_ocorrencias.checked,
      observacoes: f.opt_observacoes.checked, linha: f.opt_linha.checked
    };
    if (changedStudent) ctx.reportSynthesis = '';
    closeModal(); currentView = 'relatorioIndividual';
    qAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === 'relatorios'));
    render();
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
    closeModal(); currentView = 'relatorioTurma';
    qAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === 'relatorios'));
    render();
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
    { icon: 'calendar', label: 'Novo planejamento', run: () => openPlanningModal(null, '') },
    { icon: 'folder', label: 'Abrir arquivo', run: () => openFile() },
    { icon: 'file', label: 'Criar novo arquivo', run: () => beginNewProjectSetup(true) },
    { icon: 'sparkle', label: 'Explorar demonstração', run: () => beginDemoMode() },
    { icon: 'save', label: 'Salvar arquivo', run: () => saveFile() },
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
        <div class="cmdk-input-row">${ICONS.search}<input class="cmdk-input" id="cmdkInput" placeholder="Buscar alunos, turmas, atividades, planejamentos ou ações..." value="${esc(term || '')}"><span class="cmdk-esc">ESC</span></div>
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

  qAll('[data-open-class]').forEach(el => el.onclick = () => { ctx.classId = el.dataset.openClass; ctx.classTab = 'visao'; navigate('turmaDetail', false); });
  qAll('[data-open-student]').forEach(el => el.onclick = () => { ctx.studentId = el.dataset.openStudent; ctx.studentTab = 'visao'; ctx.histFilter = 'todos'; ctx.histMonth = ''; navigate('alunoDetail', false); });
  qAll('[data-open-activity]').forEach(el => el.onclick = () => { ctx.activityId = el.dataset.openActivity; navigate('atividadeDetail', false); });
  qAll('[data-view-plan]').forEach(el => el.onclick = e => { e.stopPropagation(); const plan = (state.plans || []).find(item => item.id === el.dataset.viewPlan); openPlanningViewModal(plan); });

  qAll('[data-attention-idx]').forEach(el => el.onclick = () => { const it = lastAttentionItems[Number(el.dataset.attentionIdx)]; if (it) it.action(); });

  const back = q('#btnBack');
  if (back) back.onclick = () => {
    const map = { turmaDetail: 'turmas', alunoDetail: 'alunos', atividadeDetail: 'atividades', relatorioIndividual: 'relatorios', relatorioTurma: 'relatorios' };
    navigate(map[currentView] || 'dashboard');
  };

  onClick('#btnEmptyNewClass', () => openClassModal(null));
  onClick('#btnEmptyNewStudent', () => openStudentModal(null));
  onClick('#btnQuickRegisterTop', () => openOccurrenceModal());
  onClick('#btnQuickRegisterOcc', () => openOccurrenceModal());

  /* --- turmas --- */
  onClick('#btnNewClass', () => openClassModal(null));
  onClick('#btnToggleArchivedClasses', () => { ctx.showArchivedClasses = !ctx.showArchivedClasses; render(); });
  const classSearchInput = q('#classSearchInput');
  if (classSearchInput) classSearchInput.oninput = () => { ctx.classSearch = classSearchInput.value; rerenderKeepFocus(); };
  qAll('[data-edit-class]').forEach(el => el.onclick = e => { e.stopPropagation(); openClassModal(classById(el.dataset.editClass)); });
  qAll('[data-dup-class]').forEach(el => el.onclick = e => { e.stopPropagation(); duplicateClass(el.dataset.dupClass); });
  qAll('[data-archive-class]').forEach(el => el.onclick = e => { e.stopPropagation(); toggleArchiveClass(el.dataset.archiveClass); });
  qAll('[data-del-class]').forEach(el => el.onclick = e => { e.stopPropagation(); deleteClass(el.dataset.delClass); });
  onClick('#btnEditThisClass', () => openClassModal(classById(ctx.classId)));
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
    if (currentView === 'alunos') return;
    if (el.checked) ctx.bulkSelected.add(el.dataset.bulkStudent); else ctx.bulkSelected.delete(el.dataset.bulkStudent);
    render();
  });
  onClick('#btnBulkSelectAll', () => {
    const ids = currentView === 'atividadeDetail' ? studentsOf(state.activities.find(a => a.id === ctx.activityId).classId).map(s => s.id) : studentsOf(ctx.classId).map(s => s.id);
    ctx.bulkSelected = new Set(ids); render();
  });
  onClick('#btnBulkMoveStudents', () => {
    if (!ctx.bulkSelected.size) { toast('Selecione ao menos um aluno.', 'error'); return; }
    openMoveStudentModal([...ctx.bulkSelected]);
  });
  onClick('#btnBulkOccurrence', () => {
    if (!ctx.bulkSelected.size) { toast('Selecione ao menos um aluno.', 'error'); return; }
    openOccurrenceStep2([...ctx.bulkSelected], null);
  });
  qAll('[data-bulk-set]').forEach(el => el.onclick = () => {
    const a = state.activities.find(x => x.id === ctx.activityId);
    if (!ctx.bulkSelected.size) { toast('Selecione ao menos um aluno.', 'error'); return; }
    ctx.bulkSelected.forEach(sid => { a.completions[sid] = el.dataset.bulkSet; });
    markDirty(); toast(`Entrega atualizada para ${ctx.bulkSelected.size} aluno(s).`, 'success');
    ctx.bulkMode = false; ctx.bulkSelected = new Set(); render();
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
  const studentSituacaoSelect = q('#studentSituacaoSelect');
  if (studentSituacaoSelect) studentSituacaoSelect.onchange = () => { ctx.studentSituacao = studentSituacaoSelect.value; render(); };
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
    confirmModal({ title: 'Excluir atividade', body: 'As marcações de entrega desta atividade também serão perdidas.', confirmLabel: 'Excluir', danger: true, onConfirm: () => {
      state.activities = state.activities.filter(a => a.id !== el.dataset.delActivity);
      markDirty(); toast('Atividade excluída.', 'success');
      if (ctx.activityId === el.dataset.delActivity) navigate('atividades'); else render();
    }});
  });
  qAll('[data-cycle-delivery]').forEach(el => el.onclick = () => {
    const a = state.activities.find(x => x.id === ctx.activityId);
    const sid = el.dataset.cycleDelivery;
    const current = getDeliveryState(a, sid);
    a.completions[sid] = current === 'pending' ? 'delivered' : current === 'delivered' ? 'not_delivered' : 'pending';
    markDirty(); render();
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
  onClick('#btnOpenFile', () => openFile());
  onClick('#btnSaveFile', () => saveFile());
  onClick('#btnOpenBackups', () => openBackupsModal());
  onClick('#btnExportProf', () => exportCurrentProfFile());
  onClick('#btnShareProf', () => shareCurrentProfFile());
  onClick('#btnDriveOpen', openDrivePicker);
  onClick('#btnDriveAction', saveCurrentToGoogleDrive);
  onClick('#btnDriveDisconnect', disconnectCurrentDriveFile);
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
    state.teacher.school = document.getElementById('teacherSchoolInput')?.value.trim() || '';
    state.teacher.subject = document.getElementById('teacherSubjectInput')?.value.trim() || '';
    markDirty(); toast('Perfil atualizado.', 'success'); render();
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
  const relStudents = state.students.filter(s => s.classId === classId);
  const relActivities = state.activities.filter(a => a.classId === classId);
  const relStudentIds = new Set(relStudents.map(s => s.id));
  const relOccurrences = state.occurrences.filter(o => relStudentIds.has(o.studentId));

  confirmModal({
    title: `Excluir turma "${cls.name}"?`,
    body: 'Os alunos, atividades e ocorrências relacionadas também serão excluídos para não deixar registros soltos. Esta ação não pode ser desfeita.',
    detailList: [['Alunos', relStudents.length], ['Atividades', relActivities.length], ['Ocorrências', relOccurrences.length]],
    confirmLabel: 'Excluir turma', danger: true,
    onConfirm: () => {
      state.classes = state.classes.filter(c => c.id !== classId);
      state.students = state.students.filter(s => s.classId !== classId);
      state.activities = state.activities.filter(a => a.classId !== classId);
      state.occurrences = state.occurrences.filter(o => !relStudentIds.has(o.studentId));
      markDirty(); toast('Turma excluída.', 'success');
      if (ctx.classId === classId) navigate('turmas'); else render();
    },
  });
}

function duplicateClass(classId) {
  const cls = classById(classId);
  if (!cls) return;
  const newClass = { id: uid('class'), name: cls.name + ' (cópia)', archived: false };
  state.classes.push(newClass);
  studentsOf(classId).forEach(s => {
    const ns = { id: uid('stu'), name: s.name, classId: newClass.id, notes: '', observations: [] };
    state.students.push(ns);
  });
  markDirty(); toast(`Turma duplicada como "${newClass.name}".`, 'success'); render();
}

function toggleArchiveClass(classId) {
  const cls = classById(classId);
  if (!cls) return;
  cls.archived = !cls.archived;
  markDirty(); toast(cls.archived ? 'Turma arquivada.' : 'Turma reativada.', 'success'); render();
}

function deleteStudent(studentId) {
  const s = studentById(studentId);
  if (!s) return;
  const relOcc = occurrencesOf(studentId).length;
  confirmModal({
    title: `Excluir "${s.name}"?`,
    body: 'O aluno e todos os seus registros (ocorrências e observações) serão excluídos permanentemente.',
    detailList: [['Ocorrências', relOcc]],
    confirmLabel: 'Excluir aluno', danger: true,
    onConfirm: () => {
      state.students = state.students.filter(x => x.id !== studentId);
      state.occurrences = state.occurrences.filter(o => o.studentId !== studentId);
      state.activities.forEach(a => { delete a.completions[studentId]; });
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

function parseCSVLine(line) { return parseCSV(line)[0] || []; }

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
      state.students.push({ id: uid('stu'), name: name.slice(0, 500), classId: cls?.id || null, notes: '', observations: [] });
      added++;
    });
    if (dataRows.length > MAX_STUDENTS) skipped += dataRows.length - MAX_STUDENTS;
    if (!added) { toast('Nenhum aluno válido foi encontrado no CSV.', 'error'); return; }
    markDirty();
    toast(`${added} aluno(s) importado(s) do CSV.${createdClasses ? ` ${createdClasses} turma(s) criada(s).` : ''}${skipped ? ` ${skipped} linha(s) ignorada(s).` : ''}`, 'success');
    render();
  };
  reader.onerror = () => toast('Não foi possível ler o arquivo CSV.', 'error');
  reader.readAsText(file, 'utf-8');
}

/* ==================== arquivo .prof: abrir, validar, salvar ==================== */

function buildSavePayload() {
  return {
    format: PROF_FORMAT,
    version: CURRENT_VERSION,
    projectId: state.projectId || createProjectId(),
    createdAt: state.createdAt || todayISO(),
    updatedAt: new Date().toISOString(),
    teacher: state.teacher,
    classes: state.classes,
    students: state.students,
    activities: state.activities,
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
    { id: act1, name: 'Lista de exercícios — Frações', classId: c1, dueDate: addDays(3), description: 'Exercícios 1 a 10 do livro.', completions: { [s[0].id]: 'delivered', [s[1].id]: 'not_delivered' } },
    { id: act2, name: 'Redação — Meio ambiente', classId: c2, dueDate: addDays(-2), description: 'Texto dissertativo, mínimo 20 linhas.', completions: { [s[3].id]: 'delivered', [s[4].id]: 'delivered' } },
    { id: act3, name: 'Prova — Sistemas do corpo humano', classId: c1, dueDate: addDays(-6), description: '', completions: { [s[0].id]: 'delivered', [s[1].id]: 'not_delivered', [s[2].id]: 'not_delivered' } },
  ];
  const occurrences = [
    { id: uid('occ'), studentId: s[0].id, date: addDays(-4), type: 'participou', description: '' },
    { id: uid('occ'), studentId: s[1].id, date: addDays(-8), type: 'conversou', description: 'Conversou bastante durante a explicação.' },
    { id: uid('occ'), studentId: s[1].id, date: addDays(-1), type: 'nao_atividade', description: '' },
    { id: uid('occ'), studentId: s[1].id, date: addDays(-15), type: 'nao_entregou', description: '' },
    { id: uid('occ'), studentId: s[3].id, date: addDays(-6), type: 'bom_comportamento', description: '' },
    { id: uid('occ'), studentId: s[4].id, date: addDays(-2), type: 'faltou', description: '' },
  ];
  return {
    format: PROF_FORMAT, version: CURRENT_VERSION, projectId: createProjectId(),
    createdAt: todayISO(), updatedAt: todayISO(),
    teacher: { name: 'Mariana Alves', school: 'Colégio Horizonte', subject: 'Língua Portuguesa' },
    classes: [{ id: c1, name: '1º Ano A', archived: false }, { id: c2, name: '2º Ano A', archived: false }],
    students: s, activities, occurrences,
    plans: [
      { id: uid('plan'), classId: c1, date: addDays(1), title: 'Leitura e interpretação de texto', content: 'Leitura compartilhada de uma crônica curta.', objectives: 'Identificar ideia principal e informações explícitas.', methodology: 'Leitura em duplas seguida de conversa coletiva.', resources: 'Livro e quadro.', assessment: 'Perguntas de compreensão e participação.' },
      { id: uid('plan'), classId: c2, date: addDays(2), title: 'Produção de texto', content: 'Planejamento e escrita de um pequeno texto.', objectives: 'Organizar ideias antes da escrita.', methodology: 'Roteiro no quadro e produção individual.', resources: 'Caderno e quadro.', assessment: 'Revisão inicial do texto.' },
    ],
  };
}