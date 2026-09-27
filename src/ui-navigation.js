export function createNavigationController({
  navGroups,
  navItems,
  mobileNavKeys,
  icons,
  queryAll,
  escapeHtml,
  getState,
  getContext,
  setContext,
  getCurrentView,
  setCurrentView,
  render,
  openCommandPalette,
  closeCommandPalette,
  openModal,
  closeModal,
  driveBindingForCurrentProject,
}) {
  function navItemHTML(item) {
    return `<button type="button" class="nav-item" data-view="${escapeHtml(item.key)}" aria-label="${escapeHtml(item.label)}">${icons[item.icon]}<span>${escapeHtml(item.label)}</span></button>`;
  }

  function mobileMenuButton(item) {
    return `<button type="button" class="mobile-menu-action" data-mobile-view="${escapeHtml(item.key)}">
      <span class="mobile-menu-action-icon">${icons[item.icon]}</span>
      <span class="mobile-menu-action-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(mobileMenuDescription(item.key))}</small></span>
      <span class="mobile-menu-action-arrow" aria-hidden="true">›</span>
    </button>`;
  }

  function mobileMenuDescription(key) {
    const map = {
      ocorrencias: 'Acompanhar registros dos alunos',
      calendario: 'Ver aulas, atividades e prazos',
      relatorios: 'Gerar e revisar relatórios',
      arquivo: 'Abrir, salvar, exportar e proteger seus arquivos',
      planejamento: 'Preparar aulas e registrar conteúdos',
      configuracoes: 'Perfil, aparência e suporte'
    };
    return map[key] || '';
  }

  function buildNav() {
    const html = navGroups.map(group => `
      <div class="nav-group">
        <div class="nav-group-label">${escapeHtml(String(group.label).toUpperCase())}</div>
        <div class="nav-list">${group.items.map(navItemHTML).join('')}</div>
      </div>`).join('');

    const sidebar = document.getElementById('sidebar-nav');
    if (sidebar) sidebar.innerHTML = html;

    const primaryItems = navItems.filter(item => mobileNavKeys.includes(item.key)).map(navItemHTML).join('');
    const menuItem = `<button class="nav-item mobile-menu-trigger" id="mobileMenuTrigger" type="button" aria-label="Abrir menu" aria-haspopup="dialog" aria-expanded="false">${icons.menu}<span>Menu</span></button>`;
    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) bottomNav.innerHTML = primaryItems + menuItem;

    if (sidebar && !sidebar.dataset.bound) {
      sidebar.dataset.bound = 'true';
      sidebar.addEventListener('click', event => {
        const item = event.target.closest('.nav-item[data-view]');
        if (!item || !sidebar.contains(item)) return;
        navigate(item.dataset.view);
      });
    }

    if (bottomNav && !bottomNav.dataset.bound) {
      bottomNav.dataset.bound = 'true';
      bottomNav.addEventListener('click', event => {
        const item = event.target.closest('.nav-item[data-view]');
        if (!item || !bottomNav.contains(item)) return;
        navigate(item.dataset.view);
      });
    }

    document.getElementById('mobileMenuTrigger')?.addEventListener('click', openMobileMenu);
    syncActiveNavigation();
  }

  function syncActiveNavigation() {
    const view = getCurrentView();
    queryAll('.nav-item[data-view]').forEach(el => {
      const active = el.dataset.view === view;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }

  function openMobileMenu() {
    const trigger = document.getElementById('mobileMenuTrigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    const state = getState();
    const teacherName = state?.teacher?.name?.trim() || 'Professor(a)';
    const school = state?.teacher?.school?.trim() || '';
    const driveConnected = !!driveBindingForCurrentProject();
    const driveLabel = driveConnected ? 'Google Drive conectado' : 'Google Drive disponível';
    const mobileGroups = [
      { label: 'Aulas', keys: ['planejamento', 'calendario'] },
      { label: 'Acompanhamento', keys: ['relatorios'] },
      { label: 'Meu espaço', keys: ['arquivo', 'configuracoes'] },
    ];
    const menuItems = mobileGroups.map(group => {
      const items = group.keys.map(key => navItems.find(item => item.key === key)).filter(Boolean).map(mobileMenuButton).join('');
      return `<div class="mobile-menu-group"><div class="mobile-menu-section-label">${escapeHtml(group.label)}</div>${items}</div>`;
    }).join('');

    openModal(`
      <div class="mobile-menu-head">
        <div class="mobile-menu-identity">
          <div class="mobile-menu-avatar">${escapeHtml((teacherName[0] || 'P').toUpperCase())}</div>
          <div class="mobile-menu-identity-copy">
            <strong>${escapeHtml(teacherName)}</strong>
            <span>${escapeHtml(school || 'ProfessorGest')}</span>
          </div>
        </div>
        <button type="button" class="mobile-menu-close" id="mobileMenuClose" aria-label="Fechar menu">×</button>
      </div>
      <div class="mobile-menu-sync ${driveConnected ? 'connected' : ''}">
        <span class="mobile-menu-sync-dot" aria-hidden="true"></span>
        <span>${escapeHtml(driveLabel)}</span>
      </div>
      <div class="mobile-menu-list">${menuItems}</div>
    `, false, 'mobile-menu-box');

    document.getElementById('mobileMenuClose')?.addEventListener('click', closeMobileMenu);
    queryAll('[data-mobile-view]').forEach(button => {
      button.addEventListener('click', () => {
        const view = button.dataset.mobileView;
        closeMobileMenu();
        navigate(view);
      });
    });
  }

  function closeMobileMenu() {
    closeModal();
    const trigger = document.getElementById('mobileMenuTrigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function navigate(view, resetCtx = true) {
    setCurrentView(view);
    closeCommandPalette();
    if (resetCtx) {
      const current = getContext();
      setContext({
        ...current,
        classId: null,
        studentId: null,
        activityId: null,
        classTab: 'visao',
        studentTab: 'visao',
        histFilter: 'todos',
        histMonth: '',
        bulkMode: false,
        bulkSelected: new Set()
      });
    }
    syncActiveNavigation();
    render();
    window.scrollTo(0, 0);
  }

  return {
    buildNav,
    navItemHTML,
    mobileMenuButton,
    mobileMenuDescription,
    openMobileMenu,
    closeMobileMenu,
    navigate,
    syncActiveNavigation,
  };
}
