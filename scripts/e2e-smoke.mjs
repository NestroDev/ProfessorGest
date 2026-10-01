/**
 * Teste ponta a ponta opcional (requer Playwright instalado e um Chromium).
 * Uso: NODE_PATH=<global node_modules> node scripts/e2e-smoke.mjs
 * Não faz parte de `npm test` para não exigir navegador no CI padrão.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (url.pathname === '/') file = path.join(root, 'index.html');
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
await context.route(/accounts\.google\.com|apis\.google\.com|gstatic\.com|googleapis\.com|fonts\./, r => r.abort());
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });

await page.goto(base);
await page.waitForSelector('#welcomeScreen:not(.is-hidden)', { timeout: 15000 });
check(/Seus projetos/.test(await page.textContent('#welcomeScreen h1')), 'tela inicial mostra "Seus projetos"');
check(await page.locator('#cloudPanel').isHidden(), 'sem Drive configurado o painel de nuvem não ocupa espaço');
check(await page.locator('.start-panel [data-start]').count() === 4, 'estado vazio guiado oferece DED+, em branco, .prg e demonstração');
check(await page.locator('#welcomeNewProject').isHidden(), 'sem duplicar botões no estado vazio');
check(await page.locator('#projectsToolbar').isHidden(), 'busca escondida enquanto há poucos projetos');
await page.click('[data-start="ded"]');
await page.waitForSelector('#dedPdfInput');
check(/Importar do DED|Criar projeto pelo DED/.test(await page.textContent('#modalRoot')), 'DED+ é acessível direto da tela inicial');
await page.click('#modalCancel');

async function createProject(teacher, name) {
  if (await page.locator('[data-start="blank"]').count()) await page.click('[data-start="blank"]');
  else { await page.click('#welcomeNewProject'); await page.click('#chooseBlank'); }
  await page.fill('#setupTeacherName', teacher);
  await page.fill('#setupProjectName', name);
  await page.click('#setupForm button[type=submit]');
  await page.waitForSelector('body.workspace-active', { timeout: 10000 });
}
async function backToProjects() {
  await page.click('#topbarHomeBtn');
  await page.waitForSelector('#welcomeScreen:not(.is-hidden)');
  await page.waitForSelector('#projectsList .project-card, #projectsList .projects-empty');
}

await createProject('Ana Souza', 'Matemática — 2026');
check((await page.textContent('#topbarFile')).includes('Matemática — 2026'), 'topo mostra o nome real do projeto');
check(/Salvo neste dispositivo/.test(await page.textContent('#topbarSaveStatus')), 'status "Salvo neste dispositivo" no chip da barra');

// persiste após recarregar a página (IndexedDB), retomando o projeto aberto
await page.waitForTimeout(900);
await page.reload();
await page.waitForSelector('body.workspace-active', { timeout: 15000 });
check((await page.textContent('#topbarFile')).includes('Matemática — 2026'), 'projeto reaberto após reload');

await backToProjects();
check(await page.locator('#projectsList .project-card').count() === 1, 'projeto aparece na lista');
check(/Projeto vazio/.test(await page.textContent('#projectsList')), 'cartão de projeto sem turmas mostra "Projeto vazio"');


// vários projetos (sem limite de 4)
for (let i = 2; i <= 6; i++) { await createProject('Ana Souza', `Projeto ${i}`); await page.waitForTimeout(150); await backToProjects(); }
check(await page.locator('#projectsList .project-card').count() === 6, 'seis projetos coexistem (sem limite de 4)');
check(await page.locator('#projectsToolbar').isVisible(), 'busca aparece quando há vários projetos');

// busca
await page.fill('#projectSearch', 'matematica');
check(await page.locator('#projectsList .project-card').count() === 1, 'busca ignora acentos');
await page.fill('#projectSearch', '');

// exportar .prg do projeto "Matemática"
await page.locator('.project-card', { hasText: 'Matemática' }).locator('[data-project-actions]').click();
const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-pa="export"]')]);
check(download.suggestedFilename() === 'matematica-2026.prg', `nome do .prg derivado do projeto (${download.suggestedFilename()})`);
const exportedPath = path.join('/tmp', 'e2e-export.prg');
await download.saveAs(exportedPath);
const exported = JSON.parse(fs.readFileSync(exportedPath, 'utf8'));
check(exported.name === 'Matemática — 2026' && !!exported.projectId, '.prg exportado contém projectId e name');
check(await page.locator('#projectsList .project-card').count() === 6, 'exportar não altera a lista de projetos');

// importar o mesmo arquivo -> colisão -> importar como cópia
await page.setInputFiles('#prgImportInput', exportedPath);
await page.waitForSelector('#collisionCopy, #importAsCopy', { timeout: 8000 });
check(/já existe neste dispositivo/.test(await page.textContent('#modalRoot')), 'colisão de projectId exige decisão');
check(await page.locator('#projectsList .project-card').count() === 6, 'nada sobrescrito antes da escolha');
await page.click('#importAsCopy, #collisionCopy');
await page.waitForFunction(() => document.querySelectorAll('#projectsList .project-card').length === 7, null, { timeout: 8000 });
check(/Matemática — 2026 \(cópia\)/.test(await page.textContent('#projectsList')), 'cópia importada com nome explícito');

// importar arquivo inválido
fs.writeFileSync('/tmp/e2e-bad.prg', '{"nao":"prg"}');
await page.setInputFiles('#prgImportInput', '/tmp/e2e-bad.prg');
await page.waitForSelector('#modalRoot .modal-box', { timeout: 5000 });
check(await page.locator('#projectsList .project-card').count() === 7, 'arquivo inválido não cria projeto');
await page.click('#modalCancel');

// importar projeto novo (novo id) -> aparece imediatamente
const fresh = { ...exported, projectId: 'proj_externo_001', name: 'Importado de fora' };
fs.writeFileSync('/tmp/e2e-fresh.prg', JSON.stringify(fresh));
await page.setInputFiles('#prgImportInput', '/tmp/e2e-fresh.prg');
await page.waitForFunction(() => /Importado de fora/.test(document.getElementById('projectsList').textContent), null, { timeout: 8000 });
check(true, 'projeto importado aparece imediatamente na lista');

// renomear
await page.locator('.project-card', { hasText: 'Importado de fora' }).locator('[data-project-actions]').click();
await page.click('[data-pa="rename"]');
await page.fill('#renameProjectInput', 'Renomeado');
await page.click('#renameProjectForm button[type=submit]');
await page.waitForFunction(() => /Renomeado/.test(document.getElementById('projectsList').textContent));
check(true, 'renomear atualiza a lista');

// abrir, editar (nova turma) e ver contagem
await page.locator('.project-card', { hasText: 'Renomeado' }).locator('[data-open-project]').click();
await page.waitForSelector('body.workspace-active');
await page.locator('.nav-item[data-view="turmas"]').first().click();
await page.click('#btnNewClass');
await page.click('#btnCreateClassManual');
await page.fill('#classNameInput', '7º Ano B');
await page.click('#classForm button[type=submit]');
await page.waitForTimeout(1000);                 // autosave (700 ms)
await page.reload();                              // recarrega: deve voltar com a turma criada
await page.waitForSelector('body.workspace-active', { timeout: 15000 });
await page.locator('.nav-item[data-view="turmas"]').first().click();
check(/7º Ano B/.test(await page.textContent('#viewContainer')), 'edição foi salva no IndexedDB e sobrevive ao reload');
await backToProjects();
const reflected = await page.waitForFunction(() => [...document.querySelectorAll('.project-card')].some(c => /Renomeado/.test(c.textContent) && /1 turma(?!s)/.test(c.textContent)), null, { timeout: 5000 }).then(() => true).catch(() => false);
check(reflected, 'cartão reflete 1 turma após a edição');
if (!reflected) console.log('   cartões:', JSON.stringify(await page.locator('.project-card').allInnerTexts()));

// excluir localmente (confirmação dupla de contexto)
await page.locator('.project-card', { hasText: 'Renomeado' }).locator('[data-project-actions]').click();
await page.click('[data-pa="delete"]');
await page.click('#confirmModalOk');
await page.waitForFunction(() => !/Renomeado/.test(document.getElementById('projectsList').textContent), null, { timeout: 8000 });
check(true, 'excluir do dispositivo remove o projeto');

// cópias de segurança por projeto
await page.locator('.project-card', { hasText: 'Matemática — 2026' }).first().locator('[data-project-actions]').click();
await page.click('[data-pa="backups"]');
await page.waitForSelector('.backup-toolbar');
check(true, 'modal de cópias de segurança abre por projeto');
await page.click('#modalCancel');

// dados persistem em nova sessão do mesmo contexto
const page2 = await context.newPage();
await page2.goto(base);
await page2.waitForSelector('#projectsList .project-card', { timeout: 10000 });
check(await page2.locator('#projectsList .project-card').count() === 7, 'nova aba enxerga os mesmos projetos (IndexedDB)');


// ---- página do projeto, configurações, seletor do DED+ e demonstração ----
await page2.close();
await page.locator('.project-card', { hasText: 'Matemática — 2026' }).first().locator('[data-open-project]').click();
await page.waitForSelector('body.workspace-active');
await page.locator('.nav-item[data-view="arquivo"]').first().click();
const projectPage = await page.textContent('#viewContainer');
check(/projeto atual/i.test(projectPage) && /Matemática — 2026/.test(projectPage), 'página "Projeto" mostra o nome do projeto');
check(/Enviar ao Google Drive/.test(projectPage) && /Exportar \.prg/.test(projectPage), 'página "Projeto" oferece Drive e exportação');
check(!/Abrir arquivo|Novo arquivo/.test(projectPage), 'sem textos de "arquivo" como modelo principal');
await page.click('#btnDedProjectUpdate');
await page.waitForSelector('#btnChooseDedPdf');
check(/Atualizar projeto com DED\+/.test(await page.textContent('#modalRoot')) && await page.locator('#dedPdfInput[multiple]').count() === 1, 'DED+ aceita vários PDFs em "Atualizar projeto"');
await page.click('#modalCancel');
await page.locator('.nav-item[data-view="configuracoes"]').first().click();
check(/Projeto e Google Drive/.test(await page.textContent('#viewContainer')), 'configurações renderizam sem o modelo antigo de arquivos');
await page.click('#topbarHomeBtn');
await page.waitForSelector('#welcomeDemo');
await page.click('#welcomeDemo');
await page.waitForSelector('body.workspace-active');
check(/Demonstração/.test(await page.textContent('#topbarFile')), 'demonstração abre sem gravar nada');
await page.click('#topbarHomeBtn');
await page.waitForSelector('#projectsList');
check(!/Demonstra/.test(await page.textContent('#projectsList')), 'demonstração não vira projeto salvo');

// ---- recuperação por projeto (sessão interrompida) ----
const recId = await page.evaluate(async () => {
  const { createProjectStore, createIndexedDbAdapter } = await import('/src/project-store.js');
  const store = createProjectStore({ adapter: createIndexedDbAdapter() });
  const [meta] = (await store.listProjects()).filter(m => m.name === 'Projeto 3');
  const { state } = await store.getProject(meta.projectId);
  await store.writeRecovery(meta.projectId, { ...state, name: 'Projeto 3 (rascunho recuperado)' });
  return meta.projectId;
});
await page.reload();
await page.waitForSelector('#welcomeScreen:not(.is-hidden)', { timeout: 15000 }).catch(() => {});
if (await page.locator('body.workspace-active').count()) { await page.click('#topbarHomeBtn'); await page.waitForSelector('#projectsList .project-card'); }
await page.waitForSelector('#projectsList .project-card');
check(/Recuperação disponível/.test(await page.locator('.project-card', { hasText: 'Projeto 3' }).textContent()), 'cartão sinaliza "Recuperação disponível" só para aquele projeto');
check(await page.locator('.project-badge.recovery').count() === 1, 'recuperação não vaza para outros projetos');
await page.locator('.project-card', { hasText: 'Projeto 3' }).locator('[data-open-project]').click();
await page.waitForSelector('#recoveryUseDraft', { timeout: 8000 });
await page.click('#recoveryUseDraft');
await page.waitForSelector('body.workspace-active');
check(/rascunho recuperado/.test(await page.textContent('#topbarFile')), 'usar a recuperação restaura o rascunho do projeto');
await page.waitForTimeout(1200);
await page.click('#topbarHomeBtn');
await page.waitForSelector('#projectsList .project-card');
await page.waitForFunction(() => /rascunho recuperado/.test(document.getElementById('projectsList').textContent), null, { timeout: 6000 });
check(await page.locator('.project-badge.recovery').count() === 0, 'após salvar, a recuperação do projeto é descartada');

// ---- migração do banco antigo (centrado em arquivo) ----
const legacyCtx = await browser.newContext({ serviceWorkers: 'block' });
await legacyCtx.route(/accounts\.google\.com|apis\.google\.com|gstatic\.com|googleapis\.com|fonts\./, r => r.abort());
const lp = await legacyCtx.newPage();
const lerrors = [];
lp.on('pageerror', e => lerrors.push(e.message));
await lp.goto(base + 'seed');   // 404 na mesma origem: sem executar o app
await lp.evaluate(async () => {
  const { PRG_FORMAT, PRG_VERSION } = await import('/src/prof-model.js');
  const mk = (id, teacher) => ({ format: PRG_FORMAT, version: PRG_VERSION, projectId: id, createdAt: '2025-01-01', updatedAt: '2025-06-01', teacher: { name: teacher }, schools: [], classes: [{ id: 'c1', name: '1A', archived: false }], assignments: [], enrollments: [], students: [], activities: [], occurrences: [], plans: [] });
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('professorgest-local-prg-v1', 3);
    req.onupgradeneeded = () => { for (const n of ['projects', 'recovery', 'metadata', 'backups']) req.result.createObjectStore(n); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['projects', 'backups'], 'readwrite');
      tx.objectStore('projects').put({ state: mk('legacy_1', 'Rosângela'), savedAt: '2025-06-01T10:00:00.000Z', savedAtMs: Date.parse('2025-06-01T10:00:00Z'), currentFileName: 'Turmas 2025.prg', driveBinding: { projectId: 'legacy_1', fileId: 'drive-legacy', name: 'turmas.prg', modifiedTime: '2025-06-01T10:00:00Z' }, driveSyncPending: true }, 'legacy_1');
      tx.objectStore('projects').put({ state: mk('legacy_2', 'Rosângela'), savedAt: '2025-05-01T10:00:00.000Z', savedAtMs: Date.parse('2025-05-01T10:00:00Z'), currentFileName: 'Outro.prg' }, 'legacy_2');
      tx.objectStore('backups').put({ state: mk('legacy_1', 'Rosângela'), savedAt: '2025-05-20T10:00:00.000Z', backupId: 'b1' }, 'b1');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
});
await lp.goto(base);
await lp.waitForSelector('#projectsList .project-card', { timeout: 15000 });
const cards = await lp.locator('#projectsList .project-card').allInnerTexts();
check(cards.length === 2, `migração trouxe os 2 projetos antigos (${cards.length})`);
check(cards.some(c => /Turmas 2025/.test(c) && /1 turma/.test(c)), 'nome do projeto migrado vem do arquivo antigo e contagens aparecem');
check(cards.some(c => /Google Drive/.test(c) && /pendentes|Alterações/.test(c)), 'vínculo do Drive migrado para dentro do projeto, com pendência preservada');
await lp.reload();
await lp.waitForSelector('#projectsList .project-card');
check(await lp.locator('#projectsList .project-card').count() === 2, 'migração roda uma vez (reload não duplica)');
const stillThere = await lp.evaluate(async () => (await indexedDB.databases()).some(d => d.name === 'professorgest-local-prg-v1'));
check(stillThere, 'banco antigo preservado (migração aditiva)');
check(lerrors.length === 0, `migração sem erros de JavaScript (${lerrors.length})`);
await legacyCtx.close();


// ---- excluir numa aba não pode ser desfeito pelo autosave de outra aba ----
const twoCtx = await browser.newContext({ serviceWorkers: 'block' });
await twoCtx.route(/accounts\.google\.com|apis\.google\.com|gstatic\.com|googleapis\.com|fonts\./, r => r.abort());
const tabA = await twoCtx.newPage();
await tabA.goto(base);
await tabA.waitForSelector('[data-start="blank"]');
await tabA.click('[data-start="blank"]');
await tabA.fill('#setupTeacherName', 'Rosangela'); await tabA.fill('#setupProjectName', 'Duas abas');
await tabA.click('#setupForm button[type=submit]');
await tabA.waitForSelector('body.workspace-active');
await tabA.waitForTimeout(900);
const tabB = await twoCtx.newPage();
await tabB.goto(base);
await tabB.waitForSelector('[data-open-project]');
await tabB.click('[data-open-project]');
await tabB.waitForSelector('body.workspace-active');
await tabA.click('#topbarHomeBtn'); await tabA.waitForSelector('[data-project-actions]');
await tabA.locator('[data-project-actions]').first().click(); await tabA.click('[data-pa="delete"]'); await tabA.click('#confirmModalOk');
await tabA.waitForSelector('[data-start="blank"]');
await tabB.locator('.nav-item[data-view="turmas"]').first().click();
await tabB.click('#btnNewClass'); await tabB.click('#btnCreateClassManual');
await tabB.fill('#classNameInput', '9B'); await tabB.click('#classForm button[type=submit]');
await tabB.waitForSelector('#removedRestore', { timeout: 8000 });
check(/removido deste dispositivo/.test(await tabB.textContent('#modalRoot')), 'aba antiga é avisada de que o projeto foi excluído em outra janela');
await tabA.reload(); await tabA.waitForSelector('[data-start="blank"]');
check(await tabA.locator('.project-card').count() === 0, 'projeto excluído NÃO é recriado pelo autosave da outra aba');
await tabB.click('#removedDiscard');
await tabB.waitForSelector('#welcomeScreen:not(.is-hidden)');
await tabB.reload(); await tabB.waitForSelector('[data-start="blank"]');
check(true, 'descartar fecha sem recriar o projeto');
await twoCtx.close();

check(errors.length === 0, `sem erros de JavaScript no console (${errors.length})`);
errors.forEach(e => console.log('   ', e));
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
