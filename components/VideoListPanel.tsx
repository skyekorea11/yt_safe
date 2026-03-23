'use client'

import { RefObject } from 'react'
import { Heart, ArrowUpDown } from 'lucide-react'
import { Video } from '@/types'
import { VideoSortMode } from '@/types/dashboard'
import VideoDetailPanel from '@/components/VideoDetailPanel'
import { RelatedNewsItem, StockSuggestion, ChannelVideoItem } from '@/types/dashboard'

interface VideoListPanelProps {
  sortedVideos: Video[]
  selectedVideo: Video | null
  selectedVideoId: string | null
  setSelectedVideoId: (id: string | null) => void
  visibleCount: number
  setVisibleCount: (fn: (v: number) => number) => void
  videoSortMode: VideoSortMode
  setVideoSortMode: (mode: VideoSortMode) => void
  weeklyVideoCount: number
  favoriteIds: Set<string>
  togglingIds: Set<string>
  filterText: string
  setFilterText: (text: string) => void
  channelThumbById: Map<string, string>
  panelMaxHeight: string
  videoListRef: RefObject<HTMLDivElement | null>
  isNewVideo: (video: Video) => boolean
  getChannelDisplayName: (video: Video) => string
  onToggleFavorite: (videoId: string) => void
  // Props forwarded to VideoDetailPanel (for inline mobile view)
  summaryLoadingVideoId: string | null
  summaryElapsedSeconds: number
  confirmedUnavailableIds: Set<string>
  newsByVideoId: Record<string, RelatedNewsItem[]>
  stocksByVideoId: Record<string, StockSuggestion[]>
  newsLoadingVideoId: string | null
  newsErrorByVideoId: Record<string, string>
  externalChannelVideosById: Record<string, ChannelVideoItem[]>
  externalChannelVideoLoadingById: Record<string, boolean>
  externalChannelVideoErrorById: Record<string, string>
  relatedVideoRecommendationsById: Map<string, Video[]>
  getChannelModes: (video: Video) => { stock: 'auto'; news: 'auto' | 'strict' | 'off' }
  getEmptyNewsMessage: (video: Video) => string
  formatPublishedDate: (value: string | null) => string
  onRefreshSummary: (videoId: string) => void
  onRefreshNews: (videoId: string, cacheKey: string, target: 'news') => void
  onRefreshRelatedVideos: (videoId: string) => void
}

