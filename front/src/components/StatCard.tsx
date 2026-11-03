import { Card, Col, Row, Statistic, Tooltip, type ColProps } from 'antd'
import type { ReactNode } from 'react'

export interface StatItem {
  title: ReactNode
  value: ReactNode
  suffix?: ReactNode
  precision?: number
  hint?: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'danger'
}

const toneColor = {
  default: undefined,
  success: '#3f8c5a',
  warning: '#d9930d',
  danger: '#d4574e',
} as const

/** 概览统计卡片墙（对应旧版 stat-grid / statCard） */
export default function StatCards({ items, span }: { items: StatItem[]; span?: ColProps['span'] }) {
  return (
    <Row gutter={[12, 12]}>
      {items.map((it, i) => (
        <Col key={i} xs={12} md={span ?? 6}>
          <Tooltip title={it.hint}>
            <Card size="small" styles={{ body: { padding: '10px 16px' } }}>
              <Statistic
                title={it.title}
                value={it.value as number}
                precision={it.precision}
                suffix={it.suffix}
                styles={{ content: it.tone && it.tone !== 'default' ? { color: toneColor[it.tone] } : undefined }}
              />
            </Card>
          </Tooltip>
        </Col>
      ))}
    </Row>
  )
}
