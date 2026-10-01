/**
 * E2E opcional da integração com o Google Drive usando um Drive FALSO (sem rede, sem conta real).
 * Requer Playwright + Chromium. Uso: NODE_PATH=<global node_modules> node scripts/e2e-drive.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (url.pathname === '/google-drive-config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end("window.PROFESSORGEST_GOOGLE_CONFIG = { clientId: 'fake-client', apiKey: 'fake-key', appId: '1' };");
    return;
  }
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };

/* ----- Drive falso ----- */
const drive = { files: new Map(), n: 0, clock: Date.parse('2026-10-01T12:00:00Z'), mode: 'ok', calls: [] };
const stamp = () => new Date(drive.clock += 60_000).toISOString();
const meta = f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, trashed: f.trashed, appProperties: f.appProperties, mimeType: 'application/json', capabilities: { canEdit: true, canTrash: true, canDelete: true } });
function parseMultipart(body, contentType) {
  const boundary = /boundary=(.+)$/.exec(contentType)[1];
  const parts = body.split(`--${boundary}`).filter(p => p.trim() && p.trim() !== '--');
  const [m, c] = parts.map(p => p.split(/\r\n\r\n/).slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
  return { metadata: JSON.parse(m), content: c };
}

const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: 'block' });
await context.addInitScript(() => {
  window.google = { accounts: { oauth2: { initTokenClient(cfg) {
    const client = { callback: () => {}, errorCallback: null, requestAccessToken() { setTimeout(() => client.callback({ access_token: 'fake-token', expires_in: 3600 }), 20); } };
    return client;
  } } } };
});
await context.route(/accounts\.google\.com|apis\.google\.com|gstatic\.com|fonts\./, r => r.abort());
await context.route(/googleapis\.com\/(drive|upload)\//, async route => {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.replace(/^\/upload/, '');
  drive.calls.push(`${req.method()} ${p}`);
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (drive.mode === '401') return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
  if (drive.mode === 'offline') return route.abort('failed');
  if (p === '/drive/v3/about') return json(200, { user: { displayName: 'Ana Souza', emailAddress: 'ana@escola.com', permissionId: 'perm-1', photoLink: '' } });
  if (p === '/drive/v3/files' && req.method() === 'GET') {
    const list = [...drive.files.values()].filter(f => !f.trashed && f.appProperties?.app === 'professorgest').map(meta);
    return json(200, { files: list });
  }
  if (p === '/drive/v3/files' && req.method() === 'POST') {
    const { metadata, content } = parseMultipart(req.postData() || '', req.headers()['content-type']);
    const f = { id: `file${++drive.n}`, name: metadata.name, appProperties: metadata.appProperties, content, modifiedTime: stamp(), trashed: false };
    drive.files.set(f.id, f); return json(200, meta(f));
  }
  const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
  if (m) {
    const f = drive.files.get(decodeURIComponent(m[1]));
    if (!f) return json(404, { error: { code: 404, message: 'File not found' } });
    if (req.method() === 'GET' && url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: f.content });
    if (req.method() === 'GET') return json(200, meta(f));
    if (req.method() === 'PATCH' && (req.headers()['content-type'] || '').startsWith('multipart')) {
      const { metadata, content } = parseMultipart(req.postData() || '', req.headers()['content-type']);
      f.content = content; f.name = metadata.name; f.appProperties = metadata.appProperties; f.modifiedTime = stamp(); return json(200, meta(f));
    }
    if (req.method() === 'PATCH') { Object.assign(f, JSON.parse(req.postData() || '{}')); return json(200, meta(f)); }
  }
  return json(404, { error: { code: 404, message: `rota não simulada: ${req.method()} ${p}` } });
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });

