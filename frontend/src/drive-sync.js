/**
 * Google Drive como CÓPIA REMOTA / sincronização de um projeto.
 *
 * Princípios:
 *  - Escopo de menor privilégio: drive.file. Os arquivos do ProfessorGest são
 *    identificados por appProperties privadas (app, projectId, formato, versão),
 *    nunca pelo nome do arquivo.
 *  - Falha do Drive (rede, 401, 403, 404) jamais altera/perde dados locais.
 *  - A sincronização opera sobre a versão LOCAL do projeto (snapshot + revisão).
 *  - Nunca há merge automático de estruturas pedagógicas: conflito = decisão explícita.
 *
 * Tudo é injetável (`api`) para ser testado sem rede.
 */
import { PRG_FORMAT, PRG_VERSION, PRG_MIME } from './prof-model.js';
import { isDrivePending, projectNameOf, IMPORT_MODES } from './project-store.js';
import { serializeProjectToPrg, prgFileNameForProject, parsePrgText } from './prg-transfer.js';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const APP_PROPERTY_APP = 'professorgest';
export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_LIST_FIELDS = 'nextPageToken,files(id,name,modifiedTime,trashed,appProperties,capabilities(canEdit,canTrash,canDelete),ownedByMe)';
export const DRIVE_FILE_FIELDS = 'id,name,mimeType,modifiedTime,trashed,appProperties,capabilities(canEdit,canTrash,canDelete)';

export const SYNC_STATUS = Object.freeze({
  LOCAL_ONLY: 'local-only',          // salvo neste dispositivo, sem Drive
  SYNCING: 'syncing',
  SYNCED: 'synced',
  PENDING: 'pending',                // alterações locais pendentes
  REMOTE_NEWER: 'remote-newer',      // remoto mais novo, sem alterações locais
  CONFLICT: 'conflict',
  RECONNECT: 'reconnect',
  OFFLINE: 'offline',
  REMOTE_MISSING: 'remote-missing',  // arquivo removido/na lixeira no Drive
  DRIVE_ONLY: 'drive-only',          // existe só no Drive
});

export const SYNC_LABELS = Object.freeze({
  'local-only': 'Salvo neste dispositivo',
  syncing: 'Sincronizando com o Google Drive…',
  synced: 'Sincronizado com o Google Drive',
  pending: 'Alterações pendentes no Drive',
  'remote-newer': 'Há uma versão mais nova no Google Drive',
  conflict: 'Há uma versão diferente no Google Drive',
  reconnect: 'Reconecte o Google Drive para sincronizar',
  offline: 'Salvo neste dispositivo · Drive indisponível',
  'remote-missing': 'O arquivo não está mais no Google Drive',
  'drive-only': 'Somente no Google Drive',
});

export class DriveError extends Error {
  constructor(kind, message, status = null) { super(message); this.name = 'DriveError'; this.kind = kind; this.status = status; }
}

/** Traduz qualquer falha em um tipo estável: auth | forbidden | notfound | offline | other. */
export function classifyDriveError(error, { online } = {}) {
  if (error instanceof DriveError) return error.kind;
  const status = Number(error?.status);
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404 || status === 410) return 'notfound';
  const offlineNow = online === false || (typeof navigator !== 'undefined' && navigator.onLine === false);
  if (offlineNow || error?.name === 'TypeError' || /failed to fetch|network|load failed/i.test(String(error?.message || ''))) return 'offline';
  if (/autoriza|token|consent|popup|interaction/i.test(String(error?.message || ''))) return 'auth';
  return 'other';
}

export function statusForError(kind) {
  if (kind === 'auth') return SYNC_STATUS.RECONNECT;
  if (kind === 'offline') return SYNC_STATUS.OFFLINE;
  if (kind === 'notfound') return SYNC_STATUS.REMOTE_MISSING;
  return null;
}

/* ---------- appProperties ---------- */

