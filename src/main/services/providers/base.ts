import type { MessageImage } from '../../../../shared/types'

/**
 * Provider 处理器基础接口
 * 每个 Provider 独立实现，通过 baseUrl 模式匹配
 */
export interface ProviderHandler {
  id: string
  name: string
  /** baseUrl 匹配模式 */
  urlPattern: RegExp

  /** 视觉分析 (图片+文本 → 文本) */
  vision(params: {
    prompt: string
    images: MessageImage[]
    model: string
    baseUrl: string
    apiKey: string
  }): Promise<{ content: string; model: string; tokens?: number }>

  /** 图片生成 (文本 → 图片) */
  generateImage(params: {
    prompt: string
    model: string
    baseUrl: string
    apiKey: string
  }): Promise<{ url?: string; b64_json?: string; model: string }>

  /** 图片编辑 (图片+文本 → 图片) */
  editImage?(params: {
    prompt: string
    image: MessageImage
    model: string
    baseUrl: string
    apiKey: string
  }): Promise<{ url?: string; b64_json?: string; model: string }>
}
