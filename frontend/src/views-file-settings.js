export function createFileSettingsRenderers(deps) {
  const {
    getState, esc, getDemoMode, getIsDirty, ICONS, getDriveActionPending = () => false,
    supportsFileShare, getProjectInfo, getDriveAccount = () => null,
    fmtDate, fmtDateTime, getThemeMode, getDevLogEntries
  } = deps;

  function renderArquivo() {
    if (getDemoMode()) {
      return `
        <div class="page-head"><div><h1>Demonstração</h1><div class="page-sub">Explore o ProfessorGest com dados de exemplo.</div></div><div class="page-actions"><button type="button" class="btn-primary" id="btnExitDemo">Criar meu projeto</button></div></div>
        <div class="card demo-file-card">
          <div class="section-title section-title-first">Ambiente de demonstração</div>
          <p class="settings-lead">Navegue pelas telas, abra alunos, veja atividades e experimente os relatórios. Este ambiente não altera os seus projetos.</p>
          <div class="demo-feature-grid">
            <div><strong>2 turmas</strong><span>com alunos e atividades</span></div>
            <div><strong>5 alunos</strong><span>com histórico e registros</span></div>
            <div><strong>Relatórios</strong><span>individuais e por turma</span></div>
          </div>
          <button type="button" class="btn-secondary btn-block" id="btnExitDemoSecondary">Sair da demonstração</button>
        </div>
      `;
    }
    const info = getProjectInfo();
    const st = getState();
    const account = getDriveAccount();
    const busy = getDriveActionPending();
    return `
      <div class="page-head"><div><h1>Projeto</h1><div class="page-sub">Nome, cópias de segurança, exportação e Google Drive deste projeto.</div></div><div class="page-actions"><button type="button" class="btn-secondary" id="btnBackToProjects">${ICONS.folder} Seus projetos</button><button type="button" class="btn-secondary" id="btnNewProject">${ICONS.file} Novo projeto</button></div></div>

      <section class="file-workspace card">
        <div class="file-workspace-head">
          <div>
            <div class="eyebrow">PROJETO ATUAL</div>
            <div class="file-current-name">${ICONS.file}<strong>${esc(info.name)}</strong></div>
            <div class="file-current-status ${getIsDirty() ? 'dirty' : 'saved'}"><span class="status-dot"></span>${esc(info.localLabel)}</div>
          </div>
          <div class="file-primary-actions">
            <button type="button" class="btn-secondary" id="btnRenameProject">Renomear</button>
          </div>
        </div>
        <p class="file-meta-line">${info.classCount} ${info.classCount === 1 ? 'turma' : 'turmas'} · ${info.studentCount} ${info.studentCount === 1 ? 'aluno' : 'alunos'} · Criado em ${fmtDate(st.createdAt)} · Última alteração: ${fmtDateTime(info.updatedAt || st.updatedAt)}</p>
      </section>

      <div class="file-tools-grid">
        <section class="card file-tool-card">
          <div class="file-tool-icon">${ICONS.save}</div>
          <div class="file-tool-copy"><strong>Cópias de segurança</strong><span>${info.lastBackupAt ? `Última cópia: ${fmtDateTime(info.lastBackupAt)}` : 'Proteção automática ativada'}</span><p>Cada projeto guarda as próprias cópias neste dispositivo: antes de ações importantes, ao atualizar pelo DED+ e em intervalos durante o trabalho.</p></div>
          <button type="button" class="btn-secondary" id="btnOpenBackups">${ICONS.folder} Ver cópias</button>
        </section>

        <section class="card file-tool-card ${info.tone}">
          <div class="file-tool-icon">${account ? `<div class="drive-account-icon">${account.photoLink ? `<img src="${esc(account.photoLink)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>${ICONS.cloud}</span>` : ICONS.cloud}</div>` : ICONS.cloud}</div>
          <div class="file-tool-copy"><strong>Google Drive</strong><span>${esc(info.linked ? info.syncLabel : 'Este projeto ainda não está no Google Drive')}</span><p>${info.linked ? `Arquivo: ${esc(info.driveFileName || 'projeto no Drive')}${info.lastSyncAt ? ` · última sincronização ${fmtDateTime(info.lastSyncAt)}` : ''}. O salvamento neste dispositivo é automático e independe do Drive.` : 'O Drive guarda uma cópia na nuvem. Seu trabalho continua salvo neste dispositivo, com ou sem o Drive.'}${account ? ` Conta: ${esc(account.email || account.displayName || 'Google')}.` : ''}</p></div>
          <div class="file-tool-actions">
            <button type="button" class="btn-primary" id="btnDriveSync" ${busy ? 'disabled aria-busy="true"' : ''}>${ICONS.cloud} ${busy ? 'Sincronizando…' : (info.linked ? 'Sincronizar agora' : 'Enviar ao Google Drive')}</button>
            ${account ? '<button type="button" class="btn-ghost" id="btnDriveAccountSettings">Conta Google</button>' : ''}
            ${info.linked ? '<button type="button" class="btn-ghost" id="btnDriveUnlink">Desvincular</button><button type="button" class="btn-ghost danger" id="btnDriveTrash">Mover para a lixeira do Drive</button>' : ''}
          </div>
        </section>
      </div>

      <div class="file-tools-grid">
        <section class="card file-tool-card">
          <div class="file-tool-icon">${ICONS.refresh}</div>
          <div class="file-tool-copy"><strong>Atualizar projeto com DED+</strong><span>Vários PDFs de uma vez</span><p>Turmas existentes são atualizadas, turmas novas são adicionadas e ninguém é apagado automaticamente: quem não aparece no PDF é preservado com o histórico.</p></div>
          <button type="button" class="btn-secondary" id="btnDedProjectUpdate">${ICONS.refresh} Atualizar com DED+</button>
        </section>
        <section class="card file-tool-card">
          <div class="file-tool-icon">${ICONS.file}</div>
          <div class="file-tool-copy"><strong>Exportar e importar</strong><span>O .prg é um formato portátil</span><p>Exportar gera uma cópia do projeto para guardar ou enviar; ela não altera nem substitui o projeto neste dispositivo.</p></div>
          <div class="file-tool-actions">
            <button type="button" class="btn-secondary" id="btnExportPrg">${ICONS.file} Exportar .prg</button>
            <button type="button" class="btn-secondary" id="btnSharePrg" ${supportsFileShare() ? '' : 'hidden'}>${ICONS.share || ICONS.copy} Compartilhar .prg</button>
            <button type="button" class="btn-secondary" id="btnExportCsv">${ICONS.copy} Exportar alunos (CSV)</button>
            <button type="button" class="btn-secondary" id="btnImportCsv">${ICONS.folder} Importar alunos (CSV)</button>
          </div>
        </section>
      </div>

      <details class="file-more-options">
        <summary><span>Remover projeto</span><span class="details-hint">Ações que apagam dados</span></summary>
        <div class="file-more-grid">
          <button type="button" class="btn-ghost danger" id="btnDeleteProject">${ICONS.trash} Excluir deste dispositivo</button>
          ${info.linked ? `<button type="button" class="btn-ghost danger" id="btnDeleteProjectEverywhere">${ICONS.trash} Remover do dispositivo e do Google Drive</button>` : ''}
        </div>
        <p class="file-note">Excluir deste dispositivo remove o projeto, as cópias de segurança e a recuperação dele — mas não apaga o arquivo do Google Drive nem arquivos .prg que você exportou.</p>
      </details>
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
          <div class="section-title section-title-first">Projeto e Google Drive</div>
          <p class="form-hint settings-hint">Seu projeto é salvo automaticamente neste dispositivo. Gerencie o nome, as cópias de segurança, a exportação .prg e o Google Drive na página do projeto.</p>
          <div class="drive-settings-status ${getProjectInfo().tone}">
            ${getDriveAccount() ? `<div class="drive-settings-photo">${getDriveAccount().photoLink ? `<img src="${esc(getDriveAccount().photoLink)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>${esc((getDriveAccount().displayName || getDriveAccount().email || 'G')[0].toUpperCase())}</span>` : esc((getDriveAccount().displayName || getDriveAccount().email || 'G')[0].toUpperCase())}</div>` : `<span class="drive-settings-icon">${ICONS.cloud}</span>`}
            <div><strong>${esc(getProjectInfo().linked ? getProjectInfo().syncLabel : getProjectInfo().localLabel)}</strong><span>${getDriveAccount() ? `${esc(getDriveAccount().displayName || 'Conta Google')} · ${esc(getDriveAccount().email || 'Conta conectada')}` : (getProjectInfo().linked ? `Projeto: ${esc(getProjectInfo().name)}` : 'Google Drive opcional.')}</span></div>
          </div>
          ${getDriveAccount() ? `<div class="drive-account-settings-row"><span>Conta lembrada neste dispositivo</span><button type="button" class="btn-secondary btn-sm" id="btnDriveAccountSettings">Gerenciar conta</button></div>` : ''}
          <div class="form-actions form-actions-settings">
            <button type="button" class="btn-primary" id="btnGoFileFromSettings">${ICONS.folder} Abrir página do projeto</button>
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
