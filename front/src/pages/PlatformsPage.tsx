import { Button, Card, Col, Flex, Input, Modal, Row, Segmented, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd'
import { CheckCircleFilled, GiftOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp } from 'antd'
import { platformOverview, platformSpeed, type PlatformOverviewCard, type PlatformSpeedRow } from '../api/platforms'
import { usePlatform } from '../context/PlatformContext'
import PageHeader from '../components/PageHeader'
import PlatformLogo from '../components/PlatformLogo'
import PlatformActionsBar from '../components/PlatformActionsBar'
import { FMT_EMPTY, fmtInt, fmtPct } from '../utils/format'

const TONE_COLOR: Record<string, string> = { brand: '#2E9BFF', warn: '#d9930d' }

export default function PlatformsPage() {
  const { platforms, current, select, platformKey } = usePlatform()
  const { message } = AntdApp.useApp()
  const [cards, setCards] = useState<PlatformOverviewCard[]>([])
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [inviteEnabled, setInviteEnabled] = useState(false)
  const [disabledMap, setDisabledMap] = useState<Record<string, { at: number; reason: string }>>({})
  const [bench, setBench] = useState<PlatformSpeedRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ov, sp] = await Promise.all([
        platformOverview(current.platform).catch(() => null),
        platformSpeed(24).catch(() => null),
      ])
      setCards((ov?.cards as PlatformOverviewCard[]) ?? [])
      setBench(sp?.items ?? [])
      try {
        const gw = await api<{ disabled?: Record<string, { at: number; reason: string }> }>('/api/gateway/config')
        setDisabledMap(gw?.disabled ?? {})
      } catch {
        /* 网关配置可选 */
      }
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.platform, current.realm])

  useEffect(() => {
    void load()
  }, [load, platformKey])

  const loadInvite = async () => {
    try {
      const r = await api<{ invite_code: string; enabled: boolean }>('/api/settings/invitation')
      setInviteCode(r.invite_code ?? '')
      setInviteEnabled(r.enabled ?? false)
    } catch {
      /* 可选功能 */
    }
  }

  const saveInvite = async () => {
    try {
      await api('/api/settings/invitation', { method: 'PUT', body: { value: inviteEnabled ? inviteCode : null } })
      message.success('邀请绑定已保存')
      setInviteOpen(false)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const togglePlatform = async (platformId: string, enable: boolean) => {
    try {
      await api(`/api/gateway/${enable ? 'enable' : 'disable'}`, {
        method: 'POST',
        body: { platform: platformId, reason: enable ? '' : '平台管理页手动禁用' },
      })
      message.success(enable ? `已启用 ${platformId}` : `已禁用 ${platformId}`)
      const gw = await api<{ disabled?: Record<string, { at: number; reason: string }> }>('/api/gateway/config')
      setDisabledMap(gw?.disabled ?? {})
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const spec = platforms.find((p) => p.id === current.platform)
  const realmOptions = (spec?.realms ?? []).map((r) => ({ label: r.label, value: r.key }))

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="平台管理"
        description={spec?.notes || '切换统计与调度口径'}
        actions={
          <Tooltip title="官方邀请绑定（注册时自动绑定到该邀请）">
            <Button icon={<GiftOutlined />} onClick={() => { void loadInvite(); setInviteOpen(true) }}>
              邀请绑定
            </Button>
          </Tooltip>
        }
      />
      <PlatformActionsBar spec={spec} onChanged={() => void load()} />

      {/* 平台卡片墙 */}
      <Card size="small" title="平台">
        <Row gutter={[12, 12]}>
          {platforms.map((p) => {
            const active = p.id === current.platform
            return (
              <Col key={p.id} xs={12} md={8} xl={6}>
                <Card
                  size="small"
                  hoverable
                  onClick={() => select(p.id, p.realm ?? p.realms?.find((r) => r.default)?.key ?? p.realms?.[0]?.key ?? null)}
                  style={active ? { borderColor: '#2E9BFF' } : undefined}
                >
                  <Flex align="center" justify="space-between" gap={6}>
                  <Space align="center">
                    <PlatformLogo id={p.id} icon={p.icon} size={36} />
                    <div>
                      <Space size={4}>
                        <Typography.Text strong>{p.label}</Typography.Text>
                        {active && <CheckCircleFilled style={{ color: '#2E9BFF' }} />}
                      </Space>
                      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                        {p.realm_label || (p.realms?.length ? `${p.realms.length} 个区域` : '')} · {fmtInt(p.account_count)} 个账号
                      </Typography.Text>
                    </div>
                  </Space>
                  <Tooltip title={disabledMap[p.id] ? `已禁用：${disabledMap[p.id]?.reason || '—'}` : '调度启用中'}>
                    <Switch
                      size="small"
                      checked={!disabledMap[p.id]}
                      onClick={(v, e) => {
                        e.stopPropagation()
                        void togglePlatform(p.id, v)
                      }}
                    />
                  </Tooltip>
                  </Flex>
                </Card>
              </Col>
            )
          })}
        </Row>
        {realmOptions.length > 0 && (
          <Segmented
            style={{ marginTop: 12 }}
            value={current.realm ?? ''}
            options={[{ label: '全部', value: '' }, ...realmOptions]}
            onChange={(v) => select(current.platform, (v as string) || null)}
          />
        )}
      </Card>

      {/* 当前平台概览（后端声明的卡片） */}
      <Card size="small" title={`当前平台概览${spec ? `：${spec.label}` : ''}`} loading={loading}>
        {cards.length === 0 ? (
          <Typography.Text type="secondary">该平台暂未提供概览数据</Typography.Text>
        ) : (
          <Row gutter={[12, 12]}>
            {cards.map((c, i) => (
              <Col key={i} xs={12} md={8} xl={6}>
                <Card size="small" styles={{ body: { padding: '10px 16px' } }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {String(c.label || c.key)}
                  </Typography.Text>
                  <Typography.Title level={4} style={{ margin: '4px 0 0', color: c.tone ? TONE_COLOR[c.tone] : undefined }}>
                    {typeof c.value === 'number' ? fmtInt(c.value) : String(c.value ?? FMT_EMPTY)}
                  </Typography.Title>
                  {typeof c.sub === 'string' && c.sub && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {String(c.sub)}
                    </Typography.Text>
                  )}
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>

      {/* 平台跑分 */}
      <Card size="small" title="平台速度与稳定性（近 24h）">
        <Table
          size="small"
          rowKey={(r) => String(r.platform ?? r.label)}
          loading={loading}
          dataSource={bench}
          pagination={false}
          columns={[
            { title: '排名', dataIndex: 'rank', width: 60, render: (v) => <Tag color={v === 1 ? 'gold' : 'default'}>#{v ?? FMT_EMPTY}</Tag> },
            { title: '平台', dataIndex: 'label' },
            { title: '请求数', dataIndex: 'requests', width: 90, align: 'right', render: (v) => <span className="num">{fmtInt(v)}</span> },
            { title: '成功率', dataIndex: 'success_rate', width: 90, align: 'right', render: (v) => <span className="num">{fmtPct(v, 1)}</span> },
            { title: 'TTFT P50', dataIndex: 'ttfb_p50', width: 100, align: 'right', render: (v) => <span className="num">{v ? `${Math.round(v)}ms` : FMT_EMPTY}</span> },
            { title: '延迟 P95', dataIndex: 'latency_p95', width: 100, align: 'right', render: (v) => <span className="num">{v ? `${Math.round(v)}ms` : FMT_EMPTY}</span> },
            { title: 'TPS P50', dataIndex: 'tps_p50', width: 90, align: 'right', render: (v) => <span className="num">{v ? v.toFixed(1) : FMT_EMPTY}</span> },
            { title: '波动', dataIndex: 'jitter', width: 80, align: 'right', render: (v) => <span className="num">{v ? `${Math.round(v)}ms` : FMT_EMPTY}</span> },
            { title: '跑分', dataIndex: 'score', width: 80, align: 'right', render: (v) => <Typography.Text strong className="num">{v ? v.toFixed(1) : FMT_EMPTY}</Typography.Text> },
            { title: '样本', dataIndex: 'samples', width: 70, align: 'right', render: (v, r) => <span className="num">{fmtInt(v)}{r.low_sample ? '⚠' : ''}</span> },
          ]}
        />
      </Card>

      <Modal
        title="WorkBuddy 官方邀请绑定"
        open={inviteOpen}
        onCancel={() => setInviteOpen(false)}
        onOk={() => void saveInvite()}
        okText="保存"
        width={480}
      >
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Space align="center">
            <Switch checked={inviteEnabled} onChange={setInviteEnabled} />
            <Input
              style={{ width: 280 }}
              placeholder="官方邀请码（启用后注册时自动绑定）"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              disabled={!inviteEnabled}
            />
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            自助注册（/join）所需凭证由后台独立管理；此处仅配置官方邀请绑定。
          </Typography.Text>
        </Space>
      </Modal>
    </Space>
  )
}
