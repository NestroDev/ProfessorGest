import test from 'node:test';
import assert from 'node:assert/strict';
import { PRG_FORMAT, PRG_VERSION } from '../frontend/src/prof-model.js';
import { createMemoryAdapter, createProjectStore, isDrivePending, IMPORT_MODES } from '../frontend/src/project-store.js';
import {
  SYNC_STATUS, DriveError, buildAppProperties, isManagedFile, managedFilesQuery, discoverDriveProjects, mergeProjectLists,
  computeSyncStatus, syncProject, resolveConflictKeepLocal, resolveConflictUseRemote, addDriveProjectToDevice,
  trashProjectOnDrive, removeFromDeviceAndDrive, classifyDriveError, DRIVE_SCOPE, syncLabel,
} from '../frontend/src/drive-sync.js';
import { driveAuthState, DRIVE_AUTH_STATES, normalizeDriveAccount } from '../frontend/src/drive-account.js';
import { serializeProjectToPrg } from '../frontend/src/prg-transfer.js';

let clock = Date.parse('2026-10-01T10:00:00Z');
const tick = () => { clock += 60_000; return new Date(clock); };
const makeStore = () => createProjectStore({ adapter: createMemoryAdapter(), now: tick });
const project = (id, extra = {}) => ({
  format: PRG_FORMAT, version: PRG_VERSION, projectId: id, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  teacher: { name: 'Ana' }, schools: [], classes: [], assignments: [], enrollments: [], students: [],
  activities: [], occurrences: [], plans: [], ...extra,
});

/** Drive falso em memória com os mesmos contratos de createDriveApi. */
function fakeDrive({ pageSize = 2 } = {}) {
  const files = new Map(); let n = 0; let time = Date.parse('2026-10-01T12:00:00Z');
  const fail = { next: null };
  const calls = [];
  const stamp = () => new Date(time += 1000 * 60).toISOString();
  const guard = name => { calls.push(name); if (fail.next) { const e = fail.next; fail.next = null; throw e; } };
  const meta = f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, trashed: f.trashed, appProperties: f.appProperties, capabilities: f.capabilities });
  const api = {
    async list(token) {
      guard('list');
      const all = [...files.values()].filter(f => !f.trashed && f.appProperties?.app === 'professorgest');
      const start = token ? Number(token) : 0;
      const slice = all.slice(start, start + pageSize);
      return { files: slice.map(meta), nextPageToken: start + pageSize < all.length ? String(start + pageSize) : undefined };
    },
    async getMeta(id) { guard('getMeta'); const f = files.get(id); if (!f) throw Object.assign(new Error('nf'), { status: 404 }); return meta(f); },
    async download(id) { guard('download'); return files.get(id).content; },
    async create(m, content) { guard('create'); const id = `f${++n}`; const f = { id, name: m.name, appProperties: m.appProperties, content, modifiedTime: stamp(), trashed: false, capabilities: { canEdit: true, canTrash: true, canDelete: true } }; files.set(id, f); return meta(f); },
    async update(id, m, content) { guard('update'); const f = files.get(id); f.content = content; f.name = m.name; f.appProperties = m.appProperties; f.modifiedTime = stamp(); return meta(f); },
    async trash(id) { guard('trash'); files.get(id).trashed = true; return meta(files.get(id)); },
  };
  return { api, files, fail, calls, touchRemote(id, content) { const f = files.get(id); f.content = content; f.modifiedTime = stamp(); } };
}

const account = { email: 'ana@escola.com', permissionId: 'perm-1' };

test('escopo é o de menor privilégio e arquivos são identificados por appProperties, não pelo nome', () => {
  assert.equal(DRIVE_SCOPE, 'https://www.googleapis.com/auth/drive.file');
  assert.ok(managedFilesQuery().includes("key='app'"));
  const props = buildAppProperties(project('P1'));
  assert.deepEqual(props, { app: 'professorgest', projectId: 'P1', format: PRG_FORMAT, version: String(PRG_VERSION) });
  assert.equal(isManagedFile({ name: 'qualquer.prg' }), false);
  assert.equal(isManagedFile({ name: 'x', appProperties: props }), true);
});

