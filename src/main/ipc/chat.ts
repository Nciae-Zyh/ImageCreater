import { ipcMain, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { routeRequest, cancelChatStream } from '../services/aiRouter'
import { classifyIntentAI } from '../services/intentClassifier'
import { optimizePrompt } from '../services/promptOptimizer'
import { getDecryptedKey } from '../services/apiKeyManager'
import {
  saveConversation, saveMessage, getAllConversations,
  getMessages, deleteConversation as dbDeleteConversation,
  deleteMessage as dbDeleteMessage,
  saveImageToDisk, getImageAsBase64, getImagePath, IMAGES_DIR,
  savePreference, getPreference, getAllPreferences,
  saveImageTask, updateImageTaskStatus
} from '../store/database'
import { isR2Configured, uploadImageToR2, initR2, getR2ConfigSummary, testR2Connection } from '../services/r2Storage'
import { loadR2Config, saveR2Config } from '../store/appStore'
import { logger } from '../utils/logger'
import type { ModelSelection, MessageImage } from '../../../shared/types'

interface ChatSendRequest {
  message: string
  displayMessage?: string
  conversationId: string
  providerId: string
  imageProviderId?: string
  imageData?: MessageImage[]
  modelSelection?: ModelSelection
}

interface PromptOptimizeImage {
  type: 'image'
  mimeType: string
  data: string
  url?: string
}

interface ChatStreamPayload {
  conversationId: string
  chunk: string
}

interface ErrorInfo {
  message: string
  type: string
  code?: string
  requestId?: string
}

function isHttpUrl(url?: string): boolean {
  return !!url && /^https?:\/\//i.test(url)
}

function isPrivateR2ApiUrl(url?: string): boolean {
  return !!url && /https:\/\/[^/]+\.r2\.cloudflarestorage\.com\//i.test(url)
}

function isMaskedOrPlaceholderSecret(value?: string): boolean {
  if (!value) return true
  const trimmed = value.trim()
  return trimmed.includes('...') || /^[•●*]+$/.test(trimmed)
}

function getLocalImageUrl(conversationId: string, messageId: string): string | null {
  const localPath = getImagePath(conversationId, messageId)
  return localPath ? `app-image://${path.basename(localPath)}` : null
}

function getLocalImageBase64(conversationId: string, messageId: string): string | null {
  const localPath = getImagePath(conversationId, messageId)
  return localPath ? getImageAsBase64(localPath) : null
}

function parseError(error: any): ErrorInfo {
  // OpenAI API 错误
  if (error?.error?.message) {
    const apiErr = error.error
    const code = apiErr.code || error.status?.toString()
    let message = apiErr.message

    // 常见错误友好化
    if (code === 'moderation_blocked') {
      message = '内容被安全系统拦截，请修改描述后重试'
    } else if (code === 'invalid_api_key' || error.status === 401) {
      message = 'API Key 无效，请检查配置'
    } else if (error.status === 429 || code === 'rate_limit_exceeded') {
      message = '请求过于频繁，请稍后再试'
    } else if (error.status === 402) {
      message = 'API 额度不足，请充值'
    } else if (error.status === 404) {
      message = '模型不存在，请检查模型名称'
    } else if (error.status === 400) {
      message = `请求参数错误: ${message}`
    }

    return { message, type: apiErr.type || 'api_error', code, requestId: error.request_id }
  }

  // 网络错误
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
    return { message: `网络连接失败: ${error.message}`, type: 'network_error', code: error.code }
  }

  // 通用错误
  return { message: error?.message || '未知错误', type: 'unknown_error' }
}

