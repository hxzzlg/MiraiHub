import { Alert, App as AntdApp, Button, Card, Col, Descriptions, Row, Space, Spin, Table, Tag, Typography } from 'antd'
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { androidStatus, isAndroid } from '../bridges/native'
import { FMT_EMPTY, fmtDuration, fmtInt } from '../utils/format'

interface ProbeResult {
  path: string
  label: string
  ok: boolean
  status: number
  detail?: string
}

interface TimingRow {
  labels?: Record<string, number>
  total_ms?: number
  path?: string
  model?: string
  [k: string]: unknown
}

/** 安卓设置页（替代旧 android/web/settings.html + mobile_settings.js 的注入方案） */
export default function AndroidSettingsPage() {
  const { message } = AntdApp.useApp()
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [probes, setProbes] = useState<ProbeResult[]>([])
  const [probing, setProbing] = useState(false)
  const [timings, setTimings] = useState<TimingRow[]>([])
  const [timingsLoading, setTimingsLoading] = useState(false)

  const loadStatus = useCallback(async () => {
    if (!isAndroid()) return
    const s = await androidStatus()
    setStatus(s)
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const restartService = () => {
    void window.WBAndroid?.restartService?.()?.then?.((r: unknown) => {
      message.success(typeof r === 'string' ? r : '重启指令已下发')
      setTimeout(() => void loadStatus(), 3000)
    })
  }

  const runProbes = async () => {
    setProbing(true)
    const items: ProbeResult[] = []
    const probe = async (path: string, label: string, expect: 'ok' | 'unauthorized', withKey = false) => {
      try {
        const headers: Record<string, string> = {}
        if (withKey) {
          // 自检用管理 token 打 /v1（后端只验 API Key，401 即为预期）
          headers['Authorization'] = 'Bearer probe'
        }
        const resp = await fetch(path, { headers, credentials: 'same-origin' })
        const ok = expect === 'ok' ? resp.ok : resp.status === 401
        items.push({ path, label, ok, status: resp.status, detail: expect === 'unauthorized' ? '期望 401' : undefined })
      } catch (e) {
        items.push({ path, label, ok: false, status: 0, detail: (e as Error).message })
      }
    }
    await Promise.all([
      probe('/api/app/version', '版本接口', 'ok'),
      probe('/api/accounts', '账号池接口', 'ok'),
      probe('/api/models/configs', '模型配置接口', 'ok'),
      probe('/join', '自助注册页', 'ok'),
      probe('/v1/models', '网关模型列表（无 Key）', 'unauthorized', true),
      probe('/v1/chat/completions', '网关对话入口（无 Key）', 'unauthorized', true),
      probe('/v1/messages', '网关 Claude 入口（无 Key）', 'unauthorized', true),
    ])
    setProbes(items)
    setProbing(false)
    if (items.every((i) => i.ok)) message.success('接口自检全部通过')
    else message.warning('部分接口异常，详见列表')
  }

  const loadTimings = async () => {
    setTimingsLoading(true)
    try {
      const r = await api<{ items?: TimingRow[]; recent?: TimingRow[] }>('/api/app/request-timings')
      setTimings(r.items ?? r.recent ?? [])
    } catch {
      setTimings([])
      message.info('该接口仅在安卓壳内可用')
    } finally {
      setTimingsLoading(false)
    }
  }

  const statusEntries = Object.entries(status ?? {})
  const healthy = statusEntries.length > 0

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="安卓设置"
        description={isAndroid() ? '安卓壳运行状态与自检' : '未检测到安卓桥（请在 APK 内使用）'}
      />

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="运行状态" extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void loadStatus()} />}>
            {!isAndroid() ? (
              <Typography.Text type="secondary">当前不是安卓壳环境。</Typography.Text>
            ) : !healthy ? (
              <Spin />
            ) : (
              <Descriptions size="small" column={1}>
                {statusEntries.map(([k, v]) => (
                  <Descriptions.Item key={k} label={k}>
                    {typeof v === 'boolean' ? (
                      v ? <Tag color="success">是</Tag> : <Tag>否</Tag>
                    ) : (
                      String(v ?? FMT_EMPTY)
                    )}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            )}
            <Button
              type="primary"
              danger
              icon={<ReloadOutlined />}
              disabled={!isAndroid()}
              onClick={restartService}
              style={{ marginTop: 12 }}
            >
              重启后台服务
            </Button>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card
            size="small"
            title="接口自检"
            extra={
              <Button size="small" icon={<ThunderboltOutlined />} loading={probing} onClick={() => void runProbes()}>
                开始自检
              </Button>
            }
          >
            <Table
              size="small"
              rowKey="path"
              dataSource={probes}
              pagination={false}
              locale={{ emptyText: '点击"开始自检"运行 7 项探针' }}
              columns={[
                { title: '检查项', dataIndex: 'label' },
                { title: '路径', dataIndex: 'path', ellipsis: true, render: (v) => <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text> },
                { title: 'HTTP', dataIndex: 'status', width: 70, align: 'right', render: (v) => <span className="num">{v || '—'}</span> },
                {
                  title: '结果',
                  dataIndex: 'ok',
                  width: 90,
                  render: (v, r) => (v ? <Tag color="success">通过</Tag> : <Tag color="error">{r.detail || '异常'}</Tag>),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="调用耗时诊断"
        extra={
          <Button size="small" loading={timingsLoading} onClick={() => void loadTimings()}>
            刷新
          </Button>
        }
      >
        {timings.length === 0 ? (
          <Typography.Text type="secondary">暂无耗时采样记录。</Typography.Text>
        ) : (
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            dataSource={timings}
            pagination={{ pageSize: 10 }}
            columns={[
              { title: '路径/模型', render: (_, r) => <Typography.Text style={{ fontSize: 12 }}>{String(r.model || r.path || FMT_EMPTY)}</Typography.Text> },
              { title: '总耗时', render: (_, r) => <span className="num">{fmtDuration(Number(r.total_ms ?? 0))}</span> },
              {
                title: '分段',
                render: (_, r) => (
                  <Space wrap size={4}>
                    {Object.entries(r.labels ?? {}).map(([k, v]) => (
                      <Tag key={k} style={{ fontSize: 11 }}>
                        {k} {fmtInt(v)}ms
                      </Tag>
                    ))}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      {!isAndroid() && (
        <Alert type="info" showIcon title="本页仅在安卓 APK 内提供完整功能（桥接状态 / 重启服务 / 耗时采样）。" />
      )}
    </Space>
  )
}
