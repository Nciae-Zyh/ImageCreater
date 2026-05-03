import { useState } from 'react'
import { Image, Spin, Button, Space, message } from 'antd'
import { DownloadOutlined, ExpandOutlined } from '@ant-design/icons'

interface ImagePreviewProps {
  url?: string
  base64?: string
}

export default function ImagePreview({ url, base64 }: ImagePreviewProps) {
  const [loading, setLoading] = useState(true)
  const [previewVisible, setPreviewVisible] = useState(false)

  const src = url || (base64 ? `data:image/png;base64,${base64}` : '')

  const handleDownload = async () => {
    if (!src) return
    try {
      const response = await fetch(src)
      const blob = await response.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `image-${Date.now()}.png`
      link.click()
      URL.revokeObjectURL(link.href)
      message.success('图片已保存')
    } catch {
      message.error('保存失败')
    }
  }

  if (!src) return null

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f5f5f5',
            borderRadius: 8
          }}
        >
          <Spin />
        </div>
      )}
      <Image
        src={src}
        width={300}
        style={{
          borderRadius: 8,
          display: loading ? 'none' : 'block'
        }}
        onLoad={() => setLoading(false)}
        onError={() => setLoading(false)}
        preview={{
          visible: previewVisible,
          onVisibleChange: setPreviewVisible
        }}
      />
      {!loading && (
        <Space
          style={{
            position: 'absolute',
            top: 8,
            right: 8
          }}
        >
          <Button
            type="primary"
            size="small"
            icon={<ExpandOutlined />}
            onClick={() => setPreviewVisible(true)}
          />
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleDownload}
          />
        </Space>
      )}
    </div>
  )
}