export function buildAppProperties(state) {
  return {
    app: APP_PROPERTY_APP,
    projectId: String(state.projectId),
    format: PRG_FORMAT,
    version: String(PRG_VERSION),
  };
}

export function isManagedFile(file) {
  const p = file?.appProperties;
  return !!p && p.app === APP_PROPERTY_APP && p.format === PRG_FORMAT && !!p.projectId;
}

export function managedFilesQuery() {
  return `appProperties has { key='app' and value='${APP_PROPERTY_APP}' } and trashed = false`;
}

/* ---------- API real (fetch) ---------- */

function multipartBody(metadata, content) {
  const boundary = `pg-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const body = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(metadata),
    `--${boundary}`, `Content-Type: ${PRG_MIME}`, '', content, `--${boundary}--`, '',
  ].join('\r\n');
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

/**
 * @param {{json:(url:string,init?:object)=>Promise<any>, text:(url:string,init?:object)=>Promise<string>}} http
 *   Funções que lançam erros com `.status` (ver drive-http.js).
 */
export function createDriveApi(http) {
  return {
    async list(pageToken = null) {
      const params = new URLSearchParams({ q: managedFilesQuery(), fields: DRIVE_LIST_FIELDS, pageSize: '100', spaces: 'drive' });
      if (pageToken) params.set('pageToken', pageToken);
      return http.json(`${DRIVE_API_BASE}/files?${params}`);
    },
    getMeta(fileId) {
      return http.json(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`);
    },
    download(fileId) { return http.text(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`); },
    create(metadata, content) {
      const { body, contentType } = multipartBody({ ...metadata, mimeType: PRG_MIME }, content);
      return http.json(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`,
        { method: 'POST', headers: { 'Content-Type': contentType }, body });
    },
    update(fileId, metadata, content) {
      const { body, contentType } = multipartBody(metadata, content);
      return http.json(`${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`,
        { method: 'PATCH', headers: { 'Content-Type': contentType }, body });
    },
    trash(fileId) {
      return http.json(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    },
  };
}

/* ---------- descoberta ---------- */

/**
 * Atualiza a lista de projetos gerenciados no Drive, com paginação.
 * Nunca lança: devolve { ok, files, reason, partial }.
 */
export async function discoverDriveProjects(api, { maxPages = 20, onPage = null, online } = {}) {
  const files = [];
  let pageToken = null;
  try {
    for (let page = 0; page < maxPages; page++) {
      const res = await api.list(pageToken);
      for (const file of res?.files || []) {
        if (!file.trashed && isManagedFile(file)) files.push(file);
      }
      onPage?.({ page: page + 1, count: files.length });
      pageToken = res?.nextPageToken || null;
      if (!pageToken) break;
    }
    return { ok: true, files, truncated: !!pageToken };
  } catch (error) {
    return { ok: false, files, reason: classifyDriveError(error, { online }), message: error?.message || '', partial: files.length > 0 };
  }
}

/**
 * Relaciona o que há no Drive com os projetos locais pelo projectId (appProperties)
 * e/ou fileId do vínculo — nunca pelo nome. Não remove projetos locais.
 * kind: 'local' | 'local+drive' | 'drive-only'
 */
export function mergeProjectLists(localMetas, remoteFiles) {
  const byProject = new Map();
  const byFileId = new Map();
  for (const f of remoteFiles || []) {
    byProject.set(f.appProperties?.projectId, f);
    byFileId.set(f.id, f);
  }
  const used = new Set();
  const entries = [];
  for (const meta of localMetas || []) {
    const remote = (meta.driveLink && byFileId.get(meta.driveLink.fileId)) || byProject.get(meta.projectId) || null;
    if (remote) used.add(remote.id);
    entries.push({ kind: remote || meta.driveLink ? 'local+drive' : 'local', projectId: meta.projectId, meta, remote });
  }
  for (const f of remoteFiles || []) {
    if (used.has(f.id)) continue;
    entries.push({ kind: 'drive-only', projectId: f.appProperties?.projectId || null, meta: null, remote: f });
  }
  return entries;
}

