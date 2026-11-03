import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeMode = 'light' | 'dark'

interface ThemeCtx {
  mode: ThemeMode
  toggle: () => void
}

const Ctx = createContext<ThemeCtx>({ mode: 'light', toggle: () => {} })
const LS_KEY = 'wb_console_theme'

function systemMode(): ThemeMode {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function initialMode(): ThemeMode {
  const saved = localStorage.getItem(LS_KEY)
  // 未手动切换过 → 跟随系统；手动切换后记住用户选择
  if (saved !== 'dark' && saved !== 'light') return systemMode()
  return saved
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(initialMode)

  useEffect(() => {
    document.documentElement.dataset.theme = mode
  }, [mode])

  // 系统深浅色变化：仅在用户未手动选择过主题时自动跟随
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem(LS_KEY)) setMode(e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // 跨标签页同步（storage 事件）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
        setMode(e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // 安卓桥反向同步主题
  useEffect(() => {
    void window.WBAndroid?.setTheme?.(mode)?.catch?.(() => {})
  }, [mode])

  const value = useMemo<ThemeCtx>(
    () => ({
      mode,
      toggle: () =>
        setMode((m) => {
          const next = m === 'dark' ? 'light' : 'dark'
          localStorage.setItem(LS_KEY, next)
          return next
        }),
    }),
    [mode],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useThemeMode(): ThemeCtx {
  return useContext(Ctx)
}
