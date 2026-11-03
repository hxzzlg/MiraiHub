import { Alert, App as AntdApp, Button, Flex, Input, Modal, Spin, Steps, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { platformMeta, qoderDevicePoll, qoderDeviceStart, traeDeviceCallback, traeDevicePoll, traeDeviceStart } from '../api/platformOps'

interface Props {
  open: boolean
  storage: string
  realm?: string | null
  onClose: () => void
  onDone?: () => void
}

type Phase = 'idle' | 'waiting' | 'done' | 'failed'

/**
 * 浏览器/设备授权弹窗：
 *  - Trae（auth_mode=callback）：PKCE 回调 —— 服务器部署时回调打到用户本机，需手动粘贴回调链接
 *  - Qoder（auth_mode=device-poll）：设备码 —— 凭证由服务端轮询取回，任意设备确认即可
 */
export default function DeviceAuthModal({ open, storage, realm, onClose, onDone }: Props) {
  const { message: _message } = AntdApp.useApp()
  const [mode, setMode] = useState<'callback' | 'device-poll' | ''>('')
  const [explain, setExplain] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [userCode, setUserCode] = useState('')
  const [hint, setHint] = useState('')
  const [nonce, setNonce] = useState('')
  const [paste, setPaste] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [accountName, setAccountName] = useState('')
  const timerRef = useRef<number | null>(null)

  const stopPoll = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => stopPoll, [])
  useEffect(() => {
    if (!open) {
      stopPoll()
      setPhase('idle')
      setErrMsg('')
      setAccountName('')
      setPaste('')
    }
  }, [open])

  const start = async () => {
    setPhase('waiting')
    setErrMsg('')
    try {
      const meta = await platformMeta(storage).catch(() => null)
      const m = (meta?.auth_mode as 'callback' | 'device-poll') || 'device-poll'
      setMode(m)
      setExplain(String(meta?.auth_explain || ''))
      if (m === 'callback') {
        const r = await traeDeviceStart(realm)
        setAuthUrl(String(r.auth_url || ''))
        setHint(String(r.callback_hint || ''))
        setNonce(String(r.nonce || ''))
        // 服务端已能收到回调时自动轮询；否则等用户粘贴
        if (r.callback_reachable && r.nonce) {
          timerRef.current = window.setInterval(async () => {
            try {
              const s = await traeDevicePoll(r.nonce!)
              if (s.status === 'done' || s.account) {
                stopPoll()
                setPhase('done')
                setAccountName(String(s.account?.name || ''))
                onDone?.()
              } else if (s.status === 'failed' || s.error) {
                stopPoll()
                setPhase('failed')
                setErrMsg(String(s.error || '授权失败'))
              }
            } catch {
              /* 忽略单次失败 */
            }
          }, 2000)
        }
      } else {
        const r = await qoderDeviceStart(realm)
        setAuthUrl(String(r.verification_url || r.auth_url || ''))
        setUserCode(String(r.user_code || ''))
        setNonce(String(r.nonce || ''))
        if (r.nonce) {
          timerRef.current = window.setInterval(async () => {
            try {
              const s = await qoderDevicePoll(r.nonce!)
              if (s.status === 'done' || s.account) {
                stopPoll()
                setPhase('done')
                setAccountName(String(s.account?.name || ''))
                onDone?.()
              } else if (s.status === 'failed' || s.error) {
                stopPoll()
                setPhase('failed')
                setErrMsg(String(s.error || '授权失败'))
              }
            } catch {
              /* 忽略单次失败 */
            }
          }, 3000)
        }
      }
    } catch (e) {
      setPhase('failed')
      setErrMsg((e as Error).message)
    }
  }

  const submitPaste = async () => {
    const url = paste.trim()
    if (!url || !nonce) return
    try {
      await traeDeviceCallback(nonce, url)
      setPhase('done')
      onDone?.()
      void pollOnceForName()
    } catch (e) {
      setErrMsg((e as Error).message)
    }
  }

  const pollOnceForName = async () => {
    try {
      const s = await traeDevicePoll(nonce)
      setAccountName(String(s.account?.name || ''))
    } catch {
      /* ignore */
    }
  }

  const step = phase === 'idle' ? 0 : phase === 'waiting' ? 1 : 2

  return (
    <Modal
      title={`${storage.toUpperCase()} 授权接入`}
      open={open}
      onCancel={() => {
        stopPoll()
        onClose()
      }}
      footer={
        phase === 'idle'
          ? [
              <Button key="cancel" onClick={onClose}>
                取消
              </Button>,
              <Button key="start" type="primary" onClick={() => void start()}>
                开始授权
              </Button>,
            ]
          : phase === 'done'
            ? [<Button key="ok" type="primary" onClick={onClose}>完成</Button>]
            : [
                <Button key="close" onClick={onClose}>
                  关闭
                </Button>,
              ]
      }
      width={560}
    >
      <Steps
        size="small"
        style={{ marginBottom: 16 }}
        current={step}
        status={phase === 'failed' ? 'error' : undefined}
        items={[{ title: '发起授权' }, { title: '浏览器确认' }, { title: '完成' }]}
      />
      {explain && mode && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {explain}
        </Typography.Paragraph>
      )}
      {phase === 'idle' && (
        <Typography.Text type="secondary">点击"开始授权"生成授权链接。</Typography.Text>
      )}
      {phase === 'waiting' && (
        <Flex vertical gap={12}>
          {authUrl && (
            <Flex vertical gap={4}>
              <Typography.Text>1. 打开授权链接并登录：</Typography.Text>
              <Flex gap={8} align="center">
                <Typography.Text copyable={{ text: authUrl }} style={{ wordBreak: 'break-all', flex: 1 }}>
                  {authUrl}
                </Typography.Text>
                <Button size="small" type="primary" onClick={() => window.open(authUrl, '_blank', 'noopener')}>
                  打开
                </Button>
              </Flex>
            </Flex>
          )}
          {userCode && (
            <Typography.Text>
              确认码：<Typography.Text copyable strong>{userCode}</Typography.Text>
            </Typography.Text>
          )}
          {mode === 'callback' && (
            <Flex vertical gap={4}>
              <Typography.Text>2. 授权完成后（回调打不开是正常的），把地址栏完整链接粘贴到这里：</Typography.Text>
              <Input.TextArea
                rows={2}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                onPaste={() => setTimeout(() => {
                  const el = document.activeElement as HTMLTextAreaElement | null
                  if (el && el.value && el.value.includes('http')) void submitPaste()
                }, 120)}
                placeholder="http://127.0.0.1:8790/authorize?code=...&state=..."
              />
              <Button type="primary" disabled={!paste.trim()} onClick={() => void submitPaste()}>
                提交回调链接
              </Button>
            </Flex>
          )}
          <Flex align="center" gap={8}>
            <Spin size="small" />
            <Typography.Text type="secondary">等待授权完成…</Typography.Text>
          </Flex>
        </Flex>
      )}
      {hint && phase === 'waiting' && (
        <Alert style={{ marginTop: 12 }} type="info" showIcon title={hint} />
      )}
      {phase === 'done' && (
        <Alert type="success" showIcon title={`授权成功${accountName ? `：${accountName}` : ''}`} />
      )}
      {phase === 'failed' && <Alert type="error" showIcon title={errMsg || '授权失败'} />}
    </Modal>
  )
}