await page.goto(base);
await page.waitForSelector('#welcomeScreen:not(.is-hidden)', { timeout: 15000 });
check(await page.locator('#cloudPanel').count() === 1, 'painel de nuvem existe e não compete com "Novo projeto"');
check(/Conectar conta/.test(await page.textContent('#cloudPanel')), 'sem conta: oferece "Conectar conta"');
check(await page.locator('#cloudPanel').isVisible(), 'painel do Drive aparece quando a integração está configurada');

await page.waitForSelector('[data-start="blank"]');
await page.click('[data-start="blank"]');
await page.fill('#setupTeacherName', 'Ana Souza');
await page.fill('#setupProjectName', 'Projeto na Nuvem');
await page.click('#setupForm button[type=submit]');
await page.waitForSelector('body.workspace-active');

// 1) primeira sincronização cria o arquivo com appProperties
await page.click('#topbarDriveBtn');
await page.waitForFunction(() => /Sincronizado com o Google Drive/.test(document.getElementById('topbarSaveStatus').textContent), null, { timeout: 10000 });
const first = [...drive.files.values()][0];
check(!!first && first.appProperties.app === 'professorgest' && !!first.appProperties.projectId, 'arquivo criado no Drive com appProperties (app/projectId)');
check(first.name === 'projeto-na-nuvem.prg', `nome do arquivo no Drive derivado do projeto (${first?.name})`);
check(JSON.parse(first.content).name === 'Projeto na Nuvem', 'conteúdo remoto é o .prg com name');
check(drive.calls.filter(c => c.startsWith('POST')).length === 1, 'criação em uma única requisição (sem arquivo órfão)');

// 2) edição local -> pendente -> sincronizar agora
await page.locator('.nav-item[data-view="turmas"]').first().click();
await page.click('#btnNewClass'); await page.click('#btnCreateClassManual');
await page.fill('#classNameInput', '8º A'); await page.click('#classForm button[type=submit]');
await page.waitForFunction(() => /Alterações pendentes no Drive/.test(document.getElementById('topbarSaveStatus').textContent), null, { timeout: 6000 });
check(true, 'edição deixa o status "Alterações pendentes no Drive"');
await page.click('#topbarDriveBtn');
await page.waitForFunction(() => /Sincronizado com o Google Drive/.test(document.getElementById('topbarSaveStatus').textContent), null, { timeout: 10000 });
check(JSON.parse(first.content).classes.length === 1, 'sincronizar agora enviou a edição');

// 3) conflito: remoto muda por fora E local muda
const remote = JSON.parse(first.content); remote.name = 'Versão do Drive'; remote.classes.push({ id: 'x', name: 'Turma só no Drive', archived: false });
first.content = JSON.stringify(remote); first.modifiedTime = stamp();
await page.click('#btnNewClass').catch(() => {});
await page.keyboard.press('Escape');
await page.locator('.nav-item[data-view="turmas"]').first().click();
await page.click('#btnNewClass'); await page.click('#btnCreateClassManual');
await page.fill('#classNameInput', '8º B'); await page.click('#classForm button[type=submit]');
await page.waitForTimeout(1000);
await page.click('#topbarDriveBtn');
await page.waitForSelector('#conflictKeepLocal', { timeout: 10000 });
check(/Há uma versão diferente no Google Drive/.test(await page.textContent('#modalRoot')), 'conflito é explícito (nada sobrescrito em silêncio)');
check(JSON.parse(first.content).name === 'Versão do Drive', 'remoto permanece intacto até a escolha');
await page.click('#conflictKeepLocal');
await page.waitForFunction(() => /Sincronizado com o Google Drive/.test(document.getElementById('topbarSaveStatus').textContent), null, { timeout: 10000 });
check(JSON.parse(first.content).name === 'Projeto na Nuvem', '"Manter versão deste dispositivo" enviou o local');

