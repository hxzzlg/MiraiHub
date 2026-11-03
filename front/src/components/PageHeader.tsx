import { Button, Flex, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'

interface Props {
  title: ReactNode
  description?: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  actions?: ReactNode
}

/** 页头：标题 + 描述 + 刷新/动作区 */
export default function PageHeader({ title, description, onRefresh, refreshing, actions }: Props) {
  return (
    <Flex align="center" justify="space-between" gap={12} wrap="wrap">
      <Flex align="center" gap={12} wrap="wrap">
        <Typography.Title level={4} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {description && (
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            {description}
          </Typography.Text>
        )}
      </Flex>
      <Flex align="center" gap={8} wrap="wrap">
        {actions}
        {onRefresh && (
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>
            刷新
          </Button>
        )}
      </Flex>
    </Flex>
  )
}
