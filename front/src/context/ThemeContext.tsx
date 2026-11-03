import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeMode = 'light' | 'dark'

interface ThemeCtx {
  mode: ThemeMode
  toggle: () => void
}

const Ctx = createContext<ThemeCtx>({ mode: 'light', toggle: () => {} })
const LS_KEY = 'wb_console_theme'

function initialMode(): ThemeMode {
  const saved = localStorage.getItem(LS_KEY)
  return saved === 'dark' ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(initialMode)

  useEffect(() => {
    document.documentElement.dataset.theme = mode
  }, [mode])

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
