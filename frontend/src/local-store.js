import { PRG_FORMAT, PRG_VERSION } from './prof-model.js';

export const LOCAL_DB_NAME = 'professorgest-local-prg-v1';
export const LOCAL_DB_VERSION = 3;
export const LOCAL_PROJECT_STORE = 'projects';
export const LOCAL_RECOVERY_STORE = 'recovery';
export const LOCAL_META_STORE = 'metadata';
export const LOCAL_BACKUP_STORE = 'backups';
export const LOCAL_PROJECT_KEY = 'active';
export const MAX_LOCAL_PROJECTS = 4;
export const MAX_LOCAL_BACKUPS_PER_PROJECT = 10;

function withDbTransaction(storeName, mode, operation) {
  return openLocalProjectDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = operation(store, tx);
    } catch (error) {
      try { db.close(); } catch (_) {}
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      try { db.close(); } catch (_) {}
      resolve(result);
    };
    tx.onerror = () => {
      const error = tx.error || new Error('Não foi possível concluir a operação de armazenamento.');
      try { db.close(); } catch (_) {}
      reject(error);
    };
    tx.onabort = () => {
      const error = tx.error || new Error('A operação de armazenamento foi cancelada.');
      try { db.close(); } catch (_) {}
      reject(error);
    };
  }));
}

export function openLocalProjectDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB não está disponível neste navegador.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_PROJECT_STORE)) db.createObjectStore(LOCAL_PROJECT_STORE);
      if (!db.objectStoreNames.contains(LOCAL_RECOVERY_STORE)) db.createObjectStore(LOCAL_RECOVERY_STORE);
      if (!db.objectStoreNames.contains(LOCAL_META_STORE)) db.createObjectStore(LOCAL_META_STORE);
      if (!db.objectStoreNames.contains(LOCAL_BACKUP_STORE)) db.createObjectStore(LOCAL_BACKUP_STORE);
    };
    request.onblocked = () => reject(new Error('O armazenamento local está bloqueado por outra aba. Feche a outra aba do ProfessorGest e tente novamente.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { try { db.close(); } catch (_) {} };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
  });
}

export async function writeLocalProjectRecord(record) {
  const key = record?.state?.projectId || record?.projectId || LOCAL_PROJECT_KEY;
  if (!record?.state || !key) return false;

  // Salvamentos podem terminar fora de ordem (por exemplo, uma gravação
  // automática e a persistência disparada por uma abertura/backup). Nunca
  // permita que uma versão mais antiga substitua uma mais nova no IndexedDB.
  const incomingSavedAt = Date.parse(record.savedAt || '') || 0;
  const safeRecord = {
    ...record,
    savedAt: record.savedAt || new Date().toISOString(),
    savedAtMs: incomingSavedAt || Date.now(),
  };

  await withDbTransaction(LOCAL_PROJECT_STORE, 'readwrite', store => {
    const request = store.get(key);
    request.onsuccess = () => {
      const existing = request.result;
      const existingSavedAt = Number(existing?.savedAtMs) || Date.parse(existing?.savedAt || '') || 0;
      const nextSavedAt = Number(safeRecord.savedAtMs) || 0;
      if (!existing || nextSavedAt >= existingSavedAt) {
        store.put(safeRecord, key);
      }
    };
  });
  await pruneLocalProjectRecords();
  return true;
}

export async function readLocalProjectRecordById(projectId) {
  if (!projectId) return null;
  try {
    const db = await openLocalProjectDb();
    return await new Promise(resolve => {
      const tx = db.transaction(LOCAL_PROJECT_STORE, 'readonly');
      const request = tx.objectStore(LOCAL_PROJECT_STORE).get(projectId);
      request.onsuccess = () => {
        const value = request.result?.state?.format === PRG_FORMAT ? request.result : null;
        try { db.close(); } catch (_) {}
        resolve(value);
      };
      request.onerror = () => {
        try { db.close(); } catch (_) {}
        resolve(null);
      };
    });
  } catch (_) {
    return null;
  }
}

export async function deleteLocalProjectRecord(projectId) {
  if (!projectId) return false;
  try {
    await withDbTransaction(LOCAL_PROJECT_STORE, 'readwrite', store => {
      store.delete(projectId);
    });
    return true;
  } catch (_) {
    return false;
  }
}

