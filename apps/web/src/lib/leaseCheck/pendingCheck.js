/*
 * A lease picked by a signed-out visitor, held until they sign in.
 *
 * Signing in or up leaves the page (Google is a full redirect, password sign-in
 * reloads via window.location, email verification goes through an inbox link), so
 * the files have to outlive the page the same way lib/listings/pendingDraft does for
 * Add Listing. Unlike that draft these are the files themselves, which is why this
 * uses IndexedDB (it stores File objects as-is, and has room for a 32MB lease) instead
 * of localStorage.
 *
 * The lease stays in the visitor's own browser until they are signed in. Nothing is
 * uploaded to R2 before then: the lease-check bucket is publicly readable, so an
 * upload abandoned at the sign-in step would otherwise sit there, holding a student's
 * name and home address, until the hourly cleanup cron removed it.
 *
 * Deliberately NOT keyed by user: it's written before anyone is signed in. MAX_AGE_MS
 * keeps a shared computer from holding someone's lease indefinitely.
 *
 * Every access is wrapped. Private windows and blocked site data throw on storage
 * access, and the flow must still work (just without surviving a reload).
 */

const DB_NAME = "proximity";
const STORE = "pending-lease-check";
const RECORD_KEY = "current";
const VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Runs one request against the store and resolves with its result once the
// transaction has committed.
async function withStore(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Resolves true if the files were saved, false if this browser won't allow it. */
export async function savePendingCheck(files) {
  try {
    await withStore("readwrite", (store) =>
      store.put({ v: VERSION, savedAt: Date.now(), files: Array.from(files) }, RECORD_KEY)
    );
    return true;
  } catch {
    return false;
  }
}

/** The saved files, or null if there are none, they are stale, or unreadable. */
export async function loadPendingCheck() {
  try {
    const record = await withStore("readonly", (store) => store.get(RECORD_KEY));
    if (!record) return null;
    const fresh = Date.now() - (record.savedAt ?? 0) < MAX_AGE_MS;
    if (
      record.v !== VERSION ||
      !fresh ||
      !Array.isArray(record.files) ||
      record.files.length === 0
    ) {
      await clearPendingCheck();
      return null;
    }
    return record.files;
  } catch {
    return null;
  }
}

export async function clearPendingCheck() {
  try {
    await withStore("readwrite", (store) => store.delete(RECORD_KEY));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
