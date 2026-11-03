import { App as AntdApp, Button, Card, Col, Progress, Row, Space, Table, Tag, Typography } from 'antd'
import { PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { usePlatform } from '../context/PlatformContext'
import PageHeader from '../components/PageHeader'
import StatCards from '../components/StatCard'
import TopologyViz, { type TopoEdge, type TopoNode } from '../components/TopologyViz'
import PlatformLogo from '../components/PlatformLogo'
import { FMT_EMPTY, fmtInt, fmtNum, relTime } from '../utils/format'

interface TrafficRow {
  ts: number
  platform: string
  outcome: string
  stage: string
  status: number
  elapsed_ms: number
  model: string
  path?: string
  key_label: string
  client_ip: string
  rid?: string
}

interface TrafficSnapshot {
  platforms: { platform: string; label: string; requests: number; ok: number; error: number; timeout: number; last_status: number }[]
  totals: { requests: number; ok: number; error: number; timeout: number }
  recent: TrafficRow[]
  running: number
  storage?: string
}

interface SentinelStatus {
  tripped: boolean
  accounts_affected: number
  threshold: number
  window_seconds: number
  suggested_pause_seconds: number
  total_events: number
  by_code: Record<string, number>
  accounts: { account_id: number; count: number; first_ts: number; last_ts: number; kind: string; code: string; label: string; detail: string; platform: string }[]
  recent: { ts: number; account_id: number; kind: string; code: string; status: number; label: string; detail: string; model: string; platform: string }[]
  pause: Record<string, { until: number; reason: string; at: number }>
  traffic?: TrafficSnapshot
}

const OUTCOME_TONE: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  ok: 'success',
  success: 'success',
  done: 'success',
  limited: 'warning',
  rate_limited: 'warning',
  warn: 'warning',
  error: 'error',
  failed: 'error',
  timeout: 'warning',
}

