/**
 * TopNav component - main navigation bar
 */

'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { Play, RefreshCw, Moon, Sun } from 'lucide-react'

interface TopNavProps {
  onManualRefresh?: () => Promise<void>
  mode: 'light' | 'dark'
  onModeToggle: () => void
  tone: 'cool' | 'beige'
  onToneToggle: () => void
  subtitle?: string
}

export default function TopNav({
  onManualRefresh,
  mode,
  onModeToggle,
  tone,
  onToneToggle,
  subtitle,
}: TopNavProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [cooldownActive, setCooldownActive] = useState(false)

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

  return (
    <nav className="bg-white border-b border-slate-100 sticky top-0 z-30 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="px-5">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-2 font-bold text-lg text-slate-900 hover:text-red-600 transition-colors min-w-0"
            >
              <div className="flex items-center justify-center w-7 h-7 bg-red-600 rounded-lg shadow-sm">
                <Play size={14} className="text-white fill-white ml-0.5" />
              </div>
              <span className="min-w-0 flex flex-col leading-tight">
                <span className="truncate">My Youtube Signal, YouTube Radar</span>
                {subtitle ? (
                  <span className="text-[11px] font-medium text-slate-500 truncate mt-0.5">{subtitle}</span>
                ) : null}
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            {onManualRefresh && (
              <button
                onClick={handleManualRefresh}
                disabled={isRefreshing || cooldownActive}
                className="ui-btn ui-btn-icon sm:w-auto sm:min-w-0 sm:px-3 sm:gap-1.5 disabled:opacity-40"
                title={cooldownActive ? '1분 후 다시 시도 가능' : '지금 새로고침'}
              >
                <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
              </button>
            )}
            <div className="flex items-center gap-1.5 select-none" title={tone === 'beige' ? '베이지 톤 적용 중' : '쿨 톤 적용 중'}>
              <span className={`text-[11px] font-medium transition-colors ${tone === 'cool' ? (mode === 'dark' ? 'text-slate-300' : 'text-slate-600') : (mode === 'dark' ? 'text-stone-500' : 'text-slate-400')}`}>쿨</span>
              <button
                type="button"
                role="switch"
                aria-checked={tone === 'beige'}
                onClick={onToneToggle}
                className={`relative inline-flex h-[1.125rem] w-8 shrink-0 items-center rounded-full border transition-colors ${
                  tone === 'beige'
                    ? (mode === 'dark' ? 'bg-green-800 border-green-900' : 'bg-amber-400 border-amber-500')
                    : (mode === 'dark' ? 'bg-slate-700 border-slate-600' : 'bg-slate-200 border-slate-300')
                }`}
              >
                <span className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${tone === 'beige' ? 'translate-x-[14px]' : 'translate-x-[1px]'}`} />
              </button>
              <span className={`text-[11px] font-medium transition-colors ${tone === 'beige' ? (mode === 'dark' ? 'text-green-400' : 'text-amber-600') : (mode === 'dark' ? 'text-stone-500' : 'text-slate-400')}`}>베이지</span>
            </div>
            <button
              onClick={onModeToggle}
              className="ui-btn ui-btn-icon"
              title={modeLabel}
              aria-label={modeLabel}
            >
              {mode === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
