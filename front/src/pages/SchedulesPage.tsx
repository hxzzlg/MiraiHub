import { App as AntdApp, Button, Card, Checkbox, Col, Form, Input, InputNumber, Modal, Popconfirm, Row, Segmented, Select, Space, Switch, Table, Tag, TimePicker, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { usePlatform } from '../context/PlatformContext'
import PageHeader from '../components/PageHeader'
import { FMT_EMPTY, fmtTime } from '../utils/format'
import dayjs from 'dayjs'

interface Schedule {
  id: number
  name: string
  display_name?: string
  timing: { mode: 'preset' | 'interval' | 'daily' | 'weekly' | 'monthly'; time?: string; weekdays?: number[]; monthday?: number }
  cycle_label: string
  task: string
  task_label: string
  platform: string
  platform_label: string
  interval_minutes: number
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  last_result: string
  stop_after: string | null
  due_soon?: boolean
}

interface TaskDef {
  value: string
  label: string
  platform: string
  platform_label: string
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function parseResult(raw: string): string {
  if (!raw) return FMT_EMPTY
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (o.ok === false) {
      const err = (o.error ?? o.message) as string | undefined
      return `失败：${String(err ?? '').slice(0, 60)}` || '失败'
    }
    if (typeof o.accounts === 'number') return `处理 ${o.accounts} 个账号${o.credit ? `，+${o.credit} 积分` : ''}`
    if (o.task_done !== undefined) return `完成 ${String(o.task_done)} 项`
    return '成功'
  } catch {
    return raw.slice(0, 60)
  }
}

export default function SchedulesPage() {
  const { message, modal } = AntdApp.useApp()
  const { platformKey } = usePlatform()
  const [items, setItems] = useState<Schedule[]>([])
  const [tasks, setTasks] = useState<TaskDef[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [timingMode, setTimingMode] = useState<Schedule['timing']['mode']>('interval')
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api<{ items: Schedule[] }>('/api/schedules')
      setItems(r.items ?? [])
    } catch (e) {
      message.error((e as Error).message || '定时任务加载失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformKey])

  useEffect(() => {
    void load()
    void api<{ items: TaskDef[] }>('/api/schedules/tasks')
      .then((r) => setTasks(r.items ?? []))
      .catch(() => {})
  }, [load])

  const openEditor = (s?: Schedule) => {
    setEditing(s ?? null)
    const mode = s?.timing?.mode ?? 'interval'
    setTimingMode(mode)
    form.setFieldsValue({
      name: s?.name,
      task: s?.task,
      enabled: s?.enabled ?? true,
      interval_minutes: s?.interval_minutes ?? 60,
      time: s?.timing?.time ? dayjs(s.timing.time, 'HH:mm') : dayjs('09:00', 'HH:mm'),
      weekdays: s?.timing?.weekdays ?? [0],
      monthday: s?.timing?.monthday ?? 1,
      stop_after: s?.stop_after ? dayjs(s.stop_after, 'HH:mm') : undefined,
    })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    const timing: Schedule['timing'] = { mode: timingMode }
    if (timingMode === 'daily' || timingMode === 'weekly' || timingMode === 'monthly') {
      timing.time = (v.time as dayjs.Dayjs)?.format('HH:mm') ?? '09:00'
    }
    if (timingMode === 'weekly') timing.weekdays = v.weekdays ?? [0]
    if (timingMode === 'monthly') timing.monthday = v.monthday ?? 1
    const body: Record<string, unknown> = {
      name: v.name,
      task: v.task,
      enabled: !!v.enabled,
      timing,
      interval_minutes: timingMode === 'interval' ? Number(v.interval_minutes ?? 60) : 0,
      stop_after: v.stop_after ? (v.stop_after as dayjs.Dayjs).format('HH:mm') : null,
    }
    try {
      if (editing) await api(`/api/schedules/${editing.id}`, { method: 'PATCH', body })
      else await api('/api/schedules', { method: 'POST', body })
      message.success('定时任务已保存')
      setOpen(false)
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const runNow = async (s: Schedule) => {
    message.loading({ content: `正在执行 ${s.name}…`, key: `run${s.id}`, duration: 0 })
    try {
      const r = await api<{ result?: Record<string, unknown> }>(`/api/schedules/${s.id}/run`, { method: 'POST', body: {}, timeout: 300000 })
      message.success({ content: '执行完成', key: `run${s.id}` })
      modal.info({
        title: `执行结果：${s.name}`,
        width: 640,
        content: (
          <Typography.Paragraph code style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginBottom: 0 }}>
            {JSON.stringify(r?.result ?? r, null, 2).slice(0, 3000)}
          </Typography.Paragraph>
        ),
      })
      // 执行后轮询几次刷新列表
      let n = 0
      const t = window.setInterval(() => {
        void load()
        if (++n >= 5) window.clearInterval(t)
      }, 4000)
    } catch (e) {
      message.error({ content: (e as Error).message || '执行失败', key: `run${s.id}` })
    }
  }

  const toggle = async (s: Schedule) => {
    try {
      await api(`/api/schedules/${s.id}/toggle`, { method: 'POST', body: {} })
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const remove = async (s: Schedule) => {
    try {
      await api(`/api/schedules/${s.id}`, { method: 'DELETE' })
      message.success('已删除')
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="定时任务"
        onRefresh={() => void load()}
        refreshing={loading}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
            新建任务
          </Button>
        }
      />
      <Card size="small">
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={false}
          columns={[
            { title: '任务', dataIndex: 'name', ellipsis: true, render: (v, r) => (
              <Space size={4}>
                <Typography.Text strong>{v}</Typography.Text>
                <Tag style={{ fontSize: 11 }}>{r.platform_label}</Tag>
                {r.due_soon && <Tag color="processing">即将执行</Tag>}
              </Space>
            ) },
            { title: '类型', dataIndex: 'task_label', width: 140, ellipsis: true },
            { title: '周期', dataIndex: 'cycle_label', width: 130, ellipsis: true },
            { title: '下次运行', dataIndex: 'next_run_at', width: 140, render: (v) => <span className="num">{fmtTime(v, true)}</span> },
            {
              title: '上次结果',
              dataIndex: 'last_result',
              ellipsis: true,
              render: (v: string, r) => (
                <Space size={4}>
                  <Typography.Text type={v && !v.includes('"ok": false') ? undefined : 'secondary'} style={{ fontSize: 12 }}>
                    {parseResult(v)}
                  </Typography.Text>
                  {v && (
                    <Button
                      type="link"
                      size="small"
                      onClick={() =>
                        modal.info({
                          title: `上次结果：${r.name}（${fmtTime(r.last_run_at, true)}）`,
                          width: 640,
                          content: (
                            <Typography.Paragraph code style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginBottom: 0 }}>
                              {(() => {
                                try {
                                  return JSON.stringify(JSON.parse(v), null, 2).slice(0, 3000)
                                } catch {
                                  return v
                                }
                              })()}
                            </Typography.Paragraph>
                          ),
                        })
                      }
                    >
                      详情
                    </Button>
                  )}
                </Space>
              ),
            },
            { title: '上次运行', dataIndex: 'last_run_at', width: 140, render: (v) => <span className="num">{fmtTime(v, true)}</span> },
            { title: '启用', dataIndex: 'enabled', width: 70, render: (v, r) => <Switch size="small" checked={v} onChange={() => void toggle(r)} /> },
            {
              title: '操作',
              width: 190,
              render: (_, s) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => void runNow(s)}>
                    立即执行
                  </Button>
                  <Button type="link" size="small" onClick={() => openEditor(s)}>
                    编辑
                  </Button>
                  <Popconfirm title={`删除任务 ${s.name}？`} onConfirm={() => void remove(s)}>
                    <Button type="link" size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? `编辑任务：${editing.name}` : '新建定时任务'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
        width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：每日签到" />
          </Form.Item>
          <Form.Item name="task" label="任务类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              options={tasks.map((t) => ({ value: t.value, label: `${t.platform_label} · ${t.label}` }))}
            />
          </Form.Item>
          <Form.Item label="执行周期">
            <Segmented
              value={timingMode}
              onChange={(v) => setTimingMode(v as typeof timingMode)}
              options={[
                { label: '固定间隔', value: 'interval' },
                { label: '每天', value: 'daily' },
                { label: '每周', value: 'weekly' },
                { label: '每月', value: 'monthly' },
              ]}
            />
            <Row gutter={12} style={{ marginTop: 8 }}>
              {timingMode === 'interval' && (
                <Col span={12}>
                  <Form.Item name="interval_minutes" label="间隔（分钟）" initialValue={60}>
                    <InputNumber min={5} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              )}
              {(timingMode === 'daily' || timingMode === 'weekly' || timingMode === 'monthly') && (
                <Col span={12}>
                  <Form.Item name="time" label="执行时刻">
                    <TimePicker format="HH:mm" style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              )}
              {timingMode === 'weekly' && (
                <Col span={12}>
                  <Form.Item name="weekdays" label="周几">
                    <Select mode="multiple" placeholder="选择" options={WEEKDAY_LABELS.map((l, i) => ({ value: i, label: l }))} />
                  </Form.Item>
                </Col>
              )}
              {timingMode === 'monthly' && (
                <Col span={12}>
                  <Form.Item name="monthday" label="每月几号" initialValue={1}>
                    <InputNumber min={1} max={31} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              )}
            </Row>
          </Form.Item>
          <Form.Item name="stop_after" label="停止领取时间（签到类任务专用）">
            <TimePicker format="HH:mm" style={{ width: '50%' }} />
          </Form.Item>
          <Form.Item name="enabled" valuePropName="checked" initialValue={true}>
            <Checkbox>启用任务</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
