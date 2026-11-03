import { App as AntdApp, Button, Card, Col, DatePicker, Row, Segmented, Select, Space, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { usePlatform } from '../context/PlatformContext'
import PageHeader from '../components/PageHeader'
import StatCards from '../components/StatCard'
import { DonutChart, TrendChart, type SliceDatum, type TrendPoint } from '../components/charts'
import { fmtCreditExact, fmtDuration, fmtInt, fmtK } from '../utils/format'
import type { Dayjs } from 'dayjs'

const { RangePicker } = DatePicker

interface UsageOptions {
  models: { value: string; label: string; requests: number }[]
  use_cases: string[]
  keys: { id: number; name: string }[]
  accounts: { id: number; name: string }[]
  platforms: { value: string; label: string; requests: number }[]
}

interface ByItem {
  label: string
  requests: number
  tokens?: number
  credits?: number
  account_id?: number
}

interface UsageData {
  overview: { requests: number; ok_requests: number; failed_requests: number; credits: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens: number; avg_latency_ms: number }
  by_model: (ByItem & { model: string; platform_label?: string })[]
  by_key: ByItem[]
  by_endpoint: ByItem[]
  by_account: ByItem[]
  by_result: { label: string; requests: number }[]
  platforms: { value: string; label: string; requests: number; tokens: number; credits: number }[]
  account_models: { model: string; requests: number; successes: number; failures: number; tokens: number; credits: number }[]
  trend: { bucket: string; prompt_tokens: number; completion_tokens: number; requests: number }[]
  platform_label?: string
}

const DAYS_OPTIONS = [
  { label: '今日', value: 1 },
  { label: '3 天', value: 3 },
  { label: '7 天', value: 7 },
  { label: '14 天', value: 14 },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
]

export default function UsagePage() {
  const { message } = AntdApp.useApp()
  const { platformKey } = usePlatform()
  const [opts, setOpts] = useState<UsageOptions | null>(null)
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(7)
  const [granularity, setGranularity] = useState<'hour' | 'day'>('hour')
  const [platform, setPlatform] = useState<string | undefined>()
  const [keyId, setKeyId] = useState<number | undefined>()
  const [model, setModel] = useState<string | undefined>()
  const [accountId, setAccountId] = useState<number | undefined>()
  const [useCase, setUseCase] = useState<string | undefined>()
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  const loadOptions = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ days: String(days) })
      if (platform) qs.set('platform', platform)
      setOpts(await api<UsageOptions>(`/api/stats/usage/options?${qs.toString()}`))
    } catch {
      /* 选项失败不阻塞 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, platform, platformKey])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ granularity })
      if (range?.[0]) qs.set('start', range[0].format('YYYY-MM-DD'))
      else qs.set('days', String(days))
      if (range?.[1]) qs.set('end', range[1].format('YYYY-MM-DD'))
      if (platform) qs.set('platform', platform)
      if (keyId) qs.set('key_id', String(keyId))
      if (model) qs.set('model', model)
      if (accountId) qs.set('account_id', String(accountId))
      if (useCase) qs.set('use_case', useCase)
      setData(await api<UsageData>(`/api/stats/usage?${qs.toString()}`))
    } catch (e) {
      message.error((e as Error).message || '用量数据加载失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, granularity, platform, keyId, model, accountId, useCase, range, platformKey])

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])
  useEffect(() => {
    void load()
  }, [load])

  const clearFilters = () => {
    setPlatform(undefined)
    setKeyId(undefined)
    setModel(undefined)
    setAccountId(undefined)
    setUseCase(undefined)
    setRange(null)
    setDays(7)
  }

  const toSlices = (items: ByItem[] | undefined): SliceDatum[] =>
    (items ?? []).slice(0, 12).map((i) => ({ type: i.label, value: i.requests }))

  const trendData: TrendPoint[] = (data?.trend ?? []).map((t) => ({
    time: t.bucket,
    input: t.prompt_tokens,
    output: t.completion_tokens,
  }))

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="使用记录"
        description={data?.platform_label ? `口径：${data.platform_label}` : undefined}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <Card size="small" style={{ height: '100%' }}>
        <Space wrap size={12}>
          <Segmented value={days} onChange={(v) => { setDays(v as number); setRange(null) }} options={DAYS_OPTIONS} />
          <RangePicker value={range} onChange={(v) => setRange(v as [Dayjs | null, Dayjs | null] | null)} />
          <Segmented value={granularity} onChange={(v) => setGranularity(v as 'hour' | 'day')} options={[{ label: '按小时', value: 'hour' }, { label: '按天', value: 'day' }]} />
          <Select allowClear placeholder="平台" style={{ minWidth: 120 }} value={platform} onChange={setPlatform} options={(opts?.platforms ?? []).map((p) => ({ value: p.value, label: `${p.label}（${p.requests}）` }))} />
          <Select allowClear showSearch={{ optionFilterProp: 'label' }} placeholder="Key" style={{ minWidth: 140 }} value={keyId} onChange={setKeyId} options={(opts?.keys ?? []).map((k) => ({ value: k.id, label: k.name }))} />
          <Select allowClear showSearch={{ optionFilterProp: 'label' }} placeholder="模型" style={{ minWidth: 160 }} value={model} onChange={setModel} options={(opts?.models ?? []).map((m) => ({ value: m.value, label: m.label }))} />
          <Select allowClear showSearch={{ optionFilterProp: 'label' }} placeholder="账号" style={{ minWidth: 140 }} value={accountId} onChange={setAccountId} options={(opts?.accounts ?? []).map((a) => ({ value: a.id, label: a.name }))} />
          <Select allowClear placeholder="用途" style={{ minWidth: 120 }} value={useCase} onChange={setUseCase} options={(opts?.use_cases ?? []).map((u) => ({ value: u, label: u }))} />
          <Button onClick={clearFilters}>清除筛选</Button>
        </Space>
        {(data?.platforms ?? []).length > 1 && (
          <Space wrap size={4} style={{ marginTop: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>平台分布：</Typography.Text>
            {(data?.platforms ?? []).map((p) => (
              <Tag
                key={p.value}
                color={platform === p.value ? 'processing' : 'default'}
                style={{ cursor: 'pointer' }}
                onClick={() => setPlatform(platform === p.value ? undefined : p.value)}
              >
                {p.label} {fmtK(p.requests)}
              </Tag>
            ))}
          </Space>
        )}
      </Card>

      <StatCards
        items={[
          { title: '请求', value: fmtInt(data?.overview.requests), hint: `成功 ${fmtInt(data?.overview.ok_requests)} · 失败 ${fmtInt(data?.overview.failed_requests)}` },
          { title: '消耗积分', value: fmtCreditExact(data?.overview.credits) },
          { title: 'Tokens', value: fmtK(data?.overview.total_tokens), hint: `输入 ${fmtK(data?.overview.prompt_tokens)} · 输出 ${fmtK(data?.overview.completion_tokens)}` },
          { title: '平均耗时', value: fmtDuration(data?.overview.avg_latency_ms), hint: `缓存命中 ${fmtK(data?.overview.cached_tokens)}` },
        ]}
      />

      <Card size="small" style={{ height: '100%' }} title="Token 趋势">
        <TrendChart data={trendData} loading={loading} height={280} />
      </Card>

      <Row gutter={[12, 12]} align="stretch">
        <Col xs={24} md={12} xl={8}>
          <Card size="small" style={{ height: '100%' }} title="模型分布">
            <DonutChart data={toSlices(data?.by_model)} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={8}>
          <Card size="small" style={{ height: '100%' }} title="Key 分布">
            <DonutChart data={toSlices(data?.by_key)} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={8}>
          <Card size="small" style={{ height: '100%' }} title="端点分布">
            <DonutChart data={toSlices(data?.by_endpoint)} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={8}>
          <Card size="small" style={{ height: '100%' }} title="账号分布">
            <DonutChart data={toSlices(data?.by_account)} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={8}>
          <Card size="small" style={{ height: '100%' }} title="请求结果分布">
            <DonutChart data={toSlices(data?.by_result)} loading={loading} />
          </Card>
        </Col>
        {accountId && (
          <Col xs={24} md={12} xl={8}>
            <Card size="small" style={{ height: '100%' }} title="所选账号 · 模型用量与限额">
              <Table
                size="small"
                rowKey="model"
                loading={loading}
                dataSource={data?.account_models ?? []}
                pagination={false}
                columns={[
                  { title: '模型', dataIndex: 'model', ellipsis: true },
                  { title: '请求', dataIndex: 'requests', width: 70, align: 'right', render: (v) => <span className="num">{fmtInt(v)}</span> },
                  { title: '失败', dataIndex: 'failures', width: 60, align: 'right', render: (v) => <span className="num">{fmtInt(v)}</span> },
                  { title: 'Tokens', dataIndex: 'tokens', width: 90, align: 'right', render: (v) => <span className="num">{fmtK(v)}</span> },
                  { title: '积分', dataIndex: 'credits', width: 80, align: 'right', render: (v) => <span className="num">{fmtCreditExact(v)}</span> },
                ]}
              />
            </Card>
          </Col>
        )}
      </Row>
    </Space>
  )
}
