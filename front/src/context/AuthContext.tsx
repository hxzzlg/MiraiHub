import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, clearToken, getToken, setToken, setUnauthorizedHandler } from '../api/client'
import { browserFingerprint } from '../utils/fingerprint'
import { markDesktopModeFromUrl } from '../bridges/native'

interface AuthCtx {
  token: string | null
  authed: boolean
  /** 一次性 URL token（桌面托盘"浏览器打开"）捕获完成 */
  ready: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx>({
  token: null,
  authed: false,
  ready: false,
  login: async () => {},
  logout: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    markDesktopModeFromUrl()
    // 桌面托盘 ?token= 一次性注入：取用后从地址栏清除
    const q = new URLSearchParams(window.location.search)
    const urlToken = q.get('token')
    if (urlToken) {
      setToken(urlToken)
      q.delete('token')
      const rest = q.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`)
    }
    setTokenState(getToken())
    setReady(true)
    setUnauthorizedHandler(() => {
      clearToken()
      setTokenState(null)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const form = new URLSearchParams({ username, password })
    const resp = await api<{ token: string }>('/api/login', {
      method: 'POST',
      form,
      skipPlatform: true,
      headers: { 'X-Browser-Fingerprint': browserFingerprint() },
    })
    if (resp?.token) {
      setToken(resp.token)
      setTokenState(resp.token)
    } else {
      throw new Error('登录响应缺少 token')
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api('/api/login/logout', { method: 'POST', skipPlatform: true })
    } catch {
      /* 幂等，失败也继续本地登出 */
    }
    clearToken()
    setTokenState(null)
  }, [])

  const value = useMemo<AuthCtx>(
    () => ({ token, authed: !!token, ready, login, logout }),
    [token, ready, login, logout],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  return useContext(Ctx)
}
