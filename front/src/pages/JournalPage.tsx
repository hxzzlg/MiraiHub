import { App as AntdApp, Card, DatePicker, Segmented, Select, Space, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { usePlatform } from '../context/PlatformContext'
import PageHeader from '../components/PageHeader'
import { FMT_EMPTY, fmtCreditExact } from '../utils/format'
import dayjs, { type Dayjs } from 'dayjs'

const { RangePicker } = DatePicker

interface CreditEvent {
  id: number
  account_id: number
  account_name: string
  kind: 'confirmed' | 'observed'
  source: string
  delta: number
  balance_after: number | null
  created_at: string
}

interface CreditEventsResp {
  items: CreditEvent[]
  total: number
  page: number
  page_size: number
  importing: boolean
  sources: string[]
  accounts: { id: number; name: string }[]
}

export default function JournalPage() {
  const { message } = AntdApp.useApp()
  const { platformKey } = usePlatform()
  const [data, setData] = useState<CreditEventsResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [accountId, setAccountId] = useState<number | undefined>()
  const [source, setSource] = useState<string | undefined>()
  const [kind, setKind] = useState<'' | 'confirmed' | 'observed'>('')
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ page: String(page), page_size: '50' })
      if (accountId) qs.set('account_id', String(accountId))
      if (source) qs.set('source', source)
      if (kind) qs.set('kind', kind)
      if (range?.[0]) qs.set('start', range[0].format('YYYY-MM-DD'))
      if (range?.[1]) qs.set('end', range[1].format('YYYY-MM-DD'))
      const r = await api<CreditEventsResp>(`/api/maintenance/credit-events?${qs.toString()}`)
      setData(r)
    } catch (e) {
      message.error((e as Error).message || '积分流水加载失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, accountId, source, kind, range, platformKey])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="积分流水"
        description="确认奖励与余额观察记录"
        onRefresh={() => void load()}
        refreshing={loading}
      />
      <Card size="small">
        <Space wrap size={12}>
          <Segmented
            value={kind}
            onChange={(v) => {
              setKind(v as typeof kind)
              setPage(1)
            }}
            options={[
              { label: '全部', value: '' },
              { label: '确认奖励', value: 'confirmed' },
              { label: '余额观察', value: 'observed' },
            ]}
          />
          <Select
            allowClear
            showSearch={{ optionFilterProp: 'label' }}
            placeholder="账号"
            style={{ minWidth: 180 }}
            value={accountId}
            onChange={(v) => {
              setAccountId(v)
              setPage(1)
            }}
            options={(data?.accounts ?? []).map((a) => ({ value: a.id, label: a.name }))}
          />
          <Select
            allowClear
            placeholder="来源"
            style={{ minWidth: 150 }}
            value={source}
            onChange={(v) => {
              setSource(v)
              setPage(1)
            }}
            options={(data?.sources ?? []).map((s) => ({ value: s, label: s }))}
          />
          <RangePicker
            value={range}
            onChange={(v) => {
              setRange(v as [Dayjs | null, Dayjs | null] | null)
              setPage(1)
            }}
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
          />
        </Space>
      </Card>
      <Card size="small">
        {data?.importing && (
          <Typography.Text type="warning" style={{ display: 'block', marginBottom: 8 }}>
            正在导入历史流水，数据可能不完整…
          </Typography.Text>
        )}
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={data?.items ?? []}
          pagination={{
            current: page,
            pageSize: 50,
            total: data?.total ?? 0,
            showSizeChanger: false,
            onChange: (p) => setPage(p),
            showTotal: (t) => `共 ${t} 条`,
          }}
          columns={[
            { title: '时间', dataIndex: 'created_at', width: 150, render: (v: string) => <span className="num">{v ? v.slice(0, 16).replace('T', ' ') : FMT_EMPTY}</span> },
            { title: '账号', dataIndex: 'account_name', ellipsis: true },
            {
              title: '类型',
              dataIndex: 'kind',
              width: 100,
              render: (v: string) => (v === 'confirmed' ? <Tag color="success">确认奖励</Tag> : <Tag color="processing">余额观察</Tag>),
            },
            { title: '来源', dataIndex: 'source', width: 140, ellipsis: true },
            {
              title: '积分变化',
              dataIndex: 'delta',
              width: 110,
              align: 'right',
              render: (v: number) => (
                <span className="num" style={{ color: v >= 0 ? '#3f8c5a' : '#d4574e' }}>
                  {v >= 0 ? '+' : ''}
                  {fmtCreditExact(v)}
                </span>
              ),
            },
            { title: '观察余额', dataIndex: 'balance_after', width: 110, align: 'right', render: (v) => <span className="num">{v !== null ? fmtCreditExact(v) : FMT_EMPTY}</span> },
          ]}
        />
      </Card>
    </Space>
  )
}
