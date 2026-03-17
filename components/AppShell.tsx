'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, LayoutDashboard, Heart, Settings, GripVertical, FilterX, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
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
  { label: '표시 설정', href: '/settings#display-preferences' },
] as const

const COLLAPSED_NAV_ITEMS = [
  { label: '대시보드', href: '/', icon: LayoutDashboard },
  { label: '즐겨찾기', href: '/favorites', icon: Heart },
  { label: '설정', href: '/settings', icon: Settings },
] as const

type SidebarChannelGroup = 'news' | 'finance' | 'real_estate' | 'tech' | 'lifestyle' | 'etc'

const SIDEBAR_GROUPS: Array<{ key: SidebarChannelGroup; label: string }> = [
  { key: 'news', label: '뉴스/시사' },
  { key: 'finance', label: '경제/주식' },
  { key: 'real_estate', label: '부동산' },
  { key: 'tech', label: '테크/과학' },
  { key: 'lifestyle', label: '라이프/교양' },
  { key: 'etc', label: '기타' },
]

const isSidebarChannelGroup = (value: string | null | undefined): value is SidebarChannelGroup =>
  value === 'news' ||
  value === 'finance' ||
  value === 'real_estate' ||
  value === 'tech' ||
  value === 'lifestyle' ||
  value === 'etc'

const inferSidebarChannelGroup = (channel: Channel): SidebarChannelGroup => {
  const text = `${channel.title || ''} ${channel.description || ''} ${channel.handle || ''}`.toLowerCase()
  if (/(뉴스|시사|정치|속보|브리핑|economist|cnn|bbc|nyt|조선|중앙|한겨레|매일경제|한국경제)/.test(text)) return 'news'
  if (/(경제|주식|증시|투자|재테크|금리|채권|etf|연금|자산|펀드|코인|암호화폐)/.test(text)) return 'finance'
  if (/(부동산|아파트|청약|전세|월세|집값|재건축|재개발|임장|분양|신도시)/.test(text)) return 'real_estate'
  if (/(테크|기술|개발|코딩|프로그래밍|ai|인공지능|반도체|it|과학|우주)/.test(text)) return 'tech'
  if (/(교양|다큐|역사|여행|요리|건강|자기계발|라이프|문화|인터뷰)/.test(text)) return 'lifestyle'
  return 'etc'
}

const resolveSidebarChannelGroup = (channel: Channel): SidebarChannelGroup =>
  isSidebarChannelGroup(channel.channel_group) ? channel.channel_group : inferSidebarChannelGroup(channel)