test('primeira sincronização cria o arquivo no Drive com appProperties e vincula ao projeto', async () => {
  const store = makeStore(); const drive = fakeDrive();
  await store.createProject(project('P1', { name: 'Matemática — 2026' }));
  const res = await syncProject(store, drive.api, 'P1', { account });
  assert.equal(res.status, SYNC_STATUS.SYNCED);
  const meta = await store.getProjectMeta('P1');
  const file = drive.files.get(meta.driveLink.fileId);
  assert.equal(file.name, 'matematica-2026.prg');
  assert.equal(file.appProperties.projectId, 'P1');
  assert.equal(meta.driveLink.accountPermissionId, 'perm-1');
  assert.equal(isDrivePending(meta), false);
});

test('edição local fica pendente e a sincronização seguinte envia só quando necessário', async () => {
  const store = makeStore(); const drive = fakeDrive();
  await store.createProject(project('P1'));
  await syncProject(store, drive.api, 'P1', { account });
  const again = await syncProject(store, drive.api, 'P1', { account });
  assert.equal(again.uploaded, false);
  await store.saveProject((await store.getProject('P1')).state);
  assert.equal(computeSyncStatus(await store.getProjectMeta('P1')), SYNC_STATUS.PENDING);
  const res = await syncProject(store, drive.api, 'P1', { account });
  assert.equal(res.uploaded, true);
  assert.equal(computeSyncStatus(await store.getProjectMeta('P1')), SYNC_STATUS.SYNCED);
});

test('falhas do Drive (offline, 401, 403, 404) nunca alteram nem perdem dados locais', async () => {
  const store = makeStore(); const drive = fakeDrive();
  await store.createProject(project('P1', { name: 'Local' }));
  await syncProject(store, drive.api, 'P1', { account });
  await store.saveProject(project('P1', { name: 'Editado offline' }));
  const before = JSON.stringify(await store.getProject('P1'));
  const cases = [
    [new TypeError('Failed to fetch'), SYNC_STATUS.OFFLINE, 'offline'],
    [Object.assign(new Error('x'), { status: 401 }), SYNC_STATUS.RECONNECT, 'auth'],
    [Object.assign(new Error('x'), { status: 403 }), SYNC_STATUS.PENDING, 'forbidden'],
  ];
  for (const [err, status, kind] of cases) {
    drive.fail.next = err;
    const res = await syncProject(store, drive.api, 'P1', { account });
    assert.equal(res.status, status); assert.equal(res.error, kind);
    assert.equal(JSON.stringify(await store.getProject('P1')), before, `local intacto após ${kind}`);
    assert.equal(isDrivePending(await store.getProjectMeta('P1')), true);
  }
  drive.fail.next = Object.assign(new Error('x'), { status: 404 });
  const gone = await syncProject(store, drive.api, 'P1', { account });
  assert.equal(gone.status, SYNC_STATUS.REMOTE_MISSING);
  assert.equal((await store.getProject('P1')).state.name, 'Editado offline');
  assert.equal((await store.getProjectMeta('P1')).driveLink.remoteMissing, true);
});

test('arquivo na lixeira do Drive marca o vínculo como ausente e preserva o local', async () => {
  const store = makeStore(); const drive = fakeDrive();
  await store.createProject(project('P1'));
  await syncProject(store, drive.api, 'P1', { account });
  const id = (await store.getProjectMeta('P1')).driveLink.fileId;
  drive.files.get(id).trashed = true;
  const res = await syncProject(store, drive.api, 'P1', { account });
  assert.equal(res.status, SYNC_STATUS.REMOTE_MISSING);
  assert.ok(await store.getProject('P1'));
});

