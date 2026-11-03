import { Alert, App as AntdApp, Button, Card, Col, Progress, Row, Segmented, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { type PlatformSpec } from '../api/platforms'
import { usePlatform } from '../context/PlatformContext'
import PageHeader from '../components/PageHeader'
import CopyButton from '../components/CopyButton'
import PlatformLogo from '../components/PlatformLogo'
import { FMT_EMPTY, fmtCredit, fmtInt, fmtK, fmtNum, fmtPct, fmtTime, secondsAfter } from '../utils/format'

interface OvWindow {
  requests: number
  ok_requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cached_tokens: number
  credits: number
  days?: number
}

interface OvData {
  platform_label?: string
  accounts: { total: number; balance_remain: number; balance_total: number; disabled_balance: number; used_ratio: number | null }
  models: number
  keys: number
  today: OvWindow
  window: OvWindow
  month: OvWindow
  average_credits: number | null
  cache: { cached_tokens: number; prompt_tokens: number; rate: number | null; samples: number; note: string }
  monitor: {
    active: number
    cooling: number
    breaker: number
    disabled: number
    no_balance: number
    total: number
    items: {
      id: number
      name: string
      state: string
      label: string
      balance: number
      until: string | null
      cool_remaining: number
      last_error: string
      signal_code: string
      signal_label: string
      platform: string
    }[]
  }
}

interface SentinelBrief {
  tripped?: boolean
  accounts_affected?: number
  pause?: Record<string, { until: number; reason: string }>
}

const STATE_TONE: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  active: 'success',
  cooling: 'warning',
  breaker: 'error',
  disabled: 'default',
  no_balance: 'warning',
}

