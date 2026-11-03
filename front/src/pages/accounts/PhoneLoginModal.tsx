import { Alert, App as AntdApp, Button, Flex, Input, Modal, Select, Space, Statistic, Steps, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { useCountdown } from '../../hooks/useCountdown'

interface Props {
  open: boolean
  /** 重登已有账号时传账号 id */
  accountId?: number
  onClose: () => void
  onSuccess?: () => void
}

interface VerifyResult {
  ok?: boolean
  duplicated?: boolean
  message?: string
  uid?: string
  account?: { id: number; name: string; balance_total?: number; balance_remain?: number }
  invitation?: { status?: string; message?: string } | null
  [k: string]: unknown
}

const REGIONS = [
  { value: '86', label: '+86 中国大陆' },
  { value: '852', label: '+852 中国香港' },
  { value: '853', label: '+853 中国澳门' },
]

/** 手机号登录三步流（start → send → verify），会话存 sessionStorage 可恢复 */
export default function PhoneLoginModal({ open, accountId, onClose, onSuccess }: Props) {
  const { message } = AntdApp.useApp()
  const [step, setStep] = useState(0)
  const [region, setRegion] = useState('86')
  const [mobile, setMobile] = useState('')
  const [code, setCode] = useState('')
  const [sid, setSid] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [retryLeft, setRetryLeft] = useState(0)
  const [result, setResult] = useState<VerifyResult | null>(null)
  const countdown = useRef<number | null>(null)
  const [tick] = useCountdown(retryLeft > 0 ? retryLeft : null)

  const SS_KEY = 'wb_admin_phone'

  const persist = (v: Record<string, unknown> | null) => {
    try {
      if (v) sessionStorage.setItem(SS_KEY, JSON.stringify({ ...v, savedAt: Date.now() }))
      else sessionStorage.removeItem(SS_KEY)
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!open) {
      setStep(0)
      setCode('')
      setResult(null)
      return
    }
    // 恢复未完成会话
    try {
      const raw = sessionStorage.getItem(SS_KEY)
      if (raw) {
        const v = JSON.parse(raw)
        if (v.savedAt && Date.now() - v.savedAt < 20 * 60_000 && v.sid && v.mobile) {
          setSid(v.sid)
          setMobile(v.mobile)
          setRegion(v.country || '86')
          setRetryLeft(Math.max(0, Math.round(((v.retryUntil || 0) - Date.now()) / 1000)))
          setStep(1)
        }
      }
    } catch {
      /* ignore */
    }
  }, [open])

  useEffect(() => () => { if (countdown.current) window.clearInterval(countdown.current) }, [])

  const startAndSend = async () => {
    if (!/^\d{7,12}$/.test(mobile.trim())) {
      message.warning('请输入有效手机号')
      return
    }
    setSending(true)
    try {
      const r = await api<{ sid: string }>('/api/login/start', { method: 'POST', body: accountId ? { account_id: accountId } : {}, skipPlatform: true })
      const newSid = r.sid
      setSid(newSid)
      const send = await api<{ retry_after?: number }>('/api/login/send', {
        method: 'POST',
        body: { sid: newSid, mobile: mobile.trim(), country_code: region },
        skipPlatform: true,
      })
      persist({ sid: newSid, mobile: mobile.trim(), country: region, retryUntil: Date.now() + (send.retry_after ?? 60) * 1000 })
      setRetryLeft(send.retry_after ?? 60)
      setStep(1)
      message.success('验证码已发送')
    } catch (e) {
      const err = e as Error & { data?: { message?: string } }
      message.error(err.data?.message || err.message || '发送失败')
    } finally {
      setSending(false)
    }
  }

  const resend = async () => {
    setSending(true)
    try {
      const send = await api<{ retry_after?: number }>('/api/login/send', {
        method: 'POST',
        body: { sid, mobile: mobile.trim(), country_code: region },
        skipPlatform: true,
      })
      persist({ sid, mobile: mobile.trim(), country: region, retryUntil: Date.now() + (send.retry_after ?? 60) * 1000 })
      setRetryLeft(send.retry_after ?? 60)
      message.success('验证码已重发')
    } catch (e) {
      const err = e as Error & { data?: { message?: string } }
      message.error(err.data?.message || err.message || '重发失败')
    } finally {
      setSending(false)
    }
  }

  const verify = async () => {
    if (!/^\d{4,8}$/.test(code.trim())) {
      message.warning('请输入验证码')
      return
    }
    setVerifying(true)
    try {
      const r = await api<VerifyResult>('/api/login/verify', {
        method: 'POST',
        body: accountId ? { sid, code: code.trim(), account_id: accountId } : { sid, code: code.trim() },
        skipPlatform: true,
      })
      setResult(r)
      persist(null)
      setStep(2)
      onSuccess?.()
    } catch (e) {
      const err = e as Error & { data?: { message?: string } }
      message.error(err.data?.message || err.message || '验证失败')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <Modal
      title={accountId ? `重新登录账号 #${accountId}` : '手机号登录入号'}
      open={open}
      onCancel={() => {
        persist(null)
        onClose()
      }}
      footer={null}
      width={480}
      mask={{ closable: false }}
    >
      <Steps
        size="small"
        current={step}
        style={{ marginBottom: 16 }}
        items={[{ title: '手机号' }, { title: '验证码' }, { title: '完成' }]}
      />
      {step === 0 && (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Space.Compact style={{ width: '100%' }}>
            <Select value={region} onChange={setRegion} style={{ width: 150 }} options={REGIONS} />
            <Input
              placeholder="手机号"
              value={mobile}
              maxLength={12}
              onChange={(e) => setMobile(e.target.value)}
              onPressEnter={() => void startAndSend()}
            />
          </Space.Compact>
          <Button type="primary" block loading={sending} onClick={() => void startAndSend()}>
            获取验证码
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            将向上游发起手机号授权，验证码由上游官方下发。
          </Typography.Text>
        </Space>
      )}
      {step === 1 && (
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
            <Button type="primary" block loading={verifying} onClick={() => void verify()}>
              验证并入号
            </Button>
            <Button disabled={tick > 0} onClick={() => void resend()}>
              {tick > 0 ? `${tick}s 后重发` : '重发'}
            </Button>
          </Flex>
          <Button type="link" size="small" onClick={() => setStep(0)}>
            ← 换一个号码
          </Button>
        </Space>
      )}
      {step === 2 && result && (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type={result.ok === false ? 'error' : 'success'}
            showIcon
            title={result.ok === false ? result.message || '入号失败' : result.duplicated ? '该账号已存在，凭证已更新' : '入号成功'}
          />
          {result.account && (
            <Space size={24}>
              <Statistic title="账号" value={result.account.name} styles={{ content: { fontSize: 15 } }} />
              <Statistic title="总额" value={result.account.balance_total ?? '—'} styles={{ content: { fontSize: 15 } }} />
              <Statistic title="剩余" value={result.account.balance_remain ?? '—'} styles={{ content: { fontSize: 15 } }} />
            </Space>
          )}
          {result.invitation?.message && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              邀请绑定：{result.invitation.message}
            </Typography.Text>
          )}
          <Button type="primary" block onClick={() => onClose()}>
            完成
          </Button>
        </Space>
      )}
    </Modal>
  )
}
