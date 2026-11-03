import { Empty, Spin } from 'antd'
import { Pie, Line } from '@ant-design/plots'

export interface SliceDatum {
  type: string
  value: number
}

function ChartEmpty({ height }: { height: number }) {
  return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
    </div>
  )
}

function ChartLoading({ height }: { height: number }) {
  return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spin />
    </div>
  )
}

/** 环形占比图（对应旧版手写 SVG donutChart） */
export function DonutChart({
  data,
  loading,
  height = 240,
  colors,
}: {
  data: SliceDatum[]
  loading?: boolean
  height?: number
  colors?: string[]
}) {
  if (loading) return <ChartLoading height={height} />
  const total = data.reduce((s, d) => s + (d.value || 0), 0)
  if (!total) return <ChartEmpty height={height} />
  return (
    <Pie
      data={data}
      height={height}
      angleField="value"
      colorField="type"
      innerRadius={0.62}
      radius={0.92}
      legend={{ color: { position: 'bottom' } }}
      label={{
        text: (d: SliceDatum) => `${d.type} ${((d.value / total) * 100).toFixed(0)}%`,
        position: 'outside',
      }}
      tooltip={{ items: [{ field: 'value', name: '请求' }] }}
      scale={colors ? { color: { range: colors } } : undefined}
      annotations={[
        {
          type: 'text',
          style: {
            text: total >= 10000 ? `${(total / 1000).toFixed(1)}k` : String(total),
            x: '50%',
            y: '50%',
            textAlign: 'center',
            fontSize: 20,
            fontWeight: 600,
            fill: 'currentColor',
          },
        },
      ]}
    />
  )
}

export interface TrendPoint {
  time: string
  input: number
  output: number
}

/** Token 趋势双折线（对应旧版手写 SVG trendChart，输入/输出双色） */
export function TrendChart({ data, loading, height = 260 }: { data: TrendPoint[]; loading?: boolean; height?: number }) {
  if (loading) return <ChartLoading height={height} />
  const flat = data.flatMap((d) => [
    { time: d.time, kind: '输入', value: d.input },
    { time: d.time, kind: '输出', value: d.output },
  ])
  if (!flat.some((d) => d.value > 0)) return <ChartEmpty height={height} />
  return (
    <Line
      data={flat}
      height={height}
      xField="time"
      yField="value"
      colorField="kind"
      style={{ lineWidth: 2 }}
      axis={{
        x: { title: false, labelFormatter: (v: string) => String(v).slice(5, 16) },
        y: { title: false },
      }}
      legend={{ color: { position: 'top' } }}
    />
  )
}
