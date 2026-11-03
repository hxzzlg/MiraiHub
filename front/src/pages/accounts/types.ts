/** WorkBuddy 账号（GET /api/accounts item 原文结构节选，前端用到的字段） */
export interface WbAccount {
  id: number
  name: string
  uid: string
  platform: string
  domain?: string
  status: string
  max_in_flight: number
  bound_key_id: number | null
  bound_key_name: string
  balance_total: number
  balance_remain: number
  last_sync_at: string | null
  model_limits: { model: string; kind: string; until: string; remaining_seconds: number }[]
  upstream_error?: { http_status?: number; code?: string; client_message?: string; display_message?: string; message?: string } | null
  gateway_state: 'disabled' | 'cooling' | 'ready'
  gateway_until: string | null
  gateway_reason: string
  credits_expiring: number
  credits_expiring_soon: number
  credits_evergreen: number
  credits_expired: number
  credits_soonest_expire_at: number | null
  credits_soonest_days_left: number | null
  credits_package_count: number
  credits_active_package_count: number
  token_supported: boolean
  token_expires_at: string | null
  token_days_left: number | null
  token_state: string
  renewal_expires_at: string | null
  renewal_days_left: number | null
  renewal_state: string
  renewal_known: boolean
  renewable: boolean
  has_refresh_token: boolean
}

export interface WbSummary {
  total: number
  active: number
  disabled: number
  available: number
  balance_total: number
  balance_remain: number
  credits_expiring_soon: number
  disabled_balance_remain: number
  expiring_accounts: number
  soonest_expire_at: number | null
  token_expiring: number
  token_expired: number
  token_unknown: number
  renewal_expiring: number
  renewal_expired: number
}

/** Trae/Qoder/Loomy 等通用平台账号（字段取并集，渲染时按平台挑选） */
export interface GenericAccount {
  id: number
  name: string
  uid?: string
  status: string
  realm?: string
  email?: string
  plan?: string
  balance_total?: number
  balance_remain?: number
  balance_unit?: string
  addon_remain?: number
  addon_total?: number
  daily_balance?: number
  models?: number
  phone?: string
  cool_until?: string | null
  cool_kind?: string
  last_err_msg?: string
  quota?: { unit?: string; plan?: string; total?: number; remain?: number }
  last_sync_at?: string | null
  expires_at?: string | null
  [k: string]: unknown
}
