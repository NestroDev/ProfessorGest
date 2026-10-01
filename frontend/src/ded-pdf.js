import { parseDedText } from './ded-parser.js';

const MAX_DED_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DED_PAGES = 100;
let pdfjsPromise = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdfjs/pdf.mjs')
      .then(pdfjs => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.mjs', import.meta.url).toString();
        return pdfjs;
      })
      .catch(error => {
        // Um erro transitório (cache/service worker/extensão) não pode
        // contaminar as próximas tentativas de importação nesta sessão.
        pdfjsPromise = null;
        const detail = error?.message ? ` (${error.message})` : '';
        throw new Error(`A biblioteca de leitura de PDF não pôde ser carregada${detail}. Atualize a página e tente novamente.`);
      });
  }
  return pdfjsPromise;
}

function groupTextItems(items) {
  const ordered = (items || [])
    .filter(item => String(item?.str || ''))
    .map(item => ({
      item,
      y: Number(item?.transform?.[5] || 0),
      x: Number(item?.transform?.[4] || 0),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const groups = [];
  for (const entry of ordered) {
    const previous = groups.at(-1);
    if (previous && Math.abs(previous.y - entry.y) <= 2) {
      previous.items.push(entry.item);
      continue;
    }
    groups.push({ y: entry.y, items: [entry.item] });
  }

  return groups
    .map(group => group.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export async function extractPdfText(file) {
  const pdfjs = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pages = [];
  try {
    if (pdf.numPages > MAX_DED_PAGES) throw new Error(`O PDF possui páginas demais para uma lista do DED+ (máximo de ${MAX_DED_PAGES}).`);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableCombineTextItems: false });
      pages.push(groupTextItems(content.items));
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  return pages.join('\n');
}

export async function parseDedPdf(file) {
  if (!(file instanceof File) && !(file && typeof file.arrayBuffer === 'function')) {
    throw new Error('Arquivo PDF inválido.');
  }
  if (Number(file.size) > MAX_DED_FILE_BYTES) throw new Error('O PDF excede o limite de 10 MB.');
  const text = await extractPdfText(file);
  if (!text || !text.trim()) throw new Error('O PDF não contém texto legível. Exporte a lista nominal do DED+ em formato PDF com texto.');
  return parseDedText(text, file.name || 'lista do DED.pdf');
}

export async function parseDedPdfFiles(files, onProgress = null) {
  const results = [];
  const errors = [];
  const list = [...files];
  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    try {
      const data = await parseDedPdf(file);
      results.push(data);
    } catch (error) {
      errors.push({ name: file.name || `PDF ${index + 1}`, message: error?.message || 'Não foi possível interpretar o PDF.' });
    }
    if (typeof onProgress === 'function') onProgress(index + 1, list.length, file.name || 'PDF');
  }
  return { results, errors };
}
