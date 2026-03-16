'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Channel, Video } from '@/types'
import { RefreshStatus } from '@/lib/scheduler/refresh-state'
import { videoRepository, videoFavoriteRepository } from '@/lib/supabase/videos'
import { channelRepository } from '@/lib/supabase/channels'
import { MOCK_CHANNELS, MOCK_VIDEOS } from '@/lib/mock-data'
import { updateVideoFavoriteAction, getVideoNoteAction, updateVideoNoteAction } from '@/actions/note-actions'
import { refreshAllChannelsAction } from '@/actions/channel-actions'
import AppShell from '@/components/AppShell'
import EmptyState from '@/components/EmptyState'
import { LoadingGridSkeleton } from '@/components/LoadingSkeleton'
import { Heart, ExternalLink, RefreshCw, Newspaper } from 'lucide-react'
import { isValidStoredVideo } from '@/lib/utils/video-validity'

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

type TabKey = 'all' | 'uncategorized' | string

function marketBadgeClass(market: string) {
  if (market === 'KOSPI') return 'bg-blue-50 text-blue-600'
  if (market === 'KOSDAQ') return 'bg-green-50 text-green-600'
  if (market === 'NASDAQ') return 'bg-orange-50 text-orange-600'
  return 'bg-purple-50 text-purple-600'
}

function stockHref(stock: StockSuggestion) {
  return stock.market === 'KOSPI' || stock.market === 'KOSDAQ'
    ? `https://finance.naver.com/item/main.naver?code=${stock.ticker}`
    : `https://finance.yahoo.com/quote/${stock.ticker}`
}

function formatDate(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR')
}

