'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, LayoutDashboard, Heart, Settings, GripVertical, FilterX } from 'lucide-react'
import TopNav from './TopNav'
import ChannelAddForm from './ChannelAddForm'
import { Channel } from '@/types'

const NAV_ITEMS = [
  { label: '대시보드', href: '/' },
  { label: '즐겨찾기', href: '/favorites' },
  { label: '설정', href: '/settings' },
] as const

const SETTINGS_MENU = [
  { label: '뉴스 채널 관리', href: '/settings#news-channels' },
  { label: '채널별 기사/주식 추천 강도', href: '/settings#channel-stock-mode' },
  { label: '표시 설정', href: '/settings#display-preferences' },
] as const

const COLLAPSED_NAV_ITEMS = [
  { label: '대시보드', href: '/', icon: LayoutDashboard },
  { label: '즐겨찾기', href: '/favorites', icon: Heart },
  { label: '설정', href: '/settings', icon: Settings },
] as const

const DESKTOP_SIDEBAR_OPEN_KEY = 'yt.desktopSidebarOpen.v1'
const MODE_KEY = 'yt.mode.v1'
const TONE_KEY = 'yt.tone.v1'
const CHANNEL_ORDER_KEY = 'yt.channelOrder.v1'

interface AppShellProps {
  children: React.ReactNode
  channels?: Channel[]
  onChannelAdded?: () => void
  onChannelRemoved?: (channelId: string) => void
  onChannelSelected?: (channelId: string) => void
  onChannelClearFilter?: () => void
  selectedChannelIds?: string[]
  newVideoCount?: number
  onManualRefresh?: () => Promise<void>
}

interface SidebarContentProps {
  isSettingsPage: boolean
  pathname: string
  channels: Channel[]
  newVideoCount: number
  selectedChannelIds?: string[]
  onChannelAdded?: () => void
  onChannelRemoved?: (channelId: string) => void
  onChannelSelected?: (channelId: string) => void
  onChannelClearFilter?: () => void
  onChannelReorder?: (sourceId: string, targetId: string) => void
  onNavigate?: () => void
  onClose?: () => void
}

