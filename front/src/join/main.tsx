import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import '../index.css'
import { ThemeProvider, useThemeMode } from '../context/ThemeContext'
import { makeTheme } from '../theme'
import JoinPage from '../pages/join/JoinPage'

function ThemedConfig({ children }: { children: React.ReactNode }) {
  const { mode } = useThemeMode()
  return (
    <ConfigProvider locale={zhCN} theme={makeTheme(mode)}>
      {children}
    </ConfigProvider>
  )
}

// join 独立入口（公开注册页，不经管理鉴权）
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ThemedConfig>
        <AntdApp>
          <JoinPage />
        </AntdApp>
      </ThemedConfig>
    </ThemeProvider>
  </StrictMode>,
)
