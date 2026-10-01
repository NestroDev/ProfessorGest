import test from 'node:test';
import assert from 'node:assert/strict';
import { PRG_FORMAT, PRG_VERSION, validateAndParsePrg } from '../frontend/src/prof-model.js';
import {
  createMemoryAdapter, createProjectStore, IMPORT_MODES, STORES, isDrivePending,
  migrateLegacyIfNeeded, MAX_BACKUPS_PER_PROJECT,
} from '../frontend/src/project-store.js';
import { exportProjectPrg, prgFileNameForProject, parsePrgText, serializeProjectToPrg } from '../frontend/src/prg-transfer.js';

let clock = Date.parse('2026-10-01T10:00:00Z');
const tick = () => { clock += 60_000; return new Date(clock); };
const makeStore = () => createProjectStore({ adapter: createMemoryAdapter(), now: tick });

function project(id, extra = {}) {
  return {
    format: PRG_FORMAT, version: PRG_VERSION, projectId: id, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    teacher: { name: 'Ana' }, schools: [], classes: [{ id: 'c1', name: '1A', archived: false }], assignments: [], enrollments: [],
    students: [{ id: 's1', name: 'Aluno 1', classId: 'c1' }, { id: 's2', name: 'Aluno 2', classId: 'c1' }],
    activities: [], occurrences: [], plans: [], ...extra,
  };
}

test('CRUD e vários projetos locais (sem limite de 4)', async () => {
  const store = makeStore();
  for (let i = 1; i <= 7; i++) await store.createProject(project(`p${i}`, { name: `Projeto ${i}` }));
  const list = await store.listProjects();
  assert.equal(list.length, 7);
  assert.equal(list[0].projectId, 'p7');
  assert.equal(list[0].classCount, 1);
  assert.equal(list[0].studentCount, 2);
  assert.equal(list[0].storage.kind, 'indexeddb');
  assert.equal(list[0].state, undefined, 'metadata não carrega dados pedagógicos');
  await store.renameProject('p1', 'Matemática — 2026');
  assert.equal((await store.getProjectMeta('p1')).name, 'Matemática — 2026');
  assert.equal((await store.getProject('p1')).state.name, 'Matemática — 2026');
  await assert.rejects(() => store.createProject(project('p1')), { code: 'PROJECT_EXISTS' });
});

test('salvar não exige arquivo e incrementa a revisão local', async () => {
  const store = makeStore();
  await store.createProject(project('a'));
  const r1 = (await store.getProjectMeta('a')).localRevision;
  const s = (await store.getProject('a')).state;
  s.classes.push({ id: 'c2', name: '2B', archived: false });
  await store.saveProject(s);
  const meta = await store.getProjectMeta('a');
  assert.equal(meta.localRevision, r1 + 1);
  assert.equal(meta.classCount, 2);
});

test('gravação mais antiga não sobrescreve a mais nova', async () => {
  const store = makeStore();
  await store.createProject(project('a'));
  const newer = project('a', { teacher: { name: 'Nova' } });
  await store.saveProject(newer, { savedAt: '2030-01-01T00:00:00.000Z' });
  const stale = project('a', { teacher: { name: 'Antiga' } });
  const res = await store.saveProject(stale, { savedAt: '2029-01-01T00:00:00.000Z' });
  assert.equal(res.written, false);
  assert.equal((await store.getProject('a')).state.teacher.name, 'Nova');
});

test('importação: projeto novo aparece na lista; colisão exige decisão', async () => {
  const store = makeStore();
  const imp = project('x1', { name: 'Importado' });
  assert.equal((await store.inspectImport(imp)).collision, false);
  await store.importProject(imp);
  assert.equal((await store.listProjects()).length, 1);
  assert.equal((await store.inspectImport(imp)).collision, true);
  await assert.rejects(() => store.importProject(imp), { code: 'PROJECT_ID_COLLISION' });
  assert.equal((await store.listProjects()).length, 1, 'nada sobrescrito silenciosamente');
});

test('importar como cópia gera novo projectId, nome explícito e não reutiliza vínculo do Drive', async () => {
  const store = makeStore();
  await store.createProject(project('x1', { name: 'Original' }));
  await store.setDriveLink('x1', { fileId: 'drv1', fileName: 'original.prg', accountEmail: 'a@b.c' });
  const res = await store.importProject(project('x1', { name: 'Original' }), { mode: IMPORT_MODES.COPY });
  assert.notEqual(res.projectId, 'x1');
  const copy = await store.getProjectMeta(res.projectId);
  assert.equal(copy.name, 'Original (cópia)');
  assert.equal(copy.driveLink, null);
  assert.equal((await store.getProject(res.projectId)).state.projectId, res.projectId);
  assert.equal((await store.getProjectMeta('x1')).driveLink.fileId, 'drv1');
  assert.equal((await store.listProjects()).length, 2);
});

