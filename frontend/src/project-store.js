/**
 * Armazenamento local de PROJETOS (fonte principal de verdade do ProfessorGest).
 *
 * Conceitos:
 *  - Projeto = entidade principal, identificada por um projectId estável.
 *  - IndexedDB = armazenamento local. O ".prg" é só formato portátil.
 *  - Google Drive = cópia remota; o vínculo (driveLink) vive DENTRO dos
 *    metadados do projeto, então some junto com ele (sem vínculos órfãos).
 *  - Backups e recovery pertencem a um projectId.
 *
 * Stores: projects (metadados leves p/ listagem), projectData (dados completos),
 *         backups, recovery, settings.
 *
 * O acesso passa por um "adapter" (IndexedDB real ou memória), o que permite
 * testar o comportamento de verdade sem navegador.
 */
import { PRG_FORMAT, PRG_VERSION, createProjectId, isSafeId } from './prof-model.js';

export const PROJECT_DB_NAME = 'professorgest-projects-v2';
export const PROJECT_DB_VERSION = 1;
export const LEGACY_DB_NAME = 'professorgest-local-prg-v1';
export const STORES = Object.freeze({
  projects: 'projects',
  projectData: 'projectData',
  backups: 'backups',
  recovery: 'recovery',
  settings: 'settings',
});
export const ALL_STORES = Object.freeze(Object.values(STORES));
export const MAX_BACKUPS_PER_PROJECT = 10;
export const DEFAULT_BACKUP_INTERVAL_MS = 10 * 60 * 1000;
export const IMPORT_MODES = Object.freeze({ NEW: 'new', REPLACE: 'replace', COPY: 'copy' });

export class ProjectStoreError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ProjectStoreError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/* ------------------------------------------------------------------ */
/* Adapters                                                            */
/* ------------------------------------------------------------------ */

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/** Adapter em memória, com transações serializadas e rollback em erro. */
export function createMemoryAdapter() {
  const data = new Map(ALL_STORES.map(name => [name, new Map()]));
  let queue = Promise.resolve();

  function api(allowed, writable) {
    const store = name => {
      if (!allowed.includes(name)) throw new Error(`Store fora da transação: ${name}`);
      return data.get(name);
    };
    const assertWritable = () => { if (!writable) throw new Error('Transação somente leitura.'); };
    const sortedKeys = name => [...store(name).keys()].sort();
    return {
      async get(name, key) { return clone(store(name).get(key)); },
      async put(name, key, value) { assertWritable(); store(name).set(key, clone(value)); },
      async delete(name, key) { assertWritable(); store(name).delete(key); },
      async getAll(name) { return sortedKeys(name).map(k => clone(store(name).get(k))); },
      async keys(name) { return sortedKeys(name); },
      async getAllByPrefix(name, prefix) {
        return sortedKeys(name).filter(k => k.startsWith(prefix)).map(k => clone(store(name).get(k)));
      },
      async keysByPrefix(name, prefix) { return sortedKeys(name).filter(k => k.startsWith(prefix)); },
      async deleteByPrefix(name, prefix) {
        assertWritable();
        sortedKeys(name).filter(k => k.startsWith(prefix)).forEach(k => store(name).delete(k));
      },
      async clear(name) { assertWritable(); store(name).clear(); },
    };
  }

  return {
    kind: 'memory',
    transaction(storeNames, mode, fn) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const writable = mode === 'readwrite';
      const run = async () => {
        const snapshot = writable ? names.map(n => [n, new Map([...data.get(n)].map(([k, v]) => [k, clone(v)]))]) : null;
        try {
          return await fn(api(names, writable));
        } catch (error) {
          if (snapshot) snapshot.forEach(([n, copy]) => data.set(n, copy));
          throw error;
        }
      };
      const result = queue.then(run, run);
      queue = result.catch(() => {});
      return result;
    },
  };
}