export function registerChatHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.CHAT.SEND,
    async (event, request: ChatSendRequest) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: '窗口不存在' }

      const sendStream = (data: string) => {
        if (!win.isDestroyed()) {
          const payload: ChatStreamPayload = {
            conversationId: request.conversationId,
            chunk: data
          }
          win.webContents.send(IPC_CHANNELS.CHAT.STREAM, payload)
        }
      }

      try {
        // 如果有用户上传的图片，先保存到磁盘并上传 R2
        let userImageUrls: string[] = []
        if (request.imageData?.length) {
          for (let i = 0; i < request.imageData.length; i++) {
            const img = request.imageData[i]
            const userImgId = crypto.randomUUID()
            const ext = img.mimeType.split('/')[1] || 'png'
            const filename = `user_${request.conversationId}_${userImgId}.${ext}`
            const localPath = saveImageToDisk(request.conversationId, userImgId, img.data, img.mimeType)
            const localImageUrl = `app-image://${path.basename(localPath)}`

            if (isR2Configured()) {
              try {
                const r2Url = await uploadImageToR2(img.data, filename, img.mimeType)
                userImageUrls.push(r2Url || localImageUrl)
                logger.info(`[Chat] 用户图片 R2: ${r2Url || '无公网 URL，使用本地回显'}`)
              } catch (err) {
                logger.error(`[Chat] 用户图片 R2 上传失败:`, err)
                userImageUrls.push(localImageUrl)
              }
            } else {
              userImageUrls.push(localImageUrl)
            }
          }
          logger.info(`[Chat] 用户上传 ${userImageUrls.length} 张图片`)
        }

        const userDisplayMessage = (request.displayMessage || request.message || '').trim()

        // 保存用户消息（包含图片 URL）
        const userMsgId = crypto.randomUUID()
        saveMessage({
          id: userMsgId,
          conversationId: request.conversationId,
          role: 'user',
          content: userDisplayMessage || request.message,
          type: request.imageData?.length ? 'mixed' : 'text',
          imageData: request.imageData ? JSON.stringify(request.imageData) : undefined,
          imageUrl: userImageUrls.length > 0 ? userImageUrls[0] : undefined,
          timestamp: Date.now()
        })

        // 发送步骤进度
        sendStream('[STEP]正在分析您的请求...')

        // 执行路由
        const result = await routeRequest({
          message: request.message,
          conversationId: request.conversationId,
          providerId: request.providerId,
          imageProviderId: request.imageProviderId,
          imageData: request.imageData,
          modelSelection: request.modelSelection,
          onStep: (step: string) => sendStream(`[STEP]${step}`),
          streamCallback: (chunk) => sendStream(`[TEXT]${chunk}`)
        })

        // 如果需要用户选择图片，保存消息后返回
        if ((result.metadata as any).needUserSelect) {
          const needSelectMsgId = crypto.randomUUID()
          const needSelectMetadata = {
            ...result.metadata,
            needUserSelect: true,
            steps: result.metadata.steps,
            prompt: result.optimizedPrompt || request.message,
            originalPrompt: userDisplayMessage || request.message,
            displayContent: '视觉分析无法确定要编辑的图片，请在下方选择。'
          }
          saveMessage({
            id: needSelectMsgId,
            conversationId: request.conversationId,
            role: 'assistant',
            content: request.message,
            type: 'text',
            metadata: JSON.stringify(needSelectMetadata),
            timestamp: Date.now()
          })
          saveConversation({
            id: request.conversationId,
            title: request.message.slice(0, 20) + (request.message.length > 20 ? '...' : ''),
            providerId: request.providerId,
            model: result.metadata.chatModel,
            createdAt: Date.now(),
            updatedAt: Date.now()
          })
          sendStream(`[META]${JSON.stringify({
            model: result.metadata.chatModel,
            duration: result.metadata.duration,
            steps: result.metadata.steps,
            action: result.action,
            needUserSelect: true,
            prompt: result.optimizedPrompt || request.message,
            originalPrompt: userDisplayMessage || request.message,
            optimizedPrompt: result.optimizedPrompt || request.message,
            displayContent: '视觉分析无法确定要编辑的图片，请在下方选择。'
          })}`)
          sendStream('[DONE]')
          return { success: true, data: { ...result, needUserSelect: true } }
        }

        // 发送元数据
        sendStream(`[META]${JSON.stringify({
          model: result.metadata.chatModel,
          duration: result.metadata.duration,
          steps: result.metadata.steps,
          action: result.action,
          optimizedPrompt: result.optimizedPrompt
        })}`)

        // 保存助手消息
        const assistantMsgId = crypto.randomUUID()
        let savedImageUrl: string | undefined

        if (result.imageBase64) {
          const taskId = crypto.randomUUID()
          const ext = 'png'
          const filename = `${request.conversationId}_${assistantMsgId}.${ext}`

          // 存储任务记录
          saveImageTask({
            id: taskId,
            conversationId: request.conversationId,
            messageId: assistantMsgId,
            provider: request.providerId,
            model: result.metadata.imageModel || 'unknown',
            prompt: result.optimizedPrompt || request.message,
            status: 'completed'
          })

          const filePath = saveImageToDisk(request.conversationId, assistantMsgId, result.imageBase64)
          savedImageUrl = `app-image://${filename}`
          logger.info(`[Chat] 图片已保存: ${filePath}`)
          logger.info(`[Chat] 图片 URL: ${savedImageUrl}`)
          logger.info(`[Chat] Task ID: ${taskId}`)

          if (isR2Configured()) {
            try {
              const r2Url = await uploadImageToR2(result.imageBase64, filename)
              logger.info(`[Chat] R2 URL: ${r2Url}`)
              if (r2Url) {
                savedImageUrl = r2Url
                updateImageTaskStatus(taskId, 'completed', r2Url)
              } else {
                updateImageTaskStatus(taskId, 'completed', savedImageUrl)
              }
            } catch (err) {
              logger.error(`[Chat] R2 上传失败:`, err)
            }
          }

          sendStream(`[IMAGE]${savedImageUrl}`)
        } else if (result.imageUrl) {
          savedImageUrl = result.imageUrl
          logger.info(`[Chat] 图片 URL: ${savedImageUrl}`)
          sendStream(`[IMAGE]${savedImageUrl}`)
        }

        // 保存消息，记录 prompt
        const msgMetadata = {
          ...result.metadata,
          optimizedPrompt: result.optimizedPrompt,
          originalPrompt: userDisplayMessage || request.message,
          prompt: result.optimizedPrompt || request.message
        }
        saveMessage({
          id: assistantMsgId,
          conversationId: request.conversationId,
          role: 'assistant',
          content: result.content,
          type: result.action === 'chat' || result.action === 'analyze' ? 'text' : 'image',
          imageUrl: savedImageUrl,
          metadata: JSON.stringify(msgMetadata),
          timestamp: Date.now()
        })

        saveConversation({
          id: request.conversationId,
          title: (userDisplayMessage || request.message).slice(0, 20) + ((userDisplayMessage || request.message).length > 20 ? '...' : ''),
          providerId: request.providerId,
          model: result.metadata.chatModel,
          createdAt: Date.now(),
          updatedAt: Date.now()
        })

        sendStream('[DONE]')

        return { success: true, data: { ...result, imageUrl: savedImageUrl || result.imageUrl } }
      } catch (error: any) {
        const errInfo = parseError(error)
        logger.error(`[Chat] 请求失败: ${errInfo.message}`)
        sendStream(`[ERROR]${JSON.stringify(errInfo)}`)
        sendStream('[DONE]')
        return { success: false, error: errInfo.message }
      }
    }
  )

  ipcMain.on(IPC_CHANNELS.CHAT.CANCEL, (_event, conversationId: string) => {
    cancelChatStream(conversationId)
  })

  // AI 意图预分析：判断用户是否需要图片（编辑/参考）
  ipcMain.handle(IPC_CHANNELS.CHAT.ANALYZE_INTENT, async (_event, data: {
    message: string; providerId: string; hasImage: boolean; conversationId?: string
  }) => {
    try {
      const { baseUrl, apiKey, record } = await getDecryptedKey(data.providerId)
      // 获取对话历史传给意图分析器
      let conversationHistory: { role: string; content: string; hasImage?: boolean }[] | undefined
      if (data.conversationId) {
        const messages = getMessages(data.conversationId).slice(-10)
        conversationHistory = messages.map((m) => ({
          role: m.role,
          content: (m.image_url ? '[含有图片] ' : '') + m.content.slice(0, 200),
          hasImage: !!m.image_url
        }))
      }
      const intent = await classifyIntentAI(
        data.message, data.hasImage, baseUrl, apiKey,
        record.chatModel || 'gpt-4o', conversationHistory
      )
      // 如果是编辑意图，检查历史图片数量
      let imageCount = 0
      if (intent.action === 'edit' && data.conversationId) {
        const images = getMessages(data.conversationId).filter((m) => m.image_url)
        imageCount = images.length
      }
      return { success: true, data: { ...intent, imageCount } }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Prompt 优化：仅文本模型，不执行生图
  ipcMain.handle(IPC_CHANNELS.CHAT.OPTIMIZE_PROMPT, async (_event, data: {
    message: string
    providerId: string
    action: 'generate' | 'edit'
    selectedImageHints?: string[]
    selectedImages?: PromptOptimizeImage[]
  }) => {
    try {
      const { baseUrl, apiKey, record } = await getDecryptedKey(data.providerId)
      const optimizedResult = await optimizePrompt({
        userMessage: data.message,
        action: data.action === 'edit' ? 'edit' : 'generate',
        baseUrl,
        apiKey,
        model: record.chatModel || 'gpt-4o-mini',
        selectedImageHints: data.selectedImageHints,
        selectedImages: data.selectedImages
      })
      logger.info(`[Chat] optimizePrompt 成功: action=${data.action}, candidates=${optimizedResult.candidates.length}, recommended=${optimizedResult.recommendedIndex}`)
      return {
        success: true,
        data: {
          optimizedPrompt: optimizedResult.optimizedPrompt,
          candidates: optimizedResult.candidates,
          recommendedIndex: optimizedResult.recommendedIndex
        }
      }
    } catch (error) {
      logger.error('[Chat] optimizePrompt 失败:', error as any)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('conversation:get-all', async () => {
    try {
      return { success: true, data: getAllConversations() }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('conversation:get-messages', async (_event, conversationId: string) => {
    try {
      const messages = getMessages(conversationId)
      const enriched = messages.map((msg) => {
        if (msg.image_url && msg.image_url.startsWith('file://')) {
          const base64 = getImageAsBase64(msg.image_url.replace('file://', ''))
          if (base64) return { ...msg, image_base64: base64 }
        }
        if (msg.image_url && isPrivateR2ApiUrl(msg.image_url)) {
          const localImageUrl = getLocalImageUrl(conversationId, msg.id)
          if (localImageUrl) return { ...msg, image_url: localImageUrl }
        }
        if (msg.image_url && msg.image_url.startsWith('app-image://')) {
          const filename = msg.image_url.replace('app-image://', '')
          const base64 = getImageAsBase64(path.join(IMAGES_DIR, filename))
          if (base64) return { ...msg, image_base64: base64 }
        }
        return msg
      })
      return { success: true, data: enriched }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('conversation:delete', async (_event, id: string) => {
    try {
      dbDeleteConversation(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // 删除单条消息
  ipcMain.handle('conversation:delete-message', async (_event, conversationId: string, messageId: string) => {
    try {
      dbDeleteMessage(conversationId, messageId)
      logger.info(`[Chat] 删除消息: ${messageId}`)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('conversation:get-images', async (_event, conversationId: string) => {
    try {
      const messages = getMessages(conversationId)
      logger.info(`[Chat] 获取历史图片: conversationId=${conversationId}, 消息数=${messages.length}`)
      const images: any[] = []
      for (const m of messages) {
        if (!m.image_url) continue
        logger.info(`[Chat] 历史消息 ${m.id}: role=${m.role}, image_url=${m.image_url}`)
        if (isHttpUrl(m.image_url) && !isPrivateR2ApiUrl(m.image_url)) {
          const localBase64 = getLocalImageBase64(conversationId, m.id)
          images.push({
            id: m.id,
            content: m.content.slice(0, 50),
            imageUrl: m.image_url,
            imageBase64: localBase64 || undefined,
            timestamp: m.timestamp
          })
        } else if (isPrivateR2ApiUrl(m.image_url)) {
          const base64 = getLocalImageBase64(conversationId, m.id)
          logger.info(`[Chat] R2 私有 URL 回退本地: id=${m.id}, 成功=${!!base64}`)
          if (base64) {
            images.push({ id: m.id, content: m.content.slice(0, 50), imageBase64: base64, timestamp: m.timestamp })
          }
        } else {
          const filename = m.image_url.replace('file://', '').replace('app-image://', '')
          const fullPath = path.join(IMAGES_DIR, filename)
          const base64 = getImageAsBase64(fullPath)
          logger.info(`[Chat] 本地图片: path=${fullPath}, 成功=${!!base64}`)
          if (base64) {
            images.push({ id: m.id, content: m.content.slice(0, 50), imageBase64: base64, timestamp: m.timestamp })
          }
        }
      }
      logger.info(`[Chat] 历史图片数: ${images.length}`)
      return { success: true, data: images }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // 图片另存为
  ipcMain.handle('image:save-as', async (event, imageUrl: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: '窗口不存在' }

      // 从 app-image:// URL 获取文件路径
      let filePath = ''
      if (imageUrl.startsWith('app-image://')) {
        const filename = imageUrl.replace('app-image://', '')
        filePath = path.join(IMAGES_DIR, filename)
      } else if (imageUrl.startsWith('file://')) {
        filePath = imageUrl.replace('file://', '')
      } else if (isHttpUrl(imageUrl)) {
        const res = await fetch(imageUrl)
        if (!res.ok) {
          return { success: false, error: `下载远程图片失败: ${res.status}` }
        }
        const arrayBuffer = await res.arrayBuffer()
        const suggestedExt = imageUrl.split('?')[0].split('.').pop()?.toLowerCase()
        const ext = suggestedExt && /^[a-z0-9]{2,5}$/.test(suggestedExt) ? suggestedExt : 'png'
        const result = await dialog.showSaveDialog(win, {
          title: '保存图片',
          defaultPath: `image-${Date.now()}.${ext}`,
          filters: [
            { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        })

        if (result.canceled || !result.filePath) {
          return { success: false, error: '用户取消' }
        }

        fs.writeFileSync(result.filePath, Buffer.from(arrayBuffer))
        logger.info(`[Chat] 远程图片已保存到: ${result.filePath}`)
        return { success: true, data: result.filePath }
      } else {
        return { success: false, error: '不支持的图片格式' }
      }

      if (!fs.existsSync(filePath)) {
        return { success: false, error: '图片文件不存在' }
      }

      const result = await dialog.showSaveDialog(win, {
        title: '保存图片',
        defaultPath: `image-${Date.now()}.png`,
        filters: [
          { name: 'PNG 图片', extensions: ['png'] },
          { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (result.canceled || !result.filePath) {
        return { success: false, error: '用户取消' }
      }

      fs.copyFileSync(filePath, result.filePath)
      logger.info(`[Chat] 图片已保存到: ${result.filePath}`)
      return { success: true, data: result.filePath }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // 用户偏好设置
  ipcMain.handle('prefs:get-all', async () => {
    try {
      return { success: true, data: getAllPreferences() }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('prefs:save', async (_event, key: string, value: string) => {
    try {
      savePreference(key, value)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // R2 存储配置
  ipcMain.handle('r2:configure', async (_event, config: {
    accountId: string; accessKeyId?: string; secretAccessKey?: string;
    bucketName: string; publicBaseUrl?: string
  }) => {
    try {
      const existing = await loadR2Config()
      const incomingAccessKey = config.accessKeyId?.includes('...')
        ? undefined
        : config.accessKeyId
      const incomingSecretAccessKey = isMaskedOrPlaceholderSecret(config.secretAccessKey)
        ? undefined
        : config.secretAccessKey
      const nextConfig = {
        accountId: config.accountId || existing?.accountId || '',
        accessKeyId: incomingAccessKey || existing?.accessKeyId || '',
        secretAccessKey: incomingSecretAccessKey || existing?.secretAccessKey || '',
        bucketName: config.bucketName || existing?.bucketName || '',
        publicBaseUrl: config.publicBaseUrl || undefined
      }

      if (!nextConfig.accountId || !nextConfig.accessKeyId || !nextConfig.secretAccessKey || !nextConfig.bucketName) {
        return { success: false, error: '请填写完整的 R2 配置' }
      }

      initR2(nextConfig)
      await saveR2Config(nextConfig)
      savePreference('r2_configured', 'true')
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('r2:status', async () => {
    return { success: true, data: { ...getR2ConfigSummary(), configured: isR2Configured() } }
  })

  ipcMain.handle('r2:test', async () => {
    try {
      const result = await testR2Connection()
      return { success: true, data: result }
    } catch (error: any) {
      const summary = getR2ConfigSummary()
      const apiEndpoint = summary.apiEndpoint || (summary.accountId ? `https://${summary.accountId}.r2.cloudflarestorage.com` : '')
      const rawMessage = error?.message || 'R2 测试失败'
      const hint = rawMessage.includes('SignatureDoesNotMatch') || rawMessage.includes('signature')
        ? '签名校验失败，请检查 Access Key ID / Secret Access Key 是否完整且属于该 Account 与 Bucket。公网访问地址不会参与上传签名。'
        : undefined
      return {
        success: false,
        error: hint ? `${rawMessage}\n${hint}` : rawMessage,
        data: { apiEndpoint }
      }
    }
  })
}
