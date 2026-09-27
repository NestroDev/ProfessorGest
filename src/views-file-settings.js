export function createFileSettingsRenderers(deps) {
  const {
    getState, esc, getDemoMode, getCurrentFileName, getIsDirty, ICONS,
    supportsFileShare, driveStatusTone, driveStatusText, driveBindingForCurrentProject,
    fmtDate, fmtDateTime, getThemeMode, getDevLogEntries
  } = deps;

  function renderArquivo() {
    if (getDemoMode()) {
      return `
        <div class="page-head"><div><h1>Demonstração</h1><div class="page-sub">Explore o ProfessorGest com dados de exemplo.</div></div><div class="page-actions"><button type="button" class="btn-primary" id="btnExitDemo">Criar meu arquivo</button></div></div>
        <div class="card demo-file-card">
          <div class="section-title" style="margin-top:0;">Ambiente de demonstração</div>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px;">Navegue pelas telas, abra alunos, veja atividades e experimente os relatórios. Este ambiente não substitui seu arquivo.</p>
          <div class="demo-feature-grid">
            <div><strong>2 turmas</strong><span>com alunos e atividades</span></div>
            <div><strong>5 alunos</strong><span>com histórico e registros</span></div>
            <div><strong>Relatórios</strong><span>individuais e por turma</span></div>
          </div>
          <button type="button" class="btn-secondary btn-block" id="btnExitDemoSecondary">Sair da demonstração</button>
        </div>
      `;
    }
    return `
      <div class="page-head"><div><h1>Arquivo</h1><div class="page-sub">Gerencie seu projeto local e seus arquivos .prof.</div></div><div class="page-actions"><button type="button" class="btn-secondary" id="btnNewFile">${ICONS.file} Novo arquivo</button></div></div>
      <div class="card" style="max-width:480px;">
        <div class="section-title" style="margin-top:0;">Arquivo atual</div>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:6px;display:flex;align-items:center;gap:7px;">
          ${ICONS.file}${getCurrentFileName() ? `<strong style="color:var(--text);">${esc(getCurrentFileName())}</strong>` : 'Novo projeto em branco — ainda não salvo.'}
        </p>
        <p class="topbar-status ${getIsDirty() ? 'dirty' : 'saved'}" style="margin-bottom:18px;font-size:12px;">
          <span class="status-dot"></span>${getIsDirty() ? 'Alterações não salvas' : 'Tudo salvo'}
        </p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button type="button" class="btn-secondary btn-block" id="btnOpenFile">${ICONS.folder} Abrir arquivo (.prof)</button>
          <button type="button" class="btn-primary btn-block" id="btnSaveFile">${ICONS.save} Salvar alterações</button>
          <button type="button" class="btn-secondary btn-block" id="btnExportProf">${ICONS.file} Exportar cópia .prof</button>
          <button type="button" class="btn-secondary btn-block" id="btnShareProf" ${supportsFileShare() ? '' : 'hidden'}>${ICONS.share || ICONS.copy} Compartilhar .prof</button>
          <button type="button" class="btn-secondary btn-block" id="btnExportCsv">${ICONS.copy} Exportar alunos (CSV)</button>
          <button type="button" class="btn-secondary btn-block" id="btnImportCsv">${ICONS.folder} Importar alunos (CSV)</button>
        </div>

        <div class="drive-card ${driveStatusTone()}">
          <div class="drive-card-head">
            <div class="drive-card-icon">${ICONS.cloud}</div>
            <div><strong>Google Drive</strong><span>${esc(driveStatusText())}</span></div>
          </div>
          <p>Use o mesmo arquivo no PC e no celular, sem trocar arquivos manualmente.</p>
          <div class="drive-card-actions">
            <button type="button" class="btn-secondary" id="btnDriveOpen">${ICONS.folder} Abrir do Drive</button>
            <button type="button" class="btn-primary" id="btnDriveAction">${driveBindingForCurrentProject() ? ICONS.cloud + ' Sincronizar agora' : ICONS.save + ' Salvar no Drive'}</button>
            ${driveBindingForCurrentProject() ? '<button type="button" class="btn-ghost" id="btnDriveDisconnect">Desvincular</button>' : ''}
          </div>
        </div>

        <p style="font-size:11.5px;color:var(--text-muted);margin-top:16px;">
          No computador, o ProfessorGest pode atualizar diretamente o mesmo arquivo <strong>.prof</strong>.
          Em navegadores móveis que não permitem escrever de volta no arquivo aberto, as alterações ficam salvas neste dispositivo; use <strong>Exportar cópia .prof</strong> para gerar um arquivo compartilhável.
        </p>
        <p style="font-size:11px;color:var(--text-muted);margin-top:10px;">
          Criado em ${fmtDate(getState().createdAt)} · Última alteração salva em ${fmtDateTime(getState().updatedAt)} · Formato versão ${getState().version || 1}
        </p>
      </div>
      <input type="file" id="csvInput" accept=".csv" style="display:none">
    `;
  }

  function renderConfiguracoes() {
    const mode = getThemeMode();
    return `
      <div class="page-head">
        <div><h1>Configurações</h1><div class="page-sub">Personalize sua experiência no ProfessorGest.</div></div>
      </div>

      <div class="grid grid-2">
        <section class="card">
          <div class="section-title" style="margin-top:0;">Perfil do professor</div>
          <p class="form-hint" style="margin-bottom:14px;">Estas informações ajudam a personalizar o dashboard e os relatórios.</p>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Nome do professor(a)</label>
              <input class="form-input" id="teacherNameInput" value="${esc((getState().teacher && getState().teacher.name) || '')}" placeholder="Ex.: Prof. João"></div>
            <div class="form-group"><label class="form-label">Disciplina / área</label>
              <input class="form-input" id="teacherSubjectInput" value="${esc((getState().teacher && getState().teacher.subject) || '')}" placeholder="Ex.: Matemática"></div>
          </div>
          <div class="form-group"><label class="form-label">Escola / instituição</label>
            <input class="form-input" id="teacherSchoolInput" value="${esc((getState().teacher && getState().teacher.school) || '')}" placeholder="Ex.: Escola Municipal Aurora"></div>
          <button type="button" class="btn-primary btn-sm" id="btnSaveTeacherName">Salvar alterações</button>
        </section>

        <section class="card">
          <div class="section-title" style="margin-top:0;">Sincronização</div>
          <p class="form-hint" style="margin-bottom:12px;">O Google Drive é opcional. Quando conectado, o arquivo atual pode ser usado no computador e no celular.</p>
          <div class="drive-settings-status ${driveStatusTone()}">
            <span class="drive-settings-icon">${ICONS.cloud}</span>
            <div><strong>${esc(driveStatusText())}</strong><span>${driveBindingForCurrentProject() ? `Arquivo: ${esc(driveBindingForCurrentProject().name || getCurrentFileName() || 'Projeto')}` : 'Você pode conectar quando quiser.'}</span></div>
          </div>
          <div class="form-actions" style="margin-top:14px;">
            <button type="button" class="btn-secondary" id="btnDriveOpenSettings">${ICONS.folder} Abrir do Drive</button>
            <button type="button" class="btn-primary" id="btnDriveActionSettings">${driveBindingForCurrentProject() ? ICONS.cloud + ' Sincronizar' : ICONS.save + ' Salvar no Drive'}</button>
          </div>
          ${driveBindingForCurrentProject() ? '<button type="button" class="btn-ghost" id="btnDriveDisconnectSettings" style="margin-top:8px;">Desvincular deste projeto</button>' : ''}
        </section>

        <section class="card">
          <div class="section-title" style="margin-top:0;">Diagnóstico técnico</div>
          <p class="form-hint" style="margin-bottom:12px;">Somente erros JavaScript, falhas de leitura/gravação e problemas de importação/exportação são registrados localmente neste dispositivo. O log não é enviado para um servidor.</p>
          <p id="devLogSummary" class="form-hint" style="margin-bottom:12px;">${getDevLogEntries().length} erro(s) registrado(s).</p>
          <div class="form-actions">
            <button type="button" class="btn-secondary" id="btnExportDevLog">${ICONS.file} Baixar log técnico</button>
            <button type="button" class="btn-ghost" id="btnClearDevLog">Limpar log</button>
          </div>
        </section>

        <section class="card">
          <div class="section-title" style="margin-top:0;">Aparência</div>
          <p class="form-hint" style="margin-bottom:4px;">Escolha como o ProfessorGest deve aparecer neste dispositivo.</p>
          <div class="theme-setting-grid">
            <button type="button" class="theme-option ${mode === 'light' ? 'active' : ''}" data-theme-mode="light"><div class="theme-preview light"></div><strong>Claro</strong><span>Visual leve e luminoso.</span></button>
            <button type="button" class="theme-option ${mode === 'dark' ? 'active' : ''}" data-theme-mode="dark"><div class="theme-preview dark"></div><strong>Escuro</strong><span>Confortável para ambientes com pouca luz.</span></button>
            <button type="button" class="theme-option ${mode === 'system' ? 'active' : ''}" data-theme-mode="system"><div class="theme-preview system"></div><strong>Sistema</strong><span>Segue a preferência do dispositivo.</span></button>
          </div>
        </section>
      </div>
    `;
  }

  return { renderArquivo, renderConfiguracoes };
}
