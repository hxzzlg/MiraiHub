import { api } from './client'

/** 各上游平台的通用动作（按 storage_platform 路由到各自的 /api/{storage}/* 接口） */

export function platformScanLocal(storage: string, realm?: string | null) {
  const q = realm ? `?realm=${encodeURIComponent(realm)}` : ''
  return api<Record<string, unknown>>(`/api/${storage}/scan-local${q}`)
}

export function platformImportLocal(storage: string, realm?: string | null) {
  const q = realm ? `?realm=${encodeURIComponent(realm)}` : ''
  return api<Record<string, unknown>>(`/api/${storage}/import-local${q}`, { method: 'POST', body: {} })
}

export function platformRefreshAll(storage: string, realm?: string | null) {
  const q = realm ? `?realm=${encodeURIComponent(realm)}` : ''
  return api<{ ok?: number; failed?: number; items?: { id: number; name: string; ok: boolean; error?: string }[] }>(
    `/api/${storage}/refresh-all${q}`,
    { method: 'POST', body: {} },
  )
}

export function platformCheckin(storage: string, realm?: string | null) {
  const q = realm ? `?realm=${encodeURIComponent(realm)}` : ''
  return api<Record<string, unknown>>(`/api/${storage}/checkin${q}`, { method: 'POST', body: {} })
}

export function platformUsage(storage: string, realm?: string | null, days = 30) {
  const qs = new URLSearchParams({ days: String(days) })
  if (realm) qs.set('realm', realm)
  return api<Record<string, unknown>>(`/api/${storage}/usage?${qs.toString()}`)
}

export function platformMeta(storage: string) {
  return api<{
    auth_mode?: string
    auth_explain?: string
    notes?: string
    realms?: { key: string; label: string; default?: boolean }[]
    supports_local_scan?: boolean
    storage?: string
    [k: string]: unknown
  }>(`/api/${storage}/meta`)
}

/** Trae PKCE 浏览器授权 */
export function traeDeviceStart(realm?: string | null) {
  const q = realm ? `?realm=${encodeURIComponent(realm)}` : ''
  return api<{
    nonce?: string
    auth_url?: string
    callback_url?: string
    callback_reachable?: boolean
    callback_hint?: string
    [k: string]: unknown
  }>(`/api/trae/device/start${q}`, { method: 'POST', body: {} })
}

export function traeDevicePoll(nonce: string) {
  return api<{ status?: string; account?: { name?: string }; error?: string; [k: string]: unknown }>(
    `/api/trae/device/poll?nonce=${encodeURIComponent(nonce)}`,
  )
}

export function traeDeviceCallback(nonce: string, callbackUrl: string) {
  return api<Record<string, unknown>>('/api/trae/device/callback', {
    method: 'POST',
    body: { nonce, callback_url: callbackUrl },
  })
}

export function traeWebCookie(cookie: string) {
  return api<{ updated?: unknown[] }>('/api/trae/web-cookie', { method: 'POST', body: { cookie } })
}

/** Qoder 设备码授权（服务端轮询取凭证，与浏览器所在机器无关） */
export function qoderDeviceStart(realm?: string | null) {
  const q = realm ? `?realm=${encodeURIComponent(realm)}` : ''
  return api<{ nonce?: string; verification_url?: string; auth_url?: string; user_code?: string; [k: string]: unknown }>(
    `/api/qoder/device/start${q}`,
    { method: 'POST', body: {} },
  )
}

export function qoderDevicePoll(nonce: string) {
  return api<{ status?: string; account?: { name?: string }; error?: string; [k: string]: unknown }>(
    `/api/qoder/device/poll?nonce=${encodeURIComponent(nonce)}`,
  )
}