/** Adapter do IndexedDB real. */
export function createIndexedDbAdapter({ indexedDBLike = globalThis.indexedDB, name = PROJECT_DB_NAME, version = PROJECT_DB_VERSION, keyRange = globalThis.IDBKeyRange } = {}) {
  let dbPromise = null;

  function open() {
    if (!indexedDBLike) return Promise.reject(new ProjectStoreError('NO_INDEXEDDB', 'IndexedDB não está disponível neste navegador.'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDBLike.open(name, version);
      request.onupgradeneeded = () => {
        const db = request.result;
        ALL_STORES.forEach(store => { if (!db.objectStoreNames.contains(store)) db.createObjectStore(store); });
      };
      request.onblocked = () => reject(new ProjectStoreError('BLOCKED', 'O armazenamento está bloqueado por outra aba do ProfessorGest.'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { try { db.close(); } catch (_) {} dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => { dbPromise = null; reject(request.error || new Error('Não foi possível abrir o armazenamento local.')); };
    });
    return dbPromise;
  }

  const wrap = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const prefixRange = prefix => keyRange.bound(prefix, `${prefix}\uffff`);

  return {
    kind: 'indexeddb',
    async transaction(storeNames, mode, fn) {
      const db = await open();
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      return new Promise((resolve, reject) => {
        const tx = db.transaction(names, mode);
        let result;
        const store = n => tx.objectStore(n);
        const api = {
          get: (n, key) => wrap(store(n).get(key)),
          put: (n, key, value) => wrap(store(n).put(value, key)),
          delete: (n, key) => wrap(store(n).delete(key)),
          getAll: n => wrap(store(n).getAll()),
          keys: n => wrap(store(n).getAllKeys()),
          getAllByPrefix: (n, prefix) => wrap(store(n).getAll(prefixRange(prefix))),
          keysByPrefix: (n, prefix) => wrap(store(n).getAllKeys(prefixRange(prefix))),
          deleteByPrefix: (n, prefix) => wrap(store(n).delete(prefixRange(prefix))),
          clear: n => wrap(store(n).clear()),
        };
        Promise.resolve().then(() => fn(api)).then(
          value => { result = value; },
          error => { try { tx.abort(); } catch (_) {} reject(error); },
        );
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error || new Error('A operação de armazenamento foi cancelada.'));
        tx.onerror = () => reject(tx.error || new Error('Não foi possível concluir a operação de armazenamento.'));
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Metadados                                                           */
/* ------------------------------------------------------------------ */

export function projectNameOf(state) {
  const explicit = String(state?.name ?? '').trim();
  if (explicit) return explicit;
  const teacher = String(state?.teacher?.name ?? '').trim();
  if (teacher && teacher !== 'Professor') return `Projeto de ${teacher}`;
  return 'Projeto sem nome';
}

export function summarizeProject(state) {
  const classes = Array.isArray(state?.classes) ? state.classes : [];
  const students = Array.isArray(state?.students) ? state.students : [];
  return {
    name: projectNameOf(state),
    teacherName: String(state?.teacher?.name ?? '').trim(),
    classCount: classes.length,
    studentCount: students.length,
  };
}

export function normalizeDriveLink(link) {
  if (!link?.fileId) return null;
  const text = (v, max = 500) => (v == null || v === '' ? null : String(v).slice(0, max));
  return {
    fileId: String(link.fileId),
    fileName: text(link.fileName ?? link.name),
    accountPermissionId: text(link.accountPermissionId, 200),
    accountEmail: link.accountEmail ? String(link.accountEmail).trim().toLowerCase() : null,
    lastSyncAt: text(link.lastSyncAt, 40),
    // Último modifiedTime remoto que este dispositivo já incorporou.
    remoteModifiedTime: text(link.remoteModifiedTime ?? link.modifiedTime, 40),
    // Revisão local que o Drive já contém. Pendente = localRevision > syncedRevision.
    syncedRevision: Number.isFinite(Number(link.syncedRevision)) ? Number(link.syncedRevision) : 0,
    remoteMissing: !!link.remoteMissing,
  };
}

function buildMeta(state, previous, { savedAt, savedAtMs, bumpRevision = true } = {}) {
  const summary = summarizeProject(state);
  const prevRevision = Number(previous?.localRevision) || 0;
  return {
    projectId: state.projectId,
    ...summary,
    createdAt: previous?.createdAt || state.createdAt || savedAt,
    updatedAt: savedAt,
    updatedAtMs: savedAtMs,
    localRevision: bumpRevision ? prevRevision + 1 : prevRevision,
    storage: { kind: 'indexeddb', schemaVersion: PRG_VERSION },
    driveLink: previous?.driveLink ? normalizeDriveLink(previous.driveLink) : null,
  };
}

export function isDrivePending(meta) {
  return !!meta?.driveLink && !meta.driveLink.remoteMissing
    && (Number(meta.localRevision) || 0) > (Number(meta.driveLink.syncedRevision) || 0);
}

function assertValidState(state) {
  if (!state || state.format !== PRG_FORMAT || Number(state.version) !== PRG_VERSION) {
    throw new ProjectStoreError('INVALID_PROJECT', 'Os dados do projeto são inválidos ou incompatíveis.');
  }
  if (!isSafeId(String(state.projectId || ''))) {
    throw new ProjectStoreError('INVALID_PROJECT_ID', 'O projeto não possui um identificador válido.');
  }
}

const pad = n => String(Math.max(0, Math.floor(n))).padStart(13, '0');
const rand = () => Math.random().toString(36).slice(2, 8);
const backupPrefix = projectId => `${projectId}:`;

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export function createProjectStore({ adapter, now = () => new Date(), newProjectId = createProjectId } = {}) {
  if (!adapter) throw new Error('createProjectStore requer um adapter.');
  const stamp = () => { const d = now(); return { iso: d.toISOString(), ms: d.getTime() }; };

  /* ---- leitura ---- */

  async function listProjects() {
    const metas = await adapter.transaction(STORES.projects, 'readonly', tx => tx.getAll(STORES.projects));
    return metas.filter(m => m?.projectId).sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  }

  async function getProjectMeta(projectId) {
    if (!projectId) return null;
    return (await adapter.transaction(STORES.projects, 'readonly', tx => tx.get(STORES.projects, projectId))) || null;
  }

  async function getProject(projectId) {
    if (!projectId) return null;
    return adapter.transaction([STORES.projects, STORES.projectData], 'readonly', async tx => {
      const meta = await tx.get(STORES.projects, projectId);
      const data = await tx.get(STORES.projectData, projectId);
      if (!meta || !data?.state) return null;
      return { meta, state: data.state };
    });
  }

  /* ---- escrita de projeto ---- */

  async function writeProjectInTx(tx, state, { savedAt, savedAtMs, bumpRevision = true, driveLink } = {}) {
    const previous = await tx.get(STORES.projects, state.projectId);
    const existingData = await tx.get(STORES.projectData, state.projectId);
    // Gravações podem terminar fora de ordem: nunca deixe um estado mais antigo
    // sobrescrever um mais novo.
    if (existingData && (Number(existingData.savedAtMs) || 0) > savedAtMs) {
      return { written: false, meta: previous };
    }
    const base = driveLink === undefined ? previous : { ...(previous || {}), driveLink };
    const meta = buildMeta(state, base, { savedAt, savedAtMs, bumpRevision });
    await tx.put(STORES.projectData, state.projectId, { projectId: state.projectId, state, savedAt, savedAtMs });
    await tx.put(STORES.projects, state.projectId, meta);
    return { written: true, meta };
  }

  /** Salvamento automático do projeto (edição). Nunca toca no Drive. */
  /**
   * Salva um projeto EXISTENTE. Nunca cria: se o projeto foi excluído (por exemplo em outra
   * aba ou janela), a gravação tardia de um autosave não pode ressuscitá-lo. Para criar,
   * use createProject / importProject, ou `{ recreate: true }` por decisão explícita do usuário.
   */
  async function saveProject(state, { savedAt, savedAtMs, recreate = false } = {}) {
    assertValidState(state);
    const t = stamp();
    const at = savedAt || t.iso;
    const ms = savedAtMs || Date.parse(at) || t.ms;
    const stored = { ...state, updatedAt: state.updatedAt };
    return adapter.transaction([STORES.projects, STORES.projectData], 'readwrite', async tx => {
      if (!recreate && !(await tx.get(STORES.projects, stored.projectId))) {
        throw new ProjectStoreError('PROJECT_NOT_FOUND', 'Este projeto não existe mais neste dispositivo.', { projectId: stored.projectId });
      }
      return writeProjectInTx(tx, stored, { savedAt: at, savedAtMs: ms });
    });
  }

  /** Cria um projeto novo (a partir de estado válido) sem sobrescrever nada. */
  async function createProject(state) {
    assertValidState(state);
    const t = stamp();
    return adapter.transaction([STORES.projects, STORES.projectData], 'readwrite', async tx => {
      if (await tx.get(STORES.projects, state.projectId)) {
        throw new ProjectStoreError('PROJECT_EXISTS', 'Já existe um projeto com este identificador.', { projectId: state.projectId });
      }
      return writeProjectInTx(tx, state, { savedAt: t.iso, savedAtMs: t.ms });
    });
  }

  async function renameProject(projectId, name) {
    const clean = String(name ?? '').trim().slice(0, 200);
    if (!clean) throw new ProjectStoreError('INVALID_NAME', 'Informe um nome para o projeto.');
    const t = stamp();
    return adapter.transaction([STORES.projects, STORES.projectData], 'readwrite', async tx => {
      const data = await tx.get(STORES.projectData, projectId);
      if (!data?.state) throw new ProjectStoreError('NOT_FOUND', 'Projeto não encontrado.');
      const state = { ...data.state, name: clean };
      return writeProjectInTx(tx, state, { savedAt: t.iso, savedAtMs: Math.max(t.ms, Number(data.savedAtMs) || 0) });
    });
  }

  /* ---- importação ---- */

  async function inspectImport(state) {
    assertValidState(state);
    const existing = await getProjectMeta(state.projectId);
    return { collision: !!existing, existing };
  }

  /**
   * Importa um projeto já validado/normalizado.
   *  - NEW: falha com PROJECT_ID_COLLISION se o projectId já existir.
   *  - REPLACE: cria backup do existente e o substitui, preservando o vínculo do Drive.
   *  - COPY: gera NOVO projectId, nome explícito de cópia e NENHUM vínculo do Drive.
   */
  async function importProject(state, { mode = IMPORT_MODES.NEW } = {}) {
    assertValidState(state);
    const t = stamp();
    return adapter.transaction([STORES.projects, STORES.projectData, STORES.backups, STORES.recovery], 'readwrite', async tx => {
      const existing = await tx.get(STORES.projects, state.projectId);

      if (mode === IMPORT_MODES.COPY) {
        const copyId = newProjectId();
        const copyName = `${projectNameOf(state)} (cópia)`;
        const copy = { ...clone(state), projectId: copyId, name: copyName };
        const res = await writeProjectInTx(tx, copy, { savedAt: t.iso, savedAtMs: t.ms, driveLink: null });
        return { ...res, mode, projectId: copyId, replaced: false };
      }

      if (existing && mode !== IMPORT_MODES.REPLACE) {
        throw new ProjectStoreError('PROJECT_ID_COLLISION', 'Já existe um projeto local com este identificador.', {
          projectId: state.projectId, existing,
        });
      }

      if (existing && mode === IMPORT_MODES.REPLACE) {
        const current = await tx.get(STORES.projectData, state.projectId);
        if (current?.state) await writeBackupInTx(tx, current.state, 'Antes de substituir por importação', t);
      }
      const res = await writeProjectInTx(tx, state, {
        savedAt: t.iso,
        savedAtMs: Math.max(t.ms, Number(existing?.updatedAtMs) || 0),
      });
      // Qualquer rascunho antigo deste projectId pertence a uma versão que não existe mais.
      await tx.delete(STORES.recovery, state.projectId);
      return { ...res, mode, projectId: state.projectId, replaced: !!existing };
    });
  }

  /* ---- exclusão em cascata ---- */

  /** Remove metadata, dados, backups e recovery do projeto (e o vínculo, que é parte da metadata). */
  async function deleteProject(projectId) {
    if (!projectId) return false;
    return adapter.transaction([STORES.projects, STORES.projectData, STORES.backups, STORES.recovery], 'readwrite', async tx => {
      const existed = !!(await tx.get(STORES.projects, projectId)) || !!(await tx.get(STORES.projectData, projectId));
      await tx.delete(STORES.projects, projectId);
      await tx.delete(STORES.projectData, projectId);
      await tx.delete(STORES.recovery, projectId);
      await tx.deleteByPrefix(STORES.backups, backupPrefix(projectId));
      return existed;
    });
  }

  /* ---- backups (por projeto) ---- */

  async function writeBackupInTx(tx, state, reason, t = stamp(), keep = MAX_BACKUPS_PER_PROJECT) {
    const projectId = state.projectId;
    const backupId = `${projectId}:${pad(t.ms)}:${rand()}`;
    await tx.put(STORES.backups, backupId, {
      backupId, projectId, reason: reason || 'Proteção automática', savedAt: t.iso, savedAtMs: t.ms,
      summary: summarizeProject(state), state: clone(state),
    });
    const keys = await tx.keysByPrefix(STORES.backups, backupPrefix(projectId));
    const excess = keys.slice(0, Math.max(0, keys.length - keep));
    for (const key of excess) await tx.delete(STORES.backups, key);
    return backupId;
  }

  async function createBackup(projectId, reason, { keep = MAX_BACKUPS_PER_PROJECT } = {}) {
    const t = stamp();
    return adapter.transaction([STORES.projectData, STORES.backups], 'readwrite', async tx => {
      const data = await tx.get(STORES.projectData, projectId);
      if (!data?.state) return null;
      return writeBackupInTx(tx, data.state, reason, t, keep);
    });
  }

  /** Cria backup só se o último for mais antigo que o intervalo (evita excesso de dados). */
  async function createBackupIfDue(projectId, reason, { minIntervalMs = DEFAULT_BACKUP_INTERVAL_MS } = {}) {
    const t = stamp();
    return adapter.transaction([STORES.projectData, STORES.backups], 'readwrite', async tx => {
      const data = await tx.get(STORES.projectData, projectId);
      if (!data?.state) return null;
      const keys = await tx.keysByPrefix(STORES.backups, backupPrefix(projectId));
      if (keys.length) {
        const last = await tx.get(STORES.backups, keys[keys.length - 1]);
        if (last && t.ms - (Number(last.savedAtMs) || 0) < minIntervalMs) return null;
      }
      return writeBackupInTx(tx, data.state, reason, t);
    });
  }

  async function listBackups(projectId) {
    if (!projectId) return [];
    const rows = await adapter.transaction(STORES.backups, 'readonly', tx => tx.getAllByPrefix(STORES.backups, backupPrefix(projectId)));
    return rows.filter(r => r?.projectId === projectId).sort((a, b) => b.savedAtMs - a.savedAtMs);
  }

  async function deleteBackup(projectId, backupId) {
    if (!projectId || !String(backupId || '').startsWith(backupPrefix(projectId))) return false;
    await adapter.transaction(STORES.backups, 'readwrite', tx => tx.delete(STORES.backups, backupId));
    return true;
  }

  async function clearBackups(projectId) {
    if (!projectId) return false;
    await adapter.transaction(STORES.backups, 'readwrite', tx => tx.deleteByPrefix(STORES.backups, backupPrefix(projectId)));
    return true;
  }

  /** Restaura um backup do próprio projeto. Antes, guarda o estado atual como backup. */
  async function restoreBackup(projectId, backupId) {
    const t = stamp();
    return adapter.transaction([STORES.projects, STORES.projectData, STORES.backups], 'readwrite', async tx => {
      if (!String(backupId || '').startsWith(backupPrefix(projectId))) {
        throw new ProjectStoreError('FOREIGN_BACKUP', 'Esta cópia não pertence ao projeto.');
      }
      const backup = await tx.get(STORES.backups, backupId);
      if (!backup?.state || backup.state.projectId !== projectId) throw new ProjectStoreError('NOT_FOUND', 'Cópia de segurança não encontrada.');
      const current = await tx.get(STORES.projectData, projectId);
      if (current?.state) await writeBackupInTx(tx, current.state, 'Antes de restaurar uma cópia', t);
      const prevData = current || {};
      return writeProjectInTx(tx, backup.state, {
        savedAt: t.iso, savedAtMs: Math.max(t.ms, Number(prevData.savedAtMs) || 0),
      });
    });
  }

  /* ---- recovery (estado temporário por projeto) ---- */

  async function writeRecovery(projectId, state) {
    if (!projectId || state?.projectId !== projectId) return false;
    const t = stamp();
    // Recuperação só existe para projeto existente: evita "órfãos" que reapareceriam se o mesmo
    // projectId voltasse (por exemplo, ao adicionar do Google Drive).
    return adapter.transaction([STORES.projects, STORES.recovery], 'readwrite', async tx => {
      if (!(await tx.get(STORES.projects, projectId))) return false;
      await tx.put(STORES.recovery, projectId, { projectId, savedAt: t.iso, savedAtMs: t.ms, state: clone(state) });
      return true;
    });
  }
  async function readRecovery(projectId) {
    if (!projectId) return null;
    return (await adapter.transaction(STORES.recovery, 'readonly', tx => tx.get(STORES.recovery, projectId))) || null;
  }
  async function discardRecovery(projectId) {
    if (!projectId) return false;
    await adapter.transaction(STORES.recovery, 'readwrite', tx => tx.delete(STORES.recovery, projectId));
    return true;
  }
  async function listRecoveryIds() {
    return adapter.transaction(STORES.recovery, 'readonly', tx => tx.keys(STORES.recovery));
  }

  /* ---- vínculo do Drive (pertence ao projeto) ---- */

  async function updateMeta(projectId, mutate) {
    return adapter.transaction(STORES.projects, 'readwrite', async tx => {
      const meta = await tx.get(STORES.projects, projectId);
      if (!meta) throw new ProjectStoreError('NOT_FOUND', 'Projeto não encontrado.');
      const next = mutate(clone(meta));
      await tx.put(STORES.projects, projectId, next);
      return next;
    });
  }

  async function setDriveLink(projectId, link) {
    const normalized = normalizeDriveLink(link);
    if (!normalized) throw new ProjectStoreError('INVALID_LINK', 'Vínculo do Google Drive inválido.');
    return updateMeta(projectId, meta => ({ ...meta, driveLink: normalized }));
  }

  /** Marca a revisão enviada/recebida como sincronizada. Edições feitas durante o envio continuam pendentes. */
  async function markSynced(projectId, { syncedRevision, remoteModifiedTime, fileName, accountEmail, accountPermissionId } = {}) {
    const t = stamp();
    return updateMeta(projectId, meta => {
      if (!meta.driveLink) return meta;
      return {
        ...meta,
        driveLink: normalizeDriveLink({
          ...meta.driveLink,
          syncedRevision: syncedRevision ?? meta.localRevision,
          remoteModifiedTime: remoteModifiedTime ?? meta.driveLink.remoteModifiedTime,
          fileName: fileName ?? meta.driveLink.fileName,
          accountEmail: accountEmail ?? meta.driveLink.accountEmail,
          accountPermissionId: accountPermissionId ?? meta.driveLink.accountPermissionId,
          lastSyncAt: t.iso,
          remoteMissing: false,
        }),
      };
    });
  }

  async function markRemoteMissing(projectId) {
    return updateMeta(projectId, meta => (meta.driveLink
      ? { ...meta, driveLink: { ...meta.driveLink, remoteMissing: true } }
      : meta));
  }

  /** Desvincular: remove só o vínculo. Arquivo no Drive e projeto local permanecem. */
  async function unlinkDrive(projectId) {
    return updateMeta(projectId, meta => ({ ...meta, driveLink: null }));
  }

  /** Substitui os dados locais por uma versão do Drive e já marca como sincronizada. */
  async function applyRemoteVersion(projectId, state, { remoteModifiedTime, fileName, reason = 'Antes de usar a versão do Google Drive' } = {}) {
    assertValidState(state);
    if (state.projectId !== projectId) throw new ProjectStoreError('PROJECT_MISMATCH', 'A versão do Drive pertence a outro projeto.');
    const t = stamp();
    return adapter.transaction([STORES.projects, STORES.projectData, STORES.backups, STORES.recovery], 'readwrite', async tx => {
      const current = await tx.get(STORES.projectData, projectId);
      if (current?.state) await writeBackupInTx(tx, current.state, reason, t);
      const res = await writeProjectInTx(tx, state, { savedAt: t.iso, savedAtMs: Math.max(t.ms, Number(current?.savedAtMs) || 0) });
      const link = res.meta.driveLink;
      if (link) {
        res.meta.driveLink = normalizeDriveLink({
          ...link, syncedRevision: res.meta.localRevision,
          remoteModifiedTime: remoteModifiedTime ?? link.remoteModifiedTime,
          fileName: fileName ?? link.fileName, lastSyncAt: t.iso, remoteMissing: false,
        });
        await tx.put(STORES.projects, projectId, res.meta);
      }
      await tx.delete(STORES.recovery, projectId);
      return res;
    });
  }

  /* ---- configurações ---- */

  async function getSetting(key, fallback = null) {
    const row = await adapter.transaction(STORES.settings, 'readonly', tx => tx.get(STORES.settings, key));
    return row === undefined ? fallback : row;
  }
  async function setSetting(key, value) {
    await adapter.transaction(STORES.settings, 'readwrite', tx => tx.put(STORES.settings, key, value));
    return value;
  }
  async function deleteSetting(key) {
    await adapter.transaction(STORES.settings, 'readwrite', tx => tx.delete(STORES.settings, key));
  }

  async function clearEverything() {
    await adapter.transaction(ALL_STORES, 'readwrite', async tx => {
      for (const name of ALL_STORES) await tx.clear(name);
    });
    return true;
  }

  /* ---- migração do banco legado (arquivo-centrado) ---- */

  /**
   * Converte registros do banco antigo para projetos. Aditivo: nunca apaga o banco
   * legado e nunca sobrescreve um projeto que já exista no novo.
   * legacy = { projects: [], backups: [], recovery: [], driveBindings: {} }
   */
  async function importLegacyRecords(legacy = {}) {
    const report = { projects: 0, skipped: 0, backups: 0, recovery: 0 };
    const t = stamp();
    const bindings = legacy.driveBindings && typeof legacy.driveBindings === 'object' ? legacy.driveBindings : {};
    await adapter.transaction([STORES.projects, STORES.projectData, STORES.backups, STORES.recovery], 'readwrite', async tx => {
      for (const record of legacy.projects || []) {
        const state = record?.state;
        try { assertValidState(state); } catch (_) { report.skipped += 1; continue; }
        if (await tx.get(STORES.projects, state.projectId)) { report.skipped += 1; continue; }
        const fileBase = String(record.currentFileName || '').replace(/(?:\.json)+$/i, '').replace(/\.(prg|prof)$/i, '').trim();
        const named = state.name ? state : { ...state, ...(fileBase ? { name: fileBase } : {}) };
        const rawBinding = record.driveBinding?.fileId ? record.driveBinding : bindings[state.projectId];
        const savedAtMs = Date.parse(record.savedAt || '') || t.ms;
        const savedAt = new Date(savedAtMs).toISOString();
        const link = rawBinding?.fileId
          ? { ...rawBinding, fileName: rawBinding.name, remoteModifiedTime: rawBinding.modifiedTime,
              syncedRevision: record.driveSyncPending ? 0 : 1 }
          : null;
        await writeProjectInTx(tx, named, { savedAt, savedAtMs, driveLink: link ? normalizeDriveLink(link) : null });
        report.projects += 1;
      }
      for (const record of legacy.backups || []) {
        const state = record?.state;
        try { assertValidState(state); } catch (_) { continue; }
        if (!(await tx.get(STORES.projects, state.projectId))) continue;
        const ms = Date.parse(record.savedAt || '') || t.ms;
        const id = `${state.projectId}:${pad(ms)}:${rand()}`;
        await tx.put(STORES.backups, id, {
          backupId: id, projectId: state.projectId, reason: record.reason || 'Cópia migrada',
          savedAt: new Date(ms).toISOString(), savedAtMs: ms, summary: summarizeProject(state), state: clone(state),
        });
        report.backups += 1;
      }
      for (const record of legacy.recovery || []) {
        const state = record?.state;
        try { assertValidState(state); } catch (_) { continue; }
        if (!(await tx.get(STORES.projects, state.projectId))) continue;
        const ms = Date.parse(record.savedAt || '') || t.ms;
        await tx.put(STORES.recovery, state.projectId, { projectId: state.projectId, savedAt: new Date(ms).toISOString(), savedAtMs: ms, state: clone(state) });
        report.recovery += 1;
      }
    });
    // Recorta backups acima do limite por projeto depois da migração.
    const metas = await listProjects();
    for (const meta of metas) {
      await adapter.transaction(STORES.backups, 'readwrite', async tx => {
        const keys = await tx.keysByPrefix(STORES.backups, backupPrefix(meta.projectId));
        for (const key of keys.slice(0, Math.max(0, keys.length - MAX_BACKUPS_PER_PROJECT))) await tx.delete(STORES.backups, key);
      });
    }
    return report;
  }

  return {
    adapter,
    listProjects, getProjectMeta, getProject,
    saveProject, createProject, renameProject,
    inspectImport, importProject,
    deleteProject,
    createBackup, createBackupIfDue, listBackups, deleteBackup, clearBackups, restoreBackup,
    writeRecovery, readRecovery, discardRecovery, listRecoveryIds,
    setDriveLink, markSynced, markRemoteMissing, unlinkDrive, applyRemoteVersion,
    getSetting, setSetting, deleteSetting,
    clearEverything,
    importLegacyRecords,
  };
}

/* ------------------------------------------------------------------ */
/* Leitura do banco legado (navegador)                                 */
/* ------------------------------------------------------------------ */

/**
 * Lê o banco antigo "professorgest-local-prg-v1" sem criá-lo caso não exista.
 * Retorna null quando não há nada a migrar.
 */
export async function readLegacyDatabase({ indexedDBLike = globalThis.indexedDB, storage = globalThis.localStorage } = {}) {
  if (!indexedDBLike) return null;
  try {
    if (typeof indexedDBLike.databases === 'function') {
      const dbs = await indexedDBLike.databases();
      if (!dbs.some(db => db.name === LEGACY_DB_NAME)) return null;
    }
  } catch (_) { /* segue para a abertura defensiva */ }

  const db = await new Promise(resolve => {
    let request;
    try { request = indexedDBLike.open(LEGACY_DB_NAME); } catch (_) { resolve(null); return; }
    // Se o banco não existir, abortamos o upgrade para não criar um banco vazio.
    request.onupgradeneeded = () => { try { request.transaction.abort(); } catch (_) {} };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  if (!db) return null;

  const readAll = name => new Promise(resolve => {
    if (!db.objectStoreNames.contains(name)) { resolve([]); return; }
    try {
      const request = db.transaction(name, 'readonly').objectStore(name).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => resolve([]);
    } catch (_) { resolve([]); }
  });

  const [projects, backups, recovery] = await Promise.all([readAll('projects'), readAll('backups'), readAll('recovery')]);
  try { db.close(); } catch (_) {}

  let driveBindings = {};
  try { driveBindings = JSON.parse(storage?.getItem('professorgest-drive-bindings-v3') || '{}') || {}; } catch (_) { driveBindings = {}; }
  if (!projects.length && !backups.length && !recovery.length) return null;
  return { projects, backups, recovery, driveBindings };
}

/** Executa a migração uma única vez (registrada em settings). */
export async function migrateLegacyIfNeeded(store, readLegacy = readLegacyDatabase) {
  const done = await store.getSetting('legacyMigration', null);
  if (done?.completedAt) return { migrated: false, report: done.report || null };
  let legacy = null;
  // Falha de leitura NÃO marca a migração como concluída: tentamos de novo na próxima abertura.
  try { legacy = await readLegacy(); } catch (error) { return { migrated: false, error: true, report: null }; }
  const report = legacy ? await store.importLegacyRecords(legacy) : { projects: 0, skipped: 0, backups: 0, recovery: 0 };
  await store.setSetting('legacyMigration', { completedAt: new Date().toISOString(), report });
  return { migrated: !!legacy, report };
}
