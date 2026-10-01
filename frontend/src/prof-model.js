export const PRG_FORMAT = 'professorgest-prg';
export const PRG_VERSION = 1;
export const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
export const MAX_PRG_BYTES = 15 * 1024 * 1024;
export const MAX_CLASSES = 500;
export const MAX_STUDENTS = 10000;
export const MAX_ACTIVITIES = 10000;
export const MAX_OCCURRENCES = 50000;
export const MAX_OBSERVATIONS_PER_STUDENT = 500;
export const MAX_PLANS = 10000;
export const MAX_SCHOOLS = 200;
export const MAX_ASSIGNMENTS = 2000;
export const MAX_ENROLLMENTS = 20000;
export const MAX_TEXT_LENGTH = 20000;
export const PRG_MIME = 'application/vnd.professorgest.prg';

const OCCURRENCE_TYPES = new Set([
  'nao_atividade',
  'conversou',
  'faltou',
  'participou',
  'bom_comportamento',
  'observacao',
]);

const PROJECT_COLLECTIONS = [
  'classes',
  'students',
  'activities',
  'occurrences',
  'plans',
  'schools',
  'assignments',
  'enrollments',
];

export function createProjectId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) {
    // Fall back to the deterministic timestamp/random implementation below.
  }

  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value);
}

export function normalizePrgText(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/^\u200B+/, '')
    .replace(/^\u2060+/, '')
    .trim();
}

function textField(value, max = MAX_TEXT_LENGTH) {
  return value == null ? '' : String(value).slice(0, max);
}

function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function isValidTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
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

function hasValidCollections(data) {
  return PROJECT_COLLECTIONS.every(collection => Array.isArray(data[collection]));
}

function hasCollectionLimits(data) {
  return (
    data.classes.length <= MAX_CLASSES &&
    data.students.length <= MAX_STUDENTS &&
    data.activities.length <= MAX_ACTIVITIES &&
    data.occurrences.length <= MAX_OCCURRENCES &&
    data.plans.length <= MAX_PLANS &&
    data.schools.length <= MAX_SCHOOLS &&
    data.assignments.length <= MAX_ASSIGNMENTS &&
    data.enrollments.length <= MAX_ENROLLMENTS
  );
}

function hasUniqueCollectionIds(data) {
  return PROJECT_COLLECTIONS.map(collection => data[collection]).every(uniqueIds);
}

