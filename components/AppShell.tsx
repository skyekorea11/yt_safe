'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import TopNav from './TopNav'
import ChannelAddForm from './ChannelAddForm'
import { Channel } from '@/types'

const NAV_ITEMS = [
  { label: '대시보드', href: '/' },
  { label: '즐겨찾기', href: '/favorites' },
  { label: '설정',     href: '/settings' },
] as const

const SETTINGS_MENU = [
  { label: '뉴스 채널', href: '/settings#news-channels' },
  { label: '채널별 관련주', href: '/settings#channel-stock-mode' },
  { label: '표시 설정', href: '/settings#display-preferences' },
] as const

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

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="h-14 flex items-center px-5 font-semibold text-lg border-b border-gray-200 text-gray-800">
          {isSettingsPage ? 'Settings' : 'Channels'}
        </div>

        {/* Nav links */}
        <div className="px-3 py-2 border-b border-gray-100 flex gap-1">
          {NAV_ITEMS.map(({ label, href }) => {
            const isActive = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 text-center px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
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
                  className="block rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Channel Add */}
            <div className="px-4 py-3 border-b border-gray-100">
              <ChannelAddForm onSuccess={onChannelAdded} compact />
            </div>

            {/* New video notification */}
            {newVideoCount > 0 && (
              <div className="mx-3 mt-2 px-3 py-2 bg-blue-50 rounded-lg text-xs text-blue-600 font-medium">
                새 영상 {newVideoCount}개 업데이트됨
              </div>
            )}

            {/* Channel List */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
              {channels.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-400 text-center">
                  아직 등록된 채널이 없습니다
                </div>
              ) : (
                <div className="space-y-1.5">
                  {channels.map((channel) => (
                    <div
                      key={channel.youtube_channel_id}
                      onClick={() => onChannelSelected?.(channel.youtube_channel_id)}
                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        {channel.thumbnail_url ? (
                          <img
                            src={channel.thumbnail_url}
                            alt={channel.title}
                            className="w-7 h-7 rounded-md object-cover flex-shrink-0 border border-gray-100"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-md bg-gray-100 flex-shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-[13px] text-gray-800 truncate">
                            {channel.title}
                          </div>
                          {channel.handle ? (
                            <div className="text-[11px] text-gray-400 truncate mt-0.5">
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
                          className="rounded-md p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors text-xs leading-none"
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

      </aside>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopNav nextRefresh={nextRefresh} onManualRefresh={onManualRefresh} />
        <main className="flex-1 overflow-y-auto p-5">
          {children}
        </main>
      </div>

    </div>
  )
}
