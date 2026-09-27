/* ==================== ProfessorGest v2 ====================
   HTML + CSS + JS puro, sem backend. Dados em memória, salvos/abertos
   através de um arquivo .prof (JSON por dentro). Compatível com arquivos
   .prof criados pela versão 1 do MVP (migração automática v1 -> v2).
================================================================= */

const PROF_FORMAT = 'professorgest';
const CURRENT_VERSION = 2;
const SUPPORTED_VERSIONS = [1, 2];

const APP_BUILD = '2026.09.27.8';
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
  const filename = `professorgest-dev-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
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
let drivePickerReady = false;
let driveBinding = null;
let setupOrigin = 'welcome';
let currentView = 'dashboard';
let lastAttentionItems = [];
let localDraftSaveTimer = null;
let cloudAutoSyncTimer = null;
let recoveryDraftTimestamp = null;
let saveUiState = 'idle';
let deferredInstallPrompt = null;
let lastLocalSaveAt = 0;
let lastCloudSyncAt = 0;
let cloudSyncPending = false;
let dirtyRevision = 0;
const LOCAL_RECOVERY_KEY = 'professorgest-recovery-draft-v1';
const LOCAL_DB_NAME = 'professorgest-local-v2';
const LOCAL_DB_VERSION = 1;
const LOCAL_PROJECT_STORE = 'projects';
const LOCAL_PROJECT_KEY = 'active';
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
  { label: 'Visão geral', items: [
    { key: 'dashboard', label: 'Dashboard', icon: 'home' },
  ]},
  { label: 'Acadêmico', items: [
    { key: 'turmas', label: 'Turmas', icon: 'users' },
    { key: 'alunos', label: 'Alunos', icon: 'user' },
    { key: 'atividades', label: 'Atividades', icon: 'clipboard' },
    { key: 'calendario', label: 'Calendário', icon: 'calendar' },
  ]},
  { label: 'Registros', items: [
    { key: 'ocorrencias', label: 'Ocorrências', icon: 'bell' },
    { key: 'relatorios', label: 'Relatórios', icon: 'report' },
  ]},
  { label: 'Sistema', items: [
    { key: 'arquivo', label: 'Arquivo', icon: 'folder' },
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
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V3h12v6M6 18H4a1 1 0 01-1-1v-5a1 1 0 011-1h16a1 1 0 011 1v5a1 1 0 01-1 1h-2M6 14h12v7H6z"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5M9 15v-3h1.5a1 1 0 010 2H9M13 12v3h1.2a1.4 1.4 0 000-3H13M17 12v3M17 13.3h1.4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 12l5 5L20 6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2.5 17a1.6 1.6 0 001.4 2.4h16.2a1.6 1.6 0 001.4-2.4L13.7 3.9a1.6 1.6 0 00-2.8 0z"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>',
};

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

function openLocalProjectDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB não está disponível neste navegador.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_PROJECT_STORE)) db.createObjectStore(LOCAL_PROJECT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
  });
}

async function writeLocalProjectRecord(record) {
  const db = await openLocalProjectDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_PROJECT_STORE, 'readwrite');
    tx.objectStore(LOCAL_PROJECT_STORE).put(record, LOCAL_PROJECT_KEY);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('Não foi possível salvar o projeto neste dispositivo.')); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Não foi possível salvar o projeto neste dispositivo.')); };
  });
}

async function readLocalProjectRecord() {
  try {
    const db = await openLocalProjectDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(LOCAL_PROJECT_STORE, 'readonly');
      const request = tx.objectStore(LOCAL_PROJECT_STORE).get(LOCAL_PROJECT_KEY);
      request.onsuccess = () => { const value = request.result || null; db.close(); resolve(value); };
      request.onerror = () => { db.close(); resolve(null); };
    });
  } catch (_) {
    return null;
  }
}

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

async function restorePersistedProject() {
  const record = await readLocalProjectRecord();
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
    warnings: [],
  });
  return true;
}

function forgetPersistedProjectOnNewSession() {
  localProjectSaved = false;
  localProjectSavedAt = 0;
}

function markDirty() {
  dirtyRevision += 1;
  isDirty = true;
  saveUiState = 'dirty';
  if (driveBindingForCurrentProject()) cloudSyncPending = true;
  scheduleLocalRecoveryDraft();
  scheduleCloudAutoSync();
  updateSaveChrome();
}

function clearDirty({ discardRecovery = true, expectedRevision = null } = {}) {
  if (expectedRevision !== null && dirtyRevision !== expectedRevision) {
    isDirty = true;
    saveUiState = 'dirty';
    updateSaveChrome();
    return false;
  }
  isDirty = false;
  saveUiState = 'saved';
  if (discardRecovery) discardLocalRecoveryDraft();
  updateSaveChrome();
  return true;
}

function buildRecoveryRecord() {
  if (!state || demoMode || !workspaceReady) return null;
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    currentFileName: currentFileName || null,
    driveBinding: driveBindingForCurrentProject() || null,
    state: buildSavePayload(),
  };
}

function persistLocalRecoveryDraft() {
  if (!state || demoMode || !workspaceReady || !isDirty) return false;
  try {
    const record = buildRecoveryRecord();
    localStorage.setItem(LOCAL_RECOVERY_KEY, JSON.stringify(record));
    recoveryDraftTimestamp = record.savedAt;
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

function discardLocalRecoveryDraft() {
  clearTimeout(localDraftSaveTimer);
  recoveryDraftTimestamp = null;
  try { localStorage.removeItem(LOCAL_RECOVERY_KEY); } catch (_) {}
  renderWelcomeRecovery();
}

function readLocalRecoveryDraft() {
  try {
    const raw = localStorage.getItem(LOCAL_RECOVERY_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (!record?.state || record.state.format !== PROF_FORMAT) return null;
    recoveryDraftTimestamp = record.savedAt || null;
    return record;
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
    state = record.state;
    demoMode = false;
    workspaceReady = true;
    currentFileName = record.currentFileName || null;
    currentFileHandle = null;
    currentStorageMode = 'local';
    currentFileLastModified = 0;
    localProjectSaved = false;
    localProjectSavedAt = 0;
    if (record.driveBinding?.fileId) saveDriveBinding(record.driveBinding); else clearDriveBinding();
    isDirty = true;
    saveUiState = 'dirty';
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
      saveUiState = 'syncing';
      updateSaveChrome();
      const synced = await syncCurrentProjectToDrive({ silent: true, skipTokenRefresh: true });
      if (synced) {
        lastCloudSyncAt = Date.now();
        lastLocalSaveAt = Date.now();
        if (dirtyRevision === syncRevision) {
          cloudSyncPending = false;
          clearDirty({ expectedRevision: syncRevision });
          saveUiState = 'synced';
        } else {
          cloudSyncPending = true;
          isDirty = true;
          saveUiState = 'dirty';
          scheduleCloudAutoSync();
        }
      }
      updateSaveChrome();
    } catch (err) {
      saveUiState = 'dirty';
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
    label = 'Salvo neste dispositivo · exporte o .prof para compartilhar'; cls = 'saved';
  } else if (currentFileName) {
    label = lastLocalSaveAt ? 'Salvo neste dispositivo' : 'Salvo'; cls = 'saved';
  }

  if (status) {
    status.innerHTML = `<span class="save-chip ${cls}"><span class="save-chip-dot"></span><span>${label}</span></span>`;
    status.title = label;
  }
  if (action) {
    const needsPrimaryAction = isDirty || !localProjectSaved || (!currentFileName && currentStorageMode !== 'local') || cloudSyncPending;
    action.innerHTML = `<button type="button" class="topbar-save-button ${needsPrimaryAction ? 'needs-save' : ''}" id="topbarSaveBtn" ${disabled ? 'disabled' : ''}>${ICONS.save}<span>${buttonLabel}</span></button>`;
    const btn = document.getElementById('topbarSaveBtn');
    if (btn) btn.onclick = savePrimaryAction;
  }
}

async function savePrimaryAction() {
  if (demoMode || !workspaceReady || !state) return;
  saveUiState = 'saving';
  updateSaveChrome();
  try {
    if (driveBindingForCurrentProject() && !currentFileHandle) {
      await saveCurrentToGoogleDrive({ fromPrimarySave: true });
    } else {
      await saveFile({ fromPrimarySave: true });
    }
  } catch (err) {
    saveUiState = 'dirty';
    updateSaveChrome();
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
    if (title) title.textContent = 'Seu espaço de trabalho.';
    if (lead) lead.textContent = 'Escolha como começar.';
    openFile.querySelector('.welcome-card-copy strong')?.replaceChildren(document.createTextNode('Abrir arquivo'));
  }
}

function renderWelcomeRecovery() {
  const root = document.querySelector('.welcome-drive-action');
  if (!root) return;
  updateWelcomeExperience(!!readLocalRecoveryDraft());
  document.getElementById('welcomeRecovery')?.remove();
  document.getElementById('welcomeLocalProject')?.remove();

  const record = readLocalRecoveryDraft();
  if (record) {
    const name = esc(record.currentFileName || 'Projeto sem nome');
    const time = esc(formatRecoveryTime(record.savedAt));
    const el = document.createElement('div');
    el.id = 'welcomeRecovery';
    el.className = 'welcome-recovery';
    el.innerHTML = `<div class="welcome-recovery-copy"><span class="welcome-recovery-dot"></span><div><strong>Encontramos seu trabalho recente.</strong><span>${name} · última cópia ${time}</span></div></div><div class="welcome-recovery-actions"><button type="button" class="btn-secondary btn-sm" id="welcomeDiscardRecovery">Descartar</button><button type="button" class="btn-primary btn-sm" id="welcomeRecover">Continuar de onde parou</button></div>`;
    root.insertAdjacentElement('afterend', el);
    document.getElementById('welcomeRecover')?.addEventListener('click', recoverLocalDraft);
    document.getElementById('welcomeDiscardRecovery')?.addEventListener('click', () => { discardLocalRecoveryDraft(); toast('Cópia local descartada.', 'info'); });
  }

  readLocalProjectRecord().then(localRecord => {
    if (localRecord?.state) updateWelcomeExperience(true);
    if (!localRecord?.state || document.getElementById('welcomeLocalProject')) return;
    const name = esc(localRecord.currentFileName || 'Projeto local');
    const time = esc(formatRecoveryTime(localRecord.savedAt));
    const el = document.createElement('div');
    el.id = 'welcomeLocalProject';
    el.className = 'welcome-recovery';
    el.innerHTML = `<div class="welcome-recovery-copy"><span class="welcome-recovery-dot"></span><div><strong>Projeto salvo neste dispositivo.</strong><span>${name} · último salvamento ${time}</span></div></div><div class="welcome-recovery-actions"><button type="button" class="btn-primary btn-sm" id="welcomeOpenLocalProject">Abrir projeto</button></div>`;
    root.insertAdjacentElement('afterend', el);
    document.getElementById('welcomeOpenLocalProject')?.addEventListener('click', async () => {
      const opened = await restorePersistedProject();
      if (!opened) toast('Não foi possível abrir o projeto salvo neste dispositivo.', 'error');
    });
  }).catch(() => {});
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
  try {
    const raw = localStorage.getItem('professorgest-drive-binding');
    driveBinding = raw ? JSON.parse(raw) : null;
  } catch (_) { driveBinding = null; }
  return driveBinding;
}

function saveDriveBinding(binding) {
  driveBinding = binding || null;
  try {
    if (driveBinding) localStorage.setItem('professorgest-drive-binding', JSON.stringify(driveBinding));
    else localStorage.removeItem('professorgest-drive-binding');
  } catch (_) {}
}

function clearDriveBinding() { saveDriveBinding(null); }

function driveStatusText() {
  if (!isGoogleDriveConfigured()) return 'Integração não configurada';
  if (!driveBinding) return 'Google Drive disponível';
  if (isDirty) return 'Alterações locais pendentes';
  return 'Sincronizado com Google Drive';
}

function driveStatusTone() {
  if (!isGoogleDriveConfigured()) return 'neutral';
  if (!driveBinding) return 'neutral';
  if (isDirty) return 'dirty';
  return 'saved';
}

function driveBindingForCurrentProject() {
  if (!driveBinding || !driveBinding.fileId) return null;
  if (!currentFileName || (driveBinding.name && driveBinding.name !== currentFileName)) return null;
  return driveBinding;
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

  driveTokenPromise = (async () => {
    await waitForGoogleIdentity();
    if (!initDriveTokenClient()) throw new Error('Google Identity Services não está pronto. Recarregue a página e tente novamente.');
    return await new Promise((resolve, reject) => {
      driveTokenClient.callback = (response) => {
        if (!response || response.error) {
          const detail = response?.error_description || response?.error || 'Não foi possível autorizar o Google Drive.';
          reject(new Error(detail));
          return;
        }
        driveAccessToken = response.access_token;
        driveTokenExpiresAt = Date.now() + ((Number(response.expires_in) || 3600) * 1000);
        resolve(driveAccessToken);
      };
      try {
        driveTokenClient.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
      } catch (err) { reject(err); }
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
  const token = await getDriveAccessToken({ forceConsent: false });
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && retry) {
    driveAccessToken = null; driveTokenExpiresAt = 0;
    await getDriveAccessToken({ forceConsent: false });
    return driveFetch(url, options, false);
  }
  return response;
}

async function driveJson(url, options = {}, retry = true) {
  const response = await driveFetch(url, options, retry);
  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(data?.error?.message || `Google Drive respondeu com ${response.status}.`);
  return data;
}

async function driveText(url, options = {}, retry = true) {
  const response = await driveFetch(url, options, retry);
  const text = await response.text();
  if (!response.ok) {
    let message = `Google Drive respondeu com ${response.status}.`;
    try { message = JSON.parse(text)?.error?.message || message; } catch (_) {}
    throw new Error(message);
  }
  return text;
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
    body: JSON.stringify({ name, mimeType: 'application/json' }),
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
      body: JSON.stringify({ name: currentFileName || remoteFileName(), mimeType: 'application/json' }),
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
    <p class="confirm-body">A integração precisa de um projeto do Google Cloud configurado para este site. Depois disso, o ProfessorGest poderá abrir e sincronizar arquivos .prof diretamente do Drive.</p>
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
        await openDriveFileById(doc.id, doc.name || 'ProfessorGest.prof');
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
    showFileErrorModal(err?.message || 'Não foi possível conectar ao Google Drive. Verifique as credenciais e as configurações do Google Cloud.');
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
  if (demoMode) return false;
  if (!driveBinding?.fileId) return false;
  if (!skipTokenRefresh) await getDriveAccessToken({ forceConsent: false });
  if (!driveAccessToken) throw new Error('A autorização do Google Drive precisa ser renovada.');
  const remote = await getDriveMeta(driveBinding.fileId);
  const remoteChanged = driveBinding.modifiedTime && remote.modifiedTime && new Date(remote.modifiedTime).getTime() > new Date(driveBinding.modifiedTime).getTime() + 1000;
  if (remoteChanged && !force) {
    showDriveConflict(remote);
    return false;
  }
  await updateDriveFile(driveBinding.fileId);
  if (!silent) toast('Sincronizado com Google Drive.', 'success');
  render();
  return true;
}

function showDriveConflict(remoteMeta) {
  const bindingId = driveBinding?.fileId;
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
    if (driveBinding?.fileId) {
      const synced = await syncCurrentProjectToDrive({ silent: true, skipTokenRefresh: true });
      if (!synced) {
        cloudSyncPending = true;
        saveUiState = 'dirty';
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
        saveUiState = 'synced';
      } else {
        cloudSyncPending = true;
        isDirty = true;
        saveUiState = 'dirty';
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
      saveUiState = 'synced';
    } else {
      cloudSyncPending = true;
      isDirty = true;
      saveUiState = 'dirty';
    }
    toast(`Salvo no Google Drive como ${meta.name}.`, 'success');
    render();
    return true;
  } catch (err) {
    cloudSyncPending = !!driveBinding?.fileId;
    saveUiState = 'dirty';
    updateSaveChrome();
    toast(err.message || 'Não foi possível salvar no Google Drive.', 'error');
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
    format: PROF_FORMAT, version: CURRENT_VERSION, createdAt: today, updatedAt: today,
    teacher: { name: '', school: '', subject: '' }, classes: [], students: [], activities: [], occurrences: [],
  };
}

function showWelcomeScreen() {
  workspaceReady = false;
  demoMode = false;
  currentStorageMode = 'none';
  currentFileHandle = null;
  currentFileLastModified = 0;
  clearDriveBinding();
  document.body.classList.remove('workspace-active');
  document.getElementById('welcomeScreen')?.classList.remove('is-hidden');
  document.getElementById('setupScreen')?.classList.add('is-hidden');
  updateThemeToggle();
  renderWelcomeRecovery();
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
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    })
    .catch((err) => console.warn('[ProfessorGest] Service Worker não disponível.', err));
  updateInstallAction();
}

/* ==================== boot ==================== */

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
  loadDriveBinding();
  buildNav();
  bindGlobalEvents();
  bindSetupEvents();
  initGoogleDriveSdk();
  registerPwa();
  showWelcomeScreen();
  readLocalRecoveryDraft();
  renderWelcomeRecovery();
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
  document.getElementById('welcomeOpenFile').onclick = () => openFile();
  document.getElementById('welcomeDemo').onclick = () => beginDemoMode();
  document.getElementById('welcomeDrive')?.addEventListener('click', openDrivePicker);
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

function buildNav() {
  const html = NAV_GROUPS.map(g => `
    <div class="nav-group">
      <div class="nav-group-label">${g.label.toUpperCase()}</div>
      <div class="nav-list">${g.items.map(navItemHTML).join('')}</div>
    </div>`).join('');
  document.getElementById('sidebar-nav').innerHTML = html;
  const primaryItems = NAV_ITEMS.filter(i => MOBILE_NAV_KEYS.includes(i.key)).map(navItemHTML).join('');
  const menuItem = `<button class="nav-item mobile-menu-trigger" id="mobileMenuTrigger" type="button" aria-label="Abrir menu" aria-haspopup="dialog" aria-expanded="false">${ICONS.menu}<span>Menu</span></button>`;
  document.getElementById('bottomNav').innerHTML = primaryItems + menuItem;
  qAll('#sidebar-nav .nav-item[data-view], #bottomNav .nav-item[data-view]').forEach(el => {
    el.onclick = () => navigate(el.dataset.view);
  });
  const sidebarNav = document.getElementById('sidebar-nav');
  if (sidebarNav && !sidebarNav.dataset.bound) {
    sidebarNav.dataset.bound = 'true';
    sidebarNav.addEventListener('click', (event) => {
      const item = event.target.closest('.nav-item[data-view]');
      if (!item || !sidebarNav.contains(item)) return;
      navigate(item.dataset.view);
    });
  }
  const menuTrigger = document.getElementById('mobileMenuTrigger');
  if (menuTrigger) menuTrigger.onclick = openMobileMenu;
}

function navItemHTML(item) {
  return `<button type="button" class="nav-item" data-view="${item.key}" aria-label="${item.label}">${ICONS[item.icon]}<span>${item.label}</span></button>`;
}

function mobileMenuButton(item) {
  return `<button type="button" class="mobile-menu-action" data-mobile-view="${item.key}">
    <span class="mobile-menu-action-icon">${ICONS[item.icon]}</span>
    <span class="mobile-menu-action-copy"><strong>${item.label}</strong><small>${mobileMenuDescription(item.key)}</small></span>
    <span class="mobile-menu-action-arrow">›</span>
  </button>`;
}

function mobileMenuDescription(key) {
  const map = {
    ocorrencias: 'Registros e acompanhamento',
    calendario: 'Atividades e prazos',
    relatorios: 'Acompanhamento e documentos',
    arquivo: 'Abrir, salvar e sincronizar',
    configuracoes: 'Perfil, aparência e preferências'
  };
  return map[key] || '';
}

function openMobileMenu() {
  const trigger = document.getElementById('mobileMenuTrigger');
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
  const teacherName = state?.teacher?.name?.trim() || 'Professor(a)';
  const school = state?.teacher?.school?.trim() || '';
  const driveConnected = !!driveBindingForCurrentProject();
  const driveLabel = driveConnected ? 'Google Drive conectado' : 'Google Drive disponível';
  const menuItems = ['calendario', 'relatorios', 'arquivo', 'configuracoes']
    .map(key => NAV_ITEMS.find(item => item.key === key))
    .filter(Boolean)
    .map(mobileMenuButton).join('');
  openModal(`
    <div class="mobile-menu-head">
      <div class="mobile-menu-identity">
        <div class="mobile-menu-avatar">${esc((teacherName[0] || 'P').toUpperCase())}</div>
        <div class="mobile-menu-identity-copy">
          <strong>${esc(teacherName)}</strong>
          <span>${esc(school || 'ProfessorGest')}</span>
        </div>
      </div>
      <button type="button" class="mobile-menu-close" id="mobileMenuClose" aria-label="Fechar menu">×</button>
    </div>
    <div class="mobile-menu-sync ${driveConnected ? 'connected' : ''}">
      <span class="mobile-menu-sync-dot"></span>
      <span>${esc(driveLabel)}</span>
    </div>
    <div class="mobile-menu-section-label">Navegação</div>
    <div class="mobile-menu-list">${menuItems}</div>
  `, false, 'mobile-menu-box');
  document.getElementById('mobileMenuClose')?.addEventListener('click', closeMobileMenu);
  qAll('[data-mobile-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.mobileView;
      closeMobileMenu();
      navigate(view);
    });
  });
}

function closeMobileMenu() {
  closeModal();
  const trigger = document.getElementById('mobileMenuTrigger');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function navigate(view, resetCtx = true) {
  currentView = view;
  closeCommandPalette();
  if (resetCtx) {
    ctx = { ...ctx, classId: null, studentId: null, activityId: null, classTab: 'visao', studentTab: 'visao',
      histFilter: 'todos', histMonth: '', bulkMode: false, bulkSelected: new Set() };
  }
  qAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  render();
  window.scrollTo(0, 0);
}

const VIEW_TITLES = {
  dashboard: 'Dashboard', turmas: 'Turmas', alunos: 'Alunos', atividades: 'Atividades',
  calendario: 'Calendário', ocorrencias: 'Ocorrências', relatorios: 'Relatórios',
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
    calendario: renderCalendario, ocorrencias: renderOcorrenciasLog, relatorios: renderRelatoriosHub,
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

function studentsOf(classId) { return state.students.filter(s => s.classId === classId); }
function occurrencesOf(studentId) { return state.occurrences.filter(o => o.studentId === studentId); }
function activitiesOf(classId) { return state.activities.filter(a => a.classId === classId); }
function classById(id) { return state.classes.find(c => c.id === id); }
function studentById(id) { return state.students.find(s => s.id === id); }
function classNameOf(classId) { const c = classById(classId); return c ? c.name : 'Sem turma'; }
function initials(name) { return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(''); }
function activeClasses() { return state.classes.filter(c => !c.archived); }
function getDeliveryState(activity, studentId) { return activity.completions[studentId] || 'pending'; }

function studentStats(s) {
  const acts = activitiesOf(s.classId);
  let delivered = 0, notDelivered = 0, pendingOverdue = 0, pendingFuture = 0;
  acts.forEach(a => {
    const st = getDeliveryState(a, s.id);
    const overdue = a.dueDate < todayISO();
    if (st === 'delivered') delivered++;
    else if (st === 'not_delivered') notDelivered++;
    else if (overdue) pendingOverdue++;
    else pendingFuture++;
  });
  const occCount = occurrencesOf(s.id).length;
  return { totalActs: acts.length, delivered, notDelivered, pendingOverdue, pendingFuture,
    pend: notDelivered + pendingOverdue, occCount };
}

function classStats(c) {
  const alunos = studentsOf(c.id);
  const acts = activitiesOf(c.id);
  let delivered = 0, possible = 0, pend = 0;
  acts.forEach(a => alunos.forEach(s => {
    possible++;
    const st = getDeliveryState(a, s.id);
    if (st === 'delivered') delivered++;
    else if (st === 'not_delivered' || a.dueDate < todayISO()) pend++;
  }));
  const pct = possible ? Math.round((delivered / possible) * 100) : 0;
  const upcoming = [...acts].filter(a => a.dueDate >= todayISO()).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const studentIds = new Set(alunos.map(s => s.id));
  const occCount = state.occurrences.filter(o => studentIds.has(o.studentId)).length;
  return { alunos, acts, pct, pend, upcoming, occCount, delivered, possible };
}

function activityStats(a) {
  const alunos = studentsOf(a.classId);
  const delivered = alunos.filter(s => getDeliveryState(a, s.id) === 'delivered').length;
  const notDelivered = alunos.filter(s => getDeliveryState(a, s.id) === 'not_delivered').length;
  const pending = alunos.length - delivered - notDelivered;
  const pct = alunos.length ? Math.round((delivered / alunos.length) * 100) : 0;
  return { alunos, delivered, notDelivered, pending, pct };
}

function activityStatus(a) {
  const st = activityStats(a);
  if (st.delivered + st.notDelivered >= st.alunos.length && st.alunos.length > 0) return 'concluida';
  if (a.dueDate < todayISO()) return 'atrasada';
  return 'proxima';
}

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

/* ==================== DASHBOARD ==================== */

function attentionItems() {
  const items = [];
  const today = todayISO();
  const overdueActs = state.activities.filter(a => a.dueDate < today).filter(a => {
    const st = activityStats(a);
    return st.notDelivered + st.pending > 0;
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  overdueActs.slice(0, 3).forEach(a => {
    const st = activityStats(a);
    items.push({ tone: 'red', title: `${a.name} está atrasada`,
      sub: `${classNameOf(a.classId)} · ${st.notDelivered + st.pending} aluno(s) sem entrega confirmada`,
      action: () => { ctx.activityId = a.id; navigate('atividadeDetail', false); } });
  });

  const dueSoon = state.activities.filter(a => a.dueDate >= today && a.dueDate <= addDays(3))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  dueSoon.slice(0, 3).forEach(a => {
    items.push({ tone: 'amber', title: `${a.name} vence em breve`,
      sub: `${classNameOf(a.classId)} · entrega ${fmtDate(a.dueDate)}`,
      action: () => { ctx.activityId = a.id; navigate('atividadeDetail', false); } });
  });

  const criticos = state.students.filter(s => studentStats(s).pend >= 3);
  criticos.slice(0, 3).forEach(s => {
    const st = studentStats(s);
    items.push({ tone: 'red', title: `${s.name} tem ${st.pend} pendências`,
      sub: `${classNameOf(s.classId)} · acompanhar entregas e ocorrências`,
      action: () => { ctx.studentId = s.id; ctx.studentTab = 'visao'; navigate('alunoDetail', false); } });
  });

  const recentOcc = state.occurrences.filter(o => o.date >= addDays(-3) && (o.type === 'nao_atividade' || o.type === 'nao_entregou' || o.type === 'faltou'));
  recentOcc.slice(0, 2).forEach(o => {
    const s = studentById(o.studentId);
    if (!s) return;
    items.push({ tone: 'blue', title: `Novo registro para ${s.name}`,
      sub: `${fmtDate(o.date)} · ${OCCUR_TYPES.find(t => t.key === o.type)?.label || o.type}`,
      action: () => { ctx.studentId = s.id; ctx.studentTab = 'historico'; navigate('alunoDetail', false); } });
  });

  return items.slice(0, 6);
}

function renderDashboard() {
  const totalAlunos = state.students.length;
  const upcoming = [...state.activities].filter(a => a.dueDate >= todayISO())
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
  const recentOccurrences = [...state.occurrences].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const pendCount = state.activities.reduce((sum, a) => sum + activityStats(a).pending + activityStats(a).notDelivered, 0);
  const attention = attentionItems();
  lastAttentionItems = attention;

  return `
    <div class="page-head">
      <div><h1>${greeting()}, ${esc((state.teacher && state.teacher.name) || 'Professor(a)')}</h1>
        <div class="page-sub">${activeClasses().length} turma(s) · ${totalAlunos} aluno(s) sob acompanhamento</div></div>
      <div class="page-actions"><button type="button" class="btn-primary" id="btnQuickRegisterTop">${ICONS.plus} Registro rápido</button></div>
    </div>

    <div class="grid grid-4" style="margin-bottom:26px;">
      <div class="card stat-card"><div class="stat-icon">${ICONS.users}</div><div class="stat-value">${activeClasses().length}</div><div class="stat-label">Minhas turmas</div></div>
      <div class="card stat-card"><div class="stat-icon">${ICONS.user}</div><div class="stat-value">${totalAlunos}</div><div class="stat-label">Alunos</div></div>
      <div class="card stat-card"><div class="stat-icon">${ICONS.clipboard}</div><div class="stat-value">${upcoming.length}</div><div class="stat-label">Atividades próximas</div></div>
      <div class="card stat-card"><div class="stat-icon">${ICONS.alert}</div><div class="stat-value">${pendCount}</div><div class="stat-label">Pendências abertas</div></div>
    </div>

    ${(!activeClasses().length && !totalAlunos && !state.activities.length) ? `
      <div class="dashboard-empty card">
        <div class="dashboard-empty-icon">${ICONS.sparkle}</div>
        <div class="dashboard-empty-copy">
          <div class="dashboard-empty-kicker">SEU ESPAÇO ESTÁ PRONTO</div>
          <h2>Comece pela sua primeira turma.</h2>
          <p>Cadastre a turma, adicione os alunos e o restante do painel ganha vida automaticamente.</p>
          <div class="dashboard-empty-actions">
            <button type="button" class="btn-primary" id="btnEmptyNewClass">${ICONS.plus} Nova turma</button>
            <button type="button" class="btn-secondary" id="btnEmptyNewStudent">${ICONS.user} Adicionar aluno</button>
          </div>
          <div class="dashboard-empty-steps" aria-label="Primeiros passos">
            <span class="dashboard-empty-step"><b>1</b> Crie uma turma</span>
            <span class="dashboard-empty-step"><b>2</b> Adicione os alunos</span>
            <span class="dashboard-empty-step"><b>3</b> Crie uma atividade</span>
          </div>
        </div>
      </div>
    ` : `
      <div class="section-title">Atenção</div>
      <div class="card" id="attentionCard">
        ${attention.length ? attention.map((it, i) => `
          <div class="attention-card" data-attention-idx="${i}">
            <span class="attention-dot ${it.tone}"></span>
            <div><div class="attention-title">${esc(it.title)}</div><div class="attention-sub">${esc(it.sub)}</div></div>
          </div>`).join('') : emptyState('Nenhuma situação pedindo atenção agora.', 'Tudo em dia por aqui.')}
      </div>
    `}

    <div class="row-between section-title"><span>Minhas turmas</span></div>
    <div class="grid grid-3">
      ${activeClasses().map(c => {
        const st = classStats(c);
        return `<div class="card card-clickable" data-open-class="${c.id}">
          <div class="list-item-title">${esc(c.name)}</div>
          <div class="list-item-sub">${st.alunos.length} alunos · ${st.pend} pendência(s)</div>
          <div style="margin-top:10px;">${progressBarHTML(st.pct)}</div>
          <div class="list-item-sub" style="margin-top:5px;">${st.pct}% de entregas</div>
        </div>`;
      }).join('') || emptyState('Nenhuma turma cadastrada ainda.')}
    </div>

    <div class="grid grid-2" style="margin-top:6px;">
      <div>
        <div class="section-title">Próximas atividades</div>
        <div class="card list-card">
          ${upcoming.map(a => `
            <div class="list-item"><div class="list-item-main" data-open-activity="${a.id}">
              <div class="list-item-title">${esc(a.name)}</div>
              <div class="list-item-sub">${esc(classNameOf(a.classId))} · entrega ${fmtDate(a.dueDate)}</div>
            </div></div>`).join('') || emptyState('Nenhuma atividade futura.')}
        </div>
      </div>
      <div>
        <div class="section-title">Registros recentes</div>
        <div class="card list-card">
          ${recentOccurrences.map(o => {
            const s = studentById(o.studentId);
            return `<div class="list-item"><div class="list-item-main" data-open-student="${o.studentId}">
              <div class="list-item-title">${esc(s ? s.name : 'Aluno removido')}</div>
              <div class="list-item-sub">${fmtDate(o.date)} · ${badgeFor(o.type)}</div>
            </div></div>`;
          }).join('') || emptyState('Nenhum registro recente.')}
        </div>
      </div>
    </div>
  `;
}

/* ==================== TURMAS ==================== */

function renderTurmas() {
  const showArchived = ctx.showArchivedClasses;
  const list = showArchived ? state.classes : activeClasses();
  return `
    <div class="page-head">
      <div><h1>Turmas</h1><div class="page-sub">${activeClasses().length} turma(s) ativa(s)</div></div>
      <div class="page-actions">
        <button type="button" class="btn-ghost btn-sm" id="btnToggleArchivedClasses">${showArchived ? 'Ocultar arquivadas' : 'Mostrar arquivadas'}</button>
        <button type="button" class="btn-primary" id="btnNewClass">${ICONS.plus} Nova turma</button>
      </div>
    </div>
    <div class="grid grid-3">
      ${list.map(c => {
        const st = classStats(c);
        return `<div class="card ${c.archived ? '' : ''}">
          <div class="row-between">
            <div class="list-item-main" data-open-class="${c.id}">
              <div class="list-item-title">${esc(c.name)} ${c.archived ? '<span class="badge badge-gray">Arquivada</span>' : ''}</div>
              <div class="list-item-sub">${st.alunos.length} alunos · ${st.pend} pendência(s)</div>
            </div>
            <div class="list-item-actions">
              <button type="button" class="btn-icon" data-edit-class="${c.id}" aria-label="Editar turma">${ICONS.edit}</button>
              <button type="button" class="btn-icon" data-dup-class="${c.id}" aria-label="Duplicar turma">${ICONS.copy}</button>
              <button type="button" class="btn-icon" data-archive-class="${c.id}" aria-label="Arquivar turma">${ICONS.archive}</button>
              <button type="button" class="btn-icon danger" data-del-class="${c.id}" aria-label="Excluir turma">${ICONS.trash}</button>
            </div>
          </div>
          <div style="margin-top:10px;" data-open-class="${c.id}">${progressBarHTML(st.pct)}</div>
          <div class="list-item-sub" style="margin-top:5px;" data-open-class="${c.id}">
            ${st.pct}% de entregas ${st.upcoming ? `· próxima atividade ${fmtDate(st.upcoming.dueDate)}` : ''}
          </div>
        </div>`;
      }).join('') || emptyState('Nenhuma turma cadastrada.', 'Clique em "Nova turma" para começar.')}
    </div>
  `;
}

function renderTurmaDetail() {
  const c = classById(ctx.classId);
  if (!c) return emptyState('Turma não encontrada.');
  const st = classStats(c);
  const tab = ctx.classTab || 'visao';
  const tabs = [
    { key: 'visao', label: 'Visão geral' }, { key: 'alunos', label: 'Alunos' },
    { key: 'atividades', label: 'Atividades' }, { key: 'ocorrencias', label: 'Ocorrências' },
    { key: 'relatorios', label: 'Relatórios' },
  ];

  let body = '';
  if (tab === 'visao') {
    const upcomingActs = st.acts.filter(a => a.dueDate >= todayISO()).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
    const studentIds = new Set(st.alunos.map(s => s.id));
    const recentOcc = state.occurrences.filter(o => studentIds.has(o.studentId)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    body = `
      <div class="grid grid-4" style="margin-bottom:20px;">
        <div class="card stat-card"><div class="stat-value">${st.alunos.length}</div><div class="stat-label">Alunos</div></div>
        <div class="card stat-card"><div class="stat-value">${st.pct}%</div><div class="stat-label">Entrega de atividades</div></div>
        <div class="card stat-card"><div class="stat-value">${st.pend}</div><div class="stat-label">Pendências</div></div>
        <div class="card stat-card"><div class="stat-value">${st.occCount}</div><div class="stat-label">Ocorrências registradas</div></div>
      </div>
      <div class="grid grid-2">
        <div><div class="section-title">Próximas atividades</div><div class="card list-card">
          ${upcomingActs.map(a => `<div class="list-item"><div class="list-item-main" data-open-activity="${a.id}">
            <div class="list-item-title">${esc(a.name)}</div><div class="list-item-sub">entrega ${fmtDate(a.dueDate)}</div></div></div>`).join('') || emptyState('Nenhuma atividade futura.')}
        </div></div>
        <div><div class="section-title">Registros recentes</div><div class="card list-card">
          ${recentOcc.map(o => { const s = studentById(o.studentId); return `<div class="list-item"><div class="list-item-main" data-open-student="${o.studentId}">
            <div class="list-item-title">${esc(s ? s.name : '—')}</div><div class="list-item-sub">${fmtDate(o.date)} · ${badgeFor(o.type)}</div></div></div>`; }).join('') || emptyState('Nenhum registro ainda.')}
        </div></div>
      </div>`;
  } else if (tab === 'alunos') {
    body = renderClassStudentsTab(c);
  } else if (tab === 'atividades') {
    body = `<div class="row-between" style="margin-bottom:12px;"><div></div><button type="button" class="btn-primary btn-sm" id="btnNewActivityHere">${ICONS.plus} Nova atividade</button></div>
      <div class="card list-card">${st.acts.map(activityListItemHTML).join('') || emptyState('Nenhuma atividade nesta turma.')}</div>`;
  } else if (tab === 'ocorrencias') {
    const studentIds = new Set(st.alunos.map(s => s.id));
    const occ = state.occurrences.filter(o => studentIds.has(o.studentId)).sort((a, b) => b.date.localeCompare(a.date));
    body = `<div class="card list-card">${occ.map(o => { const s = studentById(o.studentId); return `<div class="list-item"><div class="list-item-main" data-open-student="${o.studentId}">
      <div class="list-item-title">${esc(s ? s.name : '—')}</div><div class="list-item-sub">${fmtDate(o.date)} · ${badgeFor(o.type)} ${o.description ? '· ' + esc(o.description) : ''}</div></div></div>`; }).join('') || emptyState('Nenhuma ocorrência registrada para esta turma.')}</div>`;
  } else if (tab === 'relatorios') {
    body = `<div class="card" style="max-width:420px;">
      <p class="muted" style="margin-bottom:14px;font-size:13px;">Gerar um relatório consolidado desta turma, com entregas, pendências e ocorrências no período escolhido.</p>
      <button type="button" class="btn-primary btn-block" id="btnGoClassReport">${ICONS.report} Gerar relatório da turma</button>
    </div>`;
  }

  return `
    <button type="button" class="btn-secondary btn-sm" id="btnBack">${ICONS.back} Voltar</button>
    <div class="card" style="margin-top:14px;margin-bottom:8px;">
      <div class="row-between">
        <div>
          <div class="list-item-title" style="font-size:17px;">${esc(c.name)} ${c.archived ? '<span class="badge badge-gray">Arquivada</span>' : ''}</div>
          <div class="list-item-sub">${st.alunos.length} alunos · ${st.pend} pendência(s)</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn-primary btn-sm" id="btnRegisterForClass">${ICONS.plus} Registrar</button>
          <button type="button" class="btn-secondary btn-sm" id="btnEditThisClass">${ICONS.edit} Editar</button>
        </div>
      </div>
    </div>
    <div class="tabs">${tabs.map(t => `<button type="button" class="tab ${tab === t.key ? 'active' : ''}" data-class-tab="${t.key}">${t.label}</button>`).join('')}</div>
    ${body}
  `;
}

function activityListItemHTML(a) {
  const stt = activityStats(a);
  const status = activityStatus(a);
  const statusBadge = status === 'concluida' ? '<span class="badge badge-green">Concluída</span>'
    : status === 'atrasada' ? '<span class="badge badge-red">Atrasada</span>' : '<span class="badge badge-blue">Próxima</span>';
  return `<div class="list-item">
    <div class="list-item-main" data-open-activity="${a.id}">
      <div class="list-item-title">${esc(a.name)} ${statusBadge}</div>
      <div class="list-item-sub">${esc(classNameOf(a.classId))} · entrega ${fmtDate(a.dueDate)} · ${stt.pct}% entregue · ${stt.notDelivered + stt.pending} pendência(s)</div>
    </div>
    <div class="list-item-actions"><button type="button" class="btn-icon danger" data-del-activity="${a.id}" aria-label="Excluir atividade">${ICONS.trash}</button></div>
  </div>`;
}

function renderClassStudentsTab(c) {
  const alunos = studentsOf(c.id);
  const bulk = ctx.bulkMode;
  return `
    <div class="row-between" style="margin-bottom:12px;">
      <button type="button" class="btn-ghost btn-sm" id="btnToggleBulk">${bulk ? 'Cancelar seleção' : 'Selecionar vários'}</button>
      <button type="button" class="btn-primary btn-sm" id="btnAddStudentHere">${ICONS.plus} Aluno</button>
    </div>
    ${bulk ? `<div class="bulk-bar"><span class="bulk-count">${ctx.bulkSelected.size} selecionado(s)</span>
      <div class="bulk-bar-actions">
        <button type="button" class="btn-secondary btn-sm" id="btnBulkOccurrence">Registrar ocorrência</button>
        <button type="button" class="btn-secondary btn-sm" id="btnBulkSelectAll">Selecionar todos</button>
      </div></div>` : ''}
    <div class="card list-card">
      ${alunos.map(s => {
        const sit = situacaoAluno(s);
        return `<div class="list-item">
          ${bulk ? `<label class="list-item-check"><input type="checkbox" data-bulk-student="${s.id}" ${ctx.bulkSelected.has(s.id) ? 'checked' : ''}></label>` : ''}
          <div class="list-item-main" ${bulk ? '' : `data-open-student="${s.id}"`}>
            <div class="avatar sm">${initials(s.name)}</div>
            <div><div class="list-item-title">${esc(s.name)}</div><div class="list-item-sub">${occurrencesOf(s.id).length} registros · <span class="badge badge-${sit.tone}">${sit.label}</span></div></div>
          </div>
          ${bulk ? '' : `<div class="list-item-actions">
            <button type="button" class="btn-icon" data-edit-student="${s.id}" aria-label="Editar aluno">${ICONS.edit}</button>
            <button type="button" class="btn-icon danger" data-del-student="${s.id}" aria-label="Excluir aluno">${ICONS.trash}</button>
          </div>`}
        </div>`;
      }).join('') || emptyState('Nenhum aluno nesta turma ainda.')}
    </div>
  `;
}

/* ==================== ALUNOS ==================== */

function filteredSortedStudents() {
  const term = (ctx.studentSearch || '').trim().toLowerCase();
  let list = state.students.filter(s => !term || s.name.toLowerCase().includes(term));
  if (ctx.studentClassFilter) list = list.filter(s => s.classId === ctx.studentClassFilter);
  if (ctx.studentSituacao) list = list.filter(s => situacaoAluno(s).key === ctx.studentSituacao);
  if (ctx.studentSort === 'turma') list = [...list].sort((a, b) => classNameOf(a.classId).localeCompare(classNameOf(b.classId)) || a.name.localeCompare(b.name));
  else if (ctx.studentSort === 'pendencias') list = [...list].sort((a, b) => studentStats(b).pend - studentStats(a).pend);
  else list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function studentListItemsHTML(list) {
  return list.map(s => {
    const sit = situacaoAluno(s);
    return `<div class="list-item">
      <div class="list-item-main" data-open-student="${s.id}">
        <div class="avatar sm">${initials(s.name)}</div>
        <div><div class="list-item-title">${esc(s.name)}</div>
        <div class="list-item-sub">${esc(classNameOf(s.classId))} · <span class="badge badge-${sit.tone}">${sit.label}</span></div></div>
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn-icon" data-quick-occ-student="${s.id}" aria-label="Registrar ocorrência">${ICONS.plus}</button>
        <button type="button" class="btn-icon" data-edit-student="${s.id}" aria-label="Editar aluno">${ICONS.edit}</button>
        <button type="button" class="btn-icon danger" data-del-student="${s.id}" aria-label="Excluir aluno">${ICONS.trash}</button>
      </div>
    </div>`;
  }).join('') || emptyState('Nenhum aluno encontrado.', 'Ajuste a pesquisa ou os filtros.');
}

function renderAlunos() {
  return `
    <div class="page-head">
      <div><h1>Alunos</h1><div class="page-sub">${state.students.length} aluno(s) cadastrado(s)</div></div>
      <div class="page-actions"><button type="button" class="btn-primary" id="btnNewStudent">${ICONS.plus} Novo aluno</button></div>
    </div>
    <div class="filter-bar">
      <div class="search-bar" style="max-width:280px;"><input class="form-input input-search" id="studentSearchInput" placeholder="Pesquisar aluno..." value="${esc(ctx.studentSearch || '')}"></div>
      <select class="form-select" id="studentClassFilterSelect">
        <option value="">Todas as turmas</option>
        ${state.classes.map(c => `<option value="${c.id}" ${ctx.studentClassFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <select class="form-select" id="studentSituacaoSelect">
        <option value="">Qualquer situação</option>
        <option value="ok" ${ctx.studentSituacao === 'ok' ? 'selected' : ''}>Em dia</option>
        <option value="pendencia" ${ctx.studentSituacao === 'pendencia' ? 'selected' : ''}>Com pendências</option>
        <option value="critico" ${ctx.studentSituacao === 'critico' ? 'selected' : ''}>Muitas pendências</option>
      </select>
      <select class="form-select" id="studentSortSelect">
        <option value="nome" ${ctx.studentSort === 'nome' ? 'selected' : ''}>Ordenar por nome</option>
        <option value="turma" ${ctx.studentSort === 'turma' ? 'selected' : ''}>Ordenar por turma</option>
        <option value="pendencias" ${ctx.studentSort === 'pendencias' ? 'selected' : ''}>Ordenar por pendências</option>
      </select>
    </div>
    <div class="card list-card" id="studentListBody">${studentListItemsHTML(filteredSortedStudents())}</div>
  `;
}

/* ==================== PERFIL DO ALUNO ==================== */

function renderAlunoDetail() {
  const s = studentById(ctx.studentId);
  if (!s) return emptyState('Aluno não encontrado.');
  const stt = studentStats(s);
  const sit = situacaoAluno(s);
  const tab = ctx.studentTab || 'visao';
  const tabs = [
    { key: 'visao', label: 'Visão geral' }, { key: 'historico', label: 'Histórico' },
    { key: 'atividades', label: 'Atividades' }, { key: 'observacoes', label: 'Observações' },
    { key: 'relatorio', label: 'Relatório' },
  ];

  let body = '';
  if (tab === 'visao') {
    const entries = studentTimelineEntries(s).slice(0, 5);
    body = `
      <div class="card" style="margin-bottom:16px;" id="notesCard">
        <div class="row-between"><div class="section-title" style="margin:0;">Observação geral</div><button type="button" class="btn-icon" id="btnEditNotes" aria-label="Editar observação geral">${ICONS.edit}</button></div>
        <div id="notesDisplay" style="margin-top:8px;">${s.notes ? `<p style="white-space:pre-wrap;font-size:13px;line-height:1.5;">${esc(s.notes)}</p>` : emptyState('Nenhuma observação geral registrada.')}</div>
      </div>
      <div class="section-title">Atividade recente</div>
      <div class="card list-card">${entries.length ? timelineEntriesHTML(entries) : emptyState('Nenhum registro ainda.')}</div>
    `;
  } else if (tab === 'historico') {
    body = renderHistFilters(s) + `<div class="card">${renderTimeline(s)}</div>`;
  } else if (tab === 'atividades') {
    const acts = activitiesOf(s.classId);
    body = `<div class="card list-card">${acts.map(a => {
      const st = getDeliveryState(a, s.id);
      return `<div class="list-item"><div class="list-item-main" data-open-activity="${a.id}">
        <div class="list-item-title">${esc(a.name)}</div><div class="list-item-sub">entrega ${fmtDate(a.dueDate)}</div></div>${deliveryBadge(st)}</div>`;
    }).join('') || emptyState('Nenhuma atividade para a turma deste aluno.')}</div>`;
  } else if (tab === 'observacoes') {
    const obs = [...(s.observations || [])].sort((a, b) => b.date.localeCompare(a.date));
    body = `<div class="row-between" style="margin-bottom:12px;"><div></div><button type="button" class="btn-primary btn-sm" id="btnNewObservation">${ICONS.plus} Nova observação</button></div>
      <div class="card list-card">${obs.map(o => `
        <div class="list-item"><div style="flex:1;"><div class="timeline-date">${fmtDate(o.date)}</div>
        <div class="timeline-text" style="white-space:pre-wrap;">${esc(o.text)}</div></div>
        <div class="list-item-actions"><button type="button" class="btn-icon" data-edit-obs="${o.id}" aria-label="Editar observação">${ICONS.edit}</button>
        <button type="button" class="btn-icon danger" data-del-obs="${o.id}" aria-label="Excluir observação">${ICONS.trash}</button></div></div>`).join('') || emptyState('Nenhuma observação datada ainda.', 'Use para anotar avanços, dificuldades ou combinados com a família.')}</div>`;
  } else if (tab === 'relatorio') {
    body = `<div class="card" style="max-width:420px;">
      <p class="muted" style="margin-bottom:14px;font-size:13px;">Gerar um relatório individual completo de ${esc(s.name)}, com entregas, ocorrências, observações e linha do tempo.</p>
      <button type="button" class="btn-primary btn-block" id="btnGoStudentReport">${ICONS.report} Gerar relatório individual</button>
    </div>`;
  }

  return `
    <button type="button" class="btn-secondary btn-sm" id="btnBack">${ICONS.back} Voltar</button>
    <div class="profile-header" style="margin-top:14px;">
      <div class="avatar lg">${initials(s.name)}</div>
      <div><div class="list-item-title" style="font-size:18px;">${esc(s.name)}</div>
        <div class="list-item-sub">${esc(classNameOf(s.classId))} · <span class="badge badge-${sit.tone}">${sit.label}</span></div></div>
      <div class="profile-actions">
        <button type="button" class="btn-primary btn-sm" id="btnRegisterForStudent">${ICONS.plus} Registrar ocorrência</button>
        <button type="button" class="btn-secondary btn-sm" id="btnEditThisStudent">${ICONS.edit} Editar aluno</button>
        <button type="button" class="btn-secondary btn-sm" id="btnGoStudentReportTop">${ICONS.report} Gerar relatório</button>
      </div>
    </div>
    <div class="stat-row" style="margin-bottom:18px;">
      <div class="card stat-card"><div class="stat-value">${stt.totalActs}</div><div class="stat-label">Atividades</div></div>
      <div class="card stat-card"><div class="stat-value">${stt.delivered}</div><div class="stat-label">Entregas</div></div>
      <div class="card stat-card"><div class="stat-value">${stt.notDelivered}</div><div class="stat-label">Não entregues</div></div>
      <div class="card stat-card"><div class="stat-value">${stt.pend}</div><div class="stat-label">Pendências</div></div>
      <div class="card stat-card"><div class="stat-value">${stt.occCount}</div><div class="stat-label">Registros</div></div>
    </div>
    <div class="tabs">${tabs.map(t => `<button type="button" class="tab ${tab === t.key ? 'active' : ''}" data-student-tab="${t.key}">${t.label}</button>`).join('')}</div>
    ${body}
  `;
}

function studentTimelineEntries(student) {
  const occ = occurrencesOf(student.id).map(o => ({ kind: o.type === 'observacao' ? 'observacao' : 'ocorrencia', date: o.date, occ: o, sortKey: o.date + '_a_' + o.id }));
  const obs = (student.observations || []).map(o => ({ kind: 'anotacao', date: o.date, obs: o, sortKey: o.date + '_b_' + o.id }));
  const acts = activitiesOf(student.classId).map(a => {
    const st = getDeliveryState(a, student.id);
    if (st === 'pending') return null;
    return { kind: 'atividade', date: a.dueDate, activity: a, state: st, sortKey: a.dueDate + '_c_' + a.id };
  }).filter(Boolean);
  return [...occ, ...obs, ...acts].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
}

function renderHistFilters(student) {
  const entries = studentTimelineEntries(student);
  const months = [...new Set(entries.map(e => e.date.slice(0, 7)))].sort().reverse();
  const filters = [
    { key: 'todos', label: 'Todos' }, { key: 'ocorrencia', label: 'Ocorrências' },
    { key: 'atividade', label: 'Atividades' }, { key: 'anotacao', label: 'Observações' },
  ];
  return `
    <div class="quick-options" style="margin-bottom:8px;">
      ${filters.map(f => `<button type="button" class="quick-opt ${ctx.histFilter === f.key ? 'selected' : ''}" data-hist-filter="${f.key}">${f.label}</button>`).join('')}
    </div>
    ${months.length ? `<select class="form-select" id="histMonthSelect" style="max-width:220px;margin-bottom:14px;">
      <option value="">Todos os períodos</option>
      ${months.map(m => `<option value="${m}" ${ctx.histMonth === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}
    </select>` : ''}
  `;
}

function timelineEntriesHTML(entries) {
  return entries.map(e => {
    if (e.kind === 'atividade') {
      const done = e.state === 'delivered';
      return `<div class="timeline-item"><div class="timeline-dot ${done ? 'green' : 'red'}"></div>
        <div><div class="timeline-date">${fmtDate(e.date)}</div>
        <div class="timeline-text">${done ? '✅' : '❌'} ${esc(e.activity.name)} — ${done ? 'entregou' : 'não entregou'}</div></div></div>`;
    }
    if (e.kind === 'anotacao') {
      return `<div class="timeline-item"><div class="timeline-dot"></div>
        <div><div class="timeline-date">${fmtDate(e.date)}</div><div class="timeline-text">📝 Observação pedagógica</div>
        <div class="timeline-desc">${esc(e.obs.text)}</div></div></div>`;
    }
    const o = e.occ;
    return `<div class="timeline-item"><div class="timeline-dot"></div>
      <div style="flex:1;"><div class="row-between"><div class="timeline-date">${fmtDate(o.date)}</div>
      <div class="list-item-actions"><button type="button" class="btn-icon" data-edit-occ="${o.id}" aria-label="Editar ocorrência">${ICONS.edit}</button>
      <button type="button" class="btn-icon danger" data-del-occ="${o.id}" aria-label="Excluir ocorrência">${ICONS.trash}</button></div></div>
      <div class="timeline-text">${badgeFor(o.type)} ${esc(o.description || '')}</div></div></div>`;
  }).join('');
}

function renderTimeline(student) {
  let entries = studentTimelineEntries(student);
  if (ctx.histFilter && ctx.histFilter !== 'todos') entries = entries.filter(e => e.kind === ctx.histFilter);
  if (ctx.histMonth) entries = entries.filter(e => e.date.slice(0, 7) === ctx.histMonth);
  if (!entries.length) return emptyState('Nenhum registro encontrado para este filtro.');
  return timelineEntriesHTML(entries);
}

/* ==================== ATIVIDADES ==================== */

function filteredActivities() {
  const today = todayISO();
  let list = [...state.activities];
  if (ctx.activityClassFilter) list = list.filter(a => a.classId === ctx.activityClassFilter);
  if (ctx.activityFilter === 'proximas') list = list.filter(a => a.dueDate >= today && activityStatus(a) !== 'concluida');
  else if (ctx.activityFilter === 'atrasadas') list = list.filter(a => activityStatus(a) === 'atrasada');
  else if (ctx.activityFilter === 'concluidas') list = list.filter(a => activityStatus(a) === 'concluida');
  return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function renderAtividades() {
  const filters = [
    { key: 'proximas', label: 'Próximas' }, { key: 'atrasadas', label: 'Atrasadas' },
    { key: 'concluidas', label: 'Concluídas' }, { key: 'todas', label: 'Todas' },
  ];
  return `
    <div class="page-head">
      <div><h1>Atividades</h1><div class="page-sub">${state.activities.length} atividade(s) cadastrada(s)</div></div>
      <div class="page-actions"><button type="button" class="btn-primary" id="btnNewActivity">${ICONS.plus} Nova atividade</button></div>
    </div>
    <div class="filter-bar">
      <div class="chip-toggle-group">${filters.map(f => `<button type="button" class="chip-toggle ${ctx.activityFilter === f.key ? 'active' : ''}" data-activity-filter="${f.key}">${f.label}</button>`).join('')}</div>
      <select class="form-select" id="activityClassFilterSelect" style="margin-left:auto;">
        <option value="">Todas as turmas</option>
        ${state.classes.map(c => `<option value="${c.id}" ${ctx.activityClassFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
    </div>
    <div class="card list-card">${filteredActivities().map(activityListItemHTML).join('') || emptyState('Nenhuma atividade encontrada para este filtro.')}</div>
  `;
}

function renderAtividadeDetail() {
  const a = state.activities.find(x => x.id === ctx.activityId);
  if (!a) return emptyState('Atividade não encontrada.');
  const stt = activityStats(a);
  const bulk = ctx.bulkMode;
  return `
    <button type="button" class="btn-secondary btn-sm" id="btnBack">${ICONS.back} Voltar</button>
    <div class="card" style="margin-top:14px;">
      <div class="row-between">
        <div><div class="list-item-title" style="font-size:17px;">${esc(a.name)}</div>
          <div class="list-item-sub">${esc(classNameOf(a.classId))} · entrega ${fmtDate(a.dueDate)}</div></div>
        <button type="button" class="btn-secondary btn-sm" id="btnEditActivity">${ICONS.edit} Editar</button>
      </div>
      ${a.description ? `<p style="margin-top:10px;font-size:13px;color:var(--text-muted);white-space:pre-wrap;">${esc(a.description)}</p>` : ''}
      <div style="margin-top:14px;">${progressBarHTML(stt.pct)}</div>
    </div>
    <div class="stat-row" style="margin-top:14px;margin-bottom:18px;">
      <div class="card stat-card"><div class="stat-value">${stt.alunos.length}</div><div class="stat-label">Total de alunos</div></div>
      <div class="card stat-card"><div class="stat-value">${stt.delivered}</div><div class="stat-label">✅ Entregaram</div></div>
      <div class="card stat-card"><div class="stat-value">${stt.notDelivered}</div><div class="stat-label">❌ Não entregaram</div></div>
      <div class="card stat-card"><div class="stat-value">${stt.pending}</div><div class="stat-label">◯ Não verificados</div></div>
    </div>
    <div class="row-between">
      <div class="section-title" style="margin:0;">Marcar entregas</div>
      <button type="button" class="btn-ghost btn-sm" id="btnToggleBulk">${bulk ? 'Cancelar seleção' : 'Ações em massa'}</button>
    </div>
    <p class="muted" style="font-size:12px;margin:4px 0 10px;">Toque para alternar entre não verificado, entregou e não entregou.</p>
    ${bulk ? `<div class="bulk-bar"><span class="bulk-count">${ctx.bulkSelected.size} selecionado(s)</span>
      <div class="bulk-bar-actions">
        <button type="button" class="btn-secondary btn-sm" id="btnBulkSelectAll">Selecionar todos</button>
        <button type="button" class="btn-secondary btn-sm" data-bulk-set="delivered">✅ Marcar entregou</button>
        <button type="button" class="btn-secondary btn-sm" data-bulk-set="not_delivered">❌ Marcar não entregou</button>
        <button type="button" class="btn-secondary btn-sm" data-bulk-set="pending">◯ Marcar não verificado</button>
      </div></div>` : ''}
    <div class="card">
      ${stt.alunos.map(s => {
        const st = getDeliveryState(a, s.id);
        const icon = st === 'delivered' ? '✅' : st === 'not_delivered' ? '❌' : '◯';
        const label = st === 'delivered' ? 'Entregou' : st === 'not_delivered' ? 'Não entregou' : 'Não verificado';
        return `<div class="deliver-item">
          ${bulk ? `<label class="list-item-check"><input type="checkbox" data-bulk-student="${s.id}" ${ctx.bulkSelected.has(s.id) ? 'checked' : ''}></label>` : ''}
          <span style="flex:1;">${esc(s.name)}</span>
          ${bulk ? '' : `<button type="button" class="tri-toggle" data-cycle-delivery="${s.id}">${icon} ${label}</button>`}
        </div>`;
      }).join('') || emptyState('Nenhum aluno nesta turma.')}
    </div>
  `;
}

/* ==================== CALENDÁRIO ==================== */

function activitiesInMonth(ym) { return state.activities.filter(a => a.dueDate.slice(0, 7) === ym && (!ctx.calClassFilter || a.classId === ctx.calClassFilter)); }

function renderCalendario() {
  const [y, m] = ctx.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = todayISO();
  const acts = activitiesInMonth(ctx.calMonth);
  const byDay = {};
  acts.forEach(a => { (byDay[a.dueDate] = byDay[a.dueDate] || []).push(a); });

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push({ outside: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${pad2(m)}-${pad2(d)}`;
    cells.push({ day: d, iso, acts: byDay[iso] || [] });
  }
  while (cells.length % 7 !== 0) cells.push({ outside: true });

  const selDay = ctx.calSelectedDay;
  const selActs = selDay ? (byDay[selDay] || []) : [];

  return `
    <div class="page-head"><div><h1>Calendário</h1><div class="page-sub">Prazos de atividades por mês</div></div>
      <div class="page-actions"><select class="form-select" id="calClassFilterSelect"><option value="">Todas as turmas</option>
        ${state.classes.map(c => `<option value="${c.id}" ${ctx.calClassFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    </div>
    <div class="card">
      <div class="calendar-head">
        <button type="button" class="btn-icon" id="btnCalPrev" aria-label="Mês anterior">${ICONS.chevL}</button>
        <div class="cal-title">${monthLabel(ctx.calMonth)}</div>
        <button type="button" class="btn-icon" id="btnCalNext" aria-label="Próximo mês">${ICONS.chevR}</button>
      </div>
      <div class="calendar-grid">
        ${[0,1,2,3,4,5,6].map(i => `<div class="calendar-dow">${weekdayShort(i)}</div>`).join('')}
        ${cells.map(c => {
          if (c.outside) return `<div class="calendar-day outside"></div>`;
          const hasOverdue = c.acts.some(a => c.iso < today && activityStatus(a) !== 'concluida');
          return `<div class="calendar-day ${c.iso === today ? 'today' : ''} ${c.iso === selDay ? 'selected' : ''}" data-cal-day="${c.iso}">
            <div class="calendar-daynum">${c.day}</div>
            <div class="calendar-dot-row">${c.acts.slice(0, 4).map(a => `<span class="calendar-dot ${hasOverdue ? 'over' : ''}"></span>`).join('')}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
    ${selDay ? `<div class="section-title">Atividades em ${fmtDate(selDay)}</div>
      <div class="card list-card">${selActs.map(a => `<div class="list-item"><div class="list-item-main" data-open-activity="${a.id}">
        <div class="list-item-title">${esc(a.name)}</div><div class="list-item-sub">${esc(classNameOf(a.classId))}</div></div></div>`).join('') || emptyState('Nenhuma atividade neste dia.')}</div>` : ''}
  `;
}

/* ==================== OCORRÊNCIAS (log global) ==================== */

function renderOcorrenciasLog() {
  let list = [...state.occurrences];
  if (ctx.occClassFilter) { const ids = new Set(studentsOf(ctx.occClassFilter).map(s => s.id)); list = list.filter(o => ids.has(o.studentId)); }
  if (ctx.occTypeFilter) list = list.filter(o => o.type === ctx.occTypeFilter);
  if (ctx.occMonth) list = list.filter(o => o.date.slice(0, 7) === ctx.occMonth);
  list.sort((a, b) => b.date.localeCompare(a.date));

  return `
    <div class="page-head"><div><h1>Ocorrências</h1><div class="page-sub">${list.length} registro(s)</div></div>
      <div class="page-actions"><button type="button" class="btn-primary" id="btnQuickRegisterOcc">${ICONS.plus} Registrar</button></div>
    </div>
    <div class="filter-bar">
      <select class="form-select" id="occClassFilterSelect"><option value="">Todas as turmas</option>
        ${state.classes.map(c => `<option value="${c.id}" ${ctx.occClassFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select class="form-select" id="occTypeFilterSelect"><option value="">Todos os tipos</option>
        ${OCCUR_TYPES.map(t => `<option value="${t.key}" ${ctx.occTypeFilter === t.key ? 'selected' : ''}>${t.emoji} ${t.label}</option>`).join('')}</select>
    </div>
    <div class="card list-card">${list.map(o => { const s = studentById(o.studentId); return `<div class="list-item">
      <div class="list-item-main" data-open-student="${o.studentId}">
        <div class="avatar sm">${s ? initials(s.name) : '—'}</div>
        <div><div class="list-item-title">${esc(s ? s.name : 'Aluno removido')}</div>
        <div class="list-item-sub">${fmtDate(o.date)} · ${esc(classNameOf(s ? s.classId : null))} · ${badgeFor(o.type)} ${o.description ? '· ' + esc(o.description) : ''}</div></div>
      </div>
      <div class="list-item-actions"><button type="button" class="btn-icon" data-edit-occ="${o.id}" aria-label="Editar">${ICONS.edit}</button>
      <button type="button" class="btn-icon danger" data-del-occ="${o.id}" aria-label="Excluir">${ICONS.trash}</button></div></div>`; }).join('') || emptyState('Nenhuma ocorrência encontrada para este filtro.')}</div>
  `;
}

/* ==================== RELATÓRIOS ==================== */

function renderRelatoriosHub() {
  return `
    <div class="page-head"><div><h1>Relatórios</h1><div class="page-sub">Gere relatórios prontos para impressão ou exportação em PDF</div></div></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="list-item-title">Relatório individual do aluno</div>
        <p class="muted" style="font-size:13px;margin:6px 0 14px;">Resumo, entregas, ocorrências, observações e linha do tempo de um aluno em um período.</p>
        <button type="button" class="btn-primary" id="btnOpenIndividualConfig">${ICONS.report} Configurar relatório</button>
      </div>
      <div class="card">
        <div class="list-item-title">Relatório da turma</div>
        <p class="muted" style="font-size:13px;margin:6px 0 14px;">Entregas, pendências, participação e ocorrências de uma turma inteira em um período.</p>
        <button type="button" class="btn-primary" id="btnOpenClassConfig">${ICONS.report} Configurar relatório</button>
      </div>
      <div class="card">
        <div class="list-item-title">Relatório de atividades</div>
        <p class="muted" style="font-size:13px;margin:6px 0 14px;">Veja a lista de atividades com filtros e imprima ou exporte a visão atual.</p>
        <button type="button" class="btn-secondary" id="btnGoAtividadesPrint">Abrir atividades</button>
      </div>
      <div class="card">
        <div class="list-item-title">Relatório de ocorrências</div>
        <p class="muted" style="font-size:13px;margin:6px 0 14px;">Veja o log de ocorrências com filtros e imprima ou exporte a visão atual.</p>
        <button type="button" class="btn-secondary" id="btnGoOcorrenciasPrint">Abrir ocorrências</button>
      </div>
    </div>
  `;
}

function openIndividualReportConfig(presetStudentId) {
  ctx.reportStudentId = presetStudentId || ctx.reportStudentId || (state.students[0] && state.students[0].id) || null;
  ctx.reportFrom = ctx.reportFrom || addDays(-60);
  ctx.reportTo = ctx.reportTo || todayISO();
  ctx.reportOpts = ctx.reportOpts || { resumo: true, atividades: true, entregas: true, naoEntregas: true, ocorrencias: true, observacoes: true, linha: true };
  openModal(`
    <div class="modal-title">Relatório individual do aluno</div>
    <form id="reportConfigForm">
      <div class="form-group"><label class="form-label">Aluno</label>
        <select class="form-select" name="studentId">${state.students.map(s => `<option value="${s.id}" ${s.id === ctx.reportStudentId ? 'selected' : ''}>${esc(s.name)} — ${esc(classNameOf(s.classId))}</option>`).join('')}</select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Período — de</label><input class="form-input" type="date" name="from" value="${ctx.reportFrom}"></div>
        <div class="form-group"><label class="form-label">até</label><input class="form-input" type="date" name="to" value="${ctx.reportTo}"></div>
      </div>
      <div class="form-group"><label class="form-label">Incluir no relatório</label>
        ${reportOptCheckbox('resumo', 'Resumo')}${reportOptCheckbox('atividades', 'Atividades')}${reportOptCheckbox('entregas', 'Entregas')}
        ${reportOptCheckbox('naoEntregas', 'Não entregas')}${reportOptCheckbox('ocorrencias', 'Ocorrências')}${reportOptCheckbox('observacoes', 'Observações')}${reportOptCheckbox('linha', 'Linha do tempo')}
      </div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="submit" class="btn-primary">Visualizar relatório</button></div>
    </form>
  `);
}
function reportOptCheckbox(key, label) {
  return `<label class="checkbox-row"><input type="checkbox" name="opt_${key}" ${ctx.reportOpts[key] ? 'checked' : ''}> ${label}</label>`;
}

function renderRelatorioIndividual() {
  const s = studentById(ctx.reportStudentId);
  if (!s) return emptyState('Selecione um aluno para gerar o relatório.');
  const from = ctx.reportFrom || addDays(-60);
  const to = ctx.reportTo || todayISO();
  const opts = ctx.reportOpts || { resumo:true, atividades:true, entregas:true, naoEntregas:true, ocorrencias:true, observacoes:true, linha:true };

  const acts = activitiesOf(s.classId)
    .filter(a => a.dueDate >= from && a.dueDate <= to)
    .sort((a,b) => a.dueDate.localeCompare(b.dueDate));
  const occ = occurrencesOf(s.id)
    .filter(o => o.date >= from && o.date <= to)
    .sort((a,b) => b.date.localeCompare(a.date));
  const obs = (s.observations || [])
    .filter(o => o.date >= from && o.date <= to)
    .sort((a,b) => b.date.localeCompare(a.date));
  const delivered = acts.filter(a => getDeliveryState(a, s.id) === 'delivered');
  const notDelivered = acts.filter(a => getDeliveryState(a, s.id) === 'not_delivered');
  const pending = acts.filter(a => getDeliveryState(a, s.id) === 'pending');
  const entries = studentTimelineEntries(s).filter(e => e.date >= from && e.date <= to);

  const completionPct = acts.length ? Math.round((delivered.length / acts.length) * 100) : 0;

  return `
    <div class="row-between no-print" style="margin-bottom:16px;">
      <button type="button" class="btn-secondary btn-sm" id="btnBack">${ICONS.back} Voltar</button>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn-secondary btn-sm" id="btnEditReportConfig">${ICONS.edit} Alterar configuração</button>
        <button type="button" class="btn-secondary btn-sm" id="btnPrintReport">${ICONS.print} Imprimir</button>
        <button type="button" class="btn-primary btn-sm" id="btnExportPdfReport">${ICONS.pdf} Exportar PDF</button>
      </div>
    </div>

    <div id="reportPrintArea">
      <div class="report-page">
        <div class="report-masthead">
          <div class="rm-brand-wrap"><img class="rm-logo" src="logo.svg?v=21" alt=""><div class="rm-brand">Professor<em>Gest</em></div></div>
          <div class="rm-meta">
            Professor(a): ${esc((state.teacher && state.teacher.name) || '—')}<br>
            ${state.teacher && state.teacher.school ? `Escola: ${esc(state.teacher.school)}<br>` : ''}
            ${state.teacher && state.teacher.subject ? `Área: ${esc(state.teacher.subject)}<br>` : ''}
            Gerado em ${fmtDate(todayISO())}
          </div>
        </div>

        <div class="report-title">Relatório individual do aluno</div>
        <div class="report-sub">${esc(s.name)} · ${esc(classNameOf(s.classId))} · período de ${fmtDate(from)} a ${fmtDate(to)}</div>

        ${opts.resumo ? `
        <div class="report-section-title">Resumo</div>
        <div class="report-stat-grid">
          <div class="report-stat"><div class="rv">${acts.length}</div><div class="rl">Atividades</div></div>
          <div class="report-stat"><div class="rv">${delivered.length}</div><div class="rl">Entregas</div></div>
          <div class="report-stat"><div class="rv">${notDelivered.length}</div><div class="rl">Não entregues</div></div>
          <div class="report-stat"><div class="rv">${completionPct}%</div><div class="rl">Taxa de entrega</div></div>
        </div>` : ''}

        ${opts.atividades ? `
        <div class="report-section-title">Atividades</div>
        <table class="report-table">
          <thead><tr><th>Atividade</th><th>Prazo</th><th>Situação</th></tr></thead>
          <tbody>
            ${acts.map(a => {
              const st = getDeliveryState(a, s.id);
              const label = st === 'delivered' ? 'Entregou' : st === 'not_delivered' ? 'Não entregou' : 'Não verificado';
              return `<tr><td>${esc(a.name)}</td><td>${fmtDate(a.dueDate)}</td><td>${label}</td></tr>`;
            }).join('') || `<tr><td colspan="3">Nenhuma atividade no período.</td></tr>`}
          </tbody>
        </table>` : ''}

        ${opts.entregas ? `
        <div class="report-section-title">Entregas confirmadas</div>
        <table class="report-table">
          <thead><tr><th>Atividade</th><th>Data do prazo</th><th>Situação</th></tr></thead>
          <tbody>
            ${delivered.map(a => `<tr><td>${esc(a.name)}</td><td>${fmtDate(a.dueDate)}</td><td>Entregou</td></tr>`).join('') ||
              `<tr><td colspan="3">Nenhuma entrega confirmada no período.</td></tr>`}
          </tbody>
        </table>` : ''}

        ${opts.naoEntregas ? `
        <div class="report-section-title">Pendências de entrega</div>
        <table class="report-table">
          <thead><tr><th>Atividade</th><th>Prazo</th><th>Situação</th></tr></thead>
          <tbody>
            ${[...notDelivered.map(a => ({a,label:'Não entregou'})), ...pending.map(a => ({a,label:'Não verificado'}))]
              .map(({a,label}) => `<tr><td>${esc(a.name)}</td><td>${fmtDate(a.dueDate)}</td><td>${label}</td></tr>`).join('') ||
              `<tr><td colspan="3">Nenhuma pendência encontrada no período.</td></tr>`}
          </tbody>
        </table>` : ''}

        ${opts.ocorrencias ? `
        <div class="report-section-title">Ocorrências e registros</div>
        <table class="report-table">
          <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th></tr></thead>
          <tbody>
            ${occ.map(o => `<tr><td>${fmtDate(o.date)}</td><td>${esc(OCCUR_TYPES.find(t => t.key === o.type)?.label || o.type)}</td><td>${esc(o.description || '—')}</td></tr>`).join('') ||
              `<tr><td colspan="3">Nenhuma ocorrência no período.</td></tr>`}
          </tbody>
        </table>` : ''}

        ${opts.observacoes ? `
        <div class="report-section-title">Observações pedagógicas</div>
        ${s.notes ? `<p style="font-size:12.5px;line-height:1.55;margin-bottom:8px;white-space:pre-wrap;">${esc(s.notes)}</p>` : ''}
        <table class="report-table">
          <thead><tr><th>Data</th><th>Observação</th></tr></thead>
          <tbody>
            ${obs.map(o => `<tr><td>${fmtDate(o.date)}</td><td>${esc(o.text)}</td></tr>`).join('') ||
              `<tr><td colspan="2">Nenhuma observação datada no período.</td></tr>`}
          </tbody>
        </table>` : ''}

        ${opts.linha ? `
        <div class="report-section-title">Linha do tempo</div>
        <div class="card report-timeline" style="border-radius:10px;">${entries.length ? timelineEntriesHTML(entries) : emptyState('Nenhum evento no período.')}</div>` : ''}

        <div class="report-section-title">Síntese final</div>
        <div class="report-synthesis">
          <textarea id="reportSynthesisText" placeholder="Escreva aqui uma síntese pedagógica final sobre o período...">${esc(ctx.reportSynthesis || '')}</textarea>
        </div>

        <div class="report-signature">
          <div class="sig-line">Assinatura do professor(a)</div>
          <div class="sig-line">Data: ${fmtDate(todayISO())}</div>
        </div>
      </div>
    </div>
  `;
}

function openClassReportConfig(presetClassId) {
  ctx.classReportId = presetClassId || ctx.classReportId || (state.classes[0] && state.classes[0].id) || null;
  ctx.classReportFrom = ctx.classReportFrom || addDays(-60);
  ctx.classReportTo = ctx.classReportTo || todayISO();
  openModal(`
    <div class="modal-title">Relatório da turma</div>
    <form id="classReportConfigForm">
      <div class="form-group"><label class="form-label">Turma</label>
        <select class="form-select" name="classId">${state.classes.map(c => `<option value="${c.id}" ${c.id === ctx.classReportId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Período — de</label><input class="form-input" type="date" name="from" value="${ctx.classReportFrom}"></div>
        <div class="form-group"><label class="form-label">até</label><input class="form-input" type="date" name="to" value="${ctx.classReportTo}"></div>
      </div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button><button type="submit" class="btn-primary">Visualizar relatório</button></div>
    </form>
  `);
}

function renderRelatorioTurma() {
  const c = classById(ctx.classReportId);
  if (!c) return emptyState('Selecione uma turma para gerar o relatório.');
  const from = ctx.classReportFrom, to = ctx.classReportTo;
  const alunos = studentsOf(c.id);
  const acts = activitiesOf(c.id).filter(a => a.dueDate >= from && a.dueDate <= to);
  const studentIds = new Set(alunos.map(s => s.id));
  const occ = state.occurrences.filter(o => studentIds.has(o.studentId) && o.date >= from && o.date <= to);
  const participacao = occ.filter(o => o.type === 'participou' || o.type === 'bom_comportamento').length;
  let totalDelivered = 0, totalPossible = 0;
  const rows = alunos.map(s => {
    let d = 0, pend = 0;
    acts.forEach(a => { const st = getDeliveryState(a, s.id); totalPossible++; if (st === 'delivered') { d++; totalDelivered++; } else if (st === 'not_delivered' || a.dueDate < todayISO()) pend++; });
    const regs = occ.filter(o => o.studentId === s.id).length;
    return { name: s.name, d, pend, regs };
  });
  const pct = totalPossible ? Math.round((totalDelivered / totalPossible) * 100) : 0;

  return `
    <div class="row-between no-print" style="margin-bottom:16px;">
      <button type="button" class="btn-secondary btn-sm" id="btnBack">${ICONS.back} Voltar</button>
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn-secondary btn-sm" id="btnEditClassReportConfig">${ICONS.edit} Alterar configuração</button>
        <button type="button" class="btn-secondary btn-sm" id="btnPrintReport">${ICONS.print} Imprimir</button>
        <button type="button" class="btn-primary btn-sm" id="btnExportPdfReport">${ICONS.pdf} Exportar PDF</button>
      </div>
    </div>
    <div id="reportPrintArea">
    <div class="report-page">
      <div class="report-masthead">
        <div class="rm-brand">Professor<em>Gest</em></div>
        <div class="rm-meta">Professor(a): ${esc((state.teacher && state.teacher.name) || '—')}<br>${state.teacher && state.teacher.school ? `Escola: ${esc(state.teacher.school)}<br>` : ''}${state.teacher && state.teacher.subject ? `Área: ${esc(state.teacher.subject)}<br>` : ''}Gerado em ${fmtDate(todayISO())}</div>
      </div>
      <div class="report-title">Relatório da turma</div>
      <div class="report-sub">${esc(c.name)} · período de ${fmtDate(from)} a ${fmtDate(to)}</div>

      <div class="report-section-title">Resumo</div>
      <div class="report-stat-grid">
        <div class="report-stat"><div class="rv">${alunos.length}</div><div class="rl">Alunos</div></div>
        <div class="report-stat"><div class="rv">${acts.length}</div><div class="rl">Atividades</div></div>
        <div class="report-stat"><div class="rv">${pct}%</div><div class="rl">Entrega</div></div>
        <div class="report-stat"><div class="rv">${occ.length}</div><div class="rl">Ocorrências</div></div>
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:6px;">${participacao} registro(s) positivo(s) de participação/comportamento no período.</p>

      <div class="report-section-title">Alunos</div>
      <table class="report-table"><thead><tr><th>Aluno</th><th>Entregas</th><th>Pendências</th><th>Registros</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.d}/${acts.length}</td><td>${r.pend}</td><td>${r.regs}</td></tr>`).join('') || `<tr><td colspan="4">Nenhum aluno nesta turma.</td></tr>`}
      </tbody></table>

      <div class="report-signature">
        <div class="sig-line">Assinatura do professor(a)</div>
        <div class="sig-line">Data: ${fmtDate(todayISO())}</div>
      </div>
    </div>
    </div>
  `;
}

function doPrintReport() { window.print(); }

function safeFileName(name) {
  return String(name || 'relatorio')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
    .toLowerCase() || 'relatorio';
}

async function doExportPdf() {
  const area = document.getElementById('reportPrintArea');
  if (!area) return;
  if (!window.jspdf || !window.html2canvas) {
    toast('O exportador de PDF não está disponível. Use "Imprimir" e escolha "Salvar como PDF".', 'error');
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

/* ==================== ARQUIVO / CONFIGURAÇÕES ==================== */

function renderArquivo() {
  if (demoMode) {
    return `
      <div class="page-head"><div><h1>Demonstração</h1><div class="page-sub">Explore o ProfessorGest com dados de exemplo.</div></div><div class="page-actions"><button type="button" class="btn-primary" id="btnExitDemo">Criar meu arquivo</button></div></div>
      <div class="card demo-file-card">
        <div class="section-title" style="margin-top:0;">Ambiente de demonstração</div>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px;">Navegue pelas telas, abra alunos, veja atividades e experimente os relatórios. Este ambiente não substitui seu arquivo.</p>
        <div class="demo-feature-grid">
          <div><strong>2 turmas</strong><span>com alunos e atividades</span></div>
          <div><strong>5 alunos</strong><span>com histórico e registros</span></div>
          <div><strong>Relatórios</strong><span>individuais e por turma</span></div>
        </div>
        <button type="button" class="btn-secondary btn-block" id="btnExitDemoSecondary">Sair da demonstração</button>
      </div>
    `;
  }
  return `
    <div class="page-head"><div><h1>Arquivo</h1><div class="page-sub">Gerencie seu projeto local e seus arquivos .prof.</div></div><div class="page-actions"><button type="button" class="btn-secondary" id="btnNewFile">${ICONS.file} Novo arquivo</button></div></div>
    <div class="card" style="max-width:480px;">
      <div class="section-title" style="margin-top:0;">Arquivo atual</div>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:6px;display:flex;align-items:center;gap:7px;">
        ${ICONS.file}${currentFileName ? `<strong style="color:var(--text);">${esc(currentFileName)}</strong>` : 'Novo projeto em branco — ainda não salvo.'}
      </p>
      <p class="topbar-status ${isDirty ? 'dirty' : 'saved'}" style="margin-bottom:18px;font-size:12px;">
        <span class="status-dot"></span>${isDirty ? 'Alterações não salvas' : 'Tudo salvo'}
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button type="button" class="btn-secondary btn-block" id="btnOpenFile">${ICONS.folder} Abrir arquivo (.prof)</button>
        <button type="button" class="btn-primary btn-block" id="btnSaveFile">${ICONS.save} Salvar alterações</button>
        <button type="button" class="btn-secondary btn-block" id="btnExportProf">${ICONS.file} Exportar cópia .prof</button>
        <button type="button" class="btn-secondary btn-block" id="btnExportCsv">${ICONS.copy} Exportar alunos (CSV)</button>
        <button type="button" class="btn-secondary btn-block" id="btnImportCsv">${ICONS.folder} Importar alunos (CSV)</button>
      </div>

      <div class="drive-card ${driveStatusTone()}">
        <div class="drive-card-head">
          <div class="drive-card-icon">${ICONS.cloud}</div>
          <div><strong>Google Drive</strong><span>${esc(driveStatusText())}</span></div>
        </div>
        <p>Use o mesmo arquivo no PC e no celular, sem trocar arquivos manualmente.</p>
        <div class="drive-card-actions">
          <button type="button" class="btn-secondary" id="btnDriveOpen">${ICONS.folder} Abrir do Drive</button>
          <button type="button" class="btn-primary" id="btnDriveAction">${driveBindingForCurrentProject() ? ICONS.cloud + ' Sincronizar agora' : ICONS.save + ' Salvar no Drive'}</button>
          ${driveBindingForCurrentProject() ? `<button type="button" class="btn-ghost" id="btnDriveDisconnect">Desvincular</button>` : ''}
        </div>
      </div>

      <p style="font-size:11.5px;color:var(--text-muted);margin-top:16px;">
        No computador, o ProfessorGest pode atualizar diretamente o mesmo arquivo <strong>.prof</strong>.
        Em navegadores móveis que não permitem escrever de volta no arquivo aberto, as alterações ficam salvas neste dispositivo; use <strong>Exportar cópia .prof</strong> para gerar um arquivo compartilhável.
      </p>
      <p style="font-size:11px;color:var(--text-muted);margin-top:10px;">
        Criado em ${fmtDate(state.createdAt)} · Última alteração salva em ${fmtDateTime(state.updatedAt)} · Formato versão ${state.version || 1}
      </p>
    </div>
    <input type="file" id="csvInput" accept=".csv" style="display:none">
  `;
}

function renderConfiguracoes() {
  const mode = getThemeMode();
  return `
    <div class="page-head">
      <div>
        <h1>Configurações</h1>
        <div class="page-sub">Personalize sua experiência no ProfessorGest.</div>
      </div>
    </div>

    <div class="grid grid-2">
      <section class="card">
        <div class="section-title" style="margin-top:0;">Perfil do professor</div>
        <p class="form-hint" style="margin-bottom:14px;">Estas informações ajudam a personalizar o dashboard e os relatórios.</p>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Nome do professor(a)</label>
            <input class="form-input" id="teacherNameInput" value="${esc((state.teacher && state.teacher.name) || '')}" placeholder="Ex.: Prof. João">
          </div>
          <div class="form-group">
            <label class="form-label">Disciplina / área</label>
            <input class="form-input" id="teacherSubjectInput" value="${esc((state.teacher && state.teacher.subject) || '')}" placeholder="Ex.: Matemática">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Escola / instituição</label>
          <input class="form-input" id="teacherSchoolInput" value="${esc((state.teacher && state.teacher.school) || '')}" placeholder="Ex.: Escola Municipal Aurora">
        </div>
        <button type="button" class="btn-primary btn-sm" id="btnSaveTeacherName">Salvar alterações</button>
      </section>

      <section class="card">
        <div class="section-title" style="margin-top:0;">Sincronização</div>
        <p class="form-hint" style="margin-bottom:12px;">O Google Drive é opcional. Quando conectado, o arquivo atual pode ser usado no computador e no celular.</p>
        <div class="drive-settings-status ${driveStatusTone()}">
          <span class="drive-settings-icon">${ICONS.cloud}</span>
          <div><strong>${esc(driveStatusText())}</strong><span>${driveBindingForCurrentProject() ? `Arquivo: ${esc(driveBinding.name || currentFileName || 'Projeto')}` : 'Você pode conectar quando quiser.'}</span></div>
        </div>
        <div class="form-actions" style="margin-top:14px;">
          <button type="button" class="btn-secondary" id="btnDriveOpenSettings">${ICONS.folder} Abrir do Drive</button>
          <button type="button" class="btn-primary" id="btnDriveActionSettings">${driveBindingForCurrentProject() ? ICONS.cloud + ' Sincronizar' : ICONS.save + ' Salvar no Drive'}</button>
        </div>
        ${driveBindingForCurrentProject() ? `<button type="button" class="btn-ghost" id="btnDriveDisconnectSettings" style="margin-top:8px;">Desvincular deste projeto</button>` : ''}
      </section>

      <section class="card">
        <div class="section-title" style="margin-top:0;">Diagnóstico técnico</div>
        <p class="form-hint" style="margin-bottom:12px;">Somente erros JavaScript, falhas de leitura/gravação e problemas de importação/exportação são registrados localmente neste dispositivo. O log não é enviado para um servidor.</p>
        <p id="devLogSummary" class="form-hint" style="margin-bottom:12px;">${getDevLogEntries().length} erro(s) registrado(s).</p>
        <div class="form-actions">
          <button type="button" class="btn-secondary" id="btnExportDevLog">${ICONS.file} Baixar log técnico</button>
          <button type="button" class="btn-ghost" id="btnClearDevLog">Limpar log</button>
        </div>
      </section>

      <section class="card">
        <div class="section-title" style="margin-top:0;">Aparência</div>
        <p class="form-hint" style="margin-bottom:4px;">Escolha como o ProfessorGest deve aparecer neste dispositivo.</p>
        <div class="theme-setting-grid">
          <button type="button" class="theme-option ${mode === 'light' ? 'active' : ''}" data-theme-mode="light">
            <div class="theme-preview light"></div>
            <strong>Claro</strong>
            <span>Visual leve e luminoso.</span>
          </button>
          <button type="button" class="theme-option ${mode === 'dark' ? 'active' : ''}" data-theme-mode="dark">
            <div class="theme-preview dark"></div>
            <strong>Escuro</strong>
            <span>Confortável para ambientes com pouca luz.</span>
          </button>
          <button type="button" class="theme-option ${mode === 'system' ? 'active' : ''}" data-theme-mode="system">
            <div class="theme-preview system"></div>
            <strong>Sistema</strong>
            <span>Segue a preferência do dispositivo.</span>
          </button>
        </div>
      </section>
    </div>
  `;
}

/* ==================== MODAIS: formulários ==================== */

function openModal(html, wide, extraClass = '') {
  document.getElementById('modalRoot').innerHTML = `<div class="modal-overlay" id="modalOverlay"><div class="modal-box ${wide ? 'wide' : ''} ${extraClass}">${html}</div></div>`;
  document.getElementById('modalOverlay').addEventListener('mousedown', e => { if (e.target.id === 'modalOverlay') { if (document.querySelector('.mobile-menu-box')) closeMobileMenu(); else closeModal(); } });
  bindModalEvents();
  const firstInput = document.querySelector('.modal-box input, .modal-box textarea, .modal-box select');
  if (firstInput) firstInput.focus();
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

function classOptions(selectedId) {
  return state.classes.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function openClassModal(existing) {
  openModal(`
    <div class="modal-title">${existing ? 'Editar turma' : 'Nova turma'}</div>
    <form id="classForm">
      <div class="form-group"><label class="form-label">Nome da turma</label>
        <input class="form-input" name="name" required value="${existing ? esc(existing.name) : ''}" placeholder="Ex: 2º Ano A"></div>
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
      <div class="form-group"><label class="form-label">Nome do aluno</label>
        <input class="form-input" name="name" required value="${existing ? esc(existing.name) : ''}" placeholder="Nome completo"></div>
      <div class="form-group"><label class="form-label">Turma</label><select class="form-select" name="classId">${classOptions(existing ? existing.classId : presetClassId)}</select></div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button>
        <button type="submit" class="btn-primary">${existing ? 'Salvar' : 'Adicionar aluno'}</button></div>
    </form>
  `);
  document.getElementById('studentForm').dataset.editId = existing ? existing.id : '';
}

function openActivityModal(existing, presetClassId) {
  openModal(`
    <div class="modal-title">${existing ? 'Editar atividade' : 'Nova atividade'}</div>
    <form id="activityForm">
      <div class="form-group"><label class="form-label">Nome da atividade</label>
        <input class="form-input" name="name" required value="${existing ? esc(existing.name) : ''}" placeholder="Ex: Lista de exercícios"></div>
      <div class="form-group"><label class="form-label">Turma</label><select class="form-select" name="classId">${classOptions(existing ? existing.classId : (presetClassId || ctx.classId))}</select></div>
      <div class="form-group"><label class="form-label">Data de entrega</label><input class="form-input" type="date" name="dueDate" required value="${existing ? existing.dueDate : todayISO()}"></div>
      <div class="form-group"><label class="form-label">Descrição</label><textarea class="form-textarea" name="description" placeholder="Opcional">${existing ? esc(existing.description || '') : ''}</textarea></div>
      ${existing ? '<p class="form-hint">As marcações de entrega já registradas serão mantidas.</p>' : ''}
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button>
        <button type="submit" class="btn-primary">${existing ? 'Salvar alterações' : 'Criar atividade'}</button></div>
    </form>
  `);
  document.getElementById('activityForm').dataset.editId = existing ? existing.id : '';
}

function openObservationModal(student, existing) {
  openModal(`
    <div class="modal-title">${existing ? 'Editar observação' : 'Nova observação'}</div>
    <form id="observationForm">
      <div class="form-group"><label class="form-label">Data</label><input class="form-input" type="date" name="date" value="${existing ? existing.date : todayISO()}"></div>
      <div class="form-group"><label class="form-label">Observação</label><textarea class="form-textarea" name="text" required placeholder="Ex: Demonstrou avanço em leitura esta semana.">${existing ? esc(existing.text) : ''}</textarea></div>
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
    <div class="form-group"><label class="form-label">Quem?</label>
      <input class="form-input input-search" id="quickSearchInput" placeholder="Pesquisar aluno..." value="${esc(searchTerm || '')}"></div>
    <div class="list-card" id="quickStudentList" style="max-height:280px;overflow-y:auto;">
      ${list.map(s => `<div class="list-item"><div class="list-item-main" data-pick-student="${s.id}">
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
  const opts = OCCUR_TYPES.map(t => `<button type="button" class="quick-opt ${editingOcc && editingOcc.type === t.key ? 'selected' : ''}" data-occ-type="${t.key}">${t.emoji} ${t.label}</button>`).join('');
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
      <div class="form-group"><label class="form-label">Data</label><input class="form-input" type="date" name="date" value="${editingOcc ? editingOcc.date : todayISO()}"></div>
      <div class="form-group"><label class="form-label">Descrição (opcional)</label><textarea class="form-textarea" name="description" placeholder="Detalhes...">${editingOcc ? esc(editingOcc.description || '') : ''}</textarea></div>
      <div class="form-actions"><button type="button" class="btn-secondary" id="modalCancel">Cancelar</button>
        <button type="submit" class="btn-primary">${editingOcc ? 'Salvar alterações' : (multi ? 'Registrar para todos' : 'Registrar')}</button></div>
    </form>
  `);
  document.getElementById('occurForm').dataset.editId = editingOcc ? editingOcc.id : '';
  const changeBtn = document.getElementById('changeStudentBtn');
  if (changeBtn) changeBtn.onclick = () => openOccurrenceStep1('', ctx.classId || '');
}

function rerenderModalKeepFocus(renderFn) {
  const active = document.activeElement;
  const id = active && active.id;
  const start = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  const end = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
  renderFn();
  if (id) {
    const el = document.getElementById(id);
    if (el) { el.focus(); if (start !== null && el.setSelectionRange) { try { el.setSelectionRange(start, end); } catch (e) {} } }
  }
}

function showFileErrorModal(message) {
  openModal(`
    <div class="confirm-icon danger">${ICONS.alert}</div>
    <div class="modal-title">Não foi possível abrir este arquivo</div>
    <p class="confirm-body" style="margin-bottom:18px;">${esc(message)}</p>
    <div class="form-actions"><button type="button" class="btn-primary" id="modalCancel">Entendi</button></div>
  `);
}

/* --- modal de confirmação genérico (substitui confirm() nas exclusões) --- */

function confirmModal({ title, body, detailList, confirmLabel, danger, onConfirm }) {
  openModal(`
    <div class="confirm-icon ${danger ? 'danger' : 'info'}">${danger ? ICONS.trash : ICONS.alert}</div>
    <div class="modal-title">${esc(title)}</div>
    <p class="confirm-body">${esc(body)}</p>
    ${detailList && detailList.length ? `<ul class="confirm-detail-list">${detailList.map(([k, v]) => `<li><span>${esc(k)}</span><strong>${esc(String(v))}</strong></li>`).join('')}</ul>` : ''}
    <div class="form-actions">
      <button type="button" class="btn-secondary" id="modalCancel">Cancelar</button>
      <button type="button" class="${danger ? 'btn-danger-solid' : 'btn-primary'}" id="confirmModalOk">${esc(confirmLabel || 'Confirmar')}</button>
    </div>
  `);
  document.getElementById('confirmModalOk').onclick = () => { closeModal(); onConfirm(); };
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
    { icon: 'plus', label: 'Registro rápido', run: () => openOccurrenceModal() },
    { icon: 'users', label: 'Nova turma', run: () => openClassModal(null) },
    { icon: 'user', label: 'Novo aluno', run: () => openStudentModal(null, null) },
    { icon: 'clipboard', label: 'Nova atividade', run: () => openActivityModal(null) },
    { icon: 'folder', label: 'Abrir arquivo', run: () => openFile() },
    { icon: 'file', label: 'Criar novo arquivo', run: () => beginNewProjectSetup(true) },
    { icon: 'sparkle', label: 'Explorar demonstração', run: () => beginDemoMode() },
    { icon: 'save', label: 'Salvar arquivo', run: () => saveFile() },
  ].filter(a => !t || a.label.toLowerCase().includes(t));

  const classes = state.classes.filter(c => !t || c.name.toLowerCase().includes(t)).slice(0, 5);
  const students = state.students.filter(s => !t || s.name.toLowerCase().includes(t)).slice(0, 6);
  const activities = state.activities.filter(a => !t || a.name.toLowerCase().includes(t)).slice(0, 5);

  const hasResults = actions.length || classes.length || students.length || activities.length;

  root.innerHTML = `
    <div class="cmdk-overlay" id="cmdkOverlay">
      <div class="cmdk-box">
        <div class="cmdk-input-row">${ICONS.search}<input class="cmdk-input" id="cmdkInput" placeholder="Pesquisar alunos, turmas, atividades ou ações..." value="${esc(term || '')}"><span class="cmdk-esc">ESC</span></div>
        <div class="cmdk-results">
          ${!hasResults ? `<div class="cmdk-empty">Nenhum resultado encontrado.</div>` : `
          ${students.length ? `<div class="cmdk-group-label">ALUNOS</div>${students.map(s => `<div class="cmdk-item" data-cmdk-student="${s.id}">${ICONS.user}<span>${esc(s.name)}</span><span class="cmdk-item-sub">${esc(classNameOf(s.classId))}</span></div>`).join('')}` : ''}
          ${classes.length ? `<div class="cmdk-group-label">TURMAS</div>${classes.map(c => `<div class="cmdk-item" data-cmdk-class="${c.id}">${ICONS.users}<span>${esc(c.name)}</span></div>`).join('')}` : ''}
          ${activities.length ? `<div class="cmdk-group-label">ATIVIDADES</div>${activities.map(a => `<div class="cmdk-item" data-cmdk-activity="${a.id}">${ICONS.clipboard}<span>${esc(a.name)}</span><span class="cmdk-item-sub">${fmtDate(a.dueDate)}</span></div>`).join('')}` : ''}
          ${actions.length ? `<div class="cmdk-group-label">AÇÕES</div>${actions.map((a, i) => `<div class="cmdk-item" data-cmdk-action="${i}">${ICONS[a.icon]}<span>${esc(a.label)}</span></div>`).join('')}` : ''}
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
  qAll('[data-cmdk-action]').forEach(el => el.onclick = () => { const a = actions[Number(el.dataset.cmdkAction)]; closeCommandPalette(); if (a) a.run(); });
}

function closeCommandPalette() { document.getElementById('cmdkRoot').innerHTML = ''; }

/* ==================== interações da view ==================== */

function bindViewEvents() {
  qAll('[data-open-class]').forEach(el => el.onclick = () => { ctx.classId = el.dataset.openClass; ctx.classTab = 'visao'; navigate('turmaDetail', false); });
  qAll('[data-open-student]').forEach(el => el.onclick = () => { ctx.studentId = el.dataset.openStudent; ctx.studentTab = 'visao'; ctx.histFilter = 'todos'; ctx.histMonth = ''; navigate('alunoDetail', false); });
  qAll('[data-open-activity]').forEach(el => el.onclick = () => { ctx.activityId = el.dataset.openActivity; navigate('atividadeDetail', false); });

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
    if (el.checked) ctx.bulkSelected.add(el.dataset.bulkStudent); else ctx.bulkSelected.delete(el.dataset.bulkStudent);
    render();
  });
  onClick('#btnBulkSelectAll', () => {
    const ids = currentView === 'atividadeDetail' ? studentsOf(state.activities.find(a => a.id === ctx.activityId).classId).map(s => s.id) : studentsOf(ctx.classId).map(s => s.id);
    ctx.bulkSelected = new Set(ids); render();
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
  onClick('#btnAddStudentHere', () => openStudentModal(null, ctx.classId));
  qAll('[data-edit-student]').forEach(el => el.onclick = e => { e.stopPropagation(); openStudentModal(studentById(el.dataset.editStudent)); });
  qAll('[data-quick-occ-student]').forEach(el => el.onclick = e => { e.stopPropagation(); openOccurrenceModal(el.dataset.quickOccStudent); });
  qAll('[data-del-student]').forEach(el => el.onclick = e => { e.stopPropagation(); deleteStudent(el.dataset.delStudent); });
  onClick('#btnEditThisStudent', () => openStudentModal(studentById(ctx.studentId)));
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
  const activityClassFilterSelect = q('#activityClassFilterSelect');
  if (activityClassFilterSelect) activityClassFilterSelect.onchange = () => { ctx.activityClassFilter = activityClassFilterSelect.value; render(); };

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
  onClick('#btnExportProf', () => exportCurrentProfFile());
  onClick('#btnDriveOpen', openDrivePicker);
  onClick('#btnDriveAction', saveCurrentToGoogleDrive);
  onClick('#btnDriveDisconnect', disconnectCurrentDriveFile);
  onClick('#btnDriveOpenSettings', openDrivePicker);
  onClick('#btnDriveActionSettings', saveCurrentToGoogleDrive);
  onClick('#btnDriveDisconnectSettings', disconnectCurrentDriveFile);
  onClick('#btnExportDevLog', () => exportDevLog());
  onClick('#btnClearDevLog', () => {
    clearDevLog();
    toast('Log técnico limpo.', 'success');
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
  const idMap = {};
  studentsOf(classId).forEach(s => {
    const ns = { id: uid('stu'), name: s.name, classId: newClass.id, notes: '', observations: [] };
    idMap[s.id] = ns.id;
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

function parseCSVLine(line) {
  const parts = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (quoted && next === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  return parts;
}

function handleCsvImportInput(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    const text = String(evt.target.result || '').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (!lines.length) { toast('O CSV está vazio.', 'error'); return; }

    const first = parseCSVLine(lines[0]).map(v => v.toLowerCase());
    const hasHeader = first.some(v => v === 'nome' || v === 'aluno' || v === 'turma');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    let added = 0, skipped = 0;
    dataLines.forEach(line => {
      const parts = parseCSVLine(line);
      const name = parts[0] || '';
      if (!name) { skipped++; return; }

      const className = parts[1] || '';
      let cls = className
        ? state.classes.find(c => c.name.toLowerCase() === className.toLowerCase())
        : null;

      if (className && !cls) {
        cls = { id: uid('class'), name: className, archived: false };
        state.classes.push(cls);
      }

      const duplicate = state.students.some(s =>
        s.name.trim().toLowerCase() === name.trim().toLowerCase() &&
        (cls ? s.classId === cls.id : !s.classId)
      );
      if (duplicate) { skipped++; return; }

      state.students.push({
        id: uid('stu'),
        name: name.trim(),
        classId: cls ? cls.id : null,
        notes: '',
        observations: []
      });
      added++;
    });

    if (added) markDirty();
    const suffix = skipped ? ` ${skipped} linha(s) ignorada(s).` : '';
    toast(`${added} aluno(s) importado(s) do CSV.${suffix}`, added ? 'success' : 'error');
    render();
  };
  reader.onerror = () => toast('Não foi possível ler o arquivo CSV.', 'error');
  reader.readAsText(file, 'utf-8');
}

/* ==================== arquivo .prof: abrir, validar, salvar, migrar ==================== */

function buildSavePayload() {
  return {
    format: PROF_FORMAT,
    version: CURRENT_VERSION,
    createdAt: state.createdAt || todayISO(),
    updatedAt: new Date().toISOString(),
    teacher: state.teacher,
    classes: state.classes,
    students: state.students,
    activities: state.activities,
    occurrences: state.occurrences,
  };
}

function migrateCompletions(completions) {
  const out = {};
  if (completions && typeof completions === 'object') {
    Object.keys(completions).forEach(sid => {
      const v = completions[sid];
      if (v === true) out[sid] = 'delivered';
      else if (v === false) out[sid] = 'not_delivered';
      else if (v === 'delivered' || v === 'not_delivered' || v === 'pending') out[sid] = v;
    });
  }
  return out;
}

// Arquivos criados pela primeira versão do MVP (sem "format"/"version").
function migrateLegacyToV1(data) {
  return {
    format: PROF_FORMAT, version: 1,
    createdAt: todayISO(), updatedAt: todayISO(),
    teacher: data.teacher || { name: 'Professor' },
    classes: data.classes || [],
    students: (data.students || []).map(s => ({ notes: '', ...s })),
    activities: (data.activities || []).map(a => ({ ...a, completions: migrateCompletions(a.completions) })),
    occurrences: data.occurrences || [],
  };
}

// v1 -> v2: adiciona "archived" às turmas e "observations" datadas aos alunos,
// preservando 100% dos dados existentes (nenhuma informação é removida).
function migrateV1toV2(data) {
  return {
    ...data, version: 2,
    classes: data.classes.map(c => ({ archived: false, ...c })),
    students: data.students.map(s => ({ observations: [], ...s, notes: typeof s.notes === 'string' ? s.notes : '' })),
  };
}

function normalizeProfFileName(name) {
  let value = String(name || '').trim();
  if (!value) return 'ProfessorGest.prof';
  value = value.replace(/\\/g, '/').split('/').pop() || 'ProfessorGest.prof';
  value = value.replace(/(?:\.json)+$/i, '');
  value = value.replace(/(?:\.prof)+$/i, '.prof');
  if (!/\.prof$/i.test(value)) value += '.prof';
  return value;
}

const PROF_MIME = 'application/vnd.professorgest';

function isAndroidDevice() {
  return /Android/i.test(window.navigator?.userAgent || '');
}

// O seletor nativo é mantido para abertura de arquivos porque o Chrome
// Android consegue devolver um FileSystemFileHandle para leitura. Para salvar,
// porém, o Android fica deliberadamente no caminho de download tradicional.
// A especificação do showSaveFilePicker estabelece que a seleção pode criar
// ou limpar o arquivo antes de o conteúdo ser gravado; em implementações
// móveis com falha de commit isso pode deixar um arquivo físico de 0 bytes.
// Como um fallback automático depois dessa etapa criaria um segundo arquivo,
// o Android usa apenas uma estratégia de exportação.
function supportsNativeFilePicker() {
  return typeof window.showOpenFilePicker === 'function';
}

function supportsNativeSavePicker() {
  // No Chrome Android 153 (e neste projeto), o showSaveFilePicker pode criar
  // o arquivo físico vazio antes de uma falha de escrita. O fallback de
  // download é mais previsível no Android e produz uma única saída.
  return !isAndroidDevice() && typeof window.showSaveFilePicker === 'function';
}

function normalizeProfText(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/^\u200B+/, '')
    .replace(/^\u2060+/, '')
    .trim();
}

async function readTextFileUtf8(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function profOpenPickerTypes() {
  return [{
    description: 'ProfessorGest (.prof)',
    accept: {
      [PROF_MIME]: ['.prof', '.prof.json'],
      'application/json': ['.prof', '.prof.json', '.json'],
      'application/octet-stream': ['.prof', '.prof.json'],
      'text/plain': ['.prof', '.prof.json', '.json']
    }
  }];
}

function profSavePickerTypes() {
  return [{
    description: 'ProfessorGest (.prof)',
    accept: { [PROF_MIME]: ['.prof'] }
  }];
}

function applyOpenedData(data, fileName, cloudMeta = null, fileHandle = null, options = {}) {
  state = data;
  demoMode = false;
  currentFileName = normalizeProfFileName(fileName);
  currentFileHandle = fileHandle || null;
  currentStorageMode = cloudMeta?.fileId ? 'drive' : (options.storageMode || (fileHandle ? 'file' : 'local'));
  currentFileLastModified = Number(options.fileLastModified) || 0;
  localProjectSaved = false;
  localProjectSavedAt = 0;
  if (cloudMeta?.fileId) saveDriveBinding(cloudMeta); else clearDriveBinding();
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
    saveUiState = 'dirty';
    toast(`Arquivo aberto, mas ${warnings.length} problema(s) foram encontrados e não serão ignorados silenciosamente. Revise antes de salvar.`, 'info');
    persistLocalRecoveryDraft();
  } else {
    toast('Arquivo aberto com sucesso.', 'success');
    if (options.persistLocal !== false) {
      saveLocalProjectSnapshot({ stateData: data, storageMode: currentStorageMode, fileName: currentFileName, fileHandle: currentFileHandle, fileLastModified: currentFileLastModified }).then(ok => {
        if (!ok) console.warn('[ProfessorGest] A cópia local do arquivo aberto não pôde ser persistida.');
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
      const file = await handle.getFile();
            const text = await readTextFileUtf8(file);
      const result = validateAndParseProf(text);
      if (!result.ok) {
        logError('file.open.invalid', new Error('Arquivo selecionado não passou na validação.'), {
          filename: file.name, mime: file.type || '', size: file.size, errorCode: result.error || 'invalid'
        });
        showFileErrorModal(errorMessage(result.error));
        return;
      }
      applyOpenedData(result.data, file.name, null, /\.prof$/i.test(file.name) ? handle : null, {
        storageMode: 'file',
        fileLastModified: file.lastModified,
        persistLocal: true,
        warnings: result.warnings || [],
      });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') {
                return;
      }
      logError('file.open.native_failed', err, { nativePicker: true, android: isAndroidDevice() });
    }
  }
    document.getElementById('fileInput').click();
}

async function handleFileOpenInput(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
        const text = await readTextFileUtf8(file);
    const result = validateAndParseProf(text);
    if (!result.ok) {
      logError('file.open.invalid', new Error('Arquivo selecionado não passou na validação.'), {
        filename: file.name, mime: file.type || '', size: file.size, errorCode: result.error || 'invalid'
      });
      showFileErrorModal(errorMessage(result.error));
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
    showFileErrorModal('Não foi possível ler o arquivo selecionado.');
  }
}

function profDownloadName(filename) {
  // Mantemos apenas ".prof" (sem sufixo extra). O fallback usa um MIME próprio
  // do formato, evitando que Android/Chrome o trate como JSON por extensão.
  return normalizeProfFileName(filename);
}

function downloadFallback(content, filename, mime) {
  const rawContent = String(content ?? '');
  const isProf = String(filename || '').toLowerCase().endsWith('.prof') || String(filename || '').toLowerCase().endsWith('.prof.json');
  const safeName = isProf ? profDownloadName(filename) : filename;
  // Nunca use application/json para .prof. O arquivo é JSON internamente, mas
  // a extensão oficial é própria. Em Android, um MIME conhecido pode fazer o
  // navegador/gerenciador acrescentar uma extensão derivada do MIME.
  const safeMime = mime || (isProf ? PROF_MIME : 'text/plain;charset=utf-8');
  const androidProf = isProf && isAndroidDevice();
    let objectUrl = null;
  try {
    const bytes = new TextEncoder().encode(rawContent);
    let href;
    let effectiveMime = safeMime;

    // O Chrome Android tem histórico de anexar extensões conhecidas a
    // downloads de Blob com extensões personalizadas. Para .prof pequenos,
    // a URL data: com tipo não registrado evita a inferência de .json.
    // Para projetos maiores, permanecemos no Blob com o MIME proprietário.
    if (androidProf && bytes.length <= 2 * 1024 * 1024) {
      href = `data:attachment/plain;charset=utf-8,${encodeURIComponent(rawContent)}`;
      effectiveMime = 'attachment/plain;charset=utf-8';
    } else {
      const blob = new Blob([bytes], { type: effectiveMime });
      objectUrl = URL.createObjectURL(blob);
      href = objectUrl;
    }

    const a = document.createElement('a');
    a.href = href;
    a.download = safeName;
    a.type = effectiveMime;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }, 15000);
      } catch (err) {
    if (objectUrl) {
      try { URL.revokeObjectURL(objectUrl); } catch (_) {}
    }
    logError('file.download.failed', err, { filename: safeName, mime: safeMime });
    throw err;
  }
}

async function exportCurrentProfFile() {
  if (demoMode || !state) return false;
  const payload = buildSavePayload();
    const json = JSON.stringify(payload, null, 2);
  // Verifica o conteúdo exato que será exportado antes de iniciar o download.
  try {
    const check = JSON.parse(json);
    if (!check || check.format !== PROF_FORMAT || !SUPPORTED_VERSIONS.includes(check.version)) {
      throw new Error('O conteúdo gerado não corresponde ao formato do ProfessorGest.');
    }
  } catch (err) {
    logError('file.export.prepare_failed', err);
    toast(err?.message || 'Não foi possível gerar um JSON válido para exportação.', 'error');
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

async function saveFile({ fromPrimarySave = false, forceOverwrite = false } = {}) {
  if (demoMode) { toast('A demonstração é apenas para explorar o sistema.', 'info'); return false; }
  const saveRevision = dirtyRevision;
  const payload = buildSavePayload();
  const json = JSON.stringify(payload, null, 2);
  const teacherBase = safeFileName(state?.teacher?.name || 'professorgest');
  const suggestedName = currentFileName ? normalizeProfFileName(currentFileName) : `professorgest-${teacherBase}.prof`;

  if (currentFileHandle && !forceOverwrite) {
    const conflict = await checkExternalFileConflict(false);
    if (conflict) {
      saveUiState = 'dirty';
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
      saveUiState = 'dirty';
      persistLocalRecoveryDraft();
      updateSaveChrome();
      render();
      return true;
    }

    const localPersisted = await saveLocalProjectSnapshot({ stateData: payload, storageMode: currentStorageMode, fileName: currentFileName, fileHandle: currentFileHandle, fileLastModified: currentFileLastModified });
    if (!localPersisted && currentStorageMode === 'local') {
      isDirty = true;
      saveUiState = 'dirty';
      persistLocalRecoveryDraft();
      updateSaveChrome();
      toast('Não foi possível salvar no armazenamento deste dispositivo. As alterações continuam protegidas; tente novamente.', 'error');
      render();
      return false;
    }
    discardLocalRecoveryDraft();
    clearDirty({ expectedRevision: saveRevision });
    if (!driveBindingForCurrentProject()) {
      cloudSyncPending = false;
      saveUiState = 'saved';
      updateSaveChrome();
      toast(currentStorageMode === 'local' ? 'Alterações salvas neste dispositivo.' : 'Arquivo salvo com sucesso.', 'success');
      render();
      return true;
    }
    try {
      const synced = await syncCurrentProjectToDrive({ silent: true });
      if (synced) {
        cloudSyncPending = false;
        lastCloudSyncAt = Date.now();
        saveUiState = 'synced';
        toast('Arquivo salvo e sincronizado com Google Drive.', 'success');
      } else {
        cloudSyncPending = true;
        saveUiState = 'saved';
        toast('Arquivo salvo neste dispositivo. A sincronização com o Drive ficou pendente.', 'info');
      }
    } catch (err) {
      cloudSyncPending = true;
      saveUiState = 'saved';
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
      saveUiState = 'saving'; updateSaveChrome();
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
      if (err && err.name === 'AbortError') { saveUiState = 'dirty'; updateSaveChrome(); return false; }
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

function errorMessage(code) {
  switch (code) {
    case 'json': return 'O arquivo não é um JSON válido.';
    case 'version': return 'Este arquivo usa uma versão do ProfessorGest que ainda não é suportada por este aplicativo.';
    case 'shape': return 'O arquivo está incompleto ou corrompido (faltam dados essenciais como turmas, alunos, atividades ou ocorrências).';
    default: return 'O arquivo não parece ser um projeto válido do ProfessorGest.';
  }
}

// Lê o texto de um .prof, valida a estrutura, migra v1 -> v2 quando necessário
// e devolve dados "seguros" para usar na aplicação.
function validateAndParseProf(text) {
  let normalized = normalizeProfText(text);
  // Alguns gerenciadores/editoriais móveis podem transportar JSON em um
  // bloco Markdown ou como uma string JSON serializada. Aceitamos esses casos
  // somente quando o conteúdo interno realmente é um objeto de projeto.
  if (normalized.startsWith('```')) {
    normalized = normalized.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  let data;
  try {
    data = JSON.parse(normalized);
    if (typeof data === 'string') {
      const nested = normalizeProfText(data);
      if (nested.startsWith('{')) data = JSON.parse(nested);
    }
  } catch (e) {
    logError('file.validation.json', e);
    return { ok: false, error: 'json' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, error: 'invalid' };

  if (!data.format) {
    const looksLikeProject = Array.isArray(data.classes) || Array.isArray(data.students) || Array.isArray(data.activities) || Array.isArray(data.occurrences);
    if (!looksLikeProject) return { ok: false, error: 'invalid' };
    data = migrateLegacyToV1(data);
  }

  if (data.format !== PROF_FORMAT) return { ok: false, error: 'format' };
  if (!SUPPORTED_VERSIONS.includes(data.version)) return { ok: false, error: 'version' };
  if (!Array.isArray(data.classes) || !Array.isArray(data.students) || !Array.isArray(data.activities) || !Array.isArray(data.occurrences)) {
    return { ok: false, error: 'shape' };
  }

  if (data.version === 1) data = migrateV1toV2(data);

  const warnings = [];
  const validClasses = data.classes.filter(c => c && c.id && c.name);
  const validStudents = data.students.filter(s => s && s.id && s.name);
  const validActivities = data.activities.filter(a => a && a.id && a.name);
  const validOccurrences = data.occurrences.filter(o => o && o.id && o.studentId);
  if (validClasses.length !== data.classes.length) warnings.push(`turmas inválidas: ${data.classes.length - validClasses.length}`);
  if (validStudents.length !== data.students.length) warnings.push(`alunos inválidos: ${data.students.length - validStudents.length}`);
  if (validActivities.length !== data.activities.length) warnings.push(`atividades inválidas: ${data.activities.length - validActivities.length}`);
  if (validOccurrences.length !== data.occurrences.length) warnings.push(`ocorrências inválidas: ${data.occurrences.length - validOccurrences.length}`);

  const safe = {
    format: PROF_FORMAT, version: 2,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : todayISO(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : todayISO(),
    teacher: (data.teacher && typeof data.teacher === 'object') ? { name: String(data.teacher.name || 'Professor'), school: String(data.teacher.school || ''), subject: String(data.teacher.subject || '') } : { name: 'Professor', school: '', subject: '' },
    classes: validClasses.map(c => ({ id: String(c.id), name: String(c.name), archived: !!c.archived })),
    students: validStudents.map(s => ({
      id: String(s.id), name: String(s.name), classId: s.classId || null,
      notes: typeof s.notes === 'string' ? s.notes : '',
      observations: Array.isArray(s.observations) ? s.observations.filter(o => o && o.id && o.date).map(o => ({ id: String(o.id), date: String(o.date), text: typeof o.text === 'string' ? o.text : '' })) : [],
    })),
    activities: validActivities.map(a => ({
      id: String(a.id), name: String(a.name), classId: a.classId || null,
      dueDate: typeof a.dueDate === 'string' ? a.dueDate : todayISO(),
      description: typeof a.description === 'string' ? a.description : '',
      completions: migrateCompletions(a.completions),
    })),
    occurrences: validOccurrences.map(o => ({
      id: String(o.id), studentId: String(o.studentId),
      date: typeof o.date === 'string' ? o.date : todayISO(),
      type: typeof o.type === 'string' ? o.type : 'observacao',
      description: typeof o.description === 'string' ? o.description : '',
    })),
  };
  return { ok: true, data: safe, warnings };
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
    format: PROF_FORMAT, version: 2,
    createdAt: todayISO(), updatedAt: todayISO(),
    teacher: { name: 'Mariana Alves', school: 'Colégio Horizonte', subject: 'Língua Portuguesa' },
    classes: [{ id: c1, name: '1º Ano A', archived: false }, { id: c2, name: '2º Ano A', archived: false }],
    students: s, activities, occurrences,
  };
}