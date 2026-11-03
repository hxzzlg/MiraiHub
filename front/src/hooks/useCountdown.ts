import { useEffect, useState } from 'react'

/** 秒级倒计时（验证码重发等场景），输入剩余秒数，返回 [剩余秒, 重新设定] */
export function useCountdown(initial: number | null): [number, (v: number | null) => void] {
  const [left, setLeft] = useState(initial ?? 0)
  useEffect(() => {
    if (initial === null || initial <= 0) return
    setLeft(initial)
    const timer = window.setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          window.clearInterval(timer)
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [initial])
  return [left, (v) => setLeft(v ?? 0)]
}
