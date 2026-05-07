import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useConversationStore } from '../stores/conversationStore'
import { useProviderStore } from '../stores/providerStore'
import type { MessageImage, ModelSelection } from '@shared/types'

export interface StreamState {
  steps: string[]
  textContent: string
  imageUrl: string | null
  partialImage: string | null
  meta: any | null
  error: { message: string; type: string; code?: string } | null
}

type StreamStateMap = Record<string, StreamState>
type StreamingMap = Record<string, boolean>

function createDefaultStreamState(): StreamState {
  return {
    steps: [],
    textContent: '',
    imageUrl: null,
    partialImage: null,
    meta: null,
    error: null
  }
}

function cleanText(text: string): string {
  return text
    .replace(/\]\s*\[/g, ' ')
    .replace(/\](?=\S)/g, '')
    .replace(/(?<!\[)(?<!\]\[)\](?=\s|$)/g, '')
    .replace(/\[\s*\]/g, '')
}

function toMessageMeta(state: StreamState) {
  if (state.meta) return { ...state.meta, steps: [...state.steps] }
  if (state.steps.length > 0) return { steps: [...state.steps] }
  return null
}

export function useChat() {
  const [error, setError] = useState<string | null>(null)
  const [streamStates, setStreamStates] = useState<StreamStateMap>({})
  const [streamingByConversation, setStreamingByConversation] = useState<StreamingMap>({})
  const activeConversationId = useConversationStore((s) => s.activeConversationId)
  const addMessage = useConversationStore((s) => s.addMessage)
  const updateMessage = useConversationStore((s) => s.updateMessage)
  const createConversation = useConversationStore((s) => s.createConversation)
  const { activeProviderId, imageProviderId, selectedChatModel } = useProviderStore()

  const streamStatesRef = useRef<StreamStateMap>({})
  const activeAssistantMessageIdRef = useRef<Record<string, string>>({})

  useEffect(() => {
    streamStatesRef.current = streamStates
  }, [streamStates])

  const setConversationStreaming = useCallback((conversationId: string, streaming: boolean) => {
    setStreamingByConversation((prev) => ({ ...prev, [conversationId]: streaming }))
  }, [])

  const updateConversationStreamState = useCallback((
    conversationId: string,
    updater: (current: StreamState) => StreamState
  ) => {
    const current = streamStatesRef.current[conversationId] || createDefaultStreamState()
    const next = updater(current)
    const nextMap = { ...streamStatesRef.current, [conversationId]: next }
    streamStatesRef.current = nextMap
    setStreamStates(nextMap)
  }, [])

  const syncAssistantMessage = useCallback((conversationId: string, state?: StreamState) => {
    const assistantMsgId = activeAssistantMessageIdRef.current[conversationId]
    if (!assistantMsgId) return
    const current = state || streamStatesRef.current[conversationId] || createDefaultStreamState()
    const meta = toMessageMeta(current)
    updateMessage(conversationId, assistantMsgId, {
      content: current.textContent,
      steps: [...current.steps],
      imageUrl: current.imageUrl || undefined,
      partialImage: current.partialImage || undefined,
      metadata: meta ? JSON.stringify(meta) : undefined
    } as any)
    if (current.meta?.needUserSelect) {
      updateMessage(conversationId, assistantMsgId, { needUserSelect: true } as any)
    }
  }, [updateMessage])

  // 只注册一次全局流监听，按 conversationId 路由到各自状态。
  useEffect(() => {
    const unsubscribe = window.electronAPI.chat.onStream(({ conversationId, chunk }) => {
      if (!conversationId || !chunk) return

      const current = streamStatesRef.current[conversationId] || createDefaultStreamState()
      let next = current

      if (chunk.startsWith('[STEP]')) {
        next = { ...current, steps: [...current.steps, chunk.slice(6)] }
      } else if (chunk.startsWith('[TEXT]')) {
        next = { ...current, textContent: cleanText(current.textContent + chunk.slice(5)) }
      } else if (chunk.startsWith('[IMAGE]')) {
        next = { ...current, imageUrl: chunk.slice(7), partialImage: null }
      } else if (chunk.startsWith('[PARTIAL_IMAGE]')) {
        const data = chunk.slice(15)
        const sepIdx = data.indexOf(';')
        const b64 = sepIdx > 0 ? data.slice(sepIdx + 1) : data
        next = { ...current, partialImage: b64 }
      } else if (chunk.startsWith('[META]')) {
        let meta = current.meta
        try { meta = JSON.parse(chunk.slice(6)) } catch {}
        const textContent = current.textContent || meta?.prompt || meta?.optimizedPrompt || ''
        next = { ...current, meta, textContent }
      } else if (chunk.startsWith('[ERROR]')) {
        try {
          const parsed = JSON.parse(chunk.slice(7))
          next = { ...current, error: parsed }
        } catch {
          next = { ...current, error: { message: chunk.slice(7), type: 'unknown_error' } }
        }
      } else if (chunk !== '[DONE]') {
        next = { ...current, textContent: cleanText(current.textContent + chunk) }
      }

      if (next !== current) {
        const nextMap = { ...streamStatesRef.current, [conversationId]: next }
        streamStatesRef.current = nextMap
        setStreamStates(nextMap)
        syncAssistantMessage(conversationId, next)
      }

      if (chunk === '[DONE]') {
        setConversationStreaming(conversationId, false)
        syncAssistantMessage(conversationId, next)
      }
    })

    return () => unsubscribe()
  }, [setConversationStreaming, syncAssistantMessage])

  const sendMessage = useCallback(async (
    content: string,
    imageData?: MessageImage[],
    modelSelection?: ModelSelection,
    options?: { skipUserMessage?: boolean; displayUserMessage?: string }
  ) => {
    const chatProviderId = activeProviderId
    const imgProviderId = imageProviderId || activeProviderId
    if (!chatProviderId) {
      setError('请先配置 API Key')
      return null
    }

    setError(null)

    let conversationId = activeConversationId
    if (!conversationId) {
      conversationId = createConversation(chatProviderId, selectedChatModel)
    }

    const initialState = createDefaultStreamState()
    const initMap = { ...streamStatesRef.current, [conversationId]: initialState }
    streamStatesRef.current = initMap
    setStreamStates(initMap)
    setConversationStreaming(conversationId, true)

    const skipFrontend = options?.skipUserMessage
    const displayUserMessage = options?.displayUserMessage || content
    if (!skipFrontend) {
      addMessage(conversationId, {
        id: crypto.randomUUID(),
        role: 'user',
        content: displayUserMessage,
        type: imageData?.length ? 'mixed' : 'text',
        imageData,
        timestamp: Date.now()
      } as any)
    }

    const assistantMsgId = crypto.randomUUID()
    activeAssistantMessageIdRef.current[conversationId] = assistantMsgId
    addMessage(conversationId, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      type: 'text',
      steps: [],
      imageUrl: undefined,
      timestamp: Date.now()
    } as any)

    try {
      const cleanImageData = imageData?.map((img) => ({
        type: img.type as 'image',
        mimeType: img.mimeType || 'image/png',
        data: img.data || '',
        ...(img.url ? { url: img.url } : {})
      }))

      const result = await window.electronAPI.chat.send({
        message: content,
        displayMessage: displayUserMessage,
        conversationId,
        providerId: chatProviderId,
        imageProviderId: imgProviderId,
        imageData: cleanImageData,
        modelSelection
      })

      if (result?.success && result?.data?.imageUrl) {
        updateConversationStreamState(conversationId, (current) => ({
          ...current,
          imageUrl: result.data.imageUrl,
          partialImage: null
        }))
        syncAssistantMessage(conversationId)
      }

      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败')
      return null
    } finally {
      syncAssistantMessage(conversationId)
      setConversationStreaming(conversationId, false)
    }
  }, [
    activeConversationId,
    activeProviderId,
    imageProviderId,
    selectedChatModel,
    createConversation,
    addMessage,
    setConversationStreaming,
    updateConversationStreamState,
    syncAssistantMessage
  ])

  const cancelStream = useCallback(() => {
    if (!activeConversationId) return
    window.electronAPI.chat.cancel(activeConversationId)
    setConversationStreaming(activeConversationId, false)
    updateConversationStreamState(activeConversationId, (current) => ({
      ...current,
      error: { message: '已取消', type: 'cancelled' }
    }))
    syncAssistantMessage(activeConversationId)
  }, [activeConversationId, setConversationStreaming, updateConversationStreamState, syncAssistantMessage])

  const resetStreaming = useCallback((conversationId?: string | null) => {
    if (!conversationId) return
    setConversationStreaming(conversationId, false)
    setStreamStates((prev) => ({ ...prev, [conversationId]: createDefaultStreamState() }))
  }, [setConversationStreaming])

  const streamState = useMemo(() => {
    if (!activeConversationId) return createDefaultStreamState()
    return streamStates[activeConversationId] || createDefaultStreamState()
  }, [activeConversationId, streamStates])

  const isStreaming = useMemo(() => {
    if (!activeConversationId) return false
    return !!streamingByConversation[activeConversationId]
  }, [activeConversationId, streamingByConversation])

  return {
    sendMessage,
    cancelStream,
    resetStreaming,
    isStreaming,
    error,
    streamState,
    streamingByConversation
  }
}
