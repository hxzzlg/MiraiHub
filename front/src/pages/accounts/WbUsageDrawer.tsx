import { App as AntdApp, Button, Modal, Table, Typography } from 'antd'
import { useState } from 'react'
import { api } from '../../api/client'
import { FMT_EMPTY, fmtCredit, fmtTime } from '../../utils/format'

interface WbAccount {
  id: number
  name: string
  uid: string
  status: string
  balance_remain: number
  last_used_at?: string | null
}

interface UsageRow {
  [k: string]: unknown
}

/**
 * WorkBuddy 用量明细：列出账号池账号，点击查看该账号的上游请求用量
 * （GET /api/accounts/{id}/request-usage 动态列）。
 */
export function WbUsageDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = AntdApp.useApp()
  const [rows, setRows] = useState<WbAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [usageFor, setUsageFor] = useState<WbAccount | null>(null)
  const [usageRows, setUsageRows] = useState<UsageRow[]>([])
  const [usageLoading, setUsageLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api<{ items: WbAccount[] }>('/api/accounts?page_size=500')
      setRows(r.items ?? [])
    } catch (e) {
      message.error((e as Error).message || '账号加载失败')
    } finally {
      setLoading(false)
    }
  }

  const openUsage = async (a: WbAccount) => {
    setUsageFor(a)
    setUsageLoading(true)
    try {
      const r = await api<{ items?: UsageRow[] }>(`/api/accounts/${a.id}/request-usage?page_num=1&page_size=50`)
      setUsageRows(r.items ?? [])
    } catch {
      setUsageRows([])
    } finally {
      setUsageLoading(false)
    }
  }

  const usageCols = usageRows[0]
    ? Object.keys(usageRows[0])
        .filter((k) => typeof usageRows[0][k] !== 'object')
        .slice(0, 8)
        .map((k) => ({
          title: k,
          dataIndex: k,
          ellipsis: true,
          render: (v: unknown) => String(v ?? FMT_EMPTY),
        }))
    : []

  return (
    <>
      <Modal
        title="用量明细（WorkBuddy）"
        open={open}
        onCancel={onClose}
        footer={null}
        width={760}
        styles={{ body: { maxHeight: '68vh', overflow: 'auto' } }}
        afterOpenChange={(v) => {
          if (v) void load()
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          选择账号查看该账号的上游请求用量明细。
        </Typography.Text>
        <Table
          size="small"
          scroll={{ x: 'max-content' }}
          rowKey="id"
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '账号', dataIndex: 'name', ellipsis: true },
            { title: 'UID', dataIndex: 'uid', ellipsis: true, render: (v) => <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text> },
            { title: '状态', dataIndex: 'status', width: 80, render: (v) => (v === 'active' ? '启用' : '停用') },
            { title: '余额', dataIndex: 'balance_remain', width: 100, align: 'right', render: (v) => <span className="num">{fmtCredit(v)}</span> },
            { title: '最近使用', dataIndex: 'last_used_at', width: 130, render: (v) => <span className="num">{fmtTime(v ?? null)}</span> },
            {
              title: '操作',
              width: 110,
              render: (_, r) => (
                <Button type="link" size="small" onClick={() => void openUsage(r)}>
                  请求用量
                </Button>
              ),
            },
          ]}
        />
      </Modal>
      <Modal
        title={`上游请求用量：${usageFor?.name ?? ''}`}
        open={!!usageFor}
        onCancel={() => setUsageFor(null)}
        footer={null}
        width={860}
        styles={{ body: { maxHeight: '68vh', overflow: 'auto' } }}
      >
        <Table size="small" scroll={{ x: 'max-content' }} rowKey={(_, i) => String(i)} loading={usageLoading} dataSource={usageRows} pagination={{ pageSize: 10 }} columns={usageCols} />
      </Modal>
    </>
  )
}
