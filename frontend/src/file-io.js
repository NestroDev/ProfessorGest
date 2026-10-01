import { PRG_MIME } from './prof-model.js';

export function normalizePrgFileName(name) {
  let value = String(name || '').trim();
  if (!value) return 'ProfessorGest.prg';
  value = value.replace(/\\/g, '/').split('/').pop() || 'ProfessorGest.prg';
  value = value.replace(/(?:\.json)+$/i, '');
  value = value.replace(/(?:\.prg)+$/i, '.prg');
  if (!/\.prg$/i.test(value)) value += '.prg';
  return value;
}

export function isAndroidDevice(navigatorLike = globalThis.navigator) {
  return /Android/i.test(navigatorLike?.userAgent || '');
}

export function supportsNativeFilePicker(windowLike = globalThis.window, navigatorLike = globalThis.navigator) {
  // Android browsers can expose showOpenFilePicker but still route provider
  // backed documents through a FileSystemFileHandle implementation with
  // inconsistent read support. The normal <input type=file> path is more
  // reliable for .prg files on mobile. Keep the native picker on desktop.
  if (isAndroidDevice(navigatorLike)) return false;
  return typeof windowLike?.showOpenFilePicker === 'function';
}

export function supportsNativeSavePicker(windowLike = globalThis.window, navigatorLike = globalThis.navigator) {
  return !isAndroidDevice(navigatorLike) && typeof windowLike?.showSaveFilePicker === 'function';
}

export async function readTextFileUtf8(file) {
  let buffer;
  try {
    if (typeof file?.arrayBuffer === 'function') buffer = await file.arrayBuffer();
  } catch (_) {}
  if (!buffer && typeof file?.text === 'function') {
    return String(await file.text());
  }
  if (!buffer) {
    buffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Não foi possível ler o arquivo.'));
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(file);
    });
  }
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export function prgOpenPickerTypes() {
  return [{
    description: 'ProfessorGest (.prg)',
    accept: {
      [PRG_MIME]: ['.prg'],
      'application/json': ['.prg'],
      'application/octet-stream': ['.prg'],
      'text/plain': ['.prg']
    }
  }];
}

export function prgSavePickerTypes() {
  return [{
    description: 'ProfessorGest (.prg)',
    accept: { [PRG_MIME]: ['.prg'] }
  }];
}

export function supportsFileShare(navigatorLike = globalThis.navigator, FileCtor = globalThis.File) {
  return !!(navigatorLike?.share && typeof FileCtor !== 'undefined');
}

export async function shareFile(content, filename, mime = PRG_MIME, navigatorLike = globalThis.navigator, FileCtor = globalThis.File) {
  if (!supportsFileShare(navigatorLike, FileCtor)) return false;
  try {
    const file = new FileCtor([content], normalizePrgFileName(filename), { type: mime });
    if (navigatorLike.canShare && !navigatorLike.canShare({ files: [file] })) return false;
    await navigatorLike.share({ files: [file], title: file.name });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return true;
    throw err;
  }
}

export function downloadTextFile(content, filename, mime, { documentLike = globalThis.document, windowLike = globalThis.window, navigatorLike = globalThis.navigator } = {}) {
  const rawContent = String(content ?? '');
  const lowerName = String(filename || '').toLowerCase();
  const isPrg = lowerName.endsWith('.prg');
  const safeName = isPrg ? normalizePrgFileName(filename) : String(filename || 'download.txt');
  const safeMime = mime || (isPrg ? PRG_MIME : 'text/plain;charset=utf-8');
  const androidPrg = isPrg && isAndroidDevice(navigatorLike);
  let objectUrl = null;
  try {
    const bytes = new TextEncoder().encode(rawContent);
    let href;
    let effectiveMime = safeMime;
    if (androidPrg && bytes.length <= 2 * 1024 * 1024) {
      href = `data:attachment/plain;charset=utf-8,${encodeURIComponent(rawContent)}`;
      effectiveMime = 'attachment/plain;charset=utf-8';
    } else {
      const blob = new Blob([bytes], { type: effectiveMime });
      objectUrl = windowLike.URL.createObjectURL(blob);
      href = objectUrl;
    }
    const a = documentLike.createElement('a');
    a.href = href;
    a.download = safeName;
    a.type = effectiveMime;
    a.rel = 'noopener';
    a.style.display = 'none';
    documentLike.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      if (objectUrl) windowLike.URL.revokeObjectURL(objectUrl);
    }, 15000);
    return true;
  } catch (err) {
    if (objectUrl) {
      try { windowLike.URL.revokeObjectURL(objectUrl); } catch (_) {}
    }
    throw err;
  }
}
