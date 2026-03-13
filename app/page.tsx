'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { Channel, Video } from '@/types'
import { channelRepository } from '@/lib/supabase/channels'
import { videoRepository, videoFavoriteRepository } from '@/lib/supabase/videos'
import { MOCK_CHANNELS, MOCK_VIDEOS } from '@/lib/mock-data'
import AppShell from '@/components/AppShell'
import EmptyState from '@/components/EmptyState' 
import { LoadingGridSkeleton } from '@/components/LoadingSkeleton'
import { useVideoFilter, useSummaryPreferences } from '@/hooks/useVideo' 
import { refreshAllChannelsAction, removeChannelAction, refreshVideoSummaryAction } from '@/actions/channel-actions'
import { updateVideoFavoriteAction } from '@/actions/note-actions'
import { isNewsFavorited, loadNewsFavorites, NewsFavoriteMap, toggleNewsFavorite } from '@/lib/news-favorites'
import { isValidStoredVideo } from '@/lib/utils/video-validity'

interface RefreshStatus {
  lastRefreshed: string | null
  nextRefresh: string | null
  newVideoCount: number
}

interface RelatedNewsItem {
  title: string
  link: string
  source: string
  publishedAt: string | null
}

interface StockSuggestion {
  ticker: string
  name: string
  market: 'KOSPI' | 'KOSDAQ' | 'NYSE' | 'NASDAQ' | 'HKEX' | 'TSE' | 'TWSE'
  is_core?: boolean
}

interface NewsChannelItem {
  youtubeVideoId: string
  title: string
  channelTitle: string
  publishedAt: string
  videoUrl: string
}

