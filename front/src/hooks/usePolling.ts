import { useEffect, useRef } from 'react'

/**
 * 可见性感知轮询：页面隐藏时跳过、恢复可见立即执行一次。
 * ms 为 null 时停止轮询。deps 变化时重建定时器。
 */
export function usePolling(fn: () => unknown | Promise<unknown>, ms: number | null, deps: unknown[] = []) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!ms) return
    let stopped = false
    const tick = () => {
      if (stopped || document.hidden) return
      void Promise.resolve(ref.current()).catch(() => {})
    }
    const timer = window.setInterval(tick, ms)
    const onVis = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps])
}
