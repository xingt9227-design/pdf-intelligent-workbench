const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:3001/api'

const STORES = {
  documents: 'documents',
  tasks: 'tasks',
  exports: 'exports',
}

const encodeBinaryFields = (value) => {
  if (!value || typeof value !== 'object') return value
  const nextValue = { ...value }
  if (nextValue.bytes instanceof ArrayBuffer) {
    nextValue.bytes = Array.from(new Uint8Array(nextValue.bytes))
    nextValue.bytesEncoding = 'uint8-array'
  }
  if (nextValue.blob instanceof Blob) {
    delete nextValue.blob
    nextValue.blobOmitted = true
  }
  return nextValue
}

const decodeBinaryFields = (value) => {
  if (!value || typeof value !== 'object') return value
  const nextValue = { ...value }
  if (nextValue.bytesEncoding === 'uint8-array' && Array.isArray(nextValue.bytes)) {
    nextValue.bytes = new Uint8Array(nextValue.bytes).buffer
  }
  return nextValue
}

const requestJson = async (url, options) => {
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `数据库请求失败 ${response.status}`)
  }
  if (response.status === 204) return null
  return response.json()
}

export const localDb = {
  async list(storeName) {
    const values = await requestJson(`${API_BASE}/${storeName}`)
    return values.map(decodeBinaryFields)
  },

  async put(storeName, value) {
    const encoded = encodeBinaryFields(value)
    const saved = await requestJson(`${API_BASE}/${storeName}/${encodeURIComponent(encoded.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encoded),
    })
    return decodeBinaryFields(saved)
  },

  async putMany(storeName, values) {
    const encoded = values.map(encodeBinaryFields)
    const saved = await requestJson(`${API_BASE}/${storeName}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encoded),
    })
    return saved.map(decodeBinaryFields)
  },

  async remove(storeName, id) {
    await requestJson(`${API_BASE}/${storeName}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },

  stores: STORES,
}
