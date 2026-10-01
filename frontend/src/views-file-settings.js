export function createFileSettingsRenderers(deps) {
  const {
    getState, esc, getDemoMode, getCurrentFileName, getIsDirty, ICONS, getDriveActionPending = () => false,
    supportsFileShare, driveStatusTone, driveStatusText, driveBindingForCurrentProject, getDriveAccount = () => null,
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
      <div class="page-head"><div><h1>Arquivos</h1><div class="page-sub">Abra, proteja e atualize seus arquivos.</div></div><div class="page-actions"><button type="button" class="btn-secondary" id="btnNewFile">${ICONS.file} Novo arquivo</button></div></div>

      <section class="file-workspace card">
        <div class="file-workspace-head">
          <div>
            <div class="eyebrow">ARQUIVO ATUAL</div>
            <div class="file-current-name">${ICONS.file}${getCurrentFileName() ? `<strong>${esc(getCurrentFileName())}</strong>` : '<strong>Novo projeto</strong>'}</div>
            <div class="file-current-status ${getIsDirty() ? 'dirty' : 'saved'}"><span class="status-dot"></span>${getIsDirty() ? 'Salvando automaticamente…' : 'Salvo automaticamente neste dispositivo'}</div>
          </div>
          <div class="file-primary-actions">
            <button type="button" class="btn-secondary" id="btnOpenFile">${ICONS.folder} Abrir arquivo</button>
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
          <div class="file-tool-icon">${getDriveAccount() ? `<div class="drive-account-icon">${getDriveAccount().photoLink ? `<img src="${esc(getDriveAccount().photoLink)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>${esc((getDriveAccount().displayName || getDriveAccount().email || 'G')[0].toUpperCase())}</span>` : esc((getDriveAccount().displayName || getDriveAccount().email || 'G')[0].toUpperCase())}</div>` : ICONS.cloud}</div>
          <div class="file-tool-copy"><strong>Google Drive</strong><span>${esc(driveStatusText())}</span><p>${getDriveAccount() ? `Conta: ${esc(getDriveAccount().email || getDriveAccount().displayName || 'Google')}. A conta lembrada será reutilizada ao atualizar o Drive.` : 'Conecte sua conta para poder atualizar o Drive quando decidir.'}</p></div>
          <div class="file-tool-actions">
            <button type="button" class="btn-secondary" id="btnDriveOpen">${ICONS.folder} Abrir do Drive</button>
            <button type="button" class="btn-primary" id="btnDriveAction" ${getDriveActionPending() ? 'disabled aria-busy="true"' : ''}>${getDriveActionPending() ? ICONS.cloud + ' Atualizando…' : (driveBindingForCurrentProject() ? ICONS.cloud + ' Atualizar Drive' : ICONS.cloud + ' Conectar e atualizar')}</button>
            ${driveBindingForCurrentProject() ? '<button type="button" class="btn-ghost" id="btnDriveDisconnect">Desvincular</button>' : ''}
          </div>
        </section>
      </div>

      <details class="file-more-options">
        <summary><span>Mais opções do arquivo</span><span class="details-hint">Exportar, compartilhar e importar</span></summary>
        <div class="file-more-grid">
          <button type="button" class="btn-secondary" id="btnExportPrg">${ICONS.file} Exportar cópia .prg</button>
          <button type="button" class="btn-secondary" id="btnSharePrg" ${supportsFileShare() ? '' : 'hidden'}>${ICONS.share || ICONS.copy} Compartilhar .prg</button>
          <button type="button" class="btn-secondary" id="btnExportCsv">${ICONS.copy} Exportar alunos (CSV)</button>
          <button type="button" class="btn-secondary" id="btnImportCsv">${ICONS.folder} Importar alunos (CSV)</button>
        </div>
        <p class="file-note">Em alguns celulares, o arquivo aberto não pode ser atualizado diretamente. Nesses casos, suas alterações continuam protegidas neste dispositivo; use <strong>Exportar cópia .prg</strong> para gerar o arquivo atualizado.</p>
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
          <div class="form-group"><label class="form-label">Nome do professor(a)</label>
            <input class="form-input" id="teacherNameInput" value="${esc((getState().teacher && getState().teacher.name) || '')}" placeholder="Ex.: João da Silva"></div>
          <p class="form-hint">Escola e disciplina não ficam no perfil. Elas pertencem às suas atuações e podem variar entre turmas.</p>
          <button type="button" class="btn-primary btn-sm" id="btnSaveTeacherName">Salvar nome</button>
        </section>

        <section class="card">
          <div class="section-title section-title-first">Arquivos e sincronização</div>
          <p class="form-hint settings-hint">Abra projetos, acompanhe o salvamento automático, faça cópias de segurança e gerencie o Google Drive em um único lugar.</p>
          <div class="drive-settings-status ${driveStatusTone()}">
            ${getDriveAccount() ? `<div class="drive-settings-photo">${getDriveAccount().photoLink ? `<img src="${esc(getDriveAccount().photoLink)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>${esc((getDriveAccount().displayName || getDriveAccount().email || 'G')[0].toUpperCase())}</span>` : esc((getDriveAccount().displayName || getDriveAccount().email || 'G')[0].toUpperCase())}</div>` : `<span class="drive-settings-icon">${ICONS.cloud}</span>`}
            <div><strong>${esc(driveStatusText())}</strong><span>${getDriveAccount() ? `${esc(getDriveAccount().displayName || 'Conta Google')} · ${esc(getDriveAccount().email || 'Conta conectada')}` : (driveBindingForCurrentProject() ? `Projeto: ${esc(driveBindingForCurrentProject().name || getCurrentFileName() || 'Projeto atual')}` : 'Google Drive opcional.')}</span></div>
          </div>
          ${getDriveAccount() ? `<div class="drive-account-settings-row"><span>Conta lembrada neste dispositivo</span><button type="button" class="btn-secondary btn-sm" id="btnDriveAccountSettings">Gerenciar conta</button></div>` : ''}
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
