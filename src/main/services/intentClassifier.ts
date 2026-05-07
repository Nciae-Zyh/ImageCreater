import OpenAI from 'openai'
import type { IntentAction, ClassifiedIntent } from '../../../shared/types'
import { logger } from '../utils/logger'

/**
 * AI 意图分类器
 * 4 种意图：chat / generate / edit / analyze
 */

const INTENT_SYSTEM_PROMPT = `你是一个意图分类器。根据对话上下文和用户输入判断意图，返回 JSON。

【核心原则】：必须检查对话历史中是否有图片！如果历史中有图片，用户的请求大概率是基于该图片进行操作。

可选意图：
- chat: 普通对话，不涉及图片操作
- generate: 从零生成全新图片（完全无关的新主题）
- edit: 基于对话中已有的图片进行修改、替换、调整、重新生成
- analyze: 分析图片内容

【关键判断逻辑】：
1. 对话历史中有图片 → 用户的任何图片相关请求都应该是 edit（基于历史图片修改）
2. "就要一个图片"、"换成XXX"、"改成XXX"、"重新生成"、"换个风格"、"做个广告" → 如果历史有图片，都是 edit
3. 只有当用户明确说"画一张全新的无关图片"或主题完全不同时，才是 generate
4. 用户上传了图片 → edit
5. "这是什么/描述/分析" → analyze
6. 不涉及图片的对话 → chat

输出格式（严格JSON）：
{"action": "意图类型", "confidence": 0.0-1.0, "reason": "简短原因"}`

export async function classifyIntentAI(
  userMessage: string,
  hasImage: boolean,
  baseUrl: string,
  apiKey: string,
  model: string,
  conversationHistory?: { role: string; content: string; hasImage?: boolean }[]
): Promise<ClassifiedIntent> {
  try {
    const client = new OpenAI({ baseURL: baseUrl, apiKey, timeout: 30000 })

    const userContent = hasImage
      ? `[用户上传了图片] ${userMessage}`
      : userMessage

    // 构建对话上下文
    const messages: any[] = [
      { role: 'system', content: INTENT_SYSTEM_PROMPT }
    ]

    if (conversationHistory && conversationHistory.length > 0) {
      // 添加最近的历史消息（最多6条）
      const recent = conversationHistory.slice(-6)
      for (const msg of recent) {
        const prefix = msg.hasImage ? '[含图片] ' : ''
        messages.push({ role: msg.role, content: `${prefix}${msg.content}` })
      }
    }

    messages.push({ role: 'user', content: `用户输入：${userContent}` })

    const res = await client.chat.completions.create({
      model,
      messages,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: 'json_object' } as any
    })

    const content = res.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(content)

    const validActions: IntentAction[] = ['chat', 'generate', 'edit', 'analyze']
    const action = validActions.includes(parsed.action) ? parsed.action : 'chat'

    const result: ClassifiedIntent = {
      action,
      confidence: parsed.confidence || 0.8,
      reason: parsed.reason || 'AI 分析'
    }

    logger.info(`[Intent] AI 分类: ${result.action} (${result.confidence}) - ${result.reason}`)
    return result
  } catch (error) {
    logger.error(`[Intent] AI 分类失败，降级到规则:`, error)
    return classifyIntentFallback(userMessage, hasImage)
  }
}

/**
 * 降级规则分类（AI 失败时使用）
 */
function classifyIntentFallback(userMessage: string, hasImage: boolean): ClassifiedIntent {
  const lowerMsg = userMessage.toLowerCase()

  if (hasImage) {
    if (/编辑|修改|调整|优化|改|P图|换背景|改颜色|edit|modify|change/i.test(lowerMsg)) {
      return { action: 'edit', confidence: 0.7, reason: '降级规则: 编辑关键词' }
    }
    if (/分析|描述|这是什么|describe|analyze|what/i.test(lowerMsg)) {
      return { action: 'analyze', confidence: 0.7, reason: '降级规则: 分析关键词' }
    }
    // 有图片但不是编辑/分析 → 作为参考图生成
    return { action: 'generate', confidence: 0.6, reason: '降级规则: 有图片默认生成' }
  }

  if (/画|生成|创建|做一张|draw|generate|create|make/i.test(lowerMsg)) {
    return { action: 'generate', confidence: 0.7, reason: '降级规则: 生成关键词' }
  }

  return { action: 'chat', confidence: 0.7, reason: '降级规则: 普通对话' }
}

/**
 * 同步接口（向后兼容）
 */
export function classifyIntent(userMessage: string, hasImage: boolean): ClassifiedIntent {
  return classifyIntentFallback(userMessage, hasImage)
}

export function extractImagePrompt(message: string): string {
  return message.replace(/[画生成创建编辑修改调整参考分析描述做].*?[。！？\n]/g, '').trim() || message
}