export default function FavoritesPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [allVideos, setAllVideos] = useState<Video[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  const [selectedTicker, setSelectedTicker] = useState<TabKey>('all')
  const [showAllStockTabs, setShowAllStockTabs] = useState(false)
  const [stockSearchInput, setStockSearchInput] = useState('')
  const [notesByVideoId, setNotesByVideoId] = useState<Record<string, string>>({})
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [isNoteSaving, setIsNoteSaving] = useState(false)

  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>({
    lastRefreshed: null,
    nextRefresh: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    newVideoCount: 0,
  })
  const [newsByVideoId, setNewsByVideoId] = useState<Record<string, RelatedNewsItem[]>>({})
  const [stocksByVideoId, setStocksByVideoId] = useState<Record<string, StockSuggestion[]>>({})
  const [newsCacheKeyByVideoId, setNewsCacheKeyByVideoId] = useState<Record<string, string>>({})
  const [newsLoadingByVideoId, setNewsLoadingByVideoId] = useState<Record<string, boolean>>({})
  const [stocksLoadingByVideoId, setStocksLoadingByVideoId] = useState<Record<string, boolean>>({})

  const prevLastRefreshed = useRef<string | null>(null)
  const channelTitleById = useMemo(
    () => new Map(channels.map((channel) => [channel.youtube_channel_id, channel.title])),
    [channels]
  )

  useEffect(() => { loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/refresh-status')
        if (!res.ok) return
        const data: RefreshStatus = await res.json()
        if (data.lastRefreshed && data.lastRefreshed !== prevLastRefreshed.current) {
          if (prevLastRefreshed.current !== null) await loadAll()
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
      await loadAll()
      setRefreshStatus({
        lastRefreshed: new Date().toISOString(),
        nextRefresh: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        newVideoCount: result.newCount,
      })
    }
  }

  const loadAll = async () => {
    setIsLoading(true)
    try {
      const hasApiKey = !!process.env.NEXT_PUBLIC_YOUTUBE_API_KEY?.trim()
      if (hasApiKey) {
        const [channelsData, favoritesData] = await Promise.all([
          channelRepository.getAll(),
          videoFavoriteRepository.getAllFavorites(),
        ])
        const favoriteVideoIds = favoritesData.map(f => f.youtube_video_id)
        const videosData = await videoRepository.getByYouTubeIds(favoriteVideoIds)
        const validVideosData = videosData.filter(isValidStoredVideo)
        setChannels(channelsData)
        setAllVideos(validVideosData)
        setFavoriteIds(new Set(favoriteVideoIds))

        // Initialize news/stocks from DB cache
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
        // Notes are loaded lazily for selected video only.
        setNotesByVideoId({})
      } else {
        setChannels(MOCK_CHANNELS)
        setAllVideos(MOCK_VIDEOS)
        setFavoriteIds(new Set())
      }
    } catch (error) {
      console.error('Error loading data:', error)
      setChannels(MOCK_CHANNELS)
      setAllVideos(MOCK_VIDEOS)
      setFavoriteIds(new Set())
    } finally {
      setIsLoading(false)
    }
  }

  const loadRelatedNews = async (
    videoId: string,
    cacheKey: string,
    refreshTarget: 'news' | 'stocks' | null = null
  ) => {
    if (!refreshTarget && newsCacheKeyByVideoId[videoId] === cacheKey) return
    if (refreshTarget === 'stocks') {
      setStocksLoadingByVideoId(prev => ({ ...prev, [videoId]: true }))
    } else if (refreshTarget === 'news') {
      setNewsLoadingByVideoId(prev => ({ ...prev, [videoId]: true }))
    } else {
      setNewsLoadingByVideoId(prev => ({ ...prev, [videoId]: true }))
      setStocksLoadingByVideoId(prev => ({ ...prev, [videoId]: true }))
    }
    try {
      const url = refreshTarget
        ? `/api/videos/${videoId}/news?refresh=${refreshTarget}`
        : `/api/videos/${videoId}/news`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      if (refreshTarget !== 'stocks')
        setNewsByVideoId(prev => ({ ...prev, [videoId]: Array.isArray(data?.articles) ? data.articles : [] }))
      if (refreshTarget !== 'news')
        setStocksByVideoId(prev => ({ ...prev, [videoId]: Array.isArray(data?.stocks) ? data.stocks : [] }))
      setNewsCacheKeyByVideoId(prev => ({ ...prev, [videoId]: cacheKey }))
    } catch (error) {
      console.error(error)
    } finally {
      setNewsLoadingByVideoId(prev => ({ ...prev, [videoId]: false }))
      setStocksLoadingByVideoId(prev => ({ ...prev, [videoId]: false }))
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

  const getChannelDisplayName = (video: Video) =>
    video.channel_title || channelTitleById.get(video.youtube_channel_id) || '채널 정보 없음'

  const handleSaveNote = async () => {
    if (!selectedVideoId) return
    setIsNoteSaving(true)
    try {
      await updateVideoNoteAction(selectedVideoId, editingNoteText)
      setNotesByVideoId(prev => ({ ...prev, [selectedVideoId]: editingNoteText }))
    } finally {
      setIsNoteSaving(false)
    }
  }

  const favoriteVideos = useMemo(() =>
    allVideos
      .filter(v => favoriteIds.has(v.youtube_video_id))
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()),
    [allVideos, favoriteIds]
  )

  useEffect(() => {
    if (favoriteVideos.length === 0) {
      setSelectedVideoId(null)
      setEditingNoteText('')
      return
    }
    if (selectedVideoId && !favoriteVideos.some(v => v.youtube_video_id === selectedVideoId)) {
      setSelectedVideoId(favoriteVideos[0].youtube_video_id)
    }
  }, [favoriteVideos, selectedVideoId])

  useEffect(() => {
    if (!selectedVideoId) {
      setEditingNoteText('')
      return
    }

    const cached = notesByVideoId[selectedVideoId]
    if (cached !== undefined) {
      setEditingNoteText(cached)
      return
    }

    setEditingNoteText('')
    let cancelled = false
    ;(async () => {
      const note = await getVideoNoteAction(selectedVideoId)
      if (cancelled) return
      const resolved = note || ''
      setNotesByVideoId(prev => {
        if (prev[selectedVideoId] !== undefined) return prev
        return { ...prev, [selectedVideoId]: resolved }
      })
      setEditingNoteText(resolved)
    })()

    return () => {
      cancelled = true
    }
  }, [selectedVideoId, notesByVideoId])

  // Build stock → videos map (many-to-many: one video can appear under multiple stocks)
  const stockVideoMap = useMemo(() => {
    const map = new Map<string, { stock: StockSuggestion; videos: Video[] }>()
    for (const video of favoriteVideos) {
      for (const stock of (stocksByVideoId[video.youtube_video_id] || [])) {
        if (!map.has(stock.ticker)) map.set(stock.ticker, { stock, videos: [] })
        map.get(stock.ticker)!.videos.push(video)
      }
    }
    return map
  }, [favoriteVideos, stocksByVideoId])

  const ungroupedVideos = useMemo(() =>
    favoriteVideos.filter(v => (stocksByVideoId[v.youtube_video_id] || []).length === 0),
    [favoriteVideos, stocksByVideoId]
  )

  const sortedTickers = useMemo(() =>
    [...stockVideoMap.entries()]
      .sort((a, b) => b[1].videos.length - a[1].videos.length)
      .map(([ticker]) => ticker),
    [stockVideoMap]
  )

  const selectedVideo = useMemo(
    () => favoriteVideos.find(v => v.youtube_video_id === selectedVideoId) || null,
    [favoriteVideos, selectedVideoId]
  )
  const featuredTickers = useMemo(() => sortedTickers.slice(0, 8), [sortedTickers])
  const hiddenTickers = useMemo(() => sortedTickers.slice(8), [sortedTickers])
  const selectedTickerIsHidden =
    typeof selectedTicker === 'string' &&
    selectedTicker !== 'all' &&
    selectedTicker !== 'uncategorized' &&
    hiddenTickers.includes(selectedTicker)

  useEffect(() => {
    if (selectedTicker === 'all' || selectedTicker === 'uncategorized') {
      setStockSearchInput('')
      return
    }
    const entry = stockVideoMap.get(selectedTicker)
    if (!entry) return
    setStockSearchInput(`${entry.stock.name} (${selectedTicker})`)
  }, [selectedTicker, stockVideoMap])

  const shellProps = {
    channels,
    onChannelAdded: loadAll,
    nextRefresh: refreshStatus.nextRefresh,
    newVideoCount: refreshStatus.newVideoCount,
    onManualRefresh: handleManualRefresh,
  }

  if (isLoading) {
    return <AppShell {...shellProps}><LoadingGridSkeleton count={6} /></AppShell>
  }

  const renderVideoCard = (video: Video) => {
    const stocks = stocksByVideoId[video.youtube_video_id] || []
    const articles = newsByVideoId[video.youtube_video_id] || []
    const isNewsLoading = newsLoadingByVideoId[video.youtube_video_id]
    const isStocksLoading = stocksLoadingByVideoId[video.youtube_video_id]
    const isFav = favoriteIds.has(video.youtube_video_id)
    const isSelected = selectedVideoId === video.youtube_video_id
    const newsCacheKey = `${video.summary_text || ''}|${video.title || ''}`

    return (
      <div
        key={video.youtube_video_id}
        role="button"
        tabIndex={0}
        onClick={() =>
          setSelectedVideoId((prev) =>
            prev === video.youtube_video_id ? null : video.youtube_video_id
          )
        }
        onKeyDown={(e) =>
          e.key === 'Enter' &&
          setSelectedVideoId((prev) =>
            prev === video.youtube_video_id ? null : video.youtube_video_id
          )
        }
        className={`border rounded-2xl bg-white p-4 space-y-3 transition-colors ${
          isSelected ? 'border-amber-300 bg-amber-50/30' : 'border-gray-200'
        }`}
      >

        {/* Thumb + title + meta */}
        <div className="flex gap-3">
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-28 h-16 object-cover rounded-lg flex-shrink-0 border border-gray-100"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="flex-1 text-sm font-semibold text-gray-900 line-clamp-2 leading-snug">
                {video.title}
              </h3>
              <button
                onClick={() => toggleFavorite(video.youtube_video_id)}
                disabled={togglingIds.has(video.youtube_video_id)}
                className="flex-shrink-0 p-1 rounded hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                <Heart size={14} className={isFav ? 'text-red-400 fill-red-400' : 'text-gray-300'} />
              </button>
            </div>
            <p className="mt-0.5 text-xs text-gray-400">
              {getChannelDisplayName(video)} · {formatDate(video.published_at)}
            </p>
            {stocks.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {stocks.map(s => (
                  <a
                    key={s.ticker}
                    href={stockHref(s)}
                    target="_blank"
                    rel="noreferrer"
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded hover:opacity-75 transition-opacity ${
                      s.is_core
                        ? 'bg-amber-100 text-amber-700 border border-amber-300'
                        : marketBadgeClass(s.market)
                    }`}
                  >
                    {s.is_core ? `★ ${s.name}` : s.name}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Summary */}
        {video.summary_status === 'complete' && video.summary_text && (
          <p className="text-xs text-gray-600 line-clamp-3 leading-relaxed">
            {video.summary_text}
          </p>
        )}

        {/* Related articles (2 compact) */}
        {isNewsLoading ? (
          <p className="text-xs text-gray-400 animate-pulse">뉴스 로딩 중...</p>
        ) : articles.length > 0 ? (
          <div className="space-y-1">
            {articles.slice(0, 2).map((a, i) => (
              <a
                key={`${a.link}-${i}`}
                href={a.link}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-1.5 group"
              >
                <Newspaper size={11} className="mt-0.5 text-gray-300 flex-shrink-0" />
                <span className="text-xs text-gray-500 group-hover:text-gray-800 line-clamp-1 transition-colors">
                  {a.title}
                </span>
              </a>
            ))}
          </div>
        ) : null}

        {/* Action row */}
        <div className="flex items-center gap-3 pt-1 border-t border-gray-50">
          <a
            href={`https://youtube.com/watch?v=${video.youtube_video_id}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            <ExternalLink size={11} />
            유튜브
          </a>
          {articles.length === 0 && !isNewsLoading ? (
            <button
              onClick={() => void loadRelatedNews(video.youtube_video_id, newsCacheKey)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              <Newspaper size={11} />
              뉴스 불러오기
            </button>
          ) : (
            <button
              onClick={() => void loadRelatedNews(video.youtube_video_id, newsCacheKey, 'news')}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              <RefreshCw size={11} />
              뉴스 새로고침
            </button>
          )}
          <button
            onClick={() => void loadRelatedNews(video.youtube_video_id, newsCacheKey, 'stocks')}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            <RefreshCw size={11} />
            {isStocksLoading ? '종목 로딩 중...' : '종목 새로고침'}
          </button>
          <span className="ml-auto text-[11px] text-amber-600 font-medium">
            {isSelected ? '선택됨' : '클릭해서 메모'}
          </span>
        </div>

        {isSelected && (
          <div
            className="xl:hidden mt-2 border-t border-gray-200 pt-3 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rounded-xl border border-gray-200 overflow-hidden bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${video.youtube_video_id}`}
                className="w-full aspect-video"
                allowFullScreen
              />
            </div>
            <a
              href={`https://youtube.com/watch?v=${video.youtube_video_id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
            >
              <ExternalLink size={12} />
              유튜브에서 열기
            </a>
            <textarea
              value={editingNoteText}
              onChange={(e) => setEditingNoteText(e.target.value)}
              placeholder="선택한 영상의 메모를 작성하세요..."
              className="w-full min-h-[160px] resize-none rounded-xl border border-gray-200 p-3 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300 leading-relaxed"
            />
            <button
              onClick={handleSaveNote}
              disabled={isNoteSaving}
              className="w-full py-2 text-sm font-medium rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isNoteSaving ? '저장 중...' : '메모 저장'}
            </button>
          </div>
        )}
      </div>
    )
  }

  const renderStockGroup = (ticker: string, stock: StockSuggestion, videos: Video[]) => (
    <div key={ticker} className="space-y-3">
      <div className="flex items-center gap-2">
        <a
          href={stockHref(stock)}
          target="_blank"
          rel="noreferrer"
          className="font-bold text-gray-900 hover:underline"
        >
          {stock.name}
        </a>
        <span className="text-sm text-gray-400">{ticker}</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${marketBadgeClass(stock.market)}`}>
          {stock.market}
        </span>
        <span className="text-xs text-gray-400 ml-auto">· {videos.length}개 영상</span>
      </div>
      <div className="space-y-3">
        {videos.map(v => renderVideoCard(v))}
      </div>
    </div>
  )

  // Determine what to show based on selected tab
  const groupsToShow = selectedTicker === 'all'
    ? sortedTickers
    : selectedTicker === 'uncategorized'
    ? []
    : sortedTickers.filter(t => t === selectedTicker)

  const showUngrouped = selectedTicker === 'all' || selectedTicker === 'uncategorized'

  return (
    <AppShell {...shellProps}>

      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <Heart size={18} className="text-red-400 fill-red-400" />
        <h1 className="text-base font-semibold text-gray-800">나의 리서치</h1>
        <span className="text-sm text-gray-400">({favoriteVideos.length}개 영상)</span>
      </div>

      {favoriteVideos.length === 0 ? (
        <EmptyState
          title="즐겨찾기한 영상이 없습니다"
          description="대시보드에서 영상 옆 ♡ 버튼을 눌러 즐겨찾기에 추가하세요."
        />
      ) : (
        <div className="space-y-6">

          {/* Compact tab bar */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedTicker('all')}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selectedTicker === 'all'
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                전체 {favoriteVideos.length}
              </button>
              {ungroupedVideos.length > 0 && (
                <button
                  onClick={() => setSelectedTicker('uncategorized')}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selectedTicker === 'uncategorized'
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  미분류 {ungroupedVideos.length}
                </button>
              )}
              <div className="ml-auto">
                <input
                  list="favorite-stock-options"
                  value={stockSearchInput}
                  onChange={(e) => {
                    const value = e.target.value
                    setStockSearchInput(value)
                    const normalized = value.toLowerCase().trim()
                    if (!normalized) return
                    for (const ticker of sortedTickers) {
                      const entry = stockVideoMap.get(ticker)
                      if (!entry) continue
                      const optionLabel = `${entry.stock.name} (${ticker})`
                      if (
                        optionLabel.toLowerCase() === normalized ||
                        ticker.toLowerCase() === normalized ||
                        entry.stock.name.toLowerCase() === normalized
                      ) {
                        setSelectedTicker(ticker)
                        return
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    const normalized = stockSearchInput.toLowerCase().trim()
                    if (!normalized) return
                    const match = sortedTickers.find((ticker) => {
                      const entry = stockVideoMap.get(ticker)
                      if (!entry) return false
                      const optionLabel = `${entry.stock.name} (${ticker})`.toLowerCase()
                      return (
                        optionLabel.includes(normalized) ||
                        ticker.toLowerCase().includes(normalized) ||
                        entry.stock.name.toLowerCase().includes(normalized)
                      )
                    })
                    if (match) setSelectedTicker(match)
                  }}
                  placeholder="종목 검색"
                  className="h-9 w-48 rounded-lg border border-gray-200 px-2.5 text-sm text-gray-600 bg-white"
                />
                <datalist id="favorite-stock-options">
                  {sortedTickers.map((ticker) => {
                    const entry = stockVideoMap.get(ticker)!
                    return (
                      <option key={ticker} value={`${entry.stock.name} (${ticker})`}>
                        {entry.stock.name} ({entry.videos.length})
                      </option>
                    )
                  })}
                </datalist>
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {featuredTickers.map((ticker) => {
                const entry = stockVideoMap.get(ticker)!
                return (
                  <button
                    key={ticker}
                    onClick={() => setSelectedTicker(ticker)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      selectedTicker === ticker
                        ? 'bg-gray-800 text-white'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {entry.stock.name} {entry.videos.length}
                  </button>
                )
              })}
              {selectedTickerIsHidden && (
                <button
                  onClick={() => setShowAllStockTabs(true)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium bg-gray-800 text-white"
                >
                  {stockVideoMap.get(selectedTicker as string)?.stock.name || selectedTicker}
                </button>
              )}
              {hiddenTickers.length > 0 && (
                <button
                  onClick={() => setShowAllStockTabs((prev) => !prev)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
                >
                  {showAllStockTabs ? '접기' : `종목 더보기 ${hiddenTickers.length}`}
                </button>
              )}
            </div>

            {showAllStockTabs && hiddenTickers.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-2 flex flex-wrap gap-1.5">
                {hiddenTickers.map((ticker) => {
                  const entry = stockVideoMap.get(ticker)!
                  return (
                    <button
                      key={ticker}
                      onClick={() => setSelectedTicker(ticker)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        selectedTicker === ticker
                          ? 'bg-gray-800 text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {entry.stock.name} {entry.videos.length}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,760px)_320px] gap-5 items-start">
            <div className="space-y-8 xl:max-w-[760px]">
              {groupsToShow.map(ticker => {
                const entry = stockVideoMap.get(ticker)!
                return renderStockGroup(ticker, entry.stock, entry.videos)
              })}
              {showUngrouped && ungroupedVideos.length > 0 && (
                <div className="space-y-3">
                  {selectedTicker === 'all' && sortedTickers.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-400">미분류</span>
                      <span className="text-xs text-gray-400 ml-auto">· {ungroupedVideos.length}개 영상</span>
                    </div>
                  )}
                  <div className="space-y-3">
                    {ungroupedVideos.map(v => renderVideoCard(v))}
                  </div>
                </div>
              )}
            </div>

            <aside className="hidden xl:block border border-gray-200 rounded-2xl bg-white p-4 xl:sticky xl:top-24">
              <h2 className="text-sm font-semibold text-gray-800">영상 보기 · 메모</h2>
              {selectedVideo ? (
                <div className="mt-3 space-y-3">
                  <div className="rounded-xl border border-gray-100 p-3">
                    <p className="text-xs text-gray-400">{getChannelDisplayName(selectedVideo)}</p>
                    <p className="mt-1 text-sm font-medium text-gray-800 line-clamp-2">{selectedVideo.title}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 overflow-hidden bg-black">
                    <iframe
                      src={`https://www.youtube.com/embed/${selectedVideo.youtube_video_id}`}
                      className="w-full aspect-video"
                      allowFullScreen
                    />
                  </div>
                  <a
                    href={`https://youtube.com/watch?v=${selectedVideo.youtube_video_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
                  >
                    <ExternalLink size={12} />
                    유튜브에서 열기
                  </a>
                  <textarea
                    value={editingNoteText}
                    onChange={(e) => setEditingNoteText(e.target.value)}
                    placeholder="선택한 영상의 메모를 작성하세요..."
                    className="w-full min-h-[220px] resize-none rounded-xl border border-gray-200 p-3 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300 leading-relaxed"
                  />
                  <button
                    onClick={handleSaveNote}
                    disabled={isNoteSaving}
                    className="w-full py-2 text-sm font-medium rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isNoteSaving ? '저장 중...' : '메모 저장'}
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-400">리스트에서 영상을 선택하면 메모 폼이 열립니다.</p>
              )}
            </aside>
          </div>

        </div>
      )}
    </AppShell>
  )
}
