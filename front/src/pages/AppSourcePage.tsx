import { App as AntdApp, Alert, Button, Card, Col, Descriptions, Input, Progress, Row, Space, Table, Typography } from 'antd'
import { AimOutlined, DeleteOutlined, FolderOpenOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'

interface SourceStatus {
  dev_tools: boolean
  install_dir: string | null
  asar: string | null
  asar_size: number
  unpacked: string | null
  source_dir: string
  source_exists: boolean
  sync: boolean
  describe: Record<string, unknown>
  source_stat: { dir?: string; exists?: boolean; files?: number; bytes?: number; extracted_at?: string }
  can_unpack: boolean
  python: string
  node: string
}

interface ProgressSnap {
  running: boolean
  percent?: number
  phase?: string
  total?: number
  done?: number
  current?: string
  error?: string
  exists?: boolean
}

export default function AppSourcePage() {
  const { message, modal } = AntdApp.useApp()
  const [status, setStatus] = useState<SourceStatus | null>(null)
  const [installDir, setInstallDir] = useState('')
  const [sourceDir, setSourceDir] = useState('')
  const [plan, setPlan] = useState<Record<string, unknown> | null>(null)
  const [progress, setProgress] = useState<ProgressSnap | null>(null)
  const [busy, setBusy] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ file: string; line: number; text: string }[]>([])
  const [scanned, setScanned] = useState(0)
  const timerRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await api<SourceStatus>('/api/app-source/status')
      setStatus(r)
      setInstallDir(r.install_dir ?? '')
      setSourceDir(r.source_dir ?? '')
    } catch (e) {
      message.error((e as Error).message || '逆向工具状态获取失败（可能未开启开发工具 ADMIN_DEV_TOOLS）')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [load])

  const startPoll = () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(async () => {
      try {
        const r = await api<ProgressSnap>('/api/app-source/unpack/progress')
        setProgress(r)
        if (!r.running) {
          if (timerRef.current) window.clearInterval(timerRef.current)
          timerRef.current = null
          message.success('拆包完成')
          void load()
        }
      } catch {
        /* ignore */
      }
    }, 700)
  }

  const detect = async () => {
    setBusy('detect')
    try {
      await api('/api/app-source/detect', { method: 'POST', body: {} })
      message.success('扫描完成')
      void load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const locate = async (kind: 'install_dir' | 'source_dir') => {
    setBusy(kind)
    try {
      await api('/api/app-source/locate', { method: 'POST', body: kind === 'install_dir' ? { install_dir: installDir.trim(), save: true } : { source_dir: sourceDir.trim(), save: true } })
      message.success('路径已保存')
      void load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const doPlan = async () => {
    setBusy('plan')
    try {
      const r = await api<Record<string, unknown>>('/api/app-source/unpack/plan', { method: 'POST', body: {} })
      setPlan(r)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const doUnpack = async () => {
    setBusy('unpack')
    try {
      await api('/api/app-source/unpack', { method: 'POST', body: { install_dir: installDir.trim(), source_dir: sourceDir.trim() }, timeout: 60000 })
      message.info('拆包已开始…')
      setProgress({ running: true })
      startPoll()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const remove = () => {
    modal.confirm({
      title: '删除逆向产物？',
      content: '将删除已拆包的产物目录（不影响客户端本体），下次需要时重新拆包。',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api('/api/app-source/remove', { method: 'POST', body: {} })
          message.success('已删除')
          void load()
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  const search = async () => {
    if (!query.trim()) return
    setBusy('search')
    try {
      const r = await api<{ hits: { file: string; line: number; text: string }[]; scanned?: number; truncated?: boolean }>(
        `/api/app-source/search?q=${encodeURIComponent(query.trim())}&limit=50`,
      )
      setHits(r.hits ?? [])
      setScanned(r.scanned ?? 0)
      if (!r.hits?.length) message.info('没有匹配结果')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  if (status && !status.dev_tools) {
    return (
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <PageHeader title="逆向产物" />
        <Alert type="info" showIcon title="开发工具未开启" description="设置环境变量 ADMIN_DEV_TOOLS=1 并重启服务后可用。" />
      </Space>
    )
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="逆向产物"
        description="拆包客户端 asar、检索产物内的字面量与指纹（开发工具）"
        onRefresh={() => void load()}
        refreshing={busy === 'detect'}
      />

      <Card size="small" style={{ height: '100%' }} title="状态">
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="安装目录">{status?.install_dir || '未定位'}</Descriptions.Item>
          <Descriptions.Item label="asar">{status?.asar || '—'}</Descriptions.Item>
          <Descriptions.Item label="asar 大小">{status?.asar_size ? `${(status.asar_size / 1024 / 1024).toFixed(1)} MB` : '—'}</Descriptions.Item>
          <Descriptions.Item label="产物目录">{status?.unpacked || '未拆包'}</Descriptions.Item>
          <Descriptions.Item label="产物文件数">{status?.source_stat?.files ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Python / Node">{status?.python || '—'} / {status?.node || '—'}</Descriptions.Item>
        </Descriptions>
        <Space style={{ marginTop: 12 }} wrap>
          <Button icon={<AimOutlined />} loading={busy === 'detect'} onClick={() => void detect()}>
            重新扫描安装目录
          </Button>
          {status?.unpacked && (
            <Button danger icon={<DeleteOutlined />} onClick={remove}>
              删除产物
            </Button>
          )}
        </Space>
      </Card>

      <Card size="small" style={{ height: '100%' }} title="路径定位">
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Row gutter={8}>
            <Col span={18}>
              <Input prefix="安装目录" value={installDir} onChange={(e) => setInstallDir(e.target.value)} placeholder="C:\Users\...\AppData\Local\Programs\workbuddy" />
            </Col>
            <Col span={6}>
              <Button loading={busy === 'install_dir'} onClick={() => void locate('install_dir')}>
                保存
              </Button>
            </Col>
          </Row>
          <Row gutter={8}>
            <Col span={18}>
              <Input prefix="产物目录" value={sourceDir} onChange={(e) => setSourceDir(e.target.value)} placeholder="拆包产物存放位置" />
            </Col>
            <Col span={6}>
              <Button loading={busy === 'source_dir'} onClick={() => void locate('source_dir')}>
                保存
              </Button>
            </Col>
          </Row>
        </Space>
      </Card>

      <Card size="small" style={{ height: '100%' }} title="拆包">
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Space>
            <Button icon={<FolderOpenOutlined />} loading={busy === 'plan'} onClick={() => void doPlan()}>
              预检（计划）
            </Button>
            <Button type="primary" disabled={!status?.can_unpack} loading={busy === 'unpack'} onClick={() => void doUnpack()}>
              开始拆包
            </Button>
            {progress?.running && (
              <Button icon={<ReloadOutlined />} onClick={() => startPoll()}>
                查看进度
              </Button>
            )}
          </Space>
          {plan && (
            <Typography.Paragraph code style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginBottom: 0 }}>
              {JSON.stringify(plan, null, 2).slice(0, 1500)}
            </Typography.Paragraph>
          )}
          {progress && (
            <div>
              <Progress percent={progress.percent ?? (progress.running ? undefined : 100)} status={progress.error ? 'exception' : progress.running ? 'active' : 'normal'} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {progress.phase || (progress.running ? '拆包中…' : '空闲')}
                {progress.current ? ` · ${progress.current}` : ''}
                {progress.done !== undefined && progress.total ? ` (${progress.done}/${progress.total})` : ''}
              </Typography.Text>
            </div>
          )}
        </Space>
      </Card>

      <Card size="small" style={{ height: '100%' }} title="产物内检索">
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="关键字（如 11128、prompt 片段、版本号）"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onPressEnter={() => void search()}
            />
            <Button type="primary" icon={<SearchOutlined />} loading={busy === 'search'} onClick={() => void search()}>
              检索
            </Button>
          </Space.Compact>
          {scanned > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              扫描 {scanned} 个文件{hits.length >= 50 ? '（结果截断）' : ''}
            </Typography.Text>
          )}
          <Table
            size="small"
            rowKey={(r, i) => `${r.file}:${r.line}:${i}`}
            dataSource={hits}
            pagination={{ pageSize: 10 }}
            columns={[
              { title: '文件', dataIndex: 'file', width: 260, ellipsis: true, render: (v) => <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text> },
              { title: '行', dataIndex: 'line', width: 70, align: 'right', render: (v) => <span className="num">{v}</span> },
              { title: '内容', dataIndex: 'text', ellipsis: true, render: (v) => <Typography.Text style={{ fontSize: 12 }}>{String(v).slice(0, 200)}</Typography.Text> },
            ]}
          />
        </Space>
      </Card>
    </Space>
  )
}
