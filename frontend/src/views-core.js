export function createCoreViewRenderers(api) {
  const {
    getState, getCtx, setLastAttentionItems,
    activeStudents, activeActivities, activeClasses,
    classStats, studentById, classNameOf,
    attentionItems, todayISO, greeting, esc, fmtDate,
    emptyState, badgeFor, ICONS
  } = api;

  function renderDashboard() {
    const state = getState();
    const classes = activeClasses();
    const students = activeStudents();
    const activities = activeActivities();
    const upcoming = [...activities]
      .filter(a => a.dueDate >= todayISO())
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 4);
    const studentIds = new Set(students.map(s => s.id));
    const recentOccurrences = [...(state.occurrences || [])]
      .filter(o => studentIds.has(o.studentId))
      .sort((a, b) => `${b.date}_${b.id}`.localeCompare(`${a.date}_${a.id}`))
      .slice(0, 5);
    const attention = attentionItems();
    setLastAttentionItems(attention);

    return `
      <section class="dashboard-hero">
        <div>
          <div class="eyebrow">ProfessorGest</div>
          <h1>${greeting()}, ${esc((state.teacher && state.teacher.name) || 'Professor(a)')}</h1>
          <p class="page-sub">${classes.length} turma(s) · ${students.length} aluno(s) sob acompanhamento</p>
        </div>
        <div class="dashboard-quick-actions">
          <button type="button" class="btn-primary" id="btnQuickRegisterTop">${ICONS.plus} Registrar ocorrência</button>
          <button type="button" class="btn-secondary" id="btnDashboardPlanning">${ICONS.calendar} Novo planejamento</button>
        </div>
      </section>

      <div class="dashboard-stats">
        <div class="card dashboard-stat"><div class="stat-icon">${ICONS.users}</div><div><strong>${classes.length}</strong><span>Turmas ativas</span></div></div>
        <div class="card dashboard-stat"><div class="stat-icon">${ICONS.user}</div><div><strong>${students.length}</strong><span>Alunos acompanhados</span></div></div>
        <div class="card dashboard-stat"><div class="stat-icon">${ICONS.bell}</div><div><strong>${(state.occurrences || []).length}</strong><span>Registros feitos</span></div></div>
        <div class="card dashboard-stat"><div class="stat-icon">${ICONS.calendar}</div><div><strong>${upcoming.length}</strong><span>Próximas atividades</span></div></div>
      </div>

      ${(!classes.length && !students.length) ? `
        <section class="dashboard-empty card">
          <div class="dashboard-empty-icon">${ICONS.sparkle}</div>
          <div class="dashboard-empty-copy">
            <div class="dashboard-empty-kicker">PRIMEIROS PASSOS</div>
            <h2>Comece pelo que você precisa acompanhar.</h2>
            <p>Crie uma turma e adicione alunos conforme surgir a necessidade. Você também pode registrar uma ocorrência e cadastrar o aluno durante o atendimento.</p>
            <div class="dashboard-empty-actions">
              <button type="button" class="btn-primary" id="btnEmptyNewClass">${ICONS.plus} Nova turma</button>
              <button type="button" class="btn-secondary" id="btnEmptyNewStudent">${ICONS.user} Adicionar aluno</button>
            </div>
          </div>
        </section>
      ` : ''}

      <div class="dashboard-grid">
        <section>
          <div class="section-heading"><div><h2>Próximos compromissos</h2><p>Planejamentos e atividades que chegam primeiro.</p></div><button type="button" class="btn-ghost btn-sm" id="btnDashboardCalendar">Ver calendário</button></div>
          <div class="card list-card">
            ${upcoming.map(a => `<div class="list-item"><div class="list-item-main" data-open-activity="${esc(a.id)}" role="button" tabindex="0">
              <div class="list-item-title">${esc(a.name)}</div><div class="list-item-sub">${esc(classNameOf(a.classId))} · ${fmtDate(a.dueDate)}</div>
            </div></div>`).join('') || emptyState('Nenhuma atividade próxima.', 'Crie atividades quando elas ajudarem a organizar sua rotina.')}
          </div>
        </section>

        <section>
          <div class="section-heading"><div><h2>Registros recentes</h2><p>O que aconteceu nos últimos acompanhamentos.</p></div><button type="button" class="btn-ghost btn-sm" id="btnDashboardOccurrences">Ver registros</button></div>
          <div class="card list-card">
            ${recentOccurrences.map(o => {
              const s = studentById(o.studentId);
              return `<div class="list-item"><div class="list-item-main" data-open-student="${esc(o.studentId)}" role="button" tabindex="0">
                <div class="list-item-title">${esc(s ? s.name : 'Aluno removido')}</div><div class="list-item-sub">${fmtDate(o.date)} · ${badgeFor(o.type)}</div>
              </div></div>`;
            }).join('') || emptyState('Nenhum registro recente.', 'Os acompanhamentos aparecerão aqui.')}
          </div>
        </section>
      </div>

      <section>
        <div class="section-heading"><div><h2>Minhas turmas</h2><p>Uma visão rápida do acompanhamento por turma.</p></div><button type="button" class="btn-ghost btn-sm" id="btnDashboardClasses">Ver turmas</button></div>
        <div class="grid grid-3 dashboard-class-grid">
          ${classes.map(c => {
            const st = classStats(c);
            return `<div class="card card-clickable dashboard-class-card" data-open-class="${esc(c.id)}" role="button" tabindex="0">
              <div class="list-item-title">${esc(c.name)}</div>
              <div class="list-item-sub">${st.alunos.length} aluno(s) acompanhado(s)</div>
              <div class="dashboard-class-meta"><span>${st.occCount} registro(s)</span>${st.upcoming ? `<span>Próxima: ${fmtDate(st.upcoming.dueDate)}</span>` : '<span>Sem atividade próxima</span>'}</div>
            </div>`;
          }).join('') || emptyState('Nenhuma turma cadastrada ainda.')}
        </div>
      </section>

      <section class="dashboard-attention-section">
        <div class="section-heading"><div><h2>Precisa de atenção</h2><p>Somente situações úteis para sua rotina aparecem aqui.</p></div></div>
        <div class="card" id="attentionCard">
          ${attention.length ? attention.map((it, i) => `<div class="attention-card" data-attention-idx="${esc(i)}"><span class="attention-dot ${it.tone}"></span><div><div class="attention-title">${esc(it.title)}</div><div class="attention-sub">${esc(it.sub)}</div></div></div>`).join('') : emptyState('Nada pendente de atenção.', 'Sua visão está limpa por enquanto.')}
        </div>
      </section>
    `;
  }

  function renderTurmas() {
    const state = getState();
    const ctx = getCtx();
    const showArchived = !!ctx.showArchivedClasses;
    const search = (ctx.classSearch || '').trim().toLowerCase();
    const source = showArchived ? state.classes : activeClasses();
    const list = source.filter(c => !search || c.name.toLowerCase().includes(search));
    return `
      <div class="page-head">
        <div><h1>Turmas</h1><div class="page-sub">${activeClasses().length} turma(s) ativa(s)</div></div>
        <div class="page-actions"><button type="button" class="btn-ghost btn-sm" id="btnToggleArchivedClasses">${showArchived ? 'Ocultar arquivadas' : 'Mostrar arquivadas'}</button><button type="button" class="btn-primary" id="btnNewClass">${ICONS.plus} Nova turma</button></div>
      </div>
      <div class="filter-bar filter-bar-clean"><div class="search-bar"><input class="form-input input-search" id="classSearchInput" placeholder="Pesquisar turma..." value="${esc(ctx.classSearch || '')}"></div></div>
      <div class="grid grid-3">
        ${list.map(c => {
          const st = classStats(c);
          return `<div class="card">
            <div class="row-between"><div class="list-item-main" data-open-class="${esc(c.id)}" role="button" tabindex="0"><div class="list-item-title">${esc(c.name)} ${c.archived ? '<span class="badge badge-gray">Arquivada</span>' : ''}</div><div class="list-item-sub">${st.alunos.length} aluno(s) · ${st.occCount} registro(s)</div></div>
              <div class="list-item-actions"><button type="button" class="btn-icon" data-edit-class="${esc(c.id)}" aria-label="Editar turma">${ICONS.edit}</button><button type="button" class="btn-icon" data-dup-class="${esc(c.id)}" aria-label="Duplicar turma">${ICONS.copy}</button><button type="button" class="btn-icon" data-archive-class="${esc(c.id)}" aria-label="Arquivar turma">${ICONS.archive}</button><button type="button" class="btn-icon danger" data-del-class="${esc(c.id)}" aria-label="Excluir turma">${ICONS.trash}</button></div>
            </div>
            <div class="class-card-meta">${st.upcoming ? `<span>Próxima atividade: ${fmtDate(st.upcoming.dueDate)}</span>` : '<span>Nenhuma atividade próxima</span>'}</div>
          </div>`;
        }).join('') || emptyState('Nenhuma turma cadastrada.', 'Clique em “Nova turma” para começar.')}
      </div>`;
  }

  return { renderDashboard, renderTurmas };
}