export async function readLocalProjectRecords(limit = MAX_LOCAL_PROJECTS) {
  try {
    const db = await openLocalProjectDb();
    return await new Promise(resolve => {
      const tx = db.transaction(LOCAL_PROJECT_STORE, 'readonly');
      const request = tx.objectStore(LOCAL_PROJECT_STORE).getAll();
      request.onsuccess = () => {
        const values = Array.isArray(request.result)
          ? request.result.filter(v => v?.state?.format === PRG_FORMAT)
          : [];
        values.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
        try { db.close(); } catch (_) {}
        resolve(values.slice(0, Math.max(1, Number(limit) || 50)));
      };
      request.onerror = () => {
        try { db.close(); } catch (_) {}
        resolve([]);
      };
    });
  } catch (_) {
    return [];
  }
}

export async function readLocalProjectRecord() {
  const records = await readLocalProjectRecords(1);
  return records[0] || null;
}

export async function clearLocalProjectRecords() {
  try {
    await withDbTransaction(LOCAL_PROJECT_STORE, 'readwrite', store => {
      store.clear();
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function pruneLocalProjectRecords(keep = MAX_LOCAL_PROJECTS) {
  const safeKeep = Math.max(1, Number(keep) || MAX_LOCAL_PROJECTS);
  try {
    const db = await openLocalProjectDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_PROJECT_STORE, 'readwrite');
      const store = tx.objectStore(LOCAL_PROJECT_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = (Array.isArray(request.result) ? request.result : [])
          .filter(record => record?.state?.format === PRG_FORMAT && Number(record.state.version) === PRG_VERSION)
          .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
        rows.slice(safeKeep).forEach(record => {
          const projectId = record?.state?.projectId || record?.projectId;
          if (projectId) store.delete(projectId);
        });
      };
      request.onerror = () => reject(request.error || new Error('Não foi possível verificar as versões locais.'));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Não foi possível limitar as versões locais.'));
      tx.onabort = () => reject(tx.error || new Error('A limpeza das versões locais foi cancelada.'));
    });
    try { db.close(); } catch (_) {}
  } catch (_) {}
}

export async function deleteRecoveryRecord(projectId) {
  if (!projectId) return false;
  try {
    await withDbTransaction(LOCAL_RECOVERY_STORE, 'readwrite', store => {
      store.delete(projectId);
    });
    return true;
  } catch (_) {
    return false;
  }
}

export async function writeRecoveryRecord(record) {
  if (!record?.state?.projectId) return false;
  try {
    await withDbTransaction(LOCAL_RECOVERY_STORE, 'readwrite', store => {
      store.put(record, record.state.projectId);
    });
    return true;
  } catch (_) {
    return false;
  }
}

export async function readRecoveryRecordById(projectId) {
  if (!projectId) return null;
  try {
    const db = await openLocalProjectDb();
    return await new Promise(resolve => {
      const tx = db.transaction(LOCAL_RECOVERY_STORE, 'readonly');
      const request = tx.objectStore(LOCAL_RECOVERY_STORE).get(projectId);
      request.onsuccess = () => {
        const value = request.result?.state?.format === PRG_FORMAT ? request.result : null;
        try { db.close(); } catch (_) {}
        resolve(value);
      };
      request.onerror = () => {
        try { db.close(); } catch (_) {}
        resolve(null);
      };
    });
  } catch (_) {
    return null;
  }
}

export async function readLatestRecoveryRecord() {
  try {
    const db = await openLocalProjectDb();
    return await new Promise(resolve => {
      const tx = db.transaction(LOCAL_RECOVERY_STORE, 'readonly');
      const request = tx.objectStore(LOCAL_RECOVERY_STORE).getAll();
      request.onsuccess = () => {
        const records = Array.isArray(request.result)
          ? request.result.filter(v => v?.state?.format === PRG_FORMAT)
          : [];
        records.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
        const latest = records[0] || null;
        try { db.close(); } catch (_) {}
        resolve(latest);
      };
      request.onerror = () => {
        try { db.close(); } catch (_) {}
        resolve(null);
      };
    });
  } catch (_) {
    return null;
  }
}


function backupRecordKey(record) {
  return record?.backupId || `${record?.state?.projectId || 'project'}:${record?.savedAt || Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export async function writeProjectBackup(record, keep = MAX_LOCAL_BACKUPS_PER_PROJECT) {
  if (!record?.state?.projectId) return false;
  const key = backupRecordKey(record);
  try {
    await withDbTransaction(LOCAL_BACKUP_STORE, 'readwrite', store => {
      store.put({ ...record, backupId: key }, key);
    });
    await pruneProjectBackups(record.state.projectId, keep);
    return true;
  } catch (_) {
    return false;
  }
}

export async function readAllProjectBackups(limit = 50) {
  try {
    const db = await openLocalProjectDb();
    return await new Promise(resolve => {
      const tx = db.transaction(LOCAL_BACKUP_STORE, 'readonly');
      const request = tx.objectStore(LOCAL_BACKUP_STORE).getAll();
      request.onsuccess = () => {
        const rows = Array.isArray(request.result)
          ? request.result.filter(record => record?.state?.format === PRG_FORMAT && Number(record.state.version) === PRG_VERSION)
          : [];
        rows.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
        try { db.close(); } catch (_) {}
        resolve(rows.slice(0, Math.max(1, Number(limit) || 50)));
      };
      request.onerror = () => {
        try { db.close(); } catch (_) {}
        resolve([]);
      };
    });
  } catch (_) {
    return [];
  }
}

export async function readProjectBackups(projectId, limit = MAX_LOCAL_BACKUPS_PER_PROJECT) {
  if (!projectId) return [];
  try {
    const db = await openLocalProjectDb();
    return await new Promise(resolve => {
      const tx = db.transaction(LOCAL_BACKUP_STORE, 'readonly');
      const request = tx.objectStore(LOCAL_BACKUP_STORE).getAll();
      request.onsuccess = () => {
        const rows = Array.isArray(request.result)
          ? request.result.filter(record => record?.state?.format === PRG_FORMAT && Number(record.state.version) === PRG_VERSION && record.state.projectId === projectId)
          : [];
        rows.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
        try { db.close(); } catch (_) {}
        resolve(rows.slice(0, Math.max(1, limit)));
      };
      request.onerror = () => {
        try { db.close(); } catch (_) {}
        resolve([]);
      };
    });
  } catch (_) {
    return [];
  }
}

export async function clearProjectBackups(projectId = null) {
  try {
    if (!projectId) {
      await withDbTransaction(LOCAL_BACKUP_STORE, 'readwrite', store => {
        store.clear();
      });
      return true;
    }
    const db = await openLocalProjectDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_BACKUP_STORE, 'readwrite');
      const store = tx.objectStore(LOCAL_BACKUP_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        (Array.isArray(request.result) ? request.result : [])
          .filter(record => record?.state?.projectId === projectId)
          .forEach(record => { if (record?.backupId) store.delete(record.backupId); });
      };
      request.onerror = () => reject(request.error || new Error('Não foi possível localizar as cópias.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Não foi possível limpar as cópias.'));
      tx.onabort = () => reject(tx.error || new Error('A limpeza das cópias foi cancelada.'));
    });
    try { db.close(); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

export async function clearAllLocalData() {
  try {
    const db = await openLocalProjectDb();
    await new Promise((resolve, reject) => {
      const stores = [LOCAL_PROJECT_STORE, LOCAL_RECOVERY_STORE, LOCAL_META_STORE, LOCAL_BACKUP_STORE];
      const tx = db.transaction(stores, 'readwrite');
      stores.forEach(name => tx.objectStore(name).clear());
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Não foi possível apagar os dados locais.'));
      tx.onabort = () => reject(tx.error || new Error('A limpeza dos dados foi cancelada.'));
    });
    try { db.close(); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

export async function deleteProjectBackup(backupId) {
  if (!backupId) return false;
  try {
    await withDbTransaction(LOCAL_BACKUP_STORE, 'readwrite', store => {
      store.delete(backupId);
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function pruneProjectBackups(projectId, keep) {
  if (!projectId) return;
  const safeKeep = Math.max(1, Number(keep) || MAX_LOCAL_BACKUPS_PER_PROJECT);
  try {
    const db = await openLocalProjectDb();
    await new Promise(resolve => {
      const tx = db.transaction(LOCAL_BACKUP_STORE, 'readwrite');
      const store = tx.objectStore(LOCAL_BACKUP_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = (Array.isArray(request.result) ? request.result : [])
          .filter(record => record?.state?.projectId === projectId)
          .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
        rows.slice(safeKeep).forEach(record => {
          if (record?.backupId) store.delete(record.backupId);
        });
      };
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = resolve;
    });
    try { db.close(); } catch (_) {}
  } catch (_) {}
}
