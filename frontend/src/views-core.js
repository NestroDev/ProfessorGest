import { OCCURRENCE_TYPES } from './grade-recommendation.js';

export function createCoreViewRenderers(api) {
  const {
    getState, getCtx, setLastAttentionItems,
    activeStudents, activeActivities, activeClasses,
    classStats, studentById, classNameOf, assignmentsOf = () => [], schoolById = () => null,
    attentionItems, todayISO, greeting, esc, fmtDate,
    emptyState, badgeFor, ICONS, searchFieldHTML, driveLinkForCurrentProject = () => null, getDriveAvailable = () => true, getDriveActionPending = () => false, getDriveSyncPending = () => false
  } = api;

  function polaritySplitHTML(occurrences) {
    const polarityOf = o => OCCURRENCE_TYPES.find(t => t.key === o.type)?.polarity || 'neutra';
    const positive = occurrences.filter(o => polarityOf(o) === 'positiva').length;
    const negative = occurrences.filter(o => polarityOf(o) === 'negativa').length;
    if (!positive && !negative) return '';
    return `<span class="stat-split"><span class="positive">${ICONS.up || ''}${positive} ${positive === 1 ? 'positivo' : 'positivos'}</span><span class="negative">${ICONS.down || ''}${negative} ${negative === 1 ? 'negativo' : 'negativos'}</span></span>`;
  }

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
          <div class="eyebrow">${esc(new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
          <h1>${greeting()}, ${esc((state.teacher && state.teacher.name) || 'Professor(a)')}</h1>
          <p class="page-sub">${(state.schools||[]).length} ${(state.schools||[]).length === 1 ? 'escola' : 'escolas'} · ${(state.assignments||[]).length} ${(state.assignments||[]).length === 1 ? 'disciplina' : 'disciplinas'} · ${classes.length} ${classes.length === 1 ? 'turma' : 'turmas'}</p>
        </div>
        <div class="dashboard-quick-actions">
          <button type="button" class="btn-primary" id="btnQuickRegisterTop">${ICONS.plus} Registrar ocorrência</button>
          <button type="button" class="btn-secondary" id="btnDashboardPlanning">${ICONS.calendar} Novo planejamento</button>
        </div>
      </section>

      ${!getDriveAvailable() ? '' : driveLinkForCurrentProject() && getDriveSyncPending() ? `
      <section class="dashboard-drive-promo card">
        <div class="dashboard-drive-promo-icon">${ICONS.cloud}</div>
        <div class="dashboard-drive-promo-copy">
          <strong>Há alterações pendentes no Google Drive</strong>
          <span>O projeto já está salvo neste dispositivo. Sincronize quando quiser enviar esta versão para a nuvem.</span>
        </div>
        <button type="button" class="btn-secondary" id="btnDashboardDrive" ${getDriveActionPending() ? 'disabled aria-busy="true"' : ''}>${getDriveActionPending() ? ICONS.cloud + ' Sincronizando…' : ICONS.cloud + ' Sincronizar agora'}</button>
      </section>` : (!driveLinkForCurrentProject() ? `
      <section class="dashboard-drive-promo card">
        <div class="dashboard-drive-promo-icon">${ICONS.cloud}</div>
        <div class="dashboard-drive-promo-copy">
          <strong>Proteja seu projeto com o Google Drive</strong>
          <span>Envie este projeto para a nuvem quando quiser continuar seu trabalho em outro computador ou celular.</span>
        </div>
        <button type="button" class="btn-secondary" id="btnDashboardDrive" ${getDriveActionPending() ? 'disabled aria-busy="true"' : ''}>${getDriveActionPending() ? ICONS.cloud + ' Sincronizando…' : ICONS.cloud + ' Enviar ao Google Drive'}</button>
      </section>` : '')}

      <div class="dashboard-stats">
        <div class="card dashboard-stat"><div class="stat-icon">${ICONS.users}</div><div><strong>${classes.length}</strong><span>Turmas ativas</span></div></div><div class="card dashboard-stat"><div class="stat-icon">${ICONS.school}</div><div><strong>${(state.schools||[]).length}</strong><span>Escolas</span></div></div>
        <div class="card dashboard-stat"><div class="stat-icon">${ICONS.user}</div><div><strong>${students.length}</strong><span>Alunos acompanhados</span></div></div>
        <div class="card dashboard-stat"><div class="stat-icon">${ICONS.bell}</div><div><strong>${(state.occurrences || []).length}</strong><span>Registros feitos</span>${polaritySplitHTML(state.occurrences || [])}</div></div>
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
              <div><div class="list-item-title">${esc(a.name)}</div><div class="list-item-sub">${esc(classNameOf(a.classId))} · ${fmtDate(a.dueDate)}</div></div>
            </div></div>`).join('') || emptyState('Nenhuma atividade próxima.', 'Crie atividades quando elas ajudarem a organizar sua rotina.')}
          </div>
        </section>

        <section>
          <div class="section-heading"><div><h2>Registros recentes</h2><p>O que aconteceu nos últimos acompanhamentos.</p></div><button type="button" class="btn-ghost btn-sm" id="btnDashboardOccurrences">Ver registros</button></div>
          <div class="card list-card">
            ${recentOccurrences.map(o => {
              const s = studentById(o.studentId);
              return `<div class="list-item"><div class="list-item-main" data-open-student="${esc(o.studentId)}" role="button" tabindex="0">
                <div><div class="list-item-title">${esc(s ? s.name : 'Aluno removido')}</div><div class="list-item-sub">${fmtDate(o.date)} ${badgeFor(o.type)}</div></div>
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
              <div class="list-item-sub">${st.alunos.length} ${st.alunos.length === 1 ? 'aluno' : 'alunos'} acompanhado${st.alunos.length === 1 ? '' : 's'}</div>
              <div class="dashboard-class-meta"><span>${st.occCount} ${st.occCount === 1 ? 'registro' : 'registros'}</span>${st.upcoming ? `<span>Próxima: ${fmtDate(st.upcoming.dueDate)}</span>` : '<span>Sem atividade próxima</span>'}</div>
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
    const state=getState(),ctx=getCtx(),showArchived=!!ctx.showArchivedClasses,search=(ctx.classSearch||'').trim().toLowerCase(),componentFilter=ctx.classComponentFilter||'',schoolFilter=ctx.classSchoolFilter||'',yearFilter=ctx.classYearFilter||'';
    const source=showArchived?state.classes:activeClasses(state);
    const components=[...new Set((state.assignments||[]).map(a=>a?.subject).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const schools=(state.schools||[]).map(s=>s.name).filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const years=[...new Set(state.classes.map(c=>c?.year||c?.ded?.year).filter(Boolean))].sort((a,b)=>String(b).localeCompare(String(a)));
    const list=source.filter(c=>{const school=schoolById(c.schoolId)||state.schools?.find(s=>s.name===c?.ded?.schoolName);const assigns=assignmentsOf(c.id,state);const subjects=assigns.map(a=>a.subject);const hay=[c.name,school?.name,c.year,c.ded?.year,...subjects].filter(Boolean).join(' ').toLowerCase();return(!search||hay.includes(search))&&(!componentFilter||subjects.includes(componentFilter))&&(!schoolFilter||school?.name===schoolFilter)&&(!yearFilter||String(c.year||c.ded?.year||'')===yearFilter);});
    return `<div class="page-head"><div><h1>Turmas</h1><div class="page-sub">${activeClasses(state).length} ${activeClasses(state).length === 1 ? 'turma ativa' : 'turmas ativas'} · ${(state.assignments||[]).length} ${(state.assignments||[]).length === 1 ? 'disciplina' : 'disciplinas'}</div></div><div class="page-actions"><button type="button" class="btn-ghost btn-sm" id="btnToggleArchivedClasses">${showArchived?'Ocultar arquivadas':'Mostrar arquivadas'}</button><button type="button" class="btn-primary" id="btnNewClass">${ICONS.plus} Adicionar turma</button></div></div>
      <div class="filter-bar filter-bar-clean class-filter-bar">${searchFieldHTML('classSearchInput', 'Pesquisar turma, escola ou disciplina…', ctx.classSearch || '')}${components.length?`<select class="form-select filter-select" id="classComponentFilter"><option value="">Todas as disciplinas</option>${components.map(v=>`<option value="${esc(v)}" ${v===componentFilter?'selected':''}>${esc(v)}</option>`).join('')}</select>`:''}${schools.length?`<select class="form-select filter-select" id="classSchoolFilter"><option value="">Todas as escolas</option>${schools.map(v=>`<option value="${esc(v)}" ${v===schoolFilter?'selected':''}>${esc(v)}</option>`).join('')}</select>`:''}${years.length?`<select class="form-select filter-select filter-select-sm" id="classYearFilter"><option value="">Todos os anos</option>${years.map(v=>`<option value="${esc(v)}" ${v===yearFilter?'selected':''}>${esc(v)}</option>`).join('')}</select>`:''}</div>
      <div class="grid grid-3">${list.map(c=>{const st=classStats(c),school=schoolById(c.schoolId)||state.schools?.find(s=>s.name===c?.ded?.schoolName),assigns=assignmentsOf(c.id,state),subjects=assigns.map(a=>a.subject).filter(Boolean);const meta=[school?.name||'Escola não informada',c.year||c.ded?.year,c.shift||c.ded?.shift].filter(Boolean).join(' · ');return `<article class="card class-card${c.archived?' is-archived':''}"><div class="list-item-main class-card-open" data-open-class="${esc(c.id)}" role="button" tabindex="0"><div class="class-card-head"><div class="list-item-title class-card-name">${esc(c.name)}</div>${c.archived?'<span class="badge badge-gray">Arquivada</span>':''}</div><div class="class-card-school">${esc(meta)}</div><div class="class-card-numbers"><div><strong>${st.alunos.length}</strong><span>${st.alunos.length === 1 ? 'aluno' : 'alunos'}</span></div><div><strong>${st.occCount}</strong><span>${st.occCount === 1 ? 'registro' : 'registros'}</span></div></div>${subjects.length?`<div class="class-card-subjects">${subjects.map(v=>`<span class="badge badge-teal">${esc(v)}</span>`).join('')}</div>`:'<div class="class-card-empty">Nenhuma disciplina definida</div>'}</div><div class="class-card-footer"><span class="class-card-source">${c.ded?.classCode?`DED+ · ${esc(c.ded.classCode)}`:'Cadastro manual'}</span><div class="list-item-actions"><button type="button" class="btn-icon" data-edit-class="${esc(c.id)}" aria-label="Editar turma">${ICONS.edit}</button><button type="button" class="btn-icon" data-dup-class="${esc(c.id)}" aria-label="Duplicar turma">${ICONS.copy}</button><button type="button" class="btn-icon" data-archive-class="${esc(c.id)}" aria-label="${c.archived?'Reativar turma':'Arquivar turma'}">${ICONS.archive}</button><button type="button" class="btn-icon danger" data-del-class="${esc(c.id)}" aria-label="Excluir turma">${ICONS.trash}</button></div></div></article>`;}).join('')||emptyState('Nenhuma turma encontrada.','Ajuste os filtros ou adicione uma nova turma.')}</div>`;
  }

  function renderEscolas() {
    const state=getState(); const schools=Array.isArray(state.schools)?state.schools:[];
    return `<div class="page-head"><div><h1>Escolas</h1><div class="page-sub">Organize onde você atua e veja as disciplinas e turmas vinculadas.</div></div></div><div class="grid grid-2">${schools.map(school=>{const classes=state.classes.filter(c=>c.schoolId===school.id||c?.ded?.schoolName===school.name);const assignments=state.assignments.filter(a=>a.schoolId===school.id||classes.some(c=>c.id===a.classId));const subjects=[...new Set(assignments.map(a=>a.subject).filter(Boolean))];return `<section class="card school-card"><div class="row-between"><div class="school-card-head"><span class="school-card-icon" aria-hidden="true">${ICONS.school || ICONS.home}</span><div><div class="list-item-title school-card-name">${esc(school.name)}</div><div class="list-item-sub">${classes.length} ${classes.length === 1 ? 'turma' : 'turmas'} · ${subjects.length} ${subjects.length === 1 ? 'disciplina' : 'disciplinas'}</div></div></div></div><div class="class-card-meta">${school.code?`<span>Código ${esc(school.code)}</span>`:''}${school.sre?`<span>SRE ${esc(school.sre)}</span>`:''}</div><div class="class-card-subjects">${subjects.map(v=>`<span class="badge badge-teal">${esc(v)}</span>`).join('')||'<span class="muted">Nenhuma disciplina cadastrada</span>'}</div><div class="list-card compact-list">${classes.map(c=>`<div class="list-item"><div class="list-item-main" data-open-class="${esc(c.id)}" role="button" tabindex="0"><div class="list-item-title">${esc(c.name)}</div><div class="list-item-sub">${esc(c.year||'Ano não informado')} · ${esc(c.shift||'Turno não informado')}</div></div><span class="list-chevron" aria-hidden="true">›</span></div>`).join('')||emptyState('Nenhuma turma nesta escola.')}</div></section>`;}).join('')||emptyState('Nenhuma escola cadastrada.','As escolas serão criadas automaticamente ao importar dados do DED+.')}</div>`;
  }

  return { renderDashboard, renderTurmas, renderEscolas };

}
