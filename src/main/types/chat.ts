import type { MessageImage } from '../../../shared/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
}

export interface SendMessageRequest {
  message: string
  conversationId: string
  baseUrl: string
  apiKey: string
  model?: string
  systemPrompt?: string
  imageData?: MessageImage[]
  streamCallback?: (chunk: string) => void
}

export interface SendMessageResult {
  content: string
  model: string
  tokens: number
}
