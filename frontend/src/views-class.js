export function createClassViewRenderers(deps) {
  const {
    getState, getCtx, classById, classStats, studentsOf, occurrencesOf, studentById,
    initials, activityListItemHTML, esc, fmtDate, todayISO, emptyState, badgeFor, ICONS
  } = deps;

  function renderClassStudentsTab(c) {
    const alunos = studentsOf(c.id);
    const bulk = getCtx().bulkMode;
    return `<div class="row-between compact-section-head"><div><strong>${alunos.length}</strong> aluno(s) acompanhado(s)</div><div class="inline-actions"><button type="button" class="btn-ghost btn-sm" id="btnToggleBulk">${bulk ? 'Cancelar seleção' : 'Selecionar vários'}</button><button type="button" class="btn-primary btn-sm" id="btnAddStudentHere">${ICONS.plus} Aluno</button></div></div>
      ${bulk ? `<div class="bulk-bar student-bulk-bar"><div><strong>${getCtx().bulkSelected.size} selecionado(s)</strong></div><div class="bulk-bar-actions"><button type="button" class="btn-secondary btn-sm" id="btnBulkSelectAll">Selecionar todos</button><button type="button" class="btn-secondary btn-sm" id="btnBulkOccurrence">${ICONS.bell} Registrar ocorrência</button><button type="button" class="btn-secondary btn-sm" id="btnBulkMoveStudents">${ICONS.move} Mudar de turma</button><button type="button" class="btn-danger-solid btn-sm" id="btnBulkDelete">${ICONS.trash} Excluir</button><button type="button" class="btn-ghost btn-sm" id="btnBulkClear">Limpar</button></div></div>` : ''}
      <div class="card list-card">${alunos.map(s => `<div class="list-item">${bulk ? `<label class="list-item-check"><input type="checkbox" data-bulk-student="${esc(s.id)}" ${getCtx().bulkSelected.has(s.id) ? 'checked' : ''} aria-label="Selecionar ${esc(s.name)}"></label>` : ''}<div class="list-item-main" data-open-student="${esc(s.id)}" role="button" tabindex="0"><div class="avatar sm">${initials(s.name)}</div><div><div class="list-item-title">${esc(s.name)}</div><div class="list-item-sub">${occurrencesOf(s.id).length} registro(s) de acompanhamento</div></div></div>${bulk ? '' : `<div class="list-item-actions"><button type="button" class="btn-icon" data-edit-student="${esc(s.id)}" aria-label="Editar aluno">${ICONS.edit}</button><button type="button" class="btn-icon danger" data-del-student="${esc(s.id)}" aria-label="Excluir aluno">${ICONS.trash}</button></div>`}</div>`).join('') || emptyState('Nenhum aluno acompanhado nesta turma ainda.', 'Adicione alunos quando precisar acompanhar alguém.')}</div>`;
  }

  function renderTurmaDetail() {
    const ctx = getCtx();
    const state = getState();
    const c = classById(ctx.classId);
    if (!c) return emptyState('Turma não encontrada.');
    const st = classStats(c);
    const tab = ctx.classTab || 'visao';
    const tabs = [{ key:'visao',label:'Visão geral' },{ key:'alunos',label:'Alunos' },{ key:'atividades',label:'Atividades' },{ key:'ocorrencias',label:'Registros' },{ key:'relatorios',label:'Relatórios' }];
    let body = '';
    if (tab === 'visao') {
      const upcomingActs = st.acts.filter(a => a.dueDate >= todayISO()).sort((a,b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
      const ids = new Set(st.alunos.map(s => s.id));
      const recentOcc = state.occurrences.filter(o => ids.has(o.studentId)).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 5);
      body = `<div class="dashboard-stats class-detail-stats"><div class="card dashboard-stat"><div class="stat-icon">${ICONS.user}</div><div><strong>${st.alunos.length}</strong><span>Alunos acompanhados</span></div></div><div class="card dashboard-stat"><div class="stat-icon">${ICONS.clipboard}</div><div><strong>${st.acts.length}</strong><span>Atividades agendadas</span></div></div><div class="card dashboard-stat"><div class="stat-icon">${ICONS.bell}</div><div><strong>${st.occCount}</strong><span>Registros</span></div></div></div><div class="dashboard-grid"><section><div class="section-heading"><div><h2>Próximas atividades</h2><p>Agenda desta turma.</p></div></div><div class="card list-card">${upcomingActs.map(a => activityListItemHTML(a)).join('') || emptyState('Nenhuma atividade futura.')}</div></section><section><div class="section-heading"><div><h2>Registros recentes</h2><p>Últimos acompanhamentos.</p></div></div><div class="card list-card">${recentOcc.map(o => { const s = studentById(o.studentId); return `<div class="list-item"><div class="list-item-main" data-open-student="${esc(o.studentId)}" role="button" tabindex="0"><div class="list-item-title">${esc(s ? s.name : 'Aluno removido')}</div><div class="list-item-sub">${fmtDate(o.date)} · ${badgeFor(o.type)}</div></div></div>`; }).join('') || emptyState('Nenhum registro ainda.')}</div></section></div>`;
    } else if (tab === 'alunos') body = renderClassStudentsTab(c);
    else if (tab === 'atividades') body = `<div class="row-between compact-section-head"><div></div><button type="button" class="btn-primary btn-sm" id="btnNewActivityHere">${ICONS.plus} Nova atividade</button></div><div class="card list-card">${st.acts.map(activityListItemHTML).join('') || emptyState('Nenhuma atividade nesta turma.')}</div>`;
    else if (tab === 'ocorrencias') {
      const ids = new Set(st.alunos.map(s => s.id));
      const occ = state.occurrences.filter(o => ids.has(o.studentId)).sort((a,b) => b.date.localeCompare(a.date));
      body = `<div class="card list-card">${occ.map(o => { const s = studentById(o.studentId); return `<div class="list-item"><div class="list-item-main" data-open-student="${esc(o.studentId)}" role="button" tabindex="0"><div class="list-item-title">${esc(s ? s.name : 'Aluno removido')}</div><div class="list-item-sub">${fmtDate(o.date)} · ${badgeFor(o.type)}${o.description ? ` · ${esc(o.description)}` : ''}</div></div></div>`; }).join('') || emptyState('Nenhum registro para esta turma.')}</div>`;
    } else body = `<div class="card narrow-card"><p class="muted">Gere um relatório com os alunos acompanhados, atividades, ocorrências e observações da turma.</p><button type="button" class="btn-primary btn-block" id="btnGoClassReport">${ICONS.report} Gerar relatório da turma</button></div>`;
    return `<button type="button" class="btn-ghost btn-sm page-back" id="btnBack">${ICONS.back} Voltar</button><section class="card detail-hero-card class-detail-hero"><div class="row-between"><div><div class="list-item-title detail-title">${esc(c.name)} ${c.archived ? '<span class="badge badge-gray">Arquivada</span>' : ''}</div><div class="list-item-sub">${st.alunos.length} aluno(s) acompanhado(s)</div></div><div class="inline-actions"><button type="button" class="btn-primary btn-sm" id="btnRegisterForClass">${ICONS.plus} Registrar</button><button type="button" class="btn-secondary btn-sm" id="btnEditThisClass">${ICONS.edit} Editar</button></div></div></section><div class="tabs responsive-tabs">${tabs.map(t => `<button type="button" class="tab ${tab === t.key ? 'active' : ''}" data-class-tab="${esc(t.key)}">${t.label}</button>`).join('')}</div>${body}`;
  }

  return { renderTurmaDetail, renderClassStudentsTab };
}