export function validateProjectData(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'invalid' };
  }

  if (input.format !== PRG_FORMAT) return { ok: false, error: 'format' };
  if (Number(input.version) !== PRG_VERSION) return { ok: false, error: 'version' };

  const data = input;
  if (!isSafeId(String(data.projectId || ''))) {
    return { ok: false, error: 'projectId' };
  }

  if (!hasValidCollections(data)) return { ok: false, error: 'shape' };
  if (!hasCollectionLimits(data)) return { ok: false, error: 'limits' };
  if (!hasUniqueCollectionIds(data)) return { ok: false, error: 'integrity' };

  const warnings = [];
  const details = [];
  const classIds = new Set(data.classes.map(classroom => String(classroom.id)));
  const studentIds = new Set(data.students.map(student => String(student.id)));
  const schoolIds = new Set(data.schools.map(school => String(school.id)));
  const assignmentIds = new Set(data.assignments.map(assignment => String(assignment.id)));

  const safeSchools = data.schools.map(school => ({
    id: String(school.id),
    name: textField(school.name, 500),
    code: textField(school.code, 100),
    sre: textField(school.sre, 300),
    address: textField(school.address, 1000),
  }));

  const safeClasses = data.classes.map(classroom => {
    const rawDed =
      classroom?.ded && typeof classroom.ded === 'object' && !Array.isArray(classroom.ded)
        ? classroom.ded
        : null;

    const ded = rawDed
      ? {
          className: textField(rawDed.className, 500),
          schoolCode: textField(rawDed.schoolCode, 100),
          schoolName: textField(rawDed.schoolName, 500),
          sre: textField(rawDed.sre, 300),
          classCode: textField(rawDed.classCode, 100),
          year: textField(rawDed.year, 10),
          shift: textField(rawDed.shift, 100),
          teacher: textField(rawDed.teacher, 500),
          address: textField(rawDed.address, 1000),
          component: textField(rawDed.component, 500),
          key: textField(rawDed.key, 1000),
          importedAt: isValidTimestamp(rawDed.importedAt) ? rawDed.importedAt : null,
          sourceName: textField(rawDed.sourceName, 500),
        }
      : null;

    const schoolId =
      classroom.schoolId == null || classroom.schoolId === ''
        ? null
        : String(classroom.schoolId);

    if (schoolId && !schoolIds.has(schoolId)) {
      warnings.push(`turma ${classroom.name || classroom.id}: escola inexistente`);
    }

    return {
      id: String(classroom.id),
      name: textField(classroom.name, 500),
      archived: !!classroom.archived,
      schoolId: schoolId && schoolIds.has(schoolId) ? schoolId : null,
      classCode: textField(classroom.classCode || ded?.classCode, 100),
      year: textField(classroom.year || ded?.year, 10),
      shift: textField(classroom.shift || ded?.shift, 100),
      ...(ded ? { ded } : {}),
    };
  });

  const safeAssignments = data.assignments.map(assignment => {
    const classId =
      assignment.classId == null ? '' : String(assignment.classId);
    const schoolId =
      assignment.schoolId == null || assignment.schoolId === ''
        ? null
        : String(assignment.schoolId);

    if (!classIds.has(classId)) {
      warnings.push(
        `atuação ${assignment.subject || assignment.id}: turma inexistente`,
      );
    }
    if (schoolId && !schoolIds.has(schoolId)) {
      warnings.push(
        `atuação ${assignment.subject || assignment.id}: escola inexistente`,
      );
    }

    return {
      id: String(assignment.id),
      classId: classIds.has(classId) ? classId : null,
      schoolId: schoolId && schoolIds.has(schoolId) ? schoolId : null,
      subject: textField(assignment.subject || assignment.component, 500),
      teacherName: textField(assignment.teacherName || assignment.teacher, 300),
      year: textField(assignment.year, 10),
      ded:
        assignment.ded && typeof assignment.ded === 'object'
          ? assignment.ded
          : null,
    };
  });

  const safeEnrollments = data.enrollments
    .map(enrollment => {
      const studentId = String(enrollment.studentId || '');
      const classId = String(enrollment.classId || '');

      if (!studentIds.has(studentId) || !classIds.has(classId)) {
        warnings.push(`matrícula ${enrollment.id}: referência inválida`);
      }

      return {
        id: String(enrollment.id),
        studentId,
        classId,
        active: enrollment.active !== false,
        since: textField(enrollment.since, 20),
        until: textField(enrollment.until, 20),
        dedCode: textField(enrollment.dedCode, 100),
        sourceName: textField(enrollment.sourceName, 500),
      };
    })
    .filter(enrollment =>
      studentIds.has(enrollment.studentId) && classIds.has(enrollment.classId),
    );

  const safeStudents = data.students.map(student => {
    const classId =
      student.classId == null || student.classId === ''
        ? null
        : String(student.classId);

    const observations = Array.isArray(student.observations)
      ? student.observations
          .slice(0, MAX_OBSERVATIONS_PER_STUDENT)
          .filter(
            observation =>
              isSafeId(String(observation?.id ?? '')) &&
              isValidISODate(String(observation?.date ?? '')),
          )
          .map(observation => ({
            id: String(observation.id),
            date: String(observation.date),
            text: textField(observation.text),
          }))
      : [];

    return {
      id: String(student.id),
      name: textField(student.name, 500),
      classId: classId && classIds.has(classId) ? classId : null,
      enrollmentIds: Array.isArray(student.enrollmentIds)
        ? student.enrollmentIds
            .map(String)
            .filter(id => safeEnrollments.some(enrollment => enrollment.id === id))
        : [],
      notes: textField(student.notes),
      observations,
      ...(student.ded && typeof student.ded === 'object'
        ? {
            ded: {
              studentCode: textField(student.ded.studentCode, 100),
              sourceName: textField(student.ded.sourceName, 500),
            },
          }
        : {}),
    };
  });

  const safeActivities = data.activities.map(activity => {
    const classId =
      activity.classId == null || activity.classId === ''
        ? null
        : String(activity.classId);
    const assignmentId =
      activity.assignmentId == null || activity.assignmentId === ''
        ? null
        : String(activity.assignmentId);

    if (classId && !classIds.has(classId)) {
      warnings.push(`atividade ${activity.name || activity.id}: turma inexistente`);
    }
    if (assignmentId && !assignmentIds.has(assignmentId)) {
      warnings.push(
        `atividade ${activity.name || activity.id}: atuação inexistente`,
      );
    }
    if (!isValidISODate(activity.dueDate)) {
      details.push(`Atividade: ${activity.name || activity.id} possui data inválida`);
    }

    return {
      id: String(activity.id),
      name: textField(activity.name, 500),
      classId: classId && classIds.has(classId) ? classId : null,
      assignmentId:
        assignmentId && assignmentIds.has(assignmentId) ? assignmentId : null,
      dueDate: String(activity.dueDate || ''),
      description: textField(activity.description),
    };
  });

  const safeOccurrences = data.occurrences
    .map(occurrence => {
      const studentId = String(occurrence?.studentId || '');
      const classId =
        occurrence?.classId == null ? null : String(occurrence.classId);
      const assignmentId =
        occurrence?.assignmentId == null
          ? null
          : String(occurrence.assignmentId);

      if (!studentIds.has(studentId)) return null;
      if (!isValidISODate(occurrence?.date)) {
        details.push(`Ocorrência: ${occurrence?.id || ''} possui data inválida`);
      }

      return {
        id: String(occurrence.id),
        studentId,
        classId: classId && classIds.has(classId) ? classId : null,
        assignmentId:
          assignmentId && assignmentIds.has(assignmentId) ? assignmentId : null,
        date: String(occurrence.date || ''),
        type: OCCURRENCE_TYPES.has(occurrence?.type)
          ? occurrence.type
          : 'observacao',
        description: textField(occurrence?.description),
      };
    })
    .filter(Boolean);

  const safePlans = data.plans.map(plan => {
    const classId =
      plan?.classId == null || plan.classId === ''
        ? null
        : String(plan.classId);
    const assignmentId =
      plan?.assignmentId == null || plan.assignmentId === ''
        ? null
        : String(plan.assignmentId);

    if (!isValidISODate(plan?.date)) {
      details.push(
        `Planejamento: ${plan?.title || plan?.id || ''} possui data inválida`,
      );
    }

    return {
      id: String(plan.id),
      classId: classId && classIds.has(classId) ? classId : null,
      assignmentId:
        assignmentId && assignmentIds.has(assignmentId) ? assignmentId : null,
      date: String(plan.date || ''),
      title: textField(plan.title, 500),
      content: textField(plan.content),
      objectives: textField(plan.objectives),
      methodology: textField(plan.methodology),
      resources: textField(plan.resources),
      assessment: textField(plan.assessment),
    };
  });

  if (details.length) {
    return {
      ok: false,
      error: 'integrity',
      details: details.slice(0, 20),
      warnings,
    };
  }

  const now = new Date().toISOString();
  const createdAt =
    data.createdAt &&
    (isValidTimestamp(data.createdAt) || isValidISODate(data.createdAt))
      ? data.createdAt
      : now;
  const updatedAt =
    data.updatedAt &&
    (isValidTimestamp(data.updatedAt) || isValidISODate(data.updatedAt))
      ? data.updatedAt
      : now;

  const safe = {
    format: PRG_FORMAT,
    version: PRG_VERSION,
    projectId: String(data.projectId),
    createdAt,
    updatedAt,
    teacher: {
      name: textField(data.teacher?.name, 300) || 'Professor',
    },
    schools: safeSchools,
    classes: safeClasses,
    assignments: safeAssignments,
    enrollments: safeEnrollments,
    students: safeStudents,
    activities: safeActivities,
    occurrences: safeOccurrences,
    plans: safePlans,
  };

  return {
    ok: true,
    data: safe,
    warnings,
    details: [],
    changed: false,
  };
}

export function validateAndParsePrg(text) {
  const rawText = String(text ?? '');
  if (
    typeof TextEncoder !== 'undefined' &&
    new TextEncoder().encode(rawText).length > MAX_PRG_BYTES
  ) {
    return { ok: false, error: 'size' };
  }

  let normalized = normalizePrgText(rawText);
  if (normalized.startsWith('```')) {
    normalized = normalized
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  let data;
  try {
    data = JSON.parse(normalized);
    if (typeof data === 'string') {
      data = JSON.parse(normalizePrgText(data));
    }
  } catch (_) {
    return { ok: false, error: 'json' };
  }

  return validateProjectData(data);
}
