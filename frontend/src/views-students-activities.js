export function createStudentActivityRenderers(deps) {
  const {
    getState, getCtx, esc, initials, classNameOf, studentStats, activityStats, activityStatus,
    occurrencesOf, activitiesOf, assignmentNameOf = () => '', emptyState, fmtDate, monthLabel, badgeFor, ICONS, searchFieldHTML
  } = deps;

  function filteredSortedStudents() {
    const ctx = getCtx();
    const term = (ctx.studentSearch || '').trim().toLowerCase();
    let list = getState().students.filter(s => !term || s.name.toLowerCase().includes(term));
    if (ctx.studentClassFilter) list = list.filter(s => s.classId === ctx.studentClassFilter);
    if (ctx.studentSort === 'turma') list = [...list].sort((a, b) => classNameOf(a.classId).localeCompare(classNameOf(b.classId)) || a.name.localeCompare(b.name));
    else if (ctx.studentSort === 'registros') list = [...list].sort((a, b) => studentStats(b).totalFollowUps - studentStats(a).totalFollowUps || a.name.localeCompare(b.name));
    else list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  function studentMeta(student) {
    const stats = studentStats(student);
    const lastOccurrence = [...occurrencesOf(student.id)].sort((a, b) => b.date.localeCompare(a.date))[0];
    return `${classNameOf(student.classId)} · ${stats.totalFollowUps} acompanhamento(s)${lastOccurrence ? ` · último ${fmtDate(lastOccurrence.date)}` : ''}`;
  }

  function studentListItemsHTML(list) {
    return list.map(s => `<div class="list-item">
      <div class="list-item-main" data-open-student="${esc(s.id)}" role="button" tabindex="0">
        <div class="avatar sm">${initials(s.name)}</div>
        <div><div class="list-item-title">${esc(s.name)}</div><div class="list-item-sub">${esc(studentMeta(s))}</div></div>
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn-icon" data-quick-occ-student="${esc(s.id)}" aria-label="Registrar ocorrência">${ICONS.plus}</button>
        <button type="button" class="btn-icon" data-edit-student="${esc(s.id)}" aria-label="Editar aluno">${ICONS.edit}</button>
        <button type="button" class="btn-icon" data-move-student="${esc(s.id)}" aria-label="Mudar aluno de turma">${ICONS.move}</button>
        <button type="button" class="btn-icon danger" data-del-student="${esc(s.id)}" aria-label="Excluir aluno">${ICONS.trash}</button>
      </div>
    </div>`).join('') || emptyState('Nenhum aluno encontrado.', 'Ajuste a pesquisa ou o filtro de turma.');
  }

  function renderBulkStudents(list) {
    return list.map(s => `<div class="list-item">
      <label class="list-item-check"><input type="checkbox" data-bulk-student="${esc(s.id)}" ${getCtx().bulkSelected.has(s.id) ? 'checked' : ''} aria-label="Selecionar ${esc(s.name)}"></label>
      <div class="list-item-main" data-open-student="${esc(s.id)}" role="button" tabindex="0"><div class="avatar sm">${initials(s.name)}</div><div><div class="list-item-title">${esc(s.name)}</div><div class="list-item-sub">${esc(studentMeta(s))}</div></div></div>
    </div>`).join('') || emptyState('Nenhum aluno encontrado.');
  }

  function renderAlunos() {
    const list = filteredSortedStudents();
    const bulk = getCtx().bulkMode;
    return `
      <div class="page-head">
        <div><h1>Alunos acompanhados</h1><div class="page-sub">${getState().students.length} ${getState().students.length === 1 ? 'aluno' : 'alunos'} no seu acompanhamento</div></div>
        <div class="page-actions"><button type="button" class="btn-secondary" id="btnToggleStudentBulk">${bulk ? 'Cancelar seleção' : 'Selecionar vários'}</button><button type="button" class="btn-primary" id="btnNewStudent">${ICONS.plus} Adicionar aluno</button></div>
      </div>
      <div class="filter-bar filter-bar-clean">
        ${searchFieldHTML('studentSearchInput', 'Pesquisar aluno...', getCtx().studentSearch || '')}
        <select class="form-select" id="studentClassFilterSelect"><option value="">Todas as turmas</option>${getState().classes.map(c => `<option value="${esc(c.id)}" ${getCtx().studentClassFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <select class="form-select" id="studentSortSelect"><option value="nome" ${getCtx().studentSort === 'nome' ? 'selected' : ''}>Nome</option><option value="turma" ${getCtx().studentSort === 'turma' ? 'selected' : ''}>Turma</option><option value="registros" ${getCtx().studentSort === 'registros' ? 'selected' : ''}>Mais acompanhados</option></select>
      </div>
      ${bulk ? `<div class="bulk-bar student-bulk-bar"><div><strong>${getCtx().bulkSelected.size} selecionado(s)</strong><span class="bulk-hint">Escolha uma ação para os alunos visíveis.</span></div><div class="bulk-bar-actions"><button type="button" class="btn-secondary btn-sm" id="btnStudentBulkSelectAll">Selecionar visíveis</button><button type="button" class="btn-secondary btn-sm" id="btnStudentBulkOccurrence">${ICONS.bell} Registrar ocorrência</button><button type="button" class="btn-secondary btn-sm" id="btnStudentBulkMove">${ICONS.move} Mudar de turma</button><button type="button" class="btn-danger-solid btn-sm" id="btnStudentBulkDelete">${ICONS.trash} Excluir</button><button type="button" class="btn-ghost btn-sm" id="btnStudentBulkClear">Limpar seleção</button></div></div>` : ''}
      <div class="card list-card" id="studentListBody">${bulk ? renderBulkStudents(list) : studentListItemsHTML(list)}</div>
    `;
  }

  function studentActivities(student) {
    return [...activitiesOf(student.classId)].sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.name.localeCompare(b.name));
  }

  function studentTimelineEntries(student) {
    const occ = occurrencesOf(student.id).map(o => ({ kind: 'ocorrencia', date: o.date, occ: o, sortKey: `${o.date}_a_${o.id}` }));
    const obs = (student.observations || []).map(o => ({ kind: 'anotacao', date: o.date, obs: o, sortKey: `${o.date}_b_${o.id}` }));
    return [...occ, ...obs].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }

  function timelineEntriesHTML(entries) {
    return entries.map(e => {
      if (e.kind === 'anotacao') return `<div class="timeline-item"><div class="timeline-dot"></div><div><div class="timeline-date">${fmtDate(e.date)}</div><div class="timeline-text"><span class="timeline-label"><span aria-hidden="true">${ICONS.file}</span> Observação pedagógica</span></div><div class="timeline-desc">${esc(e.obs.text)}</div></div></div>`;
      const o = e.occ;
      return `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-event-main"><div class="row-between"><div class="timeline-date">${fmtDate(o.date)}</div><div class="list-item-actions"><button type="button" class="btn-icon" data-edit-occ="${esc(o.id)}" aria-label="Editar ocorrência">${ICONS.edit}</button><button type="button" class="btn-icon danger" data-del-occ="${esc(o.id)}" aria-label="Excluir ocorrência">${ICONS.trash}</button></div></div><div class="timeline-text">${badgeFor(o.type)} ${esc(o.description || '')}</div></div></div>`;
    }).join('');
  }

  function renderAlunoDetail() {
    const s = getState().students.find(x => x.id === getCtx().studentId);
    if (!s) return emptyState('Aluno não encontrado.');
    const stats = studentStats(s);
    const tab = getCtx().studentTab || 'visao';
    const tabs = [{ key: 'visao', label: 'Visão geral' }, { key: 'historico', label: 'Histórico' }, { key: 'atividades', label: 'Atividades' }, { key: 'observacoes', label: 'Observações' }, { key: 'relatorio', label: 'Relatório' }];
    let body = '';
    if (tab === 'visao') {
      const entries = studentTimelineEntries(s).slice(0, 5);
      body = `<div class="card profile-notes-card"><div class="row-between"><div class="section-title">Observação geral</div><button type="button" class="btn-icon" id="btnEditNotes" aria-label="Editar observação geral">${ICONS.edit}</button></div><div id="notesDisplay" class="profile-notes">${s.notes ? `<p>${esc(s.notes)}</p>` : emptyState('Nenhuma observação geral registrada.')}</div></div><div class="section-title">Acompanhamento recente</div><div class="card list-card">${entries.length ? timelineEntriesHTML(entries) : emptyState('Nenhum registro ainda.')}</div>`;
    } else if (tab === 'historico') {
      const entries = studentTimelineEntries(s);
      const months = [...new Set(entries.map(e => e.date.slice(0, 7)))].sort().reverse();
      let filtered = entries;
      if (getCtx().histFilter && getCtx().histFilter !== 'todos') filtered = filtered.filter(e => e.kind === getCtx().histFilter);
      if (getCtx().histMonth) filtered = filtered.filter(e => e.date.slice(0, 7) === getCtx().histMonth);
      body = `<div class="quick-options history-filters">${[{key:'todos',label:'Todos'},{key:'ocorrencia',label:'Ocorrências'},{key:'anotacao',label:'Observações'}].map(f => `<button type="button" class="quick-opt ${getCtx().histFilter === f.key ? 'selected' : ''}" data-hist-filter="${f.key}">${f.label}</button>`).join('')}</div>${months.length ? `<select class="form-select history-month" id="histMonthSelect"><option value="">Todos os períodos</option>${months.map(m => `<option value="${m}" ${getCtx().histMonth === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>` : ''}<div class="card">${filtered.length ? timelineEntriesHTML(filtered) : emptyState('Nenhum registro encontrado para este filtro.')}</div>`;
    } else if (tab === 'atividades') {
      body = `<div class="card list-card">${studentActivities(s).map(a => `<div class="list-item"><div class="list-item-main" data-open-activity="${esc(a.id)}" role="button" tabindex="0"><div class="list-item-title">${esc(a.name)}</div><div class="list-item-sub">${esc(classNameOf(a.classId))}${a.assignmentId ? ` · ${esc(assignmentNameOf(a.assignmentId))}` : ''} · ${fmtDate(a.dueDate)}</div></div><span class="badge ${activityStatus(getState(), a) === 'atrasada' ? 'badge-red' : 'badge-blue'}">${activityStatus(getState(), a) === 'atrasada' ? 'Atrasada' : 'Agendada'}</span></div>`).join('') || emptyState('Nenhuma atividade para a turma deste aluno.')}</div>`;
    } else if (tab === 'observacoes') {
      const obs = [...(s.observations || [])].sort((a, b) => b.date.localeCompare(a.date));
      body = `<div class="row-between compact-section-head"><div></div><button type="button" class="btn-primary btn-sm" id="btnNewObservation">${ICONS.plus} Nova observação</button></div><div class="card list-card">${obs.map(o => `<div class="list-item"><div class="list-item-main"><div><div class="timeline-date">${fmtDate(o.date)}</div><div class="timeline-text preserve-text">${esc(o.text)}</div></div></div><div class="list-item-actions"><button type="button" class="btn-icon" data-edit-obs="${esc(o.id)}" aria-label="Editar observação">${ICONS.edit}</button><button type="button" class="btn-icon danger" data-del-obs="${esc(o.id)}" aria-label="Excluir observação">${ICONS.trash}</button></div></div>`).join('') || emptyState('Nenhuma observação datada ainda.')}</div>`;
    } else if (tab === 'relatorio') {
      body = `<div class="card narrow-card"><p class="muted">Gere um relatório individual com dados de acompanhamento, ocorrências, observações e atividades do período.</p><button type="button" class="btn-primary btn-block" id="btnGoStudentReport">${ICONS.report} Gerar relatório individual</button></div>`;
    }

    return `<button type="button" class="btn-ghost btn-sm page-back" id="btnBack">${ICONS.back} Voltar</button><div class="profile-header student-profile-header"><div class="avatar lg">${initials(s.name)}</div><div class="profile-header-main"><div class="list-item-title profile-student-name">${esc(s.name)}</div><div class="list-item-sub">${esc(classNameOf(s.classId))}</div></div><div class="profile-actions"><button type="button" class="btn-primary btn-sm" id="btnRegisterForStudent">${ICONS.plus} Registrar ocorrência</button><button type="button" class="btn-secondary btn-sm" id="btnStudentActions">Mais ações</button></div></div><div class="stat-row profile-stats"><div class="card stat-card"><div class="stat-value">${stats.activityCount}</div><div class="stat-label">Atividades</div></div><div class="card stat-card"><div class="stat-value">${stats.occurrenceCount}</div><div class="stat-label">Ocorrências</div></div><div class="card stat-card"><div class="stat-value">${stats.observationCount}</div><div class="stat-label">Observações</div></div></div><div class="tabs responsive-tabs">${tabs.map(t => `<button type="button" class="tab ${tab === t.key ? 'active' : ''}" data-student-tab="${esc(t.key)}">${t.label}</button>`).join('')}</div>${body}`;
  }

  function activityListItemHTML(a) {
    const status = activityStatus(getState(), a);
    return `<div class="list-item"><div class="list-item-main" data-open-activity="${esc(a.id)}" role="button" tabindex="0"><div class="list-item-title">${esc(a.name)}</div><div class="list-item-sub">${esc(classNameOf(a.classId))}${a.assignmentId ? ` · ${esc(assignmentNameOf(a.assignmentId))}` : ''} · ${fmtDate(a.dueDate)}</div></div><span class="badge ${status === 'atrasada' ? 'badge-red' : 'badge-blue'}">${status === 'atrasada' ? 'Atrasada' : 'Agendada'}</span><div class="list-item-actions"><button type="button" class="btn-icon danger" data-del-activity="${esc(a.id)}" aria-label="Excluir atividade">${ICONS.trash}</button></div></div>`;
  }

  function filteredActivities() {
    let list = [...getState().activities];
    const ctx = getCtx();
    if (ctx.activityClassFilter) list = list.filter(a => a.classId === ctx.activityClassFilter);
    const term = (ctx.activitySearch || '').trim().toLowerCase();
    if (term) list = list.filter(a => [a.name, a.description, classNameOf(a.classId)].some(value => String(value || '').toLowerCase().includes(term)));
    if (ctx.activityFilter === 'proximas') list = list.filter(a => activityStatus(getState(), a) === 'proxima');
    else if (ctx.activityFilter === 'atrasadas') list = list.filter(a => activityStatus(getState(), a) === 'atrasada');
    return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
  }

  function renderAtividades() {
    const filters = [{ key: 'proximas', label: 'Próximas' }, { key: 'atrasadas', label: 'Atrasadas' }, { key: 'todas', label: 'Todas' }];
    return `<div class="page-head"><div><h1>Atividades</h1><div class="page-sub">Planeje o que precisa acontecer, sem controlar entregas aluno a aluno.</div></div><div class="page-actions"><button type="button" class="btn-primary" id="btnNewActivity">${ICONS.plus} Nova atividade</button></div></div><div class="filter-bar filter-bar-clean">${searchFieldHTML('activitySearchInput', 'Pesquisar atividade...', getCtx().activitySearch || '')}<div class="chip-toggle-group">${filters.map(f => `<button type="button" class="chip-toggle ${getCtx().activityFilter === f.key ? 'active' : ''}" data-activity-filter="${f.key}">${f.label}</button>`).join('')}</div><select class="form-select" id="activityClassFilterSelect"><option value="">Todas as turmas</option>${getState().classes.map(c => `<option value="${esc(c.id)}" ${getCtx().activityClassFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><div class="card list-card">${filteredActivities().map(activityListItemHTML).join('') || emptyState('Nenhuma atividade encontrada.')}</div>`;
  }

  function renderAtividadeDetail() {
    const a = getState().activities.find(x => x.id === getCtx().activityId);
    if (!a) return emptyState('Atividade não encontrada.');
    const status = activityStatus(getState(), a);
    return `<button type="button" class="btn-ghost btn-sm page-back" id="btnBack">${ICONS.back} Voltar</button><section class="card detail-hero-card"><div class="row-between"><div><div class="list-item-title detail-title">${esc(a.name)}</div><div class="list-item-sub">${esc(classNameOf(a.classId))}${a.assignmentId ? ` · ${esc(assignmentNameOf(a.assignmentId))}` : ''} · ${fmtDate(a.dueDate)}</div></div><button type="button" class="btn-secondary btn-sm" id="btnEditActivity">${ICONS.edit} Editar</button></div><div class="detail-status-line"><span class="badge ${status === 'atrasada' ? 'badge-red' : 'badge-blue'}">${status === 'atrasada' ? 'Atrasada' : 'Agendada'}</span></div>${a.description ? `<p class="detail-description">${esc(a.description)}</p>` : ''}</section><div class="card activity-guidance"><strong>Como usar</strong><p>Use atividades para organizar a agenda da turma. Acompanhe alunos individualmente por meio de ocorrências e observações, sem precisar manter uma lista completa da turma.</p></div>`;
  }

  return { renderAlunos, renderAlunoDetail, renderAtividades, renderAtividadeDetail, activityListItemHTML, studentTimelineEntries, timelineEntriesHTML };
}
