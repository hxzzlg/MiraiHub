/**
 * 平台上下文总线（对应旧版 window.WBPlatform 的非 React 部分）。
 * 平台口径通过 HTTP 头 X-Platform 影响后端：'workbuddy' | 'trae-cn' | 'qoder:intl' 这类路由值。
 * 持久化在 localStorage['wb_platform_current']，与旧版兼容。
 */
export interface PlatformRoute {
  platform: string
  realm?: string | null
}

const LS_KEY = 'wb_platform_current'

function load(): PlatformRoute {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const v = JSON.parse(raw)
      if (v && typeof v.platform === 'string') return { platform: v.platform, realm: v.realm ?? null }
    }
  } catch {
    /* 忽略损坏数据 */
  }
  return { platform: 'workbuddy', realm: null }
}

let state: PlatformRoute = load()
const listeners = new Set<() => void>()

export function getPlatformState(): PlatformRoute {
  return state
}

export function getPlatformRoute(): string {
  return state.realm ? `${state.platform}:${state.realm}` : state.platform
}

export function getPlatformHeader(): Record<string, string> {
  return { 'X-Platform': getPlatformRoute() }
}

export function setPlatformState(next: PlatformRoute) {
  state = { platform: next.platform, realm: next.realm ?? null }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state))
  } catch {
    /* 隐私模式等场景忽略 */
  }
  listeners.forEach((fn) => fn())
}

export function subscribePlatform(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
