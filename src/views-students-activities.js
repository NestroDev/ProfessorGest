export function createStudentActivityRenderers(deps) {
  const {
    getState, getCtx, esc, initials, classNameOf, studentStats, activityStats, activityStatus,
    situacaoAluno, occurrencesOf, activitiesOf, getDeliveryState, deliveryBadge,
    progressBarHTML, emptyState, fmtDate, monthLabel, badgeFor, todayISO, ICONS
  } = deps;

  function filteredSortedStudents() {
    const term = (getCtx().studentSearch || '').trim().toLowerCase();
    let list = getState().students.filter(s => !term || s.name.toLowerCase().includes(term));
    if (getCtx().studentClassFilter) list = list.filter(s => s.classId === getCtx().studentClassFilter);
    if (getCtx().studentSituacao) list = list.filter(s => situacaoAluno(s).key === getCtx().studentSituacao);
    if (getCtx().studentSort === 'turma') list = [...list].sort((a, b) => classNameOf(a.classId).localeCompare(classNameOf(b.classId)) || a.name.localeCompare(b.name));
    else if (getCtx().studentSort === 'pendencias') list = [...list].sort((a, b) => studentStats(b).pend - studentStats(a).pend);
    else list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  function studentListItemsHTML(list) {
    return list.map(s => {
      const sit = situacaoAluno(s);
      return `<div class="list-item">
        <div class="list-item-main" data-open-student="${esc(s.id)}" role="button" tabindex="0">
          <div class="avatar sm">${initials(s.name)}</div>
          <div><div class="list-item-title">${esc(s.name)}</div>
          <div class="list-item-sub">${esc(classNameOf(s.classId))} · <span class="badge badge-${sit.tone}">${sit.label}</span></div></div>
        </div>
        <div class="list-item-actions">
          <button type="button" class="btn-icon" data-quick-occ-student="${esc(s.id)}" aria-label="Registrar ocorrência">${ICONS.plus}</button>
          <button type="button" class="btn-icon" data-edit-student="${esc(s.id)}" aria-label="Editar aluno">${ICONS.edit}</button>
          <button type="button" class="btn-icon" data-move-student="${esc(s.id)}" aria-label="Mudar aluno de turma">${ICONS.move}</button>
          <button type="button" class="btn-icon danger" data-del-student="${esc(s.id)}" aria-label="Excluir aluno">${ICONS.trash}</button>
        </div>
      </div>`;
    }).join('') || emptyState('Nenhum aluno encontrado.', 'Ajuste a pesquisa ou os filtros.');
  }

  function renderAlunos() {
    return `
      <div class="page-head">
        <div><h1>Alunos</h1><div class="page-sub">${getState().students.length} aluno(s) cadastrado(s)</div></div>
        <div class="page-actions">
          <button type="button" class="btn-secondary" id="btnToggleStudentBulk">${getCtx().bulkMode ? 'Cancelar seleção' : 'Selecionar vários'}</button>
          <button type="button" class="btn-primary" id="btnNewStudent">${ICONS.plus} Novo aluno</button>
        </div>
      </div>
      <div class="filter-bar filter-bar-clean">
        <div class="search-bar" style="max-width:340px;"><input class="form-input input-search" id="studentSearchInput" placeholder="Buscar aluno..." value="${esc(getCtx().studentSearch || '')}"></div>
        <select class="form-select" id="studentClassFilterSelect">
          <option value="">Todas as turmas</option>
          ${getState().classes.map(c => `<option value="${esc(c.id)}" ${getCtx().studentClassFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
        <details class="filter-details">
          <summary>Mais filtros</summary>
          <div class="filter-details-panel">
            <label class="filter-details-field"><span>Situação</span><select class="form-select" id="studentSituacaoSelect">
              <option value="">Qualquer situação</option>
              <option value="ok" ${getCtx().studentSituacao === 'ok' ? 'selected' : ''}>Em dia</option>
              <option value="pendencia" ${getCtx().studentSituacao === 'pendencia' ? 'selected' : ''}>Com pendências</option>
              <option value="critico" ${getCtx().studentSituacao === 'critico' ? 'selected' : ''}>Muitas pendências</option>
            </select></label>
            <label class="filter-details-field"><span>Ordenar</span><select class="form-select" id="studentSortSelect">
              <option value="nome" ${getCtx().studentSort === 'nome' ? 'selected' : ''}>Nome</option>
              <option value="turma" ${getCtx().studentSort === 'turma' ? 'selected' : ''}>Turma</option>
              <option value="pendencias" ${getCtx().studentSort === 'pendencias' ? 'selected' : ''}>Pendências</option>
            </select></label>
          </div>
        </details>
      </div>
      ${getCtx().bulkMode ? `<div class="bulk-bar" style="margin-bottom:12px;"><span class="bulk-count">${getCtx().bulkSelected.size} selecionado(s)</span>
        <div class="bulk-bar-actions">
          <button type="button" class="btn-secondary btn-sm" id="btnStudentBulkSelectAll">Selecionar todos</button>
          <button type="button" class="btn-secondary btn-sm" id="btnStudentBulkMove">${ICONS.move} Mudar de turma</button>
        </div>
      </div>` : ''}
      <div class="card list-card" id="studentListBody">${getCtx().bulkMode ? filteredSortedStudents().map(s => {
        const sit = situacaoAluno(s);
        return `<div class="list-item">
          <label class="list-item-check"><input type="checkbox" data-bulk-student="${esc(s.id)}" ${getCtx().bulkSelected.has(s.id) ? 'checked' : ''}></label>
          <div class="list-item-main">
            <div class="avatar sm">${initials(s.name)}</div>
            <div><div class="list-item-title">${esc(s.name)}</div><div class="list-item-sub">${esc(classNameOf(s.classId))} · <span class="badge badge-${sit.tone}">${sit.label}</span></div></div>
          </div>
        </div>`;
      }).join('') || emptyState('Nenhum aluno encontrado.') : studentListItemsHTML(filteredSortedStudents())}</div>
    `;
  }

  function studentActivities(student) {
    const state = getState();
    const current = activitiesOf(student.classId);
    const historicalIds = new Set(current.map(a => a.id));
    const historical = state.activities.filter(a => {
      if (historicalIds.has(a.id)) return false;
      return a.completions && Object.prototype.hasOwnProperty.call(a.completions, student.id);
    });
    return [...current, ...historical].sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.name.localeCompare(b.name));
  }

  function studentTimelineEntries(student) {
    const occ = occurrencesOf(student.id).map(o => ({ kind: o.type === 'observacao' ? 'observacao' : 'ocorrencia', date: o.date, occ: o, sortKey: o.date + '_a_' + o.id }));
    const obs = (student.observations || []).map(o => ({ kind: 'anotacao', date: o.date, obs: o, sortKey: o.date + '_b_' + o.id }));
    const acts = studentActivities(student).map(a => {
      const st = getDeliveryState(a, student.id);
      if (st === 'pending') return null;
      return { kind: 'atividade', date: a.dueDate, activity: a, state: st, sortKey: a.dueDate + '_c_' + a.id };
    }).filter(Boolean);
    return [...occ, ...obs, ...acts].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }

  function timelineEntriesHTML(entries) {
    return entries.map(e => {
      if (e.kind === 'atividade') {
        const done = e.state === 'delivered';
        return `<div class="timeline-item"><div class="timeline-dot ${done ? 'green' : 'red'}"></div>
          <div><div class="timeline-date">${fmtDate(e.date)}</div>
          <div class="timeline-text">${done ? '✅' : '❌'} ${esc(e.activity.name)} — ${done ? 'entregou' : 'não entregou'}</div></div></div>`;
      }
      if (e.kind === 'anotacao') {
        return `<div class="timeline-item"><div class="timeline-dot"></div>
          <div><div class="timeline-date">${fmtDate(e.date)}</div><div class="timeline-text">📝 Observação pedagógica</div>
          <div class="timeline-desc">${esc(e.obs.text)}</div></div></div>`;
      }
      const o = e.occ;
      return `<div class="timeline-item"><div class="timeline-dot"></div>
        <div style="flex:1;"><div class="row-between"><div class="timeline-date">${fmtDate(o.date)}</div>
        <div class="list-item-actions"><button type="button" class="btn-icon" data-edit-occ="${esc(o.id)}" aria-label="Editar ocorrência">${ICONS.edit}</button>
        <button type="button" class="btn-icon danger" data-del-occ="${esc(o.id)}" aria-label="Excluir ocorrência">${ICONS.trash}</button></div></div>
        <div class="timeline-text">${badgeFor(o.type)} ${esc(o.description || '')}</div></div></div>`;
    }).join('');
  }

  function renderHistFilters(student) {
    const entries = studentTimelineEntries(student);
    const months = [...new Set(entries.map(e => e.date.slice(0, 7)))].sort().reverse();
    const filters = [
      { key: 'todos', label: 'Todos' }, { key: 'ocorrencia', label: 'Ocorrências' },
      { key: 'atividade', label: 'Atividades' }, { key: 'anotacao', label: 'Observações' },
    ];
    return `
      <div class="quick-options" style="margin-bottom:8px;">
        ${filters.map(f => `<button type="button" class="quick-opt ${getCtx().histFilter === f.key ? 'selected' : ''}" data-hist-filter="${esc(f.key)}">${f.label}</button>`).join('')}
      </div>
      ${months.length ? `<select class="form-select" id="histMonthSelect" style="max-width:220px;margin-bottom:14px;">
        <option value="">Todos os períodos</option>
        ${months.map(m => `<option value="${m}" ${getCtx().histMonth === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}
      </select>` : ''}
    `;
  }

  function renderTimeline(student) {
    let entries = studentTimelineEntries(student);
    if (getCtx().histFilter && getCtx().histFilter !== 'todos') entries = entries.filter(e => e.kind === getCtx().histFilter);
    if (getCtx().histMonth) entries = entries.filter(e => e.date.slice(0, 7) === getCtx().histMonth);
    if (!entries.length) return emptyState('Nenhum registro encontrado para este filtro.');
    return timelineEntriesHTML(entries);
  }

  function renderAlunoDetail() {
    const s = getState().students.find(x => x.id === getCtx().studentId);
    if (!s) return emptyState('Aluno não encontrado.');
    const stt = studentStats(s);
    const sit = situacaoAluno(s);
    const tab = getCtx().studentTab || 'visao';
    const tabs = [
      { key: 'visao', label: 'Visão geral' }, { key: 'historico', label: 'Histórico' },
      { key: 'atividades', label: 'Atividades' }, { key: 'observacoes', label: 'Observações' },
      { key: 'relatorio', label: 'Relatório' },
    ];

    let body = '';
    if (tab === 'visao') {
      const entries = studentTimelineEntries(s).slice(0, 5);
      body = `
        <div class="card" style="margin-bottom:16px;" id="notesCard">
          <div class="row-between"><div class="section-title" style="margin:0;">Observação geral</div><button type="button" class="btn-icon" id="btnEditNotes" aria-label="Editar observação geral">${ICONS.edit}</button></div>
          <div id="notesDisplay" style="margin-top:8px;">${s.notes ? `<p style="white-space:pre-wrap;font-size:13px;line-height:1.5;">${esc(s.notes)}</p>` : emptyState('Nenhuma observação geral registrada.')}</div>
        </div>
        <div class="section-title">Atividade recente</div>
        <div class="card list-card">${entries.length ? timelineEntriesHTML(entries) : emptyState('Nenhum registro ainda.')}</div>
      `;
    } else if (tab === 'historico') {
      body = renderHistFilters(s) + `<div class="card">${renderTimeline(s)}</div>`;
    } else if (tab === 'atividades') {
      const acts = studentActivities(s);
      body = `<div class="card list-card">${acts.map(a => {
        const st = getDeliveryState(a, s.id);
        const previousClass = a.classId !== s.classId;
        return `<div class="list-item"><div class="list-item-main" data-open-activity="${esc(a.id)}" role="button" tabindex="0">
          <div class="list-item-title">${esc(a.name)}</div><div class="list-item-sub">entrega ${fmtDate(a.dueDate)}${previousClass ? ` · ${esc(classNameOf(a.classId))}` : ''}</div></div>${previousClass ? '<span class="badge">Histórico</span>' : ''}${deliveryBadge(st)}</div>`;
      }).join('') || emptyState('Nenhuma atividade para a turma deste aluno.')}</div>`;
    } else if (tab === 'observacoes') {
      const obs = [...(s.observations || [])].sort((a, b) => b.date.localeCompare(a.date));
      body = `<div class="row-between" style="margin-bottom:12px;"><div></div><button type="button" class="btn-primary btn-sm" id="btnNewObservation">${ICONS.plus} Nova observação</button></div>
        <div class="card list-card">${obs.map(o => `
          <div class="list-item"><div style="flex:1;"><div class="timeline-date">${fmtDate(o.date)}</div>
          <div class="timeline-text" style="white-space:pre-wrap;">${esc(o.text)}</div></div>
          <div class="list-item-actions"><button type="button" class="btn-icon" data-edit-obs="${esc(o.id)}" aria-label="Editar observação">${ICONS.edit}</button>
          <button type="button" class="btn-icon danger" data-del-obs="${esc(o.id)}" aria-label="Excluir observação">${ICONS.trash}</button></div></div>`).join('') || emptyState('Nenhuma observação datada ainda.', 'Use para anotar avanços, dificuldades ou combinados com a família.')}</div>`;
    } else if (tab === 'relatorio') {
      body = `<div class="card" style="max-width:420px;">
        <p class="muted" style="margin-bottom:14px;font-size:13px;">Gerar um relatório individual completo de ${esc(s.name)}, com entregas, ocorrências, observações e linha do tempo.</p>
        <button type="button" class="btn-primary btn-block" id="btnGoStudentReport">${ICONS.report} Gerar relatório individual</button>
      </div>`;
    }

    return `
      <button type="button" class="btn-secondary btn-sm" id="btnBack">${ICONS.back} Voltar</button>
      <div class="profile-header" style="margin-top:14px;">
        <div class="avatar lg">${initials(s.name)}</div>
        <div><div class="list-item-title" style="font-size:18px;">${esc(s.name)}</div>
          <div class="list-item-sub">${esc(classNameOf(s.classId))} · <span class="badge badge-${sit.tone}">${sit.label}</span></div></div>
        <div class="profile-actions">
          <button type="button" class="btn-primary btn-sm" id="btnRegisterForStudent">${ICONS.plus} Registrar ocorrência</button>
          <button type="button" class="btn-secondary btn-sm" id="btnStudentActions">Mais ações</button>
        </div>
      </div>
      <div class="stat-row" style="margin-bottom:18px;">
        <div class="card stat-card"><div class="stat-value">${stt.totalActs}</div><div class="stat-label">Atividades</div></div>
        <div class="card stat-card"><div class="stat-value">${stt.delivered}</div><div class="stat-label">Entregas</div></div>
        <div class="card stat-card"><div class="stat-value">${stt.notDelivered}</div><div class="stat-label">Não entregues</div></div>
        <div class="card stat-card"><div class="stat-value">${stt.pend}</div><div class="stat-label">Pendências</div></div>
        <div class="card stat-card"><div class="stat-value">${stt.occCount}</div><div class="stat-label">Registros</div></div>
      </div>
      <div class="tabs">${tabs.map(t => `<button type="button" class="tab ${tab === t.key ? 'active' : ''}" data-student-tab="${esc(t.key)}">${t.label}</button>`).join('')}</div>
      ${body}
    `;
  }

  function activityListItemHTML(a) {
    const stt = activityStats(a);
    const status = activityStatus(a);
    const statusBadge = status === 'concluida' ? '<span class="badge badge-green">Registros completos</span>'
      : status === 'atrasada' ? '<span class="badge badge-red">Atrasada</span>' : '<span class="badge badge-blue">Próxima</span>';
    return `<div class="list-item">
      <div class="list-item-main" data-open-activity="${esc(a.id)}" role="button" tabindex="0">
        <div class="list-item-title">${esc(a.name)} ${statusBadge}</div>
        <div class="list-item-sub">${esc(classNameOf(a.classId))} · entrega ${fmtDate(a.dueDate)} · ${stt.pct}% entregue · ${stt.notDelivered + stt.pending} pendência(s)</div>
      </div>
      <div class="list-item-actions"><button type="button" class="btn-icon danger" data-del-activity="${esc(a.id)}" aria-label="Excluir atividade">${ICONS.trash}</button></div>
    </div>`;
  }

  function filteredActivities() {
    const today = todayISO();
    let list = [...getState().activities];
    if (getCtx().activityClassFilter) list = list.filter(a => a.classId === getCtx().activityClassFilter);
    const term = (getCtx().activitySearch || '').trim().toLowerCase();
    if (term) list = list.filter(a => [a.name, a.description, classNameOf(a.classId)].some(value => String(value || '').toLowerCase().includes(term)));
    if (getCtx().activityFilter === 'proximas') list = list.filter(a => a.dueDate >= today && activityStatus(a) !== 'concluida');
    else if (getCtx().activityFilter === 'atrasadas') list = list.filter(a => activityStatus(a) === 'atrasada');
    else if (getCtx().activityFilter === 'concluidas') list = list.filter(a => activityStatus(a) === 'concluida');
    return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  function renderAtividades() {
    const filters = [
      { key: 'proximas', label: 'Próximas' }, { key: 'atrasadas', label: 'Atrasadas' },
      { key: 'concluidas', label: 'Registros completos' }, { key: 'todas', label: 'Todas' },
    ];
    return `
      <div class="page-head">
        <div><h1>Atividades</h1><div class="page-sub">${getState().activities.length} atividade(s) cadastrada(s)</div></div>
        <div class="page-actions"><button type="button" class="btn-primary" id="btnNewActivity">${ICONS.plus} Nova atividade</button></div>
      </div>
      <div class="filter-bar">
        <div class="search-bar" style="max-width:300px;"><input class="form-input input-search" id="activitySearchInput" placeholder="Pesquisar atividade..." value="${esc(getCtx().activitySearch || '')}"></div>
        <div class="chip-toggle-group">${filters.map(f => `<button type="button" class="chip-toggle ${getCtx().activityFilter === f.key ? 'active' : ''}" data-activity-filter="${esc(f.key)}">${f.label}</button>`).join('')}</div>
        <select class="form-select" id="activityClassFilterSelect" style="margin-left:auto;">
          <option value="">Todas as turmas</option>
          ${getState().classes.map(c => `<option value="${esc(c.id)}" ${getCtx().activityClassFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="card list-card">${filteredActivities().map(activityListItemHTML).join('') || emptyState('Nenhuma atividade encontrada para este filtro.')}</div>
    `;
  }

  function renderAtividadeDetail() {
    const a = getState().activities.find(x => x.id === getCtx().activityId);
    if (!a) return emptyState('Atividade não encontrada.');
    const stt = activityStats(a);
    const bulk = getCtx().bulkMode;
    return `
      <button type="button" class="btn-secondary btn-sm" id="btnBack">${ICONS.back} Voltar</button>
      <div class="card" style="margin-top:14px;">
        <div class="row-between">
          <div><div class="list-item-title" style="font-size:17px;">${esc(a.name)}</div>
            <div class="list-item-sub">${esc(classNameOf(a.classId))} · entrega ${fmtDate(a.dueDate)}</div></div>
          <button type="button" class="btn-secondary btn-sm" id="btnEditActivity">${ICONS.edit} Editar</button>
        </div>
        ${a.description ? `<p style="margin-top:10px;font-size:13px;color:var(--text-muted);white-space:pre-wrap;">${esc(a.description)}</p>` : ''}
        <div style="margin-top:14px;">${progressBarHTML(stt.pct)}</div>
      </div>
      <div class="stat-row" style="margin-top:14px;margin-bottom:18px;">
        <div class="card stat-card"><div class="stat-value">${stt.alunos.length}</div><div class="stat-label">Total de alunos</div></div>
        <div class="card stat-card"><div class="stat-value">${stt.delivered}</div><div class="stat-label">✅ Entregaram</div></div>
        <div class="card stat-card"><div class="stat-value">${stt.notDelivered}</div><div class="stat-label">❌ Não entregaram</div></div>
        <div class="card stat-card"><div class="stat-value">${stt.pending}</div><div class="stat-label">◯ Não verificados</div></div>
      </div>
      <div class="row-between">
        <div class="section-title" style="margin:0;">Marcar entregas</div>
        <button type="button" class="btn-ghost btn-sm" id="btnToggleBulk">${bulk ? 'Cancelar seleção' : 'Ações em massa'}</button>
      </div>
      <p class="muted" style="font-size:12px;margin:4px 0 10px;">Toque para alternar entre não verificado, entregou e não entregou.</p>
      ${bulk ? `<div class="bulk-bar"><span class="bulk-count">${getCtx().bulkSelected.size} selecionado(s)</span>
        <div class="bulk-bar-actions">
          <button type="button" class="btn-secondary btn-sm" id="btnBulkSelectAll">Selecionar todos</button>
          <button type="button" class="btn-secondary btn-sm" data-bulk-set="delivered">✅ Marcar entregou</button>
          <button type="button" class="btn-secondary btn-sm" data-bulk-set="not_delivered">❌ Marcar não entregou</button>
          <button type="button" class="btn-secondary btn-sm" data-bulk-set="pending">◯ Marcar não verificado</button>
        </div></div>` : ''}
      <div class="card">
        ${stt.alunos.map(s => {
          const st = getDeliveryState(a, s.id);
          const icon = st === 'delivered' ? '✅' : st === 'not_delivered' ? '❌' : '◯';
          const label = st === 'delivered' ? 'Entregou' : st === 'not_delivered' ? 'Não entregou' : 'Não verificado';
          return `<div class="deliver-item">
            ${bulk ? `<label class="list-item-check"><input type="checkbox" data-bulk-student="${esc(s.id)}" ${getCtx().bulkSelected.has(s.id) ? 'checked' : ''}></label>` : ''}
            <span style="flex:1;">${esc(s.name)}</span>
            ${bulk ? '' : `<button type="button" class="tri-toggle" data-cycle-delivery="${esc(s.id)}">${icon} ${label}</button>`}
          </div>`;
        }).join('') || emptyState('Nenhum aluno nesta turma.')}
      </div>
    `;
  }

  return {
    renderAlunos,
    renderAlunoDetail,
    renderAtividades,
    renderAtividadeDetail,
    activityListItemHTML,
    studentTimelineEntries,
    timelineEntriesHTML,
  };
}
