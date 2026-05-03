import { useState } from 'react'
import { Typography, Space, Tag, Spin, Image, Button, Collapse, Alert, message as antMessage } from 'antd'
import { UserOutlined, RobotOutlined, ClockCircleOutlined, DownloadOutlined, ExpandOutlined, CheckCircleOutlined, LoadingOutlined, CloseCircleOutlined } from '@ant-design/icons'
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
    timestamp: number
  }
  streaming?: boolean
  error?: { message: string; type: string; code?: string } | null
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
  if (typeof m === 'string') { try { return JSON.parse(m) } catch { return {} } }
  return m
}

const markdownStyles: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.7,
  color: '#1a1a1a',
}

export default function ChatMessage({ message, streaming = false, error }: ChatMessageProps) {
  const [imgLoading, setImgLoading] = useState(true)
  const isUser = message.role === 'user'
  const meta = parseMeta(message.metadata)
  const imageSrc = getImageSrc(message)
  const steps = message.steps || []
  const hasContent = !!message.content
  const hasImage = !!imageSrc
  const hasPartial = streaming && !!message.partialImage && !hasImage

  const handleDownload = async () => {
    if (!imageSrc) return
    try {
      const result = await window.electronAPI.image.saveAs(imageSrc)
      if (result.success) {
        antMessage.success('图片已保存')
      } else {
        antMessage.error(result.error || '保存失败')
      }
    } catch { antMessage.error('保存失败') }
  }

  if (isUser) {
    return (
      <div className="message-enter" style={{ display: 'flex', gap: 12, flexDirection: 'row-reverse', alignItems: 'flex-start' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1677ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <UserOutlined style={{ color: '#fff', fontSize: 16 }} />
        </div>
        <div style={{ maxWidth: '70%', background: '#1677ff', color: '#fff', padding: '12px 16px', borderRadius: '12px 12px 4px 12px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', wordBreak: 'break-word' }}>
          {message.imageData?.map((img, i) => (
            <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="" style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8, objectFit: 'cover', display: 'block', marginBottom: 8 }} />
          ))}
          {message.content && <Paragraph style={{ margin: 0, color: 'inherit', whiteSpace: 'pre-wrap' }}>{message.content}</Paragraph>}
        </div>
      </div>
    )
  }

  // 助手消息 - 分段展示
  return (
    <div className="message-enter" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <RobotOutlined style={{ color: '#666', fontSize: 16 }} />
      </div>
      <div style={{ maxWidth: '70%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* 步骤进度区域 */}
        {steps.length > 0 && (
          <div style={{ background: '#f6f8fa', borderRadius: 8, padding: '8px 12px', border: '1px solid #e8e8e8' }}>
            <Collapse
              defaultActiveKey={streaming ? ['steps'] : []}
              ghost
              size="small"
              items={[{
                key: 'steps',
                label: (
                  <Space size={4}>
                    {streaming ? <LoadingOutlined style={{ color: '#1677ff' }} /> : <CheckCircleOutlined style={{ color: '#52c41a' }} />}
                    <Text style={{ fontSize: 12, color: '#666' }}>
                      {streaming ? `处理中... (${steps.length} 步)` : `处理完成 (${steps.length} 步)`}
                    </Text>
                  </Space>
                ),
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {steps.map((step, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Tag color={i === steps.length - 1 && !streaming ? 'green' : 'blue'} style={{ fontSize: 10, margin: 0 }}>
                          {i + 1}
                        </Tag>
                        <Text style={{ fontSize: 12, color: '#555' }}>{step}</Text>
                      </div>
                    ))}
                    {streaming && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Spin size="small" />
                        <Text type="secondary" style={{ fontSize: 12 }}>处理中...</Text>
                      </div>
                    )}
                  </div>
                )
              }]}
            />
          </div>
        )}

        {/* 文本内容 - Markdown 渲染 */}
        {hasContent && (
          <div style={{ background: '#fff', padding: '12px 16px', borderRadius: '12px 12px 12px 4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', wordBreak: 'break-word', overflow: 'hidden' }}>
            <div style={markdownStyles} className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              {streaming && <span className="streaming-cursor" />}
            </div>
          </div>
        )}

        {/* 图片 */}
        {hasImage && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            {imgLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><Spin /></div>}
            <Image
              src={imageSrc!}
              width={320}
              style={{ borderRadius: 8, display: imgLoading ? 'none' : 'block' }}
              onLoad={() => setImgLoading(false)}
              onError={() => setImgLoading(false)}
              preview={{ mask: <ExpandOutlined /> }}
            />
            {!imgLoading && (
              <Space style={{ position: 'absolute', top: 8, right: 8 }}>
                <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={handleDownload} />
              </Space>
            )}
          </div>
        )}

        {/* 流式部分图片 */}
        {hasPartial && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img
              src={`data:image/png;base64,${message.partialImage}`}
              alt="生成中..."
              style={{ width: 320, borderRadius: 8, opacity: 0.85, border: '2px dashed #1677ff' }}
            />
            <div style={{
              position: 'absolute', bottom: 8, left: 8,
              background: 'rgba(22,119,255,0.85)', color: '#fff',
              padding: '2px 8px', borderRadius: 4, fontSize: 11
            }}>
              生成中...
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <Alert
            message={
              <Space direction="vertical" size={2}>
                <Space>
                  <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                  <Text strong style={{ color: '#ff4d4f' }}>
                    {error.type === 'moderation_blocked' ? '内容安全拦截' :
                     error.type === 'api_error' ? 'API 错误' :
                     error.type === 'network_error' ? '网络错误' : '错误'}
                  </Text>
                </Space>
                <Text style={{ fontSize: 13 }}>{error.message}</Text>
                {error.code && <Text type="secondary" style={{ fontSize: 11 }}>错误码: {error.code}</Text>}
              </Space>
            }
            type="error"
            showIcon={false}
            style={{ borderRadius: 8 }}
          />
        )}

        {/* 无内容且无步骤时的加载状态 */}
        {!hasContent && !hasImage && steps.length === 0 && streaming && !error && (
          <div style={{ background: '#fff', padding: '12px 16px', borderRadius: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
            <Space><Spin size="small" /><Text type="secondary">处理中...</Text></Space>
          </div>
        )}

        {/* 元数据 */}
        {(meta.model || meta.duration) && (
          <Space size={4} wrap>
            {meta.model && <Tag style={{ fontSize: 10 }}>{meta.model}</Tag>}
            {meta.duration && <Tag icon={<ClockCircleOutlined />} style={{ fontSize: 10 }}>{(meta.duration / 1000).toFixed(1)}s</Tag>}
            {meta.optimizedPrompt && <Tag color="purple" style={{ fontSize: 10 }}>Prompt 优化</Tag>}
          </Space>
        )}
      </div>
    </div>
  )
}
