// Local IndexedDB vault for saved cutouts

export interface HistoryItem {
  id: string
  name: string
  timestamp: number
  dataUrl: string
  width: number
  height: number
  duration: string
  /**
   * How this cutout was made, as a `.remove` recipe.
   *
   * The vault used to hold pixels and nothing else, which makes every entry a
   * dead end: you cannot re-cut it with a better model, cannot see what
   * settings produced it, and cannot send the treatment on. Storing the recipe
   * beside the image makes a vault entry something you can return to — and it
   * is a few hundred bytes against a multi-megabyte PNG.
   *
   * Optional because entries saved before this existed do not have one, and a
   * vault that drops its own history on an upgrade is worse than one that
   * carries a null.
   */
  recipe?: unknown
}

const DB_NAME = "remove_free_db"
const STORE_NAME = "cutouts"
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not supported"))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveToHistory(item: HistoryItem): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(item)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.warn("Could not save to IndexedDB:", e)
  }
}

export async function getHistory(): Promise<HistoryItem[]> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, "readonly")
    const request = tx.objectStore(STORE_NAME).getAll()
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const results: HistoryItem[] = request.result || []
        // Sort descending by timestamp
        results.sort((a, b) => b.timestamp - a.timestamp)
        resolve(results)
      }
      request.onerror = () => reject(request.error)
    })
  } catch (e) {
    console.warn("Could not load history from IndexedDB:", e)
    return []
  }
}

export async function deleteHistoryItem(id: string): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).delete(id)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.warn("Could not delete from IndexedDB:", e)
  }
}

export async function clearAllHistory(): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).clear()
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.warn("Could not clear IndexedDB:", e)
  }
}

export const clearHistory = clearAllHistory

