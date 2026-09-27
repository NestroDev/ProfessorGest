export function createWelcomeViewRenderer({
  getCurrentFileName,
  readLocalRecoveryDraft,
  readLocalProjectRecord,
  recoverLocalDraft,
  discardLocalRecoveryDraft,
  restorePersistedProject,
  formatRecoveryTime,
  updateWelcomeExperience,
  toast,
  escapeHtml,
}) {
  function renderWelcomeRecovery() {
    const root = document.querySelector('.welcome-drive-action');
    if (!root) return;

    const recovery = readLocalRecoveryDraft();
    updateWelcomeExperience(!!recovery);
    document.getElementById('welcomeRecovery')?.remove();
    document.getElementById('welcomeLocalProject')?.remove();

    if (recovery) {
      const name = escapeHtml(recovery.currentFileName || getCurrentFileName() || 'Projeto sem nome');
      const time = escapeHtml(formatRecoveryTime(recovery.savedAt));
      const el = document.createElement('div');
      el.id = 'welcomeRecovery';
      el.className = 'welcome-recovery';
      el.innerHTML = `<div class="welcome-recovery-copy"><span class="welcome-recovery-dot"></span><div><strong>Encontramos seu trabalho recente.</strong><span>${name} · última cópia ${time}</span></div></div><div class="welcome-recovery-actions"><button type="button" class="btn-secondary btn-sm" id="welcomeDiscardRecovery">Descartar</button><button type="button" class="btn-primary btn-sm" id="welcomeRecover">Continuar de onde parou</button></div>`;
      root.insertAdjacentElement('afterend', el);
      document.getElementById('welcomeRecover')?.addEventListener('click', recoverLocalDraft);
      document.getElementById('welcomeDiscardRecovery')?.addEventListener('click', () => {
        discardLocalRecoveryDraft();
        toast('Cópia local descartada.', 'info');
      });
    }

    readLocalProjectRecord().then(localRecord => {
      if (localRecord?.state) updateWelcomeExperience(true);
      if (!localRecord?.state || document.getElementById('welcomeLocalProject')) return;
      const name = escapeHtml(localRecord.currentFileName || 'Projeto local');
      const time = escapeHtml(formatRecoveryTime(localRecord.savedAt));
      const el = document.createElement('div');
      el.id = 'welcomeLocalProject';
      el.className = 'welcome-recovery';
      el.innerHTML = `<div class="welcome-recovery-copy"><span class="welcome-recovery-dot"></span><div><strong>Projeto salvo neste dispositivo.</strong><span>${name} · último salvamento ${time}</span></div></div><div class="welcome-recovery-actions"><button type="button" class="btn-primary btn-sm" id="welcomeOpenLocalProject">Abrir projeto</button></div>`;
      root.insertAdjacentElement('afterend', el);
      document.getElementById('welcomeOpenLocalProject')?.addEventListener('click', async () => {
        const opened = await restorePersistedProject();
        if (!opened) toast('Não foi possível abrir o projeto salvo neste dispositivo.', 'error');
      });
    }).catch(() => {});
  }

  return { renderWelcomeRecovery };
}
