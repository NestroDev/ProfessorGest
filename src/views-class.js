export function createClassViewRenderers(deps) {
  const {
    getState, getCtx, classById, classStats, studentsOf, occurrencesOf, studentById,
    situacaoAluno, initials, activityListItemHTML, esc, fmtDate, todayISO, emptyState, badgeFor, ICONS
  } = deps;

  function renderClassStudentsTab(c) {
    const alunos = studentsOf(c.id);
    const bulk = getCtx().bulkMode;
    return `
      <div class="row-between" style="margin-bottom:12px;">
        <button type="button" class="btn-ghost btn-sm" id="btnToggleBulk">${bulk ? 'Cancelar seleção' : 'Selecionar vários'}</button>
        <button type="button" class="btn-primary btn-sm" id="btnAddStudentHere">${ICONS.plus} Aluno</button>
      </div>
      ${bulk ? `<div class="bulk-bar"><span class="bulk-count">${getCtx().bulkSelected.size} selecionado(s)</span>
        <div class="bulk-bar-actions">
          <button type="button" class="btn-secondary btn-sm" id="btnBulkOccurrence">Registrar ocorrência</button>
          <button type="button" class="btn-secondary btn-sm" id="btnBulkSelectAll">Selecionar todos</button>
        </div></div>` : ''}
      <div class="card list-card">
        ${alunos.map(s => {
          const sit = situacaoAluno(s);
          return `<div class="list-item">
            ${bulk ? `<label class="list-item-check"><input type="checkbox" data-bulk-student="${esc(s.id)}" ${getCtx().bulkSelected.has(s.id) ? 'checked' : ''}></label>` : ''}
            <div class="list-item-main" ${bulk ? '' : `data-open-student="${esc(s.id)}"`}>
              <div class="avatar sm">${initials(s.name)}</div>
              <div><div class="list-item-title">${esc(s.name)}</div><div class="list-item-sub">${occurrencesOf(s.id).length} registros · <span class="badge badge-${sit.tone}">${sit.label}</span></div></div>
            </div>
            ${bulk ? '' : `<div class="list-item-actions">
              <button type="button" class="btn-icon" data-edit-student="${esc(s.id)}" aria-label="Editar aluno">${ICONS.edit}</button>
              <button type="button" class="btn-icon danger" data-del-student="${esc(s.id)}" aria-label="Excluir aluno">${ICONS.trash}</button>
            </div>`}
          </div>`;
        }).join('') || emptyState('Nenhum aluno nesta turma ainda.')}
      </div>
    `;
  }

  function renderTurmaDetail() {
    const ctx = getCtx();
    const state = getState();
    const c = classById(ctx.classId);
    if (!c) return emptyState('Turma não encontrada.');
    const st = classStats(c);
    const tab = ctx.classTab || 'visao';
    const tabs = [
      { key: 'visao', label: 'Visão geral' }, { key: 'alunos', label: 'Alunos' },
      { key: 'atividades', label: 'Atividades' }, { key: 'ocorrencias', label: 'Ocorrências' },
      { key: 'relatorios', label: 'Relatórios' },
    ];

    let body = '';
    if (tab === 'visao') {
      const upcomingActs = st.acts.filter(a => a.dueDate >= todayISO()).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
      const studentIds = new Set(st.alunos.map(s => s.id));
      const recentOcc = state.occurrences.filter(o => studentIds.has(o.studentId)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
      body = `
        <div class="grid grid-4" style="margin-bottom:20px;">
          <div class="card stat-card"><div class="stat-value">${st.alunos.length}</div><div class="stat-label">Alunos</div></div>
          <div class="card stat-card"><div class="stat-value">${st.pct}%</div><div class="stat-label">Entrega de atividades</div></div>
          <div class="card stat-card"><div class="stat-value">${st.pend}</div><div class="stat-label">Pendências</div></div>
          <div class="card stat-card"><div class="stat-value">${st.occCount}</div><div class="stat-label">Ocorrências registradas</div></div>
        </div>
        <div class="grid grid-2">
          <div><div class="section-title">Próximas atividades</div><div class="card list-card">
            ${upcomingActs.map(a => `<div class="list-item"><div class="list-item-main" data-open-activity="${esc(a.id)}" role="button" tabindex="0">
              <div class="list-item-title">${esc(a.name)}</div><div class="list-item-sub">entrega ${fmtDate(a.dueDate)}</div></div></div>`).join('') || emptyState('Nenhuma atividade futura.')}
          </div></div>
          <div><div class="section-title">Registros recentes</div><div class="card list-card">
            ${recentOcc.map(o => { const s = studentById(o.studentId); return `<div class="list-item"><div class="list-item-main" data-open-student="${esc(o.studentId)}">
              <div class="list-item-title">${esc(s ? s.name : '—')}</div><div class="list-item-sub">${fmtDate(o.date)} · ${badgeFor(o.type)}</div></div></div>`; }).join('') || emptyState('Nenhum registro ainda.')}
          </div></div>
        </div>`;
    } else if (tab === 'alunos') {
      body = renderClassStudentsTab(c);
    } else if (tab === 'atividades') {
      body = `<div class="row-between" style="margin-bottom:12px;"><div></div><button type="button" class="btn-primary btn-sm" id="btnNewActivityHere">${ICONS.plus} Nova atividade</button></div>
        <div class="card list-card">${st.acts.map(activityListItemHTML).join('') || emptyState('Nenhuma atividade nesta turma.')}</div>`;
    } else if (tab === 'ocorrencias') {
      const studentIds = new Set(st.alunos.map(s => s.id));
      const occ = state.occurrences.filter(o => studentIds.has(o.studentId)).sort((a, b) => b.date.localeCompare(a.date));
      body = `<div class="card list-card">${occ.map(o => { const s = studentById(o.studentId); return `<div class="list-item"><div class="list-item-main" data-open-student="${esc(o.studentId)}">
        <div class="list-item-title">${esc(s ? s.name : '—')}</div><div class="list-item-sub">${fmtDate(o.date)} · ${badgeFor(o.type)} ${o.description ? '· ' + esc(o.description) : ''}</div></div></div>`; }).join('') || emptyState('Nenhuma ocorrência registrada para esta turma.')}</div>`;
    } else if (tab === 'relatorios') {
      body = `<div class="card" style="max-width:420px;">
        <p class="muted" style="margin-bottom:14px;font-size:13px;">Gerar um relatório consolidado desta turma, com entregas, pendências e ocorrências no período escolhido.</p>
        <button type="button" class="btn-primary btn-block" id="btnGoClassReport">${ICONS.report} Gerar relatório da turma</button>
      </div>`;
    }

    return `
      <button type="button" class="btn-secondary btn-sm" id="btnBack">${ICONS.back} Voltar</button>
      <div class="card" style="margin-top:14px;margin-bottom:8px;">
        <div class="row-between">
          <div>
            <div class="list-item-title" style="font-size:17px;">${esc(c.name)} ${c.archived ? '<span class="badge badge-gray">Arquivada</span>' : ''}</div>
            <div class="list-item-sub">${st.alunos.length} alunos · ${st.pend} pendência(s)</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn-primary btn-sm" id="btnRegisterForClass">${ICONS.plus} Registrar</button>
            <button type="button" class="btn-secondary btn-sm" id="btnEditThisClass">${ICONS.edit} Editar</button>
          </div>
        </div>
      </div>
      <div class="tabs">${tabs.map(t => `<button type="button" class="tab ${tab === t.key ? 'active' : ''}" data-class-tab="${esc(t.key)}">${t.label}</button>`).join('')}</div>
      ${body}
    `;
  }

  return { renderTurmaDetail, renderClassStudentsTab };
}
