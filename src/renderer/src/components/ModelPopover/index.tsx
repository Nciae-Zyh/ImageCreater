import { useState } from 'react'
import { Popover, Button, Space, Typography, Select, Divider, Switch, Tag } from 'antd'
import {
  SettingOutlined, RobotOutlined, EyeOutlined, PictureOutlined, ThunderboltOutlined
} from '@ant-design/icons'
import { useProviderStore } from '../../stores/providerStore'

const { Text } = Typography

interface ModelPopoverProps {
  autoMode: boolean
  onAutoModeChange: (v: boolean) => void
}

export default function ModelPopover({ autoMode, onAutoModeChange }: ModelPopoverProps) {
  const [open, setOpen] = useState(false)
  const {
    providers, activeProviderId, imageProviderId,
    selectedChatModel, selectedImageModel,
    setActiveProvider, setImageProvider,
    setSelectedChatModel, setSelectedImageModel
  } = useProviderStore()

  const chatProvider = providers.find((p) => p.id === activeProviderId)
  const imgProvider = providers.find((p) => p.id === (imageProviderId || activeProviderId))

  const content = (
    <div style={{ width: 320 }} onClick={(e) => e.stopPropagation()}>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Text strong>模型配置</Text>
        <Space size={4}>
          <ThunderboltOutlined style={{ fontSize: 11, color: autoMode ? '#1677ff' : '#999' }} />
          <Text style={{ fontSize: 12 }}>自动</Text>
          <Switch size="small" checked={autoMode} onChange={onAutoModeChange} />
        </Space>
      </Space>

      {/* 文本 Provider */}
      <div style={{ marginBottom: 8 }}>
        <Space size={4} style={{ marginBottom: 4 }}>
          <RobotOutlined style={{ fontSize: 11, color: '#1677ff' }} />
          <Text style={{ fontSize: 12 }}>文本 / 对话</Text>
        </Space>
        <Space style={{ width: '100%' }}>
          <Select
            value={activeProviderId || undefined}
            onChange={setActiveProvider}
            style={{ width: 140 }}
            size="small"
            placeholder="Provider"
            options={providers.map((p) => ({ label: p.name, value: p.id }))}
          />
          <Select
            value={selectedChatModel}
            onChange={setSelectedChatModel}
            style={{ flex: 1 }}
            size="small"
            placeholder="模型"
            options={(chatProvider?.models || []).map((m) => ({ label: m, value: m }))}
          />
        </Space>
      </div>

      {/* 视觉模型 */}
      <div style={{ marginBottom: 8 }}>
        <Space size={4} style={{ marginBottom: 4 }}>
          <EyeOutlined style={{ fontSize: 11, color: '#722ed1' }} />
          <Text style={{ fontSize: 12 }}>视觉分析</Text>
          <Tag style={{ fontSize: 10 }}>可选</Tag>
        </Space>
        <Select
          value={chatProvider?.visionModel || undefined}
          onChange={(v) => {
            // 更新当前 provider 的 visionModel
            if (chatProvider) {
              chatProvider.visionModel = v || ''
            }
          }}
          style={{ width: '100%' }}
          size="small"
          placeholder="选择视觉模型（可选）"
          allowClear
          options={(chatProvider?.models || []).map((m) => ({ label: m, value: m }))}
        />
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {/* 图片 Provider */}
      <div style={{ marginBottom: 8 }}>
        <Space size={4} style={{ marginBottom: 4 }}>
          <PictureOutlined style={{ fontSize: 11, color: '#52c41a' }} />
          <Text style={{ fontSize: 12 }}>图片生成</Text>
        </Space>
        <Space style={{ width: '100%' }}>
          <Select
            value={imageProviderId || activeProviderId || undefined}
            onChange={(id) => {
              setImageProvider(id)
              const p = providers.find((pp) => pp.id === id)
              if (p?.imageModel) setSelectedImageModel(p.imageModel)
            }}
            style={{ width: 140 }}
            size="small"
            placeholder="Provider"
            options={providers.map((p) => ({ label: p.name, value: p.id }))}
          />
          <Select
            value={selectedImageModel || undefined}
            onChange={setSelectedImageModel}
            style={{ flex: 1 }}
            size="small"
            placeholder="模型"
            allowClear
            options={(imgProvider?.models || []).map((m) => ({ label: m, value: m }))}
          />
        </Space>
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {/* 当前配置摘要 */}
      <div style={{ background: '#f5f5f5', borderRadius: 6, padding: '8px 12px' }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          当前: <Tag color="blue" style={{ fontSize: 10 }}>{chatProvider?.name || '未选择'}</Tag>
          <Tag style={{ fontSize: 10 }}>{selectedChatModel}</Tag>
          {selectedImageModel && (
            <>
              {' + '}
              <Tag color="green" style={{ fontSize: 10 }}>{imgProvider?.name || chatProvider?.name}</Tag>
              <Tag style={{ fontSize: 10 }}>{selectedImageModel}</Tag>
            </>
          )}
        </Text>
      </div>
    </div>
  )

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="topLeft"
      overlayStyle={{ paddingTop: 8 }}
    >
      <Button
        type="text"
        icon={<SettingOutlined />}
        size="small"
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      />
    </Popover>
  )
}
