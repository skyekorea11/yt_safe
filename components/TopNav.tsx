/**
 * TopNav component - main navigation bar
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Play, RefreshCw, Moon, Sun, Palette } from 'lucide-react'

interface TopNavProps {
  nextRefresh?: string | null
  onManualRefresh?: () => Promise<void>
  mode: 'light' | 'dark'
  tone: 'cool' | 'beige'
  onModeToggle: () => void
  onToneToggle: () => void
}

export default function TopNav({
  nextRefresh,
  onManualRefresh,
  mode,
  tone,
  onModeToggle,
  onToneToggle,
}: TopNavProps) {
  const [countdown, setCountdown] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [cooldownActive, setCooldownActive] = useState(false)
  const fallbackNextRefreshRef = useRef<string>(new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString())
  const [effectiveNextRefresh, setEffectiveNextRefresh] = useState<string>(fallbackNextRefreshRef.current)

  useEffect(() => {
    if (!nextRefresh) {
      setEffectiveNextRefresh(fallbackNextRefreshRef.current)
      return
    }
    const next = new Date(nextRefresh)
    if (Number.isNaN(next.getTime())) {
      setEffectiveNextRefresh(fallbackNextRefreshRef.current)
      return
    }
    fallbackNextRefreshRef.current = nextRefresh
    setEffectiveNextRefresh(nextRefresh)
  }, [nextRefresh])

  useEffect(() => {
    const update = () => {
      const target = new Date(effectiveNextRefresh).getTime()
      if (Number.isNaN(target)) {
        setCountdown('--:--:--')
        return
      }
      let diff = target - Date.now()
      if (diff <= 0) {
        const next = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
        fallbackNextRefreshRef.current = next
        setEffectiveNextRefresh(next)
        diff = new Date(next).getTime() - Date.now()
      }
      const hh = Math.floor(diff / 3600000)
        .toString()
        .padStart(2, '0')
      const mm = Math.floor((diff % 3600000) / 60000)
        .toString()
        .padStart(2, '0')
      const ss = Math.floor((diff % 60000) / 1000)
        .toString()
        .padStart(2, '0')
      setCountdown(`${hh}:${mm}:${ss}`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [effectiveNextRefresh])

  const handleManualRefresh = useCallback(async () => {
    if (isRefreshing || cooldownActive || !onManualRefresh) return
    setIsRefreshing(true)
    setCooldownActive(true)
    setTimeout(() => setCooldownActive(false), 60000)
    try {
      await onManualRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }, [isRefreshing, cooldownActive, onManualRefresh])

  const modeLabel = mode === 'dark' ? '다크 모드 (클릭 시 라이트)' : '라이트 모드 (클릭 시 다크)'
  const toneLabel = tone === 'beige' ? '쿨 톤으로 전환' : '베이지 톤으로 전환'

  return (
    <nav className="bg-slate-50 border-b border-slate-200 sticky top-0 z-30">
      <div className="px-5">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-2 font-bold text-lg text-slate-900 hover:text-slate-700 transition-colors min-w-0"
            >
              <div className="flex items-center justify-center w-7 h-7 bg-slate-900 rounded-lg">
                <Play size={14} className="text-white fill-white ml-0.5" />
              </div>
              <span className="truncate">YouTube Digest</span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end text-slate-700 px-1 py-0.5">
              <span className="text-[10px] font-bold tracking-wide leading-none">갱신까지</span>
              <span className="text-sm font-bold tabular-nums leading-tight tracking-tight">{countdown || '--:--:--'}</span>
            </div>
            {onManualRefresh && (
              <button
                onClick={handleManualRefresh}
                disabled={isRefreshing || cooldownActive}
                className="inline-flex items-center justify-center w-9 h-9 sm:w-auto sm:h-auto sm:px-3 sm:py-1.5 gap-0 sm:gap-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors"
                title={cooldownActive ? '1분 후 다시 시도 가능' : '지금 새로고침'}
              >
                <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
                <span className="hidden sm:inline">갱신</span>
              </button>
            )}
            <button
              onClick={onModeToggle}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors"
              title={modeLabel}
              aria-label={modeLabel}
            >
              {mode === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
            </button>
            <button
              onClick={onToneToggle}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors"
              title={toneLabel}
              aria-label={toneLabel}
            >
              <Palette size={15} />
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
