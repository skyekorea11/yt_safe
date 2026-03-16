/**
 * TopNav component - main navigation bar
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Play, RefreshCw } from 'lucide-react'

interface TopNavProps {
  nextRefresh?: string | null
  onManualRefresh?: () => Promise<void>
}

export default function TopNav({
  nextRefresh,
  onManualRefresh,
}: TopNavProps) {
  const [countdown, setCountdown] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [cooldownActive, setCooldownActive] = useState(false)

  useEffect(() => {
    const update = () => {
      if (!nextRefresh) {
        setCountdown('')
        return
      }
      const diff = new Date(nextRefresh).getTime() - Date.now()
      if (diff <= 0) {
        setCountdown('갱신 예정')
        return
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
  }, [nextRefresh])

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

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="px-5">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-2 font-bold text-lg text-gray-900 hover:text-gray-700 transition-colors min-w-0"
            >
              <div className="flex items-center justify-center w-7 h-7 bg-gray-900 rounded-lg">
                <Play size={14} className="text-white fill-white ml-0.5" />
              </div>
              <span className="truncate">YouTube Digest</span>
            </Link>
          </div>

          {(countdown || onManualRefresh) && (
            <div className="flex items-center gap-3">
              {countdown && (
                <div className="flex flex-col items-end" style={{ color: '#8b00ff' }}>
                  <span className="text-[10px] font-bold tracking-wide leading-none">갱신까지</span>
                  <span className="text-sm font-bold tabular-nums leading-tight tracking-tight">{countdown}</span>
                </div>
              )}
              {onManualRefresh && (
                <button
                  onClick={handleManualRefresh}
                  disabled={isRefreshing || cooldownActive}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                  title={cooldownActive ? '1분 후 다시 시도 가능' : '지금 새로고침'}
                >
                  <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
                  갱신
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
