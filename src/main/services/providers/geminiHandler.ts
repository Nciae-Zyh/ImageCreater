import type { ProviderHandler } from './base'
import { logger } from '../../utils/logger'

/**
 * Google Gemini 处理器
 *
 * 视觉: OpenAI 兼容层 (baseURL 含 /openai/) 或原生 API
 * 生图: 原生 generateContent API + responseModalities: ["IMAGE"]
 *       返回 base64 inline data
 */
export const geminiHandler: ProviderHandler = {
  id: 'gemini',
  name: 'Google Gemini',
  urlPattern: /googleapis\.com|generativelanguage/,

  async vision({ prompt, images, model, baseUrl, apiKey }) {
    // Gemini 通过 OpenAI 兼容层访问时，使用标准格式
    const content: any[] = images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.data}` }
    }))
    content.push({ type: 'text', text: prompt })

    // 通过 OpenAI 兼容层
    const chatUrl = baseUrl.includes('/openai')
      ? `${baseUrl}/chat/completions`
      : `${baseUrl.replace(/\/$/, '')}/openai/chat/completions`

    const requestBody = { model, messages: [{ role: 'user', content }], max_tokens: 4096 }
    logger.info(`[Gemini] 视觉分析: POST ${chatUrl}`)
    logger.info(`[Gemini] 视觉参数: model=${model}, images=${images.length}, prompt="${prompt.slice(0, 100)}"`)
    logger.info(`[Gemini] 请求头: Authorization=Bearer ${apiKey.slice(0, 3)}***`)

    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(requestBody)
    })

    if (!res.ok) throw new Error(`Gemini vision error: ${res.status} ${await res.text()}`)
    const data = await res.json()
    logger.info(`[Gemini] 视觉完成: model=${model}, tokens=${data.usage?.total_tokens}`)
    return { content: data.choices?.[0]?.message?.content || '', model, tokens: data.usage?.total_tokens }
  },

  async generateImage({ prompt, model, baseUrl, apiKey }) {
    // 使用原生 generateContent API
    const genUrl = `${baseUrl.replace(/\/openai\/?$/, '').replace(/\/$/, '')}/models/${model}:generateContent`

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } }
    }

    logger.info(`[Gemini] 图片生成: POST ${genUrl}`)
    logger.info(`[Gemini] 请求参数: ${JSON.stringify({ ...requestBody, contents: [{ parts: [{ text: prompt.slice(0, 100) + '...' }] }] })}`)
    logger.info(`[Gemini] 请求头: x-goog-api-key=${apiKey.slice(0, 3)}***`)

    const res = await fetch(genUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(requestBody)
    })

    if (!res.ok) throw new Error(`Gemini image gen error: ${res.status} ${await res.text()}`)
    const data = await res.json()
    const parts = data.candidates?.[0]?.content?.parts || []
    for (const part of parts) {
      if (part.inlineData) {
        logger.info(`[Gemini] 图片生成完成: model=${model}, b64_size=${part.inlineData.data.length} bytes`)
        return { b64_json: part.inlineData.data, model }
      }
    }
    throw new Error('Gemini 未返回图片')
  }
}
