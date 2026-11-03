import { App as AntdApp, Button, Card, Col, InputNumber, Row, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { platformSpeed, type PlatformSpeedRow } from '../api/platforms'
import { usePlatform } from '../context/PlatformContext'
import PageHeader from '../components/PageHeader'
import TopologyViz, { type TopoEdge, type TopoNode } from '../components/TopologyViz'
import { FMT_EMPTY, fmtCredit, fmtInt, fmtPct } from '../utils/format'

interface GatewayConfig {
  strategy: string
  priority: Record<string, number>
  disabled: Record<string, { at: number; reason: string }>
  spread_unbound: boolean
  strategies: { value: string; label: string; description: string }[]
  platforms: { id: string; label: string; managed: boolean }[]
}

interface OrderItem {
  platform: string
  label: string
  ok: boolean
  accounts: number
  active: number
  cooling: number
  usable: number
  balance_remain: number
  balance_total: number
  balance_ratio: number | null
  disabled: boolean
  available: boolean
  reason: string
}

export default function GatewayPage() {
  const { message } = AntdApp.useApp()
  const { platformKey } = usePlatform()
  const [config, setConfig] = useState<GatewayConfig | null>(null)
  const [order, setOrder] = useState<OrderItem[]>([])
  const [speed, setSpeed] = useState<PlatformSpeedRow[]>([])
  const [loading, setLoading] = useState(false)
  const [burst, setBurst] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, o, s] = await Promise.all([
        api<GatewayConfig>('/api/gateway/config'),
        api<{ items: OrderItem[] }>('/api/gateway/order'),
        platformSpeed(24),
      ])
      setConfig(c)
      setOrder(o?.items ?? [])
      setSpeed(s?.items ?? [])
    } catch (e) {
      message.error((e as Error).message || '网关配置加载失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformKey])

  useEffect(() => {
    void load()
  }, [load])

  const saveConfig = async (patch: Partial<Record<string, unknown>>) => {
    try {
      const r = await api<{ config: GatewayConfig }>('/api/gateway/config', { method: 'PUT', body: patch })
      if (r?.config) setConfig(r.config)
      message.success('调度配置已保存')
      void load()
    } catch (e) {
      message.error((e as Error).message || '保存失败')
    }
  }

  const toggleDisable = async (platform: string, disable: boolean) => {
    try {
      await api(`/api/gateway/${disable ? 'disable' : 'enable'}`, { method: 'POST', body: { platform, reason: disable ? '控制台手动禁用' : '' } })
      message.success(disable ? `已禁用 ${platform}` : `已启用 ${platform}`)
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  // 拓扑：Key → 网关 → 平台（按 order 可用账号数为权重）
  const nodes: TopoNode[][] = [
    [{ id: 'key', label: 'API Key', sub: `${order.length} 平台` }],
    [{ id: 'gw', label: '调度网关', tone: 'ok', sub: config?.strategy || '' }],
    order.map((o) => ({
      id: o.platform,
      label: o.label || o.platform,
      tone: o.disabled ? 'danger' : o.usable > 0 ? 'ok' : 'warn',
      sub: o.disabled ? '已禁用' : `${o.usable} 可用`,
    })) as TopoNode[],
  ]
  const maxUsable = Math.max(1, ...order.map((o) => o.usable))
  const edges: TopoEdge[] = [
    { from: 'key', to: 'gw', weight: 0.8, tone: 'ok' },
    ...order.map((o) => ({
      from: 'gw',
      to: o.platform,
      weight: o.disabled ? 0 : Math.max(0.15, o.usable / maxUsable),
      tone: o.disabled ? ('idle' as const) : o.usable > 0 ? ('ok' as const) : ('warn' as const),
    })),
  ]

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="调度网关"
        description="跨平台调度策略与平台优先级"
        onRefresh={() => void load()}
        refreshing={loading}
      />

      {/* 调度策略 */}
      <Card size="small" title="调度策略">
        <Row gutter={[8, 8]}>
          {(config?.strategies ?? []).map((s) => (
            <Col key={s.value} xs={24} md={12} xl={8}>
              <Card
                size="small"
                hoverable
                onClick={() => void saveConfig({ strategy: s.value })}
                style={config?.strategy === s.value ? { borderColor: '#4176e6' } : undefined}
              >
                <Space align="start">
                  {config?.strategy === s.value ? <Tag color="processing">当前</Tag> : null}
                  <div>
                    <Typography.Text strong>{s.label}</Typography.Text>
                    <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                      {s.description}
                    </Typography.Paragraph>
                  </div>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
        <Row style={{ marginTop: 12 }} align="middle">
          <Tooltip title="没有绑定账号的 Key（无头请求）也按调度策略跨平台派发">
            <Typography.Text>无头请求也走跨平台调度：</Typography.Text>
          </Tooltip>
          <Switch
            checked={config?.spread_unbound ?? false}
            onChange={(v) => void saveConfig({ spread_unbound: v })}
            style={{ marginLeft: 8 }}
          />
        </Row>
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={14}>
          <Card
            size="small"
            title="调度可视化"
            extra={
              <Button size="small" onClick={() => setBurst((v) => v + 1)}>
                模拟一批请求
              </Button>
            }
          >
            <TopologyViz layers={nodes} edges={edges} height={Math.max(220, order.length * 44 + 80)} burst={burst} />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card size="small" title="当前调度顺序">
            <Table
              size="small"
              rowKey="platform"
              loading={loading}
              dataSource={order}
              pagination={false}
              columns={[
                { title: '#', width: 40, render: (_, __, i) => <span className="num">{i + 1}</span> },
                { title: '平台', dataIndex: 'label', render: (v, r) => (r.disabled ? <Typography.Text type="secondary">{v}</Typography.Text> : <Typography.Text strong>{v}</Typography.Text>) },
                { title: '原因', dataIndex: 'reason', ellipsis: true },
                { title: '可用', dataIndex: 'usable', width: 70, align: 'right', render: (v) => <span className="num">{fmtInt(v)}</span> },
                { title: '余额', dataIndex: 'balance_remain', width: 90, align: 'right', render: (v, r) => <span className="num">{fmtCredit(v)}{r.balance_ratio !== null && r.balance_ratio !== undefined ? `（${fmtPct(r.balance_ratio, 0)}）` : ''}</span> },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="平台速度（TTFT / TPS，近 24h）">
            <Table
              size="small"
              rowKey={(r) => String(r.platform ?? r.label)}
              loading={loading}
              dataSource={speed}
              pagination={false}
              columns={[
                { title: '平台', dataIndex: 'label', ellipsis: true },
                { title: 'TTFT P50', dataIndex: 'ttfb_p50', width: 100, align: 'right', render: (v) => <span className="num">{v ? `${Math.round(v)}ms` : FMT_EMPTY}</span> },
                { title: 'TPS P50', dataIndex: 'tps_p50', width: 90, align: 'right', render: (v) => <span className="num">{v ? v.toFixed(1) : FMT_EMPTY}</span> },
                { title: '成功率', dataIndex: 'success_rate', width: 90, align: 'right', render: (v) => <span className="num">{fmtPct(v, 1)}</span> },
                { title: '跑分', dataIndex: 'score', width: 70, align: 'right', render: (v) => <span className="num">{v ? v.toFixed(1) : FMT_EMPTY}</span> },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="平台优先级与启停">
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              {(config?.platforms ?? []).map((p) => {
                const isDisabled = !!config?.disabled?.[p.id]
                return (
                  <Row key={p.id} align="middle" gutter={8}>
                    <Col flex="auto">
                      <Typography.Text strong>{p.label}</Typography.Text>
                      {isDisabled && (
                        <Tooltip title={config?.disabled?.[p.id]?.reason}>
                          <Tag color="error" style={{ marginLeft: 8 }}>
                            已禁用
                          </Tag>
                        </Tooltip>
                      )}
                    </Col>
                    <Col>
                      <InputNumber
                        size="small"
                        min={0}
                        max={9999}
                        value={config?.priority?.[p.id] ?? 0}
                        onBlur={(e) => {
                          const v = Number((e.target as HTMLInputElement).value)
                          if (!Number.isNaN(v) && v !== (config?.priority?.[p.id] ?? 0)) {
                            void saveConfig({ priority: { ...(config?.priority ?? {}), [p.id]: v } })
                          }
                        }}
                        style={{ width: 90 }}
                        prefix="优先级"
                      />
                    </Col>
                    <Col>
                      <Switch
                        checked={!isDisabled}
                        checkedChildren="启用"
                        unCheckedChildren="禁用"
                        onChange={(v) => void toggleDisable(p.id, !v)}
                      />
                    </Col>
                  </Row>
                )
              })}
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
