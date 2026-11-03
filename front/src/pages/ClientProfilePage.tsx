import { App as AntdApp, Alert, Button, Card, Col, Descriptions, Input, Row, Segmented, Space, Table, Tag, Typography, Upload } from 'antd'
import { AimOutlined, DownloadOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { usePlatform } from '../context/PlatformContext'
import PageHeader from '../components/PageHeader'
import CopyButton from '../components/CopyButton'
import { downloadText, exportName } from '../utils/download'

interface ClientProfileResp {
  effective: Record<string, string | number>
  saved: Record<string, string | number>
  detected: Record<string, string | number>
  detected_origins?: Record<string, string>
  sources?: Record<string, string>
  source: 'auto' | 'saved'
  defaults?: Record<string, string | number>
  has_client?: boolean
  diff_saved_vs_effective?: Record<string, { old: unknown; new: unknown }>
  runtime_diagnostics?: {
    platform?: string
    device_token?: { available?: boolean; source?: string; checked?: string; node_available?: boolean; helper_available?: boolean; cached_failure?: string; error?: string }
    header_groups?: { client_profile?: string[]; sdk_stainless?: string[]; account_session?: string[] }
  }
  dirs?: string[]
  ua?: string
  product_version?: string
}

/** 可编辑字段（对应旧版 _CP_FIELDS / _CP_FP_FIELDS） */
const FIELD_LABELS: Record<string, string> = {
  desktop_version: '桌面版本',
  cli_version: 'CLI 版本',
  turing_product_name: '产品名（风控）',
  ide_name: 'IDE 名称',
  ide_type: 'IDE 类型',
  product: 'product',
  application_name: '应用名',
  turing_channel_id: '渠道 ID',
  commit: '构建 commit',
  release_date_ms: '发布时间戳',
  node_version: 'Node 版本',
  stainless_package_version: 'SDK 版本',
  fp_product: '指纹 product',
  ext_name: '扩展名',
  os: '操作系统',
  arch: '架构',
  os_version: '系统版本',
  cpu_cores: 'CPU 核数',
  memory_size: '内存大小',
  timezone: '时区',
  report_delay: '上报延迟',
}

const EDITABLE = Object.keys(FIELD_LABELS)

export default function ClientProfilePage({ embedded = false }: { embedded?: boolean } = {}) {
  const { message, modal } = AntdApp.useApp()
  const { platformKey } = usePlatform()
  const [data, setData] = useState<ClientProfileResp | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api<ClientProfileResp>('/api/client-profile')
      setData(r)
      const f: Record<string, string> = {}
      for (const k of EDITABLE) f[k] = String((r.saved as Record<string, unknown>)?.[k] ?? (r.effective as Record<string, unknown>)?.[k] ?? '')
      setForm(f)
      const h = (r.effective as Record<string, unknown>)?.headers as Record<string, string> | undefined
      setHeaders(Object.entries(h ?? {}).map(([key, value]) => ({ key, value })))
    } catch (e) {
      message.error((e as Error).message || '客户端参数加载失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformKey])

  useEffect(() => {
    void load()
  }, [load])

  const collectProfile = (): Record<string, string> => {
    const profile: Record<string, string> = {}
    for (const [k, v] of Object.entries(form)) {
      if (v !== '') profile[k] = v
    }
    const hs: Record<string, string> = {}
    for (const h of headers) {
      if (h.key.trim() && h.value.trim()) hs[h.key.trim()] = h.value.trim()
    }
    if (Object.keys(hs).length) profile.headers = hs as unknown as string
    return profile
  }

  const save = async () => {
    setBusy('save')
    try {
      await api('/api/client-profile', { method: 'PUT', body: { profile: collectProfile(), merge: true } })
      message.success('客户端参数已保存（留空字段未改动）')
      void load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const detect = async () => {
    setBusy('detect')
    message.loading({ content: '正在探测本机客户端…', key: 'cpDetect', duration: 0 })
    try {
      await api('/api/client-profile/detect-all', { method: 'POST', body: {} })
      message.success({ content: '探测完成，探测值已回填', key: 'cpDetect' })
      void load()
    } catch (e) {
      message.error({ content: (e as Error).message || '探测失败', key: 'cpDetect' })
    } finally {
      setBusy('')
    }
  }

  const switchSource = async (source: 'auto' | 'saved') => {
    try {
      await api('/api/client-profile', { method: 'PUT', body: { source } })
      message.success(source === 'auto' ? '已切换为探测优先' : '已切换为存档优先')
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const reset = () => {
    modal.confirm({
      title: '重置客户端参数？',
      content: '将清除后台保存的参数，恢复为默认/探测值。',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api('/api/client-profile/reset', { method: 'POST', body: {} })
          message.success('已重置')
          void load()
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  const doExport = async () => {
    try {
      const r = await api<Record<string, unknown>>('/api/client-profile/export')
      await downloadText(exportName('workbuddy-client-profile', 'json'), JSON.stringify(r, null, 2), 'application/json')
      message.success('已导出')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const doImport = async (file: { text: () => Promise<string> }) => {
    try {
      const text = await file.text()
      if (text.length > 256 * 1024) {
        message.error('文件超过 256KB 限制')
        return
      }
      const parsed = JSON.parse(text) as { format?: string; profile?: Record<string, unknown> }
      if (parsed.format && parsed.format !== 'workbuddy-client-profile') {
        message.error('文件格式不符（需要 workbuddy-client-profile）')
        return
      }
      await api('/api/client-profile/import', { method: 'POST', body: parsed, timeout: 30000 })
      message.success('已导入并启用')
      void load()
    } catch (e) {
      message.error((e as Error).message || '导入失败')
    }
  }

  const rd = data?.runtime_diagnostics

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      {!embedded && (
      <PageHeader
        title="客户端参数"
        description={data?.has_client ? `本机客户端已检测（${data.product_version ?? ''}）` : '配置发往上游的客户端指纹与请求头'}
        onRefresh={() => void load()}
        refreshing={loading}
        actions={
          <Space wrap>
            <Segmented
              value={data?.source ?? 'auto'}
              onChange={(v) => void switchSource(v as 'auto' | 'saved')}
              options={[
                { label: '探测优先', value: 'auto' },
                { label: '存档优先', value: 'saved' },
              ]}
            />
            <Button icon={<AimOutlined />} loading={busy === 'detect'} onClick={() => void detect()}>
              探测本机客户端
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => void doExport()}>
              导出
            </Button>
            <Upload showUploadList={false} maxCount={1} beforeUpload={(f) => { void doImport(f); return false }}>
              <Button>导入</Button>
            </Upload>
            <Button danger onClick={reset}>
              重置
            </Button>
          </Space>
        }
      />
      )}

      {data?.diff_saved_vs_effective && Object.keys(data.diff_saved_vs_effective).length > 0 && (
        <Alert
          type="warning"
          showIcon
          title="存档参数与生效参数存在差异（探测值已覆盖存档）"
          description={Object.entries(data.diff_saved_vs_effective)
            .slice(0, 8)
            .map(([k, v]) => `${k}: ${String(v.old)} → ${String(v.new)}`)
            .join('；')}
        />
      )}

      {/* 生效 UA */}
      <Card size="small" style={{ height: '100%' }} title="生效 User-Agent">
        <Space>
          <Typography.Text code style={{ wordBreak: 'break-all', fontSize: 12 }}>
            {data?.ua || '—'}
          </Typography.Text>
          {data?.ua && <CopyButton value={data.ua} tip="复制 UA" />}
        </Space>
      </Card>

      {/* 字段表单 */}
      <Card size="small" style={{ height: '100%' }} title="参数表单（留空 = 不改动）" extra={<Button type="primary" loading={busy === 'save'} onClick={() => void save()}>保存</Button>}>
        <Row gutter={[12, 8]}>
          {EDITABLE.map((k) => (
            <Col key={k} xs={24} md={12} xl={8}>
              <Input
                prefix={FIELD_LABELS[k]}
                value={form[k] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                placeholder={String((data?.detected as Record<string, unknown>)?.[k] ?? (data?.defaults as Record<string, unknown>)?.[k] ?? '')}
                size="small"
              />
            </Col>
          ))}
        </Row>
        <Typography.Title level={5} style={{ marginTop: 16 }}>自定义风控请求头</Typography.Title>
        {headers.map((h, i) => (
          <Row key={i} gutter={8} style={{ marginBottom: 8 }}>
            <Col span={8}>
              <Input size="small" placeholder="头名称" value={h.key} onChange={(e) => setHeaders((hs) => hs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
            </Col>
            <Col span={13}>
              <Input size="small" placeholder="值" value={h.value} onChange={(e) => setHeaders((hs) => hs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            </Col>
            <Col span={3}>
              <Button size="small" danger onClick={() => setHeaders((hs) => hs.filter((_, j) => j !== i))}>
                删除
              </Button>
            </Col>
          </Row>
        ))}
        <Button size="small" onClick={() => setHeaders((hs) => [...hs, { key: '', value: '' }])}>
          添加请求头
        </Button>
      </Card>

      <Row gutter={[12, 12]} align="stretch">
        <Col xs={24} xl={12}>
          <Card size="small" style={{ height: '100%' }} title="运行时诊断">
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="平台">{rd?.platform || '—'}</Descriptions.Item>
              <Descriptions.Item label="设备令牌">
                {rd?.device_token?.available ? <Tag color="success">可用</Tag> : <Tag color="error">不可用</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="令牌来源">{rd?.device_token?.source || '—'}</Descriptions.Item>
              <Descriptions.Item label="本机探测">
                {rd?.device_token?.node_available ? <Tag color="success">Node</Tag> : null}
                {rd?.device_token?.helper_available ? <Tag color="success">Helper</Tag> : null}
              </Descriptions.Item>
              <Descriptions.Item label="缓存失败">{rd?.device_token?.cached_failure || '—'}</Descriptions.Item>
              <Descriptions.Item label="错误">{rd?.device_token?.error || '—'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" style={{ height: '100%' }} title="请求头分组">
            {(['client_profile', 'sdk_stainless', 'account_session'] as const).map((g) => (
              <div key={g} style={{ marginBottom: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {g}（{(rd?.header_groups?.[g] ?? []).length}）
                </Typography.Text>
                <div>
                  {(rd?.header_groups?.[g] ?? []).map((h) => (
                    <Tag key={h} style={{ fontSize: 11 }}>
                      {h}
                    </Tag>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </Col>
      </Row>

      {/* 取值来源 */}
      <Card size="small" style={{ height: '100%' }} title="取值来源">
        <Table
          size="small"
          rowKey={(r) => String(r.key)}
          dataSource={Object.entries(data?.sources ?? {}).map(([key, v]) => ({ key, source: v }))}
          pagination={false}
          columns={[
            { title: '字段', dataIndex: 'key', width: 220 },
            {
              title: '来源',
              dataIndex: 'source',
              render: (v: string) => <Tag color={v?.includes('探测') ? 'processing' : v?.includes('环境') ? 'warning' : 'default'}>{v}</Tag>,
            },
          ]}
        />
        {data?.dirs?.length ? (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
            扫描位置：{data.dirs.join('；')}
          </Typography.Text>
        ) : null}
      </Card>
    </Space>
  )
}
