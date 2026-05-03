import { classifyIntentAI } from './intentClassifier'
import { sendMessage, cancelStream } from './chatService'
import { generateImage } from './imageService'
import { getDecryptedKey } from './apiKeyManager'
import { matchProvider } from './providers/registry'
import { getMessages, getImageAsBase64, IMAGES_DIR } from '../store/database'
import { logger } from '../utils/logger'
import type { RouterRequest, RouterResponse, IntentAction, ModelSelection, MessageImage } from '../../../shared/types'
import type { ApiKeyRecord } from '../../../shared/types'

interface HistoryImageItem {
  id: string
  role: string
  content: string
  imageUrl: string
}

/** 获取对话历史中所有图片 */
function getAllImagesFromHistory(conversationId: string): HistoryImageItem[] {
  const messages = getMessages(conversationId)
  const items: HistoryImageItem[] = []
  for (const m of messages) {
    if (!m.image_url) continue
    items.push({ id: m.id, role: m.role, content: m.content.slice(0, 100), imageUrl: m.image_url })
  }
  return items
}

/** 把 HistoryImageItem 转成 MessageImage */
function toMessageImage(item: HistoryImageItem): MessageImage | null {
  const path = require('path')
  logger.info(`[Router] 转换图片: id=${item.id}, image_url=${item.imageUrl}`)
  if (item.imageUrl.startsWith('http')) {
    return { type: 'image', mimeType: 'image/png', data: '', url: item.imageUrl }
  }
  const filename = item.imageUrl.replace('file://', '').replace('app-image://', '')
  const fullPath = path.join(IMAGES_DIR, filename)
  const base64 = getImageAsBase64(fullPath)
  if (base64) {
    logger.info(`[Router] 图片读取成功: ${fullPath}, 大小=${base64.length} bytes`)
    return { type: 'image', mimeType: 'image/png', data: base64 }
  }
  logger.warn(`[Router] 图片读取失败: ${fullPath}`)
  return null
}

/** 用 AI 判断用户想编辑哪张图片 */
async function selectImageByAI(
  userMessage: string,
  images: HistoryImageItem[],
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<number> {
  try {
    const client = new OpenAI({ baseURL: baseUrl, apiKey, timeout: 15000 })
    const imageDescs = images.map((img, i) =>
      `[${i}] ${img.role}: "${img.content}"`
    ).join('\n')

    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: `用户想编辑一张图片。以下是对话历史中的图片列表，每张标注了序号和相关描述。
请判断用户想编辑哪张图片，返回 JSON: {"index": 序号, "reason": "原因"}

如果有多张图片都匹配，返回最匹配的那张。
如果无法确定，返回 {"index": -1, "reason": "无法确定"}` },
        { role: 'user', content: `用户输入: ${userMessage}\n\n图片列表:\n${imageDescs}` }
      ],
      temperature: 0,
      max_tokens: 100,
      response_format: { type: 'json_object' } as any
    })

    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}')
    logger.info(`[Router] AI 选择图片: index=${parsed.index}, reason=${parsed.reason}`)
    return typeof parsed.index === 'number' ? parsed.index : -1
  } catch (error) {
    logger.error(`[Router] AI 选择图片失败:`, error)
    return -1
  }
}

function selectModels(record: ApiKeyRecord, imgRecord: ApiKeyRecord | null, action: IntentAction, selection?: ModelSelection) {
  if (selection?.mode === 'manual') {
    return {
      chatModel: selection.chatModel || record.chatModel || record.models[0] || 'gpt-4o',
      visionModel: selection.visionModel || record.visionModel || '',
      imageModel: selection.imageModel || imgRecord?.imageModel || '',
      imageBaseUrl: imgRecord?.baseUrl || record.baseUrl,
      imageApiKey: ''
    }
  }
  const hasVision = !!record.visionModel
  return {
    chatModel: record.chatModel || record.models[0] || 'gpt-4o',
    visionModel: hasVision ? record.visionModel : record.chatModel || record.models[0] || 'gpt-4o',
    imageModel: imgRecord?.imageModel || record.imageModel || record.models.find((m) =>
      m.includes('dall') || m.includes('image') || m.includes('cogview') || m.includes('wanx') || m.includes('sd')
    ) || '',
    imageBaseUrl: imgRecord?.baseUrl || record.baseUrl,
    imageApiKey: ''
  }
}

