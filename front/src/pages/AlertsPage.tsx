import { Alert, App as AntdApp, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Space as AntSpace, Switch, Table, Tag, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'

interface Channel {
  type: string
  target: string
}

interface AlertsConfig {
  config?: {
    enabled: boolean
    cooldown: number
    channels: Channel[]
    smtp_host?: string
    smtp_port?: number
    smtp_user?: string
    smtp_from?: string
    smtp_starttls?: boolean
    has_password?: boolean
    has_smtp?: boolean
    smtp?: string
    mail_to?: string
  }
  channels?: { type: string; label: string; target: string; enabled: boolean }[]
  labels?: Record<string, string>
  smtp?: { host?: string; port?: number; user?: string; from?: string; mail_to?: string; has_password?: boolean; ready?: boolean; missing?: string[] }
}

interface TestResult {
  results?: { type?: string; ok?: boolean; message?: string; error?: string }[]
  smtp?: { ok?: boolean; message?: string }
}

export default function AlertsPage() {
  const { message } = AntdApp.useApp()
  const [data, setData] = useState<AlertsConfig | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [cooldown, setCooldown] = useState(600)
  const [channels, setChannels] = useState<Channel[]>([])
  const [smtpQuick, setSmtpQuick] = useState('')
  const [mailTo, setMailTo] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(465)
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpFrom, setSmtpFrom] = useState('')
  const [smtpStarttls, setSmtpStarttls] = useState(false)
  const [smtpPassword, setSmtpPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await api<AlertsConfig>('/api/alerts/config')
      setData(r)
      const c = r.config
      setEnabled(c?.enabled ?? false)
      setCooldown(c?.cooldown ?? 600)
      setChannels((c?.channels ?? []).map((ch) => ({ type: ch.type, target: ch.target })))
      setSmtpHost(c?.smtp_host ?? '')
      setSmtpPort(c?.smtp_port ?? 465)
      setSmtpUser(c?.smtp_user ?? '')
      setSmtpFrom(c?.smtp_from ?? '')
      setSmtpStarttls(!!c?.smtp_starttls)
      setMailTo(c?.mail_to ?? '')
    } catch (e) {
      message.error((e as Error).message || '预警配置加载失败')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        enabled,
        cooldown,
        channels: channels.filter((c) => c.target.trim()),
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        smtp_user: smtpUser,
        smtp_from: smtpFrom,
        smtp_starttls: smtpStarttls,
        mail_to: mailTo,
      }
      const quick = smtpQuick.trim()
      if (quick.includes(':')) {
        body.smtp = quick
      } else if (quick === '__clear__') {
        body.smtp = '__clear__'
      }
      if (smtpPassword.trim()) body.smtp_password = smtpPassword.trim()
      await api('/api/alerts/config', { method: 'PUT', body })
      message.success('预警配置已保存')
      setSmtpPassword('')
      setSmtpQuick('')
      void load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const r = await api<TestResult>('/api/alerts/test', { method: 'POST', body: {} })
      setTestResult(r)
    } catch (e) {
      message.error((e as Error).message || '发送测试失败')
    } finally {
      setTesting(false)
    }
  }

  const smtp = data?.smtp
  const labels = data?.labels ?? { feishu: '飞书群机器人', qqbot: 'QQ 机器人', email: '邮件（SMTP）' }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="预警管理"
        description="封控信号 / 网关异常通过飞书 / QQ 机器人 / 邮件通知"
        onRefresh={() => void load()}
        actions={
          <Space>
            <Button icon={<SendOutlined />} loading={testing} onClick={() => void test()}>
              发送测试
            </Button>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              保存
            </Button>
          </Space>
        }
      />

      {smtp && !smtp.ready && smtp.missing?.length ? (
        <Alert type="warning" showIcon title={`SMTP 尚未配置完整，缺少：${smtp.missing.join('、')}`} />
      ) : null}
      {smtp?.ready && <Alert type="success" showIcon title="SMTP 已就绪" />}

      <Card size="small" title="基本设置">
        <AntSpace wrap size={24}>
          <AntSpace size={8}>
            <Typography.Text>启用预警：</Typography.Text>
            <Switch checked={enabled} onChange={setEnabled} />
          </AntSpace>
          <AntSpace size={8}>
            <Typography.Text>去重窗口：</Typography.Text>
            <InputNumber min={0} value={cooldown} onChange={(v) => setCooldown(Number(v ?? 0))} suffix="秒" style={{ width: 140 }} />
          </AntSpace>
        </AntSpace>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
          同一平台同一业务码在窗口内只通知一次，避免刷屏。
        </Typography.Paragraph>
      </Card>

      <Card size="small" title="通知渠道">
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          {channels.map((c, i) => (
            <Row key={i} gutter={8}>
              <Col span={7}>
                <Select
                  style={{ width: '100%' }}
                  value={c.type}
                  onChange={(v) => setChannels((cs) => cs.map((x, j) => (j === i ? { ...x, type: v } : x)))}
                  options={Object.entries(labels).map(([v, l]) => ({ value: v, label: l }))}
                />
              </Col>
              <Col span={14}>
                <Input
                  placeholder={c.type === 'feishu' ? 'Webhook 地址 https://…' : c.type === 'email' ? '收件邮箱' : 'QQ 机器人配置'}
                  value={c.target}
                  onChange={(e) => setChannels((cs) => cs.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))}
                />
              </Col>
              <Col span={3}>
                <Button icon={<DeleteOutlined />} danger onClick={() => setChannels((cs) => cs.filter((_, j) => j !== i))} />
              </Col>
            </Row>
          ))}
          <Button icon={<PlusOutlined />} onClick={() => setChannels((cs) => [...cs, { type: 'feishu', target: '' }])}>
            添加渠道
          </Button>
        </Space>
      </Card>

      <Card size="small" title="邮件（SMTP）">
        <Form layout="vertical" style={{ maxWidth: 720 }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="快捷配置（qqSMTP:授权码，留空不改）">
                <Input
                  placeholder="qqSMTP:xxxxxxxx 授权码（粘贴后自动推导 SMTP 服务器）"
                  value={smtpQuick}
                  onChange={(e) => setSmtpQuick(e.target.value)}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="收件邮箱">
                <Input value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="you@example.com" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="SMTP 服务器">
                <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.qq.com" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label="端口">
                <InputNumber style={{ width: '100%' }} min={1} max={65535} value={smtpPort} onChange={(v) => setSmtpPort(Number(v ?? 465))} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="账号">
                <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label={data?.config?.has_password ? '密码（已保存，留空不改）' : '密码 / 授权码'}>
                <Input.Password value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="发件人">
                <Input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Space size={8}>
                <Typography.Text>STARTTLS：</Typography.Text>
                <Switch size="small" checked={smtpStarttls} onChange={setSmtpStarttls} />
              </Space>
            </Col>
          </Row>
        </Form>
      </Card>

      <Modal
        title="测试发送结果"
        open={!!testResult}
        onCancel={() => setTestResult(null)}
        footer={[<Button key="ok" type="primary" onClick={() => setTestResult(null)}>完成</Button>]}
        width={560}
      >
        <Table
          size="small"
          rowKey={(_, i) => String(i)}
          dataSource={[
            ...(testResult?.smtp ? [{ key: 'smtp', type: '邮件（SMTP）', ok: testResult.smtp.ok, message: testResult.smtp.message }] : []),
            ...(testResult?.results ?? []).map((r, i) => ({ key: String(i), type: r.type, ok: r.ok, message: r.message || r.error })),
          ]}
          pagination={false}
          columns={[
            { title: '渠道', dataIndex: 'type' },
            { title: '结果', dataIndex: 'ok', width: 90, render: (v) => (v ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag>) },
            { title: '说明', dataIndex: 'message', ellipsis: true },
          ]}
        />
      </Modal>
    </Space>
  )
}
