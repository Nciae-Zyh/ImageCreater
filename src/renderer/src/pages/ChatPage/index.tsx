import { useState, useEffect, useCallback, useRef } from 'react'
import { Layout, Button, Space, Typography, Tag, message as antMessage } from 'antd'
import { SettingOutlined, RobotOutlined, FileTextOutlined } from '@ant-design/icons'
import Sidebar from './components/Sidebar'
import ChatMessage from '../../components/ChatMessage'
import ChatInput from '../../components/ChatInput'
import { useConversationStore } from '../../stores/conversationStore'
import { useProviderStore } from '../../stores/providerStore'
import { useChat } from '../../hooks/useChat'
import type { MessageImage, ModelSelection } from '@shared/types'

const { Header, Content } = Layout
const { Text } = Typography
const isMac = window.electronAPI?.app?.platform() === 'darwin'

interface ChatPageProps {
  onOpenSettings: () => void
}

interface PromptCandidate {
  prompt: string
  why: string
}

export default function ChatPage({ onOpenSettings }: ChatPageProps) {
  const { conversations, activeConversationId, createConversation, switchConversation, loadConversations, addMessage } = useConversationStore()
  const { activeProviderId, imageProviderId, providers, selectedChatModel, selectedImageModel } = useProviderStore()
  const { sendMessage, isStreaming, cancelStream, streamState, streamingByConversation } = useChat()

  const [autoMode, setAutoMode] = useState(true)
  // 图片选择器数据（不渲染浮动 UI，仅管理状态）
  const [imagePicker, setImagePicker] = useState<{
    content: string; imageData?: MessageImage[];
    histImages: any[]; selectedImageIds: Set<string>; userMessageSaved?: boolean
  } | null>(null)
  const [promptPicker, setPromptPicker] = useState<{
    originalPrompt: string
    optimizedPrompt: string
    candidates: PromptCandidate[]
    recommendedIndex: number
    imageData?: MessageImage[]
    skipUserMessage?: boolean
    shouldKeepOriginalInHistory?: boolean
  } | null>(null)
  const [isPromptOptimizing, setIsPromptOptimizing] = useState(false)
  const [assistantPromptUi, setAssistantPromptUi] = useState<{
    originalPrompt: string
    statusText?: string
    optimizedPrompt?: string
    candidates?: PromptCandidate[]
    recommendedIndex?: number
    loading: boolean
    error?: string
  } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const activeConversation = conversations.find((c) => c.id === activeConversationId)
  const chatProvider = providers.find((p) => p.id === activeProviderId)

  useEffect(() => { loadConversations() }, [])

  // 切换对话时仅重置图片选择器，生成状态按会话独立维护
  useEffect(() => {
    setImagePicker(null)
    setPromptPicker(null)
    setIsPromptOptimizing(false)
    setAssistantPromptUi(null)
  }, [activeConversationId])

  const restorePickerFromLatestMessage = useCallback(async () => {
    if (!activeConversation || activeConversation.messages.length === 0) return
    if (imagePicker) return
    const lastMsg = activeConversation.messages[activeConversation.messages.length - 1] as any
    if (lastMsg.role !== 'assistant') return

    let needUserSelect = !!lastMsg.needUserSelect
    let promptFromMeta = lastMsg.content || ''
    const lastUserMessage = [...activeConversation.messages]
      .reverse()
      .find((m) => m.role === 'user' && m.content?.trim())

    try {
      const parsed = typeof lastMsg.metadata === 'string'
        ? JSON.parse(lastMsg.metadata)
        : (lastMsg.metadata || {})
      needUserSelect = needUserSelect || !!parsed.needUserSelect
      promptFromMeta = parsed.prompt || parsed.optimizedPrompt || lastMsg.content || ''
    } catch {
      // ignore
    }

    if (!needUserSelect) return
    if (!promptFromMeta?.trim()) {
      promptFromMeta = lastUserMessage?.content || ''
    }
    await openImagePicker(promptFromMeta, undefined, true, true)
  }, [activeConversation, imagePicker, activeConversationId])

  // 加载历史消息后，如果最后一条助手消息需要用户选图，自动恢复选择器
  useEffect(() => {
    restorePickerFromLatestMessage()
  }, [restorePickerFromLatestMessage, activeConversation?.messages])

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [activeConversation?.messages, isStreaming, imagePicker])

  const handleNewChat = () => {
    if (!activeProviderId) { onOpenSettings(); return }
    const id = createConversation(activeProviderId, selectedChatModel || 'gpt-4o')
    switchConversation(id)
  }

  const doSend = async (
    content: string,
    imageData?: MessageImage[],
    options?: { skipUserMessage?: boolean; displayUserMessage?: string }
  ) => {
    const modelSelection: ModelSelection = autoMode
      ? { mode: 'auto' }
      : { mode: 'manual', chatModel: selectedChatModel, visionModel: chatProvider?.visionModel, imageModel: selectedImageModel }
    return await sendMessage(content, imageData, modelSelection, options)
  }

  const optimizePromptText = async (
    message: string,
    action: 'generate' | 'edit',
    selectedImageHints?: string[],
    selectedImages?: MessageImage[]
  ) => {
    if (!activeProviderId) {
      return {
        optimizedPrompt: message,
        candidates: [{ prompt: message, why: '保留原始输入' }],
        recommendedIndex: 0
      }
    }
    setIsPromptOptimizing(true)
    try {
      const result = await window.electronAPI.chat.optimizePrompt({
        message,
        providerId: activeProviderId,
        action,
        selectedImageHints,
        selectedImages
      })
      if (result?.success && result?.data?.optimizedPrompt) {
        const candidatesRaw = Array.isArray(result?.data?.candidates) ? result.data.candidates : []
        const candidates = candidatesRaw
          .map((item: any) => ({
            prompt: String(item?.prompt || '').trim(),
            why: String(item?.why || '').trim()
          }))
          .filter((item: PromptCandidate) => !!item.prompt)
        const recommendedIndexRaw = Number.isInteger(result?.data?.recommendedIndex) ? result.data.recommendedIndex : 0
        const safeRecommendedIndex = candidates.length > 0
          ? Math.max(0, Math.min(recommendedIndexRaw, candidates.length - 1))
          : 0
        return {
          optimizedPrompt: result.data.optimizedPrompt as string,
          candidates: candidates.length > 0 ? candidates : [{ prompt: result.data.optimizedPrompt as string, why: '模型推荐' }],
          recommendedIndex: safeRecommendedIndex
        }
      }
    } catch (e) {
      console.error('[ChatPage] optimizePrompt 错误:', e)
    } finally {
      setIsPromptOptimizing(false)
    }
    return {
      optimizedPrompt: message,
      candidates: [{ prompt: message, why: '优化失败，保留原始输入' }],
      recommendedIndex: 0
    }
  }

  const openImagePicker = async (
    content: string,
    imageData?: MessageImage[],
    lastSelected?: boolean,
    userMessageSaved?: boolean
  ) => {
    console.log('[ChatPage] openImagePicker 调用', { content: content?.slice(0, 50), activeConversationId })
    if (!activeConversationId) return
    let histImgs: any[] = []
    try {
      const result = await window.electronAPI.conversations.getImages(activeConversationId)
      console.log('[ChatPage] getImages 结果:', result.success, '图片数:', result.data?.length)
      if (result.success) histImgs = result.data || []
    } catch (e) { console.error('[ChatPage] getImages 错误:', e) }
    console.log('[ChatPage] setImagePicker', { histImgCount: histImgs.length, lastSelected })
    setImagePicker({
      content, imageData,
      histImages: histImgs,
      userMessageSaved: !!userMessageSaved,
      selectedImageIds: lastSelected && histImgs.length > 0
        ? new Set([histImgs[histImgs.length - 1].id])
        : new Set()
    })
  }

  const handleSend = async (content: string, imageData?: MessageImage[]) => {
    if (!activeProviderId || !activeConversationId) {
      await doSend(content, imageData)
      return
    }

    // 用户消息立即显示，后续流程在助手侧渐进展示
    addMessage(activeConversationId, {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      type: imageData?.length ? 'mixed' : 'text',
      imageData,
      timestamp: Date.now()
    } as any)

    setAssistantPromptUi({ originalPrompt: content, loading: true, statusText: '正在分析意图...' })
    try {
      const intentResult = await window.electronAPI.chat.analyzeIntent({
        message: content, providerId: activeProviderId, hasImage: !!(imageData && imageData.length > 0),
        conversationId: activeConversationId || undefined
      })
      if (!intentResult.success) {
        setAssistantPromptUi({ originalPrompt: content, loading: true, statusText: '意图分析失败，正在直接优化 Prompt...' })
        const optimized = await optimizePromptText(content, 'generate')
        setPromptPicker({
          originalPrompt: content,
          optimizedPrompt: optimized.optimizedPrompt,
          candidates: optimized.candidates,
          recommendedIndex: optimized.recommendedIndex,
          imageData,
          skipUserMessage: true,
          shouldKeepOriginalInHistory: true
        })
        setAssistantPromptUi({
          originalPrompt: content,
          optimizedPrompt: optimized.optimizedPrompt,
          candidates: optimized.candidates,
          recommendedIndex: optimized.recommendedIndex,
          loading: false
        })
        return
      }
      const action = intentResult.data?.action || 'chat'
      if (action === 'chat' || action === 'analyze') {
        setAssistantPromptUi(null)
        await doSend(content, imageData, {
          skipUserMessage: true,
          displayUserMessage: content
        })
        return
      }
      if (action === 'generate') {
        setAssistantPromptUi({ originalPrompt: content, loading: true, statusText: '意图识别为生成，正在优化 Prompt...' })
        const optimized = await optimizePromptText(content, 'generate')
        setPromptPicker({
          originalPrompt: content,
          optimizedPrompt: optimized.optimizedPrompt,
          candidates: optimized.candidates,
          recommendedIndex: optimized.recommendedIndex,
          imageData,
          skipUserMessage: true,
          shouldKeepOriginalInHistory: true
        })
        setAssistantPromptUi({
          originalPrompt: content,
          statusText: '已生成候选 Prompt，请选择',
          optimizedPrompt: optimized.optimizedPrompt,
          candidates: optimized.candidates,
          recommendedIndex: optimized.recommendedIndex,
          loading: false
        })
        return
      }
      // action === edit：先选图，再做优化
      setAssistantPromptUi({ originalPrompt: content, loading: false, statusText: '意图识别为编辑，请先选择图片' })
      await openImagePicker(content, imageData, true, true)
    } catch (e) {
      console.error('[ChatPage] handleSend 错误:', e)
      setAssistantPromptUi({ originalPrompt: content, loading: true, statusText: '意图分析失败，正在直接优化 Prompt...' })
      const optimized = await optimizePromptText(content, 'generate')
      setPromptPicker({
        originalPrompt: content,
        optimizedPrompt: optimized.optimizedPrompt,
        candidates: optimized.candidates,
        recommendedIndex: optimized.recommendedIndex,
        imageData,
        skipUserMessage: true,
        shouldKeepOriginalInHistory: true
      })
      setAssistantPromptUi({
        originalPrompt: content,
        statusText: '已生成候选 Prompt，请选择',
        optimizedPrompt: optimized.optimizedPrompt,
        candidates: optimized.candidates,
        recommendedIndex: optimized.recommendedIndex,
        loading: false
      })
    }
  }

  const handleConfirmImagePicker = async () => {
    if (!imagePicker) return
    const { content, imageData, histImages, selectedImageIds, userMessageSaved } = imagePicker
    if (selectedImageIds.size === 0) {
      antMessage.warning('请至少选择一张图片')
      return
    }
    const selectedImgs: MessageImage[] = histImages
      .filter((img) => selectedImageIds.has(img.id))
      .map((img) => ({
        type: 'image' as const, mimeType: 'image/png',
        data: img.imageBase64 || '', url: img.imageUrl
      }))
    setImagePicker(null)
    const allImages = [...(imageData || []), ...selectedImgs]
    const selectedHints = histImages
      .filter((img) => selectedImageIds.has(img.id))
      .map((img) => String(img.content || '').trim())
      .filter(Boolean)
    setAssistantPromptUi({ originalPrompt: content, loading: true, statusText: '已选图片，正在结合图片优化 Prompt...' })
    const optimized = await optimizePromptText(content, 'edit', selectedHints, allImages)
    setPromptPicker({
      originalPrompt: content,
      optimizedPrompt: optimized.optimizedPrompt,
      candidates: optimized.candidates,
      recommendedIndex: optimized.recommendedIndex,
      imageData: allImages,
      skipUserMessage: !!userMessageSaved,
      shouldKeepOriginalInHistory: !userMessageSaved
    })
    setAssistantPromptUi({
      originalPrompt: content,
      statusText: '已生成候选 Prompt，请选择',
      optimizedPrompt: optimized.optimizedPrompt,
      candidates: optimized.candidates,
      recommendedIndex: optimized.recommendedIndex,
      loading: false
    })
  }

  const toggleImageSelect = (id: string) => {
    setImagePicker((prev) => {
      if (!prev) return prev
      const next = new Set(prev.selectedImageIds)
      if (next.has(id)) next.delete(id); else next.add(id)
      return { ...prev, selectedImageIds: next }
    })
  }

  const confirmPromptSelection = async (payload: { useOptimized: boolean; candidateIndex?: number }) => {
    if (!promptPicker) return
    const candidatePrompt = typeof payload.candidateIndex === 'number'
      ? promptPicker.candidates[payload.candidateIndex]?.prompt
      : undefined
    const sendContent = payload.useOptimized
      ? (candidatePrompt || promptPicker.optimizedPrompt)
      : promptPicker.originalPrompt
    const sendImages = promptPicker.imageData
    const skipUserMessage = promptPicker.skipUserMessage
    const shouldKeepOriginalInHistory = promptPicker.shouldKeepOriginalInHistory
    const originalPrompt = promptPicker.originalPrompt
    setPromptPicker(null)
    setAssistantPromptUi(null)

    const result = await doSend(
      sendContent,
      sendImages,
      {
        skipUserMessage: !!skipUserMessage,
        displayUserMessage: shouldKeepOriginalInHistory ? originalPrompt : undefined
      }
    )
    if (result?.data?.needUserSelect) {
      antMessage.info('视觉分析无法确定，请手动选择图片')
      await openImagePicker(originalPrompt, sendImages, true, true)
    }
  }

  return (
    <Layout style={{ height: '100%' }}>
      <Sidebar
        onNewChat={handleNewChat}
        onOpenSettings={onOpenSettings}
        streamingByConversation={streamingByConversation}
      />
      <Layout>
        <Header
          className="titlebar-drag"
          style={{
            background: '#fff', borderBottom: '1px solid #f0f0f0',
            padding: isMac ? '0 16px 0 76px' : '0 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            height: isMac ? 48 : 40
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <RobotOutlined style={{ fontSize: 18, color: '#1677ff', flexShrink: 0 }} />
            <Text strong style={{ fontSize: 13, flexShrink: 1, minWidth: 0 }} ellipsis={{ tooltip: activeConversation?.title }}>
              {activeConversation?.title || '新对话'}
            </Text>
          </div>
          <Space style={{ flexShrink: 0 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {chatProvider?.name || '未选择'} / {selectedChatModel || '未选择'}
              {selectedImageModel && <> + {selectedImageModel}</>}
            </Text>
            <Button
              type="text"
              icon={<FileTextOutlined />}
              onClick={async () => {
                const result = await window.electronAPI.log.export()
                if (result?.success) {
                  antMessage.success('日志已导出')
                } else if (result?.error !== '用户取消') {
                  antMessage.error(result?.error || '导出失败')
                }
              }}
              size="small"
              title="导出日志"
            />
            <Button type="text" icon={<SettingOutlined />} onClick={onOpenSettings} size="small" />
          </Space>
        </Header>

        <Content style={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${isMac ? 48 : 40}px)`, background: '#f5f5f5' }}>
          <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {activeConversation?.messages.map((msg, idx) => {
              const isLatestMsg = idx === activeConversation.messages.length - 1
              return (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  streaming={msg.role === 'assistant' && idx === activeConversation.messages.length - 1 && isStreaming}
                  error={msg.role === 'assistant' && idx === activeConversation.messages.length - 1 ? streamState.error : null}
                  conversationId={activeConversationId || undefined}
                  onDelete={async (msgId) => {
                    if (activeConversationId) {
                      await window.electronAPI.conversations.deleteMessage(activeConversationId, msgId)
                      loadConversations()
                    }
                  }}
                  isLatest={isLatestMsg}
                />
              )
            })}

            {imagePicker && !isStreaming && (
              <ChatMessage
                message={{
                  id: `assistant-image-picker-${activeConversationId || 'tmp'}`,
                  role: 'assistant',
                  content: assistantPromptUi?.statusText || '请选择要编辑的图片：',
                  type: 'text',
                  timestamp: Date.now()
                }}
                isLatest
                needUserSelect
                histImages={imagePicker.histImages}
                selectedImageIds={imagePicker.selectedImageIds}
                onToggleImage={toggleImageSelect}
                onConfirmImages={handleConfirmImagePicker}
                onCancelSelect={() => setImagePicker(null)}
              />
            )}

            {assistantPromptUi && !isStreaming && (assistantPromptUi.loading || !!assistantPromptUi.optimizedPrompt) && (
              <ChatMessage
                message={{
                  id: `assistant-prompt-ui-${activeConversationId || 'tmp'}`,
                  role: 'assistant',
                  content: assistantPromptUi.loading
                    ? (assistantPromptUi.statusText || '正在分析意图与优化 Prompt...')
                    : (assistantPromptUi.statusText || ''),
                  type: 'text',
                  timestamp: Date.now()
                }}
                isLatest
                promptOptimizing={assistantPromptUi.loading}
                promptChoice={!assistantPromptUi.loading && assistantPromptUi.optimizedPrompt ? {
                  originalPrompt: assistantPromptUi.originalPrompt,
                  optimizedPrompt: assistantPromptUi.optimizedPrompt,
                  candidates: assistantPromptUi.candidates,
                  recommendedIndex: assistantPromptUi.recommendedIndex
                } : null}
                onChooseOptimizedPrompt={!assistantPromptUi.loading && assistantPromptUi.optimizedPrompt ? (candidateIndex) => confirmPromptSelection({ useOptimized: true, candidateIndex }) : undefined}
                onChooseOriginalPrompt={!assistantPromptUi.loading && assistantPromptUi.optimizedPrompt ? () => confirmPromptSelection({ useOptimized: false }) : undefined}
                onCancelPromptChoice={!assistantPromptUi.loading && assistantPromptUi.optimizedPrompt ? () => {
                  setPromptPicker(null)
                  setAssistantPromptUi(null)
                } : undefined}
              />
            )}

            {(!activeConversation || activeConversation.messages.length === 0) && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                <RobotOutlined style={{ fontSize: 64, marginBottom: 16, opacity: 0.3 }} />
                <Text type="secondary" style={{ fontSize: 16 }}>开始对话，或输入"画一张..."来生成图片</Text>
                <Text type="secondary" style={{ fontSize: 13, marginTop: 8 }}>上传图片可进行分析和编辑</Text>
                <Space style={{ marginTop: 16 }}>
                  <Tag color="blue">自动选择模型</Tag>
                  <Tag color="green">语义分析</Tag>
                  <Tag color="orange">跨 Provider</Tag>
                </Space>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <ChatInput
            onSend={handleSend}
            onCancel={cancelStream}
            loading={isStreaming}
            disabled={!activeProviderId}
            autoMode={autoMode}
            onAutoModeChange={setAutoMode}
            conversationId={activeConversationId}
          />
        </Content>
      </Layout>
    </Layout>
  )
}
