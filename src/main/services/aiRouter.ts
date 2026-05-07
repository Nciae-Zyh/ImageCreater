import OpenAI from 'openai'
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

/** 用视觉模型分析图片内容，判断用户想编辑哪张 */
async function selectImageByAI(
  userMessage: string,
  images: HistoryImageItem[],
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<number> {
  logger.info(`[VisionSelect] === 开始视觉选图 ===`)
  logger.info(`[VisionSelect] 用户输入: "${userMessage}"`)
  logger.info(`[VisionSelect] 候选图片数: ${images.length}`)
  logger.info(`[VisionSelect] 模型: ${model}, baseUrl: ${baseUrl}`)

  try {
    const client = new OpenAI({ baseURL: baseUrl, apiKey, timeout: 30000 })
    const path = require('path')

    // 加载每张图片的 base64 数据
    const imageParts: any[] = []
    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      let base64: string | null = null
      logger.info(`[VisionSelect] 加载图片 ${i}: id=${img.id}, url=${img.imageUrl.slice(0, 80)}`)
      if (img.imageUrl.startsWith('http')) {
        try {
          const res = await fetch(img.imageUrl)
          logger.info(`[VisionSelect] 远程下载: status=${res.status}`)
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer())
            base64 = buf.toString('base64')
            logger.info(`[VisionSelect] 远程下载成功: ${buf.length} bytes`)
          }
        } catch (e: any) {
          logger.error(`[VisionSelect] 远程下载失败: ${e.message}`)
        }
      } else {
        const filename = img.imageUrl.replace('file://', '').replace('app-image://', '')
        const fullPath = path.join(IMAGES_DIR, filename)
        base64 = getImageAsBase64(fullPath)
        logger.info(`[VisionSelect] 本地读取: ${fullPath}, 成功=${!!base64}, 大小=${base64?.length || 0}`)
      }
      if (base64) {
        imageParts.push({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${base64.slice(0, 50)}...`, detail: 'low' }
        })
        imageParts.push({ type: 'text', text: `[图片 ${i}]` })
        logger.info(`[VisionSelect] 图片 ${i} 已加入, base64长度=${base64.length}`)
      } else {
        logger.warn(`[VisionSelect] 图片 ${i} 加载失败，跳过`)
      }
    }

    logger.info(`[VisionSelect] 成功加载 ${imageParts.filter(p => p.type === 'image_url').length} 张图片`)

    if (imageParts.length === 0) {
      logger.warn(`[VisionSelect] 无法加载任何图片数据，返回 -1`)
      return -1
    }

    const systemPrompt = `你是一个图片分析助手。你看到了多张图片，每张标注了序号。
用户说: "${userMessage}"
请根据用户的需求，判断哪张图片最相关。只返回一个数字序号。如果无法确定返回 -1。`

    const userContent: any[] = [
      { type: 'text', text: `请分析上面的图片，选择最相关的那张，只返回序号:` },
      ...imageParts
    ]

    logger.info(`[VisionSelect] 发送请求: model=${model}, messages=${2}条, 图片=${imageParts.filter(p => p.type === 'image_url').length}张`)
    logger.info(`[VisionSelect] system: ${systemPrompt.slice(0, 100)}...`)

    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0,
      max_tokens: 10
    })

    const content = res.choices[0]?.message?.content?.trim() || ''
    logger.info(`[VisionSelect] 原始返回: "${content}"`)
    logger.info(`[VisionSelect] finish_reason: ${res.choices[0]?.finish_reason}`)
    logger.info(`[VisionSelect] usage: ${JSON.stringify(res.usage)}`)

    const match = content.match(/-?\d+/)
    const index = match ? parseInt(match[0]) : -1
    logger.info(`[VisionSelect] 解析结果: index=${index}`)
    logger.info(`[VisionSelect] === 视觉选图完成 ===`)
    return index
  } catch (error: any) {
    logger.error(`[VisionSelect] === 视觉选图失败 ===`)
    logger.error(`[VisionSelect] 错误类型: ${error.constructor?.name}`)
    logger.error(`[VisionSelect] 错误信息: ${error.message}`)
    if (error.status) logger.error(`[VisionSelect] HTTP 状态码: ${error.status}`)
    if (error.error) logger.error(`[VisionSelect] API 错误: ${JSON.stringify(error.error).slice(0, 500)}`)
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

  // 2. 意图分析（结合对话历史）
  const hasImage = (request.imageData?.length ?? 0) > 0
  let intent: { action: IntentAction; confidence: number; reason: string }

  if (hasImage) {
    // 用户本次上传了图片 → 直接判定为编辑
    intent = { action: 'edit', confidence: 1.0, reason: '用户上传了图片，直接编辑' }
    step(`意图: edit (100%) - 用户上传了图片`)
  } else {
    // 获取对话历史，传给意图分析器
    step('AI 分析用户意图...')
    const historyMessages = getMessages(request.conversationId).slice(-10)
    const conversationHistory = historyMessages.map((m) => ({
      role: m.role,
      content: (m.image_url ? '[含有图片] ' : '') + m.content.slice(0, 200),
      hasImage: !!m.image_url
    }))
    intent = await classifyIntentAI(
      request.message, hasImage, baseUrl, apiKey,
      record.chatModel || 'gpt-4o', conversationHistory
    )
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
      // 编辑意图：用视觉模型选图
      let editImages: MessageImage[] = []

      if (hasImage && request.imageData?.length) {
        editImages = request.imageData
        step(`使用用户上传的 ${editImages.length} 张图片`)
      } else {
        step('从历史记录查找图片...')
        const allImages = getAllImagesFromHistory(request.conversationId)
        if (allImages.length === 0) {
          step('历史记录中无图片')
        } else if (allImages.length === 1) {
          step('只有 1 张图片，直接使用')
          const img = toMessageImage(allImages[0])
          if (img) editImages = [img]
        } else {
          step(`历史记录有 ${allImages.length} 张图片，视觉分析选图...`)
          const idx = await selectImageByAI(request.message, allImages, baseUrl, apiKey, record.chatModel || 'gpt-4o')
          if (idx >= 0 && idx < allImages.length) {
            const img = toMessageImage(allImages[idx])
            if (img) {
              editImages = [img]
              step(`视觉选择: 图片 ${idx}`)
            }
          }
          if (editImages.length === 0) {
            step('视觉无法确定，使用最新图片')
            const img = toMessageImage(allImages[allImages.length - 1])
            if (img) editImages = [img]
          }
        }
      }

      const editImage = editImages[0] || null
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

      // 有图片 + 有编辑模型 → 调用 editImage（支持多图）
      step(`图片编辑 (${models.imageModel})...`)
      logger.info(`[Router] 编辑请求: model=${models.imageModel}, prompt=${request.message}, 图片数=${editImages.length}`)

      const result = await generateImage({
        prompt: request.message, baseUrl: imgBaseUrl, apiKey: imgApiKey,
        model: models.imageModel, imageData: editImage, imageDatas: editImages
      })
      step('编辑完成')
      return { action: 'edit', content: request.message, optimizedPrompt: request.message,
        imageUrl: result.url, imageBase64: result.b64_json,
        metadata: { chatModel: models.chatModel, imageModel: result.model, duration: Date.now() - startTime, steps } }
    }
  }
}

export { cancelStream as cancelChatStream }
