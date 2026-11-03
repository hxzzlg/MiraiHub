import { App as AntdApp, Button, Card, Col, Form, Input, InputNumber, Popconfirm, Row, Segmented, Space, Statistic, Switch, Table, Tag, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { usePlatform } from '../context/PlatformContext'
import PageHeader from '../components/PageHeader'
import { FMT_EMPTY, fmtCreditExact, fmtInt, fmtK, fmtTime } from '../utils/format'

interface ActivityRow {
  ip: string
  requests: number
  failed: number
  blocked_requests: number
  credits: number
  tokens: number
  avg_tokens: number | null
  last_seen: string | null
  blocked: boolean
  client_details?: { user_agent?: string; device_ids?: string[]; fingerprints?: string[]; macs?: string[] }
}

interface ActivityResp {
  items: ActivityRow[]
  total_ips: number
  total_requests: number
  blocked_count: number
  current_ip: string
}

interface BlockedRow {
  id: number
  ip: string
  enabled: boolean
  note: string
  created_at: string
}

interface DeviceRow {
  kind: string
  digest: string
  value: string
  blocked: boolean
  note: string
  ips: string[]
  last_seen: string | null
}

const KIND_LABELS: Record<string, string> = {
  device_id: '设备 ID',
  fingerprint: '指纹',
  mac: 'MAC',
  browser: '浏览器指纹',
}

export default function IpPage() {
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const { platformKey } = usePlatform()
  const [data, setData] = useState<ActivityResp | null>(null)
  const [blocked, setBlocked] = useState<BlockedRow[]>([])
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(7)
  const [sort, setSort] = useState<'requests' | 'tokens' | 'credits'>('requests')
  const [minRequests, setMinRequests] = useState<number | null>(null)
  const [ipFilter, setIpFilter] = useState('')
  const [blockForm] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ days: String(days), sort, direction: 'desc', limit: '100' })
      if (minRequests) qs.set('min_requests', String(minRequests))
      if (ipFilter.trim()) qs.set('ip', ipFilter.trim())
      const [a, b, d] = await Promise.all([
        api<ActivityResp>(`/api/ip/activity?${qs.toString()}`),
        api<{ items: BlockedRow[] }>('/api/ip/blocked'),
        api<{ items: DeviceRow[] }>('/api/ip/devices'),
      ])
      setData(a)
      setBlocked(b.items ?? [])
      setDevices(d.items ?? [])
    } catch (e) {
      message.error((e as Error).message || 'IP 数据加载失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, sort, minRequests, ipFilter, platformKey])

  useEffect(() => {
    void load()
  }, [load])

  const addBlock = async () => {
    const v = await blockForm.validateFields()
    try {
      await api('/api/ip/blocked', { method: 'POST', body: { ip: v.ip.trim(), note: v.note ?? '' } })
      message.success('已封禁')
      blockForm.resetFields()
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const toggleBlocked = async (r: BlockedRow) => {
    try {
      await api(`/api/ip/blocked/${r.id}`, { method: 'PATCH', body: { enabled: !r.enabled } })
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const removeBlocked = async (r: BlockedRow) => {
    try {
      await api(`/api/ip/blocked/${r.id}`, { method: 'DELETE' })
      message.success('已删除')
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const toggleDevice = async (d: DeviceRow) => {
    try {
      await api('/api/ip/devices', { method: 'POST', body: { kind: d.kind, value: d.value, blocked: !d.blocked, note: d.note ?? '' } })
      message.success(d.blocked ? '已解封设备' : '已封禁设备')
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader title="IP 管理" onRefresh={() => void load()} refreshing={loading} />

      <Row gutter={12}>
        <Col xs={8}><Card size="small"><Statistic title="活跃 IP" value={data?.total_ips ?? 0} /></Card></Col>
        <Col xs={8}><Card size="small"><Statistic title="总请求" value={data?.total_requests ?? 0} /></Card></Col>
        <Col xs={8}><Card size="small"><Statistic title="封禁中" value={data?.blocked_count ?? 0} /></Card></Col>
      </Row>

      <Card size="small" title="活跃 IP">
        <Space wrap size={12} style={{ marginBottom: 12 }}>
          <Segmented value={days} onChange={(v) => setDays(v as number)} options={[{ label: '1 天', value: 1 }, { label: '7 天', value: 7 }, { label: '30 天', value: 30 }, { label: '90 天', value: 90 }]} />
          <Segmented value={sort} onChange={(v) => setSort(v as typeof sort)} options={[{ label: '按请求', value: 'requests' }, { label: '按 Token', value: 'tokens' }, { label: '按积分', value: 'credits' }]} />
          <InputNumber min={1} placeholder="最少请求" value={minRequests} onChange={setMinRequests} style={{ width: 120 }} />
          <Input allowClear placeholder="IP 过滤" value={ipFilter} onChange={(e) => setIpFilter(e.target.value)} style={{ width: 180 }} />
        </Space>
        <Table
          size="small"
          rowKey="ip"
          loading={loading}
          dataSource={data?.items ?? []}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 个` }}
          columns={[
            {
              title: 'IP',
              dataIndex: 'ip',
              width: 160,
              render: (v: string, r) => (
                <Space size={4}>
                  <Typography.Text code copyable={{ text: v }} style={{ fontSize: 12 }}>{v}</Typography.Text>
                  {r.blocked && <Tag color="error">已封</Tag>}
                </Space>
              ),
            },
            { title: '请求', dataIndex: 'requests', width: 90, align: 'right', render: (v) => <span className="num">{fmtInt(v)}</span> },
            { title: '失败', dataIndex: 'failed', width: 80, align: 'right', render: (v) => <span className="num">{fmtInt(v)}</span> },
            { title: '积分', dataIndex: 'credits', width: 90, align: 'right', render: (v) => <span className="num">{fmtCreditExact(v)}</span> },
            { title: 'Tokens', dataIndex: 'tokens', width: 100, align: 'right', render: (v) => <span className="num">{fmtK(v)}</span> },
            { title: '均值 Token', dataIndex: 'avg_tokens', width: 100, align: 'right', render: (v) => <span className="num">{v !== null ? fmtInt(v) : FMT_EMPTY}</span> },
            { title: '最近', dataIndex: 'last_seen', width: 140, render: (v) => <span className="num">{fmtTime(v, true)}</span> },
            {
              title: '操作',
              width: 150,
              render: (_, r) => (
                <Space size={0}>
                  <Tooltip title="按此 IP 过滤用量日志">
                    <Button type="link" size="small" onClick={() => navigate(`/logs?ip=${encodeURIComponent(r.ip)}`)}>
                      查日志
                    </Button>
                  </Tooltip>
                </Space>
              ),
            },
          ]}
          expandable={{
            expandedRowRender: (r: ActivityRow) => (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                UA：{r.client_details?.user_agent || FMT_EMPTY}
                {r.client_details?.device_ids?.length ? ` · 设备 ${r.client_details.device_ids.join(', ')}` : ''}
                {r.client_details?.macs?.length ? ` · MAC ${r.client_details.macs.join(', ')}` : ''}
              </Typography.Text>
            ),
          }}
        />
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="封禁名单">
            <Form form={blockForm} layout="inline" style={{ marginBottom: 12 }}>
              <Form.Item name="ip" rules={[{ required: true, message: '请输入 IP' }]}>
                <Input placeholder="IP 地址" style={{ width: 180 }} />
              </Form.Item>
              <Form.Item name="note">
                <Input placeholder="备注（可选）" style={{ width: 160 }} />
              </Form.Item>
              <Button type="primary" danger onClick={() => void addBlock()}>
                封禁
              </Button>
            </Form>
            <Table
              size="small"
              rowKey="id"
              dataSource={blocked}
              pagination={{ pageSize: 8 }}
              columns={[
                { title: 'IP', dataIndex: 'ip', render: (v) => <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text> },
                { title: '备注', dataIndex: 'note', ellipsis: true },
                { title: '状态', dataIndex: 'enabled', width: 80, render: (v, r) => <Switch size="small" checked={v} onChange={() => void toggleBlocked(r)} /> },
                {
                  title: '操作',
                  width: 70,
                  render: (_, r) => (
                    <Popconfirm title="确认删除？" onConfirm={() => void removeBlocked(r)}>
                      <Button type="link" size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="设备关联">
            <Table
              size="small"
              rowKey={(r) => `${r.kind}-${r.digest}`}
              dataSource={devices}
              pagination={{ pageSize: 8 }}
              columns={[
                { title: '类型', dataIndex: 'kind', width: 90, render: (v) => KIND_LABELS[v] || v },
                { title: '标识', dataIndex: 'value', ellipsis: true, render: (v) => <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text> },
                { title: '关联 IP', dataIndex: 'ips', width: 140, render: (v: string[]) => v?.slice(0, 2).join(', ') || FMT_EMPTY },
                { title: '最近', dataIndex: 'last_seen', width: 110, render: (v) => fmtTime(v) },
                {
                  title: '封禁',
                  width: 70,
                  render: (_, r) => <Switch size="small" checked={r.blocked} onChange={() => void toggleDevice(r)} />,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
