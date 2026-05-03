export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  chatModels: string[]
  imageModels: string[]
  visionModels: string[]
  supportsVision: boolean
  supportsImageEdit: boolean
  description: string
}

export interface ApiKeyRecord {
  id: string
  name: string
  baseUrl: string
  encryptedKey: string
  models: string[]
  chatModel: string
  imageModel: string
  visionModel: string
  createdAt: number
}

export interface ApiKeyDisplay {
  id: string
  name: string
  baseUrl: string
  maskedKey: string
  models: string[]
  chatModel: string
  imageModel: string
  visionModel: string
  createdAt: number
}

export interface MessageImage {
  type: 'image'
  mimeType: string
  data: string
  url?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  type: 'text' | 'image' | 'mixed'
  imageUrl?: string
  partialImage?: string
  imageData?: MessageImage[]
  metadata?: {
    model: string
    tokens?: number
    duration?: number
  }
  timestamp: number
}

export interface Conversation {
  id: string
  title: string
  providerId: string
  model: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

export interface AppSettings {
  defaultProviderId: string | null
  defaultChatModel: string
  defaultImageModel: string
  theme: 'light' | 'dark' | 'system'
}

export interface ChatSendRequest {
  message: string
  conversationId: string
  providerId: string
  imageData?: MessageImage[]
}

export interface ChatSendResponse {
  type: 'chat' | 'image' | 'mixed'
  content: string
  imageUrl?: string
  imageBase64?: string
  metadata: {
    model: string
    tokens?: number
    duration: number
  }
}

export interface ImageGenerateRequest {
  prompt: string
  providerId: string
  imageData?: MessageImage
  options?: {
    model?: string
    size?: string
    quality?: string
  }
}

export type IntentAction = 'chat' | 'generate' | 'edit' | 'analyze'

export interface ClassifiedIntent {
  action: IntentAction
  confidence: number
  reason: string
}

export type ModelSelectionMode = 'auto' | 'manual'

export interface ModelSelection {
  mode: ModelSelectionMode
  chatModel?: string
  visionModel?: string
  imageModel?: string
}

export interface RouterRequest {
  message: string
  conversationId: string
  providerId: string
  imageProviderId?: string
  imageData?: MessageImage[]
  modelSelection?: ModelSelection
  onStep?: (step: string) => void
  streamCallback?: (chunk: string) => void
}

export interface RouterResponse {
  action: IntentAction
  content: string
  optimizedPrompt?: string
  imageUrl?: string
  imageBase64?: string
  metadata: {
    chatModel: string
    visionModel?: string
    imageModel?: string
    tokens?: number
    duration: number
    steps: string[]
  }
}
