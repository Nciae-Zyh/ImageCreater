import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import fs from 'fs'
import { getUserDataDir, getDatabasePath, getImagesDir, getImageFilePath } from '../utils/paths'

let db: SqlJsDatabase | null = null
let IMAGES_DIR = ''

export async function initDatabase(): Promise<void> {
  IMAGES_DIR = getImagesDir()
  const dbPath = getDatabasePath()

  const SQL = await initSqlJs({
    locateFile: (file: string) => {
      const candidates = [
        require('path').join(__dirname, '../../node_modules/sql.js/dist', file),
        require('path').join(__dirname, '../../../node_modules/sql.js/dist', file)
      ]
      for (const p of candidates) {
        if (fs.existsSync(p)) return p
      }
      return require('path').join(__dirname, '../../node_modules/sql.js/dist', file)
    }
  })

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'text',
      image_url TEXT,
      image_data TEXT,
      metadata TEXT,
      timestamp INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS image_tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      image_url TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  saveDatabase()
}

function saveDatabase(): void {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(getDatabasePath(), buffer)
}

function getDb(): SqlJsDatabase {
  if (!db) throw new Error('数据库未初始化')
  return db
}

// 对话操作
export function saveConversation(conv: {
  id: string; title: string; providerId: string; model: string; createdAt: number; updatedAt: number
}): void {
  const d = getDb()
  d.run(
    `INSERT OR REPLACE INTO conversations (id, title, provider_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [conv.id, conv.title, conv.providerId, conv.model, conv.createdAt, conv.updatedAt]
  )
  saveDatabase()
}

export function getAllConversations(): any[] {
  const d = getDb()
  const results = d.exec('SELECT * FROM conversations ORDER BY updated_at DESC')
  if (results.length === 0) return []
  const cols = results[0].columns
  return results[0].values.map((row) => {
    const obj: any = {}; cols.forEach((col, i) => { obj[col] = row[i] }); return obj
  })
}

export function deleteConversation(id: string): void {
  const d = getDb()
  d.run('DELETE FROM messages WHERE conversation_id = ?', [id])
  d.run('DELETE FROM conversations WHERE id = ?', [id])
  saveDatabase()
}

export function deleteMessage(conversationId: string, messageId: string): void {
  const d = getDb()
  d.run('DELETE FROM messages WHERE id = ? AND conversation_id = ?', [messageId, conversationId])
  saveDatabase()
}

// 消息操作
export function saveMessage(msg: {
  id: string; conversationId: string; role: string; content: string; type: string;
  imageUrl?: string; imageData?: string; metadata?: string; timestamp: number
}): void {
  const d = getDb()
  d.run(
    `INSERT OR REPLACE INTO messages (id, conversation_id, role, content, type, image_url, image_data, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [msg.id, msg.conversationId, msg.role, msg.content, msg.type,
     msg.imageUrl || null, msg.imageData || null, msg.metadata || null, msg.timestamp]
  )
  saveDatabase()
}

export function getMessages(conversationId: string): any[] {
  const d = getDb()
  const results = d.exec('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC', [conversationId])
  if (results.length === 0) return []
  const cols = results[0].columns
  return results[0].values.map((row) => {
    const obj: any = {}; cols.forEach((col, i) => { obj[col] = row[i] }); return obj
  })
}

export function updateMessage(id: string, content: string): void {
  const d = getDb()
  d.run('UPDATE messages SET content = ? WHERE id = ?', [content, id])
  saveDatabase()
}

// 图片存储
export function saveImageToDisk(conversationId: string, messageId: string, base64Data: string, mimeType: string = 'image/png'): string {
  const ext = mimeType.split('/')[1] || 'png'
  const filepath = getImageFilePath(conversationId, messageId, ext)
  fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'))
  return filepath
}

export function getImagePath(conversationId: string, messageId: string): string | null {
  const files = fs.readdirSync(IMAGES_DIR)
  const match = files.find((f) => f.startsWith(`${conversationId}_${messageId}`))
  return match ? require('path').join(IMAGES_DIR, match) : null
}

export function getImageAsBase64(filepath: string): string | null {
  try { return fs.readFileSync(filepath).toString('base64') } catch { return null }
}

// 用户偏好
export function savePreference(key: string, value: string): void {
  const d = getDb()
  d.run('INSERT OR REPLACE INTO user_preferences (key, value, updated_at) VALUES (?, ?, ?)', [key, value, Date.now()])
  saveDatabase()
}

export function getPreference(key: string): string | null {
  const d = getDb()
  const results = d.exec('SELECT value FROM user_preferences WHERE key = ?', [key])
  if (results.length === 0 || results[0].values.length === 0) return null
  return results[0].values[0][0] as string
}

export function getAllPreferences(): Record<string, string> {
  const d = getDb()
  const results = d.exec('SELECT key, value FROM user_preferences')
  if (results.length === 0) return {}
  const prefs: Record<string, string> = {}
  results[0].values.forEach((row) => { prefs[row[0] as string] = row[1] as string })
  return prefs
}

// 图片任务管理
export function saveImageTask(task: {
  id: string; conversationId: string; messageId: string;
  provider: string; model: string; prompt: string; status: string
}): void {
  const d = getDb()
  const now = Date.now()
  d.run(
    'INSERT OR REPLACE INTO image_tasks (id, conversation_id, message_id, provider, model, prompt, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [task.id, task.conversationId, task.messageId, task.provider, task.model, task.prompt, task.status, now, now]
  )
  saveDatabase()
}

export function updateImageTaskStatus(id: string, status: string, imageUrl?: string, error?: string): void {
  const d = getDb()
  d.run(
    'UPDATE image_tasks SET status = ?, image_url = ?, error = ?, updated_at = ? WHERE id = ?',
    [status, imageUrl || null, error || null, Date.now(), id]
  )
  saveDatabase()
}

export function getPendingImageTasks(): any[] {
  const d = getDb()
  const results = d.exec("SELECT * FROM image_tasks WHERE status IN ('pending', 'processing') ORDER BY created_at ASC")
  if (results.length === 0) return []
  const cols = results[0].columns
  return results[0].values.map((row) => {
    const obj: any = {}; cols.forEach((col, i) => { obj[col] = row[i] }); return obj
  })
}

export { IMAGES_DIR }