test('remoto mais novo sem alterações locais -> remote-newer; com alterações -> conflito sem escrever', async () => {
  const store = makeStore(); const drive = fakeDrive();
  await store.createProject(project('P1', { name: 'v1' }));
  await syncProject(store, drive.api, 'P1', { account });
  const id = (await store.getProjectMeta('P1')).driveLink.fileId;
  drive.touchRemote(id, serializeProjectToPrg(project('P1', { name: 'nuvem' })));
  assert.equal((await syncProject(store, drive.api, 'P1', { account })).status, SYNC_STATUS.REMOTE_NEWER);
  await store.saveProject(project('P1', { name: 'local novo' }));
  const conflict = await syncProject(store, drive.api, 'P1', { account });
  assert.equal(conflict.status, SYNC_STATUS.CONFLICT);
  assert.equal(drive.files.get(id).content.includes('nuvem'), true, 'nada foi enviado');
  const remote = await drive.api.getMeta(id);
  assert.equal(computeSyncStatus(await store.getProjectMeta('P1'), remote), SYNC_STATUS.CONFLICT);
});

test('conflito: manter local envia e cria backup; usar Drive faz backup do local antes de substituir', async () => {
  const store = makeStore(); const drive = fakeDrive();
  await store.createProject(project('P1', { name: 'v1' }));
  await syncProject(store, drive.api, 'P1', { account });
  const id = (await store.getProjectMeta('P1')).driveLink.fileId;
  drive.touchRemote(id, serializeProjectToPrg(project('P1', { name: 'nuvem' })));
  await store.saveProject(project('P1', { name: 'local' }));

  const keep = await resolveConflictKeepLocal(store, drive.api, 'P1', { account });
  assert.equal(keep.status, SYNC_STATUS.SYNCED);
  assert.ok(drive.files.get(id).content.includes('"local"'));
  assert.ok((await store.listBackups('P1')).length >= 1);

  drive.touchRemote(id, serializeProjectToPrg(project('P1', { name: 'nuvem 2' })));
  await store.saveProject(project('P1', { name: 'local 2' }));
  const use = await resolveConflictUseRemote(store, drive.api, 'P1');
  assert.equal(use.ok, true);
  assert.equal((await store.getProject('P1')).state.name, 'nuvem 2');
  assert.ok((await store.listBackups('P1')).some(b => b.state.name === 'local 2'));
  assert.equal(computeSyncStatus(await store.getProjectMeta('P1'), await drive.api.getMeta(id)), SYNC_STATUS.SYNCED);
});

test('usar versão do Drive recusa arquivo de outro projeto', async () => {
  const store = makeStore(); const drive = fakeDrive();
  await store.createProject(project('P1'));
  await syncProject(store, drive.api, 'P1', { account });
  const id = (await store.getProjectMeta('P1')).driveLink.fileId;
  drive.touchRemote(id, serializeProjectToPrg(project('OUTRO')));
  const res = await resolveConflictUseRemote(store, drive.api, 'P1');
  assert.equal(res.ok, false);
  assert.equal((await store.getProject('P1')).state.projectId, 'P1');
});

test('conta Google diferente não envia para o arquivo vinculado', async () => {
  const store = makeStore(); const drive = fakeDrive();
  await store.createProject(project('P1'));
  await syncProject(store, drive.api, 'P1', { account });
  await store.saveProject(project('P1', { name: 'x' }));
  const res = await syncProject(store, drive.api, 'P1', { account: { email: 'outra@x.com', permissionId: 'perm-9' } });
  assert.equal(res.status, SYNC_STATUS.RECONNECT);
  assert.equal(drive.calls.filter(c => c === 'update').length, 0);
});

