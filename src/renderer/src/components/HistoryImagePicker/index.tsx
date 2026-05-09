import { useState, useEffect } from 'react'
import { Popover, Button, Space, Typography, Empty, Spin, Tooltip } from 'antd'
import { HistoryOutlined } from '@ant-design/icons'
import type { MessageImage } from '@shared/types'

const { Text } = Typography

interface HistoryImage {
  id: string
  content: string
  imageBase64?: string
  imageUrl?: string
  timestamp: number
}

interface HistoryImagePickerProps {
  conversationId: string | null
  onSelect: (images: MessageImage[]) => void
}

export default function HistoryImagePicker({ conversationId, onSelect }: HistoryImagePickerProps) {
  const [open, setOpen] = useState(false)
  const [images, setImages] = useState<HistoryImage[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open && conversationId) {
      setLoading(true)
      window.electronAPI.conversations.getImages(conversationId)
        .then((res) => { if (res.success) setImages(res.data || []) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
  }, [open, conversationId])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleConfirm = () => {
    const selected: MessageImage[] = images
      .filter((img) => selectedIds.has(img.id))
      .map((img) => ({ type: 'image', mimeType: 'image/png', data: img.imageBase64 || '', url: img.imageUrl }))
    if (selected.length > 0) { onSelect(selected); setOpen(false); setSelectedIds(new Set()) }
  }

  const content = (
    <div style={{ width: 360 }} onClick={(e) => e.stopPropagation()}>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>
      ) : images.length === 0 ? (
        <Empty description="暂无历史图片" />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, maxHeight: 300, overflow: 'auto' }}>
            {images.map((img) => (
              <div key={img.id} onClick={() => toggleSelect(img.id)}
                style={{ cursor: 'pointer', borderRadius: 6, overflow: 'hidden', border: selectedIds.has(img.id) ? '2px solid #1677ff' : '2px solid #f0f0f0' }}>
                <img src={img.imageUrl || `data:image/png;base64,${img.imageBase64}`} alt="" style={{ width: '100%', height: 80, objectFit: 'cover' }} />
                <div style={{ padding: '2px 4px', background: '#fafafa' }}>
                  <Text ellipsis style={{ fontSize: 10 }}>{img.content || '图片'}</Text>
                </div>
              </div>
            ))}
          </div>
          <Button type="primary" block style={{ marginTop: 8 }} disabled={selectedIds.size === 0} onClick={handleConfirm}>
            使用选中的 {selectedIds.size} 张图片作为参考
          </Button>
        </>
      )}
    </div>
  )

  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement="topLeft">
      <Tooltip title="从历史记录选择图片">
        <Button type="text" icon={<HistoryOutlined />} className="history-image-picker-trigger" />
      </Tooltip>
    </Popover>
  )
}
