import fs from 'fs'
import path from 'path'

// API key 自动打码正则
const SENSITIVE_PATTERNS = [
  /sk-[a-zA-Z0-9]{8,}/g,                    // OpenAI /compatible keys
  /Bearer\s+[a-zA-Z0-9_\-]{16,}/g,          // Bearer tokens
  /x-goog-api-key=[a-zA-Z0-9_\-]{16,}/g,    // Google API keys
  /["']?apiKey["']?\s*[:=]\s*["'][a-zA-Z0-9_\-]{16,}["']/g, // JSON-like key assignments
]

function maskSensitive(text: string): string {
  let result = text
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // 保留前 3 个可见字符，其余打码
      const prefix = match.slice(0, 3)
      return prefix + '***'
    })
  }
  return result
}

function formatTimestamp(): string {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function getLogsDir(): string {
  const { app } = require('electron')
  const logsDir = path.join(app.getPath('userData'), 'logs')
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }
  return logsDir
}

function getTodayLogFile(): string {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return path.join(getLogsDir(), `app-${date}.log`)
}

function writeToFile(level: string, args: unknown[]): void {
  try {
    const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    const masked = maskSensitive(msg)
    const line = `[${formatTimestamp()}] [${level}] ${masked}\n`
    fs.appendFileSync(getTodayLogFile(), line)
  } catch {
    // 文件写入失败不影响程序运行
  }
}

export const logger = {
  info: (...args: unknown[]) => {
    console.log('[INFO]', ...args)
    writeToFile('INFO', args)
  },
  warn: (...args: unknown[]) => {
    console.warn('[WARN]', ...args)
    writeToFile('WARN', args)
  },
  error: (...args: unknown[]) => {
    console.error('[ERROR]', ...args)
    writeToFile('ERROR', args)
  },
  debug: (...args: unknown[]) => {
    console.log('[DEBUG]', ...args)
    writeToFile('DEBUG', args)
  }
}

/** 获取当天日志文件路径 */
export function getLogFile(): string {
  return getTodayLogFile()
}

/** 获取所有日志文件列表 */
export function getLogFiles(): Array<{ name: string; filePath: string; size: number; date: string }> {
  const logsDir = getLogsDir()
  const files = fs.readdirSync(logsDir).filter((f) => f.startsWith('app-') && f.endsWith('.log'))
  return files
    .map((f) => {
      const filePath = path.join(logsDir, f)
      const stat = fs.statSync(filePath)
      const date = f.replace('app-', '').replace('.log', '')
      return { name: f, filePath, size: stat.size, date }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** 读取指定日期范围的日志内容 */
export function readLogs(startDate?: string, endDate?: string): string {
  const files = getLogFiles()
  const start = startDate || '0000-00-00'
  const end = endDate || '9999-99-99'
  const filtered = files.filter((f) => f.date >= start && f.date <= end)

  let content = ''
  for (const f of filtered.reverse()) {
    content += fs.readFileSync(f.filePath, 'utf-8')
  }
  return content
}

/** 清理超过指定天数的日志文件 */
export function cleanOldLogs(keepDays: number): void {
  const files = getLogFiles()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - keepDays)
  const cutoffStr = `${cutoff.getFullYear()}-${(cutoff.getMonth() + 1).toString().padStart(2, '0')}-${cutoff.getDate().toString().padStart(2, '0')}`

  for (const f of files) {
    if (f.date < cutoffStr) {
      try {
        fs.unlinkSync(f.filePath)
      } catch {
        // 忽略删除失败
      }
    }
  }
}