export default function OverviewPage() {
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const { platforms, current, select, platformKey } = usePlatform()
  const [data, setData] = useState<OvData | null>(null)
  const [sentinel, setSentinel] = useState<SentinelBrief | null>(null)
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState<'today' | 'window' | 'month'>('today')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ov, sn] = await Promise.all([
        api<OvData>('/api/overview?days=30'),
        api<SentinelBrief>('/api/sentinel/status?window=300').catch(() => null),
      ])
      setData(ov)
      setSentinel(sn)
    } catch (e) {
      message.error((e as Error).message || '概览加载失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformKey])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformKey])

  // 30s 自动刷新（页面可见时）
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void load()
    }, 30000)
    return () => window.clearInterval(timer)
  }, [load])

  const win = data ? data[days] : null
  const usageDays = days === 'today' ? '今日' : days === 'month' ? '本月' : '近 7 天'
  const ratio = data?.accounts.used_ratio ?? null

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="概览"
        description={data?.platform_label ? `统计口径：${data.platform_label}` : undefined}
        onRefresh={() => void load()}
        refreshing={loading}
        actions={
          <Space>
            <Segmented
              value={days}
              onChange={(v) => setDays(v as typeof days)}
              options={[
                { label: '今日', value: 'today' },
                { label: '近 7 天', value: 'window' },
                { label: '本月', value: 'month' },
              ]}
            />
          </Space>
        }
      />

      {/* 告警横幅 */}
      {sentinel?.tripped && (
        <Alert
          type="error"
          showIcon
          title="风控哨兵触发批次封控信号"
          description={
            <Button size="small" type="primary" danger onClick={() => navigate('/sentinel')}>
              查看哨兵详情
            </Button>
          }
        />
      )}
      {sentinel?.pause &&
        Object.entries(sentinel.pause).map(([k, v]) => (
          <Alert
            key={k}
            type="warning"
            showIcon
            title={`平台已暂停：${k === 'all' ? '全部平台' : k}`}
            description={`原因：${v.reason || '—'} · 剩余 ${secondsAfter(v.until * 1000) ?? 0} 秒后自动恢复`}
          />
        ))}

      {/* 运行状态条 */}
      <Card size="small">
        <Space wrap size={24}>
          <Tag color="success">服务运行中</Tag>
          <Typography.Text>
            平台：<Typography.Text strong>{data?.platform_label ?? FMT_EMPTY}</Typography.Text>
          </Typography.Text>
          <Typography.Text>
            模型：<Typography.Text strong>{fmtInt(data?.models)}</Typography.Text>
          </Typography.Text>
          <Typography.Text>
            活跃 Key：<Typography.Text strong>{fmtInt(data?.keys)}</Typography.Text>
          </Typography.Text>
          <Typography.Text>
            API 地址：<Typography.Text code>{`${window.location.origin}/v1`}</Typography.Text>
            <CopyButton value={`${window.location.origin}/v1`} tip="复制 OpenAI Base URL" />
          </Typography.Text>
        </Space>
      </Card>

      {/* 卡片墙 */}
      <Row gutter={[12, 12]}>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" title="剩余额度" extra={<Tooltip title={`已用 ${fmtPct(ratio, 1)}`}><span /></Tooltip>}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {fmtCredit(data?.accounts.balance_remain)}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              总额 {fmtCredit(data?.accounts.balance_total)} · 已停用账号 {fmtCredit(data?.accounts.disabled_balance)}
            </Typography.Text>
            <Progress
              percent={ratio !== null ? Math.round(ratio * 100) : 0}
              size="small"
              status={ratio !== null && ratio > 0.9 ? 'exception' : 'normal'}
              strokeColor={ratio !== null && ratio > 0.7 && ratio <= 0.9 ? '#d9930d' : undefined}
              style={{ marginTop: 8 }}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" title={`用量（${usageDays}）`}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {fmtNum(win?.requests ?? null)}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              积分 {fmtCredit(win?.credits ?? null)} · Tokens {fmtK(win?.total_tokens ?? null)}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              成功 {fmtNum(win?.ok_requests ?? null)} · 缓存命中 {fmtK(win?.cached_tokens ?? null)}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" title="缓存命中率">
            <Typography.Title level={3} style={{ margin: 0 }}>
              {fmtPct(data?.cache.rate ?? null, 1)}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {data?.cache.note || `样本 ${fmtInt(data?.cache.samples)} · 命中 ${fmtK(data?.cache.cached_tokens)} / ${fmtK(data?.cache.prompt_tokens)}`}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" title="账号监测">
            <Typography.Title level={3} style={{ margin: 0 }}>
              {fmtInt(data?.monitor.active)}
              <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
                {' '}/ {fmtInt(data?.monitor.total)} 活跃
              </Typography.Text>
            </Typography.Title>
            <Space wrap size={4} style={{ marginTop: 8 }}>
              <Tag color="warning">冷却 {fmtInt(data?.monitor.cooling)}</Tag>
              <Tag color="error">熔断 {fmtInt(data?.monitor.breaker)}</Tag>
              <Tag>停用 {fmtInt(data?.monitor.disabled)}</Tag>
              <Tag color="warning">无额度 {fmtInt(data?.monitor.no_balance)}</Tag>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={14}>
          <Card size="small" title="异常账号">
            <Table
              size="small"
              rowKey="id"
              loading={loading}
              dataSource={data?.monitor.items ?? []}
              pagination={{ pageSize: 8 }}
              columns={[
                { title: '账号', dataIndex: 'name', ellipsis: true },
                {
                  title: '状态',
                  dataIndex: 'state',
                  width: 90,
                  render: (v: string, r) => <Tag color={STATE_TONE[v] ?? 'default'}>{r.label || v}</Tag>,
                },
                { title: '余额', dataIndex: 'balance', width: 90, align: 'right', render: (v) => <span className="num">{fmtCredit(v)}</span> },
                {
                  title: '恢复',
                  dataIndex: 'until',
                  width: 110,
                  render: (v: string | null, r) => (r.cool_remaining > 0 ? `${Math.ceil(r.cool_remaining / 60)} 分钟后` : v ? fmtTime(v) : FMT_EMPTY),
                },
                { title: '信号', dataIndex: 'signal_code', width: 100, render: (v: string, r) => (v ? <Tag color="warning">{r.signal_label || v}</Tag> : FMT_EMPTY) },
                { title: '最近错误', dataIndex: 'last_error', ellipsis: true, render: (v) => v || FMT_EMPTY },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card size="small" title="平台矩阵" extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>点击切换统计口径</Typography.Text>}>
            <Row gutter={[8, 8]}>
              {platforms.map((p: PlatformSpec) => (
                <Col key={p.id} xs={12}>
                  <Card
                    size="small"
                    hoverable
                    onClick={() => select(p.id, p.realm ?? p.realms?.[0]?.key ?? null)}
                    style={p.id === current.platform ? { borderColor: '#2E9BFF' } : undefined}
                  >
                    <Space size={8}>
                      <PlatformLogo id={p.id} icon={p.icon} size={22} />
                      <Typography.Text strong>{p.label}</Typography.Text>
                    </Space>
                    <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                      {p.realm_label || ''} · {fmtInt(p.account_count)} 个账号
                    </Typography.Text>
                  </Card>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
