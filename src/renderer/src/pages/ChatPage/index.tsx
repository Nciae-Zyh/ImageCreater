import { useState, useEffect, useCallback, useRef } from 'react'
import { Layout, Button, Space, Typography, Tag, Dropdown, Modal, Card, Radio, Spin } from 'antd'
import type { MenuProps } from 'antd'
import { SettingOutlined, RobotOutlined, PictureOutlined, CheckOutlined, ThunderboltOutlined } from '@ant-design/icons'
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
  const [intentConfirm, setIntentConfirm] = useState<{
    visible: boolean; action: string; confidence: number; reason: string;
    content: string; imageData?: MessageImage[]; histImages: any[];
    selectedImageIds: Set<string>; loading: boolean
  } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const activeConversation = conversations.find((c) => c.id === activeConversationId)
  const chatProvider = providers.find((p) => p.id === activeProviderId)

  useEffect(() => { loadConversations() }, [])

  // 自动滚动到底部
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [activeConversation?.messages, isStreaming])

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
    // 如果用户已上传图片，直接编辑
    if (imageData && imageData.length > 0) {
      await doSend(content, imageData)
      return
    }
    if (!activeProviderId || !activeConversationId) {
      await doSend(content, imageData)
      return
    }
    // AI 分析意图
    setIntentConfirm({
      visible: true, action: 'analyzing', confidence: 0, reason: '',
      content, imageData, histImages: [], selectedImageIds: new Set(), loading: true
    })
    try {
      const intentResult = await window.electronAPI.chat.analyzeIntent({
        message: content, providerId: activeProviderId, hasImage: false
      })
      if (!intentResult.success) {
        setIntentConfirm(null)
        await doSend(content, imageData)
        return
      }
      const action = intentResult.data?.action || 'chat'
      // 如果是 chat 或 analyze，直接发送
      if (action === 'chat' || action === 'analyze') {
        setIntentConfirm(null)
        await doSend(content, imageData)
        return
      }
      // edit 或 generate：获取历史图片
      let histImgs: any[] = []
      try {
        const result = await window.electronAPI.conversations.getImages(activeConversationId)
        if (result.success) histImgs = result.data || []
      } catch {}
      setIntentConfirm({
        visible: true, action, confidence: intentResult.data?.confidence || 0,
        reason: intentResult.data?.reason || '', content, imageData,
        histImages: histImgs, selectedImageIds: new Set(), loading: false
      })
    } catch {
      setIntentConfirm(null)
      await doSend(content, imageData)
    }
  }

  const handleConfirmIntent = async () => {
    if (!intentConfirm) return
    const { content, imageData, action, histImages, selectedImageIds } = intentConfirm
    // 收集选中的历史图片
    const selectedImgs: MessageImage[] = histImages
      .filter((img) => selectedImageIds.has(img.id))
      .map((img) => ({
        type: 'image' as const, mimeType: 'image/png',
        data: img.imageBase64 || '', url: img.imageUrl
      }))
    // 编辑意图：如果没有选图片，自动用最新一张
    if (action === 'edit' && selectedImgs.length === 0 && histImages.length > 0) {
      const latest = histImages[histImages.length - 1]
      selectedImgs.push({
        type: 'image', mimeType: 'image/png',
        data: latest.imageBase64 || '', url: latest.imageUrl
      })
    }
    setIntentConfirm(null)
    await doSend(content, [...(imageData || []), ...selectedImgs])
  }

  const handleCancelIntent = () => {
    setIntentConfirm(null)
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
          <Space style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <RobotOutlined style={{ fontSize: 18, color: '#1677ff', flexShrink: 0 }} />
            <Text strong style={{ fontSize: 13, maxWidth: 300 }} ellipsis={{ tooltip: activeConversation?.title }}>
              {activeConversation?.title || '新对话'}
            </Text>
          </Space>
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
                  <Tag color="purple">Prompt 优化</Tag>
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

      {/* 意图确认弹窗 */}
      <Modal
        title={
          <Space>
            <ThunderboltOutlined style={{ color: '#1677ff' }} />
            AI 意图分析
          </Space>
        }
        open={!!intentConfirm?.visible}
        onOk={handleConfirmIntent}
        onCancel={handleCancelIntent}
        okText="确认执行"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        {intentConfirm?.loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /><Text style={{ marginLeft: 8 }}>AI 分析中...</Text></div>
        ) : intentConfirm && (
          <div>
            <Card size="small" style={{ marginBottom: 12 }}>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space>
                  <Tag color={intentConfirm.action === 'edit' ? 'orange' : intentConfirm.action === 'generate' ? 'blue' : 'green'}>
                    {intentConfirm.action === 'edit' ? '编辑图片' :
                     intentConfirm.action === 'generate' ? '生成图片' :
                     intentConfirm.action === 'analyze' ? '分析图片' : '对话'}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>置信度 {((intentConfirm.confidence || 0) * 100).toFixed(0)}%</Text>
                </Space>
                {intentConfirm.reason && <Text style={{ fontSize: 13 }}>{intentConfirm.reason}</Text>}
                <Text type="secondary" style={{ fontSize: 12 }}>"{intentConfirm.content.slice(0, 60)}{intentConfirm.content.length > 60 ? '...' : ''}"</Text>
              </Space>
            </Card>
            {intentConfirm.histImages.length > 0 && (
              <>
                <Text style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>
                  选择参考图片（可多选，{intentConfirm.action === 'edit' ? '不选则使用最新一张' : '不选则纯文生图'}）：
                </Text>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, maxHeight: 240, overflow: 'auto' }}>
                  {intentConfirm.histImages.map((img: any) => {
                    const selected = intentConfirm.selectedImageIds.has(img.id)
                    return (
                      <div key={img.id} onClick={() => {
                        setIntentConfirm((prev) => {
                          if (!prev) return prev
                          const next = new Set(prev.selectedImageIds)
                          if (next.has(img.id)) next.delete(img.id); else next.add(img.id)
                          return { ...prev, selectedImageIds: next }
                        })
                      }} style={{
                        cursor: 'pointer', borderRadius: 6, overflow: 'hidden',
                        border: selected ? '2px solid #1677ff' : '2px solid #f0f0f0'
                      }}>
                        <img src={img.imageUrl || `data:image/png;base64,${img.imageBase64}`} alt=""
                          style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }} />
                        {selected && <div style={{ position: 'absolute', top: 2, right: 2, background: '#1677ff', color: '#fff', borderRadius: 4, padding: '0 4px', fontSize: 10 }}><CheckOutlined /></div>}
                        <div style={{ padding: '2px 4px', background: '#fafafa' }}>
                          <Text ellipsis style={{ fontSize: 10 }}>{img.content || '图片'}</Text>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </Layout>
  )
}
