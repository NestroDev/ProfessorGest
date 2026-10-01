import test from 'node:test';
import assert from 'node:assert/strict';
import { projectsListHTML, filterEntries, needsAttention, cloudAccountSummary, statusTone, relativeTime, startCardsHTML } from '../frontend/src/views-projects.js';
import { SYNC_STATUS } from '../frontend/src/drive-sync.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const meta = (id, over = {}) => ({ projectId: id, name: `Projeto ${id}`, teacherName: 'Ana', classCount: 2, studentCount: 1, updatedAt: '2026-10-01T10:00:00Z', ...over });
const ctx = (over = {}) => ({ esc, formatTime: v => `T(${v})`, statusFor: e => (e.meta.driveLink ? SYNC_STATUS.PENDING : SYNC_STATUS.LOCAL_ONLY), ...over });

test('lista vários projetos sem carregar dados pedagógicos e mostra contagens e indicadores', () => {
  const entries = Array.from({ length: 6 }, (_, i) => ({ kind: 'local', projectId: `p${i}`, meta: meta(`p${i}`), remote: null }));
  entries.push({ kind: 'local+drive', projectId: 'd1', meta: meta('d1', { driveLink: { fileId: 'x' } }), remote: { id: 'x' } });
  const html = projectsListHTML(entries, ctx());
  assert.equal((html.match(/data-open-project=/g) || []).length, 7);
  assert.ok(html.includes('2 turmas'));
  assert.ok(html.includes('1 aluno<'));
  assert.ok(!html.includes('Neste dispositivo'), 'sem selo redundante: o status já diz onde está salvo');
  assert.ok(html.includes('Mais recente'), 'o projeto mais recente é destacado');
  assert.ok(html.includes('Google Drive'));
  assert.ok(html.includes('Alterações pendentes no Drive'));
  assert.ok(html.includes('Salvo neste dispositivo'));
});

test('projetos só no Drive ficam em seção separada e oferecem "Adicionar a este dispositivo"', () => {
  const entries = [
    { kind: 'local', projectId: 'a', meta: meta('a'), remote: null },
    { kind: 'drive-only', projectId: 'r1', meta: null, remote: { id: 'file-9', name: 'Matematica.prg', modifiedTime: '2026-10-02T00:00:00Z' } },
  ];
  const html = projectsListHTML(entries, ctx());
  assert.ok(html.includes('Somente no Google Drive'));
  assert.ok(html.includes('data-add-drive-project="file-9"'));
  assert.ok(!html.includes('data-open-project="r1"'));
  assert.ok(html.includes('Matematica'));
});

test('estado vazio, busca sem resultado e nomes são escapados', () => {
  const empty = projectsListHTML([], ctx());
  assert.ok(empty.includes('Como você quer começar?'));
  for (const key of ['ded', 'blank', 'import', 'demo']) assert.ok(empty.includes(`data-start="${key}"`), `caminho ${key} visível`);
  assert.ok(empty.indexOf('data-start="ded"') < empty.indexOf('data-start="blank"'), 'DED+ aparece primeiro');
  const entries = [{ kind: 'local', projectId: 'a', meta: meta('a', { name: '<img src=x onerror=alert(1)>' }), remote: null }];
  assert.ok(!projectsListHTML(entries, ctx()).includes('<img'));
  assert.ok(projectsListHTML(entries, ctx({ query: 'zzz' })).includes('Nenhum projeto encontrado'));
});

test('pesquisa ignora acentos e caixa', () => {
  const entries = [{ kind: 'local', meta: meta('a', { name: 'Matemática — 2026' }) }, { kind: 'local', meta: meta('b', { name: 'História' }) }];
  assert.equal(filterEntries(entries, 'matematica').length, 1);
  assert.equal(filterEntries(entries, 'HISTORIA').length, 1);
  assert.equal(filterEntries(entries, '').length, 2);
});

test('estados exibem tons distintos e filtram atenção', () => {
  assert.equal(statusTone(SYNC_STATUS.CONFLICT), 'danger');
  assert.equal(statusTone(SYNC_STATUS.SYNCED), 'ok');
  assert.equal(needsAttention(SYNC_STATUS.CONFLICT), true);
  assert.equal(needsAttention(SYNC_STATUS.SYNCED), false);
  assert.equal(needsAttention(SYNC_STATUS.SYNCED, { hasRecovery: true }), true);
});

test('conta Google distingue lembrada, autorizada, expirada e reconexão', () => {
  const account = { displayName: 'Ana', email: 'a@b.c' };
  assert.equal(cloudAccountSummary({ configured: false }).meta, 'Não configurado');
  assert.equal(cloudAccountSummary({ configured: true, account: null }).meta, 'Conectar conta');
  for (const [s, text] of [['remembered', 'Conta lembrada'], ['authorized', 'Autorização disponível'], ['expired', 'Autorização expirada'], ['reconnect', 'Reconexão necessária']]) {
    assert.ok(cloudAccountSummary({ configured: true, account, authState: s }).meta.includes(text));
  }
});

test('cartão inteiro é um botão acessível e mostra "Projeto vazio" sem contagens zeradas', () => {
  const entries = [{ kind: 'local', projectId: 'p1', meta: meta('p1', { classCount: 0, studentCount: 0 }), remote: null }];
  const html = projectsListHTML(entries, ctx());
  assert.match(html, /<button type="button" class="project-card-main project-open" data-open-project="p1" aria-label="Abrir projeto Projeto p1">/);
  assert.match(html, /aria-label="Mais ações do projeto Projeto p1"/);
  assert.ok(html.includes('Projeto vazio'));
  assert.ok(!html.includes('0 turmas'));
});

test('tempo relativo é legível', () => {
  const now = new Date(2026, 9, 1, 15, 0).getTime();
  const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
  assert.equal(relativeTime(at(1, 13, 5), { now }), 'hoje às 13:05');
  assert.equal(relativeTime(at(30 - 29, 9), { now }), 'hoje às 09:00');
  assert.equal(relativeTime(new Date(2026, 8, 30, 8, 0).toISOString(), { now }), 'ontem às 08:00');
  assert.equal(relativeTime(new Date(2026, 8, 27, 8, 0).toISOString(), { now }), 'há 4 dias');
  assert.equal(relativeTime(new Date(2026, 8, 1, 8, 0).toISOString(), { now, fallback: () => '01/09' }), '01/09');
  assert.equal(relativeTime('', { now }), '');
});

test('com um único projeto não há selo "Mais recente"', () => {
  const html = projectsListHTML([{ kind: 'local', projectId: 'a', meta: meta('a'), remote: null }], ctx());
  assert.ok(!html.includes('Mais recente'));
});
