import { useState, useCallback, useRef } from 'react'
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

export function useChat() {
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamState, setStreamState] = useState<StreamState>({
    steps: [], textContent: '', imageUrl: null, partialImage: null, meta: null, error: null
  })

  const cancelRef = useRef<(() => void) | null>(null)
  const { activeConversationId, addMessage, updateMessage, createConversation } = useConversationStore()
  const { activeProviderId, imageProviderId, selectedChatModel } = useProviderStore()

  const sendMessage = useCallback(async (
    content: string,
    imageData?: MessageImage[],
    modelSelection?: ModelSelection
  ) => {
    const chatProviderId = activeProviderId
    const imgProviderId = imageProviderId || activeProviderId

    if (!chatProviderId) { setError('请先配置 API Key'); return null }

    setError(null)
    setIsStreaming(true)
    setStreamState({ steps: [], textContent: '', imageUrl: null, partialImage: null, meta: null, error: null })

    let convId = activeConversationId
    if (!convId) convId = createConversation(chatProviderId, selectedChatModel)

    // 用户消息
    addMessage(convId, {
      id: crypto.randomUUID(), role: 'user', content, type: 'text',
      imageData, timestamp: Date.now()
    })

    // 助手消息占位
    const assistantMsgId = crypto.randomUUID()
    addMessage(convId, {
      id: assistantMsgId, role: 'assistant', content: '', type: 'text',
      steps: [], imageUrl: undefined, timestamp: Date.now()
    })

    // 维护一个累积的消息状态
    const msgState = { steps: [] as string[], textContent: '', imageUrl: null as string | null, partialImage: null as string | null, meta: null as any }

    const flushUpdate = () => {
      updateMessage(convId!, assistantMsgId, {
        content: msgState.textContent,
        steps: [...msgState.steps],
        imageUrl: msgState.imageUrl || undefined,
        partialImage: msgState.partialImage || undefined,
        metadata: msgState.meta ? JSON.stringify(msgState.meta) : undefined
      })
    }

    // 清理流式文本中的异常字符（如 MiMo 模型返回的 markdown 格式符号）
    const cleanText = (text: string): string => {
      return text
        .replace(/\]\s*\[/g, ' ')   // ][ 变空格
        .replace(/\](?=\S)/g, '')    // ] 后面紧跟文字时删除
        .replace(/(?<!\[)(?<!\]\[)\](?=\s|$)/g, '') // 孤立的 ] 删除
        .replace(/\[\s*\]/g, '')     // 空的 [] 删除
    }

    try {
      cancelRef.current = window.electronAPI.chat.onStream((raw: string) => {
        if (raw.startsWith('[STEP]')) {
          msgState.steps.push(raw.slice(6))
          setStreamState((s) => ({ ...s, steps: [...msgState.steps] }))
          flushUpdate()
        } else if (raw.startsWith('[TEXT]')) {
          msgState.textContent += raw.slice(5)
          // 清理异常字符
          msgState.textContent = cleanText(msgState.textContent)
          setStreamState((s) => ({ ...s, textContent: msgState.textContent }))
          flushUpdate()
        } else if (raw.startsWith('[IMAGE]')) {
          msgState.imageUrl = raw.slice(7)
          msgState.partialImage = null
          console.log('[Stream] 收到图片:', msgState.imageUrl?.slice(0, 80))
          setStreamState((s) => ({ ...s, imageUrl: msgState.imageUrl, partialImage: null }))
          flushUpdate()
        } else if (raw.startsWith('[PARTIAL_IMAGE]')) {
          const data = raw.slice(15)
          const sepIdx = data.indexOf(';')
          const idx = sepIdx > 0 ? data.slice(0, sepIdx) : '0'
          const b64 = sepIdx > 0 ? data.slice(sepIdx + 1) : data
          msgState.partialImage = b64
          console.log(`[Stream] 收到部分图片 #${idx}, 大小=${b64.length} bytes`)
          setStreamState((s) => ({ ...s, partialImage: b64 }))
          flushUpdate()
        } else if (raw.startsWith('[META]')) {
          try { msgState.meta = JSON.parse(raw.slice(6)) } catch {}
          setStreamState((s) => ({ ...s, meta: msgState.meta }))
          flushUpdate()
        } else if (raw.startsWith('[ERROR]')) {
          try {
            const errData = JSON.parse(raw.slice(7))
            setStreamState((s) => ({ ...s, error: errData }))
          } catch {
            setStreamState((s) => ({ ...s, error: { message: raw.slice(7), type: 'unknown_error' } }))
          }
        } else if (raw !== '[DONE]') {
          msgState.textContent += raw
          msgState.textContent = cleanText(msgState.textContent)
          setStreamState((s) => ({ ...s, textContent: msgState.textContent }))
          flushUpdate()
        }
      })

      return await window.electronAPI.chat.send({
        message: content, conversationId: convId,
        providerId: chatProviderId, imageProviderId: imgProviderId,
        imageData, modelSelection
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败')
      return null
    } finally {
      setIsStreaming(false)
      cancelRef.current?.()
      cancelRef.current = null
    }
  }, [activeConversationId, activeProviderId, imageProviderId, selectedChatModel])

  const cancelStream = useCallback(() => {
    if (activeConversationId) window.electronAPI.chat.cancel(activeConversationId)
    setIsStreaming(false)
  }, [activeConversationId])

  return { sendMessage, cancelStream, isStreaming, error, streamState }
}
