import { App as AntdApp, Button, Card, Col, InputNumber, Progress, Row, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, SyncOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { usePlatform } from '../context/PlatformContext'
import PageHeader from '../components/PageHeader'
import StatCards from '../components/StatCard'
import { FMT_EMPTY, fmtCredit, fmtCreditExact, fmtInt } from '../utils/format'

interface ExpiryWindow {
  days: number
  amount: number
  packages: number
}

interface NextExpiring {
  package_code: string
  display_name: string
  remaining: number
  expire_label?: string
  expiring_soon?: boolean
  expired?: boolean
}

interface CreditAccount {
  account_id: number
  account_name: string
  uid: string
  status: string
  selection_priority: number | null
  balance_remain: number
  total_remaining: number
  total_capacity: number
  expiring_soon_remaining: number
  evergreen_remaining: number
  expired_remaining: number
  soonest_days_left: number | null
  soonest_label: string
  expiring_soon: boolean
  package_count: number
  active_package_count: number
}

interface ExpiryData {
  summary: {
    accounts: number
    snapshot_accounts: number
    available_remaining: number
    total_remaining: number
    expiring_soon_remaining: number
    evergreen_remaining: number
    expired_remaining: number
    expiring_accounts: number
    expiring_packages: number
    soonest_days_left: number | null
    soonest_account_name: string
    at_risk_ratio: number
    packages_total: number
  }
  windows: ExpiryWindow[]
  accounts: CreditAccount[]
  selection_mode: 'manual' | 'automatic'
  selection_order: number[]
  routing_policy: { mode: string; upstream_start_interval_ms: number; modes: { value: string; label: string; description: string }[] }
  packages: (NextExpiring & { account_id: number; account_name: string; remaining: number })[]
  packages_total: number
  package_offset: number
  package_limit: number
  has_more: boolean
}

interface CreditUsage {
  range_days: number
  total_credits: number
  accounts: { account_id: number; account_name: string; requests: number; credits: number; remaining: number; expiring_soon_remaining: number; soonest_days_left: number | null }[]
  models: { model: string; requests: number; credits: number }[]
}

export default function CreditsPage() {
  const { message, modal } = AntdApp.useApp()
  const { platformKey } = usePlatform()
  const [data, setData] = useState<ExpiryData | null>(null)
  const [usage, setUsage] = useState<CreditUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [includeDisabled, setIncludeDisabled] = useState(false)
  const [policy, setPolicy] = useState<{ mode: string; interval: number } | null>(null)
  const pkgOffsetRef = useRef(0)
  const [packages, setPackages] = useState<ExpiryData['packages']>([])
  const [pkgLoading, setPkgLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, u, p] = await Promise.all([
        api<ExpiryData>(`/api/credits/expiry?include_disabled=${includeDisabled ? 'true' : 'false'}&package_limit=60&package_offset=0`),
        api<CreditUsage>('/api/credits/usage?days=7&top=12'),
        api<{ mode: string; upstream_start_interval_ms: number }>('/api/credits/selection-policy'),
      ])
      setData(r)
      setUsage(u)
      setPolicy({ mode: p.mode, interval: p.upstream_start_interval_ms })
      setPackages(r.packages ?? [])
      setHasMore(!!r.has_more)
      pkgOffsetRef.current = 60
    } catch (e) {
      message.error((e as Error).message || '积分到期数据加载失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeDisabled, platformKey])

  useEffect(() => {
    void load()
  }, [load])

  const loadMorePackages = async () => {
    if (pkgLoading || !hasMore) return
    setPkgLoading(true)
    try {
      const r = await api<ExpiryData>(
        `/api/credits/expiry?include_disabled=${includeDisabled ? 'true' : 'false'}&package_limit=60&package_offset=${pkgOffsetRef.current}`,
      )
      setPackages((prev) => [...prev, ...(r.packages ?? [])])
      setHasMore(!!r.has_more)
      pkgOffsetRef.current += 60
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setPkgLoading(false)
    }
  }

  const resync = () => {
    modal.confirm({
      title: '重新采集全部账号积分？',
      content: '将串行刷新所有账号的积分快照，账号较多时耗时较长。',
      okText: '开始采集',
      onOk: async () => {
        message.loading({ content: '正在采集积分数据…', key: 'creditsSync', duration: 0 })
        try {
          await api('/api/accounts/credits/sync', { method: 'POST', body: {}, timeout: 0 })
          message.success({ content: '积分采集完成', key: 'creditsSync' })
          void load()
        } catch (e) {
          message.error({ content: (e as Error).message || '采集失败', key: 'creditsSync' })
        }
      },
    })
  }

  const savePolicy = async () => {
    if (!policy) return
    try {
      await api('/api/credits/selection-policy', {
        method: 'PUT',
        body: { mode: policy.mode, upstream_start_interval_ms: policy.interval },
      })
      message.success('调度策略已保存')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const moveAccount = async (accountId: number, dir: -1 | 1) => {
    if (!data || savingOrder) return
    const ids = [...data.selection_order]
    const idx = ids.indexOf(accountId)
    if (idx < 0) return
    const target = idx + dir
    if (target < 0 || target >= ids.length) return
    ;[ids[idx], ids[target]] = [ids[target], ids[idx]]
    setSavingOrder(true)
    try {
      await api('/api/credits/selection-order', { method: 'POST', body: { mode: 'manual', account_ids: ids } })
      message.success('优先级已保存')
      void load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSavingOrder(false)
    }
  }

  const resetOrder = async () => {
    setSavingOrder(true)
    try {
      await api('/api/credits/selection-order', { method: 'POST', body: { mode: 'automatic' } })
      message.success('已恢复自动排序')
      void load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSavingOrder(false)
    }
  }

  const summary = data?.summary
  const riskTotal = data?.windows?.reduce((s, w) => s + w.amount, 0) ?? 0

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="积分到期"
        description={summary?.soonest_account_name ? `最紧迫：${summary.soonest_account_name}（${summary.soonest_days_left !== null ? `${Math.ceil(summary.soonest_days_left)} 天后` : '已到期'}）` : undefined}
        onRefresh={() => void load()}
        refreshing={loading}
        actions={
          <Space>
            <Switch
              checkedChildren="含停用"
              unCheckedChildren="仅启用"
              checked={includeDisabled}
              onChange={setIncludeDisabled}
            />
            <Button icon={<SyncOutlined />} onClick={resync}>
              重新采集
            </Button>
          </Space>
        }
      />

      <StatCards
        items={[
          { title: '可用剩余积分', value: fmtCredit(summary?.available_remaining), hint: `快照账号 ${fmtInt(summary?.snapshot_accounts)} 个` },
          { title: '7 天内到期', value: fmtCredit(summary?.expiring_soon_remaining), tone: 'warning', hint: `${fmtInt(summary?.expiring_accounts)} 个账号 / ${fmtInt(summary?.expiring_packages)} 个包` },
          { title: '长期有效', value: fmtCredit(summary?.evergreen_remaining) },
          { title: '已到期', value: fmtCredit(summary?.expired_remaining), tone: 'danger' },
        ]}
      />

      <Row gutter={[12, 12]} align="stretch">
        <Col xs={24} xl={12}>
          <Card size="small" style={{ height: '100%' }} title="到期风险分布">
            {(data?.windows ?? []).map((w) => (
              <div key={w.days} style={{ marginBottom: 8 }}>
                <Row align="middle" gutter={8}>
                  <Col span={4}>
                    <Typography.Text style={{ fontSize: 12 }}>{w.days} 天内</Typography.Text>
                  </Col>
                  <Col span={17}>
                    <Progress
                      percent={riskTotal ? Math.round((w.amount / riskTotal) * 100) : 0}
                      size="small"
                      format={() => fmtCredit(w.amount)}
                      strokeColor={w.days <= 3 ? '#d4574e' : w.days <= 7 ? '#d9930d' : '#2E9BFF'}
                    />
                  </Col>
                  <Col span={3} style={{ textAlign: 'right' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }} className="num">
                      {fmtInt(w.packages)} 包
                    </Typography.Text>
                  </Col>
                </Row>
              </div>
            ))}
            {riskTotal > 0 && summary && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                风险占比 {Math.round(summary.at_risk_ratio * 100)}%（7 天内到期 / 总额）
              </Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" style={{ height: '100%' }} title="账号调度策略">
            {policy && data?.routing_policy && (
              <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                <Row align="middle" gutter={8}>
                  <Col span={6}>
                    <Typography.Text>选号模式</Typography.Text>
                  </Col>
                  <Col span={18}>
                    <Select
                      style={{ width: '100%' }}
                      value={policy.mode}
                      onChange={(v) => setPolicy((p) => (p ? { ...p, mode: v } : p))}
                      options={(data.routing_policy.modes ?? []).map((m) => ({ value: m.value, label: m.label }))}
                    />
                  </Col>
                </Row>
                <Row align="middle" gutter={8}>
                  <Col span={6}>
                    <Typography.Text>同账号启动间隔</Typography.Text>
                  </Col>
                  <Col span={18}>
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      step={100}
                      suffix="ms"
                      value={policy.interval}
                      onChange={(v) => setPolicy((p) => (p ? { ...p, interval: Number(v ?? 0) } : p))}
                    />
                  </Col>
                </Row>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {data.routing_policy.modes.find((m) => m.value === policy.mode)?.description}
                </Typography.Text>
                <Button type="primary" onClick={() => void savePolicy()}>
                  保存策略
                </Button>
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" style={{ height: '100%' }} title="账号到期排行" extra={
        data?.selection_mode === 'manual' ? (
          <Button size="small" onClick={() => void resetOrder()}>
            恢复自动排序
          </Button>
        ) : (
          <Tag color="processing">自动排序</Tag>
        )
      }>
        <Table
          size="small"
          rowKey="account_id"
          loading={loading}
          dataSource={data?.accounts ?? []}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '账号', dataIndex: 'account_name', ellipsis: true, render: (v, r) => (
              <Space size={4}>
                <Typography.Text strong>{v}</Typography.Text>
                {r.status !== 'active' && <Tag>已停用</Tag>}
                {r.expiring_soon && <Tag color="warning">临期</Tag>}
              </Space>
            ) },
            { title: '剩余', dataIndex: 'total_remaining', width: 100, align: 'right', render: (v, r) => <span className="num">{fmtCredit(v)} / {fmtCredit(r.total_capacity)}</span> },
            { title: '临期', dataIndex: 'expiring_soon_remaining', width: 90, align: 'right', render: (v) => <span className="num" style={{ color: v > 0 ? '#d9930d' : undefined }}>{fmtCredit(v)}</span> },
            { title: '长期', dataIndex: 'evergreen_remaining', width: 90, align: 'right', render: (v) => <span className="num">{fmtCredit(v)}</span> },
            { title: '最近到期', dataIndex: 'soonest_label', width: 110, render: (v) => v || FMT_EMPTY },
            { title: '包数', dataIndex: 'active_package_count', width: 70, align: 'right', render: (v, r) => <span className="num">{fmtInt(v)}/{fmtInt(r.package_count)}</span> },
            { title: '优先级', dataIndex: 'selection_priority', width: 70, align: 'right', render: (v) => (v !== null ? <span className="num">{fmtInt(v)}</span> : FMT_EMPTY) },
            {
              title: '排序',
              width: 90,
              render: (_, r) =>
                data?.selection_mode === 'manual' ? (
                  <Space size={0}>
                    <Button type="text" size="small" icon={<ArrowUpOutlined />} onClick={() => void moveAccount(r.account_id, -1)} />
                    <Button type="text" size="small" icon={<ArrowDownOutlined />} onClick={() => void moveAccount(r.account_id, 1)} />
                  </Space>
                ) : (
                  FMT_EMPTY
                ),
            },
          ]}
          expandable={{
            expandedRowRender: (r: CreditAccount) => (
              <Space wrap size={4}>
                {(r as unknown as { next_expiring?: NextExpiring[] }).next_expiring?.map((p, i) => (
                  <Tooltip key={i} title={`${p.display_name}（${p.package_code}）`}>
                    <Tag color={p.expired ? 'error' : p.expiring_soon ? 'warning' : 'default'}>
                      {p.display_name}：{fmtCreditExact(p.remaining)}{p.expire_label ? ` · ${p.expire_label}` : ''}
                    </Tag>
                  </Tooltip>
                ))}
              </Space>
            ),
          }}
        />
      </Card>

      <Row gutter={[12, 12]} align="stretch">
        <Col xs={24} xl={12}>
          <Card size="small" style={{ height: '100%' }} title="最近快到期的积分包">
            <div style={{ maxHeight: 320, overflow: 'auto' }} onScroll={(e) => {
              const el = e.currentTarget
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) void loadMorePackages()
            }}>
              <Table
                size="small"
                rowKey={(r, i) => `${r.account_id}-${r.package_code}-${i}`}
                dataSource={packages}
                pagination={false}
                loading={pkgLoading}
                columns={[
                  { title: '账号', dataIndex: 'account_name', ellipsis: true },
                  { title: '积分包', dataIndex: 'display_name', ellipsis: true },
                  { title: '剩余', dataIndex: 'remaining', width: 90, align: 'right', render: (v) => <span className="num">{fmtCreditExact(v)}</span> },
                  { title: '到期', dataIndex: 'expire_label', width: 110, render: (v, r) => <Tag color={r.expired ? 'error' : r.expiring_soon ? 'warning' : 'default'}>{v || FMT_EMPTY}</Tag> },
                ]}
              />
              {hasMore && (
                <Button block type="text" loading={pkgLoading} onClick={() => void loadMorePackages()}>
                  加载更多
                </Button>
              )}
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" style={{ height: '100%' }} title={`账号消耗构成（近 ${usage?.range_days ?? 7} 天）`}>
            <Table
              size="small"
              rowKey="account_id"
              dataSource={usage?.accounts ?? []}
              pagination={false}
              columns={[
                { title: '账号', dataIndex: 'account_name', ellipsis: true },
                { title: '请求', dataIndex: 'requests', width: 70, align: 'right', render: (v) => <span className="num">{fmtInt(v)}</span> },
                { title: '消耗', dataIndex: 'credits', width: 90, align: 'right', render: (v) => <span className="num">{fmtCreditExact(v)}</span> },
                { title: '剩余', dataIndex: 'remaining', width: 90, align: 'right', render: (v) => <span className="num">{fmtCredit(v)}</span> },
              ]}
            />
            <Typography.Title level={5} style={{ marginTop: 12 }}>
              模型消耗（合计 {fmtCreditExact(usage?.total_credits)}）
            </Typography.Title>
            <Table
              size="small"
              rowKey="model"
              dataSource={usage?.models ?? []}
              pagination={false}
              columns={[
                { title: '模型', dataIndex: 'model', ellipsis: true },
                { title: '请求', dataIndex: 'requests', width: 70, align: 'right', render: (v) => <span className="num">{fmtInt(v)}</span> },
                { title: '积分', dataIndex: 'credits', width: 90, align: 'right', render: (v) => <span className="num">{fmtCreditExact(v)}</span> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