test('descoberta: paginação, ignora arquivos sem appProperties, relaciona por projectId e preserva locais', async () => {
  const store = makeStore(); const drive = fakeDrive({ pageSize: 2 });
  for (const id of ['L1', 'L2']) await store.createProject(project(id));
  await syncProject(store, drive.api, 'L1', { account });
  for (const id of ['R1', 'R2', 'R3']) await drive.api.create({ name: `${id}.prg`, appProperties: buildAppProperties(project(id)) }, serializeProjectToPrg(project(id)));
  await drive.api.create({ name: 'arquivo-qualquer.prg', appProperties: {} }, '{}');
  const pages = [];
  const found = await discoverDriveProjects(drive.api, { onPage: p => pages.push(p) });
  assert.equal(found.ok, true);
  assert.equal(found.files.length, 4);
  assert.ok(pages.length >= 2, 'paginou');
  const entries = mergeProjectLists(await store.listProjects(), found.files);
  const kinds = Object.fromEntries(entries.map(e => [e.projectId, e.kind]));
  assert.deepEqual(kinds, { L1: 'local+drive', L2: 'local', R1: 'drive-only', R2: 'drive-only', R3: 'drive-only' });
  assert.equal((await store.listProjects()).length, 2, 'nenhum projeto local apagado');
});

test('descoberta trata offline, 401 e 403 sem lançar', async () => {
  const drive = fakeDrive();
  for (const [err, reason] of [[new TypeError('Failed to fetch'), 'offline'], [Object.assign(new Error('a'), { status: 401 }), 'auth'], [Object.assign(new Error('a'), { status: 403 }), 'forbidden']]) {
    drive.fail.next = err;
    const res = await discoverDriveProjects(drive.api);
    assert.equal(res.ok, false); assert.equal(res.reason, reason);
  }
});

test('relacionamento usa projectId/fileId, nunca o nome do arquivo', () => {
  const local = [{ projectId: 'A', name: 'Mesmo nome', driveLink: null }];
  const remote = [{ id: 'f9', name: 'Mesmo nome.prg', appProperties: buildAppProperties(project('Z')) }];
  const kinds = mergeProjectLists(local, remote).map(e => e.kind);
  assert.deepEqual(kinds, ['local', 'drive-only']);
});

test('adicionar projeto só-Drive ao dispositivo cria vínculo; colisão pede decisão; cópia não herda vínculo', async () => {
  const store = makeStore(); const drive = fakeDrive();
  const f = await drive.api.create({ name: 'r.prg', appProperties: buildAppProperties(project('R1')) }, serializeProjectToPrg(project('R1', { name: 'Da nuvem' })));
  const added = await addDriveProjectToDevice(store, drive.api, f.id, { account });
  assert.equal(added.ok, true);
  const meta = await store.getProjectMeta('R1');
  assert.equal(meta.name, 'Da nuvem'); assert.equal(meta.driveLink.fileId, f.id);
  assert.equal(isDrivePending(meta), false);
  const dup = await addDriveProjectToDevice(store, drive.api, f.id, { account });
  assert.equal(dup.collision, true);
  const copy = await addDriveProjectToDevice(store, drive.api, f.id, { account, mode: IMPORT_MODES.COPY });
  assert.equal(copy.ok, true);
  assert.notEqual(copy.projectId, 'R1');
  assert.equal((await store.getProjectMeta(copy.projectId)).driveLink, null);
});

test('mover para a lixeira: respeita canTrash, mantém o projeto local e remove o vínculo', async () => {
  const store = makeStore(); const drive = fakeDrive();
  await store.createProject(project('P1'));
  await syncProject(store, drive.api, 'P1', { account });
  const id = (await store.getProjectMeta('P1')).driveLink.fileId;
  drive.files.get(id).capabilities.canTrash = false;
  assert.equal((await trashProjectOnDrive(store, drive.api, 'P1')).reason, 'cannot-trash');
  assert.ok((await store.getProjectMeta('P1')).driveLink);
  drive.files.get(id).capabilities.canTrash = true;
  const res = await trashProjectOnDrive(store, drive.api, 'P1');
  assert.equal(res.ok, true);
  assert.equal(drive.files.get(id).trashed, true);
  assert.ok(await store.getProject('P1'));
  assert.equal((await store.getProjectMeta('P1')).driveLink, null);
});

