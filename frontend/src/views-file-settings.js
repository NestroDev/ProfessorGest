const THEME_CHOICES = [
  ['light', 'Claro', 'Tons suaves para o dia a dia.'],
  ['dark', 'Escuro', 'Confortável com pouca luz.'],
  ['system', 'Automático', 'Acompanha o seu aparelho.'],
];

/** Cartões de tema com uma miniatura da interface; `attr` é o data-attribute lido por quem trata o clique. */
export function themeChoicesHTML(mode, attr = 'data-theme-mode') {
  return `<div class="theme-choices" role="group" aria-label="Tema">${THEME_CHOICES.map(([key, label, hint]) => `
    <button type="button" class="theme-choice ${mode === key ? 'active' : ''}" ${attr}="${key}" aria-pressed="${mode === key}">
      <span class="theme-mock ${key}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="theme-choice-copy"><strong>${label}</strong><span>${hint}</span></span>
      <span class="theme-choice-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    </button>`).join('')}</div>`;
}

export function createFileSettingsRenderers(deps) {
  const {
    getState, esc, getDemoMode, getIsDirty, ICONS, getDriveActionPending = () => false,
    supportsFileShare, getProjectInfo, getDriveAccount = () => null,
    fmtDate, fmtDateTime, getThemeMode, getDevLogEntries,
    gradeSettings = null, occurrenceTypes = [], occurrencePolarities = []
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
          <div class="file-tool-copy"><strong>Cópias de segurança</strong><span>${info.lastBackupAt ? `Última cópia: ${fmtDateTime(info.lastBackupAt)}` : 'Proteção automática ativada'}</span><p>O ProfessorGest guarda cópias automaticamente enquanto você trabalha e antes de mudanças grandes. Dá para voltar a qualquer uma delas.</p></div>
          <button type="button" class="btn-secondary" id="btnOpenBackups">${ICONS.folder} Ver cópias</button>
        </section>

        <section class="card file-tool-card ${info.tone}">
          <div class="file-tool-icon">${account ? `<div class="drive-account-icon">${account.photoLink ? `<img src="${esc(account.photoLink)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>${ICONS.cloud}</span>` : ICONS.cloud}</div>` : ICONS.cloud}</div>
          <div class="file-tool-copy"><strong>Google Drive</strong><span>${esc(info.linked ? info.syncLabel : 'Este projeto ainda não está no Google Drive')}</span><p>${info.linked ? `Arquivo: ${esc(info.driveFileName || 'projeto no Drive')}${info.lastSyncAt ? ` · atualizado no Drive ${fmtDateTime(info.lastSyncAt)}` : ''}. O projeto também continua salvo neste aparelho.` : 'Guarde uma cópia no Google Drive para abrir o projeto em outros aparelhos. Sem o Drive, tudo continua salvo aqui.'}${account ? ` Conta: ${esc(account.email || account.displayName || 'Google')}.` : ''}</p></div>
          <div class="file-tool-actions">
            <button type="button" class="btn-primary" id="btnDriveSync" ${busy ? 'disabled aria-busy="true"' : ''}>${ICONS.cloud} ${busy ? 'Sincronizando…' : (info.linked ? 'Sincronizar agora' : 'Enviar ao Google Drive')}</button>
            ${account ? '<button type="button" class="btn-ghost" id="btnDriveAccountSettings">Conta Google</button>' : ''}
            ${info.linked ? '<button type="button" class="btn-ghost" id="btnDriveUnlink">Desconectar do Drive</button><button type="button" class="btn-ghost danger" id="btnDriveTrash">Mover para a lixeira do Drive</button>' : ''}
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
          <div class="file-tool-copy"><strong>Exportar e importar</strong><span>Leve o projeto para outro aparelho</span><p>Exportar gera um arquivo com todo o projeto, para guardar ou enviar. O projeto deste aparelho não muda.</p></div>
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
        <p class="file-note">Excluir deste aparelho apaga o projeto e as cópias de segurança dele. A cópia no Google Drive e os arquivos que você exportou continuam intactos.</p>
      </details>
      <input type="file" id="csvInput" class="visually-hidden" accept=".csv">
    `;
  }

  /** Linha de configuração: o que é (à esquerda) e o controle (à direita). */
  function settingsRow(title, description, control, { forId = '' } = {}) {
    const label = forId ? `<label for="${forId}">${esc(title)}</label>` : `<strong>${esc(title)}</strong>`;
    return `<div class="settings-row"><div class="settings-row-copy">${label}${description ? `<span>${description}</span>` : ''}</div><div class="settings-row-control">${control}</div></div>`;
  }

  function settingsSection(title, description, body, id = '', icon = '') {
    return `<section class="settings-section"${id ? ` id="${id}"` : ''}>
        <div class="settings-section-head">${icon ? `<span class="settings-section-icon" aria-hidden="true">${icon}</span>` : ''}<div><h2>${esc(title)}</h2>${description ? `<p>${description}</p>` : ''}</div></div>
        <div class="settings-panel">${body}</div>
      </section>`;
  }

  const SETTINGS_SECTIONS = [
    ['settings-perfil', 'Perfil', 'user'],
    ['settings-aparencia', 'Aparência', 'sparkle'],
    ['gradeSettingsCard', 'Nota recomendada', 'check'],
    ['settings-projeto', 'Projeto e conta', 'cloud'],
    ['settings-aparelho', 'Este aparelho', 'archive'],
    ['settings-ajuda', 'Ajuda', 'alert'],
  ];

  function renderConfiguracoes() {
    const mode = getThemeMode();
    const info = getProjectInfo();
    const account = getDriveAccount();
    const problems = getDevLogEntries().length;
    const icon = key => (ICONS && ICONS[key]) || '';
    const accountInitial = esc((account?.displayName || account?.email || 'G')[0].toUpperCase());
    const accountAvatar = account
      ? `<span class="settings-avatar">${account.photoLink ? `<img src="${esc(account.photoLink)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>${accountInitial}</span>` : accountInitial}</span>`
      : `<span class="settings-avatar is-empty" aria-hidden="true">${icon('cloud')}</span>`;
    const sections = SETTINGS_SECTIONS.filter(([id]) => id !== 'gradeSettingsCard' || gradeSettings);

    return `
      <div class="page-head">
        <div><h1>Configurações</h1><div class="page-sub">Ajuste o ProfessorGest ao seu jeito de trabalhar.</div></div>
      </div>

      <div class="settings-shell">
        <nav class="settings-nav" aria-label="Seções das configurações">
          ${sections.map(([id, label, key]) => `<button type="button" class="settings-nav-item" data-settings-jump="${id}"><span aria-hidden="true">${icon(key)}</span>${esc(label)}</button>`).join('')}
        </nav>

        <div class="settings-layout">
          ${settingsSection('Perfil', 'Seu nome aparece no início e nos relatórios.', settingsRow(
            'Nome do professor(a)', '',
            `<input class="form-input" id="teacherNameInput" name="teacherName" autocomplete="name" value="${esc((getState().teacher && getState().teacher.name) || '')}" placeholder="Ex.: Mariana Alves"><button type="button" class="btn-secondary" id="btnSaveTeacherName">Salvar</button>`,
            { forId: 'teacherNameInput' },
          ), 'settings-perfil', icon('user'))}

          ${settingsSection('Aparência', '“Automático” acompanha o tema do seu aparelho.',
            `<div class="settings-row settings-row-stack">${themeChoicesHTML(mode, 'data-theme-mode')}</div>`,
            'settings-aparencia', icon('sparkle'))}

          ${gradeSettingsCardHTML(icon('check'))}

          ${settingsSection('Projeto e conta', 'Nome, cópias de segurança, exportação e Google Drive ficam na página do projeto.',
            settingsRow('Projeto aberto', `${esc(info.name)} · ${esc(info.linked ? info.syncLabel : info.localLabel)}`, `<button type="button" class="btn-secondary" id="btnGoFileFromSettings">${icon('folder')} Abrir página do projeto</button>`)
            + settingsRow('Conta Google', account
              ? `${accountAvatar}${esc(account.email || account.displayName || 'Conta conectada')}`
              : `${accountAvatar}Nenhuma conta conectada. O Google Drive é opcional.`,
              `<button type="button" class="btn-secondary" id="btnDriveAccountSettings">${account ? 'Gerenciar conta' : 'Conectar conta'}</button>`),
            'settings-projeto', icon('cloud'),
          )}

          ${settingsSection('Este aparelho', '', settingsRow(
            'Dados guardados aqui', 'Veja seus projetos neste aparelho ou apague tudo.',
            `<button type="button" class="btn-secondary" id="btnOpenLocalDataSettings">Gerenciar</button>`,
          ), 'settings-aparelho', icon('archive'))}

          ${settingsSection('Ajuda', '', settingsRow(
            'Informações para o suporte',
            `<span id="devLogSummary">${problems ? `${problems} ${problems === 1 ? 'problema registrado' : 'problemas registrados'}. Envie o arquivo ao suporte se algo não funcionar.` : 'Nenhum problema registrado.'}</span>`,
            `<button type="button" class="btn-secondary" id="btnExportDevLog">Baixar</button>${problems ? '<button type="button" class="btn-ghost" id="btnClearDevLog">Apagar</button>' : ''}`,
          ), 'settings-ajuda', icon('alert'))}
        </div>
      </div>
    `;
  }

  function gradeSettingsCardHTML(sectionIcon = '') {
    if (!gradeSettings) return '';
    const settings = gradeSettings();
    const numberInput = (name, value, label, { min = '', max = '' } = {}) => `
      <label class="grade-weight-field">
        <span>${esc(label)}</span>
        <input class="form-input" type="number" step="0.05" name="${esc(name)}" value="${esc(String(value))}"${min !== '' ? ` min="${min}"` : ''}${max !== '' ? ` max="${max}"` : ''} inputmode="decimal">
      </label>`;
    const groups = occurrencePolarities.map(polarity => {
      const types = occurrenceTypes.filter(type => type.polarity === polarity.key);
      if (!types.length) return '';
      return `<div class="grade-weight-group occ-type-${esc(polarity.key)}"><div class="occ-type-group-label">${esc(polarity.label)}</div>${types.map(type => numberInput(`w_${type.key}`, settings.weights[type.key], type.label)).join('')}</div>`;
    }).join('');
    const body = `<form id="gradeSettingsForm" class="grade-settings-form">
        ${settingsRow('Nota base', 'A nota de quem ainda não tem registros.', numberInput('base', settings.base, 'Nota base', { min: 0 }).replace('<span>Nota base</span>', '<span class="visually-hidden">Nota base</span>'))}
        ${settingsRow('Nota máxima', 'A nota recomendada nunca passa deste valor.', numberInput('max', settings.max, 'Nota máxima', { min: 0.05 }).replace('<span>Nota máxima</span>', '<span class="visually-hidden">Nota máxima</span>'))}
        <div class="settings-row settings-row-stack">
          <div class="settings-row-copy"><strong>Pontos por registro</strong><span>Quanto cada tipo de registro soma ou tira da nota. Use números negativos para o que deve diminuir a nota.</span></div>
          <div class="grade-weight-columns">${groups}</div>
        </div>
        <div class="settings-row settings-row-actions">
          <button type="button" class="btn-ghost" id="btnResetGradeSettings">Restaurar padrão</button>
          <button type="submit" class="btn-primary">Salvar pontuação</button>
        </div>
      </form>`;
    return settingsSection('Nota recomendada', 'A nota começa na nota base e muda conforme os registros positivos e negativos do aluno.', body, 'gradeSettingsCard', sectionIcon);
  }

  return { renderArquivo, renderConfiguracoes };
}
