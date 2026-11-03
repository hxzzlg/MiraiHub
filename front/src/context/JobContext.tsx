import { Flex, Listy, Modal, Progress, Typography } from 'antd'
import { App as AntdApp } from 'antd'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'

/**
 * 批量任务进度（对应旧版 runJob）：提交拿 job_id → 1.5s 轮询 /api/growth/job/{id} →
 * 弹窗可关闭且轮询不中断（关闭弹窗任务继续跑，完成后 toast）。
 */
export interface JobRunOptions {
  title: string
  submitUrl: string
  body?: unknown
  onFinish?: (summary: JobState) => void
}

export interface JobRow {
  key: string
  label: string
  ok?: boolean | null
  detail?: string
}

export interface JobState {
  status: string
  total?: number
  done?: number
  rows: JobRow[]
  raw?: Record<string, unknown>
}

interface JobCtx {
  run: (opts: JobRunOptions) => Promise<void>
  runningJob: boolean
}

const Ctx = createContext<JobCtx>({ run: async () => {}, runningJob: false })

interface JobPayload {
  status?: string
  total?: number
  done?: number
  items?: unknown[]
  accounts?: unknown[]
  logs?: unknown[]
  results?: unknown[]
  error?: string
  [k: string]: unknown
}

function rowFromItem(item: unknown, i: number): JobRow | null {
  if (item === null || item === undefined) return null
  if (typeof item === 'string') return { key: `s${i}`, label: item }
  if (typeof item === 'object') {
    const o = item as Record<string, unknown>
    const label = String(o.name ?? o.account ?? o.label ?? o.title ?? o.mobile ?? o.id ?? `条目 ${i + 1}`)
    const okRaw = o.ok ?? o.success ?? o.status
    const ok =
      typeof okRaw === 'boolean'
        ? okRaw
        : okRaw === 'ok' || okRaw === 'success' || okRaw === 'done'
          ? true
          : okRaw === 'failed' || okRaw === 'error'
            ? false
            : null
    let detail = String(o.message ?? o.detail ?? o.msg ?? o.error ?? '')
    // 健康检查 job：三段上游检查（积分 / 模型列表 / 真实对话）摘要
    if (o.stages && typeof o.stages === 'object') {
      const st = o.stages as Record<string, { ok?: boolean; status?: number; total?: number; remain?: number; count?: number; model?: string }>
      const parts = Object.entries(st).map(([k, v]) => {
        const nameMap: Record<string, string> = { balance: '积分', models: '模型列表', conversation: '真实对话' }
        const label = nameMap[k] ?? k
        const extra = k === 'balance' && v.total !== undefined ? ` 剩 ${v.remain ?? '—'}` : k === 'models' && v.count !== undefined ? ` ${v.count} 个` : k === 'conversation' && v.model ? ` ${v.model}` : ''
        return `${label}${v.ok === false ? '✗' : '✓'}${extra}`
      })
      detail = parts.join(' · ') || detail
    }
    return { key: `o${i}`, label, ok, detail: detail || undefined }
  }
  return null
}

