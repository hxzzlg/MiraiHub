import { App as AntdApp, Avatar, Button, Card, Flex, Form, Input, Typography } from 'antd'
import { LockOutlined, MoonOutlined, SunOutlined, UserOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useThemeMode } from '../context/ThemeContext'
import { ensureLocalSession, isDesktopMode } from '../bridges/native'
import { setToken } from '../api/client'

export default function LoginPage() {
  const { authed, ready, login } = useAuth()
  const { mode, toggle } = useThemeMode()
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)

  // 桌面/安卓本地壳：无需登录表单，直接走桥换取本地 token
  useEffect(() => {
    if (!ready || authed) return
    if (!isDesktopMode()) return
    void ensureLocalSession(true).then((t) => {
      if (t) {
        setToken(t)
        window.location.reload()
      }
    })
  }, [ready, authed])

  if (ready && authed) return <Navigate to="/overview" replace />

  const onFinish = async ({ username, password }: { username: string; password: string }) => {
    setSubmitting(true)
    try {
      await login(username, password)
      message.success('登录成功')
      navigate('/overview', { replace: true })
    } catch (e) {
      message.error((e as Error).message || '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', padding: 16 }}>
      <Button
        type="text"
        icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        onClick={toggle}
        style={{ position: 'fixed', top: 12, right: 12 }}
      />
      <Card style={{ width: 360 }}>
        <Flex vertical align="center" gap={12} style={{ marginBottom: 20 }}>
          <Avatar shape="square" size={44} src="/api/app/icon" />
          <Typography.Title level={4} style={{ margin: 0 }}>
            MiraiHub 管理后台
          </Typography.Title>
          <Typography.Text type="secondary">一个 API Key，调用多家上游</Typography.Text>
        </Flex>
        <Form layout="vertical" onFinish={onFinish} autoComplete="off">
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="管理用户名" autoFocus />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="管理密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            登录
          </Button>
        </Form>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
          连续失败会触发登录保护，请稍后再试。
        </Typography.Text>
      </Card>
    </Flex>
  )
}