test('substituir cria backup do existente e preserva o vínculo do Drive', async () => {
  const store = makeStore();
  await store.createProject(project('x1', { name: 'V1' }));
  await store.setDriveLink('x1', { fileId: 'drv1' });
  await store.importProject(project('x1', { name: 'V2' }), { mode: IMPORT_MODES.REPLACE });
  assert.equal((await store.getProject('x1')).state.name, 'V2');
  const backups = await store.listBackups('x1');
  assert.equal(backups.length, 1);
  assert.equal(backups[0].state.name, 'V1');
  assert.equal((await store.getProjectMeta('x1')).driveLink.fileId, 'drv1');
});

test('backups e recovery são isolados por projeto e limitados', async () => {
  const store = makeStore();
  await store.createProject(project('A'));
  await store.createProject(project('B'));
  for (let i = 0; i < MAX_BACKUPS_PER_PROJECT + 4; i++) await store.createBackup('A', `a${i}`);
  await store.createBackup('B', 'b');
  assert.equal((await store.listBackups('A')).length, MAX_BACKUPS_PER_PROJECT);
  assert.equal((await store.listBackups('B')).length, 1);
  assert.ok((await store.listBackups('A')).every(b => b.projectId === 'A'));
  await store.writeRecovery('A', project('A', { teacher: { name: 'rascunho' } }));
  assert.equal((await store.readRecovery('B')), null);
  assert.equal((await store.readRecovery('A')).state.teacher.name, 'rascunho');
  assert.equal(await store.writeRecovery('A', project('B')), false, 'recovery de outro projeto é recusado');
  await store.discardRecovery('A');
  assert.equal(await store.readRecovery('A'), null);
  // id com prefixo parecido não vaza
  await store.createProject(project('A:x'.replace(':', '-')));
});

test('backup por intervalo evita excesso de dados', async () => {
  const store = makeStore();
  await store.createProject(project('A'));
  assert.ok(await store.createBackupIfDue('A', 'auto', { minIntervalMs: 3_600_000 }));
  assert.equal(await store.createBackupIfDue('A', 'auto', { minIntervalMs: 3_600_000 }), null);
  assert.equal((await store.listBackups('A')).length, 1);
});

test('restaurar backup guarda o estado atual antes e recusa backup de outro projeto', async () => {
  const store = makeStore();
  await store.createProject(project('A', { name: 'antes' }));
  await store.createProject(project('B'));
  const id = await store.createBackup('A', 'snap');
  await store.saveProject(project('A', { name: 'depois' }));
  await store.restoreBackup('A', id);
  assert.equal((await store.getProject('A')).state.name, 'antes');
  assert.ok((await store.listBackups('A')).some(b => b.reason === 'Antes de restaurar uma cópia' && b.state.name === 'depois'));
  const bId = await store.createBackup('B', 'b');
  await assert.rejects(() => store.restoreBackup('A', bId), { code: 'FOREIGN_BACKUP' });
});

test('exclusão em cascata não deixa dados nem vínculo órfão', async () => {
  const store = makeStore();
  await store.createProject(project('A'));
  await store.createProject(project('B'));
  await store.setDriveLink('A', { fileId: 'drvA' });
  await store.createBackup('A', 'x'); await store.createBackup('B', 'y');
  await store.writeRecovery('A', project('A'));
  assert.equal(await store.deleteProject('A'), true);
  assert.equal(await store.getProjectMeta('A'), null);
  assert.equal(await store.getProject('A'), null);
  assert.deepEqual(await store.listBackups('A'), []);
  assert.equal(await store.readRecovery('A'), null);
  assert.equal((await store.listProjects()).some(m => m.driveLink?.fileId === 'drvA'), false);
  const a = store.adapter;
  for (const s of [STORES.projects, STORES.projectData, STORES.recovery]) {
    const keys = await a.transaction(s, 'readonly', tx => tx.keys(s));
    assert.ok(!keys.includes('A'), s);
  }
  assert.equal((await store.listBackups('B')).length, 1, 'outro projeto intacto');
});

test('transação com erro faz rollback (cascata é atômica)', async () => {
  const store = makeStore();
  await store.createProject(project('A'));
  await assert.rejects(() => store.adapter.transaction([STORES.projects, STORES.projectData], 'readwrite', async tx => {
    await tx.delete(STORES.projects, 'A');
    throw new Error('falha');
  }));
  assert.ok(await store.getProjectMeta('A'));
});

