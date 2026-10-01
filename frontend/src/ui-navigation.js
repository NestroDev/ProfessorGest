const ROUTE_KEY = 'professorgest-navigation-v2';
const ROUTE_CTX_KEYS = [
  'classId', 'assignmentId', 'studentId', 'activityId', 'classTab', 'studentTab', 'histFilter', 'histMonth',
  'studentSearch', 'studentClassFilter', 'studentSort', 'activityFilter', 'activityClassFilter',
  'occSearch', 'occClassFilter', 'occTypeFilter', 'occMonth', 'calMonth', 'calSelectedDay', 'calClassFilter',
  'reportStudentId', 'reportFrom', 'reportTo', 'reportOpts', 'reportSynthesis', 'classReportId',
  'classReportFrom', 'classReportTo', 'classSearch', 'activitySearch', 'planningSearch',
  'planningClassFilter', 'planningFrom', 'planningTo', 'showArchivedClasses'
];

export function createNavigationController({
  navGroups,
  navItems,
  mobileNavItems,
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
  let initialized = false;
  let restoring = false;
  let lastRoute = null;

  function compactContext(ctx) {
    const out = {};
    for (const key of ROUTE_CTX_KEYS) {
      const value = ctx?.[key];
      if (value === undefined || value === null || value === '' || value instanceof Set) continue;
      if (typeof value === 'object') {
        try { out[key] = JSON.parse(JSON.stringify(value)); } catch (_) {}
      } else if (typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value)) {
        out[key] = value;
      }
    }
    return out;
  }

  function routeFromState(view = getCurrentView(), ctx = getContext()) {
    return { view, context: compactContext(ctx), projectId: getState()?.projectId || null };
  }

  function persistRoute(route) {
    lastRoute = route;
    try { sessionStorage.setItem(ROUTE_KEY, JSON.stringify(route)); } catch (_) {}
  }

  function readPersistedRoute() {
    try {
      const raw = sessionStorage.getItem(ROUTE_KEY);
      if (!raw) return null;
      const route = JSON.parse(raw);
      return route && typeof route.view === 'string' ? route : null;
    } catch (_) {
      return null;
    }
  }

  function restoreRoute(route, { replaceHistory = true } = {}) {
    if (!route?.view) return false;
    restoring = true;
    setCurrentView(route.view);
    const current = getContext();
    const incoming = route.context && typeof route.context === 'object' ? route.context : {};
    setContext({ ...current, ...incoming, bulkMode: false, bulkSelected: new Set() });
    const normalized = routeFromState(route.view, getContext());
    restoring = false;
    if (replaceHistory) history.replaceState({ professorgestRoute: normalized }, '', window.location.href);
    persistRoute(normalized);
    syncActiveNavigation();
    render();
    window.scrollTo(0, 0);
    return true;
  }

  function handlePopState(event) {
    const state = event.state?.professorgestRoute || readPersistedRoute();
    const hasOverlay = !!document.getElementById('cmdkRoot')?.innerHTML || !!document.getElementById('modalRoot')?.innerHTML;
    if (hasOverlay) {
      closeCommandPalette();
      closeModal();
      // Cancel the browser-back navigation so overlays behave like native Android dialogs.
      history.go(1);
      return;
    }
    if (!state?.view) return;
    restoreRoute(state);
  }

  function initHistory() {
    if (initialized) return;
    initialized = true;
    window.addEventListener('popstate', handlePopState);
    const historyState = window.history.state?.professorgestRoute;
    const persisted = readPersistedRoute();
    if (historyState?.view) lastRoute = historyState;
    else if (persisted?.view) lastRoute = persisted;
  }

  function navItemHTML(item) {
    return `<button type="button" class="nav-item" data-view="${escapeHtml(item.key)}" aria-label="${escapeHtml(item.label)}">${icons[item.icon]}<span>${escapeHtml(item.label)}</span></button>`;
  }

  function mobilePrimaryItemHTML(item) {
    return `<button type="button" class="nav-item" data-mobile-primary="${escapeHtml(item.key)}" aria-label="${escapeHtml(item.label)}">${icons[item.icon]}<span>${escapeHtml(item.label)}</span></button>`;
  }

  function mobileMenuButton(item) {
    return `<button type="button" class="mobile-menu-action" data-mobile-view="${escapeHtml(item.key)}">
      <span class="mobile-menu-action-icon">${icons[item.icon]}</span>
      <span class="mobile-menu-action-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(mobileMenuDescription(item.key))}</small></span>
      <span class="mobile-menu-action-arrow" aria-hidden="true">${icons.chevR}</span>
    </button>`;
  }

  function mobileMenuDescription(key) {
    const map = {
      ocorrencias: 'Acompanhar registros dos alunos',
      calendario: 'Ver aulas, atividades e prazos',
      relatorios: 'Gerar e revisar relatórios',
      arquivo: 'Abrir, salvar, exportar e proteger seus arquivos',
      planejamento: 'Preparar aulas e registrar conteúdos',
      configuracoes: 'Perfil, aparência e suporte',
      escolas: 'Organizar escolas e atuações'
    };
    return map[key] || '';
  }

  function buildNav() {
    initHistory();
    const html = navGroups.map(group => `
      <div class="nav-group">
        <div class="nav-group-label">${escapeHtml(String(group.label).toUpperCase())}</div>
        <div class="nav-list">${group.items.map(navItemHTML).join('')}</div>
      </div>`).join('');

    const sidebar = document.getElementById('sidebar-nav');
    if (sidebar) sidebar.innerHTML = html;

    const primaryItems = mobileNavItems.map(mobilePrimaryItemHTML).join('');
    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) bottomNav.innerHTML = primaryItems;

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
        const item = event.target.closest('.nav-item[data-mobile-primary]');
        if (!item || !bottomNav.contains(item)) return;
        const config = mobileNavItems.find(entry => entry.key === item.dataset.mobilePrimary);
        if (!config) return;
        if (config.views.length === 1) {
          closeMobileContext();
          navigate(config.views[0]);
          return;
        }
        toggleMobileContext(config);
      });
    }

    syncActiveNavigation();
  }

  function syncActiveNavigation() {
    const view = getCurrentView();
    const activeView = {
      turmaDetail: 'turmas',
      alunoDetail: 'alunos',
      atividadeDetail: 'atividades',
      relatorio: 'relatorios',
      classReport: 'relatorios',
    }[view] || view;
    queryAll('.nav-item[data-view]').forEach(el => {
      const active = el.dataset.view === activeView;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    const mobileActive = mobileNavItems.find(item => item.views.includes(activeView));
    queryAll('.nav-item[data-mobile-primary]').forEach(el => {
      const active = el.dataset.mobilePrimary === mobileActive?.key;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }

  function toggleMobileContext(config) {
    const root = document.getElementById('mobileContextNav');
    if (!root) return;
    const isSameContextOpen = root.dataset.context === config.key && root.classList.contains('is-open');
    if (isSameContextOpen) {
      closeMobileContext();
      return;
    }
    const destinations = config.views
      .map(key => navItems.find(item => item.key === key))
      .filter(Boolean);
    const activeView = {
      turmaDetail: 'turmas', alunoDetail: 'alunos', atividadeDetail: 'atividades', escolaDetail: 'escolas',
      relatorio: 'relatorios', classReport: 'relatorios',
    }[getCurrentView()] || getCurrentView();
    root.dataset.context = config.key;
    root.innerHTML = `<div class="mobile-context-panel ${config.key === 'mais' ? 'is-system' : ''}" role="navigation" aria-label="${escapeHtml(config.label)}">
      ${destinations.map(item => `<button type="button" class="mobile-context-action ${item.key === activeView ? 'active' : ''}" data-mobile-context-view="${escapeHtml(item.key)}">${icons[item.icon]}<span>${escapeHtml(item.label)}</span></button>`).join('')}
    </div>`;
    root.classList.add('is-open');
    root.querySelectorAll('[data-mobile-context-view]').forEach(button => {
      button.addEventListener('click', () => {
        const view = button.dataset.mobileContextView;
        closeMobileContext();
        navigate(view);
      });
    });
  }

  function closeMobileContext() {
    const root = document.getElementById('mobileContextNav');
    if (!root) return;
    root.classList.remove('is-open');
    root.removeAttribute('data-context');
    root.replaceChildren();
  }

  function openMobileMenu() {
    const trigger = document.getElementById('mobileMenuTrigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    const state = getState();
    const teacherName = state?.teacher?.name?.trim() || 'Professor(a)';
    const school = '';
    const driveConnected = !!driveBindingForCurrentProject();
    const driveLabel = driveConnected ? 'Google Drive conectado' : 'Google Drive disponível';
    const mobileGroups = [
      { label: 'Aulas', keys: ['planejamento', 'calendario', 'atividades'] },
      { label: 'Acompanhamento', keys: ['ocorrencias', 'relatorios'] },
      { label: 'Organização', keys: ['turmas', 'alunos', 'escolas'] },
      { label: 'Sistema', keys: ['arquivo', 'configuracoes'] },
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
        <button type="button" class="mobile-menu-close" id="mobileMenuClose" aria-label="Fechar menu">${icons.x}</button>
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

  function navigate(view, resetCtx = true, { replace = false } = {}) {
    if (!view) return;
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
        bulkSelected: new Set(),
      });
    }
    setCurrentView(view);
    const route = routeFromState(view, getContext());
    const historyState = { professorgestRoute: route };
    if (replace || restoring || !getState()) history.replaceState(historyState, '', window.location.href);
    else {
      const currentHistoryRoute = history.state?.professorgestRoute;
      if (!currentHistoryRoute || JSON.stringify(currentHistoryRoute) !== JSON.stringify(route)) {
        history.pushState(historyState, '', window.location.href);
      } else history.replaceState(historyState, '', window.location.href);
    }
    persistRoute(route);
    syncActiveNavigation();
    render();
    window.scrollTo(0, 0);
  }

  function goBack(fallback = 'dashboard') {
    const hasPreviousRoute = !!history.state?.professorgestRoute || !!readPersistedRoute();
    if (hasPreviousRoute && history.length > 1) {
      history.back();
      return;
    }
    navigate(fallback);
  }

  function restoreWorkspaceRoute(routeOrDefault = 'dashboard') {
    if (routeOrDefault && typeof routeOrDefault === 'object' && routeOrDefault.view) return restoreRoute(routeOrDefault);
    const persisted = readPersistedRoute();
    const currentHistory = history.state?.professorgestRoute;
    const route = currentHistory || persisted;
    if (route?.view) return restoreRoute(route);
    navigate(routeOrDefault || 'dashboard', true, { replace: true });
    return false;
  }

  function getPersistedRoute() { return readPersistedRoute(); }
  function clearPersistedRoute() {
    lastRoute = null;
    try { sessionStorage.removeItem(ROUTE_KEY); } catch (_) {}
  }

  return {
    buildNav,
    navItemHTML,
    mobileMenuButton,
    mobileMenuDescription,
    openMobileMenu,
    closeMobileMenu,
    navigate,
    goBack,
    restoreWorkspaceRoute,
    syncActiveNavigation,
    persistRoute: () => persistRoute(routeFromState()),
    getPersistedRoute,
    clearPersistedRoute,
  };
}