/* ---------- estado de sincronização ---------- */

const REMOTE_TOLERANCE_MS = 1000;
export function isRemoteNewer(link, remoteModifiedTime) {
  const known = Date.parse(link?.remoteModifiedTime || '') || 0;
  const remote = Date.parse(remoteModifiedTime || '') || 0;
  return !!remote && remote > known + REMOTE_TOLERANCE_MS;
}

/**
 * Estado exibido para um projeto. `remote` (metadados do Drive) é opcional.
 * `ctx`: { syncing, online, authState, lastError }
 */
export function computeSyncStatus(meta, remote = null, ctx = {}) {
  if (!meta?.driveLink) return SYNC_STATUS.LOCAL_ONLY;
  const link = meta.driveLink;
  if (ctx.syncing) return SYNC_STATUS.SYNCING;
  if (link.remoteMissing || remote?.trashed) return SYNC_STATUS.REMOTE_MISSING;
  const pending = isDrivePending(meta);
  const remoteNewer = remote ? isRemoteNewer(link, remote.modifiedTime) : false;
  if (remoteNewer && pending) return SYNC_STATUS.CONFLICT;
  if (remoteNewer) return SYNC_STATUS.REMOTE_NEWER;
  if (ctx.lastError === 'auth' || ctx.authState === 'reconnect') return SYNC_STATUS.RECONNECT;
  if (ctx.lastError === 'offline' || ctx.online === false) return pending ? SYNC_STATUS.OFFLINE : SYNC_STATUS.SYNCED;
  return pending ? SYNC_STATUS.PENDING : SYNC_STATUS.SYNCED;
}

export function syncLabel(status) { return SYNC_LABELS[status] || SYNC_LABELS['local-only']; }

/* ---------- operações ---------- */

function accountPatch(account) {
  return { accountEmail: account?.email || null, accountPermissionId: account?.permissionId || null };
}

function linkMismatch(link, account) {
  if (!link || !account) return false;
  if (link.accountPermissionId && account.permissionId) return link.accountPermissionId !== account.permissionId;
  if (link.accountEmail && account.email) return link.accountEmail !== String(account.email).toLowerCase();
  return false;
}

/**
 * Sincroniza o projeto local com o Drive. Resultado:
 *  { status, uploaded?, created?, remote? }  — nunca lança por falha do Drive.
 * O estado local nunca é alterado por falhas; só `markSynced`/`setDriveLink` após sucesso.
 */
export async function syncProject(store, api, projectId, { account = null, force = false, online } = {}) {
  const snapshot = await store.getProject(projectId);
  if (!snapshot) return { status: SYNC_STATUS.LOCAL_ONLY, reason: 'not-found' };
  const { meta, state } = snapshot;
  const revision = meta.localRevision;      // revisão exata que será enviada
  const link = meta.driveLink;
  try {
    const content = serializeProjectToPrg(state);
    const fileName = prgFileNameForProject(projectNameOf(state));
    const appProperties = buildAppProperties(state);

    if (!link) {
      const created = await api.create({ name: fileName, appProperties }, content);
      await store.setDriveLink(projectId, { fileId: created.id, fileName: created.name, remoteModifiedTime: created.modifiedTime, ...accountPatch(account) });
      await store.markSynced(projectId, { syncedRevision: revision, remoteModifiedTime: created.modifiedTime, fileName: created.name });
      return { status: SYNC_STATUS.SYNCED, created: true, uploaded: true };
    }

    if (linkMismatch(link, account)) return { status: SYNC_STATUS.RECONNECT, reason: 'account-mismatch' };

    const remote = await api.getMeta(link.fileId);
    if (remote.trashed) { await store.markRemoteMissing(projectId); return { status: SYNC_STATUS.REMOTE_MISSING, remote }; }
    if (remote.capabilities && remote.capabilities.canEdit === false) return { status: SYNC_STATUS.RECONNECT, reason: 'read-only', remote };

    const remoteNewer = isRemoteNewer(link, remote.modifiedTime);
    const pending = isDrivePending(meta);
    if (remoteNewer && !force) {
      return { status: pending ? SYNC_STATUS.CONFLICT : SYNC_STATUS.REMOTE_NEWER, remote };
    }
    if (!pending && !force && !remoteNewer) {
      return { status: SYNC_STATUS.SYNCED, uploaded: false, remote };
    }
    const updated = await api.update(link.fileId, { name: fileName, appProperties }, content);
    await store.markSynced(projectId, { syncedRevision: revision, remoteModifiedTime: updated.modifiedTime, fileName: updated.name, ...accountPatch(account) });
    const after = await store.getProjectMeta(projectId);
    return { status: isDrivePending(after) ? SYNC_STATUS.PENDING : SYNC_STATUS.SYNCED, uploaded: true, remote: updated };
  } catch (error) {
    const kind = classifyDriveError(error, { online });
    if (kind === 'notfound' && link) await store.markRemoteMissing(projectId).catch(() => {});
    return { status: statusForError(kind) || (link ? SYNC_STATUS.PENDING : SYNC_STATUS.LOCAL_ONLY), error: kind, message: error?.message || '' };
  }
}

