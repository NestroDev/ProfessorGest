/**
 * Tela inicial: gerenciador de projetos ("Seus projetos").
 * Funções puras (retornam HTML/dados) para serem testáveis sem DOM.
 */
import { SYNC_STATUS, syncLabel } from './drive-sync.js';

const TONES = Object.freeze({
  'local-only': 'neutral', syncing: 'info', synced: 'ok', pending: 'warn', 'remote-newer': 'info',
  conflict: 'danger', reconnect: 'warn', offline: 'neutral', 'remote-missing': 'danger', 'drive-only': 'info',
});

export function statusTone(status) { return TONES[status] || 'neutral'; }

/** Estados que pedem atenção do professor (aparecem no filtro "Precisam de atenção"). */
export function needsAttention(status, { hasRecovery = false } = {}) {
  return hasRecovery || [SYNC_STATUS.CONFLICT, SYNC_STATUS.RECONNECT, SYNC_STATUS.REMOTE_MISSING, SYNC_STATUS.REMOTE_NEWER].includes(status);
}

export function normalizeSearch(text) {
  return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function entryName(entry) {
  return entry.meta?.name || entry.remote?.name?.replace(/\.prg$/i, '') || 'Projeto sem nome';
}

export function filterEntries(entries, query) {
  const q = normalizeSearch(query);
  if (!q) return entries;
  return entries.filter(e => normalizeSearch([entryName(e), e.meta?.teacherName, e.remote?.name].join(' ')).includes(q));
}

export function splitEntries(entries) {
  return {
    local: entries.filter(e => e.kind !== 'drive-only'),
    driveOnly: entries.filter(e => e.kind === 'drive-only'),
  };
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

/** "hoje às 13:55", "ontem", "há 3 dias" ou a data curta. */
export function relativeTime(iso, { now = Date.now(), fallback = v => v } = {}) {
  const ms = Date.parse(iso || '');
  if (!ms) return '';
  const d = new Date(ms); const n = new Date(now);
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(n) - startOf(d)) / 86400000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (days <= 0) return `hoje às ${hm}`;
  if (days === 1) return `ontem às ${hm}`;
  if (days < 7) return `há ${days} dias`;
  return fallback(iso);
}

export function projectCardHTML(entry, { esc, ICONS = {}, formatTime = v => v, status = SYNC_STATUS.LOCAL_ONLY, hasRecovery = false, busy = false, latest = false, variant = 'row', now = Date.now() } = {}) {
  const isDriveOnly = entry.kind === 'drive-only';
  const name = esc(entryName(entry));
  const tone = statusTone(status);
  const id = esc(entry.projectId || '');
  const fileId = esc(entry.remote?.id || '');
  const when = relativeTime(isDriveOnly ? entry.remote?.modifiedTime : entry.meta.updatedAt, { now, fallback: formatTime });
  const badges = [];
  if (entry.kind === 'local+drive') badges.push('<span class="project-badge drive">Google Drive</span>');
  if (hasRecovery) badges.push('<span class="project-badge recovery">Recuperação disponível</span>');

  let stats;
  if (isDriveOnly) stats = `<span>Atualizado ${esc(when)}</span>`;
  else if (!entry.meta.classCount && !entry.meta.studentCount) stats = `<span>Projeto vazio</span><span>Atualizado ${esc(when)}</span>`;
  else stats = `<span>${plural(entry.meta.classCount || 0, 'turma', 'turmas')}</span><span>${plural(entry.meta.studentCount || 0, 'aluno', 'alunos')}</span><span>Atualizado ${esc(when)}</span>`;
  const teacher = !isDriveOnly && entry.meta.teacherName ? `<span class="project-teacher">${esc(entry.meta.teacherName)}</span>` : '';
  const statusText = isDriveOnly ? syncLabel(SYNC_STATUS.DRIVE_ONLY) : (entry.kind === 'local' && status === SYNC_STATUS.LOCAL_ONLY ? 'Salvo neste dispositivo' : syncLabel(status));
  const statusTone_ = isDriveOnly ? 'info' : (entry.kind === 'local' && status === SYNC_STATUS.LOCAL_ONLY ? 'ok' : tone);
  const statusLine = `<span class="project-sync tone-${statusTone_}"><span class="status-dot"></span>${esc(statusText)}</span>`;
  const icon = isDriveOnly ? (ICONS.cloud || '') : (ICONS.folder || ICONS.file || '');
  const more = `<button type="button" class="btn-ghost btn-sm project-more" data-project-actions="${id}" aria-label="Mais ações do projeto ${name}" aria-haspopup="dialog" title="Mais ações">${ICONS.more || '⋯'}</button>`;

  if (isDriveOnly) {
    return `<article class="project-card project-row is-drive-only" data-project-card="${fileId}">
      <div class="project-card-main">
        <span class="project-card-icon" aria-hidden="true">${icon}</span>
        <span class="project-card-copy"><span class="project-name">${name}</span><span class="project-stats">${stats}</span></span>
        ${statusLine}
      </div>
      <button type="button" class="btn-secondary btn-sm" data-add-drive-project="${fileId}" ${busy ? 'disabled' : ''}>${ICONS.cloud || ''} Adicionar a este dispositivo</button>
    </article>`;
  }

  if (variant === 'feature') {
    return `<article class="project-card project-feature" data-project-card="${id}">
      <button type="button" class="project-card-main project-open" data-open-project="${id}" aria-label="Abrir projeto ${name}">
        ${latest ? '<span class="project-feature-label">Mais recente</span>' : '<span class="project-feature-label">Seu projeto</span>'}
        <span class="project-name">${name}</span>
        ${teacher}
        <span class="project-stats">${stats}</span>
        <span class="project-feature-foot">
          ${statusLine}
          ${badges.length ? `<span class="project-badges">${badges.join('')}</span>` : ''}
          <span class="project-feature-open">Abrir projeto <span aria-hidden="true">→</span></span>
        </span>
      </button>
      ${more}
    </article>`;
  }

  return `<article class="project-card project-row" data-project-card="${id}">
      <button type="button" class="project-card-main project-open" data-open-project="${id}" aria-label="Abrir projeto ${name}">
        <span class="project-card-icon" aria-hidden="true">${icon}</span>
        <span class="project-card-copy">
          <span class="project-name">${name}</span>
          <span class="project-stats">${stats}</span>
        </span>
        ${badges.length ? `<span class="project-badges">${badges.join('')}</span>` : ''}
        ${statusLine}
        <span class="project-chevron" aria-hidden="true">›</span>
      </button>
      ${more}
    </article>`;
}

/** Estado vazio guiado: dois caminhos principais (DED+ primeiro) e atalhos discretos. */
export function startCardsHTML({ ICONS = {}, esc = v => v } = {}) {
  const card = (key, title, text, icon, primary = false, badge = '') => `
    <button type="button" class="start-card${primary ? ' primary' : ''}" data-start="${key}">
      <span class="start-card-icon" aria-hidden="true">${icon}</span>
      <span class="start-card-copy"><strong>${esc(title)}${badge ? `<em>${esc(badge)}</em>` : ''}</strong><small>${esc(text)}</small></span>
      <span class="start-card-arrow" aria-hidden="true">→</span>
    </button>`;
  return `<div class="start-panel">
    <h2 class="start-title">Como você quer começar?</h2>
    <div class="start-grid">
      ${card('ded', 'Importar do DED+', 'Envie os PDFs das suas turmas e o projeto já nasce com turmas e alunos.', ICONS.refresh || '', true, 'Mais rápido')}
      ${card('blank', 'Projeto em branco', 'Comece do zero e cadastre turmas e alunos manualmente.', ICONS.plus || '')}
    </div>
    <div class="start-links">
      <button type="button" class="start-link" data-start="import">${ICONS.folder || ''} Abrir um arquivo de projeto</button>
      <button type="button" class="start-link" data-start="demo">${ICONS.sparkle || ''} Ver a demonstração</button>
    </div>
  </div>`;
}

export function projectsListHTML(entries, ctx) {
  const { esc, query = '', driveListing = null, statusFor, recoveryIds = new Set() } = ctx;
  const filtered = filterEntries(entries, query);
  const { local, driveOnly } = splitEntries(filtered);
  const latestId = local.length > 1 && !query ? local[0].projectId : null;
  const card = (e, variant = 'row') => projectCardHTML(e, { ...ctx, variant, status: e.kind === 'drive-only' ? SYNC_STATUS.DRIVE_ONLY : statusFor(e), hasRecovery: recoveryIds.has(e.projectId), latest: e.projectId === latestId && e.kind !== 'drive-only' });
  const total = splitEntries(entries).local.length;

  let html = '';
  if (!total && !driveOnly.length) {
    html += startCardsHTML({ ICONS: ctx.ICONS, esc });
  } else if (!local.length && query) {
    html += `<div class="projects-empty"><strong>Nenhum projeto encontrado.</strong><span>Tente outro termo de busca.</span></div>`;
  } else if (query) {
    html += `<div class="project-rows">${local.map(e => card(e)).join('')}</div>`;
  } else if (local.length) {
    const [first, ...rest] = local;
    html += card(first, 'feature');
    if (rest.length) {
      html += `<div class="projects-section-title">Outros projetos <small>${rest.length}</small></div>
        <div class="project-rows">${rest.map(e => card(e)).join('')}</div>`;
    }
  }
  if (driveOnly.length) {
    html += `<div class="projects-section-title">Somente no Google Drive <small>${plural(driveOnly.length, 'projeto', 'projetos')}</small></div>
      <div class="project-rows">${driveOnly.map(e => card(e)).join('')}</div>`;
  }
  if (driveListing?.message) {
    html += `<div class="projects-note tone-${esc(driveListing.tone || 'neutral')}">${esc(driveListing.message)}</div>`;
  }
  return html;
}

/** Texto e tom do cartão da conta Google (configuração de nuvem, não ação principal). */
export function cloudAccountSummary({ configured, account, authState }) {
  if (!configured) return { title: 'Google Drive', meta: 'Não configurado', tone: 'neutral' };
  if (!account) return { title: 'Google Drive', meta: 'Conectar conta', tone: 'neutral' };
  const labels = { remembered: 'Conta lembrada', authorized: 'Autorização disponível', expired: 'Autorização expirada', reconnect: 'Reconexão necessária' };
  const tones = { remembered: 'neutral', authorized: 'ok', expired: 'warn', reconnect: 'warn' };
  return {
    title: account.displayName || account.email || 'Conta Google',
    meta: `${account.email || ''}${account.email ? ' · ' : ''}${labels[authState] || labels.remembered}`,
    tone: tones[authState] || 'neutral',
  };
}
