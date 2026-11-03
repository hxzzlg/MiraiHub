import { App as AntdApp, Button, Card, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd'
import { CloudUploadOutlined, RedoOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { usePlatform } from '../context/PlatformContext'
import PageHeader from '../components/PageHeader'
import CopyButton from '../components/CopyButton'

interface SyncConfig {
  remote_url: string
  secret: string
  secret_masked: string
  is_auto_generated: boolean
}

interface PushResult {
  ok?: boolean
  remote?: string
  accounts?: number
  models?: number
  client_profile?: boolean
  profile_fields?: string[]
  remote_result?: {
    accounts?: { added?: number; updated?: number }
    models?: { added?: number; updated?: number }
    client_profile?: { applied?: boolean; source?: string; fields?: string[]; errors?: unknown }
  }
}

function randomSecret(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export default function SyncPage() {
  const { message } = AntdApp.useApp()
  const { platformKey } = usePlatform()
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<PushResult | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await api<SyncConfig>('/api/sync/config')
      setConfig(r)
      setUrl(r.remote_url ?? '')
      setSecret(r.secret ?? '')
      setDirty(false)
    } catch (e) {
      message.error((e as Error).message || '同步配置加载失败')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformKey])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      await api('/api/sync/config', { method: 'POST', body: { remote_url: url.trim(), secret: secret.trim() } })
      message.success('同步配置已保存')
      setDirty(false)
      void load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const push = async () => {
    setPushing(true)
    try {
      // 未保存的改动一并提交
      if (dirty) await api('/api/sync/config', { method: 'POST', body: { remote_url: url.trim(), secret: secret.trim() } })
      const r = await api<PushResult>('/api/sync/push', { method: 'POST', body: {}, timeout: 120000 })
      setPushResult(r)
      setDirty(false)
    } catch (e) {
      message.error((e as Error).message || '推送失败')
    } finally {
      setPushing(false)
    }
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="同步设置"
        description="把本机账号 / 模型配置 / 客户端参数推送到远端实例"
        actions={
          <Space>
            <Button icon={<RedoOutlined />} onClick={() => setSecret(randomSecret())}>
              重新生成密钥
            </Button>
            <Button type="primary" icon={<CloudUploadOutlined />} loading={pushing} onClick={() => void push()}>
              同步到线上
            </Button>
          </Space>
        }
      />

      <Card size="small" title="远端实例">
        <Form layout="vertical" style={{ maxWidth: 640 }}>
          <Form.Item label="远端 URL">
            <Input
              placeholder="https://远端实例（HMAC 同步接收端）"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setDirty(true)
              }}
            />
          </Form.Item>
          <Form.Item
            label={
              <Space>
                HMAC 密钥
                <Button type="link" size="small" onClick={() => setShowSecret((v) => !v)}>
                  {showSecret ? '隐藏' : '显示'}
                </Button>
                {config?.is_auto_generated && <Tag>自动生成</Tag>}
              </Space>
            }
          >
            <Space>
              <Input
                style={{ width: 420, fontFamily: 'monospace' }}
                type={showSecret ? 'text' : 'password'}
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value)
                  setDirty(true)
                }}
              />
              <CopyButton value={secret} tip="复制密钥" />
            </Space>
          </Form.Item>
          <Button type="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
            保存配置
          </Button>
          {dirty && (
            <Typography.Text type="warning" style={{ marginLeft: 12 }}>
              有未保存的改动（推送时也会一并提交）
            </Typography.Text>
          )}
        </Form>
      </Card>

      <Modal
        title="同步结果"
        open={!!pushResult}
        onCancel={() => setPushResult(null)}
        footer={[<Button key="ok" type="primary" onClick={() => setPushResult(null)}>完成</Button>]}
        width={640}
      >
        {pushResult && (
          <>
            <Table
              size="small"
              rowKey="k"
              pagination={false}
              dataSource={[
                { k: '账号', v: `新增 ${pushResult.remote_result?.accounts?.added ?? 0}，更新 ${pushResult.remote_result?.accounts?.updated ?? 0}` },
                { k: '模型', v: `新增 ${pushResult.remote_result?.models?.added ?? 0}，更新 ${pushResult.remote_result?.models?.updated ?? 0}` },
                { k: '客户端参数', v: pushResult.remote_result?.client_profile?.applied ? `已应用（来源 ${pushResult.remote_result.client_profile.source ?? ''}）` : '未应用' },
              ]}
              columns={[
                { title: '项目', dataIndex: 'k', width: 120 },
                { title: '结果', dataIndex: 'v' },
              ]}
            />
            {Array.isArray(pushResult.remote_result?.client_profile?.errors) && (pushResult.remote_result.client_profile.errors as unknown[]).length > 0 && (
              <Typography.Paragraph type="danger" style={{ marginTop: 8 }}>
                参数错误：{JSON.stringify(pushResult.remote_result.client_profile.errors)}
              </Typography.Paragraph>
            )}
          </>
        )}
      </Modal>
    </Space>
  )
}