export default function SentinelPage() {
  const { message, modal } = AntdApp.useApp()
  const { platformKey } = usePlatform()
  const [data, setData] = useState<SentinelStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api<SentinelStatus>('/api/sentinel/status?window=3600')
      setData(r)
    } catch {
      /* 轮询失败静默 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformKey])

  useEffect(() => {
    setLoading(true)
    void load().finally(() => setLoading(false))
  }, [load])

  // 哨兵实时轮询 2s
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void load()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [load])

  const pausePlatform = (platform: string) => {
    modal.confirm({
      title: `暂停平台 ${platform === 'all' ? '全部' : platform} 止损？`,
      content: `将暂停 ${data?.suggested_pause_seconds ?? 600} 秒，期间网关不再向该平台派发请求。`,
      okButtonProps: { danger: true },
      okText: '确认暂停',
      onOk: async () => {
        try {
          await api('/api/sentinel/pause', { method: 'POST', body: { platform, seconds: data?.suggested_pause_seconds ?? 600, reason: '手动止损' } })
          message.success('已暂停')
          void load()
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  const resumePlatform = async (platform: string) => {
    try {
      await api(`/api/sentinel/resume?platform=${encodeURIComponent(platform)}`, { method: 'POST', body: {} })
      message.success('已恢复')
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  // 拓扑：请求 → 哨兵 → 各平台
  const traffic = data?.traffic
  const nodes: TopoNode[][] = [
    [{ id: 'req', label: '请求', sub: `${fmtNum(traffic?.totals.requests ?? null)} 次` }],
    [{ id: 'sentinel', label: '哨兵', tone: data?.tripped ? 'danger' : 'ok', sub: traffic?.running ? `${traffic.running} 在途` : '空闲' }],
    (traffic?.platforms ?? []).map((p) => ({
      id: p.platform,
      label: p.label || p.platform,
      tone: p.requests === 0 ? 'idle' : p.error + p.timeout > p.ok ? 'danger' : p.error + p.timeout > 0 ? 'warn' : 'ok',
      sub: `${p.ok}/${p.requests}`,
      icon: <PlatformLogo id={p.platform} size={20} />,
    })) as TopoNode[],
  ]
  const edges: TopoEdge[] = [
    { from: 'req', to: 'sentinel', weight: Math.min(1, (traffic?.totals.requests ?? 0) / 200), tone: data?.tripped ? 'danger' : 'ok' },
    ...(traffic?.platforms ?? []).map((p) => ({
      from: 'sentinel',
      to: p.platform,
      weight: Math.min(1, p.requests / Math.max(1, traffic?.totals.requests ?? 1)),
      tone: p.requests === 0 ? ('idle' as const) : p.error + p.timeout > p.ok ? ('danger' as const) : p.error + p.timeout > 0 ? ('warn' as const) : ('ok' as const),
    })),
  ]

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="风控哨兵"
        description={data?.tripped ? `批次封控信号已触发（${data.accounts_affected} 个账号受影响 / 阈值 ${data.threshold}）` : `监控上游封控信号（403/11140/4015 等），窗口 ${Math.round((data?.window_seconds ?? 3600) / 60)} 分钟`}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      {data?.tripped && (
        <Card size="small" style={{ borderColor: '#d4574e' }}>
          <Row align="middle" justify="space-between">
            <Col>
              <Typography.Text strong type="danger" style={{ fontSize: 15 }}>
                ⚠ 哨兵触发批次封控判定：{data.total_events} 条信号 / {data.accounts_affected} 个账号
              </Typography.Text>
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                信号分布：{Object.entries(data.by_code).map(([k, v]) => `${k}×${v}`).join('，') || FMT_EMPTY}
              </Typography.Text>
            </Col>
            <Col>
              <Button danger icon={<PauseCircleOutlined />} onClick={() => pausePlatform('all')}>
                立即暂停止损（全部平台）
              </Button>
            </Col>
          </Row>
        </Card>
      )}

      {/* 暂停中的平台 */}
      {Object.entries(data?.pause ?? {}).map(([k, v]) => (
        <Card key={k} size="small">
          <Row align="middle" justify="space-between">
            <Col>
              <Tag color="warning">已暂停 {k === 'all' ? '全部平台' : k}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                原因：{v.reason || FMT_EMPTY} · {relTime(v.at * 1000)}
              </Typography.Text>
            </Col>
            <Col>
              <Button icon={<PlayCircleOutlined />} onClick={() => void resumePlatform(k)}>
                恢复
              </Button>
            </Col>
          </Row>
        </Card>
      ))}

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={14}>
          <Card size="small" title="实时流量" style={{ minHeight: 380 }}>
            <TopologyViz layers={nodes} edges={edges} height={240} />
            <div style={{ marginTop: 12 }}>
              <StatCards
                items={[
                  { title: '总请求', value: fmtNum(traffic?.totals.requests ?? null) },
                  { title: '成功', value: fmtNum(traffic?.totals.ok ?? null), tone: 'success' },
                  { title: '失败', value: fmtNum(traffic?.totals.error ?? null), tone: 'danger' },
                  { title: '超时', value: fmtNum(traffic?.totals.timeout ?? null), tone: 'warning' },
                ]}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              {traffic?.platforms.map((p) => (
                <div key={p.platform} style={{ marginBottom: 6 }}>
                  <Row align="middle" gutter={8}>
                    <Col span={5}>
                      <Typography.Text style={{ fontSize: 12 }}>{p.label || p.platform}</Typography.Text>
                    </Col>
                    <Col span={16}>
                      <Progress
                        percent={p.requests ? Math.round((p.ok / p.requests) * 100) : 100}
                        size="small"
                        status={p.requests && p.ok / p.requests < 0.8 ? 'exception' : 'normal'}
                      />
                    </Col>
                    <Col span={3} style={{ textAlign: 'right' }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }} className="num">
                        {fmtInt(p.requests)}
                      </Typography.Text>
                    </Col>
                  </Row>
                </div>
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card size="small" title="实时请求结果" style={{ minHeight: 380, maxHeight: 480, overflow: 'auto' }}>
            {(traffic?.recent ?? []).slice(0, 20).map((r) => (
              <Row key={r.rid ?? `${r.ts}-${r.model}`} gutter={8} style={{ marginBottom: 4 }} align="middle">
                <Col flex="none">
                  <Tag color={OUTCOME_TONE[r.outcome] ?? 'default'}>{r.status || r.outcome}</Tag>
                </Col>
                <Col flex="auto" style={{ minWidth: 0 }}>
                  <Typography.Text ellipsis style={{ fontSize: 12 }}>
                    {r.model || r.path || FMT_EMPTY} · {r.key_label || FMT_EMPTY}
                  </Typography.Text>
                </Col>
                <Col flex="none">
                  <Typography.Text type="secondary" style={{ fontSize: 12 }} className="num">
                    {relTime(r.ts * 1000)}
                  </Typography.Text>
                </Col>
              </Row>
            ))}
            {!traffic?.recent?.length && <Typography.Text type="secondary">暂无请求记录</Typography.Text>}
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="受影响账号">
            <Table
              size="small"
              rowKey="account_id"
              loading={loading}
              dataSource={data?.accounts ?? []}
              pagination={{ pageSize: 8 }}
              columns={[
                { title: '账号 ID', dataIndex: 'account_id', width: 80 },
                { title: '信号', dataIndex: 'code', width: 110, render: (v, r) => <Tag color="warning">{r.label || v}</Tag> },
                { title: '次数', dataIndex: 'count', width: 70, align: 'right', render: (v) => <span className="num">{fmtInt(v)}</span> },
                { title: '首次', dataIndex: 'first_ts', width: 100, render: (v) => relTime(v * 1000) },
                { title: '最近', dataIndex: 'last_ts', width: 100, render: (v) => relTime(v * 1000) },
                { title: '明细', dataIndex: 'detail', ellipsis: true },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="信号明细">
            <Table
              size="small"
              rowKey={(_, i) => String(i)}
              loading={loading}
              dataSource={data?.recent ?? []}
              pagination={{ pageSize: 8 }}
              columns={[
                { title: '时间', dataIndex: 'ts', width: 100, render: (v) => relTime(v * 1000) },
                { title: '类型', dataIndex: 'label', width: 110, render: (v, r) => <Tag>{v || r.kind}</Tag> },
                { title: '上游状态', dataIndex: 'status', width: 80, align: 'right' },
                { title: '模型', dataIndex: 'model', ellipsis: true },
                { title: '平台', dataIndex: 'platform', width: 90 },
                { title: '细节', dataIndex: 'detail', ellipsis: true },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
