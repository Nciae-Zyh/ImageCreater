import { app } from 'electron'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

export const logger = {
  info: (...args: unknown[]) => {
    if (isDev) console.log('[INFO]', ...args)
  },
  warn: (...args: unknown[]) => {
    console.warn('[WARN]', ...args)
  },
  error: (...args: unknown[]) => {
    console.error('[ERROR]', ...args)
  },
  debug: (...args: unknown[]) => {
    if (isDev) console.log('[DEBUG]', ...args)
  }
}