interface AppShellProps {
  children: React.ReactNode
  channels?: Channel[]
  onChannelAdded?: () => void
  onChannelRemoved?: (channelId: string) => void
  onChannelSelected?: (channelId: string) => void
  onChannelGroupChanged?: (channelId: string, group: SidebarChannelGroup) => void | Promise<void>
  onChannelOrderChanged?: (orderedChannelIds: string[]) => void | Promise<void>
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
  onChannelGroupChanged?: (channelId: string, group: SidebarChannelGroup) => void | Promise<void>
  onChannelClearFilter?: () => void
  onChannelReorder?: (sourceId: string, targetId: string) => void
  groupingEnabled: boolean
  onGroupingToggle: () => void
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
  onChannelGroupChanged,
  onChannelClearFilter,
  onChannelReorder,
  groupingEnabled,
  onGroupingToggle,
  onNavigate,
  onClose,
}: SidebarContentProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragOverGroupKey, setDragOverGroupKey] = useState<SidebarChannelGroup | null>(null)
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<SidebarChannelGroup>>(new Set())
  const channelListRef = useRef<HTMLDivElement | null>(null)
  const groupedChannels = useMemo(() => {
    const map = new Map<SidebarChannelGroup, Channel[]>()
    for (const channel of channels) {
      const key = resolveSidebarChannelGroup(channel)
      const bucket = map.get(key) || []
      bucket.push(channel)
      map.set(key, bucket)
    }
    return map
  }, [channels])
  const renderChannelCard = (channel: Channel) => {
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
          setDragOverGroupKey(null)
        }}
        onDragEnd={() => {
          setDraggingId(null)
          setDragOverId(null)
          setDragOverGroupKey(null)
        }}
        onClick={() => {
          onChannelSelected?.(channel.youtube_channel_id)
        }}
        className={`rounded-lg border px-2.5 py-2 cursor-grab active:cursor-grabbing transition-colors ${
          dragOverId === channel.youtube_channel_id
            ? 'border-indigo-300 bg-indigo-50'
            : isSelected
            ? 'border-indigo-400 bg-indigo-50'
            : 'border-gray-200 bg-white hover:bg-gray-50'
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
            className="inline-flex items-center justify-center text-slate-400 flex-shrink-0"
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
    )
  }

  return (
    <>
      {onClose ? (
        <div className="flex justify-end px-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-icon ui-btn-sm"
            aria-label="사이드바 닫기"
          >
            ✕
          </button>
        </div>
      ) : null}

      <div className="px-3 py-2 flex gap-1 sidebar-nav-divider">
        {NAV_ITEMS.map(({ label, href }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex-1 text-center px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-50 text-indigo-600 font-semibold'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </div>

      {isSettingsPage ? (
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3 sidebar-add-divider">
            <p className="px-1 mb-2 text-[11px] font-medium text-slate-500">채널 추가</p>
            <ChannelAddForm onSuccess={onChannelAdded} compact />
          </div>
          <div className="px-3 py-3 space-y-1.5">
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
          <div className="px-4 py-3 sidebar-add-divider">
            <p className="px-1 mb-2 text-[11px] font-medium text-slate-500">채널 추가</p>
            <ChannelAddForm onSuccess={onChannelAdded} compact />
          </div>

          {newVideoCount > 0 && (
            <div className="mx-3 mt-2 px-3 py-2 bg-blue-50 rounded-lg text-xs text-blue-600 font-medium">
              새 영상 {newVideoCount}개 업데이트됨
            </div>
          )}

          <div
            ref={channelListRef}
            className="flex-1 overflow-y-auto px-3 py-3"
            onDragOver={(e) => {
              if (!draggingId) return
              const container = channelListRef.current
              if (!container) return
              const rect = container.getBoundingClientRect()
              const threshold = 64
              const maxStep = 26
              const y = e.clientY
              const topDist = y - rect.top
              const bottomDist = rect.bottom - y
              if (topDist < threshold) {
                const ratio = (threshold - topDist) / threshold
                container.scrollTop -= Math.ceil(maxStep * Math.max(0.25, ratio))
              } else if (bottomDist < threshold) {
                const ratio = (threshold - bottomDist) / threshold
                container.scrollTop += Math.ceil(maxStep * Math.max(0.25, ratio))
              }
            }}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className={`text-[11px] font-medium ${selectedChannelIds.length > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
                {selectedChannelIds.length > 0 ? `${selectedChannelIds.length}개 채널 필터 중` : '전체 채널'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onGroupingToggle}
                  className={`inline-flex items-center gap-1 text-[11px] transition-colors ${
                    groupingEnabled ? 'text-slate-600 hover:text-slate-800' : 'text-slate-500 hover:text-slate-700'
                  }`}
                  title="카테고리 보기 전환"
                >
                  카테고리 {groupingEnabled ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={onChannelClearFilter}
                  disabled={selectedChannelIds.length === 0}
                  className={`inline-flex items-center gap-1 text-[11px] transition-colors ${
                    selectedChannelIds.length > 0
                      ? 'text-slate-500 hover:text-slate-700'
                      : 'text-slate-400 cursor-default'
                  }`}
                  title="필터 해제"
                >
                  <FilterX size={12} />
                  전체 보기
                </button>
              </div>
            </div>
            {channels.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500 text-center">
                아직 등록된 채널이 없습니다
              </div>
            ) : (
              <div className="space-y-2">
                {groupingEnabled ? SIDEBAR_GROUPS.map((group) => {
                  const items = groupedChannels.get(group.key) || []
                  if (items.length === 0) return null
                  const isCollapsed = collapsedGroupKeys.has(group.key)
                  return (
                    <div
                      key={group.key}
                      className={`space-y-1.5 rounded-md ${dragOverGroupKey === group.key ? 'bg-indigo-50/60' : ''}`}
                      onDragOver={(e) => {
                        if (!draggingId) return
                        e.preventDefault()
                        setDragOverGroupKey(group.key)
                      }}
                      onDragLeave={() => {
                        if (dragOverGroupKey === group.key) setDragOverGroupKey(null)
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const sourceId = e.dataTransfer.getData('text/plain') || draggingId
                        if (sourceId) void onChannelGroupChanged?.(sourceId, group.key)
                        setDraggingId(null)
                        setDragOverId(null)
                        setDragOverGroupKey(null)
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedGroupKeys((prev) => {
                            const next = new Set(prev)
                            if (next.has(group.key)) next.delete(group.key)
                            else next.add(group.key)
                            return next
                          })
                        }
                        className="w-full flex items-center justify-between px-1 py-1 text-left"
                      >
                        <span className="text-[11px] font-semibold text-slate-500">
                          {group.label} ({items.length})
                        </span>
                        <ChevronDown
                          size={13}
                          className={`text-slate-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                        />
                      </button>
                      {!isCollapsed ? items.map((channel) => renderChannelCard(channel)) : null}
                    </div>
                  )
                }) : channels.map((channel) => renderChannelCard(channel))}
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
      <aside className="fixed inset-x-0 bottom-0 z-40 flex lg:hidden h-14 bg-white border-t border-slate-100 px-2 shadow-[0_-1px_3px_rgba(0,0,0,0.04)]">
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
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700'
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
    <aside className="relative hidden lg:flex w-12 shrink-0 bg-white border-r border-slate-100 items-start justify-start pt-3">
      <div className="w-full flex flex-col items-center gap-2">
        <div className="w-7 h-px bg-slate-200 my-1" />
        {COLLAPSED_NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex items-center justify-center w-8 h-8 rounded-md border transition-colors ${
                isActive
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
              title={item.label}
              aria-label={item.label}
            >
              <Icon size={15} />
            </Link>
          )
        })}
      </div>
      {/* Sticky-tab: protrudes from rail's right edge */}
      <button
        type="button"
        onClick={onOpen}
        className="absolute top-2 right-0 translate-x-full z-10 flex items-center justify-center bg-indigo-50 border border-l-0 border-indigo-200 rounded-r-lg px-1 py-2.5 shadow-sm hover:bg-indigo-100 transition-colors"
        aria-label="사이드바 열기"
      >
        <ChevronRight size={13} className="text-indigo-400" />
      </button>
    </aside>
  )
}

export default function AppShell({
  children,
  channels = [],
  onChannelAdded,
  onChannelRemoved,
  onChannelSelected,
  onChannelGroupChanged,
  onChannelOrderChanged,
  onChannelClearFilter,
  selectedChannelIds = [],
  newVideoCount = 0,
  onManualRefresh,
}: AppShellProps) {
  const pathname = usePathname()
  const isSettingsPage = pathname === '/settings'
  const topNavSubtitle = undefined
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)
  const [channelOrder, setChannelOrder] = useState<string[]>([])
  const [groupingEnabled, setGroupingEnabled] = useState(false)
  const [mode, setMode] = useState<'light' | 'dark'>('light')
  const [tone, setTone] = useState<'cool' | 'beige'>('cool')

  // Read localStorage after hydration to avoid SSR mismatch
  useEffect(() => {
    try {
      const savedMode = localStorage.getItem('theme-mode')
      if (savedMode === 'dark' || savedMode === 'light') {
        setMode(savedMode)
      } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        setMode('dark')
      }
      const savedTone = localStorage.getItem('theme-tone')
      if (savedTone === 'beige') setTone('beige')
      const savedSidebar = localStorage.getItem('sidebar-open')
      if (savedSidebar === 'false') setDesktopSidebarOpen(false)
    } catch {}
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark')
    if (mode === 'dark') root.classList.add('dark')
  }, [mode])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('beige')
    if (tone === 'beige') root.classList.add('beige')
  }, [tone])

  useEffect(() => {
    const channelIds = channels.map((c) => c.youtube_channel_id)
    setChannelOrder((prev) => {
      const prevFiltered = prev.filter((id) => channelIds.includes(id))
      const missing = channelIds.filter((id) => !prevFiltered.includes(id))
      return [...prevFiltered, ...missing]
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
    const current = channelOrder.length > 0 ? [...channelOrder] : channels.map((c) => c.youtube_channel_id)
    const sourceIdx = current.indexOf(sourceId)
    const targetIdx = current.indexOf(targetId)
    if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return
    const [moved] = current.splice(sourceIdx, 1)
    current.splice(targetIdx, 0, moved)
    setChannelOrder(current)
    void onChannelOrderChanged?.(current)
  }

  const updateDesktopSidebarOpen = (open: boolean) => {
    setDesktopSidebarOpen(open)
    try { localStorage.setItem('sidebar-open', String(open)) } catch {}
  }

  const toggleMode = () =>
    setMode((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('theme-mode', next) } catch {}
      return next
    })

  const toggleTone = () =>
    setTone((prev) => {
      const next = prev === 'beige' ? 'cool' : 'beige'
      try { localStorage.setItem('theme-tone', next) } catch {}
      return next
    })

  const toggleGrouping = () =>
    setGroupingEnabled((prev) => !prev)

  return (
    <div className="flex flex-col h-screen overflow-hidden app-shell-bg">
      <TopNav
        onManualRefresh={onManualRefresh}
        mode={mode}
        onModeToggle={toggleMode}
        tone={tone}
        onToneToggle={toggleTone}
        subtitle={topNavSubtitle}
      />

      <div className="flex flex-1 overflow-hidden min-w-0">
        <div className={`relative hidden shrink-0 ${desktopSidebarOpen ? 'lg:block' : 'lg:hidden'}`}>
          <aside className="w-72 h-full bg-white border-r border-slate-100 flex flex-col overflow-hidden">
            <SidebarContent
              isSettingsPage={isSettingsPage}
              pathname={pathname}
              channels={orderedChannels}
              newVideoCount={newVideoCount}
              selectedChannelIds={selectedChannelIds}
              onChannelAdded={onChannelAdded}
              onChannelRemoved={onChannelRemoved}
              onChannelSelected={onChannelSelected}
              onChannelGroupChanged={onChannelGroupChanged}
              onChannelClearFilter={onChannelClearFilter}
              onChannelReorder={handleChannelReorder}
              groupingEnabled={groupingEnabled}
              onGroupingToggle={toggleGrouping}
            />
          </aside>
          {/* Sticky-tab: protrudes from sidebar's right edge, aligned with nav items */}
          <button
            type="button"
            onClick={() => updateDesktopSidebarOpen(false)}
            className="absolute top-2 right-0 translate-x-full z-10 flex items-center justify-center bg-indigo-50 border border-l-0 border-indigo-200 rounded-r-lg px-1 py-2.5 shadow-sm hover:bg-indigo-100 transition-colors"
            aria-label="사이드바 닫기"
          >
            <ChevronLeft size={13} className="text-indigo-400" />
          </button>
        </div>
        {!desktopSidebarOpen && (
          <CollapsedSidebarRail pathname={pathname} onOpen={() => updateDesktopSidebarOpen(true)} />
        )}

        <main className="flex-1 overflow-y-auto p-5 pb-20 lg:pb-5 lg:pl-8">{children}</main>
      </div>

      {mobileSidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-slate-900/35"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`lg:hidden fixed inset-x-0 bottom-0 z-50 h-[75vh] max-h-[640px] bg-white border-t border-slate-100 rounded-t-2xl flex flex-col overflow-hidden transition-transform duration-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] ${
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
          onChannelGroupChanged={onChannelGroupChanged}
          onChannelClearFilter={onChannelClearFilter}
          onChannelReorder={handleChannelReorder}
          groupingEnabled={groupingEnabled}
          onGroupingToggle={toggleGrouping}
          onNavigate={() => setMobileSidebarOpen(false)}
          onClose={() => setMobileSidebarOpen(false)}
        />
      </aside>

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
