import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { getSettings, updateSettings } from '../store/appStore'
import type { AppSettings } from '../types/settings'
import { logger } from '../utils/logger'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS.GET, async () => {
    try {
      return { success: true, data: await getSettings() }
    } catch (error) {
      logger.error('获取设置失败:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS.UPDATE,
    async (_event, settings: Partial<AppSettings>) => {
      try {
        await updateSettings(settings)
        return { success: true }
      } catch (error) {
        logger.error('更新设置失败:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )
}
