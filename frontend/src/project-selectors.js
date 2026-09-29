function defaultTodayISO() {
  const d = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function studentsOf(state, classId) {
  return Array.isArray(state?.students) ? state.students.filter(s => s.classId === classId) : [];
}

export function occurrencesOf(state, studentId) {
  return Array.isArray(state?.occurrences) ? state.occurrences.filter(o => o.studentId === studentId) : [];
}

export function activitiesOf(state, classId) {
  return Array.isArray(state?.activities) ? state.activities.filter(a => a.classId === classId) : [];
}

export function classById(state, id) {
  return Array.isArray(state?.classes) ? state.classes.find(c => c.id === id) : undefined;
}

export function studentById(state, id) {
  return Array.isArray(state?.students) ? state.students.find(s => s.id === id) : undefined;
}

export function activeClasses(state) {
  return Array.isArray(state?.classes) ? state.classes.filter(c => !c.archived) : [];
}

export function activeStudents(state) {
  const activeClassIds = new Set(activeClasses(state).map(c => c.id));
  return Array.isArray(state?.students) ? state.students.filter(s => !s.classId || activeClassIds.has(s.classId)) : [];
}

export function activeActivities(state) {
  const activeClassIds = new Set(activeClasses(state).map(c => c.id));
  return Array.isArray(state?.activities) ? state.activities.filter(a => !a.classId || activeClassIds.has(a.classId)) : [];
}

export function studentStats(state, student) {
  const activities = activitiesOf(state, student?.classId);
  const occurrences = occurrencesOf(state, student?.id);
  const observations = Array.isArray(student?.observations) ? student.observations.length : 0;
  return {
    activityCount: activities.length,
    occurrenceCount: occurrences.length,
    observationCount: observations,
    totalFollowUps: occurrences.length + observations,
  };
}

export function classStats(state, classroom) {
  const alunos = studentsOf(state, classroom?.id);
  const acts = activitiesOf(state, classroom?.id);
  const studentIds = new Set(alunos.map(s => s.id));
  const occCount = (state?.occurrences || []).filter(o => studentIds.has(o.studentId)).length;
  const upcoming = [...acts].filter(a => a.dueDate >= defaultTodayISO()).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null;
  return { alunos, acts, upcoming, occCount };
}

export function activityStats(state, activity) {
  const alunos = studentsOf(state, activity?.classId);
  const studentIds = new Set(alunos.map(s => s.id));
  const occCount = (state?.occurrences || []).filter(o => studentIds.has(o.studentId)).length;
  return { alunos, occCount };
}

export function activityStatus(_state, activity, todayISO = defaultTodayISO) {
  return activity?.dueDate < todayISO() ? 'atrasada' : 'proxima';
}
