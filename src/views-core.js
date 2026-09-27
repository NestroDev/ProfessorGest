export function createCoreViewRenderers(api) {
  const {
    getState, getCtx, setLastAttentionItems,
    activeStudents, activeActivities, activeClasses,
    classStats, activityStats, studentById, classNameOf,
    attentionItems, todayISO, greeting, esc, fmtDate,
    emptyState, progressBarHTML, badgeFor, ICONS
  } = api;

  function renderDashboard() {
    const state = getState();

  const totalAlunos = activeStudents().length;
  const upcoming = [...activeActivities()].filter(a => a.dueDate >= todayISO())
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
  const activeStudentIds = new Set(activeStudents().map(s => s.id));
  const recentOccurrences = [...state.occurrences].filter(o => activeStudentIds.has(o.studentId)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const pendCount = activeActivities().reduce((sum, a) => sum + activityStats(a).pending + activityStats(a).notDelivered, 0);
  const attention = attentionItems();
  setLastAttentionItems(attention);

  return `
    <div class="page-head">
      <div><h1>${greeting()}, ${esc((state.teacher && state.teacher.name) || 'Professor(a)')}</h1>
        <div class="page-sub">${activeClasses().length} turma(s) · ${totalAlunos} aluno(s) sob acompanhamento</div></div>
      <div class="page-actions"><button type="button" class="btn-primary" id="btnQuickRegisterTop">${ICONS.plus} Registro rápido</button></div>
    </div>

    <div class="grid grid-4" style="margin-bottom:26px;">
      <div class="card stat-card"><div class="stat-icon">${ICONS.users}</div><div class="stat-value">${activeClasses().length}</div><div class="stat-label">Minhas turmas</div></div>
      <div class="card stat-card"><div class="stat-icon">${ICONS.user}</div><div class="stat-value">${totalAlunos}</div><div class="stat-label">Alunos</div></div>
      <div class="card stat-card"><div class="stat-icon">${ICONS.clipboard}</div><div class="stat-value">${upcoming.length}</div><div class="stat-label">Atividades próximas</div></div>
      <div class="card stat-card"><div class="stat-icon">${ICONS.alert}</div><div class="stat-value">${pendCount}</div><div class="stat-label">Pendências abertas</div></div>
    </div>

    ${(!activeClasses().length && !totalAlunos && !state.activities.length) ? `
      <div class="dashboard-empty card">
        <div class="dashboard-empty-icon">${ICONS.sparkle}</div>
        <div class="dashboard-empty-copy">
          <div class="dashboard-empty-kicker">SEU ESPAÇO ESTÁ PRONTO</div>
          <h2>Comece pela sua primeira turma.</h2>
          <p>Cadastre a turma, adicione os alunos e o restante do painel ganha vida automaticamente.</p>
          <div class="dashboard-empty-actions">
            <button type="button" class="btn-primary" id="btnEmptyNewClass">${ICONS.plus} Nova turma</button>
            <button type="button" class="btn-secondary" id="btnEmptyNewStudent">${ICONS.user} Adicionar aluno</button>
          </div>
          <div class="dashboard-empty-steps" aria-label="Primeiros passos">
            <span class="dashboard-empty-step"><b>1</b> Crie uma turma</span>
            <span class="dashboard-empty-step"><b>2</b> Adicione os alunos</span>
            <span class="dashboard-empty-step"><b>3</b> Crie uma atividade</span>
          </div>
        </div>
      </div>
    ` : `
      <div class="section-title">Atenção</div>
      <div class="card" id="attentionCard">
        ${attention.length ? attention.map((it, i) => `
          <div class="attention-card" data-attention-idx="${esc(i)}">
            <span class="attention-dot ${it.tone}"></span>
            <div><div class="attention-title">${esc(it.title)}</div><div class="attention-sub">${esc(it.sub)}</div></div>
          </div>`).join('') : emptyState('Nenhuma situação pedindo atenção agora.', 'Tudo em dia por aqui.')}
      </div>
    `}

    <div class="row-between section-title"><span>Minhas turmas</span></div>
    <div class="grid grid-3">
      ${activeClasses().map(c => {
        const st = classStats(c);
        return `<div class="card card-clickable" data-open-class="${esc(c.id)}" role="button" tabindex="0">
          <div class="list-item-title">${esc(c.name)}</div>
          <div class="list-item-sub">${st.alunos.length} alunos · ${st.pend} pendência(s)</div>
          <div style="margin-top:10px;">${progressBarHTML(st.pct)}</div>
          <div class="list-item-sub" style="margin-top:5px;">${st.pct}% de entregas</div>
        </div>`;
      }).join('') || emptyState('Nenhuma turma cadastrada ainda.')}
    </div>

    <div class="grid grid-2" style="margin-top:6px;">
      <div>
        <div class="section-title">Próximas atividades</div>
        <div class="card list-card">
          ${upcoming.map(a => `
            <div class="list-item"><div class="list-item-main" data-open-activity="${esc(a.id)}" role="button" tabindex="0">
              <div class="list-item-title">${esc(a.name)}</div>
              <div class="list-item-sub">${esc(classNameOf(a.classId))} · entrega ${fmtDate(a.dueDate)}</div>
            </div></div>`).join('') || emptyState('Nenhuma atividade futura.')}
        </div>
      </div>
      <div>
        <div class="section-title">Registros recentes</div>
        <div class="card list-card">
          ${recentOccurrences.map(o => {
            const s = studentById(o.studentId);
            return `<div class="list-item"><div class="list-item-main" data-open-student="${esc(o.studentId)}">
              <div class="list-item-title">${esc(s ? s.name : 'Aluno removido')}</div>
              <div class="list-item-sub">${fmtDate(o.date)} · ${badgeFor(o.type)}</div>
            </div></div>`;
          }).join('') || emptyState('Nenhum registro recente.')}
        </div>
      </div>
    </div>
  `;
}

  function renderTurmas() {
    const state = getState();
    const ctx = getCtx();

  const showArchived = ctx.showArchivedClasses;
  const list = showArchived ? state.classes : activeClasses();
  return `
    <div class="page-head">
      <div><h1>Turmas</h1><div class="page-sub">${activeClasses().length} turma(s) ativa(s)</div></div>
      <div class="page-actions">
        <button type="button" class="btn-ghost btn-sm" id="btnToggleArchivedClasses">${showArchived ? 'Ocultar arquivadas' : 'Mostrar arquivadas'}</button>
        <button type="button" class="btn-primary" id="btnNewClass">${ICONS.plus} Nova turma</button>
      </div>
    </div>
    <div class="grid grid-3">
      ${list.map(c => {
        const st = classStats(c);
        return `<div class="card ${c.archived ? '' : ''}">
          <div class="row-between">
            <div class="list-item-main" data-open-class="${esc(c.id)}" role="button" tabindex="0">
              <div class="list-item-title">${esc(c.name)} ${c.archived ? '<span class="badge badge-gray">Arquivada</span>' : ''}</div>
              <div class="list-item-sub">${st.alunos.length} alunos · ${st.pend} pendência(s)</div>
            </div>
            <div class="list-item-actions">
              <button type="button" class="btn-icon" data-edit-class="${esc(c.id)}" aria-label="Editar turma">${ICONS.edit}</button>
              <button type="button" class="btn-icon" data-dup-class="${esc(c.id)}" aria-label="Duplicar turma">${ICONS.copy}</button>
              <button type="button" class="btn-icon" data-archive-class="${esc(c.id)}" aria-label="Arquivar turma">${ICONS.archive}</button>
              <button type="button" class="btn-icon danger" data-del-class="${esc(c.id)}" aria-label="Excluir turma">${ICONS.trash}</button>
            </div>
          </div>
          <div style="margin-top:10px;" data-open-class="${esc(c.id)}" role="button" tabindex="0">${progressBarHTML(st.pct)}</div>
          <div class="list-item-sub" style="margin-top:5px;" data-open-class="${esc(c.id)}" role="button" tabindex="0">
            ${st.pct}% de entregas ${st.upcoming ? `· próxima atividade ${fmtDate(st.upcoming.dueDate)}` : ''}
          </div>
        </div>`;
      }).join('') || emptyState('Nenhuma turma cadastrada.', 'Clique em "Nova turma" para começar.')}
    </div>
  `;
}

  return { renderDashboard, renderTurmas };
}