// 4) falhas do Drive não afetam o salvamento local
drive.mode = '401';
await page.locator('.nav-item[data-view="turmas"]').first().click();
await page.click('#btnNewClass'); await page.click('#btnCreateClassManual');
await page.fill('#classNameInput', '8º C'); await page.click('#classForm button[type=submit]');
await page.waitForTimeout(1000);
await page.click('#topbarDriveBtn');
await page.waitForTimeout(800);
check(/8º C/.test(await page.textContent('#viewContainer')), 'com Drive em 401 o trabalho local segue disponível');
await page.reload();
await page.waitForSelector('body.workspace-active', { timeout: 15000 });
await page.locator('.nav-item[data-view="turmas"]').first().click();
check(/8º C/.test(await page.textContent('#viewContainer')), 'alteração feita durante falha do Drive sobreviveu ao reload (IndexedDB)');
drive.mode = 'ok';

// 5) tela inicial: lista do Drive, projeto só-Drive, adicionar ao dispositivo
const orphan = { id: `file${++drive.n}`, name: 'outro-pc.prg', appProperties: { app: 'professorgest', projectId: 'proj_outro_pc', format: first.appProperties.format, version: first.appProperties.version }, modifiedTime: stamp(), trashed: false,
  content: JSON.stringify({ format: first.appProperties.format, version: Number(first.appProperties.version), projectId: 'proj_outro_pc', name: 'Projeto de outro computador', createdAt: '2026-01-01', updatedAt: '2026-01-01', teacher: { name: 'Ana' }, schools: [], classes: [], assignments: [], enrollments: [], students: [], activities: [], occurrences: [], plans: [] }) };
drive.files.set(orphan.id, orphan);
await page.click('#topbarHomeBtn');
await page.waitForSelector('#cloudRefresh');
await page.click('#cloudRefresh');
await page.waitForSelector('[data-add-drive-project]', { timeout: 10000 }).catch(async e => { console.log('   cloud:', JSON.stringify(await page.textContent('#cloudPanel')), '\n   list:', JSON.stringify((await page.textContent('#projectsList')).slice(0, 400)), '\n   calls:', drive.calls.slice(-6).join(' | ')); throw e; });
check(/Somente no Google Drive/.test(await page.textContent('#projectsList')), 'seção "Somente no Google Drive" aparece após atualizar a lista');
check(/Projeto de outro computador|outro-pc/.test(await page.textContent('#projectsList')), 'projeto só-Drive listado');
check(/Ana Souza/.test(await page.textContent('#cloudPanel')), 'conta Google lembrada aparece no painel de nuvem');
await page.click('[data-add-drive-project]');
await page.waitForFunction(() => document.querySelectorAll('[data-add-drive-project]').length === 0 && /Projeto de outro computador/.test(document.getElementById('projectsList').textContent), null, { timeout: 10000 });
check(true, '"Adicionar a este dispositivo" cria o projeto local vinculado');

// 6) mover para a lixeira do Drive preserva o projeto local
await page.locator('.project-card', { hasText: 'Projeto na Nuvem' }).locator('[data-project-actions]').click();
await page.click('[data-pa="trash"]');
await page.click('#confirmModalOk');
await page.waitForFunction(() => true);
await page.waitForTimeout(1200);
check(first.trashed === true, 'arquivo foi para a lixeira do Drive');
check(await page.locator('.project-card', { hasText: 'Projeto na Nuvem' }).count() === 1, 'projeto local permanece após mover o arquivo do Drive para a lixeira');

// 7) desvincular não apaga nada no Drive
await page.locator('.project-card', { hasText: 'Projeto de outro computador' }).locator('[data-project-actions]').click();
await page.click('[data-pa="unlink"]');
await page.click('#confirmModalOk');
await page.waitForTimeout(600);
check(orphan.trashed === false, 'desvincular não altera o arquivo no Drive');
check(await page.locator('.project-card', { hasText: 'Projeto de outro computador' }).count() === 1, 'projeto continua local após desvincular');

check(errors.length === 0, `sem erros de JavaScript no console (${errors.length})`);
errors.forEach(e => console.log('   ', e));
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
