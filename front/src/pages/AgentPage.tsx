import {
  App as AntdApp,
  Avatar,
  Button,
  Card,
  Col,
  Drawer,
  Flex,
  Input,
  Listy,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { ClearOutlined, DeleteOutlined, PlusOutlined, SendOutlined, StopOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

interface VideoModel {
  id: string
  name?: string
  resolutions: string[]
  default_resolution: string
  aspect_ratios: string[]
  default_aspect_ratio: string
  min_seconds: number
  max_seconds: number
  default_seconds: number | null
  supported_seconds: number[]
}

interface Bootstrap {
  key: { id: number; name: string; unlimited?: boolean; credit_limit?: number; credit_used?: number } | null
  models: { chat: string[]; image: string[]; video: string[] }
  video: VideoModel[]
  estimates: { video_per_second?: number; video_factors?: Record<string, number>; image_per_unit?: number }
  merge: { available: boolean; engine?: string; max_segments?: number }
  presets: { image: { id: string; label: string; icon?: string; size?: string; prompt?: string }[]; video: { id: string; label: string; icon?: string; seconds?: number; resolution?: string; aspect_ratio?: string; prompt?: string }[] }
  limits: { max_tool_steps?: number; context_budget?: number }
}

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  reasoningMs?: number
  tools?: { tool: string; label?: string; ok?: boolean; summary?: string; ms?: number }[]
  media?: { asset_id: string; kind: string; model?: string; duration_s?: number; credits?: number; url?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; credits?: number }
  error?: string
}

interface Conversation {
  conversation_id: string
  title: string
  mode?: string
  pinned?: boolean
  updated_at?: string
}

interface Prefs {
  mode: 'chat' | 'image' | 'video'
  model: string
  reasoning: '' | 'low' | 'high'
  imageModel: string
  imageSize: string
  videoModel: string
  videoResolution: string
  videoAspect: string
  videoSeconds: number
}

const LS_PREFS = 'wb_agent_prefs'

export default function AgentPage() {
  const { message } = AntdApp.useApp()
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [convId, setConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [context, setContext] = useState<{ used_tokens?: number; budget_tokens?: number; percent?: number } | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sideOpen, setSideOpen] = useState(false)
  const [paramsOpen, setParamsOpen] = useState(false)
  const [assets, setAssets] = useState<{ asset_id: string; kind?: string; url?: string }[]>([])
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set())
  const [estimate, setEstimate] = useState<{ credits: number; range?: number[] } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamBoxRef = useRef<HTMLDivElement>(null)
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_PREFS) ?? '{}') as Partial<Prefs> as Prefs
    } catch {
      return {} as Prefs
    }
  })

  const setPref = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const defaults: Prefs = {
        mode: 'chat',
        model: '',
        reasoning: '',
        imageModel: '',
        imageSize: '',
        videoModel: '',
        videoResolution: '',
        videoAspect: '',
        videoSeconds: 5,
      }
      const next: Prefs = { ...defaults, ...p, ...patch }
      try {
        localStorage.setItem(LS_PREFS, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })

  const loadBootstrap = useCallback(async () => {
    try {
      const r = await api<Bootstrap>('/api/agent/bootstrap')
      setBoot(r)
      setPref({
        model: prefs.model || r.models.chat[0] || '',
        imageModel: prefs.imageModel || r.models.image[0] || '',
        videoModel: prefs.videoModel || r.video[0]?.id || '',
        videoResolution: prefs.videoResolution || r.video[0]?.default_resolution || '',
        videoAspect: prefs.videoAspect || r.video[0]?.default_aspect_ratio || '',
        videoSeconds: prefs.videoSeconds || r.video[0]?.default_seconds || r.video[0]?.min_seconds || 5,
      })
    } catch (e) {
      message.error((e as Error).message || '智能体初始化失败')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadConversations = useCallback(async () => {
    try {
      const r = await api<{ items: Conversation[] }>('/api/agent/conversations?limit=40')
      setConversations(r.items ?? [])
    } catch {
      /* ignore */
    }
  }, [])

  const loadAssets = useCallback(async () => {
    try {
      const r = await api<{ items?: { asset_id: string; kind?: string }[] }>('/api/agent/assets?limit=24')
      setAssets((r.items ?? []).map((a) => ({ ...a, url: `/api/agent/assets/${a.asset_id}` })))
    } catch {
      /* ignore */
    }
  }, [])

  const openConversation = useCallback(async (id: string) => {
    try {
      const r = await api<{ messages: ChatMsg[]; context?: typeof context; conversation_id: string }>(`/api/agent/conversations/${id}`)
      setConvId(id)
      setMessages(r.messages ?? [])
      setContext(r.context ?? null)
    } catch (e) {
      message.error((e as Error).message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const newConversation = () => {
    setConvId(null)
    setMessages([])
    setContext(null)
  }

  useEffect(() => {
    void loadBootstrap()
    void loadConversations()
    void loadAssets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 滚动跟随
  useEffect(() => {
    streamBoxRef.current?.scrollTo({ top: streamBoxRef.current.scrollHeight })
  }, [messages])

  // 积分预估（160ms 防抖）
  useEffect(() => {
    if (prefs.mode === 'chat') {
      setEstimate(null)
      return
    }
    const t = window.setTimeout(async () => {
      try {
        const body: Record<string, unknown> =
          prefs.mode === 'image'
            ? { kind: 'image', count: 1, size: prefs.imageSize, model: prefs.imageModel }
            : { kind: 'video', seconds: prefs.videoSeconds, resolution: prefs.videoResolution, model: prefs.videoModel }
        const r = await api<{ credits: number; credits_range?: number[] }>('/api/agent/estimate', { method: 'POST', body })
        setEstimate({ credits: r.credits, range: r.credits_range })
      } catch {
        setEstimate(null)
      }
    }, 160)
    return () => window.clearTimeout(t)
  }, [prefs.mode, prefs.imageSize, prefs.imageModel, prefs.videoSeconds, prefs.videoResolution, prefs.videoModel])

  /* ---------- SSE 聊天流（fetch + ReadableStream 手工分帧） ---------- */
  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return
    const userMsg: ChatMsg = { role: 'user', content: text }
    const assistant: ChatMsg = { role: 'assistant', content: '' }
    setMessages((m) => [...m, userMsg, assistant])
    setInput('')
    setStreaming(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const videoSpec =
      prefs.mode === 'video'
        ? {
            model: prefs.videoModel,
            resolution: prefs.videoResolution,
            aspect_ratio: prefs.videoAspect,
            seconds: prefs.videoSeconds,
          }
        : undefined
    const imageSpec =
      prefs.mode === 'image'
        ? {
            model: prefs.imageModel,
            ...(prefs.imageSize ? { size: prefs.imageSize } : {}),
          }
        : undefined

    try {
      const resp = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': localStorage.getItem('wb_admin_token') ?? '',
        },
        body: JSON.stringify({
          message: text,
          conversation_id: convId ?? undefined,
          mode: prefs.mode,
          model: prefs.mode === 'chat' ? prefs.model : prefs.mode === 'image' ? prefs.imageModel : prefs.videoModel,
          reasoning: prefs.mode === 'chat' && prefs.reasoning ? prefs.reasoning : undefined,
          image: imageSpec,
          video: videoSpec,
        }),
        signal: ctrl.signal,
      })
      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => '')
        throw new Error(errText || `HTTP ${resp.status}`)
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      const patch = (fn: (m: ChatMsg) => ChatMsg) => setMessages((m) => [...m.slice(0, -1), fn({ ...m[m.length - 1] })])

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'))
          if (!dataLine) continue
          let ev: Record<string, unknown>
          try {
            ev = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>
          } catch {
            continue
          }
          const type = ev.type as string
          if (type === 'meta') {
            const newId = ev.conversation_id as string
            if (newId && !convId) setConvId(newId)
            setContext((ev.context as typeof context) ?? null)
          } else if (type === 'delta') {
            patch((m) => ({ ...m, content: m.content + String(ev.delta ?? '') }))
          } else if (type === 'reasoning') {
            patch((m) => ({ ...m, reasoning: (m.reasoning ?? '') + String(ev.delta ?? ev.text ?? '') }))
          } else if (type === 'tool_start') {
            patch((m) => ({ ...m, tools: [...(m.tools ?? []), { tool: String(ev.tool ?? ''), label: String(ev.label ?? '') }] }))
          } else if (type === 'tool_end') {
            patch((m) => {
              const tools = [...(m.tools ?? [])]
              const i = tools.findIndex((t) => t.tool === ev.tool && !t.ok && t.summary === undefined)
              if (i >= 0) tools[i] = { ...tools[i], ok: ev.ok !== false, summary: String(ev.summary ?? ''), ms: ev.ms as number }
              return { ...m, tools }
            })
          } else if (type === 'media') {
            const asset = ev.asset as { asset_id: string; kind: string; model?: string; duration_s?: number; credits?: number }
            patch((m) => ({ ...m, media: [...(m.media ?? []), { ...asset, url: `/api/agent/assets/${asset.asset_id}` }] }))
            void loadAssets()
          } else if (type === 'done') {
            patch((m) => ({ ...m, usage: ev.usage as ChatMsg['usage'] }))
            setContext((ev.context as typeof context) ?? null)
          } else if (type === 'error') {
            patch((m) => ({ ...m, error: String(ev.message ?? '生成失败') }))
          } else if (type === 'notice') {
            message.info(String(ev.message ?? ev.text ?? ''))
          }
        }
      }
    } catch (e) {
      const err = e as Error
      if (err.name !== 'AbortError') {
        setMessages((m) => [...m.slice(0, -1), { ...m[m.length - 1], error: err.message }])
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
      void loadConversations()
    }
  }

  const stop = () => abortRef.current?.abort()

  const enhance = async () => {
    const text = input.trim()
    if (!text) return
    try {
      const r = await api<{ ok: boolean; prompt: string }>('/api/agent/enhance', {
        method: 'POST',
        body: { prompt: text, kind: prefs.mode === 'video' ? 'video' : 'image', mode: prefs.mode },
      })
      if (r.ok) {
        setInput(r.prompt)
        message.success('提示词已增强')
      }
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const planLong = async () => {
    try {
      const r = await api<{ ok: boolean; plan: number[]; credits?: number }>('/api/agent/plan', {
        method: 'POST',
        body: { total_seconds: prefs.videoSeconds, model: prefs.videoModel },
      })
      if (r.ok) {
        const skeleton = r.plan.map((s, i) => `【分镜 ${i + 1} · ${s}s】`).join('\n')
        setInput((v) => (v ? `${v}\n\n${skeleton}` : skeleton))
        message.success(`已规划 ${r.plan.length} 个分镜${r.credits ? `，预估 ${r.credits} 积分` : ''}`)
      }
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const mergeSelected = async () => {
    if (selectedAssets.size < 2) {
      message.warning('至少选择 2 段视频素材')
      return
    }
    try {
      const r = await api<{ ok: boolean; segments: number; duration_s: number; asset_id: string }>('/api/agent/merge', {
        method: 'POST',
        body: { asset_ids: [...selectedAssets], conversation_id: convId ?? undefined },
        timeout: 600000,
      })
      if (r.ok) {
        message.success(`合并完成：${r.segments} 段 / ${r.duration_s}s`)
        setSelectedAssets(new Set())
        void loadAssets()
      }
    } catch (e) {
      message.error((e as Error).message || '合并失败')
    }
  }

  const delConversation = async (id: string) => {
    try {
      await api(`/api/agent/conversations/${id}`, { method: 'DELETE' })
      if (convId === id) newConversation()
      void loadConversations()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const videoModel = boot?.video.find((v) => v.id === prefs.videoModel)
  const presets = prefs.mode === 'video' ? (boot?.presets.video ?? []) : (boot?.presets.image ?? [])

  const renderMessage = (m: ChatMsg, i: number) => {
    if (m.role === 'user') {
      return (
        <Flex key={i} justify="flex-end" style={{ marginBottom: 12 }}>
          <Card size="small" style={{ maxWidth: '72%' }} styles={{ body: { background: 'rgba(65,118,230,0.12)' } }}>
            <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{m.content}</Typography.Text>
          </Card>
        </Flex>
      )
    }
    return (
      <Flex key={i} justify="flex-start" style={{ marginBottom: 12 }}>
        <Card size="small" style={{ maxWidth: '88%' }}>
          {m.reasoning && (
            <details open={streaming && !m.usage} style={{ marginBottom: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--ant-color-text-secondary, #999)' }}>
                思考过程{m.reasoningMs ? `（${Math.round(m.reasoningMs / 1000)}s）` : ''}
              </summary>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                {m.reasoning}
              </Typography.Paragraph>
            </details>
          )}
          {(m.tools ?? []).map((t, j) => (
            <Tag key={j} color={t.ok === undefined ? 'processing' : t.ok ? 'success' : 'error'} style={{ marginBottom: 4 }}>
              {t.label || t.tool}
              {t.summary ? `：${t.summary}` : ''}
            </Tag>
          ))}
          {m.content && (
            <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>
              {m.content}
              {streaming && i === messages.length - 1 && <span className="agent-caret">▌</span>}
            </Typography.Text>
          )}
          {(m.media ?? []).map((a) => (
            <Card key={a.asset_id} size="small" style={{ marginTop: 8 }}>
              {a.kind === 'video' ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={a.url} controls style={{ maxWidth: '100%', maxHeight: 320 }} />
              ) : (
                <img src={a.url} alt={a.kind} style={{ maxWidth: '100%', maxHeight: 320 }} />
              )}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {a.model} {a.duration_s ? `· ${a.duration_s}s` : ''} {a.credits ? `· ${a.credits} 积分` : ''}
              </Typography.Text>
            </Card>
          ))}
          {m.error && (
            <Typography.Text type="danger" style={{ display: 'block', marginTop: 4 }}>
              ⚠ {m.error}
            </Typography.Text>
          )}
          {m.usage && (
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 11 }} className="num">
              输入 {m.usage.prompt_tokens ?? 0} · 输出 {m.usage.completion_tokens ?? 0} tok · 积分 {m.usage.credits ?? 0}
            </Typography.Text>
          )}
        </Card>
      </Flex>
    )
  }

  return (
    <Flex gap={12} align="stretch" style={{ height: 'calc(100vh - 96px)' }}>
      {/* 会话列表 */}
      <Card
        size="small"
        title="会话"
        style={{ width: 240, display: 'flex', flexDirection: 'column' }}
        styles={{ body: { flex: 1, overflow: 'auto', padding: 4 } }}
        extra={
          <Space size={4}>
            <Tooltip title="新建会话">
              <Button size="small" type="text" icon={<PlusOutlined />} onClick={newConversation} />
            </Tooltip>
            <Tooltip title="清空当前">
              <Button size="small" type="text" icon={<ClearOutlined />} onClick={newConversation} />
            </Tooltip>
          </Space>
        }
        className="agent-side"
      >
        <Listy
          items={conversations}
          rowKey="conversation_id"
          itemRender={(c) => (
            <Flex
              align="center"
              justify="space-between"
              gap={4}
              onClick={() => void openConversation(c.conversation_id)}
              style={{ cursor: 'pointer', background: c.conversation_id === convId ? 'rgba(65,118,230,0.1)' : undefined, padding: '6px 8px', borderRadius: 6 }}
            >
              <Typography.Text ellipsis style={{ fontSize: 12.5, flex: 1 }}>
                {c.pinned ? '📌 ' : ''}
                {c.title || '未命名会话'}
              </Typography.Text>
              <Popconfirm title="删除会话？" onConfirm={() => void delConversation(c.conversation_id)}>
                <Button type="text" size="small" icon={<DeleteOutlined />} />
              </Popconfirm>
            </Flex>
          )}
        />
      </Card>

      {/* 主对话区 */}
      <Card size="small" style={{ flex: 1, display: 'flex', flexDirection: 'column' }} styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 12 } }}>
        <Flex align="center" justify="space-between" style={{ marginBottom: 8 }}>
          <Space size={8}>
            <Button size="small" onClick={() => setSideOpen(true)} style={{ display: 'none' }} />
            <Segmented
              size="small"
              value={prefs.mode}
              onChange={(v) => setPref({ mode: v as Prefs['mode'] })}
              options={[
                { label: '对话', value: 'chat' },
                { label: '生图', value: 'image' },
                { label: '生视频', value: 'video' },
              ]}
            />
            {context?.percent !== undefined && (
              <Tag style={{ fontSize: 11 }}>上下文 {Math.round(context.percent)}%</Tag>
            )}
            {estimate && prefs.mode !== 'chat' && (
              <Tag color="warning" style={{ fontSize: 11 }}>
                预估 {estimate.range?.length ? `${estimate.range[0]}~${estimate.range[1]}` : estimate.credits} 积分
              </Tag>
            )}
            {boot?.key && (
              <Tag style={{ fontSize: 11 }}>
                {boot.key.name} {boot.key.unlimited ? '不限额' : `剩 ${boot.key.credit_limit != null ? Math.round(boot.key.credit_limit - (boot.key.credit_used ?? 0)) : '—'}`}
              </Tag>
            )}
          </Space>
          <Button size="small" onClick={() => setParamsOpen(true)}>
            参数面板
          </Button>
        </Flex>

        <div ref={streamBoxRef} style={{ flex: 1, overflow: 'auto', padding: '4px 2px' }}>
          {messages.length === 0 && (
            <Flex vertical align="center" justify="center" style={{ height: '100%' }} gap={12}>
              <Avatar size={48} style={{ backgroundColor: '#2E9BFF' }}>AI</Avatar>
              <Typography.Text type="secondary">向下滑动选择预设，或直接输入开始创作</Typography.Text>
              <Space wrap size={8} style={{ justifyContent: 'center' }}>
                {(prefs.mode === 'chat'
                  ? [
                      { label: '🎬 生成一段宣传视频', prompt: '帮我生成一段 10 秒的产品宣传视频，主题是智能 API 网关' },
                      { label: '🖼 生成一张海报', prompt: '生成一张赛博朋克风格的城市夜景海报' },
                      { label: '✍️ 写一段文案', prompt: '为一款开发者工具写一段 100 字的介绍文案' },
                      { label: '🧩 头脑风暴', prompt: '帮我头脑风暴 5 个 API 网关的推广点子' },
                    ]
                  : presets.slice(0, 4).map((p) => ({ label: `${p.icon ?? ''} ${p.label}`, prompt: p.prompt ?? p.label }))
                ).map((s) => (
                  <Button key={s.label} size="small" onClick={() => setInput(s.prompt)}>
                    {s.label}
                  </Button>
                ))}
              </Space>
            </Flex>
          )}
          {messages.map(renderMessage)}
        </div>

        <div style={{ borderTop: '1px solid rgba(128,128,128,0.15)', paddingTop: 8 }}>
          {presets.length > 0 && prefs.mode !== 'chat' && (
            <Space wrap size={4} style={{ marginBottom: 6 }}>
              {presets.map((p) => (
                <Button key={p.id} size="small" type="text" onClick={() => setInput(p.prompt ?? p.label)}>
                  {p.icon && `${p.icon} `}
                  {p.label}
                </Button>
              ))}
            </Space>
          )}
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 5 }}
            placeholder={prefs.mode === 'chat' ? '输入消息，Enter 发送，Shift+Enter 换行' : prefs.mode === 'image' ? '描述想要的画面…' : '描述视频内容…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <Flex align="center" justify="space-between" style={{ marginTop: 6 }}>
            <Space size={8} wrap>
              {prefs.mode === 'chat' && (
                <>
                  <Select
                    size="small"
                    style={{ minWidth: 180 }}
                    value={prefs.model}
                    onChange={(v) => setPref({ model: v })}
                    options={(boot?.models.chat ?? []).map((m) => ({ value: m, label: m }))}
                  />
                  <Select
                    size="small"
                    style={{ width: 110 }}
                    value={prefs.reasoning || ''}
                    onChange={(v) => setPref({ reasoning: v as Prefs['reasoning'] })}
                    options={[
                      { value: '', label: '默认思考' },
                      { value: 'low', label: '低思考' },
                      { value: 'high', label: '高思考' },
                    ]}
                  />
                </>
              )}
              {prefs.mode === 'image' && (
                <>
                  <Select size="small" style={{ minWidth: 170 }} value={prefs.imageModel} onChange={(v) => setPref({ imageModel: v })} options={(boot?.models.image ?? []).map((m) => ({ value: m, label: m }))} />
                  {videoModel === undefined && null}
                </>
              )}
              {prefs.mode === 'video' && (
                <>
                  <Select size="small" style={{ minWidth: 170 }} value={prefs.videoModel} onChange={(v) => setPref({ videoModel: v })} options={(boot?.video ?? []).map((v) => ({ value: v.id, label: v.name || v.id }))} />
                  <Select size="small" style={{ width: 96 }} value={prefs.videoResolution} onChange={(v) => setPref({ videoResolution: v })} options={(videoModel?.resolutions ?? []).map((r) => ({ value: r, label: r }))} />
                  <Select
                    size="small"
                    style={{ width: 110 }}
                    value={String(prefs.videoSeconds)}
                    onChange={(v) => setPref({ videoSeconds: Number(v) })}
                    options={(videoModel?.supported_seconds ?? [5, 10]).map((s) => ({ value: String(s), label: `${s}s` }))}
                  />
                </>
              )}
            </Space>
            <Space size={8}>
              {prefs.mode !== 'chat' && (
                <Tooltip title="AI 增强提示词">
                  <Button size="small" icon={<ThunderboltOutlined />} onClick={() => void enhance()}>
                    增强
                  </Button>
                </Tooltip>
              )}
              {streaming ? (
                <Button size="small" danger icon={<StopOutlined />} onClick={stop}>
                  停止
                </Button>
              ) : (
                <Button size="small" type="primary" icon={<SendOutlined />} disabled={!input.trim()} onClick={() => void send()}>
                  发送
                </Button>
              )}
            </Space>
          </Flex>
        </div>
      </Card>

      {/* 参数抽屉（生视频长片规划 / 素材库合并） */}
      <Drawer title="生成参数与素材库" open={paramsOpen} onClose={() => setParamsOpen(false)} size={420}>
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          {prefs.mode === 'video' && videoModel && (
            <Card size="small" title="视频参数">
              <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                <Row gutter={8}>
                  <Col span={12}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>分辨率</Typography.Text>
                    <Select style={{ width: '100%' }} value={prefs.videoResolution} onChange={(v) => setPref({ videoResolution: v })} options={(videoModel.resolutions ?? []).map((r) => ({ value: r, label: r }))} size="small" />
                  </Col>
                  <Col span={12}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>画面比例</Typography.Text>
                    <Select style={{ width: '100%' }} value={prefs.videoAspect} onChange={(v) => setPref({ videoAspect: v })} options={(videoModel.aspect_ratios ?? []).map((r) => ({ value: r, label: r }))} size="small" />
                  </Col>
                </Row>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  时长 {prefs.videoSeconds}s（支持 {videoModel.supported_seconds?.join(' / ')}）
                </Typography.Text>
                {videoModel.max_seconds && videoModel.max_seconds > (videoModel.supported_seconds?.at(-1) ?? 10) && (
                  <Space>
                    <Typography.Text style={{ fontSize: 12 }}>长视频目标时长：</Typography.Text>
                    <Input
                      size="small"
                      style={{ width: 80 }}
                      type="number"
                      value={prefs.videoSeconds}
                      onChange={(e) => setPref({ videoSeconds: Number(e.target.value) })}
                    />
                    <Button size="small" onClick={() => void planLong()}>
                      规划分镜
                    </Button>
                  </Space>
                )}
              </Space>
            </Card>
          )}
          {prefs.mode === 'image' && (
            <Card size="small" title="图片参数">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                单张预估 {boot?.estimates.image_per_unit ?? '—'} 积分
              </Typography.Text>
            </Card>
          )}
          <Card size="small" title="素材库">
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              <Row gutter={[8, 8]}>
                {assets.map((a) => (
                  <Col key={a.asset_id} span={8}>
                    <Card
                      size="small"
                      hoverable
                      onClick={() =>
                        setSelectedAssets((s) => {
                          const n = new Set(s)
                          if (n.has(a.asset_id)) n.delete(a.asset_id)
                          else n.add(a.asset_id)
                          return n
                        })
                      }
                      style={selectedAssets.has(a.asset_id) ? { borderColor: '#2E9BFF' } : undefined}
                      styles={{ body: { padding: 4 } }}
                    >
                      {a.kind === 'video' ? (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video src={a.url} muted style={{ width: '100%', height: 64, objectFit: 'cover' }} />
                      ) : (
                        <img src={a.url} alt="素材" style={{ width: '100%', height: 64, objectFit: 'cover' }} />
                      )}
                    </Card>
                  </Col>
                ))}
              </Row>
              {!assets.length && <Typography.Text type="secondary">暂无素材</Typography.Text>}
              <Button
                block
                disabled={selectedAssets.size < 2 || !boot?.merge?.available}
                onClick={() => void mergeSelected()}
              >
                合并选中片段（{selectedAssets.size}）{boot?.merge?.available === false ? ' · 需 ffmpeg' : ''}
              </Button>
            </Space>
          </Card>
        </Space>
      </Drawer>

      {/* 窄屏会话抽屉 */}
      <Drawer title="会话列表" open={sideOpen} onClose={() => setSideOpen(false)} size={280}>
        <Listy
          items={conversations}
          rowKey="conversation_id"
          itemRender={(c) => (
            <Flex
              align="center"
              onClick={() => {
                void openConversation(c.conversation_id)
                setSideOpen(false)
              }}
              style={{ cursor: 'pointer', padding: '4px 0' }}
            >
              <Typography.Text ellipsis style={{ fontSize: 12.5 }}>
                {c.title || '未命名会话'}
              </Typography.Text>
            </Flex>
          )}
        />
      </Drawer>
    </Flex>
  )
}
