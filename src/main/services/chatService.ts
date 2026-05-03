import OpenAI from 'openai'
import type { ChatMessage, SendMessageRequest, SendMessageResult } from '../types/chat'
import type { MessageImage } from '../../../shared/types'
import { MAX_CONTEXT_TOKENS } from '../../../shared/constants'
import { buildVisionMessage } from './apiKeyManager'

const conversations = new Map<string, ChatMessage[]>()
const activeRequests = new Map<string, AbortController>()

export async function sendMessage(
  request: SendMessageRequest
): Promise<SendMessageResult> {
  const client = new OpenAI({
    baseURL: request.baseUrl,
    apiKey: request.apiKey
  })

  let history = conversations.get(request.conversationId) || []
  if (history.length === 0) {
    history = [
      {
        role: 'system',
        content:
          request.systemPrompt ||
          '你是一个智能助手，能够回答问题、分析图片和生成图片。当用户提供图片时，请仔细分析图片内容并给出回答。当用户请求生成图片时，请用简洁的语言描述你将要生成的内容。当用户提出一般问题时，请用友好的方式回答。'
      }
    ]
  }

  const userMessage = buildVisionMessage(request.message, request.imageData)
  history.push(userMessage as ChatMessage)
  history = trimHistory(history)

  const controller = new AbortController()
  activeRequests.set(request.conversationId, controller)

  try {
    const stream = await client.chat.completions.create(
      {
        model: request.model || 'gpt-4o',
        messages: history as any,
        stream: true
      },
      { signal: controller.signal }
    )

    let fullContent = ''
    let model = ''
    let tokens = 0

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (delta) {
        fullContent += delta
        request.streamCallback?.(delta)
      }
      if (chunk.model) model = chunk.model
      if (chunk.usage) tokens = chunk.usage.total_tokens
    }

    history.push({ role: 'assistant', content: fullContent })
    conversations.set(request.conversationId, history)

    return { content: fullContent, model, tokens }
  } finally {
    activeRequests.delete(request.conversationId)
  }
}

export function cancelStream(conversationId: string): void {
  const controller = activeRequests.get(conversationId)
  if (controller) {
    controller.abort()
    activeRequests.delete(conversationId)
  }
}

export function clearConversation(conversationId: string): void {
  conversations.delete(conversationId)
}

function trimHistory(messages: ChatMessage[], maxTokens: number = MAX_CONTEXT_TOKENS): ChatMessage[] {
  const systemMsg = messages[0]?.role === 'system' ? [messages[0]] : []
  const nonSystemMsgs = systemMsg.length ? messages.slice(1) : messages

  let tokenCount = 0
  const kept: ChatMessage[] = []
  for (let i = nonSystemMsgs.length - 1; i >= 0; i--) {
    const content = nonSystemMsgs[i].content
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content)
    const msgTokens = Math.ceil(contentStr.length / 2)
    if (tokenCount + msgTokens > maxTokens) break
    tokenCount += msgTokens
    kept.unshift(nonSystemMsgs[i])
  }

  return [...systemMsg, ...kept]
}
