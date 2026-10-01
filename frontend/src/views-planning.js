export function createPlanningViewRenderer(deps) {
  const {
    getState, getCtx, esc, fmtDate, classNameOf, assignmentNameOf = () => '', emptyState, ICONS, searchFieldHTML
  } = deps;

  function filteredPlans() {
    const ctx = getCtx();
    const term = (ctx.planningSearch || '').trim().toLowerCase();
    let list = Array.isArray(getState().plans) ? [...getState().plans] : [];
    if (ctx.planningClassFilter) list = list.filter(plan => plan.classId === ctx.planningClassFilter);
    if (ctx.planningFrom) list = list.filter(plan => plan.date >= ctx.planningFrom);
    if (ctx.planningTo) list = list.filter(plan => plan.date <= ctx.planningTo);
    if (term) {
      list = list.filter(plan => [plan.title, plan.content, plan.objectives, plan.methodology, plan.resources, plan.assessment, classNameOf(plan.classId)]
        .some(value => String(value || '').toLowerCase().includes(term)));
    }
    return list.sort((a, b) => b.date.localeCompare(a.date) || String(a.title).localeCompare(String(b.title)));
  }

  function planningCard(plan) {
    const text = plan.content || plan.objectives || plan.methodology || '';
    const completeness = [plan.content, plan.objectives, plan.methodology, plan.resources, plan.assessment].filter(Boolean).length;
    return `<article class="planning-card card">
      <div class="planning-card-head">
        <div>
          <div class="planning-card-date">${fmtDate(plan.date)} · ${esc(classNameOf(plan.classId))}${plan.assignmentId ? ` · ${esc(assignmentNameOf(plan.assignmentId))}` : ''}</div>
          <h2 class="planning-card-title">${esc(plan.title)}</h2>
        </div>
        <div class="planning-card-actions">
          <button type="button" class="btn-secondary btn-sm" data-view-plan="${esc(plan.id)}">Abrir planejamento</button>
          <button type="button" class="btn-icon" data-edit-plan="${esc(plan.id)}" aria-label="Editar planejamento">${ICONS.edit}</button>
          <button type="button" class="btn-icon" data-dup-plan="${esc(plan.id)}" aria-label="Duplicar planejamento">${ICONS.copy}</button>
          <button type="button" class="btn-icon danger" data-del-plan="${esc(plan.id)}" aria-label="Excluir planejamento">${ICONS.trash}</button>
        </div>
      </div>
      ${text ? `<p class="planning-card-summary">${esc(text)}</p>` : '<p class="planning-card-summary muted">Este planejamento ainda não tem um resumo preenchido.</p>'}
      <div class="planning-card-foot"><span>${completeness}/5 partes preenchidas</span><span>Editar ou abrir para ver os detalhes</span></div>
    </article>`;
  }

  function renderPlanejamento() {
    const state = getState();
    const ctx = getCtx();
    const plans = filteredPlans();
    return `
      <div class="page-head">
        <div><h1>Planejamento</h1><div class="page-sub">Prepare suas aulas, registre o que será trabalhado e consulte depois.</div></div>
        <div class="page-actions"><button type="button" class="btn-primary" id="btnNewPlan">${ICONS.plus} Novo planejamento</button></div>
      </div>
      <div class="filter-bar planning-filters filter-bar-clean">
        ${searchFieldHTML('planningSearchInput', 'Pesquisar planejamento...', ctx.planningSearch || '')}
        <select class="form-select" id="planningClassFilterSelect">
          <option value="">Todas as turmas</option>
          ${state.classes.filter(c => !c.archived).map(c => `<option value="${esc(c.id)}" ${ctx.planningClassFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
        <details class="filter-details ${ctx.planningFrom || ctx.planningTo ? 'has-value' : ''}">
          <summary>Período</summary>
          <div class="filter-details-panel filter-details-dates">
            <label class="filter-details-field"><span>De</span><input class="form-input planning-date-filter" id="planningFromInput" type="date" value="${esc(ctx.planningFrom || '')}"></label>
            <label class="filter-details-field"><span>Até</span><input class="form-input planning-date-filter" id="planningToInput" type="date" value="${esc(ctx.planningTo || '')}"></label>
          </div>
        </details>
      </div>
      <div class="planning-list">
        ${plans.map(planningCard).join('') || emptyState('Nenhum planejamento encontrado.', 'Crie o primeiro planejamento ou ajuste os filtros.')}
      </div>
    `;
  }

  return { renderPlanejamento, filteredPlans };
}
