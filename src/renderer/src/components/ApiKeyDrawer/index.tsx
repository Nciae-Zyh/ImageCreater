import { useState, useEffect } from 'react'
import {
  Drawer, Form, Input, Button, List, Typography, Space, Popconfirm,
  Tag, message, Divider, Alert, Badge, Card, Collapse
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, CheckCircleOutlined, SettingOutlined,
  LinkOutlined, RightOutlined, DownOutlined, EditOutlined, CloudOutlined
} from '@ant-design/icons'
import { useProviderStore } from '../../stores/providerStore'
import { PROVIDER_PRESETS } from '@shared/providerPresets'
import type { ProviderPreset } from '@shared/types'

const { Title, Text, Paragraph } = Typography

interface ApiKeyDrawerProps {
  open: boolean
  onClose: () => void
}

export default function ApiKeyDrawer({ open, onClose }: ApiKeyDrawerProps) {
  const { providers, addProvider, removeProvider } = useProviderStore()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      form.resetFields()
      setExpandedId(null)
    }
  }, [open, form])

  const handlePresetClick = (preset: ProviderPreset) => {
    if (expandedId === preset.id) {
      setExpandedId(null)
      form.resetFields()
    } else {
      setExpandedId(preset.id)
      form.setFieldsValue({
        name: preset.name,
        baseUrl: preset.baseUrl,
        models: [...preset.chatModels, ...preset.imageModels].join('\n'),
        chatModel: preset.chatModels[0] || '',
        imageModel: preset.imageModels[0] || '',
        visionModel: preset.visionModels[0] || '',
        apiKey: ''
      })
    }
  }

  const handleAdd = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      const models = values.models.split('\n').map((m: string) => m.trim()).filter(Boolean)
      const success = await addProvider({
        name: values.name,
        baseUrl: values.baseUrl.replace(/\/+$/, ''),
        apiKey: values.apiKey,
        models,
        chatModel: values.chatModel || models[0] || '',
        imageModel: values.imageModel || '',
        visionModel: values.visionModel || ''
      })
      if (success) {
        message.success(`${values.name} API Key 已保存`)
        form.resetFields()
        setExpandedId(null)
      } else {
        message.error('保存失败')
      }
    } catch (err) {
      if (err instanceof Error) message.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if ((await removeProvider(id))) message.success('已删除')
  }

  const handleValidate = async (id: string) => {
    try {
      const result = await window.electronAPI.apiKeys.validate(id)
      message.success(result.success ? 'API Key 有效' : 'API Key 无效')
    } catch {
      message.error('验证失败')
    }
  }

  const isConfigured = (preset: ProviderPreset): boolean => {
    const domain = {
      openai: 'openai.com', mimo: 'xiaomimimo.com', qwen: 'dashscope',
      zhipu: 'bigmodel.cn', gemini: 'googleapis.com', stability: 'stability.ai'
    }[preset.id] || 'none'
    return providers.some((p) => p.baseUrl.includes(domain))
  }

  return (
    <Drawer title="API 设置" placement="right" width={520} open={open} onClose={onClose}>
      <Title level={5}><Space><LinkOutlined /> 服务商配置</Space></Title>
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        点击展开配置 API Key，Base URL 支持自定义（代理/中转）
      </Paragraph>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {PROVIDER_PRESETS.map((preset) => {
          const expanded = expandedId === preset.id
          const configured = isConfigured(preset)

          return (
            <Card
              key={preset.id}
              size="small"
              hoverable
              style={{ border: expanded ? '1px solid #1677ff' : undefined, cursor: 'pointer' }}
              onClick={() => handlePresetClick(preset)}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Space>
                  {expanded ? <DownOutlined style={{ color: '#1677ff', fontSize: 12 }} /> : <RightOutlined style={{ fontSize: 12 }} />}
                  <Text strong>{preset.name}</Text>
                  {preset.supportsVision && <Tag color="blue">视觉</Tag>}
                  {preset.supportsImageEdit && <Tag color="green">编辑</Tag>}
                </Space>
                {configured
                  ? <Badge status="success" text={<Text type="success" style={{ fontSize: 11 }}>已配置</Text>} />
                  : <Badge status="default" text={<Text type="secondary" style={{ fontSize: 11 }}>未配置</Text>} />
                }
              </div>

              {expanded && (
                <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                  <Alert message={preset.description} type="info" showIcon style={{ marginBottom: 12 }} />

                  <Form form={form} layout="vertical" onFinish={handleAdd}>
                    <Form.Item name="name" hidden><Input /></Form.Item>
                    <Form.Item name="models" hidden><Input /></Form.Item>

                    {/* Base URL - 可编辑 */}
                    <Form.Item
                      name="baseUrl"
                      label={
                        <Space>
                          Base URL
                          <Tag icon={<EditOutlined />} color="default" style={{ fontSize: 10 }}>可自定义</Tag>
                        </Space>
                      }
                      rules={[{ required: true, message: '请输入 API 地址' }]}
                      extra="支持自定义地址，用于代理或中转服务"
                    >
                      <Input placeholder={preset.baseUrl} />
                    </Form.Item>

                    <Form.Item
                      name="apiKey"
                      label="API Key"
                      rules={[{ required: true, message: '请输入 API Key' }]}
                    >
                      <Input.Password placeholder={`输入 ${preset.name} 的 API Key`} />
                    </Form.Item>

                    <Form.Item name="chatModel" label="对话 / 分析模型">
                      <Input placeholder={preset.chatModels[0]} />
                    </Form.Item>

                    {preset.visionModels.length > 0 && (
                      <Form.Item name="visionModel" label="视觉分析模型">
                        <Input placeholder={preset.visionModels[0]} />
                      </Form.Item>
                    )}

                    {preset.imageModels.length > 0 && (
                      <Form.Item name="imageModel" label="图片生成模型">
                        <Input placeholder={preset.imageModels[0]} />
                      </Form.Item>
                    )}

                    <Form.Item style={{ marginBottom: 0 }}>
                      <Button type="primary" htmlType="submit" loading={loading} icon={<PlusOutlined />} block>
                        保存 {preset.name} API Key
                      </Button>
                    </Form.Item>
                  </Form>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      <Divider />

      <Title level={5}><Space><SettingOutlined /> 已配置的 API ({providers.length})</Space></Title>
      <List
        dataSource={providers}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button key="v" type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => handleValidate(item.id)}>验证</Button>,
              <Popconfirm key="d" title="确定删除？" onConfirm={() => handleDelete(item.id)}>
                <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            ]}
          >
            <List.Item.Meta
              title={
                <Space>
                  <Text strong>{item.name}</Text>
                  <Tag color="blue">{item.chatModel}</Tag>
                  {item.imageModel && <Tag color="green">{item.imageModel}</Tag>}
                </Space>
              }
              description={
                <Space direction="vertical" size={0}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{item.baseUrl}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>Key: {item.maskedKey}</Text>
                </Space>
              }
            />
          </List.Item>
        )}
        locale={{ emptyText: '暂无配置' }}
      />

      <Divider />

      {/* R2 对象存储配置 */}
      <R2ConfigSection />
    </Drawer>
  )
}

