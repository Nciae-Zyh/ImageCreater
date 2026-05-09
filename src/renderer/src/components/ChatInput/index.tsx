import { useState, useRef, useEffect, useCallback } from 'react'
import { Input, Button, Upload, message as antMessage, Tooltip } from 'antd'
import { SendOutlined, StopOutlined, PictureOutlined, CloseCircleOutlined } from '@ant-design/icons'
import ModelPopover from '../ModelPopover'
import HistoryImagePicker from '../HistoryImagePicker'
import type { MessageImage } from '@shared/types'

const { TextArea } = Input

interface ChatInputProps {
  onSend: (content: string, imageData?: MessageImage[]) => void
  onCancel: () => void
  loading?: boolean
  disabled?: boolean
  autoMode: boolean
  onAutoModeChange: (v: boolean) => void
  conversationId?: string | null
}

function fileToMessageImage(file: File): Promise<MessageImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]
      resolve({ type: 'image', mimeType: file.type || 'image/png', data: base64 })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToMessageImage(blob: Blob): Promise<MessageImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]
      resolve({ type: 'image', mimeType: blob.type || 'image/png', data: base64 })
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export default function ChatInput({ onSend, onCancel, loading = false, disabled = false, autoMode, onAutoModeChange, conversationId }: ChatInputProps) {
  const [value, setValue] = useState('')
  const [pendingImages, setPendingImages] = useState<MessageImage[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const textAreaRef = useRef<any>(null)
  const dragCountRef = useRef(0)

  useEffect(() => { textAreaRef.current?.focus() }, [])

  const addImages = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    const images: MessageImage[] = []
    for (const file of imageFiles) {
      if (file.size > 20 * 1024 * 1024) { antMessage.error(`${file.name} 超过 20MB`); continue }
      try { images.push(await fileToMessageImage(file)) } catch { antMessage.error(`${file.name} 处理失败`) }
    }
    if (images.length > 0) setPendingImages((prev) => [...prev, ...images])
  }, [])

  const handleSend = () => {
    const trimmed = value.trim()
    if ((!trimmed && pendingImages.length === 0) || loading || disabled) return
    onSend(trimmed || (pendingImages.length > 0 ? '请分析这张图片' : ''), pendingImages.length > 0 ? pendingImages : undefined)
    setValue('')
    setPendingImages([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME 输入法组合中不触发发送
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const images: MessageImage[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault()
        const blob = items[i].getAsFile()
        if (blob) try { images.push(await blobToMessageImage(blob)) } catch {}
      }
    }
    if (images.length > 0) { setPendingImages((prev) => [...prev, ...images]); antMessage.success(`已粘贴 ${images.length} 张图片`) }
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dragCountRef.current++; if (e.dataTransfer.types.includes('Files')) setIsDragging(true) }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dragCountRef.current--; if (dragCountRef.current === 0) setIsDragging(false) }, [])
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation() }, [])
  const handleDrop = useCallback(async (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dragCountRef.current = 0; setIsDragging(false); if (e.dataTransfer.files.length > 0) await addImages(e.dataTransfer.files) }, [addImages])

  const removeImage = (index: number) => setPendingImages((prev) => prev.filter((_, i) => i !== index))

  return (
    <div
      className="composer-shell"
      onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
    >
      {isDragging && (
        <div className="composer-drop-overlay">
          <span>把图片放到这里，我会一起读图</span>
        </div>
      )}

      <div className="composer-inner">
        {pendingImages.length > 0 && (
          <div className="composer-attachments">
            {pendingImages.map((img, index) => (
              <div key={index} className="composer-thumb">
                <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                <CloseCircleOutlined onClick={() => removeImage(index)} className="composer-remove" />
              </div>
            ))}
          </div>
        )}

        <div className="composer-box">
          <div className="composer-tools">
            <ModelPopover autoMode={autoMode} onAutoModeChange={onAutoModeChange} />
            <HistoryImagePicker conversationId={conversationId} onSelect={(imgs) => setPendingImages((prev) => [...prev, ...imgs])} />
            <Upload beforeUpload={(file) => { addImages([file]); return false }} showUploadList={false} accept="image/*" disabled={disabled || loading}>
              <Tooltip title="上传图片">
                <Button type="text" icon={<PictureOutlined />} disabled={disabled || loading} className="composer-tool-button" />
              </Tooltip>
            </Upload>
          </div>
          <TextArea
            ref={textAreaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={disabled ? '请先配置 API Key' : '告诉 agent 你想生成、编辑或分析什么...'}
            autoSize={{ minRows: 1, maxRows: 6 }}
            disabled={disabled || loading}
            className="composer-input"
          />
          {loading ? (
            <Button type="primary" danger icon={<StopOutlined />} onClick={onCancel} className="composer-send-button">停止</Button>
          ) : (
            <Button type="primary" icon={<SendOutlined />} onClick={handleSend} disabled={(!value.trim() && pendingImages.length === 0) || disabled} className="composer-send-button" />
          )}
        </div>
        <div className="composer-hint">
          <span>Enter 发送，Shift + Enter 换行</span>
          <span>支持粘贴、拖拽图片</span>
        </div>
      </div>
    </div>
  )
}
