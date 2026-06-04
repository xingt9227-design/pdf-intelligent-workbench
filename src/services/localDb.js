const DB_NAME = 'pdf-intelligent-workbench'
const DB_VERSION = 1

const STORES = {
  documents: 'documents',
  tasks: 'tasks',
  exports: 'exports',
}

let dbPromise

const openDb = () => {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      Object.values(STORES).forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' })
        }
      })
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return dbPromise
}

const runStore = async (storeName, mode, action) => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    const request = action(store)

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const localDb = {
  async list(storeName) {
    return runStore(storeName, 'readonly', (store) => store.getAll())
  },

  async put(storeName, value) {
    await runStore(storeName, 'readwrite', (store) => store.put(value))
    return value
  },

  async putMany(storeName, values) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      values.forEach((value) => store.put(value))
      transaction.oncomplete = () => resolve(values)
      transaction.onerror = () => reject(transaction.error)
    })
  },

  async remove(storeName, id) {
    await runStore(storeName, 'readwrite', (store) => store.delete(id))
  },

  stores: STORES,
}