test('vínculo Drive: pendência, sincronização, desvinculação e remoção de arquivo', async () => {
  const store = makeStore();
  await store.createProject(project('A'));
  await store.setDriveLink('A', { fileId: 'f1', accountEmail: 'Prof@Escola.com' });
  let meta = await store.getProjectMeta('A');
  assert.equal(meta.driveLink.accountEmail, 'prof@escola.com');
  assert.equal(isDrivePending(meta), true);
  await store.markSynced('A', { remoteModifiedTime: '2026-10-01T10:00:00Z' });
  meta = await store.getProjectMeta('A');
  assert.equal(isDrivePending(meta), false);
  assert.equal(meta.driveLink.remoteModifiedTime, '2026-10-01T10:00:00Z');
  await store.saveProject((await store.getProject('A')).state);
  assert.equal(isDrivePending(await store.getProjectMeta('A')), true);
  await store.markRemoteMissing('A');
  assert.equal((await store.getProjectMeta('A')).driveLink.remoteMissing, true);
  await store.unlinkDrive('A');
  meta = await store.getProjectMeta('A');
  assert.equal(meta.driveLink, null);
  assert.ok(await store.getProject('A'), 'projeto local continua');
});

test('edição durante o envio continua pendente (revisão sincronizada explícita)', async () => {
  const store = makeStore();
  await store.createProject(project('A'));
  await store.setDriveLink('A', { fileId: 'f1' });
  const sentRevision = (await store.getProjectMeta('A')).localRevision;
  await store.saveProject((await store.getProject('A')).state); // edição durante upload
  await store.markSynced('A', { syncedRevision: sentRevision });
  assert.equal(isDrivePending(await store.getProjectMeta('A')), true);
});

test('usar versão do Drive faz backup antes e marca como sincronizado', async () => {
  const store = makeStore();
  await store.createProject(project('A', { name: 'local' }));
  await store.setDriveLink('A', { fileId: 'f1' });
  await store.applyRemoteVersion('A', project('A', { name: 'nuvem' }), { remoteModifiedTime: '2026-10-02T00:00:00Z' });
  assert.equal((await store.getProject('A')).state.name, 'nuvem');
  assert.equal((await store.listBackups('A'))[0].state.name, 'local');
  assert.equal(isDrivePending(await store.getProjectMeta('A')), false);
  await assert.rejects(() => store.applyRemoteVersion('A', project('Z')), { code: 'PROJECT_MISMATCH' });
});

test('reabertura após reload: dados persistem num novo store sobre o mesmo adapter', async () => {
  const adapter = createMemoryAdapter();
  const first = createProjectStore({ adapter, now: tick });
  await first.createProject(project('A', { name: 'Persistente' }));
  await first.setSetting('googleAccount', { email: 'a@b.c' });
  const second = createProjectStore({ adapter, now: tick });
  assert.equal((await second.listProjects())[0].name, 'Persistente');
  assert.deepEqual(await second.getSetting('googleAccount'), { email: 'a@b.c' });
});

test('migração do banco legado é aditiva e roda uma vez', async () => {
  const store = makeStore();
  const legacy = {
    projects: [{ savedAt: '2026-05-01T00:00:00Z', currentFileName: 'Matematica.prg.json', state: project('L1'),
      driveBinding: { projectId: 'L1', fileId: 'dl', name: 'm.prg', modifiedTime: '2026-05-01T00:00:00Z' }, driveSyncPending: true }],
    backups: [{ savedAt: '2026-05-01T00:00:00Z', state: project('L1') }, { state: project('ORFAO') }],
    recovery: [{ savedAt: '2026-05-02T00:00:00Z', state: project('L1') }],
    driveBindings: {},
  };
  let reads = 0;
  const reader = async () => { reads++; return legacy; };
  const out = await migrateLegacyIfNeeded(store, reader);
  assert.equal(out.report.projects, 1);
  assert.equal((await store.getProjectMeta('L1')).name, 'Matematica');
  assert.equal(isDrivePending(await store.getProjectMeta('L1')), true);
  assert.equal((await store.listBackups('L1')).length, 1);
  assert.equal((await store.listBackups('ORFAO')).length, 0);
  assert.ok(await store.readRecovery('L1'));
  await migrateLegacyIfNeeded(store, reader);
  assert.equal(reads, 1);
});

test('exportação .prg: nome vem do projeto, estado do projeto não muda, funciona sem File System Access API', async () => {
  const store = makeStore();
  await store.createProject(project('A', { name: 'Matemática — 2026' }));
  const before = JSON.stringify(await store.getProject('A'));
  const clicks = []; let revoked = 0;
  const doc = { createElement: () => { const a = { style: {}, remove() {}, click() { clicks.push(a); } }; return a; }, body: { appendChild() {} } };
  const win = { URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => { revoked++; } } };
  const state = (await store.getProject('A')).state;
  const res = await exportProjectPrg(state, { env: { document: doc, window: win, navigator: { userAgent: 'Windows' } } });
  assert.equal(res.ok, true);
  assert.equal(res.filename, 'matematica-2026.prg');
  assert.equal(clicks[0].download, 'matematica-2026.prg');
  assert.equal(JSON.stringify(await store.getProject('A')), before, 'projeto local intacto');
  assert.equal((await store.getProjectMeta('A')).name, 'Matemática — 2026');
  assert.equal((await store.listBackups('A')).length, 0);
  assert.equal(prgFileNameForProject(''), 'projeto.prg');
});

