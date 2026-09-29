export function createCalendarOccurrenceRenderers(deps) {
  const {
    getState, getCtx, esc, classNameOf, studentById, studentsOf, initials,
    activityStatus, todayISO, fmtDate, monthLabel, weekdayShort, pad2,
    emptyState, badgeFor, ICONS, occurrenceTypes
  } = deps;

  function activitiesInMonth(ym) {
    return getState().activities.filter(a => a.dueDate.slice(0, 7) === ym && (!getCtx().calClassFilter || a.classId === getCtx().calClassFilter));
  }

  function renderCalendario() {
    const [y, m] = getCtx().calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const today = todayISO();
    const acts = activitiesInMonth(getCtx().calMonth);
    const plans = (getState().plans || []).filter(plan => plan.date.slice(0, 7) === getCtx().calMonth && (!getCtx().calClassFilter || plan.classId === getCtx().calClassFilter));
    const byDay = {};
    const plansByDay = {};
    acts.forEach(a => { (byDay[a.dueDate] = byDay[a.dueDate] || []).push(a); });
    plans.forEach(plan => { (plansByDay[plan.date] = plansByDay[plan.date] || []).push(plan); });

    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push({ outside: true });
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${pad2(m)}-${pad2(d)}`;
      cells.push({ day: d, iso, acts: byDay[iso] || [], plans: plansByDay[iso] || [] });
    }
    while (cells.length % 7 !== 0) cells.push({ outside: true });

    const selDay = getCtx().calSelectedDay;
    const selActs = selDay ? (byDay[selDay] || []) : [];
    const selPlans = selDay ? (plansByDay[selDay] || []) : [];

    return `
      <div class="page-head"><div><h1>Calendário</h1><div class="page-sub">Atividades e planejamentos por mês</div></div>
        <div class="page-actions"><select class="form-select" id="calClassFilterSelect"><option value="">Todas as turmas</option>
          ${getState().classes.map(c => `<option value="${esc(c.id)}" ${getCtx().calClassFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="card">
        <div class="calendar-head">
          <button type="button" class="btn-icon" id="btnCalPrev" aria-label="Mês anterior">${ICONS.chevL}</button>
          <div class="cal-title">${monthLabel(getCtx().calMonth)}</div>
          <button type="button" class="btn-icon" id="btnCalNext" aria-label="Próximo mês">${ICONS.chevR}</button>
        </div>
        <div class="calendar-grid">
          ${[0,1,2,3,4,5,6].map(i => `<div class="calendar-dow">${weekdayShort(i)}</div>`).join('')}
          ${cells.map(c => {
            if (c.outside) return `<div class="calendar-day outside"></div>`;
            const hasOverdue = c.acts.some(a => c.iso < today && activityStatus(a) !== 'concluida');
            return `<button type="button" class="calendar-day ${c.iso === today ? 'today' : ''} ${c.iso === selDay ? 'selected' : ''}" data-cal-day="${esc(c.iso)}" aria-label="${fmtDate(c.iso)}" aria-pressed="${c.iso === selDay}">
              <div class="calendar-daynum">${c.day}</div>
              <div class="calendar-dot-row">${c.acts.slice(0, 3).map(() => `<span class="calendar-dot ${hasOverdue ? 'over' : ''}"></span>`).join('')}${c.plans.slice(0, 2).map(() => `<span class="calendar-dot plan"></span>`).join('')}</div>
            </button>`;
          }).join('')}
        </div>
      </div>
      ${selDay ? `<div class="section-title">Planejamento em ${fmtDate(selDay)}</div>
        <div class="card list-card">${selPlans.map(plan => `<div class="list-item"><div class="list-item-fill"><div class="list-item-title">${esc(plan.title)}</div><div class="list-item-sub">${esc(classNameOf(plan.classId))}</div></div><button type="button" class="btn-secondary btn-sm" data-edit-plan="${esc(plan.id)}">${ICONS.edit} Editar</button></div>`).join('') || emptyState('Nenhum planejamento neste dia.')}</div>
        <div class="section-title">Atividades em ${fmtDate(selDay)}</div>
        <div class="card list-card">${selActs.map(a => `<div class="list-item"><div class="list-item-main" data-open-activity="${esc(a.id)}" role="button" tabindex="0">
          <div class="list-item-title">${esc(a.name)}</div><div class="list-item-sub">${esc(classNameOf(a.classId))}</div></div></div>`).join('') || emptyState('Nenhuma atividade neste dia.')}</div>` : ''}
    `;
  }

  function renderOcorrenciasLog() {
    let list = [...getState().occurrences];
    if (getCtx().occClassFilter) { const ids = new Set(studentsOf(getCtx().occClassFilter).map(s => s.id)); list = list.filter(o => ids.has(o.studentId)); }
    if (getCtx().occTypeFilter) list = list.filter(o => o.type === getCtx().occTypeFilter);
    if (getCtx().occMonth) list = list.filter(o => o.date.slice(0, 7) === getCtx().occMonth);
    list.sort((a, b) => b.date.localeCompare(a.date));

    return `
      <div class="page-head"><div><h1>Ocorrências</h1><div class="page-sub">${list.length} registro(s)</div></div>
        <div class="page-actions"><button type="button" class="btn-primary" id="btnQuickRegisterOcc">${ICONS.plus} Registrar</button></div>
      </div>
      <div class="filter-bar">
        <select class="form-select" id="occClassFilterSelect"><option value="">Todas as turmas</option>
          ${getState().classes.map(c => `<option value="${esc(c.id)}" ${getCtx().occClassFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <select class="form-select" id="occTypeFilterSelect"><option value="">Todos os tipos</option>
          ${occurrenceTypes.map(t => `<option value="${esc(t.key)}" ${getCtx().occTypeFilter === t.key ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
      </div>
      <div class="card list-card">${list.map(o => { const s = studentById(o.studentId); return `<div class="list-item">
        <div class="list-item-main" data-open-student="${esc(o.studentId)}">
          <div class="avatar sm">${s ? initials(s.name) : '—'}</div>
          <div><div class="list-item-title">${esc(s ? s.name : 'Aluno removido')}</div>
          <div class="list-item-sub">${fmtDate(o.date)} · ${esc(classNameOf(s ? s.classId : null))} · ${badgeFor(o.type)} ${o.description ? '· ' + esc(o.description) : ''}</div></div>
        </div>
        <div class="list-item-actions"><button type="button" class="btn-icon" data-edit-occ="${esc(o.id)}" aria-label="Editar">${ICONS.edit}</button>
        <button type="button" class="btn-icon danger" data-del-occ="${esc(o.id)}" aria-label="Excluir">${ICONS.trash}</button></div></div>`; }).join('') || emptyState('Nenhuma ocorrência encontrada para este filtro.')}</div>
    `;
  }

  return { renderCalendario, renderOcorrenciasLog, activitiesInMonth };
}
