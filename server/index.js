import cors from 'cors'
import 'dotenv/config'
import express from 'express'
import { callAi } from './ai.js'
import { db, databaseInfo } from './db.js'

const app = express()
const PORT = Number(process.env.API_PORT || 3001)
const allowedStores = new Set(['documents', 'tasks', 'exports'])

app.use(cors())
app.use(express.json({ limit: '80mb' }))

const assertStore = (storeName) => {
  if (!allowedStores.has(storeName)) {
    const error = new Error('未知数据表')
    error.status = 404
    throw error
  }
}

const parseRow = (row) => JSON.parse(row.value)

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    database: databaseInfo.path,
    stores: Array.from(allowedStores),
  })
})

app.post('/api/ai', async (req, res, next) => {
  try {
    const result = await callAi(req.body || {})
    res.json(result)
  } catch (error) {
    next(error)
  }
})

app.get('/api/:store', (req, res, next) => {
  try {
    const { store } = req.params
    assertStore(store)
    const rows = db.prepare(`SELECT value FROM ${store} ORDER BY updated_at DESC`).all()
    res.json(rows.map(parseRow))
  } catch (error) {
    next(error)
  }
})

app.put('/api/:store/:id', (req, res, next) => {
  try {
    const { store, id } = req.params
    assertStore(store)
    const value = { ...req.body, id: req.body?.id ?? id }
    db.prepare(`
      INSERT INTO ${store} (id, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `).run(String(value.id), JSON.stringify(value))
    res.json(value)
  } catch (error) {
    next(error)
  }
})

app.post('/api/:store/bulk', (req, res, next) => {
  try {
    const { store } = req.params
    assertStore(store)
    const values = Array.isArray(req.body) ? req.body : []
    const statement = db.prepare(`
      INSERT INTO ${store} (id, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `)
    const saveMany = db.transaction((items) => {
      items.forEach((value) => statement.run(String(value.id), JSON.stringify(value)))
    })
    saveMany(values)
    res.json(values)
  } catch (error) {
    next(error)
  }
})

app.delete('/api/:store/:id', (req, res, next) => {
  try {
    const { store, id } = req.params
    assertStore(store)
    db.prepare(`DELETE FROM ${store} WHERE id = ?`).run(String(id))
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.use((error, req, res, next) => {
  res.status(error.status || 500).json({
    error: error.message || '服务器错误',
  })
})

app.listen(PORT, () => {
  console.log(`API server running at http://127.0.0.1:${PORT}`)
  console.log(`SQLite database ${databaseInfo.path}`)
})
