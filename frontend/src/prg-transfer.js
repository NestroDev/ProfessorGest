/**
 * ".prg" = formato PORTÁTIL de importação/exportação.
 * Nada aqui altera o projeto local: exportar gera uma cópia; importar produz
 * dados validados que o project-store adiciona ao IndexedDB.
 */
import { PRG_MIME, validateAndParsePrg, MAX_PRG_BYTES } from './prof-model.js';
import { normalizeExistingDedData } from './ded-parser.js';
import { downloadTextFile, shareFile, readTextFileUtf8, supportsFileShare } from './file-io.js';
import { projectNameOf } from './project-store.js';

/** "Matemática — 2026" -> "matematica-2026" */
export function slugifyProjectName(name) {
  const slug = String(name ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'projeto';
}

export function prgFileNameForProject(projectName) {
  return `${slugifyProjectName(projectName)}.prg`;
}

/**
 * Serializa o estado ATUAL do projeto para ".prg". Valida o resultado
 * relendo o próprio texto gerado, para nunca exportar um arquivo inválido.
 */
export function serializeProjectToPrg(state) {
  if (!state || typeof state !== 'object') throw new Error('Não há projeto para exportar.');
  const json = JSON.stringify(state, null, 2);
  const check = validateAndParsePrg(json);
  if (!check.ok) throw new Error('Não foi possível preparar a cópia do projeto: os dados não passaram na validação.');
  return json;
}

/**
 * Exporta uma cópia ".prg". Estratégia simples e confiável: download por Blob
 * (data: URL no Android) — sem File System Access API e sem FileHandle.
 * Opcionalmente compartilha. Não retorna nem altera estado do projeto.
 */
export async function exportProjectPrg(state, { share = false, env = {} } = {}) {
  const json = serializeProjectToPrg(state);
  const filename = prgFileNameForProject(projectNameOf(state));
  const bytes = new TextEncoder().encode(json).length;

  if (share) {
    const navigatorLike = env.navigator ?? globalThis.navigator;
    const FileCtor = env.File ?? globalThis.File;
    if (supportsFileShare(navigatorLike, FileCtor)) {
      const shared = await shareFile(json, filename, PRG_MIME, navigatorLike, FileCtor);
      if (shared) return { ok: true, method: 'share', filename, bytes };
    }
    return { ok: false, method: 'share', filename, bytes, reason: 'share-unsupported' };
  }

  downloadTextFile(json, filename, PRG_MIME, {
    documentLike: env.document ?? globalThis.document,
    windowLike: env.window ?? globalThis.window,
    navigatorLike: env.navigator ?? globalThis.navigator,
  });
  return { ok: true, method: 'download', filename, bytes };
}

export const IMPORT_ERRORS = Object.freeze({
  size: 'O arquivo é maior do que o limite permitido pelo ProfessorGest.',
  json: 'O arquivo não é um JSON válido.',
  format: 'O arquivo não parece ser um projeto válido do ProfessorGest.',
  version: 'Este arquivo usa uma versão do ProfessorGest que ainda não é suportada por este aplicativo.',
  projectId: 'O arquivo não possui um identificador de projeto válido.',
  shape: 'O arquivo está incompleto ou corrompido (faltam dados essenciais como turmas, alunos, atividades ou ocorrências).',
  limits: 'O arquivo excede os limites de quantidade de turmas, alunos, escolas ou atividades suportados.',
  integrity: 'O arquivo contém registros duplicados ou inconsistentes e não pôde ser importado com segurança.',
});

export function importErrorMessage(code) {
  return IMPORT_ERRORS[code] || IMPORT_ERRORS.format;
}

/** ler -> validar -> normalizar. Retorna { ok, data, warnings, suggestedName } ou { ok:false, error, message }. */
export function parsePrgText(text, { fileName = '' } = {}) {
  const result = validateAndParsePrg(text);
  if (!result.ok) return { ok: false, error: result.error, message: importErrorMessage(result.error) };
  const normalized = normalizeExistingDedData(result.data);
  const data = normalized.data;
  const fromFile = String(fileName || '').replace(/(?:\.json)+$/i, '').replace(/\.(prg|prof)$/i, '').trim();
  // Arquivos antigos não têm "name": usa o nome do arquivo apenas como sugestão inicial.
  const named = data.name || !fromFile ? data : { ...data, name: fromFile };
  return { ok: true, data: named, warnings: result.warnings || [] };
}

export async function readPrgFile(file) {
  if (!file) return { ok: false, error: 'format', message: importErrorMessage('format') };
  if (Number(file.size) > MAX_PRG_BYTES) return { ok: false, error: 'size', message: importErrorMessage('size') };
  let text;
  try { text = await readTextFileUtf8(file); }
  catch (_) { return { ok: false, error: 'format', message: 'Não foi possível ler o arquivo selecionado.' }; }
  return parsePrgText(text, { fileName: file.name });
}
