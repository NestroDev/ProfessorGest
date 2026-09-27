export function createReportRenderers(deps) {
  const {
    getState, getCtx, esc, classNameOf, studentById, studentsOf, activitiesOf, occurrencesOf,
    getDeliveryState, todayISO, addDays, fmtDate, emptyState, timelineEntriesHTML,
    studentTimelineEntries, occurrenceTypes, ICONS
  } = deps;

  function renderRelatoriosHub() {
    return `
      <div class="page-head"><div><h1>Relatórios</h1><div class="page-sub">Escolha o tipo de relatório que você precisa preparar.</div></div></div>
      <div class="report-hub-grid">
        <section class="card report-hub-primary">
          <div class="report-hub-icon">${ICONS.user}</div>
          <div class="list-item-title">Relatório do aluno</div>
          <p class="muted">Resumo, atividades, ocorrências, observações e linha do tempo de um aluno.</p>
          <button type="button" class="btn-primary" id="btnOpenIndividualConfig">${ICONS.report} Gerar relatório do aluno</button>
        </section>
        <section class="card report-hub-primary">
          <div class="report-hub-icon">${ICONS.users}</div>
          <div class="list-item-title">Relatório da turma</div>
          <p class="muted">Resumo da turma, entregas, pendências e registros de acompanhamento.</p>
          <button type="button" class="btn-primary" id="btnOpenClassConfig">${ICONS.report} Gerar relatório da turma</button>
        </section>
      </div>
      <section class="card report-hub-secondary">
        <div><strong>Outras visões para imprimir</strong><span>Você pode abrir as listas, aplicar filtros e usar a impressão ou exportação disponíveis em cada tela.</span></div>
        <div class="report-hub-secondary-actions">
          <button type="button" class="btn-secondary" id="btnGoAtividadesPrint">${ICONS.clipboard} Atividades</button>
          <button type="button" class="btn-secondary" id="btnGoOcorrenciasPrint">${ICONS.bell} Registros</button>
        </div>
      </section>
    `;
  }

  function renderRelatorioIndividual() {
    const s = studentById(getCtx().reportStudentId);
    if (!s) return emptyState('Selecione um aluno para gerar o relatório.');
    const from = getCtx().reportFrom || addDays(-60);
    const to = getCtx().reportTo || todayISO();
    const opts = getCtx().reportOpts || { resumo:true, atividades:true, entregas:true, naoEntregas:true, ocorrencias:true, observacoes:true, linha:true };

    const acts = activitiesOf(s.classId)
      .filter(a => a.dueDate >= from && a.dueDate <= to)
      .sort((a,b) => a.dueDate.localeCompare(b.dueDate));
    const occ = occurrencesOf(s.id)
      .filter(o => o.date >= from && o.date <= to)
      .sort((a,b) => b.date.localeCompare(a.date));
    const obs = (s.observations || [])
      .filter(o => o.date >= from && o.date <= to)
      .sort((a,b) => b.date.localeCompare(a.date));
    const delivered = acts.filter(a => getDeliveryState(a, s.id) === 'delivered');
    const notDelivered = acts.filter(a => getDeliveryState(a, s.id) === 'not_delivered');
    const pending = acts.filter(a => getDeliveryState(a, s.id) === 'pending');
    const entries = studentTimelineEntries(s).filter(e => e.date >= from && e.date <= to);

    const completionPct = acts.length ? Math.round((delivered.length / acts.length) * 100) : 0;

    return `
      <div class="row-between no-print" style="margin-bottom:16px;">
        <button type="button" class="btn-secondary btn-sm" id="btnBack">${ICONS.back} Voltar</button>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn-secondary btn-sm" id="btnEditReportConfig">${ICONS.edit} Alterar configuração</button>
          <button type="button" class="btn-secondary btn-sm" id="btnPrintReport">${ICONS.print} Imprimir</button>
          <button type="button" class="btn-primary btn-sm" id="btnExportPdfReport">${ICONS.pdf} Exportar PDF</button>
        </div>
      </div>

      <div id="reportPrintArea">
        <div class="report-page">
          <div class="report-masthead">
            <div class="rm-brand-wrap"><img class="rm-logo" src="logo.svg?v=21" alt=""><div class="rm-brand">Professor<em>Gest</em></div></div>
            <div class="rm-meta">
              Professor(a): ${esc((getState().teacher && getState().teacher.name) || '—')}<br>
              ${getState().teacher && getState().teacher.school ? `Escola: ${esc(getState().teacher.school)}<br>` : ''}
              ${getState().teacher && getState().teacher.subject ? `Área: ${esc(getState().teacher.subject)}<br>` : ''}
              Gerado em ${fmtDate(todayISO())}
            </div>
          </div>

          <div class="report-title">Relatório individual do aluno</div>
          <div class="report-sub">${esc(s.name)} · ${esc(classNameOf(s.classId))} · período de ${fmtDate(from)} a ${fmtDate(to)}</div>

          ${opts.resumo ? `
          <div class="report-section-title">Resumo</div>
          <div class="report-stat-grid">
            <div class="report-stat"><div class="rv">${acts.length}</div><div class="rl">Atividades</div></div>
            <div class="report-stat"><div class="rv">${delivered.length}</div><div class="rl">Entregas</div></div>
            <div class="report-stat"><div class="rv">${notDelivered.length}</div><div class="rl">Não entregues</div></div>
            <div class="report-stat"><div class="rv">${completionPct}%</div><div class="rl">Taxa de entrega</div></div>
          </div>` : ''}

          ${opts.atividades ? `
          <div class="report-section-title">Atividades</div>
          <table class="report-table">
            <thead><tr><th>Atividade</th><th>Prazo</th><th>Situação</th></tr></thead>
            <tbody>
              ${acts.map(a => {
                const st = getDeliveryState(a, s.id);
                const label = st === 'delivered' ? 'Entregou' : st === 'not_delivered' ? 'Não entregou' : 'Não verificado';
                return `<tr><td>${esc(a.name)}</td><td>${fmtDate(a.dueDate)}</td><td>${label}</td></tr>`;
              }).join('') || `<tr><td colspan="3">Nenhuma atividade no período.</td></tr>`}
            </tbody>
          </table>` : ''}

          ${opts.entregas ? `
          <div class="report-section-title">Entregas confirmadas</div>
          <table class="report-table">
            <thead><tr><th>Atividade</th><th>Data do prazo</th><th>Situação</th></tr></thead>
            <tbody>
              ${delivered.map(a => `<tr><td>${esc(a.name)}</td><td>${fmtDate(a.dueDate)}</td><td>Entregou</td></tr>`).join('') ||
                `<tr><td colspan="3">Nenhuma entrega confirmada no período.</td></tr>`}
            </tbody>
          </table>` : ''}

          ${opts.naoEntregas ? `
          <div class="report-section-title">Pendências de entrega</div>
          <table class="report-table">
            <thead><tr><th>Atividade</th><th>Prazo</th><th>Situação</th></tr></thead>
            <tbody>
              ${[...notDelivered.map(a => ({a,label:'Não entregou'})), ...pending.map(a => ({a,label:'Não verificado'}))]
                .map(({a,label}) => `<tr><td>${esc(a.name)}</td><td>${fmtDate(a.dueDate)}</td><td>${label}</td></tr>`).join('') ||
                `<tr><td colspan="3">Nenhuma pendência encontrada no período.</td></tr>`}
            </tbody>
          </table>` : ''}

          ${opts.ocorrencias ? `
          <div class="report-section-title">Ocorrências e registros</div>
          <table class="report-table">
            <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th></tr></thead>
            <tbody>
              ${occ.map(o => `<tr><td>${fmtDate(o.date)}</td><td>${esc(occurrenceTypes.find(t => t.key === o.type)?.label || o.type)}</td><td>${esc(o.description || '—')}</td></tr>`).join('') ||
                `<tr><td colspan="3">Nenhuma ocorrência no período.</td></tr>`}
            </tbody>
          </table>` : ''}

          ${opts.observacoes ? `
          <div class="report-section-title">Observações pedagógicas</div>
          ${s.notes ? `<p style="font-size:12.5px;line-height:1.55;margin-bottom:8px;white-space:pre-wrap;">${esc(s.notes)}</p>` : ''}
          <table class="report-table">
            <thead><tr><th>Data</th><th>Observação</th></tr></thead>
            <tbody>
              ${obs.map(o => `<tr><td>${fmtDate(o.date)}</td><td>${esc(o.text)}</td></tr>`).join('') ||
                `<tr><td colspan="2">Nenhuma observação datada no período.</td></tr>`}
            </tbody>
          </table>` : ''}

          ${opts.linha ? `
          <div class="report-section-title">Linha do tempo</div>
          <div class="card report-timeline" style="border-radius:10px;">${entries.length ? timelineEntriesHTML(entries) : emptyState('Nenhum evento no período.')}</div>` : ''}

          <div class="report-section-title">Síntese final</div>
          <div class="report-synthesis">
            <textarea id="reportSynthesisText" placeholder="Escreva aqui uma síntese pedagógica final sobre o período...">${esc(getCtx().reportSynthesis || '')}</textarea>
          </div>

          <div class="report-signature">
            <div class="sig-line">Assinatura do professor(a)</div>
            <div class="sig-line">Data: ${fmtDate(todayISO())}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderRelatorioTurma() {
    const c = getState().classes.find(x => x.id === getCtx().classReportId);
    if (!c) return emptyState('Selecione uma turma para gerar o relatório.');
    const from = getCtx().classReportFrom, to = getCtx().classReportTo;
    const alunos = studentsOf(c.id);
    const acts = activitiesOf(c.id).filter(a => a.dueDate >= from && a.dueDate <= to);
    const studentIds = new Set(alunos.map(s => s.id));
    const occ = getState().occurrences.filter(o => studentIds.has(o.studentId) && o.date >= from && o.date <= to);
    const participacao = occ.filter(o => o.type === 'participou' || o.type === 'bom_comportamento').length;
    let totalDelivered = 0, totalPossible = 0;
    const rows = alunos.map(s => {
      let d = 0, pend = 0;
      acts.forEach(a => { const st = getDeliveryState(a, s.id); totalPossible++; if (st === 'delivered') { d++; totalDelivered++; } else if (st === 'not_delivered' || a.dueDate < todayISO()) pend++; });
      const regs = occ.filter(o => o.studentId === s.id).length;
      return { name: s.name, d, pend, regs };
    });
    const pct = totalPossible ? Math.round((totalDelivered / totalPossible) * 100) : 0;

    return `
      <div class="row-between no-print" style="margin-bottom:16px;">
        <button type="button" class="btn-secondary btn-sm" id="btnBack">${ICONS.back} Voltar</button>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn-secondary btn-sm" id="btnEditClassReportConfig">${ICONS.edit} Alterar configuração</button>
          <button type="button" class="btn-secondary btn-sm" id="btnPrintReport">${ICONS.print} Imprimir</button>
          <button type="button" class="btn-primary btn-sm" id="btnExportPdfReport">${ICONS.pdf} Exportar PDF</button>
        </div>
      </div>
      <div id="reportPrintArea">
      <div class="report-page">
        <div class="report-masthead">
          <div class="rm-brand">Professor<em>Gest</em></div>
          <div class="rm-meta">Professor(a): ${esc((getState().teacher && getState().teacher.name) || '—')}<br>${getState().teacher && getState().teacher.school ? `Escola: ${esc(getState().teacher.school)}<br>` : ''}${getState().teacher && getState().teacher.subject ? `Área: ${esc(getState().teacher.subject)}<br>` : ''}Gerado em ${fmtDate(todayISO())}</div>
        </div>
        <div class="report-title">Relatório da turma</div>
        <div class="report-sub">${esc(c.name)} · período de ${fmtDate(from)} a ${fmtDate(to)}</div>

        <div class="report-section-title">Resumo</div>
        <div class="report-stat-grid">
          <div class="report-stat"><div class="rv">${alunos.length}</div><div class="rl">Alunos</div></div>
          <div class="report-stat"><div class="rv">${acts.length}</div><div class="rl">Atividades</div></div>
          <div class="report-stat"><div class="rv">${pct}%</div><div class="rl">Entrega</div></div>
          <div class="report-stat"><div class="rv">${occ.length}</div><div class="rl">Ocorrências</div></div>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:6px;">${participacao} registro(s) positivo(s) de participação/comportamento no período.</p>

        <div class="report-section-title">Alunos</div>
        <table class="report-table"><thead><tr><th>Aluno</th><th>Entregas</th><th>Pendências</th><th>Registros</th></tr></thead><tbody>
          ${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.d}/${acts.length}</td><td>${r.pend}</td><td>${r.regs}</td></tr>`).join('') || `<tr><td colspan="4">Nenhum aluno nesta turma.</td></tr>`}
        </tbody></table>

        <div class="report-signature">
          <div class="sig-line">Assinatura do professor(a)</div>
          <div class="sig-line">Data: ${fmtDate(todayISO())}</div>
        </div>
      </div>
      </div>
    `;
  }

  return { renderRelatoriosHub, renderRelatorioIndividual, renderRelatorioTurma };
}
