export function createWelcomeViewRenderer({
  readLocalRecoveryDraft,
  readLocalProjectRecords,
  recoverLocalDraft,
  restorePersistedProject,
  restorePersistedProjectById,
  formatRecoveryTime,
  updateWelcomeExperience,
  toast,
  escapeHtml,
}) {
  async function renderWelcomeRecovery() {
    const root = document.querySelector('.welcome-recovery-slot');
    if (!root) return;

    document.getElementById('welcomeRecovery')?.remove();
    document.getElementById('welcomeLocalProjects')?.remove();

    const recovery = readLocalRecoveryDraft();
    let localRecords = [];
    try {
      localRecords = await readLocalProjectRecords(4);
    } catch (_) {
      localRecords = [];
    }
    const localRecord = localRecords[0] || null;

    const hasRecovery = !!recovery?.state;
    const hasLocalProject = !!localRecord?.state;
    const sameProject = hasRecovery && hasLocalProject
      && recovery.state?.projectId
      && localRecord.state?.projectId
      && recovery.state.projectId === localRecord.state.projectId;
    updateWelcomeExperience(hasRecovery || hasLocalProject);

    const recoveryProjectId = recovery?.state?.projectId || null;
    const recoveryName = escapeHtml(recovery?.currentFileName || 'Projeto sem nome');
    const recoveryTime = escapeHtml(formatRecoveryTime(recovery?.savedAt));
    const localName = escapeHtml(localRecord?.currentFileName || 'Projeto sem nome');
    const localTime = escapeHtml(formatRecoveryTime(localRecord?.savedAt));

    const el = document.createElement('div');
    el.id = 'welcomeRecovery';
    el.className = 'welcome-recent-card';

    if (sameProject) {
      el.innerHTML = `
        <div class="welcome-recent-main">
          <div class="welcome-recent-icon">↻</div>
          <div class="welcome-recent-copy">
            <strong>Recuperação disponível</strong>
            <span>${recoveryName}</span>
            <small>Há alterações protegidas mais recentes que a versão salva de ${localTime}.</small>
          </div>
        </div>
        <div class="welcome-recent-actions">
          <button type="button" class="btn-secondary btn-sm" id="welcomeOpenLocalProject">Abrir versão salva</button>
          <button type="button" class="btn-primary btn-sm" id="welcomeRecover">Continuar com a recuperação</button>
        </div>`;
    } else if (hasRecovery) {
      el.innerHTML = `
        <div class="welcome-recent-main">
          <div class="welcome-recent-icon">↻</div>
          <div class="welcome-recent-copy">
            <strong>Recuperação disponível</strong>
            <span>${recoveryName}</span>
            <small>Encontramos alterações protegidas neste dispositivo · ${recoveryTime}</small>
          </div>
        </div>
        <div class="welcome-recent-actions">
          <button type="button" class="btn-primary btn-sm" id="welcomeRecover">Continuar com a recuperação</button>
        </div>`;
    } else if (hasLocalProject) {
      el.innerHTML = `
        <div class="welcome-recent-main">
          <div class="welcome-recent-icon">▣</div>
          <div class="welcome-recent-copy">
            <strong>Último projeto neste dispositivo</strong>
            <span>${localName}</span>
            <small>Última versão protegida salva em ${localTime}.</small>
          </div>
        </div>
        <div class="welcome-recent-actions">
          <button type="button" class="btn-primary btn-sm" id="welcomeOpenLocalProject">Abrir projeto</button>
        </div>`;
    }

    if (el.innerHTML) root.appendChild(el);

    document.getElementById('welcomeRecover')?.addEventListener('click', recoverLocalDraft);
    document.getElementById('welcomeOpenLocalProject')?.addEventListener('click', async () => {
      const opened = await restorePersistedProject();
      if (!opened) toast('Não foi possível abrir a versão salva neste dispositivo.', 'error');
    });

    const featuredProjectId = hasRecovery && recoveryProjectId
      ? recoveryProjectId
      : (localRecord?.state?.projectId || null);
    const otherProjects = localRecords.filter(record => {
      const id = record?.state?.projectId;
      if (!id || id === featuredProjectId) return false;
      return true;
    }).slice(0, 3);

    if (!otherProjects.length) return;

    const list = document.createElement('section');
    list.id = 'welcomeLocalProjects';
    list.className = 'welcome-local-projects';
    list.innerHTML = `
      <div class="welcome-local-projects-head">
        <div>
          <strong>Projetos neste dispositivo</strong>
          <span>Até 4 cópias locais de apoio. O arquivo .prof continua sendo a cópia principal.</span>
        </div>
      </div>
      <div class="welcome-project-list">
        ${otherProjects.map((record, index) => {
          const id = escapeHtml(record.state.projectId);
          const name = escapeHtml(record.currentFileName || 'Projeto sem nome');
          const time = escapeHtml(formatRecoveryTime(record.savedAt));
          return `<div class="welcome-project-row">
            <div class="welcome-project-icon">▣</div>
            <div class="welcome-project-copy"><strong>${name}</strong><span>Versão local · ${time}</span></div>
            <button type="button" class="btn-secondary btn-sm" data-open-local-project="${id}">Abrir</button>
          </div>`;
        }).join('')}
      </div>
      ${localRecords.length >= 4 ? '<div class="welcome-local-projects-note">Limite local: 4 projetos. Quando um novo projeto entra, a versão local mais antiga é removida automaticamente. Seus arquivos .prof não são apagados.</div>' : ''}
    `;
    root.appendChild(list);

    list.querySelectorAll('[data-open-local-project]').forEach(button => {
      button.addEventListener('click', async () => {
        const opened = await restorePersistedProjectById(button.dataset.openLocalProject);
        if (!opened) toast('Não foi possível abrir este projeto salvo neste dispositivo.', 'error');
      });
    });
  }

  return { renderWelcomeRecovery };
}
