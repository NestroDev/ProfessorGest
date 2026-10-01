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
