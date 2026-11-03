import { useEffect, useRef } from 'react'

export interface TopoNode {
  id: string
  label: string
  sub?: string
  tone?: 'ok' | 'warn' | 'danger' | 'idle'
}

export interface TopoEdge {
  from: string
  to: string
  /** 流量权重（0-1），决定粒子密度 */
  weight?: number
  tone?: 'ok' | 'warn' | 'danger' | 'idle'
  label?: string
}

interface Particle {
  edge: number
  t: number
  speed: number
  el: SVGCircleElement
}

const TONE_COLOR = {
  ok: '#52a06a',
  warn: '#d9930d',
  danger: '#d4574e',
  idle: '#8a8f98',
} as const

/**
 * 流量拓扑粒子动画（对应旧版 WBTraffic.Topology：哨兵实时流量 / 网关调度可视化）。
 * 纯 SVG + rAF 实现，粒子密度随 edge.weight 变化。
 */
export default function TopologyViz({
  layers,
  edges,
  height = 300,
  paused = false,
  burst = 0,
}: {
  layers: TopoNode[][]
  edges: TopoEdge[]
  height?: number
  paused?: boolean
  /** 变化时立即喷发一批粒子（模拟请求） */
  burst?: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const particlesRef = useRef<Particle[]>([])
  const layerRef = useRef({ layers, edges, paused })
  layerRef.current = { layers, edges, paused }
  const gLayerRef = useRef<SVGGElement | null>(null)

  const width = 720

  // 布局：layers 为列，列内均分
  useEffect(() => {
    const pos = new Map<string, { x: number; y: number }>()
    const cols = layers.length
    layers.forEach((col, ci) => {
      const x = cols === 1 ? width / 2 : 80 + (ci * (width - 160)) / (cols - 1)
      col.forEach((n, ri) => {
        const y = ((ri + 1) * height) / (col.length + 1)
        pos.set(n.id, { x, y })
      })
    })
    posRef.current = pos
  }, [layers, height])

  const spawnOnEdge = (e: TopoEdge, i: number) => {
    const gLayer = gLayerRef.current
    const from = posRef.current.get(e.from)
    const to = posRef.current.get(e.to)
    if (!gLayer || !from || !to) return
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circle.setAttribute('r', '3.2')
    circle.setAttribute('fill', TONE_COLOR[e.tone ?? 'idle'])
    circle.setAttribute('opacity', '0.9')
    gLayer.appendChild(circle)
    particlesRef.current.push({ edge: i, t: 0, speed: 0.5 + Math.random() * 0.4, el: circle })
  }

  // burst：立即沿各边喷发一批粒子
  useEffect(() => {
    if (!burst) return
    const es = layerRef.current.edges
    const lastEdge = Math.max(0, es.length - 1)
    for (let n = 0; n < 24; n++) {
      const i = Math.floor(Math.random() * lastEdge)
      spawnOnEdge(es[i], i)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burst])

  // rAF 粒子循环
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const gLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    svg.appendChild(gLayer)
    gLayerRef.current = gLayer
    let raf = 0
    let last = performance.now()

    const spawn = () => {
      const { edges: es, paused: p } = layerRef.current
      if (p || !es.length) return
      es.forEach((e, i) => {
        const w = e.weight ?? 0.3
        if (Math.random() < w * 0.08) spawnOnEdge(e, i)
      })
    }

    const frame = (now: number) => {
      const dt = Math.min(64, now - last) / 1000
      last = now
      const es = layerRef.current.edges
      spawn()
      const alive: Particle[] = []
      for (const p of particlesRef.current) {
        const e = es[p.edge]
        const from = posRef.current.get(e?.from ?? '')
        const to = posRef.current.get(e?.to ?? '')
        if (!e || !from || !to) {
          p.el.remove()
          continue
        }
        p.t += p.speed * dt
        if (p.t >= 1) {
          p.el.remove()
          continue
        }
        const x = from.x + (to.x - from.x) * p.t
        const y = from.y + (to.y - from.y) * p.t + Math.sin(p.t * Math.PI) * -6
        p.el.setAttribute('cx', String(x))
        p.el.setAttribute('cy', String(y))
        alive.push(p)
      }
      particlesRef.current = alive
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      particlesRef.current.forEach((p) => p.el.remove())
      particlesRef.current = []
      gLayer.remove()
      gLayerRef.current = null
    }
  }, [])

  return (
    <svg ref={svgRef} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      {edges.map((e, i) => {
        const from = posRef.current.get(e.from)
        const to = posRef.current.get(e.to)
        if (!from || !to) return null
        return (
          <g key={`e${i}`}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={TONE_COLOR[e.tone ?? 'idle']}
              strokeOpacity={0.25 + (e.weight ?? 0.3) * 0.4}
              strokeWidth={1 + (e.weight ?? 0.3) * 2}
            />
            {e.label && (
              <text
                x={(from.x + to.x) / 2}
                y={(from.y + to.y) / 2 - 6}
                textAnchor="middle"
                fontSize={10}
                fill={TONE_COLOR[e.tone ?? 'idle']}
              >
                {e.label}
              </text>
            )}
          </g>
        )
      })}
      {layers.map((col, ci) =>
        col.map((n) => {
          const p = posRef.current.get(n.id)
          if (!p) return null
          const color = TONE_COLOR[n.tone ?? 'idle']
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={16} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.5} />
              <circle cx={p.x} cy={p.y} r={5} fill={color} />
              <text x={p.x} y={p.y - 24} textAnchor="middle" fontSize={12} fontWeight={600} fill="currentColor">
                {n.label}
              </text>
              {n.sub && (
                <text x={p.x} y={p.y + 32} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.65}>
                  {n.sub}
                </text>
              )}
              {ci === 0 && null}
            </g>
          )
        }),
      )}
      {!layers.length && (
        <text x="50%" y="50%" textAnchor="middle" fontSize={13} fill="currentColor" opacity={0.5}>
          等待数据…
        </text>
      )}
    </svg>
  )
}
