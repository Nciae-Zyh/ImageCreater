import { useState, useEffect } from 'react'
import { Typography, Space, Tag, Spin, Image, Button, Alert, message as antMessage } from 'antd'
import {
  UserOutlined, RobotOutlined, ClockCircleOutlined, DownloadOutlined, ExpandOutlined,
  CheckCircleOutlined, LoadingOutlined, CloseCircleOutlined, DeleteOutlined, CheckOutlined,
  BulbOutlined, ExperimentOutlined
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const { Paragraph, Text } = Typography

interface MessageImage { type: 'image'; mimeType: string; data: string }

interface ChatMessageProps {
  message: {
    id: string
    role: 'user' | 'assistant'
    content: string
    type: string
    image_url?: string
    image_data?: string
    image_base64?: string
    imageData?: MessageImage[]
    steps?: string[]
    imageUrl?: string
    partialImage?: string
    metadata?: string | any
    needUserSelect?: boolean
    timestamp: number
  }
  streaming?: boolean
  error?: { message: string; type: string; code?: string } | null
  conversationId?: string
  onDelete?: (messageId: string) => void
  needUserSelect?: boolean
  histImages?: any[]
  selectedImageIds?: Set<string>
  isLatest?: boolean
  onToggleImage?: (id: string) => void
  onConfirmImages?: () => void
  onCancelSelect?: () => void
  promptChoice?: {
    originalPrompt: string
    optimizedPrompt: string
    candidates?: Array<{ prompt: string; why: string }>
    recommendedIndex?: number
  } | null
  onChooseOptimizedPrompt?: (candidateIndex?: number) => void
  onChooseOriginalPrompt?: () => void
  onCancelPromptChoice?: () => void
  promptOptimizing?: boolean
}

function getImageSrc(msg: any): string | null {
  if (msg.imageUrl) return msg.imageUrl
  if (msg.image_url) return msg.image_url
  if (msg.image_base64) return `data:image/png;base64,${msg.image_base64}`
  if (msg.image_data) {
    try {
      const parsed = JSON.parse(msg.image_data)
      if (parsed[0]?.data) return `data:${parsed[0].mimeType};base64,${parsed[0].data}`
    } catch {}
  }
  return null
}

function parseMeta(m?: string | any) {
  if (!m) return {}
  if (typeof m === 'string') {
    try { return JSON.parse(m) } catch { return {} }
  }
  return m
}

function getErrorTitle(type: string) {
  if (type === 'moderation_blocked') return '内容安全拦截'
  if (type === 'api_error') return 'API 错误'
  if (type === 'network_error') return '网络错误'
  return '错误'
}

export default function ChatMessage({
  message, streaming = false, error, onDelete,
  needUserSelect, histImages, selectedImageIds, isLatest,
  onToggleImage, onConfirmImages, onCancelSelect,
  promptChoice, onChooseOptimizedPrompt, onChooseOriginalPrompt, onCancelPromptChoice,
  promptOptimizing
}: ChatMessageProps) {
  const [imgLoading, setImgLoading] = useState(true)
  const isUser = message.role === 'user'
  const meta = parseMeta(message.metadata)
  const imageSrc = getImageSrc(message)
  const displayContent = needUserSelect
    ? (message.content || meta.originalPrompt || meta.prompt || meta.optimizedPrompt || meta.displayContent || '')
    : message.content
  const steps = message.steps || []
  const hasContent = !!message.content
  const hasImage = !!imageSrc
  const hasPartial = streaming && !!message.partialImage && !hasImage
  const showInlinePicker = needUserSelect && isLatest && histImages && histImages.length > 0
  const showAgentHeader = !isUser && (streaming || steps.length > 0 || promptOptimizing || promptChoice || showInlinePicker)

  useEffect(() => {
    if (imageSrc) setImgLoading(true)
  }, [imageSrc])

  const handleDownload = async () => {
    if (!imageSrc) return
    try {
      const result = await window.electronAPI.image.saveAs(imageSrc)
      if (result.success) {
        antMessage.success('图片已保存')
      } else {
        antMessage.error(result.error || '保存失败')
      }
    } catch {
      antMessage.error('保存失败')
    }
  }

  if (isUser) {
    return (
      <div className="chat-message chat-message-user message-enter">
        <div className="message-avatar message-avatar-user">
          <UserOutlined />
        </div>
        <div className="message-stack message-stack-user">
          <div className="message-bubble user-bubble">
            {message.imageData?.map((img, i) => (
              <img
                key={i}
                src={`data:${img.mimeType};base64,${img.data}`}
                alt=""
                className="message-attachment-thumb"
              />
            ))}
            {message.content && (
              <Paragraph className="user-message-text">{message.content}</Paragraph>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-message chat-message-agent message-enter">
      <div className="message-avatar message-avatar-agent">
        <RobotOutlined />
      </div>
      <div className="message-stack">
        {showAgentHeader && (
          <div className="agent-status-strip">
            <span className={streaming || promptOptimizing ? 'agent-pulse-dot active' : 'agent-pulse-dot'} />
            <Text className="agent-status-title">
              {streaming || promptOptimizing ? 'Agent 正在处理' : 'Agent 已准备好下一步'}
            </Text>
          </div>
        )}

        {steps.length > 0 && (
          <div className="agent-panel agent-steps-panel">
            <div className="agent-panel-header">
              {streaming ? <LoadingOutlined /> : <CheckCircleOutlined />}
              <Text strong>{streaming ? `执行中 · ${steps.length} 步` : `执行完成 · ${steps.length} 步`}</Text>
            </div>
            <div className="agent-step-list">
              {steps.map((step, i) => {
                const isLast = i === steps.length - 1
                const isDone = !streaming || !isLast
                return (
                  <div key={i} className={isDone ? 'agent-step done' : 'agent-step active'}>
                    {isDone ? <CheckCircleOutlined /> : <Spin size="small" />}
                    <Text>{step}</Text>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {isLatest && promptOptimizing && !promptChoice && (
          <div className="agent-panel agent-thinking-panel">
            <Spin size="small" />
            <div>
              <Text strong>正在拆解你的意图</Text>
              <Text type="secondary">优化 prompt、选择合适的图像流程。</Text>
            </div>
          </div>
        )}

        {isLatest && promptChoice && (
          <div className="agent-panel prompt-choice-panel">
            <div className="agent-panel-header">
              <BulbOutlined />
              <div>
                <Text strong>我整理了几个可执行 prompt</Text>
                <Text type="secondary">选择一个后我会继续生成或编辑图片。</Text>
              </div>
            </div>

            <div className="prompt-original-card">
              <Text type="secondary">你的原始输入</Text>
              <Text>{promptChoice.originalPrompt}</Text>
            </div>

            {(promptChoice.candidates && promptChoice.candidates.length > 0) ? (
              <div className="prompt-candidate-list">
                {promptChoice.candidates.map((candidate, idx) => {
                  const isRecommended = idx === (promptChoice.recommendedIndex ?? 0)
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={isRecommended ? 'prompt-candidate recommended' : 'prompt-candidate'}
                      onClick={() => onChooseOptimizedPrompt?.(idx)}
                    >
                      <span className="prompt-candidate-topline">
                        <span>
                          <ExperimentOutlined />
                          {`方案 ${idx + 1}`}
                        </span>
                        {isRecommended && <Tag color="blue">推荐</Tag>}
                      </span>
                      <span className="prompt-candidate-text">{candidate.prompt}</span>
                      {candidate.why && <span className="prompt-candidate-reason">{candidate.why}</span>}
                    </button>
                  )
                })}
              </div>
            ) : (
              <button
                type="button"
                className="prompt-candidate recommended"
                onClick={() => onChooseOptimizedPrompt?.()}
              >
                <span className="prompt-candidate-topline">
                  <span><ExperimentOutlined />优化 Prompt</span>
                  <Tag color="blue">推荐</Tag>
                </span>
                <span className="prompt-candidate-text">{promptChoice.optimizedPrompt}</span>
              </button>
            )}

            <Space>
              <Button size="small" onClick={onChooseOriginalPrompt}>用原始输入继续</Button>
              <Button size="small" type="text" onClick={onCancelPromptChoice}>取消</Button>
            </Space>
          </div>
        )}

        {hasContent && (
          <div className="message-bubble agent-bubble">
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
              {streaming && <span className="streaming-cursor" />}
            </div>
          </div>
        )}

        {hasImage && (
          <div className="agent-image-wrap">
            {imgLoading && <div className="image-loading-placeholder"><Spin /></div>}
            <Image
              src={imageSrc!}
              width={360}
              style={{ borderRadius: 12, display: imgLoading ? 'none' : 'block' }}
              onLoad={() => setImgLoading(false)}
              onError={() => setImgLoading(false)}
              preview={{ mask: <ExpandOutlined /> }}
            />
            {!imgLoading && (
              <Space className="image-action-bar">
                <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={handleDownload} />
              </Space>
            )}
          </div>
        )}

        {hasPartial && (
          <div className="agent-image-wrap partial-image-wrap">
            <img
              src={`data:image/png;base64,${message.partialImage}`}
              alt="生成中..."
              className="partial-image"
            />
            <div className="partial-image-label">生成中...</div>
          </div>
        )}

        {showInlinePicker && (
          <div className="agent-panel image-picker-panel">
            <div className="agent-panel-header">
              <BulbOutlined />
              <div>
                <Text strong>{`我找到了 ${histImages.length} 张历史图片`}</Text>
                <Text type="secondary">选中要编辑或参考的图片，我会带着它继续优化。</Text>
              </div>
            </div>
            <div className="inline-image-grid">
              {histImages.map((img: any) => {
                const selected = selectedImageIds?.has(img.id) || false
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => onToggleImage?.(img.id)}
                    className={selected ? 'inline-image-card selected' : 'inline-image-card'}
                  >
                    <img src={img.imageUrl || `data:image/png;base64,${img.imageBase64}`} alt="" />
                    {selected && (
                      <span className="inline-image-check">
                        <CheckOutlined />
                      </span>
                    )}
                    <span>{img.content || '图片'}</span>
                  </button>
                )
              })}
            </div>
            <Space>
              <Button
                type="primary"
                size="small"
                icon={<CheckOutlined />}
                onClick={onConfirmImages}
                disabled={!selectedImageIds || selectedImageIds.size === 0}
              >
                确认选择 ({selectedImageIds?.size || 0})
              </Button>
              <Button size="small" type="text" onClick={onCancelSelect}>取消</Button>
            </Space>
          </div>
        )}

        {error && (
          <Alert
            message={
              <Space direction="vertical" size={2}>
                <Space>
                  <CloseCircleOutlined className="message-error-icon" />
                  <Text strong className="message-error-title">{getErrorTitle(error.type)}</Text>
                </Space>
                <Text className="message-error-detail">{error.message}</Text>
                {error.code && <Text type="secondary" className="message-error-code">错误码: {error.code}</Text>}
              </Space>
            }
            type="error"
            showIcon={false}
            className="message-error-alert"
          />
        )}

        {!hasContent && !hasImage && steps.length === 0 && streaming && !error && (
          <div className="agent-panel agent-thinking-panel">
            <Spin size="small" />
            <Text type="secondary">处理中...</Text>
          </div>
        )}

        <div className="message-meta-row">
          {(meta.model || meta.duration) && (
            <>
              {meta.model && <Tag className="message-meta-tag">{meta.model}</Tag>}
              {meta.duration && (
                <Text type="secondary" className="message-duration">
                  <ClockCircleOutlined />{(meta.duration / 1000).toFixed(1)}s
                </Text>
              )}
              {meta.imageModel && meta.imageModel !== meta.model && (
                <Tag color="orange" className="message-meta-tag">{meta.imageModel}</Tag>
              )}
            </>
          )}
          {!streaming && onDelete && (
            <Button
              type="text"
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => onDelete(message.id)}
              className="message-delete-button"
            />
          )}
        </div>
      </div>
    </div>
  )
}
