/** 浏览器指纹（FNV 双哈希），用于登录限流的第三维度（对应旧版 browserFingerprint） */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function browserFingerprint(): string {
  const raw = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    String(navigator.hardwareConcurrency ?? ''),
    String(new Date().getTimezoneOffset()),
  ].join('|')
  const a = fnv1a(raw)
  const b = fnv1a(`${a}|${raw}`)
  return `${a}${b}`
}
