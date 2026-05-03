import { useState, useEffect, useCallback, useRef } from 'react'
import { Layout, Button, Space, Typography, Tag, Dropdown, Modal } from 'antd'
import type { MenuProps } from 'antd'
import { SettingOutlined, RobotOutlined, PictureOutlined, CheckOutlined } from '@ant-design/icons'
import Sidebar from './components/Sidebar'
import ChatMessage from '../../components/ChatMessage'
import ChatInput from '../../components/ChatInput'
import ImageSelectModal from '../../components/ImageSelectModal'
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
  const [imgSelectOpen, setImgSelectOpen] = useState(false)
  const [histImages, setHistImages] = useState<any[]>([])
  const [pendingSend, setPendingSend] = useState<{ content: string; imageData?: MessageImage[] } | null>(null)
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

  const checkReferenceNeed = useCallback(async (content: string, imageData?: MessageImage[]): Promise<boolean> => {
    if (imageData && imageData.length > 0) return false
    if (!activeProviderId || !activeConversationId) return false
    try {
      // 用 AI 分析意图
      const intentResult = await window.electronAPI.chat.analyzeIntent({
        message: content, providerId: activeProviderId, hasImage: false
      })
      if (!intentResult.success) return false
      const action = intentResult.data?.action
      if (action !== 'edit' && action !== 'generate') return false
      // 检查历史图片
      const result = await window.electronAPI.conversations.getImages(activeConversationId)
      if (!result.success || !result.data?.length) return false
      const histImgs = result.data as any[]

      if (action === 'edit' && (intentResult.data?.confidence || 0) >= 0.8) {
        // 高置信度编辑：自动使用最近一张图片
        const latest = histImgs[histImgs.length - 1]
        if (latest.imageUrl) {
          // 远程图片：传 URL，后端会下载
          const msgImg: MessageImage = { type: 'image', mimeType: 'image/png', data: '', url: latest.imageUrl }
          await doSend(content, [msgImg])
        } else if (latest.imageBase64) {
          const msgImg: MessageImage = { type: 'image', mimeType: 'image/png', data: latest.imageBase64 }
          await doSend(content, [msgImg])
        }
        return true
      }

      // generate 意图：弹出选择器让用户选参考图
      setHistImages(histImgs)
      setPendingSend({ content, imageData })
      setImgSelectOpen(true)
      return true
    } catch {}
    return false
  }, [activeProviderId, activeConversationId])

  const handleSend = async (content: string, imageData?: MessageImage[]) => {
    const blocked = await checkReferenceNeed(content, imageData)
    if (!blocked) await doSend(content, imageData)
  }

  const handleImageSelected = async (selected: MessageImage[]) => {
    setImgSelectOpen(false)
    if (pendingSend) {
      await doSend(pendingSend.content, [...(pendingSend.imageData || []), ...selected])
      setPendingSend(null)
    }
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
          <Space>
            <RobotOutlined style={{ fontSize: 18, color: '#1677ff' }} />
            <Text strong style={{ fontSize: 13 }} ellipsis={{ tooltip: activeConversation?.title }}>
              {activeConversation?.title || '新对话'}
            </Text>
          </Space>
          <Space>
            {/* 当前配置摘要 */}
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

      <ImageSelectModal open={imgSelectOpen} images={histImages} onConfirm={handleImageSelected} onCancel={() => { setImgSelectOpen(false); setPendingSend(null) }} />
    </Layout>
  )
}
