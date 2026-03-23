'use client'

import { RefreshCw, ChevronRight } from 'lucide-react'
import { NewsChannelItem } from '@/types/dashboard'

interface NewsPanelProps {
  domesticNewsItems: NewsChannelItem[]
  overseasNewsItems: NewsChannelItem[]
  newsPanelLoading: boolean
  newsPanelError: string
  newsPanelCollapsed: boolean
  setNewsPanelCollapsed: (fn: (prev: boolean) => boolean) => void
  supadataQuota: { remaining: number; total: number } | null
  panelMaxHeight: string
  onRefreshNewsPanel: (refresh: boolean) => void
}

export default function NewsPanel({
  domesticNewsItems,
  overseasNewsItems,
  newsPanelLoading,
  newsPanelError,
  newsPanelCollapsed,
  setNewsPanelCollapsed,
  supadataQuota,
  panelMaxHeight,
  onRefreshNewsPanel,
}: NewsPanelProps) {
  return (
    <div className="xl:sticky xl:top-24 flex flex-col gap-2" style={{ maxHeight: panelMaxHeight }}>
      {/* Supadata 쿼터 배지 */}
      {supadataQuota && (
        <div className="border border-slate-100 rounded-xl bg-white shadow-[0_1px_4px_rgba(16,24,40,0.06)] px-3 py-2 flex items-center gap-2">
          <p className="text-xs font-medium text-gray-500">자막 API 잔여</p>
          <p className="text-sm font-semibold text-gray-800 ml-auto">{supadataQuota.remaining} <span className="font-normal text-gray-400">/ {supadataQuota.total}</span></p>
        </div>
      )}

      <aside className={`border border-slate-100 rounded-2xl bg-white shadow-[0_1px_4px_rgba(16,24,40,0.06)] overflow-y-auto ${newsPanelCollapsed ? 'p-2' : 'p-3.5'}`}>
        <div className="flex items-center justify-between gap-2">
          {!newsPanelCollapsed && <h3 className="text-base font-semibold text-gray-800">최신 뉴스</h3>}
          <div className={`flex items-center gap-1 ${newsPanelCollapsed ? 'w-full justify-between' : ''}`}>
            {newsPanelCollapsed && (
              <span className="text-xs font-semibold text-gray-500 writing-mode-vertical">최신 뉴스</span>
            )}
            {!newsPanelCollapsed && (
              <button
                onClick={() => onRefreshNewsPanel(true)}
                disabled={newsPanelLoading}
                className="ui-btn-ghost-icon disabled:opacity-40"
                title="최신 뉴스 새로고침"
                aria-label="최신 뉴스 새로고침"
              >
                <RefreshCw size={14} className={newsPanelLoading ? 'animate-spin' : ''} />
              </button>
            )}
            <button
              onClick={() => setNewsPanelCollapsed(prev => !prev)}
              className="ui-btn-ghost-icon"
              title={newsPanelCollapsed ? '뉴스 패널 펼치기' : '뉴스 패널 접기'}
            >
              <ChevronRight size={14} className={`transition-transform ${newsPanelCollapsed ? '' : 'rotate-180'}`} />
            </button>
          </div>
        </div>

        {!newsPanelCollapsed && (
          newsPanelLoading ? (
            <p className="mt-3 text-sm text-gray-400 animate-pulse">최신 제목을 불러오는 중...</p>
          ) : newsPanelError ? (
            <p className="mt-3 text-sm text-gray-400">{newsPanelError}</p>
          ) : domesticNewsItems.length === 0 && overseasNewsItems.length === 0 ? (
            <p className="mt-3 text-sm text-gray-400">표시할 뉴스 채널 영상이 없습니다.</p>
          ) : (
            <div className="mt-3 space-y-4">
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-600">🇰🇷 국내 최신 Top 10</p>
                <div className="space-y-0.5">
                  {domesticNewsItems.slice(0, 10).map((item, idx) => (
                    <a
                      key={`dom-${item.youtubeVideoId}-${idx}`}
                      href={item.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg px-2 py-1 hover:bg-indigo-50 transition-colors"
                    >
                      <p className="text-sm font-normal text-gray-700 line-clamp-1 flex-1 min-w-0">• {item.title}</p>
                    </a>
                  ))}
                  {domesticNewsItems.length === 0 ? (
                    <p className="text-xs text-gray-400">국내 뉴스 채널이 없거나 최신 영상이 없습니다.</p>
                  ) : null}
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold text-gray-600">🌐 해외 최신 Top 10</p>
                <div className="space-y-0.5">
                  {overseasNewsItems.slice(0, 10).map((item, idx) => (
                    <a
                      key={`ovr-${item.youtubeVideoId}-${idx}`}
                      href={item.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg px-2 py-1 hover:bg-indigo-50 transition-colors"
                    >
                      <p className="text-sm font-normal text-gray-700 line-clamp-1 flex-1 min-w-0">• {item.title}</p>
                    </a>
                  ))}
                  {overseasNewsItems.length === 0 ? (
                    <p className="text-xs text-gray-400">해외 뉴스 채널이 없거나 최신 영상이 없습니다.</p>
                  ) : null}
                </div>
              </div>
            </div>
          )
        )}
      </aside>
    </div>
  )
}
