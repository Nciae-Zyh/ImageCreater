import { ipcMain, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import { getLogFiles, readLogs, cleanOldLogs } from '../utils/logger'

export function registerLogHandlers(): void {
  ipcMain.handle('log:export', async (event, options?: { startDate?: string; endDate?: string }) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: '窗口不存在' }

      const content = readLogs(options?.startDate, options?.endDate)
      if (!content) return { success: false, error: '指定时间范围内无日志' }

      const result = await dialog.showSaveDialog(win, {
        title: '导出日志',
        defaultPath: `image-creater-logs-${options?.startDate || 'all'}-${options?.endDate || 'all'}.log`,
        filters: [
          { name: '日志文件', extensions: ['log'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (result.canceled || !result.filePath) {
        return { success: false, error: '用户取消' }
      }

      fs.writeFileSync(result.filePath, content, 'utf-8')
      return { success: true, data: result.filePath }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('log:files', async () => {
    try {
      return { success: true, data: getLogFiles() }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('log:clean', async (_event, keepDays: number) => {
    try {
      cleanOldLogs(keepDays || 30)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