function R2ConfigSection() {
  const [r2Form] = Form.useForm()
  const [r2Status, setR2Status] = useState<'loading' | 'configured' | 'not_configured'>('loading')
  const [r2Loading, setR2Loading] = useState(false)

  useEffect(() => {
    window.electronAPI.r2.status().then((res) => {
      setR2Status(res.data?.configured ? 'configured' : 'not_configured')
    }).catch(() => setR2Status('not_configured'))
  }, [])

  const handleR2Save = async () => {
    try {
      const values = await r2Form.validateFields()
      setR2Loading(true)
      const result = await window.electronAPI.r2.configure(values)
      if (result.success) {
        message.success('R2 配置已保存')
        setR2Status('configured')
      } else {
        message.error(result.error || '配置失败')
      }
    } catch (err) {
      if (err instanceof Error) message.error(err.message)
    } finally {
      setR2Loading(false)
    }
  }

  return (
    <Collapse
      ghost
      items={[{
        key: 'r2',
        label: (
          <Space>
            <CloudOutlined />
            <Text strong>CF R2 对象存储（可选）</Text>
            {r2Status === 'configured' && <Tag color="green">已配置</Tag>}
          </Space>
        ),
        children: (
          <div>
            <Alert
              message="配置 R2 后，用户上传和生成的图片都会自动上传到云端"
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
            />
            <Alert
              message={
                <span>
                  如何获取凭证？访问{' '}
                  <a href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer">
                    Cloudflare 控制台
                  </a>{' '}
                  → R2 → 管理 R2 API Tokens → 创建 API Token，会获得 Access Key ID 和 Secret Access Key。
                  Account ID 在 R2 概览页面右侧可见。
                </span>
              }
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
            />
            <Form form={r2Form} layout="vertical" onFinish={handleR2Save}>
              <Form.Item
                name="accountId"
                label="Account ID"
                rules={[{ required: true }]}
                extra="在 R2 概览页面右侧可见"
              >
                <Input placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
              </Form.Item>
              <Form.Item
                name="accessKeyId"
                label="Access Key ID"
                rules={[{ required: true }]}
                extra="创建 API Token 时获得"
              >
                <Input placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
              </Form.Item>
              <Form.Item
                name="secretAccessKey"
                label="Secret Access Key"
                rules={[{ required: true }]}
                extra="创建 API Token 时获得，仅显示一次，请妥善保存"
              >
                <Input.Password placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
              </Form.Item>
              <Form.Item
                name="bucketName"
                label="Bucket 名称"
                rules={[{ required: true }]}
                extra="在 R2 页面创建的 Bucket 名称"
              >
                <Input placeholder="my-images" />
              </Form.Item>
              <Form.Item
                name="publicBaseUrl"
                label="公网访问地址（可选）"
                extra="如配置了自定义域名，填入后图片可通过该域名访问，如 https://img.example.com"
              >
                <Input placeholder="https://img.example.com" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" loading={r2Loading} block>
                  保存 R2 配置
                </Button>
              </Form.Item>
            </Form>
          </div>
        )
      }]}
    />
  )
}
