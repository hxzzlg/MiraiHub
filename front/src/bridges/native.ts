/**
 * 三端桥：桌面 PyWebView（window.pywebview）、安卓 WebView（window.WBAndroid）、浏览器。
 * 对应旧版 desktop.js / mobile.js 的桥接面。
 */
declare global {
  interface Window {
    pywebview?: { api?: Record<string, (...args: unknown[]) => Promise<unknown>> }
    WBAndroid?: Record<string, (...args: unknown[]) => Promise<unknown>>
    WBMobile?: Record<string, (...args: unknown[]) => Promise<unknown>>
  }
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.pywebview?.api
}

export function isAndroid(): boolean {
  return typeof window !== 'undefined' && !!window.WBAndroid?.sessionToken
}

export function isLocalShell(): boolean {
  return isDesktop() || isAndroid()
}

/** 桌面 ?desktop=1 标记（自定义窗口按钮、免登录提示等场景使用） */
export function isDesktopMode(): boolean {
  if (isDesktop()) return true
  try {
    return sessionStorage.getItem('mh_desktop_mode') === '1'
  } catch {
    return false
  }
}

export function markDesktopModeFromUrl() {
  const q = new URLSearchParams(window.location.search)
  if (q.get('desktop') === '1') {
    try {
      sessionStorage.setItem('mh_desktop_mode', '1')
    } catch {
      /* ignore */
    }
  }
}

/** 本地壳免登录：桌面 desktop_login() / 安卓 sessionToken() 换取不过期 token */
export async function ensureLocalSession(_force = false): Promise<string | null> {
  try {
    const pv = window.pywebview?.api
    if (pv?.desktop_login) {
      const t = await pv.desktop_login()
      if (typeof t === 'string' && t) return t
    }
    const aj = window.WBAndroid
    if (aj?.sessionToken) {
      const t = await aj.sessionToken()
      if (typeof t === 'string' && t) return t
    }
  } catch {
    /* 桥不可用时静默 */
  }
  return null
}

/** 安卓保存文件桥，成功返回 true；桌面/浏览器返回 false 由调用方降级 */
export async function nativeSaveText(filename: string, text: string, mime: string): Promise<boolean> {
  try {
    if (window.WBMobile?.saveText) {
      const ok = await window.WBMobile.saveText(filename, filename, text, mime)
      return ok === true
    }
    const pv = window.pywebview?.api
    if (pv?.save_text) {
      const ok = await pv.save_text(filename, text, mime)
      return ok !== false
    }
  } catch {
    /* 降级到浏览器下载 */
  }
  return false
}

export async function nativeWindowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void> {
  try {
    await window.pywebview?.api?.window_action?.(action)
  } catch {
    /* ignore */
  }
}

/** 安卓壳状态（设置页展示），返回 null 表示桥不可用 */
export async function androidStatus(): Promise<Record<string, unknown> | null> {
  try {
    if (window.WBAndroid?.status) {
      const raw = await window.WBAndroid.status()
      if (typeof raw === 'string') return JSON.parse(raw)
      if (raw && typeof raw === 'object') return raw as Record<string, unknown>
    }
  } catch {
    /* ignore */
  }
  return null
}
