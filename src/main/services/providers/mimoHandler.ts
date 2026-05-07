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
    const client = new OpenAI({ baseURL: baseUrl, apiKey })

    // MiMo: 图片必须在文本之前
    const content: any[] = images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.data}` }
    }))
    content.push({ type: 'text', text: prompt })

    logger.info(`[MiMo] 视觉分析: POST ${baseUrl}/chat/completions`)
    logger.info(`[MiMo] 视觉参数: model=${model}, images=${images.length}, prompt="${prompt.slice(0, 100)}"`)
    logger.info(`[MiMo] 请求头: Authorization=Bearer ${apiKey.slice(0, 3)}***`)

    const res = await client.chat.completions.create({
      model, messages: [{ role: 'user', content }], max_tokens: 4096
    })

    logger.info(`[MiMo] 视觉完成: model=${res.model}, tokens=${res.usage?.total_tokens}`)
    return { content: res.choices[0]?.message?.content || '', model: res.model || model, tokens: res.usage?.total_tokens }
  },

  async generateImage() {
    throw new Error('MiMo 不支持图片生成，请使用 OpenAI、智谱等 Provider')
  }
}
