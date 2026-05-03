import type { ProviderHandler } from './base'
import { openaiHandler } from './openaiHandler'
import { geminiHandler } from './geminiHandler'
import { mimoHandler } from './mimoHandler'

/**
 * Provider 处理器注册表
 *
 * 按 baseUrl 模式匹配对应的处理器
 * 用户自定义的 Provider 只要 baseUrl 能匹配就会自动使用对应处理器
 * 没有匹配到的默认使用 OpenAI 兼容处理器
 */

const handlers: ProviderHandler[] = [
  mimoHandler,
  geminiHandler,
  openaiHandler  // 放最后，作为 fallback
]

/**
 * 根据 baseUrl 匹配对应的 Provider 处理器
 */
export function matchProvider(baseUrl: string): ProviderHandler {
  for (const handler of handlers) {
    if (handler.urlPattern.test(baseUrl)) {
      return handler
    }
  }
  // 默认使用 OpenAI 兼容处理器
  return openaiHandler
}

/**
 * 注册自定义 Provider 处理器
 */
export function registerHandler(handler: ProviderHandler): void {
  handlers.unshift(handler) // 新注册的优先匹配
}

/**
 * 获取所有已注册的处理器
 */
export function getAllHandlers(): ProviderHandler[] {
  return [...handlers]
}
