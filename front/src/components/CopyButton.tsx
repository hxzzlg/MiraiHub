import { App as AntdApp, Button, Tooltip } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import { copyText } from '../utils/clipboard'

interface Props {
  value: string
  tip?: string
  size?: 'small' | 'middle'
  label?: string
}

export default function CopyButton({ value, tip = '复制', size = 'small', label }: Props) {
  const { message } = AntdApp.useApp()
  return (
    <Tooltip title={tip}>
      <Button
        size={size}
        type="text"
        icon={<CopyOutlined />}
        {...(label ? { children: label } : {})}
        onClick={async () => {
          const ok = await copyText(value)
          if (ok) message.success('已复制')
          else message.error('复制失败，请手动选择复制')
        }}
      />
    </Tooltip>
  )
}
