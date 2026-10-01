/**
 * DED+ aplicado a um PROJETO (lógica pura, sem DOM e sem estado global).
 *
 * - Importar: adiciona turmas/disciplinas sem substituir as existentes.
 * - Atualizar projeto com DED+: vários PDFs numa operação; cada PDF atualiza a
 *   turma existente (mesma identidade), cria a turma quando é nova, preserva o
 *   histórico, e NUNCA apaga alunos ausentes do PDF.
 *
 * `previewDedProjectUpdate` aplica tudo numa CÓPIA e devolve o estado resultante,
 * então a prévia mostrada ao usuário é exatamente o que será salvo.
 */
import { normalizeDedStudentName, normalizeDedClassKey, sameDedClassIdentity } from './ded-parser.js';
import { studentsOf } from './project-selectors.js';
import { MAX_CLASSES, MAX_STUDENTS, MAX_ASSIGNMENTS } from './prof-model.js';

let counter = 0;
export function defaultUid(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export const dedClassIdentityKey = data => [data?.schoolCode, data?.classCode, data?.year].map(normalizeDedClassKey).join('|');
export const dedAssignmentIdentityKey = (data, classId = '') => [classId || dedClassIdentityKey(data), data?.component].map(normalizeDedClassKey).join('|');

function schoolNameOf(state, classId) {
  const cls = state.classes.find(c => c.id === classId);
  const school = cls?.schoolId ? state.schools.find(s => s.id === cls.schoolId) : null;
  return school?.name || cls?.ded?.schoolName || '';
}

export function findClassForDed(state, data) {
  const byIdentity = state.classes.find(c => (c?.ded?.key && data?.dedKey && c.ded.key === data.dedKey) || sameDedClassIdentity(c, data));
  if (byIdentity) return byIdentity;
  const className = normalizeDedStudentName(data.displayName || data.className);
  const schoolName = normalizeDedStudentName(data.schoolName);
  return state.classes.find(c => normalizeDedStudentName(c.name) === className && normalizeDedStudentName(schoolNameOf(state, c.id)) === schoolName) || null;
}

function ensureSchool(state, data, uid) {
  const key = normalizeDedClassKey(data.schoolCode || data.schoolName);
  let school = state.schools.find(s => normalizeDedClassKey(s.code || s.name) === key || normalizeDedClassKey(s.name) === normalizeDedClassKey(data.schoolName));
  if (!school) {
    school = { id: uid('school'), name: data.schoolName || 'Escola não informada', code: data.schoolCode || '', sre: data.sre || '', address: data.address || '' };
    state.schools.push(school);
  } else {
    school.name = data.schoolName || school.name;
    school.code = data.schoolCode || school.code || '';
    school.sre = data.sre || school.sre || '';
    school.address = data.address || school.address || '';
  }
  return school;
}

function ensureClass(state, data, now, uid) {
  const school = ensureSchool(state, data, uid);
  let cls = findClassForDed(state, data);
  const isNew = !cls;
  if (!cls) {
    cls = { id: uid('class'), name: data.displayName || data.className, archived: false, schoolId: school.id, classCode: data.classCode || '', year: data.year || '', shift: data.shift || '', ded: {} };
    state.classes.push(cls);
  }
  cls.schoolId = school.id;
  cls.classCode = data.classCode || cls.classCode || '';
  cls.year = data.year || cls.year || '';
  cls.shift = data.shift || cls.shift || '';
  // Preserva o nome que o professor possa ter dado à turma; só define em turma nova.
  cls.name = isNew ? (data.displayName || data.className || cls.name) : (cls.name || data.displayName || data.className);
  cls.archived = false;
  cls.ded = { ...(cls.ded || {}), className: cls.name, schoolCode: data.schoolCode, schoolName: data.schoolName, sre: data.sre, classCode: data.classCode, year: data.year, shift: data.shift, teacher: data.teacher, address: data.address, component: data.component, key: data.dedKey, importedAt: now, sourceName: data.sourceName };
  return { cls, isNew };
}

function ensureAssignment(state, data, cls, now, uid) {
  const key = dedAssignmentIdentityKey(data, cls.id);
  let assignment = state.assignments.find(a => (a?.ded?.key && a.ded.key === key) || (a.classId === cls.id && normalizeDedClassKey(a.subject) === normalizeDedClassKey(data.component)));
  const isNew = !assignment;
  if (!assignment) {
    assignment = { id: uid('assign'), classId: cls.id, schoolId: cls.schoolId || null, subject: data.component || 'Componente não informado', teacherName: data.teacher || state.teacher?.name || '', year: data.year || cls.year || '', ded: {} };
    state.assignments.push(assignment);
  }
  assignment.classId = cls.id;
  assignment.schoolId = cls.schoolId || assignment.schoolId || null;
  assignment.subject = data.component || assignment.subject || 'Componente não informado';
  assignment.teacherName = data.teacher || assignment.teacherName || state.teacher?.name || '';
  assignment.year = data.year || cls.year || assignment.year || '';
  assignment.ded = { ...(assignment.ded || {}), ...cls.ded, key, component: assignment.subject, importedAt: now, sourceName: data.sourceName };
  return { assignment, isNew };
}

function ensureEnrollment(state, student, classId, imported, uid) {
  student.enrollmentIds = Array.isArray(student.enrollmentIds) ? student.enrollmentIds : [];
  let enrollment = state.enrollments.find(e => e.studentId === student.id && e.classId === classId && e.active !== false);
  if (!enrollment) {
    enrollment = { id: uid('enroll'), studentId: student.id, classId, active: true, dedCode: imported?.dedCode || '', sourceName: imported?.sourceName || '' };
    state.enrollments.push(enrollment);
  } else if (imported) {
    enrollment.dedCode = imported.dedCode || enrollment.dedCode || '';
    enrollment.sourceName = imported.sourceName || enrollment.sourceName || '';
  }
  if (!student.enrollmentIds.includes(enrollment.id)) student.enrollmentIds.push(enrollment.id);
  student.classId = classId;
  return enrollment;
}

/** Remove PDFs repetidos (mesma turma + disciplina). */
export function dedupeDedItems(items) {
  const unique = []; const duplicates = []; const seen = new Set();
  for (const item of items || []) {
    const key = `${item.dedKey}|${normalizeDedClassKey(item.component)}`;
    if (seen.has(key)) { duplicates.push(item.sourceName); continue; }
    seen.add(key); unique.push(item);
  }
  return { unique, duplicates };
}

function ensureCollections(state) {
  for (const k of ['schools', 'classes', 'assignments', 'enrollments', 'students']) state[k] = Array.isArray(state[k]) ? state[k] : [];
}

/** Aplica UM item (PDF) ao estado (mutando-o). Retorna o relatório da turma. */
export function applyDedItem(state, data, { now = new Date().toISOString(), uid = defaultUid } = {}) {
  ensureCollections(state);
  const { cls, isNew: classIsNew } = ensureClass(state, data, now, uid);
  const { isNew: assignmentIsNew } = ensureAssignment(state, data, cls, now, uid);
  const current = studentsOf(state, cls.id);
  const byCode = new Map(current.filter(s => s?.ded?.studentCode).map(s => [String(s.ded.studentCode), s]));
  const byName = new Map(current.map(s => [normalizeDedStudentName(s.name), s]));
  const report = {
    classId: cls.id, className: cls.name, component: data.component || '', sourceName: data.sourceName || '',
    classAdded: classIsNew, assignmentAdded: assignmentIsNew,
    newStudents: [], renamed: [], matched: 0, missing: [],
  };
  const importedCodes = new Set();
  for (const imported of data.students || []) {
    importedCodes.add(String(imported.dedCode));
    let student = byCode.get(String(imported.dedCode)) || null;
    if (!student) {
      const candidate = byName.get(normalizeDedStudentName(imported.name));
      if (candidate && (!candidate.ded?.studentCode || String(candidate.ded.studentCode) === String(imported.dedCode))) student = candidate;
    }
    if (student) {
      report.matched += 1;
      if (student.name !== imported.name) { report.renamed.push({ from: student.name, to: imported.name, studentId: student.id }); student.name = imported.name; }
      student.ded = { ...(student.ded || {}), studentCode: imported.dedCode, sourceName: data.sourceName };
    } else {
      student = { id: uid('stu'), name: imported.name, classId: cls.id, notes: '', observations: [], ded: { studentCode: imported.dedCode, sourceName: data.sourceName }, enrollmentIds: [] };
      state.students.push(student);
      report.newStudents.push(imported.name);
    }
    ensureEnrollment(state, student, cls.id, { dedCode: imported.dedCode, sourceName: data.sourceName }, uid);
    byCode.set(String(imported.dedCode), student);
    byName.set(normalizeDedStudentName(imported.name), student);
  }
  // Ausentes do PDF são PRESERVADOS (apenas reportados).
  for (const s of current) {
    if (s?.ded?.studentCode && !importedCodes.has(String(s.ded.studentCode))) report.missing.push(s.name);
  }
  return report;
}

export function deriveDedTeacherProfile(items) {
  const values = key => [...new Map(items.map(item => [normalizeDedClassKey(item?.[key]), String(item?.[key] || '').trim()]).filter(([k, v]) => k && v)).values()];
  const names = values('teacher');
  return { teacher: { name: names.length === 1 ? names[0] : '' }, schools: values('schoolName'), subjects: values('component'), conflicts: { teacher: names.length > 1 } };
}

export function emptySummary() {
  return { classesUpdated: 0, classesAdded: 0, assignmentsAdded: 0, newStudents: 0, renamedStudents: 0, preservedMissing: 0, matchedStudents: 0 };
}

/**
 * Prévia/execução: aplica todos os itens em uma cópia profunda do estado.
 * Retorna { ok, state, summary, reports, duplicates, message }.
 * Em caso de limite excedido, `ok=false` e o estado original NÃO é tocado.
 */
export function previewDedProjectUpdate(state, items, { now, uid } = {}) {
  const { unique, duplicates } = dedupeDedItems(items);
  const draft = structuredClone(state);
  const summary = emptySummary();
  const reports = [];
  const profile = deriveDedTeacherProfile(unique);
  if (!String(draft.teacher?.name || '').trim() || draft.teacher?.name === 'Professor') {
    if (profile.teacher.name) draft.teacher = { ...(draft.teacher || {}), name: profile.teacher.name };
  }
  for (const data of unique) {
    const report = applyDedItem(draft, data, { now, uid });
    reports.push(report);
    if (report.classAdded) summary.classesAdded += 1; else summary.classesUpdated += 1;
    if (report.assignmentAdded) summary.assignmentsAdded += 1;
    summary.newStudents += report.newStudents.length;
    summary.renamedStudents += report.renamed.length;
    summary.preservedMissing += report.missing.length;
    summary.matchedStudents += report.matched;
  }
  const limits = [];
  if (draft.classes.length > MAX_CLASSES) limits.push(`O limite de ${MAX_CLASSES} turmas seria ultrapassado (${draft.classes.length}).`);
  if (draft.students.length > MAX_STUDENTS) limits.push(`O limite de ${MAX_STUDENTS} alunos seria ultrapassado (${draft.students.length}).`);
  if (draft.assignments.length > MAX_ASSIGNMENTS) limits.push(`O limite de ${MAX_ASSIGNMENTS} atuações seria ultrapassado (${draft.assignments.length}).`);
  if (limits.length) return { ok: false, message: limits.join(' '), summary, reports, duplicates, state };
  const changed = summary.classesAdded || summary.assignmentsAdded || summary.newStudents || summary.renamedStudents || summary.classesUpdated;
  return { ok: true, changed: !!changed, state: draft, summary, reports, duplicates, profile };
}

export function describeDedSummary(summary) {
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  return [
    n(summary.classesUpdated, 'turma atualizada', 'turmas atualizadas'),
    n(summary.classesAdded, 'turma adicionada', 'turmas adicionadas'),
    n(summary.newStudents, 'aluno novo', 'alunos novos'),
    n(summary.renamedStudents, 'nome alterado', 'nomes alterados'),
    n(summary.preservedMissing, 'aluno ausente preservado', 'alunos ausentes preservados'),
  ];
}
