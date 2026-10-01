const STUDENT_ROW_RE = /^\s*(\d{1,4})\s+(\d{5,})\s*(.+?)\s*$/;

const PT_PARTICLES = new Set(['a', 'à', 'ao', 'aos', 'as', 'às', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no', 'nos', 'por', 'para']);
const COMMON_ABBREVIATIONS = new Set(['BR', 'EE', 'EF', 'EJA', 'EM', 'EEM', 'IF', 'IFMG', 'CEFET', 'SENAI', 'CEMIG', 'UFMG', 'MG', 'R', 'ROD', 'AV', 'RUA', 'TV', 'TRAV', 'PCA', 'PC', 'SRE', 'UBA']);

function clean(value) {
  return String(value ?? '')
    .replace(/[\u0000\u200B\u200C\u200D\u2060\uFEFF]/g, '')
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function titleSegment(segment, { preserveAcronym = true } = {}) {
  const raw = clean(segment);
  if (!raw) return '';
  const lower = raw.toLocaleLowerCase('pt-BR');
  if (preserveAcronym && /^[A-Za-zÀ-ÿ]{2,4}$/.test(raw) && raw === raw.toUpperCase() && !PT_PARTICLES.has(lower)) {
    return raw.toUpperCase();
  }
  return lower.replace(/(^|[-'’])([\p{L}\p{N}])/gu, (_, sep, char) => `${sep}${char.toLocaleUpperCase('pt-BR')}`);
}

function formatHumanName(value) {
  const raw = clean(value);
  if (!raw) return '';
  const words = raw.split(' ');
  return words.map((word, index) => {
    const parts = word.split(/([-’'])/);
    return parts.map((part, partIndex) => {
      if (/^[-’']$/.test(part)) return part;
      const lower = part.toLocaleLowerCase('pt-BR');
      if (index > 0 && partIndex === 0 && PT_PARTICLES.has(lower)) return lower;
      return titleSegment(part, { preserveAcronym: false });
    }).join('');
  }).join(' ');
}

function formatOrganizationName(value) {
  const raw = clean(value);
  if (!raw) return '';
  return raw.split(' ').map((word, index) => {
    const lower = word.toLocaleLowerCase('pt-BR');
    if (index > 0 && PT_PARTICLES.has(lower)) return lower;
    const compact = word.replace(/\./g, '').toUpperCase();
    if (COMMON_ABBREVIATIONS.has(compact)) return word.toUpperCase();
    return titleSegment(word, { preserveAcronym: false });
  }).join(' ');
}

function formatSubject(value) {
  return formatHumanName(value);
}

function formatShift(value) {
  return formatHumanName(value);
}

function formatAddress(value) {
  const raw = clean(value);
  if (!raw) return '';
  return raw.split(',').map(part => {
    const text = clean(part);
    if (!text) return '';
    if (/^\d+[A-Za-z]?$/.test(text)) return text;
    return formatOrganizationName(text);
  }).filter(Boolean).join(', ');
}

function normalizeLabelSpacing(value) {
  return clean(value).replace(/\s*:\s*/g, ': ');
}

function parseSchoolLine(line, result) {
  const school = line.match(/^(\d+)\s*-\s*(.+?)\s*-\s*SRE\s+(.+)$/i);
  if (!school) return false;
  result.schoolCode = school[1];
  result.schoolName = formatOrganizationName(school[2]);
  result.sre = clean(school[3]).toLocaleUpperCase('pt-BR');
  return true;
}

function formatDedClassNameText(value) {
  return clean(value)
    .replace(/(\d+[º°])(?=[A-Za-zÀ-ÿ])/g, '$1 ')
    .replace(/\b(EM|EF|EJA)(?=[A-ZÀ-Ý])/g, '$1 ')
    .replace(/\b(REG)(?=\d)/g, '$1 ')
    .replace(/\s*\-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseClassLine(line, result) {
  const turma = line.match(/^Turma\s*:\s*(\d+)\s*-\s*(.+?)\s*(?=Turno\s*:)(?:Turno\s*:\s*)(.+?)\s*(?=Professor\s*:)(?:Professor\s*:\s*)(.+)$/i);
  if (!turma) return false;

  result.classCode = turma[1];
  result.className = formatDedClassNameText(turma[2]);
  result.shift = formatShift(turma[3]);
  result.teacher = formatHumanName(turma[4]);

  const year = result.className.match(/\((\d{4})\)\s*$/);
  if (year) result.year = year[1];
  return true;
}

function findStudentHeader(lines) {
  return lines.findIndex(line => {
    const normalized = normalizeKey(line).replace(/\s+/g, '');
    return normalized.includes('CODIGO') && normalized.includes('NOME');
  });
}

function parseStudentRows(lines, startIndex, students) {
  const firstLine = startIndex >= 0 ? startIndex + 1 : 0;

  for (const line of lines.slice(firstLine)) {
    if (/^P(?:á|a)g\.?\s*\d+\s*de\s*\d+/i.test(line)) continue;
    if (/^RELAC(?:ÃO|AO)\s+NOMINAL/i.test(line)) continue;
    if (/^(?:\d+\s+)?C(?:ó|O)DIGO\s*NOME/i.test(line)) continue;

    const match = line.match(STUDENT_ROW_RE);
    if (!match) continue;
    const name = formatHumanName(match[3]);
    if (!name || /^(?:campo\s+livre|nome)$/i.test(name)) continue;
    students.push({ order: Number(match[1]), dedCode: match[2], name });
  }
}

function deduplicateStudents(students) {
  const byCode = new Map();
  for (const student of students) {
    const code = String(student.dedCode);
    if (!byCode.has(code)) byCode.set(code, student);
  }
  return [...byCode.values()].sort((a, b) => a.order - b.order);
}

function parseHeader(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(normalizeLabelSpacing).filter(Boolean);
  const result = {
    schoolCode: '', schoolName: '', sre: '', classCode: '', className: '', year: '',
    shift: '', teacher: '', address: '', component: '', students: [],
  };

  for (const line of lines) {
    if (!result.schoolCode && parseSchoolLine(line, result)) continue;
    if (!result.classCode && parseClassLine(line, result)) continue;

    const address = line.match(/^Endere[cç]o\s*:\s*(.+)$/i);
    if (address && !result.address) {
      result.address = formatAddress(address[1]);
      continue;
    }

    const component = line.match(/^Componente\s*:\s*(.+)$/i);
    if (component && !result.component) {
      result.component = formatSubject(component[1]);
    }
  }

  parseStudentRows(lines, findStudentHeader(lines), result.students);
  result.students = deduplicateStudents(result.students);

  if (!result.classCode || !result.className) throw new Error('Não foi possível identificar a turma neste PDF do DED+.');
  if (!result.schoolCode || !result.schoolName) throw new Error('Não foi possível identificar a escola neste PDF do DED+.');
  if (!result.students.length) throw new Error('Nenhum aluno foi encontrado na lista do DED+.');

  result.dedKey = [result.schoolCode, result.classCode, result.year]
    .map(normalizeKey)
    .join('|');
  result.displayName = clean(result.className);
  return result;
}

export function parseDedText(text, sourceName = '') {
  const parsed = parseHeader(text);
  parsed.sourceName = clean(sourceName);
  return parsed;
}

export function normalizeDedStudentName(name) {
  return normalizeKey(name);
}

export function normalizeDedClassKey(value) {
  return normalizeKey(value);
}

export function formatDedPersonName(name) {
  return formatHumanName(name);
}

export function formatDedOrganizationName(name) {
  return formatOrganizationName(name);
}

export function formatDedSubjectName(subject) {
  return formatSubject(subject);
}

export function formatDedShift(shift) {
  return formatShift(shift);
}

export function formatDedAddress(address) {
  return formatAddress(address);
}

export function formatDedClassName(name) {
  return formatDedClassNameText(name);
}

export function normalizeExistingDedData(data) {
  if (!data || typeof data !== 'object') return { data, changed:false };
  let changed=false; const next={...data, teacher:data.teacher&&typeof data.teacher==='object'?{ name: formatHumanName(data.teacher.name) || data.teacher.name || '' }:{ name:'' }};
  if (data.teacher?.name !== next.teacher.name || Object.keys(data.teacher||{}).some(k=>!['name'].includes(k))) changed=true;
  next.classes=Array.isArray(data.classes)?data.classes.map(cls=>{if(!cls?.ded)return cls;const ded={...cls.ded,schoolName:formatOrganizationName(cls.ded.schoolName),sre:clean(cls.ded.sre).toLocaleUpperCase('pt-BR'),shift:formatShift(cls.ded.shift),teacher:formatHumanName(cls.ded.teacher),address:formatAddress(cls.ded.address),component:formatSubject(cls.ded.component)};const nc={...cls,ded};if(ded.className){const n=formatDedClassNameText(ded.className);if(nc.name!==n){nc.name=n;changed=true;}}if(JSON.stringify(ded)!==JSON.stringify(cls.ded))changed=true;return nc;}):[];
  next.students=Array.isArray(data.students)?data.students.map(student=>{if(!student?.ded)return student;const name=formatHumanName(student.name);if(name!==student.name){changed=true;return {...student,name};}return student;}):[];
  return {data:next,changed};
}

export function sameDedClassIdentity(a, b) {
  if (!a || !b) return false;
  const schoolA = normalizeKey(a.schoolCode ?? a.ded?.schoolCode);
  const schoolB = normalizeKey(b.schoolCode ?? b.ded?.schoolCode);
  const classA = normalizeKey(a.classCode ?? a.ded?.classCode);
  const classB = normalizeKey(b.classCode ?? b.ded?.classCode);
  const yearA = normalizeKey(a.year ?? a.ded?.year);
  const yearB = normalizeKey(b.year ?? b.ded?.year);
  return !!schoolA && !!classA && schoolA === schoolB && classA === classB && yearA === yearB;
}