test('exportação no Android usa download simples e o arquivo exportado é reimportável', async () => {
  const state = project('A', { name: 'Projeto Android' });
  let href = null;
  const doc = { createElement: () => { const a = { style: {}, remove() {}, click() { href = a.href; } }; return a; }, body: { appendChild() {} } };
  const win = { URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} } };
  await exportProjectPrg(state, { env: { document: doc, window: win, navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)' } } });
  const text = decodeURIComponent(href.split(',').slice(1).join(','));
  const parsed = parsePrgText(text, { fileName: 'x.prg' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.projectId, 'A');
  assert.equal(parsed.data.name, 'Projeto Android');
});

test('exportação por compartilhamento quando suportado; sem suporte não cria arquivo', async () => {
  const state = project('A', { name: 'Compartilhar' });
  let shared = null;
  class F { constructor(parts, name, o) { this.parts = parts; this.name = name; this.type = o.type; } }
  const nav = { share: async d => { shared = d; }, canShare: () => true, userAgent: 'x' };
  const ok = await exportProjectPrg(state, { share: true, env: { navigator: nav, File: F } });
  assert.equal(ok.ok, true); assert.equal(shared.files[0].name, 'compartilhar.prg');
  const no = await exportProjectPrg(state, { share: true, env: { navigator: { userAgent: 'x' }, File: F } });
  assert.equal(no.ok, false);
});

test('exportação recusa estado inválido', () => {
  assert.throws(() => serializeProjectToPrg({ format: 'x' }));
  assert.throws(() => serializeProjectToPrg(null));
});

test('importar .prg antigo sem "name" usa o nome do arquivo só como sugestão e mantém compatibilidade', () => {
  const legacy = JSON.stringify(project('OLD'));
  const parsed = parsePrgText(legacy, { fileName: 'Turmas 2025.prg' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.name, 'Turmas 2025');
  assert.equal(validateAndParsePrg(legacy).ok, true);
  assert.equal(parsePrgText('{"format":"nao"}').ok, false);
  assert.equal(parsePrgText('lixo').ok, false);
});

test('salvar nunca ressuscita um projeto excluído (autosave tardio / outra aba)', async () => {
  const store = makeStore();
  await store.createProject(project('Z', { name: 'Excluído' }));
  const stale = (await store.getProject('Z')).state;
  await store.deleteProject('Z');
  await assert.rejects(() => store.saveProject(stale), { code: 'PROJECT_NOT_FOUND' });
  assert.equal(await store.getProjectMeta('Z'), null);
  assert.equal((await store.listProjects()).length, 0);
  // recriar só por decisão explícita
  await store.saveProject(stale, { recreate: true });
  assert.equal((await store.listProjects()).length, 1);
});

test('recuperação não é gravada para projeto inexistente e não sobrevive à reimportação', async () => {
  const store = makeStore();
  assert.equal(await store.writeRecovery('FANTASMA', project('FANTASMA')), false);
  assert.deepEqual(await store.listRecoveryIds(), []);
  await store.createProject(project('R'));
  await store.writeRecovery('R', project('R', { name: 'rascunho antigo' }));
  await store.deleteProject('R');
  assert.equal(await store.readRecovery('R'), null);
  // projeto volta (ex.: adicionado do Drive): sem rascunho antigo
  await store.writeRecovery('R', project('R')); // ignorado: não existe
  await store.importProject(project('R', { name: 'do Drive' }));
  assert.equal(await store.readRecovery('R'), null);
  // substituir também limpa rascunho existente
  await store.writeRecovery('R', project('R', { name: 'rascunho' }));
  await store.importProject(project('R', { name: 'v2' }), { mode: IMPORT_MODES.REPLACE });
  assert.equal(await store.readRecovery('R'), null);
});

test('excluir, depois adicionar o mesmo projeto do Drive não acusa colisão', async () => {
  const store = makeStore();
  await store.createProject(project('D', { name: 'rosangela' }));
  await store.deleteProject('D');
  assert.equal((await store.inspectImport(project('D'))).collision, false);
  const res = await store.importProject(project('D', { name: 'rosangela' }));
  assert.equal(res.projectId, 'D');
});