export default function DashboardPage() {
  const panelMaxHeight = 'calc(100vh - 64px)'

  const [channels, setChannels] = useState<Channel[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(20)
  const [isSummaryLoading, setIsSummaryLoading] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>({
    lastRefreshed: null,
    nextRefresh: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    newVideoCount: 0,
  })
  const [newsByVideoId, setNewsByVideoId] = useState<Record<string, RelatedNewsItem[]>>({})
  const [stocksByVideoId, setStocksByVideoId] = useState<Record<string, StockSuggestion[]>>({})
  const [newsCacheKeyByVideoId, setNewsCacheKeyByVideoId] = useState<Record<string, string>>({})
  const [newsLoadingVideoId, setNewsLoadingVideoId] = useState<string | null>(null)
  const [stocksLoadingVideoId, setStocksLoadingVideoId] = useState<string | null>(null)
  const [newsErrorByVideoId, setNewsErrorByVideoId] = useState<Record<string, string>>({})
  const [newsFavorites, setNewsFavorites] = useState<NewsFavoriteMap>({})
  const [domesticNewsItems, setDomesticNewsItems] = useState<NewsChannelItem[]>([])
  const [overseasNewsItems, setOverseasNewsItems] = useState<NewsChannelItem[]>([])
  const [newsPanelLoading, setNewsPanelLoading] = useState(false)
  const [newsPanelError, setNewsPanelError] = useState('')
  const prevLastRefreshed = useRef<string | null>(null)

  const { filteredVideos } = useVideoFilter(videos)
  const { enableTranscriptPipeline } = useSummaryPreferences()
  const channelTitleById = useMemo(
    () => new Map(channels.map((channel) => [channel.youtube_channel_id, channel.title])),
    [channels]
  )

  useEffect(() => { loadData() }, [])
  useEffect(() => { setNewsFavorites(loadNewsFavorites()) }, [])

  // 60초마다 refresh 상태 폴링
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/refresh-status')
        if (!res.ok) return
        const data: RefreshStatus = await res.json()
        // 새 auto-refresh 감지 시 영상 목록 재로드
        if (data.lastRefreshed && data.lastRefreshed !== prevLastRefreshed.current) {
          if (prevLastRefreshed.current !== null) await loadData()
          prevLastRefreshed.current = data.lastRefreshed
        }
        setRefreshStatus(data)
      } catch {}
    }
    poll()
    const id = setInterval(poll, 60000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleManualRefresh = async () => {
    const result = await refreshAllChannelsAction()
    if (result.success) {
      await loadData()
      setRefreshStatus({
        lastRefreshed: new Date().toISOString(),
        nextRefresh: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        newVideoCount: result.newCount,
      })
    }
  }

  const isNewVideo = (video: Video) => {
    if (!refreshStatus?.lastRefreshed) return false
    return new Date(video.created_at).getTime() >= new Date(refreshStatus.lastRefreshed).getTime() - 60000
  }

  const getChannelDisplayName = (video: Video) =>
    video.channel_title || channelTitleById.get(video.youtube_channel_id) || '채널 정보 없음'

  const formatPublishedDate = (value: string | null) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleDateString('ko-KR')
  }

  const formatRelativeTime = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const diffMs = Date.now() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHour = Math.floor(diffMin / 60)
    if (diffHour < 24) return `${diffHour}hr ago`
    const diffDay = Math.floor(diffHour / 24)
    return `${diffDay}d ago`
  }

  const newsTimeBadgeClass = (position: number, total: number) => {
    const palette = [
      'bg-red-500 text-white',
      'bg-red-600 text-white',
      'bg-red-700 text-white',
      'bg-red-800 text-white',
      'bg-rose-900 text-white',
      'bg-zinc-700 text-white',
      'bg-zinc-800 text-white',
      'bg-zinc-900 text-white',
      'bg-neutral-900 text-white',
      'bg-black text-white',
    ]
    if (total <= 1) return palette[0]
    const mapped = Math.round((position / (total - 1)) * (palette.length - 1))
    return palette[Math.min(Math.max(mapped, 0), palette.length - 1)]
  }

  const toggleArticleFavorite = (videoId: string, link: string) => {
    setNewsFavorites(prev => toggleNewsFavorite(prev, videoId, link))
  }

  const loadRelatedNews = async (
    videoId: string,
    cacheKey: string,
    refreshTarget: 'news' | 'stocks' | null = null
  ) => {
    if (!refreshTarget && newsCacheKeyByVideoId[videoId] === cacheKey) return
    if (refreshTarget === 'stocks') {
      setStocksLoadingVideoId(videoId)
    } else if (refreshTarget === 'news') {
      setNewsLoadingVideoId(videoId)
    } else {
      setNewsLoadingVideoId(videoId)
      setStocksLoadingVideoId(videoId)
    }
    setNewsErrorByVideoId(prev => ({ ...prev, [videoId]: '' }))
    try {
      const url = refreshTarget
        ? `/api/videos/${videoId}/news?refresh=${refreshTarget}`
        : `/api/videos/${videoId}/news`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error('뉴스를 불러오지 못했습니다')
      const data = await res.json()
      const articles = Array.isArray(data?.articles) ? data.articles : []
      const stocks = Array.isArray(data?.stocks) ? data.stocks : []
      if (refreshTarget !== 'stocks') {
        setNewsByVideoId(prev => ({ ...prev, [videoId]: articles }))
      }
      if (refreshTarget !== 'news') {
        setStocksByVideoId(prev => ({ ...prev, [videoId]: stocks }))
      }
      setNewsCacheKeyByVideoId(prev => ({ ...prev, [videoId]: cacheKey }))
    } catch (error) {
      console.error(error)
      setNewsErrorByVideoId(prev => ({ ...prev, [videoId]: '뉴스를 가져오지 못했습니다.' }))
    } finally {
      setNewsLoadingVideoId(prev => (prev === videoId ? null : prev))
      setStocksLoadingVideoId(prev => (prev === videoId ? null : prev))
    }
  }

  const loadNewsChannelPanel = async (refresh = false) => {
    setNewsPanelLoading(true)
    setNewsPanelError('')
    try {
      const url = refresh ? '/api/news-channels/latest?refresh=true' : '/api/news-channels/latest'
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error('뉴스 채널 패널을 불러오지 못했습니다')
      const data = await res.json()
      setDomesticNewsItems(Array.isArray(data?.domesticItems) ? data.domesticItems : [])
      setOverseasNewsItems(Array.isArray(data?.overseasItems) ? data.overseasItems : [])
    } catch (error) {
      console.error(error)
      setNewsPanelError('뉴스 채널 패널을 불러오지 못했습니다.')
    } finally {
      setNewsPanelLoading(false)
    }
  }

  const loadData = async () => {
    setIsLoading(true)
    try {
      const hasApiKey = !!process.env.NEXT_PUBLIC_YOUTUBE_API_KEY?.trim()
      if (!hasApiKey) {
        setChannels(MOCK_CHANNELS)
        setVideos(MOCK_VIDEOS)
        setSelectedVideoId(MOCK_VIDEOS[0]?.youtube_video_id ?? null)
        setFavoriteIds(new Set())
        setDomesticNewsItems([])
        setOverseasNewsItems([])
        return
      }
      const [channelsData, videosData, favoritesData] = await Promise.all([
        channelRepository.getAll(),
        videoRepository.getAll(),
        videoFavoriteRepository.getAllFavorites(),
      ])
      const validVideosData = videosData.filter(isValidStoredVideo)
      setChannels(channelsData)
      setVideos(validVideosData)
      setSelectedVideoId(validVideosData[0]?.youtube_video_id ?? null)
      setFavoriteIds(new Set(favoritesData.map(f => f.youtube_video_id)))
      // DB에 캐시된 뉴스/종목 데이터로 초기화 (API 호출 불필요)
      const newsInit: Record<string, RelatedNewsItem[]> = {}
      const stocksInit: Record<string, StockSuggestion[]> = {}
      const cacheKeyInit: Record<string, string> = {}
      for (const v of validVideosData) {
        if (Array.isArray(v.related_news) && v.related_news.length > 0) {
          newsInit[v.youtube_video_id] = v.related_news as RelatedNewsItem[]
          cacheKeyInit[v.youtube_video_id] = `${v.summary_text || ''}|${v.title || ''}`
        }
        if (Array.isArray(v.related_stocks) && v.related_stocks.length > 0)
          stocksInit[v.youtube_video_id] = v.related_stocks as StockSuggestion[]
      }
      setNewsByVideoId(newsInit)
      setStocksByVideoId(stocksInit)
      setNewsCacheKeyByVideoId(cacheKeyInit)
      void loadNewsChannelPanel()
    } catch (error) {
      console.error(error)
      setChannels(MOCK_CHANNELS)
      setVideos(MOCK_VIDEOS)
      setSelectedVideoId(MOCK_VIDEOS[0]?.youtube_video_id ?? null)
      setFavoriteIds(new Set())
      setDomesticNewsItems([])
      setOverseasNewsItems([])
    } finally {
      setIsLoading(false)
    }
  }

  const toggleFavorite = async (videoId: string) => {
    if (togglingIds.has(videoId)) return
    const isCurrentlyFav = favoriteIds.has(videoId)

    setFavoriteIds(prev => {
      const next = new Set(prev)
      isCurrentlyFav ? next.delete(videoId) : next.add(videoId)
      return next
    })
    setTogglingIds(prev => new Set(prev).add(videoId))

    try {
      const success = await updateVideoFavoriteAction(videoId, !isCurrentlyFav)
      if (!success) {
        setFavoriteIds(prev => {
          const next = new Set(prev)
          isCurrentlyFav ? next.add(videoId) : next.delete(videoId)
          return next
        })
      }
    } catch (err) {
      console.error(err)
      setFavoriteIds(prev => {
        const next = new Set(prev)
        isCurrentlyFav ? next.add(videoId) : next.delete(videoId)
        return next
      })
    } finally {
      setTogglingIds(prev => {
        const next = new Set(prev)
        next.delete(videoId)
        return next
      })
    }
  }

  const handleRefreshSummary = async (videoId: string) => {
    const video = videos.find(v => v.youtube_video_id === videoId)
    if (!video) return

    setIsSummaryLoading(true)
    setVideos(prev =>
      prev.map(v =>
        v.youtube_video_id === videoId
          ? {
              ...v,
              transcript_status: v.transcript_text ? v.transcript_status : 'pending',
              summary_status: 'pending',
            }
          : v
      )
    )
    try {
      const result = await refreshVideoSummaryAction(videoId, video.title, video.description, enableTranscriptPipeline)
      if (result.video) {
        setVideos(prev =>
          prev.map(v => (v.youtube_video_id === videoId ? { ...v, ...result.video } : v))
        )
        const cacheKey = `${result.video.summary_text || ''}|${result.video.title || ''}`
        void loadRelatedNews(videoId, cacheKey, 'news')
      }
    } catch (error) {
      console.error('Error refreshing summary:', error)
    } finally {
      setIsSummaryLoading(false)
    }
  }

  const sortedVideos = useMemo(() => {
    const base = selectedChannelId
      ? filteredVideos.filter(v => v.youtube_channel_id === selectedChannelId)
      : filteredVideos
    return [...base].sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    )
  }, [filteredVideos, selectedChannelId])

  const selectedVideo = useMemo(() =>
    sortedVideos.find(v => v.youtube_video_id === selectedVideoId) ?? sortedVideos[0] ?? null,
    [sortedVideos, selectedVideoId]
  )

  useEffect(() => {
    if (!selectedVideo) return
    const cacheKey = `${selectedVideo.summary_text || ''}|${selectedVideo.title || ''}`
    void loadRelatedNews(selectedVideo.youtube_video_id, cacheKey)
  }, [selectedVideo?.youtube_video_id, selectedVideo?.summary_text]) // eslint-disable-line react-hooks/exhaustive-deps

  const shellProps = {
    channels,
    onChannelAdded:    loadData,
    onChannelRemoved:  async (channelId: string) => {
      await removeChannelAction(channelId)
      await loadData()
    },
    onChannelSelected: (id: string) => setSelectedChannelId(id),
    nextRefresh:       refreshStatus.nextRefresh,
    newVideoCount:     refreshStatus?.newVideoCount ?? 0,
    onManualRefresh:   handleManualRefresh,
  }

  if (isLoading) {
    return <AppShell {...shellProps}><LoadingGridSkeleton count={6} /></AppShell>
  }

  return (
    <AppShell {...shellProps}>
      <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)_320px] gap-4">

        {/* ── 좌측: 영상 목록 ──────────────────────────────────────────── */}
        <div
          className="border border-gray-200 rounded-2xl bg-white overflow-y-auto"
          style={{ maxHeight: panelMaxHeight }}
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200)
              setVisibleCount(v => v + 20)
          }}
        >
          {sortedVideos.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-400">영상이 없습니다</div>
          ) : (
            sortedVideos.slice(0, visibleCount).map((video, idx) => {
              const isSelected = selectedVideo?.youtube_video_id === video.youtube_video_id
              const isFav = favoriteIds.has(video.youtube_video_id)

              return (
                // ✅ 수정: 바깥 <button> → <div role="button">으로 교체
                //    내부에 <button>(하트)이 있으므로 중첩 button 에러 방지
                <div
                  key={video.youtube_video_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedVideoId(video.youtube_video_id)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedVideoId(video.youtube_video_id)}
                  className={`
                    w-full text-left p-4 transition-colors cursor-pointer
                    ${idx !== 0 ? 'border-t border-gray-100' : ''}
                    ${isSelected ? 'bg-gray-50' : 'hover:bg-gray-50'}
                  `}
                >
                  <div className="flex gap-2.5">
                    <img
                      src={video.thumbnail_url}
                      alt={video.title}
                      className="w-22 h-12 object-cover rounded-lg flex-shrink-0 border border-gray-100"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-1">
                        <h3 className="flex-1 text-sm font-semibold text-gray-800 line-clamp-2 leading-snug">
                          {video.title}
                        </h3>
                        {/* 하트 버튼 */}
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(video.youtube_video_id) }}
                          disabled={togglingIds.has(video.youtube_video_id)}
                          className="flex-shrink-0 p-1 rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50"
                          title={isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                        >
                          <Heart
                            size={14}
                            className={isFav ? 'text-red-400 fill-red-400' : 'text-gray-300'}
                          />
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-gray-400 truncate">
                        {getChannelDisplayName(video)}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-300 flex items-center gap-1">
                        {isNewVideo(video) && (
                          <span className="px-1 py-0.5 bg-blue-100 text-blue-600 rounded text-[10px] font-semibold leading-none">New</span>
                        )}
                        {new Date(video.published_at).toLocaleDateString('ko-KR')}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* ── 가운데: 영상 상세 ────────────────────────────────────────── */}
        <div
          className="border border-gray-200 rounded-2xl bg-white p-6 overflow-y-auto"
          style={{ maxHeight: panelMaxHeight }}
        >
          {selectedVideo ? (
            <div className="space-y-4">

              {/* 제목 + 하트 */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 leading-snug">
                    {selectedVideo.title}
                  </h2>
                  {isNewVideo(selectedVideo) && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs">
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded font-semibold">New</span>
                      <span className="text-gray-400">
                        {new Date(selectedVideo.created_at).toLocaleString('ko-KR', {
                          year: 'numeric', month: '2-digit', day: '2-digit',
                          hour: '2-digit', minute: '2-digit', second: '2-digit',
                        })}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => toggleFavorite(selectedVideo.youtube_video_id)}
                  disabled={togglingIds.has(selectedVideo.youtube_video_id)}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  <Heart
                    size={14}
                    className={favoriteIds.has(selectedVideo.youtube_video_id)
                      ? 'text-red-400 fill-red-400'
                      : 'text-gray-300'}
                  />
                  {favoriteIds.has(selectedVideo.youtube_video_id) ? '즐겨찾기 해제' : '즐겨찾기'}
                </button>
              </div>

              <div className="space-y-3">
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <iframe
                    src={`https://www.youtube.com/embed/${selectedVideo.youtube_video_id}`}
                    className="w-full aspect-video"
                    allowFullScreen
                  />
                </div>

                <div className="border border-gray-200 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">영상 요약</h3>
                  {selectedVideo.transcript_status === 'not_available' ? (
                    <p className="text-sm text-gray-400">아직 자막을 추출할 수 없습니다.</p>
                  ) : selectedVideo.transcript_status === 'pending' ? (
                    <p className="text-sm text-gray-400 animate-pulse">자막 추출 중...</p>
                  ) : selectedVideo.summary_status === 'failed' && selectedVideo.summary_text ? (
                    <p className="text-sm text-gray-400">{selectedVideo.summary_text}</p>
                  ) : selectedVideo.summary_status === 'complete' && selectedVideo.summary_text ? (
                    <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed">
                      {selectedVideo.summary_text}
                    </p>
                  ) : isSummaryLoading ? (
                    <p className="text-sm text-gray-400 animate-pulse">요약 생성 중...</p>
                  ) : (
                    <p className="text-sm text-gray-400">아직 요약이 없습니다</p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleRefreshSummary(selectedVideo.youtube_video_id)}
                    disabled={isSummaryLoading}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isSummaryLoading
                      ? selectedVideo.transcript_status === 'pending'
                        ? '자막 추출 중...'
                        : '요약 생성 중...'
                      : selectedVideo.summary_status === 'complete' && !!selectedVideo.summary_text
                      ? '요약 다시 생성'
                      : selectedVideo.summary_status === 'failed' || selectedVideo.transcript_status === 'not_available'
                      ? '요약 다시 시도'
                      : '요약 생성'}
                  </button>
                  <a
                    href={`https://youtube.com/watch?v=${selectedVideo.youtube_video_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    유튜브 보기
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

                {/* 관련 뉴스 */}
                <div className="border border-gray-200 rounded-xl p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-700">관련 뉴스</h3>
                    <button
                      onClick={() => {
                        const cacheKey = `${selectedVideo.summary_text || ''}|${selectedVideo.title || ''}`
                        void loadRelatedNews(selectedVideo.youtube_video_id, cacheKey, 'news')
                      }}
                      className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                      새로고침
                    </button>
                  </div>
                  {newsLoadingVideoId === selectedVideo.youtube_video_id ? (
                    <p className="text-sm text-gray-400 animate-pulse">관련 뉴스를 찾는 중...</p>
                  ) : newsErrorByVideoId[selectedVideo.youtube_video_id] ? (
                    <p className="text-sm text-gray-400">{newsErrorByVideoId[selectedVideo.youtube_video_id]}</p>
                  ) : (newsByVideoId[selectedVideo.youtube_video_id] || []).length === 0 ? (
                    <p className="text-sm text-gray-400">요약 기반으로 찾은 뉴스가 없습니다.</p>
                  ) : (
                    <div className="space-y-2">
                      {(newsByVideoId[selectedVideo.youtube_video_id] || []).slice(0, 4).map((article, idx) => (
                        <div
                          key={`${article.link}-${idx}`}
                          className="block rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-start gap-2">
                            <a
                              href={article.link}
                              target="_blank"
                              rel="noreferrer"
                              className="flex-1 min-w-0"
                            >
                              <p className="text-sm font-medium text-gray-800 line-clamp-2">{article.title}</p>
                              <p className="mt-1 text-xs text-gray-400">
                                {article.source}
                                {formatPublishedDate(article.publishedAt) ? ` · ${formatPublishedDate(article.publishedAt)}` : ''}
                              </p>
                            </a>
                            <button
                              onClick={() => toggleArticleFavorite(selectedVideo.youtube_video_id, article.link)}
                              className="p-1 rounded-md hover:bg-gray-100 transition-colors"
                              title="기사 좋아요"
                            >
                              <Heart
                                size={14}
                                className={isNewsFavorited(newsFavorites, selectedVideo.youtube_video_id, article.link)
                                  ? 'text-red-400 fill-red-400'
                                  : 'text-gray-300'}
                              />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 관련 종목 */}
                <div className="border border-gray-200 rounded-xl p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-700">관련 종목</h3>
                    <button
                      onClick={() => {
                        const cacheKey = `${selectedVideo.summary_text || ''}|${selectedVideo.title || ''}`
                        void loadRelatedNews(selectedVideo.youtube_video_id, cacheKey, 'stocks')
                      }}
                      className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                      종목 새로고침
                    </button>
                  </div>
                  {stocksLoadingVideoId === selectedVideo.youtube_video_id ? (
                    <p className="text-sm text-gray-400 animate-pulse">분석 중...</p>
                  ) : (stocksByVideoId[selectedVideo.youtube_video_id] || []).length === 0 ? (
                    <p className="text-sm text-gray-400">관련 종목을 찾지 못했습니다.</p>
                  ) : (
                    <div className="space-y-2">
                      {(stocksByVideoId[selectedVideo.youtube_video_id] || []).map((stock) => {
                        const isKorean = stock.market === 'KOSPI' || stock.market === 'KOSDAQ'
                        const href = isKorean
                          ? `https://finance.naver.com/item/main.naver?code=${stock.ticker}`
                          : `https://finance.yahoo.com/quote/${stock.ticker}`
                        const marketBadge =
                          stock.market === 'KOSPI' ? 'bg-blue-50 text-blue-600' :
                          stock.market === 'KOSDAQ' ? 'bg-green-50 text-green-600' :
                          stock.market === 'NASDAQ' ? 'bg-orange-50 text-orange-600' :
                          'bg-purple-50 text-purple-600'
                        return (
                          <a
                            key={stock.ticker}
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className={`flex items-center justify-between rounded-lg border px-3 py-2 transition-colors ${
                              stock.is_core
                                ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                                : 'border-gray-100 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              {stock.is_core && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-400 text-white">핵심</span>
                              )}
                              <span className="text-sm font-medium text-gray-800">{stock.name}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-400">{stock.ticker}</span>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${marketBadge}`}>
                                {stock.market}
                              </span>
                            </div>
                          </a>
                        )
                      })}
                    </div>
                  )}
                </div>

              </div>

            </div>
          ) : (
            <EmptyState
              title="영상을 선택하세요"
              description="좌측 목록에서 영상을 클릭하면 상세 정보가 표시됩니다."
            />
          )}
        </div>

        {/* ── 우측: 뉴스 채널 최신 제목 ───────────────────────────────── */}
        <aside
          className="border border-gray-200 rounded-2xl bg-white p-4 xl:sticky xl:top-24 overflow-y-auto"
          style={{ maxHeight: panelMaxHeight }}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-800">뉴스 채널 최신 제목</h3>
            <button
              onClick={() => void loadNewsChannelPanel(true)}
              disabled={newsPanelLoading}
              className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              새로고침
            </button>
          </div>

          {newsPanelLoading ? (
            <p className="mt-3 text-sm text-gray-400 animate-pulse">최신 제목을 불러오는 중...</p>
          ) : newsPanelError ? (
            <p className="mt-3 text-sm text-gray-400">{newsPanelError}</p>
          ) : domesticNewsItems.length === 0 && overseasNewsItems.length === 0 ? (
            <p className="mt-3 text-sm text-gray-400">표시할 뉴스 채널 영상이 없습니다.</p>
          ) : (
            <div className="mt-3 space-y-4">
              <div>
                <p className="mb-2 text-xs font-semibold text-gray-500">국내 최신 Top 10</p>
                <div className="space-y-2">
                  {domesticNewsItems.slice(0, 10).map((item, idx, arr) => (
                    <a
                      key={`dom-${item.youtubeVideoId}-${idx}`}
                      href={item.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg border border-gray-100 p-2.5 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none whitespace-nowrap ${newsTimeBadgeClass(idx, arr.length)}`}>
                          {formatRelativeTime(item.publishedAt)}
                        </span>
                        <p className="text-[13px] font-medium text-gray-800 line-clamp-1 flex-1 min-w-0">{item.title}</p>
                      </div>
                    </a>
                  ))}
                  {domesticNewsItems.length === 0 ? (
                    <p className="text-xs text-gray-400">국내 뉴스 채널이 없거나 최신 영상이 없습니다.</p>
                  ) : null}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold text-gray-500">해외 최신 Top 10</p>
                <div className="space-y-2">
                  {overseasNewsItems.slice(0, 10).map((item, idx, arr) => (
                    <a
                      key={`ovr-${item.youtubeVideoId}-${idx}`}
                      href={item.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg border border-gray-100 p-2.5 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none whitespace-nowrap ${newsTimeBadgeClass(idx, arr.length)}`}>
                          {formatRelativeTime(item.publishedAt)}
                        </span>
                        <p className="text-[13px] font-medium text-gray-800 line-clamp-1 flex-1 min-w-0">{item.title}</p>
                      </div>
                    </a>
                  ))}
                  {overseasNewsItems.length === 0 ? (
                    <p className="text-xs text-gray-400">해외 뉴스 채널이 없거나 최신 영상이 없습니다.</p>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </aside>

      </div>
    </AppShell>
  )
}
