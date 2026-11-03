import { nativeSaveText } from '../bridges/native'
import { exportStamp } from './format'

/** 三端桥下载：安卓 WBMobile.saveText / 桌面 pywebview save_text → 浏览器 Blob */
export async function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): Promise<void> {
  if (await nativeSaveText(filename, text, mime)) return
  const blob = new Blob([text], { type: mime })
  triggerBlobDownload(filename, blob)
}

export function triggerBlobDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** 从 Response 下载（自动读 Content-Disposition 文件名），对应备份下载等场景 */
export async function downloadResponse(resp: Response, fallbackName: string): Promise<void> {
  const cd = resp.headers.get('Content-Disposition') || ''
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)
  const name = m ? decodeURIComponent(m[1]) : fallbackName
  const blob = await resp.blob()
  triggerBlobDownload(name, blob)
}

/** 带 stamp 的导出文件名 */
export function exportName(prefix: string, ext: string): string {
  return `${prefix}-${exportStamp()}.${ext}`
}
