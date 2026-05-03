import OpenAI from 'openai'
import type { IntentAction, ClassifiedIntent } from '../../../shared/types'
import { logger } from '../utils/logger'

/**
 * AI 意图分类器
 * 4 种意图：chat / generate / edit / analyze
 */

const INTENT_SYSTEM_PROMPT = `你是一个意图分类器。根据用户输入判断意图，返回 JSON。

可选意图：
- chat: 普通对话，不涉及图片生成或编辑
- generate: 从零生成新图片（文字描述 → 图片），用户没有上传图片，或上传了图片但要求"用这个风格/参考这个画一个新的"
- edit: 对已有图片进行编辑修改（换背景、改颜色、加文字、P图等），用户上传了图片并要求修改原图
- analyze: 分析/描述图片内容，不生成新图

判断规则：
1. 用户上传了图片 + "编辑/修改/调整/换背景/改颜色/P图" → edit
2. 用户上传了图片 + "生成/画/做一个广告/参考这个" → generate（参考图作为输入）
3. 用户上传了图片 + "这是什么/描述/分析" → analyze
4. 用户只发文字 + 包含"画/生成/创建/做一张" → generate
5. 其他 → chat

输出格式（严格JSON）：
{"action": "意图类型", "confidence": 0.0-1.0, "reason": "简短原因"}`

export async function classifyIntentAI(
  userMessage: string,
  hasImage: boolean,
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<ClassifiedIntent> {
  try {
    const client = new OpenAI({ baseURL: baseUrl, apiKey, timeout: 30000 })

    const userContent = hasImage
      ? `[用户上传了图片] ${userMessage}`
      : userMessage

    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: INTENT_SYSTEM_PROMPT },
        { role: 'user', content: `用户输入：${userContent}` }
      ],
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
