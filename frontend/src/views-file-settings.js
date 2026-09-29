export function createFileSettingsRenderers(deps) {
  const {
    getState, esc, getDemoMode, getCurrentFileName, getIsDirty, ICONS,
    supportsFileShare, driveStatusTone, driveStatusText, driveBindingForCurrentProject,
    fmtDate, fmtDateTime, getThemeMode, getDevLogEntries, getProjectBackups = () => []
  } = deps;

  function renderArquivo() {
    if (getDemoMode()) {
      return `
        <div class="page-head"><div><h1>Demonstração</h1><div class="page-sub">Explore o ProfessorGest com dados de exemplo.</div></div><div class="page-actions"><button type="button" class="btn-primary" id="btnExitDemo">Criar meu arquivo</button></div></div>
        <div class="card demo-file-card">
          <div class="section-title section-title-first">Ambiente de demonstração</div>
          <p class="settings-lead">Navegue pelas telas, abra alunos, veja atividades e experimente os relatórios. Este ambiente não substitui seu arquivo.</p>
          <div class="demo-feature-grid">
            <div><strong>2 turmas</strong><span>com alunos e atividades</span></div>
            <div><strong>5 alunos</strong><span>com histórico e registros</span></div>
            <div><strong>Relatórios</strong><span>individuais e por turma</span></div>
          </div>
          <button type="button" class="btn-secondary btn-block" id="btnExitDemoSecondary">Sair da demonstração</button>
        </div>
      `;
    }
    const backups = getProjectBackups();
    return `
      <div class="page-head"><div><h1>Arquivos</h1><div class="page-sub">Abra, salve e proteja seu trabalho.</div></div><div class="page-actions"><button type="button" class="btn-secondary" id="btnNewFile">${ICONS.file} Novo arquivo</button><button type="button" class="btn-ghost" id="btnCloseFile">${ICONS.x} Fechar arquivo</button></div></div>

      <section class="file-workspace card">
        <div class="file-workspace-head">
          <div>
            <div class="eyebrow">ARQUIVO ATUAL</div>
            <div class="file-current-name">${ICONS.file}${getCurrentFileName() ? `<strong>${esc(getCurrentFileName())}</strong>` : '<strong>Novo projeto</strong>'}</div>
            <div class="file-current-status ${getIsDirty() ? 'dirty' : 'saved'}"><span class="status-dot"></span>${getIsDirty() ? 'Alterações não salvas' : 'Tudo salvo'}</div>
          </div>
          <div class="file-primary-actions">
            <button type="button" class="btn-secondary" id="btnOpenFile">${ICONS.folder} Abrir arquivo</button>
            <button type="button" class="btn-primary" id="btnSaveFile">${ICONS.save} Salvar</button>
          </div>
        </div>
      </section>

      <div class="file-tools-grid">
        <section class="card file-tool-card">
          <div class="file-tool-icon">${ICONS.save}</div>
          <div class="file-tool-copy"><strong>Cópias de segurança</strong><span>${backups.length ? `Última cópia: ${fmtDateTime(backups[0].savedAt)}` : 'Proteção automática ativada'}</span><p>O ProfessorGest guarda cópias recentes neste dispositivo para ajudar a recuperar seu trabalho.</p></div>
          <button type="button" class="btn-secondary" id="btnOpenBackups">${ICONS.folder} Ver cópias</button>
        </section>

        <section class="card file-tool-card ${driveStatusTone()}">
          <div class="file-tool-icon">${ICONS.cloud}</div>
          <div class="file-tool-copy"><strong>Google Drive</strong><span>${esc(driveStatusText())}</span><p>Use o mesmo projeto no computador e no celular.</p></div>
          <div class="file-tool-actions">
            <button type="button" class="btn-secondary" id="btnDriveOpen">${ICONS.folder} Abrir do Drive</button>
            <button type="button" class="btn-primary" id="btnDriveAction">${driveBindingForCurrentProject() ? ICONS.cloud + ' Sincronizar agora' : ICONS.save + ' Salvar no Drive'}</button>
            ${driveBindingForCurrentProject() ? '<button type="button" class="btn-ghost" id="btnDriveDisconnect">Desvincular</button>' : ''}
          </div>
        </section>
      </div>

      <details class="file-more-options">
        <summary><span>Mais opções do arquivo</span><span class="details-hint">Exportar, compartilhar e importar</span></summary>
        <div class="file-more-grid">
          <button type="button" class="btn-secondary" id="btnExportProf">${ICONS.file} Exportar cópia .prof</button>
          <button type="button" class="btn-secondary" id="btnShareProf" ${supportsFileShare() ? '' : 'hidden'}>${ICONS.share || ICONS.copy} Compartilhar .prof</button>
          <button type="button" class="btn-secondary" id="btnExportCsv">${ICONS.copy} Exportar alunos (CSV)</button>
          <button type="button" class="btn-secondary" id="btnImportCsv">${ICONS.folder} Importar alunos (CSV)</button>
        </div>
        <p class="file-note">Em alguns celulares, o arquivo aberto não pode ser atualizado diretamente. Nesses casos, suas alterações continuam protegidas neste dispositivo; use <strong>Exportar cópia .prof</strong> para gerar o arquivo atualizado.</p>
      </details>

      <p class="file-meta-line">Criado em ${fmtDate(getState().createdAt)} · Última alteração: ${fmtDateTime(getState().updatedAt)}</p>
      <input type="file" id="csvInput" class="visually-hidden" accept=".csv">
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
          <div class="section-title section-title-first">Perfil do professor</div>
          <p class="form-hint settings-hint-md">Estas informações ajudam a personalizar o dashboard e os relatórios.</p>
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
          <div class="section-title section-title-first">Arquivos e sincronização</div>
          <p class="form-hint settings-hint">Abra, salve, faça cópias de segurança e gerencie o Google Drive em um único lugar.</p>
          <div class="drive-settings-status ${driveStatusTone()}">
            <span class="drive-settings-icon">${ICONS.cloud}</span>
            <div><strong>${esc(driveStatusText())}</strong><span>${driveBindingForCurrentProject() ? `Projeto: ${esc(driveBindingForCurrentProject().name || getCurrentFileName() || 'Projeto atual')}` : 'Google Drive opcional.'}</span></div>
          </div>
          <div class="form-actions form-actions-settings">
            <button type="button" class="btn-primary" id="btnGoFileFromSettings">${ICONS.folder} Abrir Arquivos</button>
          </div>
        </section>

        <section class="card">
          <div class="section-title section-title-first">Dados neste dispositivo</div>
          <p class="form-hint settings-hint">Gerencie recuperação, cópias de segurança e os dados que o ProfessorGest mantém neste navegador.</p>
          <button type="button" class="btn-secondary" id="btnOpenLocalDataSettings">${ICONS.settings || ICONS.folder} Gerenciar dados deste dispositivo</button>
        </section>

        <section class="card">
          <div class="section-title section-title-first">Ajuda e suporte</div>
          <p class="form-hint settings-hint">Se algo não funcionar como esperado, o ProfessorGest guarda algumas informações do problema neste dispositivo para ajudar a identificar o que aconteceu. Elas não são enviadas automaticamente.</p>
          <p id="devLogSummary" class="form-hint settings-hint">${getDevLogEntries().length ? `${getDevLogEntries().length} problema(s) registrado(s).` : 'Nenhum problema registrado.'}</p>
          <div class="form-actions">
            <button type="button" class="btn-secondary" id="btnExportDevLog">${ICONS.file} Baixar informações para suporte</button>
            <button type="button" class="btn-ghost" id="btnClearDevLog">Apagar registros</button>
          </div>
        </section>

        <section class="card">
          <div class="section-title section-title-first">Aparência</div>
          <p class="form-hint settings-hint-xs">Escolha como o ProfessorGest deve aparecer neste dispositivo.</p>
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
