import { useState, useEffect, useCallback, useRef } from 'react'
import { Layout, Button, Space, Typography, Tag, Spin, message as antMessage } from 'antd'
import { SettingOutlined, RobotOutlined, CheckOutlined } from '@ant-design/icons'
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
  const { sendMessage, isStreaming, cancelStream, streamState } = useChat()

  const [autoMode, setAutoMode] = useState(true)
  // agent 式图片选择：在聊天区域展示，而非弹窗
  const [imagePicker, setImagePicker] = useState<{
    content: string; imageData?: MessageImage[];
    histImages: any[]; selectedImageIds: Set<string>
  } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const activeConversation = conversations.find((c) => c.id === activeConversationId)
  const chatProvider = providers.find((p) => p.id === activeProviderId)

  useEffect(() => { loadConversations() }, [])

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

  const doSend = async (content: string, imageData?: MessageImage[]) => {
    const modelSelection: ModelSelection = autoMode
      ? { mode: 'auto' }
      : { mode: 'manual', chatModel: selectedChatModel, visionModel: chatProvider?.visionModel, imageModel: selectedImageModel }
    await sendMessage(content, imageData, modelSelection)
  }

  const handleSend = async (content: string, imageData?: MessageImage[]) => {
    if (imageData && imageData.length > 0) {
      await doSend(content, imageData)
      return
    }
    if (!activeProviderId || !activeConversationId) {
      await doSend(content, imageData)
      return
    }
    // AI 分析意图
    try {
      const intentResult = await window.electronAPI.chat.analyzeIntent({
        message: content, providerId: activeProviderId, hasImage: false,
        conversationId: activeConversationId || undefined
      })
      if (!intentResult.success) {
        await doSend(content, imageData)
        return
      }
      const action = intentResult.data?.action || 'chat'
      if (action === 'chat' || action === 'analyze') {
        await doSend(content, imageData)
        return
      }
      // edit 或 generate：获取历史图片，展示给用户选择
      let histImgs: any[] = []
      try {
        const result = await window.electronAPI.conversations.getImages(activeConversationId)
        if (result.success) histImgs = result.data || []
      } catch {}
      if (histImgs.length > 0) {
        setImagePicker({
          content, imageData, histImages: histImgs,
          selectedImageIds: action === 'edit' ? new Set([histImgs[histImgs.length - 1].id]) : new Set()
        })
      } else {
        await doSend(content, imageData)
      }
    } catch {
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
    setImagePicker(null)
    await doSend(content, [...(imageData || []), ...selectedImgs])
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
      <Sidebar onNewChat={handleNewChat} onOpenSettings={onOpenSettings} />
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
            <Button type="text" icon={<SettingOutlined />} onClick={onOpenSettings} size="small" />
          </Space>
        </Header>

        <Content style={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${isMac ? 48 : 40}px)`, background: '#f5f5f5' }}>
          <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {activeConversation?.messages.map((msg, idx) => {
              const isLastAssistant = msg.role === 'assistant' && idx === activeConversation.messages.length - 1
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
                />
              )
            })}

            {/* Agent 式图片选择器 - 直接在聊天区域展示 */}
            {imagePicker && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <RobotOutlined style={{ color: '#666', fontSize: 16 }} />
                </div>
                <div style={{ background: '#fff', padding: '16px', borderRadius: '12px 12px 12px 4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', maxWidth: 600 }}>
                  <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>
                    找到 {imagePicker.histImages.length} 张历史图片，请选择要操作的图片：
                  </Text>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, maxHeight: 280, overflow: 'auto', marginBottom: 12 }}>
                    {imagePicker.histImages.map((img: any) => {
                      const selected = imagePicker.selectedImageIds.has(img.id)
                      return (
                        <div key={img.id} onClick={() => toggleImageSelect(img.id)} style={{
                          cursor: 'pointer', borderRadius: 8, overflow: 'hidden',
                          border: selected ? '2px solid #1677ff' : '2px solid #f0f0f0',
                          position: 'relative', transition: 'border-color 0.2s'
                        }}>
                          <img src={img.imageUrl || `data:image/png;base64,${img.imageBase64}`} alt=""
                            style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} />
                          {selected && <div style={{
                            position: 'absolute', top: 4, right: 4, background: '#1677ff', color: '#fff',
                            borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}><CheckOutlined style={{ fontSize: 10 }} /></div>}
                          <div style={{ padding: '4px 6px', background: '#fafafa' }}>
                            <Text ellipsis style={{ fontSize: 11 }}>{img.content || '图片'}</Text>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <Space>
                    <Button type="primary" icon={<CheckOutlined />} onClick={handleConfirmImagePicker}
                      disabled={imagePicker.selectedImageIds.size === 0}>
                      确认选择 ({imagePicker.selectedImageIds.size})
                    </Button>
                    <Button onClick={() => setImagePicker(null)}>取消</Button>
                  </Space>
                </div>
              </div>
            )}

            {(!activeConversation || activeConversation.messages.length === 0) && !imagePicker && (
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
            disabled={!activeProviderId || !!imagePicker}
            autoMode={autoMode}
            onAutoModeChange={setAutoMode}
            conversationId={activeConversationId}
          />
        </Content>
      </Layout>
    </Layout>
  )
}
