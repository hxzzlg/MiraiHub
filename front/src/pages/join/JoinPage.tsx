import { Alert, App as AntdApp, Avatar, Button, Flex, Form, Input, Segmented, Space, Statistic, Steps, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { useCountdown } from '../../hooks/useCountdown'

interface Props {
  open?: boolean
}

interface DoneState {
  t?: number
  masked?: string
  invitation?: string
}

/** /join 公开自助注册页（邀请码 + 手机号验证码 / 官方授权两条路径） */
export default function JoinPage(_: Props = {}) {
  const { message } = AntdApp.useApp()
  const [step, setStep] = useState(0)
  const [path, setPath] = useState<'sms' | 'official'>('sms')
  const [form] = Form.useForm()
  const [sid, setSid] = useState('')
  const [invite, setInvite] = useState('')
  const [mobile, setMobile] = useState('')
  const [region, setRegion] = useState('86')
  const [code, setCode] = useState('')
  const [retry, setRetry] = useState(0)
  const [tick] = useCountdown(retry > 0 ? retry : null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<DoneState | null>(null)
  const [authUrl, setAuthUrl] = useState('')
  const [officialBusy, setOfficialBusy] = useState(false)
  const offTimer = useRef<number | null>(null)

  const LS_KEY = 'wb_join_done'
  const SS_KEY = 'wb_join_phone'

  // URL 完成态与 sessionStorage 会话恢复
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const urlInvite = q.get('invite') ?? q.get('invite_code')
    if (urlInvite) {
      setInvite(urlInvite)
      try {
        sessionStorage.setItem('mh_invite', urlInvite)
      } catch {
        /* ignore */
      }
    } else {
      try {
        setInvite(sessionStorage.getItem('mh_invite') ?? '')
      } catch {
        /* ignore */
      }
    }
    if (q.get('done') === '1') {
      setDone({ masked: q.get('m') ?? '', invitation: q.get('invitation') ?? '' })
      setStep(2)
    } else {
      try {
        const raw = localStorage.getItem(LS_KEY)
        if (raw) {
          const v = JSON.parse(raw) as DoneState
          if (v.t && Date.now() - v.t < 10 * 60_000) {
            setDone(v)
            setStep(2)
          }
        }
      } catch {
        /* ignore */
      }
    }
    try {
      const raw = sessionStorage.getItem(SS_KEY)
      if (raw) {
        const v = JSON.parse(raw) as { sid?: string; mobile?: string; country?: string; retryUntil?: number; savedAt?: number }
        if (v.savedAt && Date.now() - v.savedAt < 20 * 60_000 && v.sid) {
          setSid(v.sid)
          setMobile(v.mobile ?? '')
          setRegion(v.country ?? '86')
          setRetry(Math.max(0, Math.round(((v.retryUntil ?? 0) - Date.now()) / 1000)))
          setStep(1)
          void restoreStatus(v.sid)
        }
      }
    } catch {
      /* ignore */
    }
    return () => {
      if (offTimer.current) window.clearInterval(offTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = (v: Record<string, unknown> | null) => {
    try {
      if (v) sessionStorage.setItem(SS_KEY, JSON.stringify({ ...v, savedAt: Date.now() }))
      else sessionStorage.removeItem(SS_KEY)
    } catch {
      /* ignore */
    }
  }

  const joinHeaders = (): Record<string, string> => (invite.trim() ? { 'X-Join-Invite': invite.trim() } : {})

  const restoreStatus = async (restoreSid: string) => {
    try {
      await api<{ alive: boolean }>(`/api/join/status/${restoreSid}`, { headers: joinHeaders() })
    } catch {
      persist(null)
      setStep(0)
    }
  }

  const start = async () => {
    if (!invite.trim()) {
      message.warning('请输入邀请凭证')
      return
    }
    if (!/^\d{7,12}$/.test(mobile.trim())) {
      message.warning('请输入有效手机号')
      return
    }
    setBusy(true)
    try {
      const r = await api<{ sid: string }>('/api/join/start', {
        method: 'POST',
        headers: joinHeaders(),
        body: { invite_code: invite.trim(), mobile: mobile.trim(), country_code: region },
        skipPlatform: true,
      })
      setSid(r.sid)
      persist({ sid: r.sid, mobile: mobile.trim(), country: region })
      await sendCode(r.sid)
    } catch (e) {
      message.error((e as Error).message || '发起失败')
    } finally {
      setBusy(false)
    }
  }

  const sendCode = async (targetSid?: string) => {
    const useSid = targetSid ?? sid
    setBusy(true)
    try {
      const r = await api<{ retry_after?: number; reason?: string }>('/api/join/send', {
        method: 'POST',
        headers: joinHeaders(),
        body: { sid: useSid, mobile: mobile.trim(), country_code: region },
        skipPlatform: true,
      })
      if (r.reason === 'need_captcha') {
        message.info('该号码需要官方授权验证，已切换到官方授权流程')
        setPath('official')
        await startOfficial(useSid)
        return
      }
      setRetry(r.retry_after ?? 60)
      persist({ sid: useSid, mobile: mobile.trim(), country: region, retryUntil: Date.now() + (r.retry_after ?? 60) * 1000 })
      setStep(1)
      message.success('验证码已发送')
    } catch (e) {
      const err = e as Error & { data?: { message?: string } }
      message.error(err.data?.message || err.message || '发送失败')
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!/^\d{4,8}$/.test(code.trim())) {
      message.warning('请输入验证码')
      return
    }
    setBusy(true)
    try {
      const r = await api<{ ok?: boolean; masked?: string; invitation?: string; message?: string }>('/api/join/verify', {
        method: 'POST',
        headers: joinHeaders(),
        body: { sid, sms_code: code.trim() },
        skipPlatform: true,
      })
      const d: DoneState = { t: Date.now(), masked: r.masked ?? mobile.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'), invitation: r.invitation ?? r.message ?? '' }
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(d))
      } catch {
        /* ignore */
      }
      setDone(d)
      setStep(2)
      persist(null)
    } catch (e) {
      message.error((e as Error).message || '验证失败')
    } finally {
      setBusy(false)
    }
  }

  const startOfficial = async (targetSid?: string) => {
    setOfficialBusy(true)
    try {
      const r = await api<{ sid: string; auth_url: string }>('/api/join/official/start', {
        method: 'POST',
        headers: joinHeaders(),
        body: { invite_code: invite.trim(), mobile: mobile.trim() || undefined },
        skipPlatform: true,
      })
      setSid(r.sid)
      setAuthUrl(r.auth_url)
      window.open(r.auth_url, '_blank', 'noopener')
      // 2.5s 轮询授权结果（6 分钟超时）
      let waited = 0
      if (offTimer.current) window.clearInterval(offTimer.current)
      offTimer.current = window.setInterval(async () => {
        waited += 2500
        if (waited > 6 * 60_000) {
          if (offTimer.current) window.clearInterval(offTimer.current)
          message.warning('授权等待超时，可重新发起')
          return
        }
        try {
          const p = await api<{ status: string; masked?: string; invitation?: string }>('/api/join/official/poll', {
            method: 'POST',
            headers: joinHeaders(),
            body: { sid: targetSid ?? r.sid },
            skipPlatform: true,
          })
          if (p.status === 'done') {
            if (offTimer.current) window.clearInterval(offTimer.current)
            const d: DoneState = { t: Date.now(), masked: p.masked ?? '', invitation: p.invitation ?? '' }
            try {
              localStorage.setItem(LS_KEY, JSON.stringify(d))
            } catch {
              /* ignore */
            }
            setDone(d)
            setStep(2)
            persist(null)
          }
        } catch {
          /* 轮询失败忽略 */
        }
      }, 2500)
    } catch (e) {
      message.error((e as Error).message || '发起官方授权失败')
    } finally {
      setOfficialBusy(false)
    }
  }

  const stepItems = [
    { title: '邀请凭证' },
    { title: path === 'official' ? '官方授权' : '验证码' },
    { title: '完成' },
  ]

  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', padding: 16 }}>
      <Space orientation="vertical" align="center" size={16} style={{ width: 460, maxWidth: '100%' }}>
        <Space orientation="vertical" align="center" size={4}>
          <Avatar shape="square" size={44} src="/api/app/icon" />
          <Typography.Title level={4} style={{ margin: 0 }}>
            加入 MiraiHub
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            手机号授权后自动开通共享网关访问
          </Typography.Text>
        </Space>

        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Steps size="small" current={step} items={stepItems} />

          {step === 0 && (
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              <Segmented
                block
                value={path}
                onChange={(v) => setPath(v as 'sms' | 'official')}
                options={[
                  { label: '手机号验证码', value: 'sms' },
                  { label: '官方授权', value: 'official' },
                ]}
              />
              <Form form={form} layout="vertical">
                <Form.Item label="邀请凭证" required>
                  <Input
                    placeholder="后台生成的邀请码"
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                  />
                </Form.Item>
                {path === 'sms' ? (
                  <Form.Item label="手机号" required>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        style={{ width: 70 }}
                        prefix="+"
                        value={region}
                        onChange={(e) => setRegion(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      />
                      <Input
                        placeholder="手机号"
                        maxLength={12}
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                        onPressEnter={() => void start()}
                      />
                    </Space.Compact>
                  </Form.Item>
                ) : (
                  <Form.Item label="手机号（可选）">
                    <Input
                      placeholder="用于匹配已有账号"
                      maxLength={12}
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                    />
                  </Form.Item>
                )}
                {path === 'sms' ? (
                  <Button type="primary" block loading={busy} onClick={() => void start()}>
                    获取验证码
                  </Button>
                ) : (
                  <Button type="primary" block loading={officialBusy} onClick={() => void startOfficial()}>
                    打开官方授权页
                  </Button>
                )}
              </Form>
            </Space>
          )}

          {step === 1 && path === 'sms' && (
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              <Typography.Text>
                验证码已发送至 <Typography.Text strong>+{region} {mobile}</Typography.Text>
              </Typography.Text>
              <Input.OTP
                length={6}
                value={code}
                onChange={(v) => setCode(v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void verify()
                }}
              />
              <Flex gap={8}>
                <Button type="primary" block loading={busy} onClick={() => void verify()}>
                  验证并开通
                </Button>
                <Button disabled={tick > 0} onClick={() => void sendCode()}>
                  {tick > 0 ? `${tick}s` : '重发'}
                </Button>
              </Flex>
              <Button type="link" size="small" onClick={() => setStep(0)}>
                ← 返回修改
              </Button>
            </Space>
          )}

          {step === 1 && path === 'official' && (
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              <Typography.Text>1. 已打开官方授权页（若被拦截，点下面链接）：</Typography.Text>
              <Button block onClick={() => window.open(authUrl, '_blank', 'noopener')}>
                打开授权页
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                2. 在官方页面完成手机号授权后，本页会自动检测并显示结果（最长等待 6 分钟）。
              </Typography.Text>
              <Flex align="center" justify="center" gap={8}>
                <Alert type="info" showIcon title="等待授权完成…" />
              </Flex>
            </Space>
          )}

          {step === 2 && done && (
            <Space orientation="vertical" size={12} style={{ width: '100%' }} align="center">
              <Statistic title="授权手机号" value={done.masked || '已完成'} />
              {done.invitation && (
                <Typography.Text type="secondary">{done.invitation}</Typography.Text>
              )}
              <Alert
                type="success"
                showIcon
                title="开通成功"
                description="网关访问凭证已自动入库。回到管理后台即可在账号池看到新账号。"
              />
              <Button block onClick={() => window.location.assign('/admin')}>
                前往管理后台
              </Button>
            </Space>
          )}
        </Space>

        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          页面仅请求你的手机号授权，不会索取密码；服务端自动完成整条 auth 授权。
        </Typography.Text>
      </Space>
    </Flex>
  )
}