test('remover dos dois destinos: se o Drive falhar, o local NÃO é apagado', async () => {
  const store = makeStore(); const drive = fakeDrive();
  await store.createProject(project('P1'));
  await syncProject(store, drive.api, 'P1', { account });
  drive.fail.next = new TypeError('Failed to fetch');
  const failed = await removeFromDeviceAndDrive(store, drive.api, 'P1');
  assert.equal(failed.ok, false);
  assert.ok(await store.getProject('P1'));
  const ok = await removeFromDeviceAndDrive(store, drive.api, 'P1');
  assert.equal(ok.ok, true);
  assert.equal(await store.getProject('P1'), null);
  assert.equal([...drive.files.values()][0].trashed, true);
});

test('excluir só localmente não toca no arquivo do Drive nem deixa vínculo órfão', async () => {
  const store = makeStore(); const drive = fakeDrive();
  await store.createProject(project('P1'));
  await syncProject(store, drive.api, 'P1', { account });
  const callsBefore = drive.calls.length;
  await store.deleteProject('P1');
  assert.equal(drive.calls.length, callsBefore);
  assert.equal([...drive.files.values()][0].trashed, false);
  assert.equal((await store.listProjects()).length, 0);
});

test('estados de sincronização e textos', () => {
  const synced = { localRevision: 1, driveLink: { fileId: 'f', syncedRevision: 1, remoteModifiedTime: '2026-10-01T10:00:00Z' } };
  assert.equal(computeSyncStatus({ localRevision: 1 }), SYNC_STATUS.LOCAL_ONLY);
  assert.equal(computeSyncStatus(synced), SYNC_STATUS.SYNCED);
  assert.equal(computeSyncStatus(synced, null, { syncing: true }), SYNC_STATUS.SYNCING);
  assert.equal(computeSyncStatus({ ...synced, localRevision: 2 }, null, { online: false }), SYNC_STATUS.OFFLINE);
  assert.equal(computeSyncStatus({ ...synced, localRevision: 2 }, null, { lastError: 'auth' }), SYNC_STATUS.RECONNECT);
  assert.equal(syncLabel('offline'), 'Salvo neste dispositivo · Drive indisponível');
  assert.equal(syncLabel('synced'), 'Sincronizado com o Google Drive');
  assert.equal(syncLabel('pending'), 'Alterações pendentes no Drive');
  assert.equal(syncLabel('conflict'), 'Há uma versão diferente no Google Drive');
  assert.equal(classifyDriveError(new DriveError('auth', 'x')), 'auth');
});

test('conta Google: identidade lembrada sem token e estados de autorização', () => {
  const acc = normalizeDriveAccount({ displayName: 'Ana', email: 'ANA@x.com', photoLink: 'http://p', permissionId: 'p1', accessToken: 'SECRETO', token: 'x' });
  assert.deepEqual(Object.keys(acc).sort(), ['displayName', 'email', 'lastVerifiedAt', 'permissionId', 'photoLink']);
  assert.ok(!JSON.stringify(acc).includes('SECRETO'));
  const now = 1_000_000;
  assert.equal(driveAuthState({ account: null }), DRIVE_AUTH_STATES.NONE);
  assert.equal(driveAuthState({ account: acc }), DRIVE_AUTH_STATES.REMEMBERED);
  assert.equal(driveAuthState({ account: acc, hasToken: true, tokenExpiresAt: now + 600_000, now }), DRIVE_AUTH_STATES.AUTHORIZED);
  assert.equal(driveAuthState({ account: acc, hasToken: true, tokenExpiresAt: now - 1, now }), DRIVE_AUTH_STATES.EXPIRED);
  assert.equal(driveAuthState({ account: acc, needsInteraction: true }), DRIVE_AUTH_STATES.RECONNECT);
});
