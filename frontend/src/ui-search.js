/**
 * Search field + entity picker presentation primitives.
 * All contextual searches in ProfessorGest use these classes so the same
 * interaction looks and behaves the same across lists, dialogs and reports.
 */
export function createSearchField({ id, placeholder = 'Pesquisar...', value = '', ariaLabel = '', extraClass = '' }) {
  const label = ariaLabel || placeholder;
  return `<div class="search-field ${extraClass}" data-search-field="${escapeAttr(id)}">
    <span class="search-field-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
    </span>
    <input class="form-input search-field-input" id="${escapeAttr(id)}" aria-label="${escapeAttr(label)}" autocomplete="off" placeholder="${escapeAttr(placeholder)}" value="${escapeAttr(value)}">
  </div>`;
}

export function createEntityPickerOption({ id, name, secondary = '', selected = false, icon = '', dataAttr = 'data-entity-id' }) {
  const safeIcon = icon || `<span class="entity-picker-avatar" aria-hidden="true">${initialLetters(name)}</span>`;
  return `<button type="button" class="entity-picker-option ${selected ? 'selected' : ''}" ${dataAttr}="${escapeAttr(id)}" aria-pressed="${selected ? 'true' : 'false'}">
    ${safeIcon}
    <span class="entity-picker-copy">
      <strong>${escapeHtml(name)}</strong>
      ${secondary ? `<small>${escapeHtml(secondary)}</small>` : ''}
    </span>
    ${selected ? `<span class="entity-picker-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 12l5 5L20 6"/></svg></span>` : ''}
  </button>`;
}

export function createEntityPickerEmpty(message) {
  return `<div class="entity-picker-empty">${escapeHtml(message)}</div>`;
}

function initialLetters(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase() || '').join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}
