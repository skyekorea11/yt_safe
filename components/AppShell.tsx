'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, LayoutDashboard, Heart, Settings } from 'lucide-react'
import TopNav from './TopNav'
import ChannelAddForm from './ChannelAddForm'
import { Channel } from '@/types'

const NAV_ITEMS = [
  { label: '대시보드', href: '/' },
  { label: '즐겨찾기', href: '/favorites' },
  { label: '설정', href: '/settings' },
] as const

const SETTINGS_MENU = [
  { label: '뉴스 채널', href: '/settings#news-channels' },
  { label: '채널별 관련주', href: '/settings#channel-stock-mode' },
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

interface AppShellProps {
  children: React.ReactNode
  channels?: Channel[]
  onChannelAdded?: () => void
  onChannelRemoved?: (channelId: string) => void
  onChannelSelected?: (channelId: string) => void
  nextRefresh?: string | null
  newVideoCount?: number
  onManualRefresh?: () => Promise<void>
}

interface SidebarContentProps {
  isSettingsPage: boolean
  pathname: string
  channels: Channel[]
  newVideoCount: number
  onChannelAdded?: () => void
  onChannelRemoved?: (channelId: string) => void
  onChannelSelected?: (channelId: string) => void
  onNavigate?: () => void
  onClose?: () => void
}

function SidebarContent({
  isSettingsPage,
  pathname,
  channels,
  newVideoCount,
  onChannelAdded,
  onChannelRemoved,
  onChannelSelected,
  onNavigate,
  onClose,
}: SidebarContentProps) {
  return (
    <>
      <div className="h-14 flex items-center justify-between px-5 font-semibold text-lg border-b border-slate-200 text-slate-800">
        <span>{isSettingsPage ? 'Settings' : 'Channels'}</span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
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
          <div className="space-y-1.5">
            {SETTINGS_MENU.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className="block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
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
            {channels.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500 text-center">
                아직 등록된 채널이 없습니다
              </div>
            ) : (
              <div className="space-y-1.5">
                {channels.map((channel) => (
                  <div
                    key={channel.youtube_channel_id}
                    onClick={() => {
                      onChannelSelected?.(channel.youtube_channel_id)
                      onNavigate?.()
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start gap-2">
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
                        {channel.handle ? (
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {channel.handle}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onChannelRemoved?.(channel.youtube_channel_id)
                        }}
                        className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors text-xs leading-none"
                        title="채널 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
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
            className="inline-flex items-center justify-center w-10 h-10 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100"
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
          className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100"
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
  nextRefresh,
  newVideoCount = 0,
  onManualRefresh,
}: AppShellProps) {
  const pathname = usePathname()
  const isSettingsPage = pathname === '/settings'
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)
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
          channels={channels}
          newVideoCount={newVideoCount}
          onChannelAdded={onChannelAdded}
          onChannelRemoved={onChannelRemoved}
          onChannelSelected={onChannelSelected}
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
          channels={channels}
          newVideoCount={newVideoCount}
          onChannelAdded={onChannelAdded}
          onChannelRemoved={onChannelRemoved}
          onChannelSelected={onChannelSelected}
          onNavigate={() => setMobileSidebarOpen(false)}
          onClose={() => setMobileSidebarOpen(false)}
        />
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopNav
          nextRefresh={nextRefresh}
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