/**
 * Só consulta os metadados do arquivo no Drive (nada é enviado) — usado ao abrir um projeto
 * para descobrir se existe uma versão mais nova. Nunca lança por falha do Drive.
 */
export async function checkRemoteVersion(store, api, projectId, { account = null, online } = {}) {
  const meta = await store.getProjectMeta(projectId);
  const link = meta?.driveLink;
  if (!link) return { status: SYNC_STATUS.LOCAL_ONLY };
  if (linkMismatch(link, account)) return { status: SYNC_STATUS.RECONNECT, reason: 'account-mismatch' };
  try {
    const remote = await api.getMeta(link.fileId);
    if (remote.trashed) { await store.markRemoteMissing(projectId); return { status: SYNC_STATUS.REMOTE_MISSING, remote }; }
    const pending = isDrivePending(meta);
    if (isRemoteNewer(link, remote.modifiedTime)) return { status: pending ? SYNC_STATUS.CONFLICT : SYNC_STATUS.REMOTE_NEWER, remote };
    return { status: pending ? SYNC_STATUS.PENDING : SYNC_STATUS.SYNCED, remote };
  } catch (error) {
    const kind = classifyDriveError(error, { online });
    if (kind === 'notfound') await store.markRemoteMissing(projectId).catch(() => {});
    return { status: statusForError(kind) || SYNC_STATUS.PENDING, error: kind, message: error?.message || '' };
  }
}

async function fetchRemoteProject(api, fileId, expectedProjectId = null) {
  const remote = await api.getMeta(fileId);
  if (remote.trashed) throw new DriveError('notfound', 'O arquivo está na lixeira do Google Drive.', 404);
  const text = await api.download(fileId);
  const parsed = parsePrgText(text, { fileName: remote.name });
  if (!parsed.ok) throw new DriveError('invalid', parsed.message);
  if (expectedProjectId && parsed.data.projectId !== expectedProjectId) {
    throw new DriveError('mismatch', 'O arquivo do Drive pertence a outro projeto.');
  }
  return { remote, data: parsed.data, warnings: parsed.warnings };
}

/** Conflito → "Usar versão do Drive". Faz backup do local antes (dentro do store). */
export async function resolveConflictUseRemote(store, api, projectId, { online } = {}) {
  const meta = await store.getProjectMeta(projectId);
  if (!meta?.driveLink) return { ok: false, reason: 'no-link' };
  try {
    const { remote, data } = await fetchRemoteProject(api, meta.driveLink.fileId, projectId);
    await store.applyRemoteVersion(projectId, data, { remoteModifiedTime: remote.modifiedTime, fileName: remote.name });
    return { ok: true, status: SYNC_STATUS.SYNCED };
  } catch (error) {
    const kind = classifyDriveError(error, { online });
    return { ok: false, error: kind, message: error?.message || '', status: statusForError(kind) };
  }
}

