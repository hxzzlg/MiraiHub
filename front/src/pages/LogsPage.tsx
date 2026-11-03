import { App as AntdApp, Button, Card, Checkbox, Col, Collapse, DatePicker, Input, Modal, Row, Segmented, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd'
import { DownloadOutlined, FileTextOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fetchSseTicket } from '../api/client'
import { usePlatform } from '../context/PlatformContext'
import PageHeader from '../components/PageHeader'
import { FMT_EMPTY, fmtCreditExact, fmtDuration, fmtInt, fmtK, fmtTime, fmtTimeFull } from '../utils/format'
import { downloadResponse } from '../utils/download'
import dayjs, { type Dayjs } from 'dayjs'

const { RangePicker } = DatePicker

interface LogRow {
  id: number
  key_name: string
  account_name: string
  platform: string
  model: string
  credits: number
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cached_tokens: number | null
  client_ip: string
  use_case: string
  ttfb_ms: number | null
  latency_ms: number | null
  error_kind: string
  created_at: string
}

interface LogListResp {
  items: LogRow[]
  total: number | null
  page: number
  page_size: number
  has_more: boolean
}

interface LiveRow {
  rid?: string
  ts: number
  platform?: string
  outcome?: string
  status?: number
  elapsed_ms?: number
  model?: string
  path?: string
  key_label?: string
  client_ip?: string
  stage?: string
  phase?: string
}

interface CaptureSettings {
  enabled: boolean
  cached_requests?: number
  cache_bytes?: number
  max_entries?: number
  record_max_bytes?: number
}

const STAGE_LABELS: Record<string, string> = {
  received: '已接收',
  waiting: '排队选号',
  upstream: '转发上游',
  streaming: '回传中',
  done: '已完成',
}

export default function LogsPage() {
  const { message } = AntdApp.useApp()
  const [searchParams] = useSearchParams()
  const { platformKey } = usePlatform()
  const [data, setData] = useState<LogListResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [quickMode, setQuickMode] = useState(false)
  const [days, setDays] = useState(7)
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [platform, setPlatform] = useState<string | undefined>()
  const [account, setAccount] = useState<string | undefined>()
  const [accountOpts, setAccountOpts] = useState<{ id: number; name: string }[]>([])
  const [model, setModel] = useState('')
  const [keyName, setKeyName] = useState('')
  const [ip, setIp] = useState(searchParams.get('ip') ?? '')
  const [result, setResult] = useState<'ok' | 'error' | ''>('')
  const [liveRows, setLiveRows] = useState<LiveRow[]>([])
  const [running, setRunning] = useState(0)
  const [capture, setCapture] = useState<CaptureSettings | null>(null)
  const [detailRow, setDetailRow] = useState<LogRow | null>(null)
  const revisionRef = useRef<number | null>(null)

  const queryStr = useCallback(() => {
    const qs = new URLSearchParams()
    if (range?.[0]) qs.set('start', range[0].format('YYYY-MM-DD'))
    else qs.set('days', String(days))
    if (range?.[1]) qs.set('end', range[1].format('YYYY-MM-DD'))
    if (platform) qs.set('platform', platform)
    if (account) qs.set('account_id', account)
    if (model.trim()) qs.set('model', model.trim())
    if (keyName.trim()) qs.set('key', keyName.trim())
    if (ip.trim()) qs.set('ip', ip.trim())
    if (result) qs.set('result', result)
    return qs
  }, [days, range, platform, account, model, keyName, ip, result])

  const load = useCallback(
    async (keepPage = true) => {
      setLoading(true)
      try {
        const qs = queryStr()
        qs.set('page_size', '50')
        if (keepPage && page > 1) qs.set('page', String(page))
        else qs.set('page', '1')
        if (quickMode) {
          qs.set('with_total', 'false')
          qs.set('limit', '50')
        }
        const r = await api<LogListResp>(`/api/logs?${qs.toString()}`)
        setData(r)
        if (!keepPage) setPage(1)
      } catch (e) {
        message.error((e as Error).message || '日志加载失败')
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryStr, page, quickMode],
  )

  useEffect(() => {
    void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryStr])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, quickMode])

  useEffect(() => {
    void api<{ range_days: number; items: { id: number; name: string }[] }>('/api/logs/accounts?days=7&compact=true')
      .then((r) => setAccountOpts(r.items ?? []))
      .catch(() => {})
    void api<CaptureSettings>('/api/logs/capture/settings')
      .then(setCapture)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformKey])

  /* ---------- SSE：请求动态（哨兵流量流） ---------- */
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = new EventSource('/api/sentinel/traffic/stream?window=3600')
    const merge = (rows: LiveRow[]) => {
      setLiveRows((prev) => {
        const map = new Map(prev.map((r) => [r.rid ?? `${r.ts}-${r.model}`, r]))
        for (const r of rows) map.set(r.rid ?? `${r.ts}-${r.model}`, r)
        return [...map.values()].sort((a, b) => b.ts - a.ts).slice(0, 12)
      })
    }
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data) as { type: string; recent?: LiveRow[]; changed?: LiveRow[]; running?: number }
        setRunning(d.running ?? 0)
        if (d.type === 'snapshot' && d.recent) merge(d.recent)
        if (d.type === 'delta' && d.changed) merge(d.changed)
      } catch {
        /* 忽略坏帧 */
      }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [])

  /* ---------- SSE：用量日志 revision（ticket 两步握手） ---------- */
  useEffect(() => {
    let es: EventSource | null = null
    let closed = false
    let retryTimer = 0

    const connect = async () => {
      try {
        const url = await fetchSseTicket('/api/logs/requests/ticket', '/api/logs/usage/stream')
        if (closed) return
        es = new EventSource(url)
        es.addEventListener('usage', (ev) => {
          try {
            const d = JSON.parse((ev as MessageEvent).data) as { usage_revision: number }
            if (d.usage_revision !== revisionRef.current) {
              revisionRef.current = d.usage_revision
              void load()
            }
          } catch {
            /* ignore */
          }
        })
        es.addEventListener('reauth', () => {
          es?.close()
          if (!closed) void connect()
        })
        es.onerror = () => {
          es?.close()
          if (!closed) retryTimer = window.setTimeout(() => void connect(), 15000)
        }
      } catch {
        if (!closed) retryTimer = window.setTimeout(() => void connect(), 15000)
      }
    }
    void connect()
    return () => {
      closed = true
      window.clearTimeout(retryTimer)
      es?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setCaptureEnabled = async (enabled: boolean) => {
    try {
      const r = await api<CaptureSettings>('/api/logs/capture/settings', { method: 'PUT', body: { enabled } })
      setCapture(r)
      message.success(enabled ? '已开启请求正文记录' : '已关闭请求正文记录')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const clearCaptureCache = async () => {
    try {
      await api('/api/logs/capture/cache', { method: 'DELETE' })
      message.success('正文缓存已清空')
      void api<CaptureSettings>('/api/logs/capture/settings').then(setCapture)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const exportCsv = async (diagnostics: boolean) => {
    try {
      const qs = queryStr()
      if (diagnostics) qs.set('diagnostics', 'true')
      const resp = await api<Response>(`/api/logs/export?${qs.toString()}`, { raw: true })
      await downloadResponse(resp, diagnostics ? 'wb2api-diagnostics.jsonl' : 'usage_logs.csv')
      message.success('已开始下载')
    } catch (e) {
      message.error((e as Error).message || '导出失败')
    }
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="用量日志"
        description={running ? `${running} 个请求在途` : '请求动态与全量调用日志'}
        actions={
          <Space wrap>
            <Space size={4}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>记录正文：</Typography.Text>
              <Switch size="small" checked={capture?.enabled ?? false} onChange={(v) => void setCaptureEnabled(v)} />
            </Space>
            <Button icon={<DownloadOutlined />} onClick={() => void exportCsv(false)}>
              导出 CSV
            </Button>
            <Button icon={<FileTextOutlined />} onClick={() => void exportCsv(true)}>
              导出诊断
            </Button>
          </Space>
        }
      />

      {/* 请求动态 */}
      <Card
        size="small"
        title={
          <Space>
            请求动态
            {running > 0 && <Tag color="processing">{running} 在途</Tag>}
            <Tag color="success">实时</Tag>
          </Space>
        }
        extra={
          capture && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              正文缓存 {fmtInt(capture.cached_requests)} 条
              <Button type="link" size="small" onClick={() => void clearCaptureCache()}>
                清空
              </Button>
            </Typography.Text>
          )
        }
      >
        {(liveRows.length ?? 0) === 0 && <Typography.Text type="secondary">暂无近期请求，发起一次调用后这里会实时出现。</Typography.Text>}
        {liveRows.map((r) => (
          <Row key={r.rid ?? `${r.ts}-${r.model}`} gutter={8} align="middle" style={{ marginBottom: 4 }}>
            <Col flex="none">
              <Tag color={r.outcome === 'ok' || r.status === 200 ? 'success' : r.status && r.status >= 400 ? 'error' : 'processing'}>
                {STAGE_LABELS[r.stage ?? r.phase ?? ''] ?? r.stage ?? r.status ?? '…'}
              </Tag>
            </Col>
            <Col flex="auto" style={{ minWidth: 0 }}>
              <Typography.Text ellipsis style={{ fontSize: 12.5 }}>
                {r.model || r.path || FMT_EMPTY}
                <Typography.Text type="secondary" style={{ fontSize: 11 }}> · {r.key_label || FMT_EMPTY} · {r.platform || ''}</Typography.Text>
              </Typography.Text>
            </Col>
            <Col flex="none">
              <Typography.Text type="secondary" style={{ fontSize: 12 }} className="num">
                {r.elapsed_ms ? fmtDuration(r.elapsed_ms) : '…'} · {dayjs(r.ts * 1000).format('MM-DD HH:mm:ss')}
              </Typography.Text>
            </Col>
          </Row>
        ))}
      </Card>

      {/* 筛选 */}
      <Card size="small">
        <Space wrap size={12}>
          <Segmented value={days} onChange={(v) => { setDays(v as number); setRange(null); setPage(1) }} options={[{ label: '今日', value: 1 }, { label: '3 天', value: 3 }, { label: '7 天', value: 7 }, { label: '30 天', value: 30 }]} />
          <RangePicker value={range} onChange={(v) => { setRange(v as [Dayjs | null, Dayjs | null] | null); setPage(1) }} />
          <Select allowClear placeholder="平台" style={{ minWidth: 110 }} value={platform} onChange={(v) => { setPlatform(v); setPage(1) }} options={[{ value: 'workbuddy', label: 'WorkBuddy' }, { value: 'trae', label: 'Trae' }, { value: 'qoder', label: 'Qoder' }, { value: 'loomy', label: 'Loomy' }]} />
          <Select allowClear showSearch={{ optionFilterProp: 'label' }} placeholder="账号" style={{ minWidth: 150 }} value={account} onChange={(v) => { setAccount(v !== undefined ? String(v) : undefined); setPage(1) }} options={accountOpts.map((a) => ({ value: a.id, label: a.name }))} />
          <Input allowClear placeholder="模型" style={{ width: 150 }} value={model} onChange={(e) => { setModel(e.target.value); setPage(1) }} />
          <Input allowClear placeholder="Key 名称" style={{ width: 130 }} value={keyName} onChange={(e) => { setKeyName(e.target.value); setPage(1) }} />
          <Input allowClear placeholder="IP" style={{ width: 130 }} value={ip} onChange={(e) => { setIp(e.target.value); setPage(1) }} />
          <Segmented value={result} onChange={(v) => { setResult(v as typeof result); setPage(1) }} options={[{ label: '全部', value: '' }, { label: '成功', value: 'ok' }, { label: '失败', value: 'error' }]} />
          <Checkbox checked={quickMode} onChange={(e) => { setQuickMode(e.target.checked); setPage(1) }}>
            快速翻页
          </Checkbox>
        </Space>
      </Card>

      <Collapse
        items={[
          {
            key: 'summary',
            label: '按账号汇总',
            children: <SummaryTable query={queryStr()} />,
          },
        ]}
      />

      {/* 日志表 */}
      <Card size="small">
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={data?.items ?? []}
          pagination={{
            current: page,
            pageSize: 50,
            total: data?.total ?? (data?.has_more ? page * 50 + 1 : page * 50),
            showSizeChanger: false,
            onChange: (p) => setPage(p),
          }}
          onRow={(r) => ({ onClick: () => setDetailRow(r), style: { cursor: 'pointer' } })}
          columns={[
            { title: '时间', dataIndex: 'created_at', width: 130, render: (v) => <span className="num">{fmtTime(v, true)}</span> },
            { title: 'IP', dataIndex: 'client_ip', width: 120, render: (v) => <Typography.Text code style={{ fontSize: 12 }}>{v || FMT_EMPTY}</Typography.Text> },
            { title: 'Key', dataIndex: 'key_name', width: 130, ellipsis: true },
            { title: '平台', dataIndex: 'platform', width: 90 },
            { title: '账号', dataIndex: 'account_name', width: 140, ellipsis: true, render: (v) => v || FMT_EMPTY },
            { title: '模型', dataIndex: 'model', ellipsis: true },
            {
              title: 'Tokens',
              width: 120,
              align: 'right',
              render: (_, r: LogRow) => (
                <Tooltip title={`输入 ${fmtK(r.prompt_tokens)} · 输出 ${fmtK(r.completion_tokens)} · 缓存 ${fmtK(r.cached_tokens)}`}>
                  <span className="num">{fmtK(r.total_tokens)}</span>
                </Tooltip>
              ),
            },
            {
              title: '命中率',
              width: 80,
              align: 'right',
              render: (_, r: LogRow) =>
                r.prompt_tokens ? <span className="num">{Math.round(((r.cached_tokens ?? 0) / r.prompt_tokens) * 100)}%</span> : FMT_EMPTY,
            },
            { title: '积分', dataIndex: 'credits', width: 90, align: 'right', render: (v) => <span className="num">{fmtCreditExact(v)}</span> },
            {
              title: '耗时',
              width: 130,
              render: (_, r: LogRow) => (
                <span className="num" style={{ fontSize: 12 }}>
                  {r.ttfb_ms !== null ? `首字 ${fmtDuration(r.ttfb_ms)}` : FMT_EMPTY}
                  <br />
                  总 {fmtDuration(r.latency_ms)}
                </span>
              ),
            },
            { title: '用途', dataIndex: 'use_case', width: 90, render: (v) => v || FMT_EMPTY },
            {
              title: '结果',
              dataIndex: 'error_kind',
              width: 100,
              render: (v: string) => (v ? <Tag color="error">{v}</Tag> : <Tag color="success">成功</Tag>),
            },
          ]}
        />
      </Card>

      <LogDetailModal row={detailRow} onClose={() => setDetailRow(null)} captureEnabled={capture?.enabled ?? false} />
    </Space>
  )
}

/** 按账号汇总 */
function SummaryTable({ query }: { query: URLSearchParams }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setLoading(true)
    api<{ items: Record<string, unknown>[] }>(`/api/logs/summary?${query.toString()}`)
      .then((r) => setRows(r.items ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.toString()])
  return (
    <Table
      size="small"
      rowKey={(r) => String(r.account_id)}
      loading={loading}
      dataSource={rows}
      pagination={false}
      columns={[
        { title: '账号', dataIndex: 'account_name', ellipsis: true },
        { title: '请求', dataIndex: 'requests', width: 90, align: 'right', render: (v) => <span className="num">{fmtInt(v)}</span> },
        { title: '失败', dataIndex: 'failed_requests', width: 80, align: 'right', render: (v) => <span className="num">{fmtInt(v)}</span> },
        { title: '积分', dataIndex: 'credits', width: 90, align: 'right', render: (v) => <span className="num">{fmtCreditExact(v)}</span> },
        { title: 'Tokens', dataIndex: 'total_tokens', width: 100, align: 'right', render: (v) => <span className="num">{fmtK(v)}</span> },
        { title: '平均耗时', dataIndex: 'avg_latency_ms', width: 100, align: 'right', render: (v) => <span className="num">{fmtDuration(v)}</span> },
        { title: '最近使用', dataIndex: 'last_used_at', width: 130, render: (v) => <span className="num">{fmtTime(v)}</span> },
      ]}
    />
  )
}

/** 调用详情弹窗（诊断 JSON + 正文按需读取 + 下载） */
function LogDetailModal({ row, onClose, captureEnabled }: { row: LogRow | null; onClose: () => void; captureEnabled: boolean }) {
  const { message } = AntdApp.useApp()
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [bodyTab, setBodyTab] = useState<'ingress' | number>('ingress')
  const [bodyText, setBodyText] = useState('')
  const [bodyLoading, setBodyLoading] = useState(false)
  const [bodyHasMore, setBodyHasMore] = useState(false)

  useEffect(() => {
    if (!row) {
      setDetail(null)
      setBodyText('')
      return
    }
    api<Record<string, unknown>>(`/api/logs/${row.id}`)
      .then(setDetail)
      .catch((e) => message.error((e as Error).message))
  }, [row, message])

  if (!row) return null

  const capture = (detail?.request_capture ?? null) as {
    ingress?: { body_bytes?: number }
    upstream?: { attempt: number; url?: string; http_status?: number; body_bytes?: number }[]
    upstream_omitted?: number
  } | null

  const loadBody = async (part: string, offset = 0) => {
    setBodyLoading(true)
    try {
      const r = await api<{ text: string; has_more: boolean }>(
        `/api/logs/${row.id}/capture/body?part=${encodeURIComponent(part)}&offset=${offset}&limit=65536`,
      )
      setBodyText((prev) => (offset === 0 ? r.text : prev + r.text))
      setBodyHasMore(r.has_more)
    } catch (e) {
      message.error((e as Error).message || '正文已过期或不可用')
    } finally {
      setBodyLoading(false)
    }
  }

  const downloadCapture = async () => {
    try {
      const resp = await api<Response>(`/api/logs/${row.id}/capture/download`, { raw: true })
      await downloadResponse(resp, `wb2api-usage-${row.id}.jsonl`)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const diag = detail?.diagnostic ?? null

  return (
    <Modal title={`调用详情 #${row.id}`} open onCancel={onClose} footer={null} width={860}>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Row gutter={8}>
          <Col span={8}><Typography.Text type="secondary" style={{ fontSize: 12 }}>时间</Typography.Text><div><span className="num">{fmtTimeFull(row.created_at)}</span></div></Col>
          <Col span={8}><Typography.Text type="secondary" style={{ fontSize: 12 }}>Key / 账号</Typography.Text><div>{row.key_name} / {row.account_name || FMT_EMPTY}</div></Col>
          <Col span={8}><Typography.Text type="secondary" style={{ fontSize: 12 }}>模型 / 平台</Typography.Text><div>{row.model} · {row.platform}</div></Col>
          <Col span={8}><Typography.Text type="secondary" style={{ fontSize: 12 }}>Tokens</Typography.Text><div className="num">{fmtK(row.total_tokens)}（输入 {fmtK(row.prompt_tokens)} / 输出 {fmtK(row.completion_tokens)}）</div></Col>
          <Col span={8}><Typography.Text type="secondary" style={{ fontSize: 12 }}>积分 / 耗时</Typography.Text><div className="num">{fmtCreditExact(row.credits)} · 总 {fmtDuration(row.latency_ms)}</div></Col>
          <Col span={8}><Typography.Text type="secondary" style={{ fontSize: 12 }}>结果</Typography.Text><div>{row.error_kind ? <Tag color="error">{row.error_kind}</Tag> : <Tag color="success">成功</Tag>}</div></Col>
        </Row>

        {/* 诊断 JSON */}
        <Collapse
          items={[
            {
              key: 'diag',
              label: '诊断详情（网关本地记录 / 上游证据 / 完整 JSON）',
              children: diag ? (
                <Typography.Paragraph code style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 320, overflow: 'auto', marginBottom: 0 }}>
                  {JSON.stringify(diag, null, 2)}
                </Typography.Paragraph>
              ) : (
                <Typography.Text type="secondary">无诊断记录</Typography.Text>
              ),
            },
          ]}
        />

        {/* 正文捕获 */}
        {captureEnabled && (
          <Collapse
            items={[
              ...(capture?.upstream ?? []).map((u) => ({
                key: `up-${u.attempt}`,
                label: `上游尝试 #${u.attempt}：HTTP ${u.http_status ?? '—'} · ${u.url || ''} · ${fmtInt(u.body_bytes)} B`,
                children: (
                  <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    <Button size="small" loading={bodyLoading} onClick={() => { setBodyTab(u.attempt); void loadBody(`upstream:${u.attempt}`) }}>
                      读取正文（64KiB/页）
                    </Button>
                    {bodyTab === u.attempt && bodyText && (
                      <>
                        <Typography.Paragraph code style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 300, overflow: 'auto', marginBottom: 0 }}>
                          {bodyText}
                        </Typography.Paragraph>
                        {bodyHasMore && (
                          <Button size="small" onClick={() => void loadBody(`upstream:${u.attempt}`, bodyText.length)}>
                            继续读取
                          </Button>
                        )}
                      </>
                    )}
                  </Space>
                ),
              })),
            ...(capture?.ingress?.body_bytes
              ? [
                  {
                    key: 'ingress',
                    label: `入口请求正文：${fmtInt(capture.ingress.body_bytes)} B`,
                    children: (
                      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                        <Button size="small" loading={bodyLoading} onClick={() => { setBodyTab('ingress'); void loadBody('ingress') }}>
                          读取正文
                        </Button>
                        {bodyTab === 'ingress' && bodyText && (
                          <Typography.Paragraph code style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 300, overflow: 'auto', marginBottom: 0 }}>
                            {bodyText}
                          </Typography.Paragraph>
                        )}
                      </Space>
                    ),
                  },
                ]
              : []),
            ]}
          />
        )}

        <Space>
          <Button
            size="small"
            onClick={() => {
              const text = `#${row.id} ${fmtTimeFull(row.created_at)} ${row.model} ${row.account_name || '-'} ${row.error_kind || 'ok'} ${fmtK(row.total_tokens)}tok ${fmtCreditExact(row.credits)}cr`
              void navigator.clipboard?.writeText(text)
              message.success('摘要已复制')
            }}
          >
            复制摘要
          </Button>
          {captureEnabled && (
            <Button size="small" onClick={() => void downloadCapture()}>
              下载诊断 JSONL
            </Button>
          )}
        </Space>
      </Space>
    </Modal>
  )
}
