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

type TabKey = 'all' | string
type SidebarChannelGroup = 'news' | 'finance' | 'real_estate' | 'tech' | 'lifestyle' | 'etc'

function formatDate(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR')
}

export default function FavoritesPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [allVideos, setAllVideos] = useState<Video[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [favoriteRankById, setFavoriteRankById] = useState<Record<string, number>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  const [selectedChannelTab, setSelectedChannelTab] = useState<TabKey>('all')
  const [showAllChannelTabs, setShowAllChannelTabs] = useState(false)
  const [channelSearchInput, setChannelSearchInput] = useState('')
  const [isChannelTabOverflow, setIsChannelTabOverflow] = useState(false)
  const [notesByVideoId, setNotesByVideoId] = useState<Record<string, string>>({})
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [isNoteEditMode, setIsNoteEditMode] = useState(false)
  const [isNoteSaving, setIsNoteSaving] = useState(false)

  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>({
    lastRefreshed: null,
    nextRefresh: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    newVideoCount: 0,
  })
  const [newsByVideoId, setNewsByVideoId] = useState<Record<string, RelatedNewsItem[]>>({})
  const [newsCacheKeyByVideoId, setNewsCacheKeyByVideoId] = useState<Record<string, string>>({})
  const [newsLoadingByVideoId, setNewsLoadingByVideoId] = useState<Record<string, boolean>>({})

  const prevLastRefreshed = useRef<string | null>(null)
  const channelTabWrapRef = useRef<HTMLDivElement | null>(null)
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
        setRefreshStatus((prev) => ({
          ...prev,
          ...data,
          nextRefresh: data.nextRefresh ?? prev.nextRefresh,
        }))
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
        const rankMap: Record<string, number> = {}
        const sortedByUpdatedAt = [...favoritesData].sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
        sortedByUpdatedAt.forEach((favorite, idx) => {
          rankMap[favorite.youtube_video_id] = idx
        })
        const videosData = await videoRepository.getByYouTubeIds(favoriteVideoIds)
        const validVideosData = videosData.filter(isValidStoredVideo)
        setChannels(channelsData)
        setAllVideos(validVideosData)
        setFavoriteIds(new Set(favoriteVideoIds))
        setFavoriteRankById(rankMap)

        // Initialize news/stocks from DB cache
        const newsInit: Record<string, RelatedNewsItem[]> = {}
        const cacheKeyInit: Record<string, string> = {}
        for (const v of validVideosData) {
          if (Array.isArray(v.related_news) && v.related_news.length > 0) {
            newsInit[v.youtube_video_id] = v.related_news as RelatedNewsItem[]
            cacheKeyInit[v.youtube_video_id] = `${v.summary_text || ''}|${v.title || ''}`
          }
        }
        setNewsByVideoId(newsInit)
        setNewsCacheKeyByVideoId(cacheKeyInit)
        // Notes are loaded lazily for selected video only.
        setNotesByVideoId({})
      } else {
        setChannels(MOCK_CHANNELS)
        setAllVideos(MOCK_VIDEOS)
        setFavoriteIds(new Set())
        setFavoriteRankById({})
      }
    } catch (error) {
      console.error('Error loading data:', error)
      setChannels(MOCK_CHANNELS)
      setAllVideos(MOCK_VIDEOS)
      setFavoriteIds(new Set())
      setFavoriteRankById({})
    } finally {
      setIsLoading(false)
    }
  }

  const loadRelatedNews = async (
    videoId: string,
    cacheKey: string,
    refreshTarget: 'news' | null = null
  ) => {
    if (!refreshTarget && newsCacheKeyByVideoId[videoId] === cacheKey) return
    if (refreshTarget === 'news') {
      setNewsLoadingByVideoId(prev => ({ ...prev, [videoId]: true }))
    } else {
      setNewsLoadingByVideoId(prev => ({ ...prev, [videoId]: true }))
    }
    try {
      const url = refreshTarget
        ? `/api/videos/${videoId}/news?refresh=${refreshTarget}`
        : `/api/videos/${videoId}/news`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setNewsByVideoId(prev => ({ ...prev, [videoId]: Array.isArray(data?.articles) ? data.articles : [] }))
      setNewsCacheKeyByVideoId(prev => ({ ...prev, [videoId]: cacheKey }))
    } catch (error) {
      console.error(error)
    } finally {
      setNewsLoadingByVideoId(prev => ({ ...prev, [videoId]: false }))
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
    setFavoriteRankById(prev => {
      const next = { ...prev }
      if (isCurrentlyFav) {
        delete next[videoId]
      } else {
        next[videoId] = -Date.now()
      }
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
      setFavoriteRankById(prev => {
        const next = { ...prev }
        if (isCurrentlyFav) {
          next[videoId] = -Date.now()
        } else {
          delete next[videoId]
        }
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
      .sort((a, b) => {
        const aRank = favoriteRankById[a.youtube_video_id]
        const bRank = favoriteRankById[b.youtube_video_id]
        if (aRank !== undefined && bRank !== undefined) return aRank - bRank
        if (aRank !== undefined) return -1
        if (bRank !== undefined) return 1
        return new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
      }),
    [allVideos, favoriteIds, favoriteRankById]
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
      setIsNoteEditMode(false)
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
      setIsNoteEditMode(false)
    })()

    return () => {
      cancelled = true
    }
  }, [selectedVideoId, notesByVideoId])

  const channelVideoMap = useMemo(() => {
    const map = new Map<string, { channelTitle: string; videos: Video[] }>()
    for (const video of favoriteVideos) {
      const channelId = video.youtube_channel_id || 'unknown'
      if (!map.has(channelId)) {
        map.set(channelId, {
          channelTitle: getChannelDisplayName(video),
          videos: [],
        })
      }
      map.get(channelId)!.videos.push(video)
    }
    return map
  }, [favoriteVideos, channelTitleById])

  const sortedChannelIds = useMemo(() => {
    const ids = [...channelVideoMap.keys()]
    const idxMap = new Map(channels.map((channel, idx) => [channel.youtube_channel_id, idx] as const))
    return ids.sort((a, b) => {
      const aIdx = idxMap.get(a)
      const bIdx = idxMap.get(b)
      if (aIdx == null && bIdx == null) {
        return (channelVideoMap.get(b)?.videos.length || 0) - (channelVideoMap.get(a)?.videos.length || 0)
      }
      if (aIdx == null) return 1
      if (bIdx == null) return -1
      return aIdx - bIdx
    })
  }, [channelVideoMap, channels])

  const selectedVideo = useMemo(
    () => favoriteVideos.find(v => v.youtube_video_id === selectedVideoId) || null,
    [favoriteVideos, selectedVideoId]
  )


  useEffect(() => {
    if (selectedChannelTab === 'all') {
      setChannelSearchInput('')
      return
    }
    const entry = channelVideoMap.get(selectedChannelTab)
    if (!entry) return
    setChannelSearchInput(entry.channelTitle)
  }, [selectedChannelTab, channelVideoMap])

  useEffect(() => {
    const el = channelTabWrapRef.current
    if (!el) return
    const checkOverflow = () => {
      // collapsed max height equals about two lines of pills
      setIsChannelTabOverflow(el.scrollHeight > 84)
    }
    checkOverflow()
    const id = setTimeout(checkOverflow, 0)
    window.addEventListener('resize', checkOverflow)
    return () => {
      clearTimeout(id)
      window.removeEventListener('resize', checkOverflow)
    }
  }, [sortedChannelIds, showAllChannelTabs, selectedChannelTab])

  const handleChannelGroupChanged = async (channelId: string, group: SidebarChannelGroup) => {
    const prevChannels = channels
    setChannels((prev) =>
      prev.map((channel) =>
        channel.youtube_channel_id === channelId ? { ...channel, channel_group: group } : channel
      )
    )
    const result = await channelRepository.updateChannelGroup(channelId, group)
    if (!result.success) {
      console.error('채널 분류 변경 실패:', result.message || 'unknown_error')
      setChannels(prevChannels)
    }
  }

  const shellProps = {
    channels,
    onChannelAdded: loadAll,
    onChannelGroupChanged: handleChannelGroupChanged,
    newVideoCount: refreshStatus.newVideoCount,
    onManualRefresh: handleManualRefresh,
  }

  if (isLoading) {
    return <AppShell {...shellProps}><LoadingGridSkeleton count={6} /></AppShell>
  }

  const renderVideoCard = (video: Video) => {
    const articles = newsByVideoId[video.youtube_video_id] || []
    const isNewsLoading = newsLoadingByVideoId[video.youtube_video_id]
    const isFav = favoriteIds.has(video.youtube_video_id)
    const isSelected = selectedVideoId === video.youtube_video_id
    const hasNote = (notesByVideoId[video.youtube_video_id] || '').trim().length > 0
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
        className={`border rounded-2xl bg-white shadow-[0_2px_8px_rgba(15,23,42,0.05)] p-3.5 space-y-3 transition-colors ${
          isSelected ? 'border-amber-300 bg-amber-50/35' : 'border-slate-200'
        }`}
      >

        {/* Thumb + title + meta */}
        <div className="flex gap-2.5">
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-24 h-14 object-cover rounded-md flex-shrink-0 border border-slate-200"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="flex-1 ui-title-md text-gray-900 line-clamp-2 leading-snug">
                {video.title}
              </h3>
              <button
                onClick={() => toggleFavorite(video.youtube_video_id)}
                disabled={togglingIds.has(video.youtube_video_id)}
                className="flex-shrink-0 p-1 rounded hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                <Heart size={14} className={isFav ? 'text-red-400 fill-red-400' : 'text-gray-300'} />
              </button>
            </div>
            <p className={`mt-0.5 text-xs ${isSelected ? 'text-slate-700' : 'text-gray-500'}`}>
              {getChannelDisplayName(video)} · {formatDate(video.published_at)}
            </p>
          </div>
        </div>

        {/* Summary */}
        {video.summary_status === 'complete' && video.summary_text && (
          <p className="ui-text-meta text-gray-700 line-clamp-3 leading-relaxed">
            {video.summary_text}
          </p>
        )}

        {/* Related articles (2 compact) */}
        {isNewsLoading ? (
          <p className="ui-text-meta text-gray-500 animate-pulse">뉴스 로딩 중...</p>
        ) : articles.length > 0 ? (
          <div className="space-y-1">
            {articles.slice(0, 2).map((a, i) => (
              <div
                key={`${a.link}-${i}`}
                className="flex items-start justify-between gap-1.5 rounded-md px-1.5 py-1 hover:bg-slate-50"
              >
                <div className="flex items-start gap-1.5 min-w-0 flex-1">
                  <Newspaper size={11} className="mt-0.5 text-gray-300 flex-shrink-0" />
                  <span className="ui-text-meta text-gray-600 line-clamp-1">
                    {a.title}
                  </span>
                </div>
                <a
                  href={a.link}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="p-1 rounded-md text-gray-400 hover:bg-slate-100 hover:text-gray-700 transition-colors"
                  title="기사 열기"
                  aria-label="기사 열기"
                >
                  <ExternalLink size={12} />
                </a>
              </div>
            ))}
          </div>
        ) : null}

        {/* Action row */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200">
          <a
            href={`https://youtube.com/watch?v=${video.youtube_video_id}`}
            target="_blank"
            rel="noreferrer"
            className="ui-btn ui-btn-sm"
          >
            <ExternalLink size={11} />
            유튜브
          </a>
          {articles.length === 0 && !isNewsLoading ? (
            <button
              onClick={() => void loadRelatedNews(video.youtube_video_id, newsCacheKey)}
              className="ui-btn-ghost-icon"
              title="관련 뉴스 새로고침"
              aria-label="관련 뉴스 새로고침"
            >
              <RefreshCw size={13} />
            </button>
          ) : (
            <button
              onClick={() => void loadRelatedNews(video.youtube_video_id, newsCacheKey, 'news')}
              className="ui-btn-ghost-icon"
              title="관련 뉴스 새로고침"
              aria-label="관련 뉴스 새로고침"
            >
              <RefreshCw size={13} />
            </button>
          )}
          <span className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            isSelected
              ? (isNoteEditMode ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')
              : (hasNote ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600')
          }`}>
            {isSelected
              ? (isNoteEditMode ? '메모 수정' : '메모 보기')
              : (hasNote ? '메모 보기' : '메모 수정')}
          </span>
        </div>

      </div>
    )
  }

  const renderChannelGroup = (channelId: string, channelTitle: string, videos: Video[]) => (
    <div key={channelId} className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-bold text-gray-900">{channelTitle}</span>
        <span className="text-xs text-gray-400 ml-auto">· {videos.length}개 영상</span>
      </div>
      <div className="space-y-3">
        {videos.map(v => renderVideoCard(v))}
      </div>
    </div>
  )

  // Determine what to show based on selected tab
  const groupsToShow = selectedChannelTab === 'all'
    ? sortedChannelIds
    : sortedChannelIds.filter(channelId => channelId === selectedChannelTab)

  return (
    <AppShell {...shellProps}>

      {/* Header */}
      <div className="mb-4 flex items-center gap-2 xl:text-slate-900">
        <Heart size={18} className="text-red-400 fill-red-400" />
        <h1 className="text-lg font-semibold text-gray-900">나의 Pick</h1>
        <span className="text-sm text-gray-500">({favoriteVideos.length}개 영상)</span>
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
              <div
                ref={channelTabWrapRef}
                className={`flex-1 flex flex-wrap items-center gap-1.5 overflow-hidden ${
                  showAllChannelTabs ? '' : 'max-h-[84px]'
                }`}
              >
                <button
                  onClick={() => setSelectedChannelTab('all')}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selectedChannelTab === 'all'
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  전체 {favoriteVideos.length}
                </button>
                {sortedChannelIds.map((channelId) => {
                  const entry = channelVideoMap.get(channelId)!
                  return (
                    <button
                      key={channelId}
                      onClick={() => setSelectedChannelTab(channelId)}
                      className={`flex-shrink-0 max-w-[220px] px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        selectedChannelTab === channelId
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                      title={entry.channelTitle}
                    >
                      <span className="line-clamp-2 break-words leading-snug">{entry.channelTitle}</span>
                    </button>
                  )
                })}
              </div>
              {isChannelTabOverflow ? (
                <button
                  onClick={() => setShowAllChannelTabs((prev) => !prev)}
                  className="ui-btn flex-shrink-0 rounded-full"
                >
                  {showAllChannelTabs ? '접기' : '더보기'}
                </button>
              ) : null}
              <div className="ml-auto xl:hidden">
                <input
                  list="favorite-channel-options"
                  value={channelSearchInput}
                  onChange={(e) => {
                    const value = e.target.value
                    setChannelSearchInput(value)
                    const normalized = value.toLowerCase().trim()
                    if (!normalized) return
                    for (const channelId of sortedChannelIds) {
                      const entry = channelVideoMap.get(channelId)
                      if (!entry) continue
                      const optionLabel = entry.channelTitle
                      if (
                        optionLabel.toLowerCase() === normalized ||
                        channelId.toLowerCase() === normalized
                      ) {
                        setSelectedChannelTab(channelId)
                        return
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    const normalized = channelSearchInput.toLowerCase().trim()
                    if (!normalized) return
                    const match = sortedChannelIds.find((channelId) => {
                      const entry = channelVideoMap.get(channelId)
                      if (!entry) return false
                      const optionLabel = entry.channelTitle.toLowerCase()
                      return (
                        optionLabel.includes(normalized) ||
                        channelId.toLowerCase().includes(normalized)
                      )
                    })
                    if (match) setSelectedChannelTab(match)
                  }}
                  placeholder="채널 검색"
                  className="h-9 w-52 rounded-lg border border-slate-300 px-2.5 ui-text-body text-slate-700 bg-slate-50"
                />
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,760px)_320px] gap-5 items-start">
            <div className="space-y-8 xl:max-w-[760px]">
              {groupsToShow.map(channelId => {
                const entry = channelVideoMap.get(channelId)!
                return renderChannelGroup(channelId, entry.channelTitle, entry.videos)
              })}
              <div className="xl:hidden border border-slate-200 rounded-2xl bg-white shadow-[0_2px_8px_rgba(15,23,42,0.05)] p-4">
                <h2 className="ui-title-sm text-gray-900">영상 보기 · 메모</h2>
                {selectedVideo ? (
                  <div className="mt-3 space-y-3">
                    <div className="px-1">
                      <p className="text-xs text-gray-400">{getChannelDisplayName(selectedVideo)}</p>
                      <p className="mt-1 ui-title-md text-gray-800 line-clamp-2">{selectedVideo.title}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 overflow-hidden bg-black">
                      <iframe
                        src={`https://www.youtube.com/embed/${selectedVideo.youtube_video_id}`}
                        className="w-full aspect-video"
                        allowFullScreen
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="inline-flex items-center rounded-lg bg-slate-100 p-1">
                          <button
                            type="button"
                            onClick={() => setIsNoteEditMode(false)}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                              !isNoteEditMode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                            }`}
                          >
                            메모 보기
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsNoteEditMode(true)}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                              isNoteEditMode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                            }`}
                          >
                            메모 수정
                          </button>
                        </div>
                        {isNoteEditMode ? (
                          <button
                            onClick={handleSaveNote}
                            disabled={isNoteSaving}
                            className="tone-primary-btn ui-btn ui-btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {isNoteSaving ? '저장 중...' : '저장'}
                          </button>
                        ) : null}
                      </div>
                      {!isNoteEditMode ? (
                        <div className="w-full h-40 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                          {editingNoteText?.trim() ? editingNoteText : '등록된 메모가 없습니다.'}
                        </div>
                      ) : (
                        <textarea
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value)}
                          placeholder="선택한 영상의 메모를 작성하세요..."
                          className="w-full h-40 resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 leading-relaxed"
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-gray-400">리스트에서 영상을 선택하면 메모 보기를 확인할 수 있습니다.</p>
                )}
              </div>
            </div>

            <aside className="hidden xl:block xl:sticky xl:top-24 space-y-3">
              <div className="border border-slate-200 rounded-2xl bg-white shadow-[0_2px_8px_rgba(15,23,42,0.05)] p-4">
                <input
                  list="favorite-channel-options"
                  value={channelSearchInput}
                  onChange={(e) => {
                    const value = e.target.value
                    setChannelSearchInput(value)
                    const normalized = value.toLowerCase().trim()
                    if (!normalized) return
                    for (const channelId of sortedChannelIds) {
                      const entry = channelVideoMap.get(channelId)
                      if (!entry) continue
                      const optionLabel = entry.channelTitle
                      if (
                        optionLabel.toLowerCase() === normalized ||
                        channelId.toLowerCase() === normalized
                      ) {
                        setSelectedChannelTab(channelId)
                        return
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    const normalized = channelSearchInput.toLowerCase().trim()
                    if (!normalized) return
                    const match = sortedChannelIds.find((channelId) => {
                      const entry = channelVideoMap.get(channelId)
                      if (!entry) return false
                      const optionLabel = entry.channelTitle.toLowerCase()
                      return (
                        optionLabel.includes(normalized) ||
                        channelId.toLowerCase().includes(normalized)
                      )
                    })
                    if (match) setSelectedChannelTab(match)
                  }}
                  placeholder="채널 검색"
                  className="h-9 w-full rounded-lg border border-slate-300 px-2.5 ui-text-body text-slate-700 bg-slate-50"
                />
              </div>
              <div className="border border-slate-200 rounded-2xl bg-white shadow-[0_2px_8px_rgba(15,23,42,0.05)] p-4">
              <h2 className="ui-title-sm text-gray-900">영상 보기 · 메모</h2>
              {selectedVideo ? (
                <div className="mt-3 space-y-3">
                  <div className="px-1">
                    <p className="text-xs text-gray-400">{getChannelDisplayName(selectedVideo)}</p>
                    <p className="mt-1 ui-title-md text-gray-800 line-clamp-2">{selectedVideo.title}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 overflow-hidden bg-black">
                    <iframe
                      src={`https://www.youtube.com/embed/${selectedVideo.youtube_video_id}`}
                      className="w-full aspect-video"
                      allowFullScreen
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="inline-flex items-center rounded-lg bg-slate-100 p-1">
                        <button
                          type="button"
                          onClick={() => setIsNoteEditMode(false)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                            !isNoteEditMode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                          }`}
                        >
                          메모 보기
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsNoteEditMode(true)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                            isNoteEditMode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                          }`}
                        >
                          메모 수정
                        </button>
                      </div>
                      {isNoteEditMode ? (
                        <button
                          onClick={handleSaveNote}
                          disabled={isNoteSaving}
                          className="tone-primary-btn ui-btn ui-btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isNoteSaving ? '저장 중...' : '저장'}
                        </button>
                      ) : null}
                    </div>
                    {!isNoteEditMode ? (
                      <div className="w-full min-h-[220px] rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                        {editingNoteText?.trim() ? editingNoteText : '등록된 메모가 없습니다.'}
                      </div>
                    ) : (
                      <textarea
                        value={editingNoteText}
                        onChange={(e) => setEditingNoteText(e.target.value)}
                        placeholder="선택한 영상의 메모를 작성하세요..."
                        className="w-full min-h-[220px] resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 leading-relaxed"
                      />
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-400">리스트에서 영상을 선택하면 메모 보기를 확인할 수 있습니다.</p>
              )}
              </div>
            </aside>
          </div>

        </div>
      )}
      <datalist id="favorite-channel-options">
        {sortedChannelIds.map((channelId) => {
          const entry = channelVideoMap.get(channelId)!
          return (
            <option key={channelId} value={entry.channelTitle}>
              {entry.channelTitle} ({entry.videos.length})
            </option>
          )
        })}
      </datalist>
    </AppShell>
  )
}