/** Conflito → "Manter versão local": backup de segurança e envio forçado. */
export async function resolveConflictKeepLocal(store, api, projectId, opts = {}) {
  await store.createBackup(projectId, 'Antes de manter a versão local sobre o Drive');
  return syncProject(store, api, projectId, { ...opts, force: true });
}

/** Remoto mais novo e sem alterações locais: atualiza o local (com backup). */
export async function pullRemoteIfNewer(store, api, projectId, opts = {}) {
  const meta = await store.getProjectMeta(projectId);
  if (!meta?.driveLink) return { ok: false, reason: 'no-link' };
  if (isDrivePending(meta)) return { ok: false, status: SYNC_STATUS.CONFLICT };
  return resolveConflictUseRemote(store, api, projectId, opts);
}

/**
 * Adiciona ao dispositivo um projeto que só existe no Drive.
 * Se o projectId já existir localmente, devolve { collision } sem sobrescrever.
 */
export async function addDriveProjectToDevice(store, api, fileId, { account = null, mode = IMPORT_MODES.NEW, online } = {}) {
  try {
    const { remote, data } = await fetchRemoteProject(api, fileId);
    const inspect = await store.inspectImport(data);
    if (inspect.collision && mode === IMPORT_MODES.NEW) {
      return { ok: false, collision: true, existing: inspect.existing, remote };
    }
    const res = await store.importProject(data, { mode });
    if (res.mode !== IMPORT_MODES.COPY) {
      await store.setDriveLink(res.projectId, { fileId: remote.id, fileName: remote.name, remoteModifiedTime: remote.modifiedTime, ...accountPatch(account) });
      await store.markSynced(res.projectId, { remoteModifiedTime: remote.modifiedTime });
    }
    return { ok: true, projectId: res.projectId, mode: res.mode };
  } catch (error) {
    const kind = classifyDriveError(error, { online });
    return { ok: false, error: kind, message: error?.message || '' };
  }
}

/** Desvincular ≠ excluir: só remove o vínculo. */
export function unlinkProjectFromDrive(store, projectId) { return store.unlinkDrive(projectId); }

/** Pode-se mover para a lixeira? (capabilities) */
export function canTrashRemote(remote) {
  if (!remote) return false;
  const caps = remote.capabilities;
  return !caps || caps.canTrash !== false;
}

/**
 * Move o arquivo do Drive para a lixeira. NUNCA apaga o projeto local.
 * Depois do sucesso, o vínculo é removido (o arquivo já não existe para sincronizar).
 */
export async function trashProjectOnDrive(store, api, projectId, { online } = {}) {
  const meta = await store.getProjectMeta(projectId);
  if (!meta?.driveLink) return { ok: false, reason: 'no-link' };
  try {
    const remote = await api.getMeta(meta.driveLink.fileId);
    if (!remote.trashed) {
      if (!canTrashRemote(remote)) return { ok: false, reason: 'cannot-trash' };
      await api.trash(meta.driveLink.fileId);
    }
    await store.unlinkDrive(projectId);
    return { ok: true, localKept: true };
  } catch (error) {
    const kind = classifyDriveError(error, { online });
    if (kind === 'notfound') { await store.unlinkDrive(projectId); return { ok: true, localKept: true, alreadyGone: true }; }
    return { ok: false, error: kind, message: error?.message || '' };
  }
}

/** Ação avançada: lixeira do Drive primeiro; só então exclui o projeto local. */
export async function removeFromDeviceAndDrive(store, api, projectId, opts = {}) {
  const meta = await store.getProjectMeta(projectId);
  if (meta?.driveLink) {
    const res = await trashProjectOnDrive(store, api, projectId, opts);
    if (!res.ok) return { ok: false, step: 'drive', ...res };
  }
  await store.deleteProject(projectId);
  return { ok: true };
}
