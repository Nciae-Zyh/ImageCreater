import { Select, Typography, Space, Tooltip } from 'antd'
import { PictureOutlined, MessageOutlined } from '@ant-design/icons'
import { useProviderStore } from '../../stores/providerStore'

const { Text } = Typography

export default function ModelSelector() {
  const {
    providers,
    activeProviderId,
    selectedChatModel,
    selectedImageModel,
    setSelectedChatModel,
    setSelectedImageModel
  } = useProviderStore()

  const activeProvider = providers.find((p) => p.id === activeProviderId)
  const allModels = activeProvider?.models || []
  const chatModels = activeProvider
    ? allModels.filter(
        (m) => !activeProvider.imageModel || m !== activeProvider.imageModel
      )
    : allModels
  const imageModels = activeProvider
    ? allModels.filter(
        (m) =>
          activeProvider.imageModel === m ||
          m.includes('dall') ||
          m.includes('cogview') ||
          m.includes('wanx') ||
          m.includes('image') ||
          m.includes('sd') ||
          m.includes('stable')
      )
    : []

  if (providers.length === 0) {
    return <Text type="secondary" style={{ fontSize: 12 }}>未配置 API</Text>
  }

  return (
    <Space size={8}>
      <Tooltip title="对话/分析模型">
        <Space size={4}>
          <MessageOutlined style={{ color: '#1677ff', fontSize: 12 }} />
          <Select
            value={selectedChatModel}
            onChange={setSelectedChatModel}
            style={{ width: 160 }}
            size="small"
            placeholder="对话模型"
            options={chatModels.map((m) => ({ label: m, value: m }))}
          />
        </Space>
      </Tooltip>
      {imageModels.length > 0 && (
        <Tooltip title="图片生成模型">
          <Space size={4}>
            <PictureOutlined style={{ color: '#52c41a', fontSize: 12 }} />
            <Select
              value={selectedImageModel}
              onChange={setSelectedImageModel}
              style={{ width: 160 }}
              size="small"
              placeholder="图片模型"
              options={imageModels.map((m) => ({ label: m, value: m }))}
            />
          </Space>
        </Tooltip>
      )}
    </Space>
  )
}
