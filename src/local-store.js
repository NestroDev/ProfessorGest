import { PROF_FORMAT, CURRENT_VERSION } from './prof-model.js';

export const LOCAL_DB_NAME = 'professorgest-local-v2';
export const LOCAL_DB_VERSION = 2;
export const LOCAL_PROJECT_STORE = 'projects';
export const LOCAL_RECOVERY_STORE = 'recovery';
export const LOCAL_META_STORE = 'metadata';
export const LOCAL_PROJECT_KEY = 'active';

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
  return withDbTransaction(LOCAL_PROJECT_STORE, 'readwrite', store => {
    store.put(record, key);
  }).then(() => true);
}

export async function readLocalProjectRecordById(projectId) {
  if (!projectId) return null;
  try {
    const db = await openLocalProjectDb();
    return await new Promise(resolve => {
      const tx = db.transaction(LOCAL_PROJECT_STORE, 'readonly');
      const request = tx.objectStore(LOCAL_PROJECT_STORE).get(projectId);
      request.onsuccess = () => {
        const value = request.result?.state?.format === PROF_FORMAT && Number(request.result?.state?.version) === CURRENT_VERSION ? request.result : null;
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

export async function readLocalProjectRecord() {
  try {
    const db = await openLocalProjectDb();
    return await new Promise(resolve => {
      const tx = db.transaction(LOCAL_PROJECT_STORE, 'readonly');
      const request = tx.objectStore(LOCAL_PROJECT_STORE).getAll();
      request.onsuccess = () => {
        const values = Array.isArray(request.result)
          ? request.result.filter(v => v?.state?.format === PROF_FORMAT && Number(v?.state?.version) === CURRENT_VERSION)
          : [];
        values.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
        const value = values[0] || null;
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
        const value = request.result?.state?.format === PROF_FORMAT && Number(request.result?.state?.version) === CURRENT_VERSION ? request.result : null;
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
          ? request.result.filter(v => v?.state?.format === PROF_FORMAT && Number(v?.state?.version) === CURRENT_VERSION)
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