export default function VideoListPanel({
  sortedVideos,
  selectedVideo,
  selectedVideoId,
  setSelectedVideoId,
  visibleCount,
  setVisibleCount,
  videoSortMode,
  setVideoSortMode,
  weeklyVideoCount,
  favoriteIds,
  togglingIds,
  filterText,
  setFilterText,
  channelThumbById,
  panelMaxHeight,
  videoListRef,
  isNewVideo,
  getChannelDisplayName,
  onToggleFavorite,
  summaryLoadingVideoId,
  summaryElapsedSeconds,
  confirmedUnavailableIds,
  newsByVideoId,
  stocksByVideoId,
  newsLoadingVideoId,
  newsErrorByVideoId,
  externalChannelVideosById,
  externalChannelVideoLoadingById,
  externalChannelVideoErrorById,
  relatedVideoRecommendationsById,
  getChannelModes,
  getEmptyNewsMessage,
  formatPublishedDate,
  onRefreshSummary,
  onRefreshNews,
  onRefreshRelatedVideos,
}: VideoListPanelProps) {
  return (
    <div
      ref={videoListRef}
      className="border border-slate-100 rounded-2xl bg-white shadow-[0_1px_4px_rgba(16,24,40,0.06)] overflow-y-auto"
      style={{ maxHeight: panelMaxHeight }}
      onScroll={(e) => {
        const el = e.currentTarget
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200)
          setVisibleCount(v => v + 20)
      }}
    >
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-600 truncate">
            나의 구독 영상 (7일간 {weeklyVideoCount}개 영상)
          </p>
          <label className="inline-flex items-center gap-1 text-xs text-slate-500">
            <ArrowUpDown size={12} />
            <span>정렬</span>
            <select
              value={videoSortMode}
              onChange={(e) => {
                setVideoSortMode(e.target.value as VideoSortMode)
                setVisibleCount(() => 20)
              }}
              className="h-7 rounded-md border border-slate-300 px-1.5 text-xs text-slate-700 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <option value="interest">관심도</option>
              <option value="latest">최신</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={filterText}
            onChange={(e) => {
              setFilterText(e.target.value)
              setVisibleCount(() => 20)
            }}
            placeholder="제목 검색하기"
            className="h-8 flex-1 rounded-lg border border-slate-300 px-2.5 text-sm text-slate-700 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
      </div>
      {sortedVideos.length === 0 ? (
        <div className="p-10 text-center text-sm text-gray-400">영상이 없습니다</div>
      ) : (
        sortedVideos.slice(0, visibleCount).map((video, idx) => {
          const isSelected = selectedVideo?.youtube_video_id === video.youtube_video_id
          const isFav = favoriteIds.has(video.youtube_video_id)

          return (
            <div
              key={video.youtube_video_id}
              data-video-id={video.youtube_video_id}
              role="button"
              tabIndex={0}
              onClick={() =>
                setSelectedVideoId(
                  selectedVideoId === video.youtube_video_id ? null : video.youtube_video_id
                )
              }
              onKeyDown={(e) =>
                e.key === 'Enter' &&
                setSelectedVideoId(
                  selectedVideoId === video.youtube_video_id ? null : video.youtube_video_id
                )
              }
              className={`dashboard-video-item group
                w-full text-left px-3 py-3 transition-colors cursor-pointer
                ${idx !== 0 ? 'border-t border-slate-100' : ''}
                ${isSelected ? 'dashboard-video-selected border-l-4 pl-2.5' : 'hover:bg-slate-50/80'}
              `}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <h3 className="flex-1 flex items-start gap-1.5 text-[13px] font-semibold text-gray-900 leading-snug">
                    {channelThumbById.get(video.youtube_channel_id) ? (
                      <img
                        src={channelThumbById.get(video.youtube_channel_id)}
                        alt={getChannelDisplayName(video)}
                        className="w-4 h-4 rounded object-cover border border-slate-200 shrink-0 mt-0.5"
                      />
                    ) : (
                      <span className="w-4 h-4 rounded bg-slate-200 border border-slate-200 shrink-0 mt-0.5" />
                    )}
                    <span className="line-clamp-1">{video.title}</span>
                  </h3>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(video.youtube_video_id) }}
                    disabled={togglingIds.has(video.youtube_video_id)}
                    className="flex-shrink-0 p-1 rounded-md opacity-80 hover:opacity-100 hover:bg-slate-100 transition-colors disabled:opacity-50"
                    title={isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                  >
                    <Heart
                      size={13}
                      className={isFav ? 'text-red-400 fill-red-400' : 'text-gray-300'}
                    />
                  </button>
                </div>
                <div className={`video-meta-text mt-1 pl-[22px] flex items-center gap-2 text-[11px] ${isSelected ? 'text-slate-700' : 'text-gray-500'}`}>
                  <span className="truncate flex-1">{getChannelDisplayName(video)}</span>
                  {isNewVideo(video) && (
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" title="신규 영상" />
                  )}
                  <span className="shrink-0 tabular-nums">
                    {new Date(video.published_at).toLocaleDateString('ko-KR')}
                  </span>
                </div>
              </div>

              {isSelected && (
                <div
                  className="xl:hidden mt-3 border-t border-slate-200 pt-3"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <VideoDetailPanel
                    video={video}
                    summaryLoadingVideoId={summaryLoadingVideoId}
                    summaryElapsedSeconds={summaryElapsedSeconds}
                    confirmedUnavailableIds={confirmedUnavailableIds}
                    favoriteIds={favoriteIds}
                    togglingIds={togglingIds}
                    newsByVideoId={newsByVideoId}
                    stocksByVideoId={stocksByVideoId}
                    newsLoadingVideoId={newsLoadingVideoId}
                    newsErrorByVideoId={newsErrorByVideoId}
                    externalChannelVideosById={externalChannelVideosById}
                    externalChannelVideoLoadingById={externalChannelVideoLoadingById}
                    externalChannelVideoErrorById={externalChannelVideoErrorById}
                    relatedVideoRecommendationsById={relatedVideoRecommendationsById}
                    isNewVideo={isNewVideo}
                    getChannelModes={getChannelModes}
                    getEmptyNewsMessage={getEmptyNewsMessage}
                    formatPublishedDate={formatPublishedDate}
                    onToggleFavorite={onToggleFavorite}
                    onRefreshSummary={onRefreshSummary}
                    onRefreshNews={onRefreshNews}
                    onRefreshRelatedVideos={onRefreshRelatedVideos}
                  />
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
