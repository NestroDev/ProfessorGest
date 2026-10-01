function defaultTodayISO() {
  const date = new Date();
  const pad = value => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function schoolById(state, id) {
  return Array.isArray(state?.schools)
    ? state.schools.find(school => school.id === id)
    : undefined;
}

export function classById(state, id) {
  return Array.isArray(state?.classes)
    ? state.classes.find(classroom => classroom.id === id)
    : undefined;
}

export function assignmentById(state, id) {
  return Array.isArray(state?.assignments)
    ? state.assignments.find(assignment => assignment.id === id)
    : undefined;
}

export function assignmentsOf(state, classId) {
  return Array.isArray(state?.assignments)
    ? state.assignments.filter(assignment => assignment.classId === classId)
    : [];
}

export function studentsOf(state, classId) {
  if (!Array.isArray(state?.students)) return [];

  const enrollments = Array.isArray(state?.enrollments)
    ? state.enrollments.filter(
        enrollment =>
          enrollment.classId === classId && enrollment.active !== false,
      )
    : [];

  if (enrollments.length) {
    const ids = new Set(enrollments.map(enrollment => enrollment.studentId));
    return state.students.filter(student => ids.has(student.id));
  }

  return state.students.filter(student => student.classId === classId);
}

export function enrollmentsOf(state, studentId) {
  return Array.isArray(state?.enrollments)
    ? state.enrollments.filter(
        enrollment =>
          enrollment.studentId === studentId && enrollment.active !== false,
      )
    : [];
}

export function classIdsOfStudent(state, studentId) {
  const ids = new Set(
    enrollmentsOf(state, studentId).map(enrollment => enrollment.classId),
  );
  const student = studentById(state, studentId);

  if (student?.classId) ids.add(student.classId);
  return [...ids];
}

export function occurrencesOf(state, studentId) {
  return Array.isArray(state?.occurrences)
    ? state.occurrences.filter(occurrence => occurrence.studentId === studentId)
    : [];
}

export function activitiesOf(state, classId, assignmentId = '') {
  return Array.isArray(state?.activities)
    ? state.activities.filter(
        activity =>
          activity.classId === classId &&
          (!assignmentId || activity.assignmentId === assignmentId),
      )
    : [];
}

export function plansOf(state, classId, assignmentId = '') {
  return Array.isArray(state?.plans)
    ? state.plans.filter(
        plan =>
          plan.classId === classId &&
          (!assignmentId || plan.assignmentId === assignmentId),
      )
    : [];
}

export function activeClasses(state) {
  return Array.isArray(state?.classes)
    ? state.classes.filter(classroom => !classroom.archived)
    : [];
}

export function activeStudents(state) {
  const classIds = new Set(activeClasses(state).map(classroom => classroom.id));

  if (!Array.isArray(state?.students)) return [];

  return state.students.filter(student => {
    const studentClassIds = classIdsOfStudent(state, student.id);
    return (
      !studentClassIds.length ||
      studentClassIds.some(classId => classIds.has(classId))
    );
  });
}

export function activeActivities(state) {
  const classIds = new Set(activeClasses(state).map(classroom => classroom.id));
  if (!Array.isArray(state?.activities)) return [];

  const seen = new Set();
  return state.activities.filter(activity =>
    (!activity.classId || classIds.has(activity.classId)) &&
    !seen.has(activity.id) &&
    seen.add(activity.id),
  );
}

export function studentById(state, id) {
  return Array.isArray(state?.students)
    ? state.students.find(student => student.id === id)
    : undefined;
}

export function studentStats(state, student, _todayISO = defaultTodayISO) {
  const classes = classIdsOfStudent(state, student?.id);
  const activities = classes.flatMap(classId => activitiesOf(state, classId));
  const occurrences = occurrencesOf(state, student?.id);
  const observationCount = Array.isArray(student?.observations)
    ? student.observations.length
    : 0;

  return {
    activityCount: activities.length,
    occurrenceCount: occurrences.length,
    observationCount,
    totalFollowUps: occurrences.length + observationCount,
  };
}

export function classStats(
  state,
  classroom,
  todayISO = defaultTodayISO,
  assignmentId = '',
) {
  const alunos = studentsOf(state, classroom?.id);
  const acts = activitiesOf(state, classroom?.id, assignmentId);
  const studentIds = new Set(alunos.map(student => student.id));

  const occCount = (state?.occurrences || []).filter(
    occurrence =>
      studentIds.has(occurrence.studentId) &&
      (!assignmentId || occurrence.assignmentId === assignmentId),
  ).length;

  const upcoming =
    [...acts]
      .filter(activity => activity.dueDate >= todayISO())
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null;

  return { alunos, acts, upcoming, occCount };
}

export function activityStats(state, activity) {
  const alunos = studentsOf(state, activity?.classId);
  const studentIds = new Set(alunos.map(student => student.id));

  return {
    alunos,
    occCount: (state?.occurrences || []).filter(
      occurrence =>
        studentIds.has(occurrence.studentId) &&
        (!activity?.assignmentId ||
          occurrence.assignmentId === activity.assignmentId),
    ).length,
  };
}

export function activityStatus(
  _state,
  activity,
  todayISO = defaultTodayISO,
) {
  return activity?.dueDate < todayISO() ? 'atrasada' : 'proxima';
}
