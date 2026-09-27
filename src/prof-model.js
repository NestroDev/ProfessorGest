export const PROF_FORMAT = 'professorgest';
export const CURRENT_VERSION = 3;
export const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
export const MAX_PROF_BYTES = 15 * 1024 * 1024;
export const MAX_CLASSES = 500;
export const MAX_STUDENTS = 10000;
export const MAX_ACTIVITIES = 10000;
export const MAX_OCCURRENCES = 50000;
export const MAX_OBSERVATIONS_PER_STUDENT = 500;
export const MAX_PLANS = 10000;
export const MAX_TEXT_LENGTH = 20000;
export const PROF_MIME = 'application/vnd.professorgest';

const OCCURRENCE_TYPES = new Set([
  'nao_atividade',
  'nao_entregou',
  'conversou',
  'faltou',
  'participou',
  'bom_comportamento',
  'observacao',
]);


export function createProjectId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (_) {}
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value);
}

export function normalizeProfText(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/^\u200B+/, '')
    .replace(/^\u2060+/, '')
    .trim();
}

function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function isValidTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function textField(value, max = MAX_TEXT_LENGTH) {
  if (value == null) return '';
  return String(value).slice(0, max);
}

function uniqueIds(items) {
  const seen = new Set();
  for (const item of items || []) {
    const id = String(item?.id ?? '');
    if (!isSafeId(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function validateCompletions(completions) {
  if (completions == null) return {};
  if (typeof completions !== 'object' || Array.isArray(completions)) return null;
  const out = {};
  for (const [sid, value] of Object.entries(completions)) {
    if (!isSafeId(sid)) return null;
    if (value !== 'delivered' && value !== 'not_delivered' && value !== 'pending') return null;
    out[sid] = value;
  }
  return out;
}
export function validateProjectData(input) {
  const data = input;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'invalid' };
  if (data.format !== PROF_FORMAT) return { ok: false, error: 'format' };
  if (Number(data.version) !== CURRENT_VERSION) return { ok: false, error: 'version' };
  if (!isSafeId(String(data.projectId || ''))) return { ok: false, error: 'projectId' };

  if (!Array.isArray(data.classes) || !Array.isArray(data.students) || !Array.isArray(data.activities) || !Array.isArray(data.occurrences)) {
    return { ok: false, error: 'shape' };
  }

  const warnings = [];
  const details = [];

  if (data.classes.length > MAX_CLASSES || data.students.length > MAX_STUDENTS || data.activities.length > MAX_ACTIVITIES || data.occurrences.length > MAX_OCCURRENCES || (Array.isArray(data.plans) && data.plans.length > MAX_PLANS)) {
    return { ok: false, error: 'limits' };
  }

  if (!uniqueIds(data.classes) || !uniqueIds(data.students) || !uniqueIds(data.activities) || !uniqueIds(data.occurrences) || (Array.isArray(data.plans) && !uniqueIds(data.plans))) {
    return { ok: false, error: 'integrity' };
  }

  const classIds = new Set(data.classes.map(c => String(c.id)));
  const studentIds = new Set(data.students.map(s => String(s.id)));
  const invalidRequiredDates = [];

  const safeClasses = data.classes.map(c => ({
    id: String(c.id),
    name: textField(c.name, 500),
    archived: !!c.archived,
  }));

  const safeStudents = data.students.map(s => {
    const classId = s.classId == null || s.classId === '' ? null : String(s.classId);
    if (classId && !classIds.has(classId)) warnings.push(`aluno ${s.name || s.id}: turma inexistente`);

    const rawObservations = Array.isArray(s.observations) ? s.observations : [];
    if (rawObservations.length > MAX_OBSERVATIONS_PER_STUDENT) {
      warnings.push(`aluno ${s.name || s.id}: observações excedentes ignoradas`);
    }

    const observations = [];
    const observationIds = new Set();
    rawObservations.slice(0, MAX_OBSERVATIONS_PER_STUDENT).forEach(o => {
      const observationId = String(o?.id ?? '');
      const observationDate = String(o?.date ?? '');
      if (!isSafeId(observationId) || !isValidISODate(observationDate)) {
        warnings.push(`aluno ${s.name || s.id}: observação inválida ignorada`);
        details.push(`Observação inválida do aluno ${s.name || s.id || 'sem nome'}`);
        return;
      }
      if (observationIds.has(observationId)) {
        warnings.push(`aluno ${s.name || s.id}: ID de observação duplicado ignorado`);
        details.push(`ID de observação duplicado no aluno ${s.name || s.id || 'sem nome'}`);
        return;
      }
      observationIds.add(observationId);
      observations.push({ id: observationId, date: observationDate, text: textField(o.text) });
    });

    return {
      id: String(s.id),
      name: textField(s.name, 500),
      classId: classId && classIds.has(classId) ? classId : null,
      notes: textField(s.notes),
      observations,
    };
  });

  const safeActivities = data.activities.map(a => {
    const classId = a.classId == null || a.classId === '' ? null : String(a.classId);
    if (classId && !classIds.has(classId)) warnings.push(`atividade ${a.name || a.id}: turma inexistente`);
    if (!isValidISODate(a.dueDate)) invalidRequiredDates.push(`Atividade: ${a.name || a.id}`);

    const completions = validateCompletions(a.completions);
    if (completions === null) {
      invalidRequiredDates.push(`Atividade: ${a.name || a.id} possui completions inválidos`);
    }
    const safeCompletions = {};
    Object.keys(completions || {}).forEach(sid => {
      if (!studentIds.has(sid)) {
        warnings.push(`atividade ${a.name || a.id}: completion para aluno inexistente`);
        return;
      }
      safeCompletions[sid] = completions[sid];
    });

    return {
      id: String(a.id),
      name: textField(a.name, 500),
      classId: classId && classIds.has(classId) ? classId : null,
      dueDate: String(a.dueDate || ''),
      description: textField(a.description),
      completions: safeCompletions,
    };
  });

  const safeOccurrences = data.occurrences.map(o => {
    const id = String(o?.id ?? '');
    const studentId = String(o?.studentId ?? '');
    if (!studentIds.has(studentId)) warnings.push(`ocorrência ${id}: aluno inexistente`);
    if (!isValidISODate(o?.date)) invalidRequiredDates.push(`Ocorrência: ${id}`);
    const type = OCCURRENCE_TYPES.has(o?.type) ? o.type : 'observacao';
    if (type !== o?.type) warnings.push(`ocorrência ${id}: tipo inválido substituído por observacao`);
    return {
      id,
      studentId,
      date: String(o?.date || ''),
      type,
      description: textField(o?.description),
    };
  }).filter(o => studentIds.has(o.studentId));

  const rawPlans = Array.isArray(data.plans) ? data.plans : [];
  const safePlans = rawPlans.slice(0, MAX_PLANS).map(plan => {
    const id = String(plan?.id ?? '');
    const classId = plan?.classId == null || plan.classId === '' ? null : String(plan.classId);
    if (!isSafeId(id)) {
      warnings.push(`planejamento ${plan?.title || id}: ID inválido`);
    }
    if (classId && !classIds.has(classId)) warnings.push(`planejamento ${plan?.title || id}: turma inexistente`);
    if (!isValidISODate(plan?.date)) invalidRequiredDates.push(`Planejamento: ${plan?.title || id}`);
    return {
      id,
      classId: classId && classIds.has(classId) ? classId : null,
      date: String(plan?.date || ''),
      title: textField(plan?.title, 500),
      content: textField(plan?.content),
      objectives: textField(plan?.objectives),
      methodology: textField(plan?.methodology),
      resources: textField(plan?.resources),
      assessment: textField(plan?.assessment),
    };
  }).filter(plan => isSafeId(plan.id));

  if (invalidRequiredDates.length) {
    details.push(...invalidRequiredDates.slice(0, 8).map(item => item.includes('possui completions inválidos') ? item : `${item} possui data inválida`));
    return { ok: false, error: 'integrity', details, warnings };
  }

  const createdAt = data.createdAt == null ? null : String(data.createdAt);
  const updatedAt = data.updatedAt == null ? null : String(data.updatedAt);

  // Datas de auditoria inválidas não devem ser silenciosamente convertidas em "agora".
  // Elas não impedem a abertura do projeto, mas o usuário será avisado.
  if (createdAt && !(isValidTimestamp(createdAt) || isValidISODate(createdAt))) {
    warnings.push('createdAt inválido: será substituído por um timestamp técnico de auditoria');
  }
  if (updatedAt && !(isValidTimestamp(updatedAt) || isValidISODate(updatedAt))) {
    warnings.push('updatedAt inválido: será substituído por um timestamp técnico de auditoria');
  }

  const auditTimestamp = new Date().toISOString();
  const safe = {
    format: PROF_FORMAT,
    version: CURRENT_VERSION,
    projectId: String(data.projectId),
    createdAt: createdAt && (isValidTimestamp(createdAt) || isValidISODate(createdAt)) ? createdAt : auditTimestamp,
    updatedAt: updatedAt && (isValidTimestamp(updatedAt) || isValidISODate(updatedAt)) ? updatedAt : auditTimestamp,
    teacher: (data.teacher && typeof data.teacher === 'object' && !Array.isArray(data.teacher))
      ? {
          name: textField(data.teacher.name, 300) || 'Professor',
          school: textField(data.teacher.school, 500),
          subject: textField(data.teacher.subject, 300),
        }
      : { name: 'Professor', school: '', subject: '' },
    classes: safeClasses,
    students: safeStudents,
    activities: safeActivities,
    occurrences: safeOccurrences,
    plans: safePlans,
  };

  return { ok: true, data: safe, warnings, details };
}

export function validateAndParseProf(text) {
  const rawText = String(text ?? '');
  if (typeof TextEncoder !== 'undefined' && new TextEncoder().encode(rawText).length > MAX_PROF_BYTES) {
    return { ok: false, error: 'size' };
  }

  let normalized = normalizeProfText(rawText);
  if (normalized.startsWith('```')) normalized = normalized.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let data;
  try {
    data = JSON.parse(normalized);
    if (typeof data === 'string') {
      const nested = normalizeProfText(data);
      if (!nested.startsWith('{')) return { ok: false, error: 'json' };
      data = JSON.parse(nested);
    }
  } catch (_) {
    return { ok: false, error: 'json' };
  }

  return validateProjectData(data);
}
