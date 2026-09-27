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

export function getDeliveryState(activity, studentId) {
  return activity?.completions?.[studentId] || 'pending';
}

export function studentStats(state, student, todayISO = defaultTodayISO) {
  const acts = activitiesOf(state, student?.classId);
  const today = todayISO();
  let delivered = 0;
  let notDelivered = 0;
  let pendingOverdue = 0;
  let pendingFuture = 0;
  acts.forEach(a => {
    const status = getDeliveryState(a, student?.id);
    const overdue = a.dueDate < today;
    if (status === 'delivered') delivered++;
    else if (status === 'not_delivered') notDelivered++;
    else if (overdue) pendingOverdue++;
    else pendingFuture++;
  });
  const occCount = occurrencesOf(state, student?.id).length;
  return {
    totalActs: acts.length,
    delivered,
    notDelivered,
    pendingOverdue,
    pendingFuture,
    pend: notDelivered + pendingOverdue,
    occCount,
  };
}

export function classStats(state, classroom, todayISO = defaultTodayISO) {
  const alunos = studentsOf(state, classroom?.id);
  const acts = activitiesOf(state, classroom?.id);
  const today = todayISO();
  let delivered = 0;
  let possible = 0;
  let pend = 0;
  acts.forEach(a => alunos.forEach(student => {
    possible++;
    const status = getDeliveryState(a, student.id);
    if (status === 'delivered') delivered++;
    else if (status === 'not_delivered' || a.dueDate < today) pend++;
  }));
  const pct = possible ? Math.round((delivered / possible) * 100) : 0;
  const upcoming = [...acts].filter(a => a.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const studentIds = new Set(alunos.map(s => s.id));
  const occCount = (state?.occurrences || []).filter(o => studentIds.has(o.studentId)).length;
  return { alunos, acts, pct, pend, upcoming, occCount, delivered, possible };
}

export function activityStats(state, activity) {
  const alunos = studentsOf(state, activity?.classId);
  const delivered = alunos.filter(s => getDeliveryState(activity, s.id) === 'delivered').length;
  const notDelivered = alunos.filter(s => getDeliveryState(activity, s.id) === 'not_delivered').length;
  const pending = alunos.length - delivered - notDelivered;
  const pct = alunos.length ? Math.round((delivered / alunos.length) * 100) : 0;
  return { alunos, delivered, notDelivered, pending, pct };
}

export function activityStatus(state, activity, todayISO = defaultTodayISO) {
  const stats = activityStats(state, activity);
  if (stats.delivered + stats.notDelivered >= stats.alunos.length && stats.alunos.length > 0) return 'concluida';
  if (activity?.dueDate < todayISO()) return 'atrasada';
  return 'proxima';
}
