import OpenAI, { toFile } from 'openai'
import type { ProviderHandler } from './base'
import { logger } from '../../utils/logger'

/**
 * OpenAI 兼容处理器
 *
 * 参照 OpenAI 官方文档:
 * - 生成: images.generate
 * - 编辑: images.edit + toFile
 */
export const openaiHandler: ProviderHandler = {
  id: 'openai-compatible',
  name: 'OpenAI 兼容',
  urlPattern: /openai\.com|dashscope|bigmodel\.cn|deepseek|moonshot|01\.ai/i,

  async vision({ prompt, images, model, baseUrl, apiKey }) {
    const client = new OpenAI({ baseURL: baseUrl, apiKey, timeout: 120000 })

    const content: any[] = images
      .map((img, idx) => {
        const isRemoteUrl = !!img.url && /^https?:\/\//i.test(img.url)
        logger.info(`[OpenAI] 图片输入 ${idx + 1}: source=${isRemoteUrl ? 'url' : (img.data ? 'base64' : 'empty')}, url=${img.url?.slice(0, 120) || ''}`)
        if (isRemoteUrl) {
          return { type: 'image_url', image_url: { url: img.url, detail: 'high' } }
        }
        if (img.data) {
          return { type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}`, detail: 'high' } }
        }
        return null
      })
      .filter(Boolean) as any[]
    content.push({ type: 'text', text: prompt })

    logger.info(`[OpenAI] 视觉分析: POST ${baseUrl}/chat/completions`)
    logger.info(`[OpenAI] 视觉参数: model=${model}, images=${images.length}, prompt="${prompt.slice(0, 100)}"`)
    logger.info(`[OpenAI] 请求头: Authorization=Bearer ${apiKey.slice(0, 3)}***`)

    const res = await client.chat.completions.create({
      model, messages: [{ role: 'user', content }], max_tokens: 4096
    })

    logger.info(`[OpenAI] 视觉完成: model=${res.model}, tokens=${res.usage?.total_tokens}`)
    return { content: res.choices[0]?.message?.content || '', model: res.model || model, tokens: res.usage?.total_tokens }
  },

  // ===== 图片生成 =====
  async generateImage({ prompt, model, baseUrl, apiKey }) {
    const client = new OpenAI({ baseURL: baseUrl, apiKey, timeout: 300000 })

    logger.info(`[OpenAI] 图片生成: POST ${baseUrl}/images/generations`)
    logger.info(`[OpenAI] 请求参数: model=${model}, prompt="${prompt.slice(0, 80)}..."`)
    logger.info(`[OpenAI] 请求头: Authorization=Bearer ${apiKey.slice(0, 3)}***`)

    const result = await client.images.generate({ model, prompt })

    const image_base64 = result.data[0].b64_json
    logger.info(`[OpenAI] 图片生成完成: model=${(result as any).model || model}, b64长度=${image_base64?.length || 0}`)
    return { b64_json: image_base64 ?? undefined, url: result.data[0].url ?? undefined, model: (result as any).model || model }
  },

  // ===== 图片编辑 =====
  async editImage({ prompt, image, images, model, baseUrl, apiKey }) {
    const client = new OpenAI({ baseURL: baseUrl, apiKey, timeout: 300000 })

    // 支持多图编辑：优先使用 images 数组，否则用单张 image
    const allImages = images && images.length > 0 ? images : [image]
    const imageFiles = await Promise.all(
      allImages.map(async (img) => await toFile(Buffer.from(img.data, 'base64'), null, { type: img.mimeType }))
    )

    logger.info(`[OpenAI] 图片编辑: POST ${baseUrl}/images/edits`)
    logger.info(`[OpenAI] 请求参数: model=${model}, prompt="${prompt}", images=${imageFiles.length}张`)
    logger.info(`[OpenAI] 请求头: Authorization=Bearer ${apiKey.slice(0, 3)}***`)

    const response = await client.images.edit({
      model,
      image: imageFiles,
      prompt,
    })

    const image_base64 = response.data[0].b64_json
    logger.info(`[OpenAI] 图片编辑完成: model=${(response as any).model || model}, b64长度=${image_base64?.length || 0}`)
    return { b64_json: image_base64 ?? undefined, url: response.data[0].url ?? undefined, model: (response as any).model || model }
  }
}
