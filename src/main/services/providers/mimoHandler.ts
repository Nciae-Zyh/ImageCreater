import OpenAI from 'openai'
import type { ProviderHandler } from './base'
import { logger } from '../../utils/logger'

/**
 * 小米 MiMo 云端 API 处理器
 *
 * API: https://api.xiaomimimo.com/v1
 * 认证: api-key 头 或 Bearer token
 *
 * 视觉: OpenAI 兼容格式 (mimo-v2.5, mimo-v2-omni)
 * 生图: 不支持
 * 编辑: 不支持
 */
export const mimoHandler: ProviderHandler = {
  id: 'mimo',
  name: '小米 MiMo',
  urlPattern: /xiaomimimo\.com/,

  async vision({ prompt, images, model, baseUrl, apiKey }) {
    const client = new OpenAI({ baseURL: baseUrl, apiKey, timeout: 120000 })

    // MiMo: 图片在文本之前；优先使用可直接访问的 URL（如 R2），否则回退 base64 data URL
    const content: any[] = images
      .map((img, idx) => {
        const isRemoteUrl = !!img.url && /^https?:\/\//i.test(img.url)
        const source = isRemoteUrl ? 'url' : (img.data ? 'base64' : 'empty')
        logger.info(`[MiMo] 图片输入 ${idx + 1}: source=${source}, mime=${img.mimeType}, url=${img.url?.slice(0, 120) || ''}`)
        if (isRemoteUrl) {
          return {
            type: 'image_url',
            image_url: { url: img.url }
          }
        }
        if (img.data) {
          return {
            type: 'image_url',
            image_url: { url: `data:${img.mimeType || 'image/png'};base64,${img.data}` }
          }
        }
        return null
      })
      .filter(Boolean) as any[]
    content.push({ type: 'text', text: prompt })

    logger.info(`[MiMo] 视觉分析: POST ${baseUrl}/chat/completions`)
    logger.info(`[MiMo] 视觉参数: model=${model}, imageParts=${content.filter((p) => p.type === 'image_url').length}, prompt="${prompt.slice(0, 160)}"`)
    logger.info(`[MiMo] 请求头: Authorization=Bearer ${apiKey.slice(0, 3)}***`)

    const reqBody: any = {
      model,
      messages: [{ role: 'user', content }]
    }

    const res = await client.chat.completions.create(reqBody)

    logger.info(`[MiMo] 视觉完成: model=${res.model}, finish_reason=${res.choices?.[0]?.finish_reason}, tokens=${res.usage?.total_tokens}`)
    logger.info(`[MiMo] 视觉输出预览: ${(res.choices?.[0]?.message?.content || '').slice(0, 220)}`)
    return { content: res.choices[0]?.message?.content || '', model: res.model || model, tokens: res.usage?.total_tokens }
  },

  async generateImage() {
    throw new Error('MiMo 不支持图片生成，请使用 OpenAI、智谱等 Provider')
  }
}