export function JobProvider({ children }: { children: ReactNode }) {
  const { message } = AntdApp.useApp()
  const [opts, setOpts] = useState<JobRunOptions | null>(null)
  const [state, setState] = useState<JobState | null>(null)
  const [visible, setVisible] = useState(false)
  const [runningJob, setRunningJob] = useState(false)
  const optsRef = useRef<JobRunOptions | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const sigRef = useRef('')
  const timerRef = useRef<number | null>(null)
  const visibleRef = useRef(false)
  visibleRef.current = visible

  const stopTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const finish = useCallback(
    (s: JobState) => {
      setRunningJob(false)
      stopTimer()
      const okCount = s.rows.filter((r) => r.ok === true).length
      const failCount = s.rows.filter((r) => r.ok === false).length
      const summary =
        s.status === 'error' ? '批量任务失败' : `批量任务完成：成功 ${okCount}${failCount ? `，失败 ${failCount}` : ''}`
      message[failCount ? 'warning' : 'success'](`${optsRef.current?.title ?? '批量任务'}：${summary}`)
      optsRef.current?.onFinish?.(s)
    },
    [message],
  )

  const poll = useCallback(async () => {
    const id = jobIdRef.current
    if (!id) return
    try {
      const data = await api<JobPayload>(`/api/growth/job/${encodeURIComponent(id)}`, { skipPlatform: true })
      const rowsSource = data.items ?? data.accounts ?? data.logs ?? data.results ?? []
      const rows = (Array.isArray(rowsSource) ? rowsSource : []).map(rowFromItem).filter((r): r is JobRow => !!r)
      const s: JobState = {
        status: String(data.status ?? 'running'),
        total: typeof data.total === 'number' ? data.total : undefined,
        done: typeof data.done === 'number' ? data.done : undefined,
        rows,
        raw: data as Record<string, unknown>,
      }
      // 内容签名去抖：无变化不重渲（对应旧版 dataset.sig 局部更新）
      const sig = JSON.stringify([s.status, s.total, s.done, rows.map((r) => [r.key, r.label, r.ok, r.detail])])
      if (sig !== sigRef.current) {
        sigRef.current = sig
        setState(s)
      }
      if (s.status && s.status !== 'running' && s.status !== 'pending') finish(s)
    } catch {
      /* 单次轮询失败忽略，下轮重试 */
    }
  }, [finish])

  const run = useCallback(
    async (o: JobRunOptions) => {
      if (runningJob) {
        message.warning('已有批量任务在执行')
        return
      }
      try {
        const resp = await api<{ job_id?: string; reused?: boolean; detail?: string }>(o.submitUrl, {
          method: 'POST',
          body: o.body ?? {},
          skipPlatform: true,
        })
        if (resp?.reused) {
          message.info(resp.detail || '已有批量任务在执行')
          return
        }
        if (!resp?.job_id) {
          message.warning(resp?.detail || '任务提交未返回 job_id')
          return
        }
        optsRef.current = o
        jobIdRef.current = resp.job_id
        sigRef.current = ''
        setState({ status: 'running', rows: [] })
        setOpts(o)
        setVisible(true)
        setRunningJob(true)
        stopTimer()
        timerRef.current = window.setInterval(() => void poll(), 1500)
        void poll()
      } catch (e) {
        message.error((e as Error).message || '任务提交失败')
      }
    },
    [message, poll, runningJob],
  )

  useEffect(() => stopTimer, [])

  const value = useMemo<JobCtx>(() => ({ run, runningJob }), [run, runningJob])

  const percent =
    state && state.total && state.done !== undefined ? Math.round((state.done / state.total) * 100) : undefined

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        title={opts?.title}
        open={visible}
        onCancel={() => setVisible(false)}
        footer={null}
        width={560}
        mask={{ closable: false }}
      >
        <Flex align="center" gap={12}>
          <Progress
            percent={percent}
            status={state?.status === 'error' ? 'exception' : runningJob ? 'active' : 'normal'}
            style={{ flex: 1, marginBottom: 0 }}
          />
          <Typography.Text type="secondary" className="num" style={{ whiteSpace: 'nowrap' }}>
            {state?.total !== undefined && state?.done !== undefined ? `${state.done} / ${state.total}` : '执行中…'}
          </Typography.Text>
        </Flex>
        <Listy
          style={{ marginTop: 12, maxHeight: 360, overflow: 'auto' }}
          items={state?.rows ?? []}
          rowKey="key"
          itemRender={(row) => (
            <Typography.Text
              type={row.ok === true ? 'success' : row.ok === false ? 'danger' : undefined}
              ellipsis
              style={{ maxWidth: '100%', display: 'block', padding: '4px 0' }}
            >
              {row.ok === true ? '✓ ' : row.ok === false ? '✗ ' : '· '}
              {row.label}
              {row.detail ? `：${row.detail}` : ''}
            </Typography.Text>
          )}
        />
      </Modal>
    </Ctx.Provider>
  )
}

export function useJob(): JobCtx {
  return useContext(Ctx)
}