export async function routeRequest(request: RouterRequest): Promise<RouterResponse> {
  const startTime = Date.now()
  const steps: string[] = []
  const onStep = request.onStep || (() => {})

  const step = (msg: string) => {
    steps.push(msg)
    onStep(msg)
    logger.info(`[Router] ${msg}`)
  }

  // 1. 获取密钥
  step('获取 API 配置...')
  const { baseUrl, apiKey, record } = await getDecryptedKey(request.providerId)
  logger.info(`[Router] 对话 Provider: ${record.name} (${record.baseUrl})`)

  let imgBaseUrl = baseUrl, imgApiKey = apiKey, imgRecord: ApiKeyRecord | null = record
  if (request.imageProviderId && request.imageProviderId !== request.providerId) {
    try {
      const imgKey = await getDecryptedKey(request.imageProviderId)
      imgBaseUrl = imgKey.baseUrl; imgApiKey = imgKey.apiKey; imgRecord = imgKey.record
      step(`图片 Provider: ${imgKey.record.name}`)
    } catch { step('图片 Provider 获取失败，使用对话 Provider') }
  }

  // 2. 意图分析
  const hasImage = (request.imageData?.length ?? 0) > 0
  let intent: { action: IntentAction; confidence: number; reason: string }

  if (hasImage) {
    // 用户本次上传了图片 → 直接判定为编辑
    intent = { action: 'edit', confidence: 1.0, reason: '用户上传了图片，直接编辑' }
    step(`意图: edit (100%) - 用户上传了图片`)
  } else {
    step('AI 分析用户意图...')
    intent = await classifyIntentAI(request.message, hasImage, baseUrl, apiKey, record.chatModel || 'gpt-4o')
    step(`意图: ${intent.action} (置信度 ${(intent.confidence * 100).toFixed(0)}%) - ${intent.reason}`)
  }

  // 3. 模型选择
  const models = selectModels(record, imgRecord, intent.action, request.modelSelection)
  models.imageBaseUrl = imgBaseUrl; models.imageApiKey = imgApiKey
  step(`模型: 对话=${models.chatModel}, 视觉=${models.visionModel}, 图片=${models.imageModel}`)
  logger.info(`[Router] 完整配置: ${JSON.stringify({ intent: intent.action, models, hasImage })}`)

  // 4. 执行
  switch (intent.action) {
    case 'chat': {
      step('执行: 文本对话')
      const result = await sendMessage({
        message: request.message, conversationId: request.conversationId,
        baseUrl, apiKey, model: models.chatModel, streamCallback: request.streamCallback
      })
      step(`完成 (${result.content.length} 字)`)
      return { action: 'chat', content: result.content,
        metadata: { chatModel: result.model, tokens: result.tokens, duration: Date.now() - startTime, steps } }
    }

    case 'analyze': {
      const visionModel = models.visionModel || models.chatModel
      step(`执行: 视觉分析 (模型: ${visionModel})`)
      const visionHandler = matchProvider(baseUrl)
      const visionResult = await visionHandler.vision({
        prompt: request.message, images: request.imageData || [], model: visionModel, baseUrl, apiKey
      })
      step(`完成 (${visionResult.content.length} 字)`)
      return { action: 'analyze', content: visionResult.content,
        metadata: { chatModel: visionResult.model, visionModel, tokens: visionResult.tokens, duration: Date.now() - startTime, steps } }
    }

    case 'generate': {
      const prompt = request.message
      step(`生成 prompt: ${prompt.slice(0, 50)}...`)

      if (!models.imageModel) {
        return { action: 'generate', content: `无图片模型。`, optimizedPrompt: prompt,
          metadata: { chatModel: models.chatModel, duration: Date.now() - startTime, steps } }
      }

      step(`调用图片生成 (${models.imageModel})...`)
      logger.info(`[Router] 生图请求: model=${models.imageModel}, prompt=${prompt}, hasImage=${hasImage}`)
      const imgData = hasImage && request.imageData?.length ? request.imageData[0] : undefined

      const result = await generateImage({
        prompt, baseUrl: imgBaseUrl, apiKey: imgApiKey, model: models.imageModel, imageData: imgData
      })
      step('生成完成')
      return { action: 'generate', content: prompt, optimizedPrompt: prompt, imageUrl: result.url, imageBase64: result.b64_json,
        metadata: { chatModel: models.chatModel, imageModel: result.model, duration: Date.now() - startTime, steps } }
    }

    case 'edit': {
      // 编辑意图：如果没有传图片，用 AI 从历史记录中选择
      let editImage = hasImage && request.imageData?.length ? request.imageData[0] : null
      if (!editImage) {
        step('未传入图片，从历史记录查找...')
        const allImages = getAllImagesFromHistory(request.conversationId)
        if (allImages.length === 0) {
          step('历史记录中无图片')
        } else if (allImages.length === 1) {
          step(`历史记录中只有 1 张图片，直接使用`)
          editImage = toMessageImage(allImages[0])
        } else {
          step(`历史记录中有 ${allImages.length} 张图片，AI 判断选择...`)
          const idx = await selectImageByAI(request.message, allImages, baseUrl, apiKey, record.chatModel || 'gpt-4o')
          if (idx >= 0 && idx < allImages.length) {
            step(`AI 选择: "${allImages[idx].content.slice(0, 30)}..."`)
            editImage = toMessageImage(allImages[idx])
          } else {
            step('AI 无法确定，使用最新图片')
            editImage = toMessageImage(allImages[allImages.length - 1])
          }
        }
        if (editImage) {
          step(`图片已选中: ${editImage.url || '(本地base64)'}`)
        }
      }
      if (!editImage) {
        step('无图片可编辑，降级为生成')
        if (!models.imageModel) {
          return { action: 'generate', content: `无图片模型。`, optimizedPrompt: request.message,
            metadata: { chatModel: models.chatModel, duration: Date.now() - startTime, steps } }
        }
        const result = await generateImage({ prompt: request.message, baseUrl: imgBaseUrl, apiKey: imgApiKey, model: models.imageModel })
        step('生成完成')
        return { action: 'generate', content: request.message, optimizedPrompt: request.message, imageUrl: result.url, imageBase64: result.b64_json,
          metadata: { chatModel: models.chatModel, imageModel: result.model, duration: Date.now() - startTime, steps } }
      }

      if (!models.imageModel) {
        // 无图片编辑模型 → 用视觉模型描述效果
        step('无图片编辑模型，用文字描述')
        const visionModel = models.visionModel || models.chatModel
        const visionHandler = matchProvider(baseUrl)
        const visionResult = await visionHandler.vision({
          prompt: `用户想对图片进行以下编辑：${request.message}。请描述编辑后的效果。`,
          images: [editImage], model: visionModel, baseUrl, apiKey
        })
        return { action: 'edit', content: visionResult.content,
          metadata: { chatModel: visionResult.model, duration: Date.now() - startTime, steps } }
      }

      // 有图片 + 有编辑模型 → 调用 editImage
      step(`图片编辑 (${models.imageModel})...`)
      logger.info(`[Router] 编辑请求: model=${models.imageModel}, prompt=${request.message}, imageUrl=${editImage.url || '(base64)'}`)

      const result = await generateImage({
        prompt: request.message, baseUrl: imgBaseUrl, apiKey: imgApiKey,
        model: models.imageModel, imageData: editImage
      })
      step('编辑完成')
      return { action: 'edit', content: request.message, optimizedPrompt: request.message,
        imageUrl: result.url, imageBase64: result.b64_json,
        metadata: { chatModel: models.chatModel, imageModel: result.model, duration: Date.now() - startTime, steps } }
    }
  }
}

export { cancelStream as cancelChatStream }
