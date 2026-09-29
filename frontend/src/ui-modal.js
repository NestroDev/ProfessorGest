export function createModalController({ icons, escapeHtml, bindEvents, getMobileMenuCloser }) {
  let modalPreviousFocus = null;

  function openModal(html, wide = false, extraClass = '') {
    const active = document.activeElement;
    modalPreviousFocus = active instanceof HTMLElement ? active : null;
    const root = document.getElementById('modalRoot');
    if (!root) return;

    root.innerHTML = `<div class="modal-overlay" id="modalOverlay"><div class="modal-box ${wide ? 'wide' : ''} ${extraClass}" role="dialog" aria-modal="true" aria-labelledby="modalTitle" tabindex="-1">${html}</div></div>`;
    const title = root.querySelector('.modal-title');
    if (title) title.id = 'modalTitle';
    else root.querySelector('.modal-box')?.setAttribute('aria-label', 'Diálogo do ProfessorGest');

    root.querySelector('#modalOverlay')?.addEventListener('mousedown', event => {
      if (event.target?.id !== 'modalOverlay') return;
      if (root.querySelector('.mobile-menu-box')) getMobileMenuCloser()?.();
      else closeModal();
    });

    bindEvents();

    const firstFocusable = root.querySelector('.modal-box input, .modal-box textarea, .modal-box select, .modal-box button, .modal-box [href], .modal-box [tabindex]:not([tabindex="-1"])');
    (firstFocusable || root.querySelector('.modal-box'))?.focus();
  }

  function closeModal() {
    const root = document.getElementById('modalRoot');
    if (root) root.innerHTML = '';
    if (modalPreviousFocus && document.contains(modalPreviousFocus)) modalPreviousFocus.focus();
    modalPreviousFocus = null;
  }

  function rerenderModalKeepFocus(renderFn) {
    const active = document.activeElement;
    const id = active?.id || '';
    const start = typeof active?.selectionStart === 'number' ? active.selectionStart : null;
    const end = typeof active?.selectionEnd === 'number' ? active.selectionEnd : null;
    renderFn();
    if (!id) return;
    const element = document.getElementById(id);
    if (!element) return;
    element.focus();
    if (start !== null && typeof element.setSelectionRange === 'function') {
      try { element.setSelectionRange(start, end); } catch (_) {}
    }
  }

  function showFileErrorModal(message, details = []) {
    const detailItems = Array.isArray(details) && details.length
      ? `<ul class="confirm-detail-list">${details.slice(0, 8).map(item => `<li><span>Problema</span><strong>${escapeHtml(item)}</strong></li>`).join('')}</ul>`
      : '';
    openModal(`
      <div class="confirm-icon danger">${icons.alert}</div>
      <div class="modal-title">Não foi possível abrir este arquivo</div>
      <p class="confirm-body confirm-body-spaced">${escapeHtml(message)}</p>
      ${detailItems}
      <div class="form-actions"><button type="button" class="btn-primary" id="modalCancel">Entendi</button></div>
    `);
  }

  function confirmModal({ title, body, detailList, confirmLabel, danger, onConfirm }) {
    openModal(`
      <div class="confirm-icon ${danger ? 'danger' : 'info'}">${danger ? icons.trash : icons.alert}</div>
      <div class="modal-title">${escapeHtml(title)}</div>
      <p class="confirm-body">${escapeHtml(body)}</p>
      ${detailList && detailList.length ? `<ul class="confirm-detail-list">${detailList.map(([key, value]) => `<li><span>${escapeHtml(key)}</span><strong>${escapeHtml(String(value))}</strong></li>`).join('')}</ul>` : ''}
      <div class="form-actions">
        <button type="button" class="btn-secondary" id="modalCancel">Cancelar</button>
        <button type="button" class="${danger ? 'btn-danger-solid' : 'btn-primary'}" id="confirmModalOk">${escapeHtml(confirmLabel || 'Confirmar')}</button>
      </div>
    `);
    document.getElementById('confirmModalOk')?.addEventListener('click', () => {
      closeModal();
      onConfirm();
    }, { once: true });
  }

  return { openModal, closeModal, rerenderModalKeepFocus, showFileErrorModal, confirmModal };
}
