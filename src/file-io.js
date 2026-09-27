import { PROF_MIME } from './prof-model.js';

export function normalizeProfFileName(name) {
  let value = String(name || '').trim();
  if (!value) return 'ProfessorGest.prof';
  value = value.replace(/\\/g, '/').split('/').pop() || 'ProfessorGest.prof';
  value = value.replace(/(?:\.json)+$/i, '');
  value = value.replace(/(?:\.prof)+$/i, '.prof');
  if (!/\.prof$/i.test(value)) value += '.prof';
  return value;
}

export function isAndroidDevice(navigatorLike = globalThis.navigator) {
  return /Android/i.test(navigatorLike?.userAgent || '');
}

export function supportsNativeFilePicker(windowLike = globalThis.window) {
  return typeof windowLike?.showOpenFilePicker === 'function';
}

export function supportsNativeSavePicker(windowLike = globalThis.window, navigatorLike = globalThis.navigator) {
  return !isAndroidDevice(navigatorLike) && typeof windowLike?.showSaveFilePicker === 'function';
}

export async function readTextFileUtf8(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export function profOpenPickerTypes() {
  return [{
    description: 'ProfessorGest (.prof)',
    accept: {
      [PROF_MIME]: ['.prof', '.prof.json'],
      'application/json': ['.prof', '.prof.json', '.json'],
      'application/octet-stream': ['.prof', '.prof.json'],
      'text/plain': ['.prof', '.prof.json', '.json']
    }
  }];
}

export function profSavePickerTypes() {
  return [{
    description: 'ProfessorGest (.prof)',
    accept: { [PROF_MIME]: ['.prof'] }
  }];
}

export function supportsFileShare(navigatorLike = globalThis.navigator, FileCtor = globalThis.File) {
  return !!(navigatorLike?.share && navigatorLike?.canShare && typeof FileCtor !== 'undefined');
}

export async function shareFile(content, filename, mime = PROF_MIME, navigatorLike = globalThis.navigator, FileCtor = globalThis.File) {
  if (!supportsFileShare(navigatorLike, FileCtor)) return false;
  try {
    const file = new FileCtor([content], normalizeProfFileName(filename), { type: mime });
    if (!navigatorLike.canShare({ files: [file] })) return false;
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
  const isProf = lowerName.endsWith('.prof') || lowerName.endsWith('.prof.json');
  const safeName = isProf ? normalizeProfFileName(filename) : String(filename || 'download.txt');
  const safeMime = mime || (isProf ? PROF_MIME : 'text/plain;charset=utf-8');
  const androidProf = isProf && isAndroidDevice(navigatorLike);
  let objectUrl = null;
  try {
    const bytes = new TextEncoder().encode(rawContent);
    let href;
    let effectiveMime = safeMime;
    if (androidProf && bytes.length <= 2 * 1024 * 1024) {
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
