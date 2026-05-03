import { matchProvider } from './providers/registry'
import { logger } from '../utils/logger'
import type { MessageImage } from '../../../shared/types'

interface ImageGenerateRequest {
  prompt: string
  baseUrl: string
  apiKey: string
  model?: string
  imageData?: MessageImage
}

interface ImageGenerateResult {
  url?: string
  b64_json?: string
  model: string
}

async function resolveImage(imageData: MessageImage): Promise<MessageImage> {
  if (imageData.url && !imageData.data) {
    logger.info(`[ImageService] 下载远程图片: ${imageData.url}`)
    const res = await fetch(imageData.url)
    if (!res.ok) throw new Error(`下载图片失败: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    return { ...imageData, data: buf.toString('base64') }
  }
  return imageData
}

export async function generateImage(request: ImageGenerateRequest): Promise<ImageGenerateResult> {
  const handler = matchProvider(request.baseUrl)
  const model = request.model || 'dall-e-3'

  if (request.imageData && handler.editImage) {
    const image = await resolveImage(request.imageData)
    logger.info(`[ImageService] 图片编辑 → handler=${handler.name}, model=${model}`)
    logger.info(`[ImageService] prompt="${request.prompt}"`)
    logger.info(`[ImageService] 图片大小=${image.data.length} bytes (base64)`)
    const result = await handler.editImage({
      prompt: request.prompt,
      image,
      model,
      baseUrl: request.baseUrl,
      apiKey: request.apiKey
    })
    logger.info(`[ImageService] 编辑完成: model=${result.model}, hasUrl=${!!result.url}, hasB64=${!!result.b64_json}`)
    return result
  }

  logger.info(`[ImageService] 图片生成 → handler=${handler.name}, model=${model}`)
  logger.info(`[ImageService] prompt="${request.prompt}"`)
  const result = await handler.generateImage({
    prompt: request.prompt,
    model,
    baseUrl: request.baseUrl,
    apiKey: request.apiKey
  })
  logger.info(`[ImageService] 生成完成: model=${result.model}, hasUrl=${!!result.url}, hasB64=${!!result.b64_json}`)
  return result
}
