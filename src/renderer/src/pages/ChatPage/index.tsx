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

export default function ChatPage({ onOpenSettings }: ChatPageProps) {
  const { conversations, activeConversationId, createConversation, switchConversation, loadConversations } = useConversationStore()
  const { activeProviderId, imageProviderId, providers, selectedChatModel, selectedImageModel } = useProviderStore()
  const { sendMessage, isStreaming, cancelStream, streamState, streamingByConversation } = useChat()

  const [autoMode, setAutoMode] = useState(true)
  // 图片选择器数据（不渲染浮动 UI，仅管理状态）
  const [imagePicker, setImagePicker] = useState<{
    content: string; imageData?: MessageImage[];
    histImages: any[]; selectedImageIds: Set<string>
  } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const activeConversation = conversations.find((c) => c.id === activeConversationId)
  const chatProvider = providers.find((p) => p.id === activeProviderId)

  useEffect(() => { loadConversations() }, [])

  // 切换对话时仅重置图片选择器，生成状态按会话独立维护
  useEffect(() => {
    setImagePicker(null)
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
    await openImagePicker(promptFromMeta, undefined, true)
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

  const doSend = async (content: string, imageData?: MessageImage[], options?: { skipUserMessage?: boolean }) => {
    const modelSelection: ModelSelection = autoMode
      ? { mode: 'auto' }
      : { mode: 'manual', chatModel: selectedChatModel, visionModel: chatProvider?.visionModel, imageModel: selectedImageModel }
    return await sendMessage(content, imageData, modelSelection, options)
  }

  const openImagePicker = async (content: string, imageData?: MessageImage[], lastSelected?: boolean) => {
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
      selectedImageIds: lastSelected && histImgs.length > 0
        ? new Set([histImgs[histImgs.length - 1].id])
        : new Set()
    })
  }

  const handleSend = async (content: string, imageData?: MessageImage[]) => {
    if (imageData && imageData.length > 0) {
      const result = await doSend(content, imageData)
      if (result?.data?.needUserSelect) {
        antMessage.info('视觉分析无法确定，请手动选择图片')
        await openImagePicker(content, imageData, true)
      }
      return
    }
    if (!activeProviderId || !activeConversationId) {
      await doSend(content, imageData)
      return
    }
    try {
      const intentResult = await window.electronAPI.chat.analyzeIntent({
        message: content, providerId: activeProviderId, hasImage: false,
        conversationId: activeConversationId || undefined
      })
      if (!intentResult.success) {
        const result = await doSend(content, imageData)
        if (result?.data?.needUserSelect) {
          antMessage.info('视觉分析无法确定，请手动选择图片')
          await openImagePicker(content, imageData, true)
        }
        return
      }
      const action = intentResult.data?.action || 'chat'
      if (action === 'chat' || action === 'analyze') {
        await doSend(content, imageData)
        return
      }
      await openImagePicker(content, imageData, action === 'edit')
    } catch (e) {
      console.error('[ChatPage] handleSend 错误:', e)
      await doSend(content, imageData)
    }
  }

  const handleConfirmImagePicker = async () => {
    if (!imagePicker) return
    const { content, imageData, histImages, selectedImageIds } = imagePicker
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
    const convId = activeConversationId
    setImagePicker(null)
    // skipUserMessage: 用户消息已在首次发送时保存，避免重复
    const result = await doSend(content, [...(imageData || []), ...selectedImgs], { skipUserMessage: true })
    // 等待对话和消息从 DB 完整加载
    await loadConversations()
    if (convId) await switchConversation(convId)
    // 直接检查：IPC 返回 needUserSelect 或 DB 消息需要选图
    const lastMsg = useConversationStore.getState().conversations
      .find(c => c.id === convId)?.messages.slice(-1)[0]
    if (result?.data?.needUserSelect || (lastMsg as any)?.needUserSelect) {
      antMessage.info('视觉分析无法确定，请手动选择图片')
      await openImagePicker(content, imageData, true)
    }
  }

  const toggleImageSelect = (id: string) => {
    setImagePicker((prev) => {
      if (!prev) return prev
      const next = new Set(prev.selectedImageIds)
      if (next.has(id)) next.delete(id); else next.add(id)
      return { ...prev, selectedImageIds: next }
    })
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
              const isLastAssistant = msg.role === 'assistant' && idx === activeConversation.messages.length - 1
              const isLatestMsg = idx === activeConversation.messages.length - 1
              // 判断是否需要显示内联图片选择器
              const showPicker = isLastAssistant && imagePicker && !isStreaming
              return (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  streaming={isLastAssistant && isStreaming}
                  error={isLastAssistant ? streamState.error : null}
                  conversationId={activeConversationId || undefined}
                  onDelete={async (msgId) => {
                    if (activeConversationId) {
                      await window.electronAPI.conversations.deleteMessage(activeConversationId, msgId)
                      loadConversations()
                    }
                  }}
                  needUserSelect={showPicker}
                  histImages={showPicker ? imagePicker.histImages : undefined}
                  selectedImageIds={showPicker ? imagePicker.selectedImageIds : undefined}
                  isLatest={isLatestMsg}
                  onToggleImage={showPicker ? toggleImageSelect : undefined}
                  onConfirmImages={showPicker ? handleConfirmImagePicker : undefined}
                  onCancelSelect={showPicker ? () => setImagePicker(null) : undefined}
                />
              )
            })}

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
