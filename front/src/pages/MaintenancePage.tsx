import { App as AntdApp, Alert, Button, Card, Col, Input, Popconfirm, Row, Segmented, Space, Statistic, Tabs, Tag, Typography, Upload } from 'antd'
import { CloudDownloadOutlined, CloudUploadOutlined, ReloadOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import CopyButton from '../components/CopyButton'
import { downloadResponse } from '../utils/download'
import { fmtTime } from '../utils/format'

interface UpdateInfo {
  ok: boolean
  database: string
  backup_supported: boolean
  db_exists: boolean
  db_size: number
  db_path: string
  backup_dir: string
  backup_dir_default: string
  backup_dir_is_default: boolean
  backup_dir_writable: boolean
  desktop_mode: boolean
  version: string
  latest: { tag: string; name: string; url: string; date: string } | null
  available: boolean
  error?: string
  releases_url: string
  commands: { docker: string; linux: string } | null
  commands_cn: { docker: string; linux: string } | null
  backup_note?: string
  mysql_backup_command: string | null
}

export default function MaintenancePage() {
  const { message, modal } = AntdApp.useApp()
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [cmdSource, setCmdSource] = useState<'official' | 'cn'>('official')
  const [newBackupDir, setNewBackupDir] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setInfo(await api<UpdateInfo>('/api/maintenance/update'))
    } catch (e) {
      message.error((e as Error).message || '版本信息加载失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const downloadBackup = async () => {
    message.loading({ content: '正在生成备份…', key: 'bk', duration: 0 })
    try {
      const resp = await api<Response>('/api/maintenance/backup', { method: 'POST', body: {}, raw: true, timeout: 120000 })
      await downloadResponse(resp, `wb2api-backup-${new Date().toISOString().slice(0, 10)}.db`)
      message.success({ content: '备份已下载', key: 'bk' })
    } catch (e) {
      message.error({ content: (e as Error).message || '备份失败', key: 'bk' })
    }
  }

  const restoreBackup = async (file: File) => {
    modal.confirm({
      title: '确认恢复备份？',
      content: `将用 ${file.name} 整体替换当前数据库（账号 / Key 等全部数据），操作前会自动做安全备份。`,
      okText: '确认恢复',
      okButtonProps: { danger: true },
      onOk: async () => {
        message.loading({ content: '正在恢复…', key: 'restore', duration: 0 })
        try {
          const r = await api<{ tables: Record<string, number>; safety_copy: string }>('/api/maintenance/restore', {
            method: 'POST',
            rawBody: file,
            headers: { 'Content-Type': 'application/octet-stream' },
            timeout: 300000,
          })
          message.success({ content: `恢复完成（${Object.entries(r.tables ?? {}).map(([k, v]) => `${k}:${v}`).join('，')}），安全备份 ${r.safety_copy}`, key: 'restore' })
        } catch (e) {
          message.error({ content: (e as Error).message || '恢复失败', key: 'restore' })
        }
      },
    })
  }

  const setBackupDir = async (reset: boolean) => {
    try {
      await api('/api/maintenance/backup/dir', { method: 'PUT', body: reset ? { reset: true } : { path: newBackupDir.trim() } })
      message.success('备份目录已更新')
      setNewBackupDir('')
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const restart = () => {
    modal.confirm({
      title: '确认重启服务？',
      content: '重启需要数秒，期间网关短暂不可用。',
      okText: '确认重启',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api('/api/maintenance/restart', { method: 'POST', body: { confirm: true } })
          message.success('重启指令已下发，8 秒后自动刷新页面…')
          setTimeout(() => window.location.reload(), 8000)
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  const cmds = (cmdSource === 'cn' ? info?.commands_cn : info?.commands) ?? null

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader title="更新与备份" onRefresh={() => void load()} refreshing={loading} />

      {/* 版本卡 */}
      <Card size="small" title="版本">
        <Row gutter={12}>
          <Col xs={8} md={4}><Statistic title="当前版本" value={info?.version ?? '—'} /></Col>
          <Col xs={8} md={6}>
            <Statistic title="最新版本" value={info?.latest?.tag ?? '—'} />
            {info?.latest?.date && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{fmtTime(info.latest.date)}</Typography.Text>}
          </Col>
          <Col xs={8} md={6}>
            {info?.available ? (
              <Alert type="info" showIcon title="有新版本可用" />
            ) : (
              <Tag color="success">已是最新</Tag>
            )}
          </Col>
          <Col xs={24} md={6}>
            <Space>
              {info?.releases_url && <Button type="link" href={info.releases_url} target="_blank" rel="noopener">Release 列表</Button>}
              <Popconfirm title="确认重启服务？" onConfirm={restart}>
                <Button danger icon={<ReloadOutlined />}>
                  重启服务
                </Button>
              </Popconfirm>
            </Space>
          </Col>
        </Row>
        {info?.error && <Typography.Text type="danger" style={{ fontSize: 12 }}>检查更新失败：{info.error}</Typography.Text>}
      </Card>

      {/* 备份区 */}
      <Card size="small" title="数据库备份与恢复">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12}>
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              <Space wrap>
                <Button type="primary" icon={<CloudDownloadOutlined />} disabled={!info?.backup_supported} onClick={() => void downloadBackup()}>
                  下载备份（.db）
                </Button>
                <Upload showUploadList={false} maxCount={1} beforeUpload={(f) => { void restoreBackup(f); return false }}>
                  <Button icon={<CloudUploadOutlined />}>恢复备份</Button>
                </Upload>
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                数据库：{info?.database} · 大小 {(Number(info?.db_size ?? 0) / 1024 / 1024).toFixed(1)} MB
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                路径：{info?.db_path}
              </Typography.Text>
              {info?.backup_note && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{info.backup_note}</Typography.Text>}
            </Space>
          </Col>
          <Col xs={24} md={12}>
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text style={{ fontSize: 12 }}>备份目录：</Typography.Text>
              <Typography.Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {info?.backup_dir}
                {info?.backup_dir_is_default ? '（默认）' : ''}
                {info?.backup_dir_writable ? '' : '（不可写）'}
              </Typography.Text>
              <Space>
                <Input
                  size="small"
                  placeholder="自定义备份目录"
                  style={{ width: 280 }}
                  value={newBackupDir}
                  onChange={(e) => setNewBackupDir(e.target.value)}
                />
                <Button size="small" disabled={!newBackupDir.trim()} onClick={() => void setBackupDir(false)}>
                  设置
                </Button>
                <Button size="small" onClick={() => void setBackupDir(true)}>
                  恢复默认
                </Button>
              </Space>
              {info?.mysql_backup_command && (
                <>
                  <Typography.Text style={{ fontSize: 12 }}>MySQL 备份命令：</Typography.Text>
                  <Space>
                    <Typography.Paragraph code style={{ fontSize: 12, marginBottom: 0 }}>
                      {info.mysql_backup_command}
                    </Typography.Paragraph>
                    <CopyButton value={info.mysql_backup_command} />
                  </Space>
                </>
              )}
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 升级命令 */}
      <Card
        size="small"
        title="升级命令"
        extra={
          <Segmented
            value={cmdSource}
            onChange={(v) => setCmdSource(v as 'official' | 'cn')}
            options={[
              { label: '官方源', value: 'official' },
              { label: '国内镜像', value: 'cn' },
            ]}
          />
        }
      >
        <Tabs
          items={[
            {
              key: 'docker',
              label: 'Docker Compose',
              children: cmds ? (
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Typography.Paragraph code copyable style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginBottom: 0 }}>
                    {cmds.docker}
                  </Typography.Paragraph>
                </Space>
              ) : (
                <Typography.Text type="secondary">（当前部署方式无升级命令）</Typography.Text>
              ),
            },
            {
              key: 'linux',
              label: 'Linux 源码',
              children: cmds ? (
                <Typography.Paragraph code copyable style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginBottom: 0 }}>
                  {cmds.linux}
                </Typography.Paragraph>
              ) : (
                <Typography.Text type="secondary">（当前部署方式无升级命令）</Typography.Text>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  )
}
