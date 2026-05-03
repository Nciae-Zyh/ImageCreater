import { useState } from 'react'
import { Modal, Typography, Space, Button, Empty, message as antMessage } from 'antd'
import { CheckOutlined, PictureOutlined } from '@ant-design/icons'
import type { MessageImage } from '@shared/types'

const { Text } = Typography

interface HistoricalImage {
  id: string
  content: string
  imageBase64?: string
  imageUrl?: string
  timestamp: number
}

interface ImageSelectModalProps {
  open: boolean
  images: HistoricalImage[]
  onConfirm: (selectedImages: MessageImage[]) => void
  onCancel: () => void
}

export default function ImageSelectModal({ open, images, onConfirm, onCancel }: ImageSelectModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleConfirm = () => {
    if (selectedIds.size === 0) {
      antMessage.warning('请至少选择一张图片')
      return
    }
    const selected: MessageImage[] = images
      .filter((img) => selectedIds.has(img.id))
      .map((img) => ({
        type: 'image' as const,
        mimeType: 'image/png',
        data: img.imageBase64 || '',
        url: img.imageUrl
      }))
    onConfirm(selected)
    setSelectedIds(new Set())
  }

  const handleCancel = () => {
    setSelectedIds(new Set())
    onCancel()
  }

  return (
    <Modal
      title={
        <Space>
          <PictureOutlined />
          选择参考图片
        </Space>
      }
      open={open}
      onOk={handleConfirm}
      onCancel={handleCancel}
      okText={`使用选中的 ${selectedIds.size} 张图片`}
      cancelText="取消"
      width={640}
      destroyOnClose
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        检测到对话中有历史图片，选择要作为参考的图片（可多选）
      </Text>

      {images.length === 0 ? (
        <Empty description="暂无历史图片" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, maxHeight: 400, overflow: 'auto' }}>
          {images.map((img) => {
            const selected = selectedIds.has(img.id)
            return (
              <div
                key={img.id}
                onClick={() => toggleSelect(img.id)}
                style={{
                  position: 'relative',
                  cursor: 'pointer',
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: selected ? '2px solid #1677ff' : '2px solid #f0f0f0',
                  transition: 'border-color 0.2s'
                }}
              >
                <img
                  src={img.imageUrl || `data:image/png;base64,${img.imageBase64}`}
                  alt={img.content}
                  style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
                />
                {selected && (
                  <div style={{
                    position: 'absolute', top: 0, right: 0,
                    background: '#1677ff', color: '#fff',
                    padding: '2px 6px', borderBottomLeftRadius: 8,
                    fontSize: 12
                  }}>
                    <CheckOutlined />
                  </div>
                )}
                <div style={{ padding: '4px 8px', background: '#fafafa' }}>
                  <Text ellipsis style={{ fontSize: 11 }}>
                    {img.content || '图片'}
                  </Text>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
