import { Layout, Button, List, Typography, Popconfirm, Space, Tooltip, Spin } from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  MessageOutlined,
  SettingOutlined,
  LoadingOutlined
} from '@ant-design/icons'
import { useConversationStore } from '../../../stores/conversationStore'

const { Sider } = Layout
const { Text } = Typography

interface SidebarProps {
  onNewChat: () => void
  onOpenSettings: () => void
  streamingByConversation?: Record<string, boolean>
}

export default function Sidebar({ onNewChat, onOpenSettings, streamingByConversation }: SidebarProps) {
  const {
    conversations,
    activeConversationId,
    switchConversation,
    deleteConversation
  } = useConversationStore()

  return (
    <Sider
      width={260}
      style={{
        background: '#fff',
        borderRight: '1px solid #f0f0f0',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid #f0f0f0'
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            block
            onClick={onNewChat}
          >
            新对话
          </Button>
          <Button
            type="text"
            icon={<SettingOutlined />}
            block
            onClick={onOpenSettings}
          >
            API 设置
          </Button>
        </Space>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <List
          dataSource={conversations}
          renderItem={(item) => {
            const isActive = item.id === activeConversationId
            const isItemStreaming = !!streamingByConversation?.[item.id]
            const msgCount = item.messageCount ?? item.messages.length
            return (
              <List.Item
                style={{
                  padding: '12px 16px',
                  cursor: 'pointer',
                  background: isActive ? '#e6f4ff' : 'transparent',
                  borderLeft: isActive ? '3px solid #1677ff' : '3px solid transparent'
                }}
                onClick={() => switchConversation(item.id)}
                actions={[
                  <Popconfirm
                    key="delete"
                    title="确定删除这个对话吗？"
                    onConfirm={(e) => {
                      e?.stopPropagation()
                      deleteConversation(item.id)
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Tooltip title="删除">
                      <DeleteOutlined
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: '#999' }}
                      />
                    </Tooltip>
                  </Popconfirm>
                ]}
              >
                <List.Item.Meta
                  avatar={
                    isItemStreaming
                      ? <LoadingOutlined style={{ color: '#1677ff', fontSize: 16 }} spin />
                      : <MessageOutlined style={{ color: '#1677ff' }} />
                  }
                  title={
                    <Text
                      ellipsis
                      style={{
                        fontSize: 13,
                        color: isActive ? '#1677ff' : undefined
                      }}
                    >
                      {item.title}
                    </Text>
                  }
                  description={
                    <Space size={6} align="center">
                      <Text
                        type={isItemStreaming ? undefined : 'secondary'}
                        style={{ fontSize: 11, color: isItemStreaming ? '#1677ff' : undefined }}
                      >
                        {isItemStreaming ? '生成中...' : `${msgCount} 条消息`}
                      </Text>
                      {isItemStreaming && <Spin size="small" />}
                    </Space>
                  }
                />
              </List.Item>
            )
          }}
        />
      </div>
    </Sider>
  )
}
