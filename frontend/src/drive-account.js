export const DRIVE_ACCOUNT_KEY = 'professorgest-drive-account-v1';

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanString(value, max = 500) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

export function normalizeDriveAccount(account) {
  const source = safeObject(account);
  const email = cleanString(source.email, 320)?.toLowerCase() || null;
  const permissionId = cleanString(source.permissionId, 200);
  const displayName = cleanString(source.displayName, 200);
  const photoLink = cleanString(source.photoLink, 2000);

  if (!email && !permissionId) return null;

  return {
    displayName: displayName || email || 'Conta Google',
    email,
    photoLink,
    permissionId,
    lastVerifiedAt: cleanString(source.lastVerifiedAt, 40),
  };
}

export function readDriveAccount(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(DRIVE_ACCOUNT_KEY);
    return { account: normalizeDriveAccount(raw ? JSON.parse(raw) : null) };
  } catch (_) {
    return { account: null };
  }
}

export function writeDriveAccount(account, storage = globalThis.localStorage) {
  try {
    if (!account) {
      storage?.removeItem(DRIVE_ACCOUNT_KEY);
      return true;
    }
    const normalized = normalizeDriveAccount(account);
    if (!normalized) {
      storage?.removeItem(DRIVE_ACCOUNT_KEY);
      return true;
    }
    storage?.setItem(DRIVE_ACCOUNT_KEY, JSON.stringify(normalized));
    return true;
  } catch (_) {
    return false;
  }
}

export function clearDriveAccount(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(DRIVE_ACCOUNT_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Estado de autorização exibido na interface. O token NUNCA é persistido;
 * só a identidade (nome, e-mail, foto, permissionId) fica lembrada.
 *   none        -> nenhuma conta lembrada
 *   remembered  -> conta lembrada, ainda sem autorização nesta sessão
 *   authorized  -> token válido em memória
 *   expired     -> havia autorização, mas o token expirou (renovação silenciosa possível)
 *   reconnect   -> o Google exige interação do usuário (sem popup automático)
 */
export const DRIVE_AUTH_STATES = Object.freeze({
  NONE: 'none', REMEMBERED: 'remembered', AUTHORIZED: 'authorized', EXPIRED: 'expired', RECONNECT: 'reconnect',
});

export function driveAuthState({ account = null, hasToken = false, tokenExpiresAt = 0, needsInteraction = false, now = Date.now() } = {}) {
  if (!account) return DRIVE_AUTH_STATES.NONE;
  if (needsInteraction) return DRIVE_AUTH_STATES.RECONNECT;
  if (hasToken && Number(tokenExpiresAt) > now + 30_000) return DRIVE_AUTH_STATES.AUTHORIZED;
  if (hasToken) return DRIVE_AUTH_STATES.EXPIRED;
  return DRIVE_AUTH_STATES.REMEMBERED;
}

export const DRIVE_AUTH_LABELS = Object.freeze({
  none: 'Nenhuma conta Google conectada',
  remembered: 'Conta lembrada neste dispositivo',
  authorized: 'Autorização disponível',
  expired: 'Autorização expirada',
  reconnect: 'É preciso reconectar a conta',
});
