export const DRIVE_BINDINGS_KEY = 'professorgest-drive-bindings-v3';

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function readDriveBindings(storage = globalThis.localStorage) {
  let bindings = {};

  try {
    const raw = storage?.getItem(DRIVE_BINDINGS_KEY);
    bindings = safeObject(raw ? JSON.parse(raw) : {});
  } catch (_) {
    bindings = {};
  }

  return { bindings };
}

export function writeDriveBindings(bindings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(DRIVE_BINDINGS_KEY, JSON.stringify(safeObject(bindings)));
    return true;
  } catch (_) {
    return false;
  }
}

export function normalizeDriveBinding(binding, projectId) {
  const resolvedProjectId = binding?.projectId || projectId;
  if (!resolvedProjectId || !binding?.fileId) return null;

  return {
    projectId: String(resolvedProjectId),
    fileId: String(binding.fileId),
    name: binding.name ? String(binding.name) : null,
    modifiedTime: binding.modifiedTime || null,
    lastSyncAt: binding.lastSyncAt || null,
    accountPermissionId: binding.accountPermissionId ? String(binding.accountPermissionId) : null,
    accountEmail: binding.accountEmail ? String(binding.accountEmail).trim().toLowerCase() : null,
  };
}

export function setDriveBinding(bindings, binding, projectId) {
  const normalized = normalizeDriveBinding(binding, projectId);
  if (!normalized) {
    return { bindings: safeObject(bindings), binding: null };
  }

  const next = { ...safeObject(bindings), [normalized.projectId]: normalized };
  return { bindings: next, binding: normalized };
}

export function removeDriveBinding(bindings, projectId) {
  const next = { ...safeObject(bindings) };
  if (projectId) delete next[String(projectId)];
  return next;
}

export function getDriveBinding(bindings, projectId) {
  if (!projectId) return null;

  const binding = safeObject(bindings)[String(projectId)];
  return binding?.projectId === String(projectId) && binding?.fileId ? binding : null;
}
