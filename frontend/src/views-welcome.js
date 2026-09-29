export function createWelcomeViewRenderer({
  readLocalRecoveryDraft,
  readLocalProjectRecords,
  recoverLocalDraft,
  restorePersistedProject,
  formatRecoveryTime,
  updateWelcomeExperience,
  toast,
  escapeHtml,
  ICONS,
}) {
  let renderToken = 0;

  async function renderWelcomeRecovery() {
    const token = ++renderToken;
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
    // A tela inicial pode pedir a atualização duas vezes durante a hidratação.
    // Apenas a execução mais recente pode inserir o cartão na página.
    if (token !== renderToken) return;
    const localRecord = localRecords[0] || null;

    const hasRecovery = !!recovery?.state;
    const hasLocalProject = !!localRecord?.state;
    const sameProject = hasRecovery && hasLocalProject
      && recovery.state?.projectId
      && localRecord.state?.projectId
      && recovery.state.projectId === localRecord.state.projectId;
    updateWelcomeExperience(hasRecovery || hasLocalProject);

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
          <div class="welcome-recent-icon" aria-hidden="true">${ICONS.refresh}</div>
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
          <div class="welcome-recent-icon" aria-hidden="true">${ICONS.refresh}</div>
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
          <div class="welcome-recent-icon" aria-hidden="true">${ICONS.file}</div>
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

  }

  return { renderWelcomeRecovery };
}
