import { useCallback, useRef, useState } from 'react'

/**
 * 异步任务包装：防重复点击 + 统一错误提示。
 * run(fn) 执行期间 busy=true；失败时 message.error 并返回 false。
 */
export function useAsyncTask(notify: { error: (c: string) => void }) {
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      const id = ++seq.current
      setBusy(true)
      try {
        await fn()
        return true
      } catch (e) {
        if (id === seq.current) notify.error((e as Error).message || '操作失败')
        return false
      } finally {
        if (id === seq.current) setBusy(false)
      }
    },
    [notify],
  )
  return { busy, run }
}