function SidebarContent({
  isSettingsPage,
  pathname,
  channels,
  newVideoCount,
  selectedChannelIds = [],
  onChannelAdded,
  onChannelRemoved,
  onChannelSelected,
  onChannelClearFilter,
  onChannelReorder,
  onNavigate,
  onClose,
}: SidebarContentProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  return (
    <>
      <div className="h-14 flex items-center justify-between px-5 font-semibold text-lg border-b border-slate-200 text-slate-800">
        <span>{isSettingsPage ? 'Settings' : 'Channels'}</span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-icon ui-btn-sm"
            aria-label="사이드바 닫기"
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className="px-3 py-2 border-b border-slate-200/70 flex gap-1 sidebar-nav-divider">
        {NAV_ITEMS.map(({ label, href }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex-1 text-center px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-slate-200 text-slate-900'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </div>

      {isSettingsPage ? (
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <div className="mb-4 pb-4 border-b border-slate-200/70">
            <p className="px-1 mb-2 text-[11px] font-medium text-slate-500">채널 추가</p>
            <ChannelAddForm onSuccess={onChannelAdded} compact />
          </div>
          <div className="space-y-1.5">
            {SETTINGS_MENU.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className="block rounded-lg border border-slate-200 bg-white px-3 py-2 ui-title-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-slate-200/70 sidebar-add-divider">
            <ChannelAddForm onSuccess={onChannelAdded} compact />
          </div>

          {newVideoCount > 0 && (
            <div className="mx-3 mt-2 px-3 py-2 bg-blue-50 rounded-lg text-xs text-blue-600 font-medium">
              새 영상 {newVideoCount}개 업데이트됨
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-3 py-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className={`text-[11px] font-medium ${selectedChannelIds.length > 0 ? 'text-blue-600' : 'text-slate-400'}`}>
                {selectedChannelIds.length > 0 ? `${selectedChannelIds.length}개 채널 필터 중` : '전체 채널'}
              </span>
              <button
                type="button"
                onClick={onChannelClearFilter}
                disabled={selectedChannelIds.length === 0}
                className={`inline-flex items-center gap-1 text-[11px] transition-colors ${
                  selectedChannelIds.length > 0
                    ? 'text-blue-500 hover:text-blue-700'
                    : 'text-slate-300 cursor-default'
                }`}
                title="필터 해제"
              >
                <FilterX size={12} />
                전체 보기
              </button>
            </div>
            {channels.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500 text-center">
                아직 등록된 채널이 없습니다
              </div>
            ) : (
              <div className="space-y-1.5">
                {channels.map((channel) => {
                  const isSelected = selectedChannelIds.includes(channel.youtube_channel_id)
                  return (
                  <div
                    key={channel.youtube_channel_id}
                    draggable
                    onDragStart={(e) => {
                      setDraggingId(channel.youtube_channel_id)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', channel.youtube_channel_id)
                    }}
                    onDragOver={(e) => {
                      if (!draggingId || draggingId === channel.youtube_channel_id) return
                      e.preventDefault()
                      setDragOverId(channel.youtube_channel_id)
                    }}
                    onDragLeave={() => {
                      if (dragOverId === channel.youtube_channel_id) setDragOverId(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const sourceId = e.dataTransfer.getData('text/plain') || draggingId
                      const targetId = channel.youtube_channel_id
                      if (sourceId && sourceId !== targetId) onChannelReorder?.(sourceId, targetId)
                      setDraggingId(null)
                      setDragOverId(null)
                    }}
                    onDragEnd={() => {
                      setDraggingId(null)
                      setDragOverId(null)
                    }}
                    onClick={() => {
                      onChannelSelected?.(channel.youtube_channel_id)
                    }}
                    className={`rounded-lg border px-2.5 py-2 cursor-grab active:cursor-grabbing transition-colors ${
                      dragOverId === channel.youtube_channel_id
                        ? 'border-blue-300 bg-blue-50'
                        : isSelected
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {channel.thumbnail_url ? (
                        <img
                          src={channel.thumbnail_url}
                          alt={channel.title}
                          className="w-7 h-7 rounded-md object-cover flex-shrink-0 border border-slate-200"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-md bg-slate-200 flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[13px] text-slate-800 truncate">
                          {channel.title}
                        </div>
                      </div>
                      <span
                        className="inline-flex items-center justify-center text-slate-300 flex-shrink-0"
                        title="드래그로 순서 변경"
                        aria-hidden="true"
                      >
                        <GripVertical size={13} />
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onChannelRemoved?.(channel.youtube_channel_id)
                        }}
                        className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors text-xs leading-none flex-shrink-0"
                        title="채널 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )})}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

function CollapsedSidebarRail({
  pathname,
  onOpen,
  mobile = false,
}: {
  pathname: string
  onOpen: () => void
  mobile?: boolean
}) {
  if (mobile) {
    return (
      <aside className="fixed inset-x-0 bottom-0 z-40 flex lg:hidden h-14 bg-slate-50 border-t border-slate-200 px-2">
        <div className="w-full h-full flex items-center justify-between">
          <button
            type="button"
            onClick={onOpen}
            className="ui-btn ui-btn-icon"
            aria-label="사이드바 열기"
          >
            <Menu size={16} />
          </button>
          <div className="flex items-center gap-1">
            {COLLAPSED_NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center justify-center w-10 h-10 rounded-md border transition-colors ${
                    isActive
                      ? 'border-slate-400 bg-slate-200 text-slate-900'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-100'
                  }`}
                  title={item.label}
                  aria-label={item.label}
                >
                  <Icon size={15} />
                </Link>
              )
            })}
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="hidden lg:flex w-12 shrink-0 bg-slate-50 border-r border-slate-200 items-start justify-start pt-3">
      <div className="w-full flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="ui-btn ui-btn-icon ui-btn-sm"
          aria-label="사이드바 열기"
        >
          <Menu size={16} />
        </button>
        <div className="w-7 h-px bg-slate-300 my-1" />
        {COLLAPSED_NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex items-center justify-center w-8 h-8 rounded-md border transition-colors ${
                isActive
                  ? 'border-slate-400 bg-slate-200 text-slate-900'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-100'
              }`}
              title={item.label}
              aria-label={item.label}
            >
              <Icon size={15} />
            </Link>
          )
        })}
      </div>
    </aside>
  )
}

export default function AppShell({
  children,
  channels = [],
  onChannelAdded,
  onChannelRemoved,
  onChannelSelected,
  onChannelClearFilter,
  selectedChannelIds = [],
  newVideoCount = 0,
  onManualRefresh,
}: AppShellProps) {
  const pathname = usePathname()
  const isSettingsPage = pathname === '/settings'
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)
  const [channelOrder, setChannelOrder] = useState<string[]>([])
  const [mode, setMode] = useState<'light' | 'dark'>('light')
  const [tone, setTone] = useState<'cool' | 'beige'>('cool')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DESKTOP_SIDEBAR_OPEN_KEY)
      if (saved === '0') setDesktopSidebarOpen(false)
      if (saved === '1') setDesktopSidebarOpen(true)
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHANNEL_ORDER_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setChannelOrder(parsed.filter((v): v is string => typeof v === 'string'))
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem(MODE_KEY)
      const savedTone = localStorage.getItem(TONE_KEY)
      if (savedMode === 'light' || savedMode === 'dark') setMode(savedMode)
      if (savedTone === 'cool' || savedTone === 'beige') setTone(savedTone)
      if (savedMode === 'light' || savedMode === 'dark') return
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      setMode(prefersDark ? 'dark' : 'light')
    } catch {}
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark', 'beige')
    if (mode === 'dark') root.classList.add('dark')
    if (tone === 'beige') root.classList.add('beige')
  }, [mode, tone])

  useEffect(() => {
    const channelIds = channels.map((c) => c.youtube_channel_id)
    setChannelOrder((prev) => {
      const prevFiltered = prev.filter((id) => channelIds.includes(id))
      const missing = channelIds.filter((id) => !prevFiltered.includes(id))
      const next = [...prevFiltered, ...missing]
      try {
        localStorage.setItem(CHANNEL_ORDER_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }, [channels])

  const orderedChannels = (() => {
    if (channelOrder.length === 0) return channels
    const idxMap = new Map(channelOrder.map((id, idx) => [id, idx] as const))
    return [...channels].sort((a, b) => {
      const aIdx = idxMap.get(a.youtube_channel_id)
      const bIdx = idxMap.get(b.youtube_channel_id)
      if (aIdx == null && bIdx == null) return 0
      if (aIdx == null) return 1
      if (bIdx == null) return -1
      return aIdx - bIdx
    })
  })()

  const handleChannelReorder = (sourceId: string, targetId: string) => {
    setChannelOrder((prev) => {
      const current = prev.length > 0 ? [...prev] : channels.map((c) => c.youtube_channel_id)
      const sourceIdx = current.indexOf(sourceId)
      const targetIdx = current.indexOf(targetId)
      if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return current
      const [moved] = current.splice(sourceIdx, 1)
      current.splice(targetIdx, 0, moved)
      try {
        localStorage.setItem(CHANNEL_ORDER_KEY, JSON.stringify(current))
      } catch {}
      return current
    })
  }

  const updateDesktopSidebarOpen = (open: boolean) => {
    setDesktopSidebarOpen(open)
    try {
      localStorage.setItem(DESKTOP_SIDEBAR_OPEN_KEY, open ? '1' : '0')
    } catch {}
  }

  const toggleMode = () =>
    setMode((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(MODE_KEY, next)
      } catch {}
      return next
    })

  const toggleTone = () =>
    setTone((prev) => {
      const next = prev === 'beige' ? 'cool' : 'beige'
      try {
        localStorage.setItem(TONE_KEY, next)
      } catch {}
      return next
    })

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <aside
        className={`hidden w-72 shrink-0 bg-slate-50 border-r border-slate-200 flex-col overflow-hidden ${
          desktopSidebarOpen ? 'lg:flex' : 'lg:hidden'
        }`}
      >
        <SidebarContent
          isSettingsPage={isSettingsPage}
          pathname={pathname}
          channels={orderedChannels}
          newVideoCount={newVideoCount}
          selectedChannelIds={selectedChannelIds}
          onChannelAdded={onChannelAdded}
          onChannelRemoved={onChannelRemoved}
          onChannelSelected={onChannelSelected}
          onChannelClearFilter={onChannelClearFilter}
          onChannelReorder={handleChannelReorder}
          onClose={() => updateDesktopSidebarOpen(false)}
        />
      </aside>
      {!desktopSidebarOpen && (
        <CollapsedSidebarRail pathname={pathname} onOpen={() => updateDesktopSidebarOpen(true)} />
      )}

      {mobileSidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-slate-900/35"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`lg:hidden fixed inset-x-0 bottom-0 z-50 h-[75vh] max-h-[640px] bg-slate-50 border-t border-slate-200 rounded-t-2xl flex flex-col overflow-hidden transition-transform duration-200 ${
          mobileSidebarOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <SidebarContent
          isSettingsPage={isSettingsPage}
          pathname={pathname}
          channels={orderedChannels}
          newVideoCount={newVideoCount}
          selectedChannelIds={selectedChannelIds}
          onChannelAdded={onChannelAdded}
          onChannelRemoved={onChannelRemoved}
          onChannelSelected={onChannelSelected}
          onChannelClearFilter={onChannelClearFilter}
          onChannelReorder={handleChannelReorder}
          onNavigate={() => setMobileSidebarOpen(false)}
          onClose={() => setMobileSidebarOpen(false)}
        />
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopNav
          onManualRefresh={onManualRefresh}
          mode={mode}
          tone={tone}
          onModeToggle={toggleMode}
          onToneToggle={toggleTone}
        />
        <main className="flex-1 overflow-y-auto p-5 pb-20 lg:pb-5">{children}</main>
      </div>

      {!mobileSidebarOpen && (
        <CollapsedSidebarRail
          pathname={pathname}
          onOpen={() => setMobileSidebarOpen(true)}
          mobile
        />
      )}
    </div>
  )
}
