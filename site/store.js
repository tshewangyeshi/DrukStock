// Tiny IndexedDB key-value store for the founder log and the running
// interview (eng D35/ER-D11). Falls back to memory if IndexedDB is missing.

const DB = 'drukstock-demo';
const STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function createStore() {
  if (typeof indexedDB === 'undefined') {
    const mem = new Map();
    return {
      get: async k => structuredClone(mem.get(k)),
      set: async (k, v) => void mem.set(k, structuredClone(v)),
      del: async k => void mem.delete(k),
    };
  }
  const db = await open();
  const tx = (mode, fn) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
  return {
    get: k => tx('readonly', s => s.get(k)),
    set: (k, v) => tx('readwrite', s => s.put(v, k)),
    del: k => tx('readwrite', s => s.delete(k)),
  };
}

// Ask the browser to keep this data (eng D35); returns whether it agreed.
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
