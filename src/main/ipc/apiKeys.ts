import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import {
  saveApiKey,
  getDecryptedKey,
  getAllApiKeysDisplay,
  deleteApiKey
} from '../services/apiKeyManager'
import type { ApiKeySaveData } from '../types/api'
import { logger } from '../utils/logger'

export function registerApiKeyHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.API_KEY.GET_ALL, async () => {
    try {
      return { success: true, data: await getAllApiKeysDisplay() }
    } catch (error) {
      logger.error('获取 API Keys 失败:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.API_KEY.SAVE,
    async (_event, data: ApiKeySaveData) => {
      try {
        const id = await saveApiKey(
          data.name,
          data.baseUrl,
          data.apiKey,
          data.models,
          data.chatModel,
          data.imageModel,
          data.visionModel
        )
        return { success: true, data: id }
      } catch (error) {
        logger.error('保存 API Key 失败:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.API_KEY.DELETE, async (_event, id: string) => {
    try {
      await deleteApiKey(id)
      return { success: true }
    } catch (error) {
      logger.error('删除 API Key 失败:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.API_KEY.VALIDATE,
    async (_event, id: string) => {
      try {
        const { baseUrl, apiKey } = await getDecryptedKey(id)
        const response = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` }
        })
        return { success: response.ok }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )
}
