'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Heart, RefreshCw, ExternalLink, ArrowUpDown } from 'lucide-react'
import { Channel, Video } from '@/types'
import { channelRepository } from '@/lib/supabase/channels'
import { videoRepository, videoFavoriteRepository, videoNoteRepository } from '@/lib/supabase/videos'
import { MOCK_CHANNELS, MOCK_VIDEOS } from '@/lib/mock-data'
import AppShell from '@/components/AppShell'
import EmptyState from '@/components/EmptyState' 
import { LoadingGridSkeleton } from '@/components/LoadingSkeleton'
import { useVideoFilter, useSummaryPreferences } from '@/hooks/useVideo' 
import { refreshAllChannelsAction, removeChannelAction, refreshVideoSummaryAction } from '@/actions/channel-actions'
import { updateVideoFavoriteAction } from '@/actions/note-actions'
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

interface ChannelVideoItem {
  youtubeVideoId: string
  title: string
  channelTitle: string
  publishedAt: string
  videoUrl: string
}

type ChannelNewsMode = 'auto' | 'strict' | 'off'
type SidebarChannelGroup = 'news' | 'finance' | 'real_estate' | 'tech' | 'lifestyle' | 'etc'
type VideoSortMode = 'latest' | 'interest'

export default function DashboardPage() {
  const panelMaxHeight = 'calc(100vh - 64px)'

  const [channels, setChannels] = useState<Channel[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [videoSortMode, setVideoSortMode] = useState<VideoSortMode>('latest')
  const [visibleCount, setVisibleCount] = useState(20)
  const [isSummaryLoading, setIsSummaryLoading] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [noteTextByVideoId, setNoteTextByVideoId] = useState<Record<string, string>>({})
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
  const [domesticNewsItems, setDomesticNewsItems] = useState<NewsChannelItem[]>([])
  const [overseasNewsItems, setOverseasNewsItems] = useState<NewsChannelItem[]>([])
  const [newsPanelLoading, setNewsPanelLoading] = useState(false)
  const [newsPanelError, setNewsPanelError] = useState('')
  const [relatedVideoRefreshTokenById, setRelatedVideoRefreshTokenById] = useState<Record<string, number>>({})
  const [externalChannelVideosById, setExternalChannelVideosById] = useState<Record<string, ChannelVideoItem[]>>({})
  const [externalChannelVideoLoadingById, setExternalChannelVideoLoadingById] = useState<Record<string, boolean>>({})
  const [externalChannelVideoErrorById, setExternalChannelVideoErrorById] = useState<Record<string, string>>({})
  const prevLastRefreshed = useRef<string | null>(null)

  const { filteredVideos, filterText, setFilterText } = useVideoFilter(videos)
  const { enableTranscriptPipeline } = useSummaryPreferences()
  const channelTitleById = useMemo(
    () => new Map(channels.map((channel) => [channel.youtube_channel_id, channel.title])),
    [channels]
  )
  const channelThumbById = useMemo(
    () => new Map(channels.map((channel) => [channel.youtube_channel_id, channel.thumbnail_url || ''])),
    [channels]
  )
  useEffect(() => { loadData() }, [])

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
  const getChannelModes = (video: Video) =>
    ({ stock: 'auto' as const, news: 'auto' as ChannelNewsMode })
  const getEmptyNewsMessage = (video: Video) => {
    const { news } = getChannelModes(video)
    if (news === 'off') return '관련 기사를 보려면 설정에서 기사 모드를 auto로 바꿔주세요.'
    if (news === 'strict') return 'strict 모드로 필터링되어 관련 기사가 없습니다. 설정에서 auto로 바꿔보세요.'
    return '요약 기반으로 찾은 뉴스가 없습니다.'
  }
  const formatPublishedDate = (value: string | null) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleDateString('ko-KR')
  }
  const refreshRelatedVideos = (videoId: string) => {
    setRelatedVideoRefreshTokenById((prev) => ({
      ...prev,
      [videoId]: (prev[videoId] || 0) + 1,
    }))
    const target = videos.find((v) => v.youtube_video_id === videoId)
    if (target?.youtube_channel_id) {
      void loadExternalChannelVideos(target.youtube_channel_id, videoId, true)
    }
  }
  const loadExternalChannelVideos = async (
    channelId: string,
    currentVideoId: string,
    refresh = false
  ) => {
    if (!channelId) return
    if (!refresh && externalChannelVideosById[channelId]) return
    setExternalChannelVideoLoadingById((prev) => ({ ...prev, [channelId]: true }))
    setExternalChannelVideoErrorById((prev) => ({ ...prev, [channelId]: '' }))
    try {
      const url = `/api/channels/${encodeURIComponent(channelId)}/videos?exclude=${encodeURIComponent(currentVideoId)}&limit=10`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error('채널 영상을 불러오지 못했습니다.')
      const data = await res.json()
      const items = Array.isArray(data?.items) ? data.items : []
      setExternalChannelVideosById((prev) => ({ ...prev, [channelId]: items }))
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : '채널 영상을 불러오지 못했습니다.'
      setExternalChannelVideoErrorById((prev) => ({ ...prev, [channelId]: message }))
    } finally {
      setExternalChannelVideoLoadingById((prev) => ({ ...prev, [channelId]: false }))
    }
  }
  const loadRelatedNews = async (
    videoId: string,
    cacheKey: string,
    refreshTarget: 'news' | 'stocks' | null = null
  ) => {
    const targetVideo = videos.find((v) => v.youtube_video_id === videoId)
    if (targetVideo && getChannelModes(targetVideo).news === 'off') {
      setNewsByVideoId(prev => ({ ...prev, [videoId]: [] }))
      setNewsCacheKeyByVideoId(prev => ({ ...prev, [videoId]: cacheKey }))
      setNewsErrorByVideoId(prev => ({ ...prev, [videoId]: '' }))
      return
    }
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
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}))
        const detail = typeof errorPayload?.error === 'string' ? errorPayload.error : ''
        throw new Error(detail ? `뉴스를 불러오지 못했습니다: ${detail}` : '뉴스를 불러오지 못했습니다')
      }
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
      const message = error instanceof Error ? error.message : '뉴스를 가져오지 못했습니다.'
      setNewsErrorByVideoId(prev => ({ ...prev, [videoId]: message }))
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
        setNoteTextByVideoId({})
        setDomesticNewsItems([])
        setOverseasNewsItems([])
        return
      }
      const [channelsData, videosData, favoritesData, notesData] = await Promise.all([
        channelRepository.getAll(),
        videoRepository.getAll(),
        videoFavoriteRepository.getAllFavorites(),
        videoNoteRepository.getAll(),
      ])
      const validVideosData = videosData.filter(isValidStoredVideo)
      setChannels(channelsData)
      setVideos(validVideosData)
      setSelectedVideoId(validVideosData[0]?.youtube_video_id ?? null)
      setFavoriteIds(new Set(favoritesData.map(f => f.youtube_video_id)))
      const notesMap: Record<string, string> = {}
      for (const note of notesData) {
        notesMap[note.youtube_video_id] = note.note || ''
      }
      setNoteTextByVideoId(notesMap)
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
      setNoteTextByVideoId({})
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

  const tokenize = (text: string): string[] => {
    const stopwords = new Set([
      '영상', '요약', '분석', '대한', '관련', '이야기', '정리', '오늘', '이번', '뉴스',
      'the', 'and', 'for', 'with', 'that', 'this',
    ])
    return (text || '')
      .toLowerCase()
      .replace(/[^0-9a-z가-힣\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !stopwords.has(token))
  }

  const interestTermWeights = useMemo(() => {
    const positiveNoteTerms = ['최고', '강추', '유익', '추천', '좋음', '좋다', '인사이트']
    const negativeNoteTerms = ['별로', '비추', '어그로', '별루', '실망', '싫']
    const map = new Map<string, number>()

    for (const video of videos) {
      if (!favoriteIds.has(video.youtube_video_id)) continue
      for (const token of tokenize(video.title)) {
        map.set(token, (map.get(token) || 0) + 1)
      }
    }

    for (const [videoId, note] of Object.entries(noteTextByVideoId)) {
      if (!favoriteIds.has(videoId)) continue
      const normalized = (note || '').toLowerCase()
      const hasNegative = negativeNoteTerms.some((term) => normalized.includes(term))
      if (hasNegative) continue
      const hasPositive = positiveNoteTerms.some((term) => normalized.includes(term))
      const noteWeight = hasPositive ? 2 : 0.5
      for (const token of tokenize(note || '')) {
        map.set(token, (map.get(token) || 0) + noteWeight)
      }
    }

    return map
  }, [videos, favoriteIds, noteTextByVideoId])

  const sortedVideos = useMemo(() => {
    const base = selectedChannelIds.length > 0
      ? filteredVideos.filter(v => selectedChannelIds.includes(v.youtube_channel_id))
      : filteredVideos
    const list = [...base]
    if (videoSortMode === 'interest') {
      const profileWeightTotal = [...interestTermWeights.values()].reduce((acc, value) => acc + value, 0) || 1
      const maxLike = Math.max(1, ...list.map((video) => Number(video.like_count || 0)))
      const score = (video: Video) => {
        const titleTokens = new Set(tokenize(video.title))
        const keywordOverlapScore = [...titleTokens].reduce(
          (acc, token) => acc + (interestTermWeights.get(token) || 0),
          0
        )
        const keywordSimilarity = Math.min(1, keywordOverlapScore / Math.max(6, profileWeightTotal * 0.35))
        const likeCount = Math.max(0, Number(video.like_count || 0))
        const normalizedLikeScore = Math.log10(1 + likeCount) / Math.log10(1 + maxLike)
        return keywordSimilarity * 0.7 + normalizedLikeScore * 0.3
      }
      return list.sort((a, b) => score(b) - score(a))
    }
    return list.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
  }, [filteredVideos, selectedChannelIds, videoSortMode, interestTermWeights])
  const weeklyVideoCount = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    return videos.filter((video) => new Date(video.published_at).getTime() >= weekAgo).length
  }, [videos])
  const relatedVideoRecommendationsById = useMemo(() => {
    const recommendationMap = new Map<string, Video[]>()
    const normalize = (value?: string | null) =>
      (value || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^\p{L}\p{N}]/gu, '')
    const isSameChannel = (current: Video, candidate: Video) => {
      if (candidate.youtube_video_id === current.youtube_video_id) return false
      if (
        current.youtube_channel_id &&
        candidate.youtube_channel_id &&
        current.youtube_channel_id === candidate.youtube_channel_id
      ) return true
      const currentName = normalize(getChannelDisplayName(current))
      const candidateName = normalize(getChannelDisplayName(candidate))
      if (!currentName || !candidateName) return false
      if (currentName === candidateName) return true
      if (currentName.length >= 4 && candidateName.includes(currentName)) return true
      if (candidateName.length >= 4 && currentName.includes(candidateName)) return true
      return false
    }
    for (const current of sortedVideos) {
      const refreshToken = relatedVideoRefreshTokenById[current.youtube_video_id] || 0
      const related = sortedVideos.filter((candidate) => isSameChannel(current, candidate))
      const rotated = related.length > 1
        ? [
            ...related.slice(refreshToken % related.length),
            ...related.slice(0, refreshToken % related.length),
          ]
        : related
      const limited = rotated.slice(0, 5)
      recommendationMap.set(current.youtube_video_id, limited)
    }
    return recommendationMap
  }, [sortedVideos, relatedVideoRefreshTokenById, channelTitleById])
  const selectedVideo = useMemo(() =>
    sortedVideos.find(v => v.youtube_video_id === selectedVideoId) ?? null,
    [sortedVideos, selectedVideoId]
  )

  useEffect(() => {
    if (sortedVideos.length === 0) {
      setSelectedVideoId(null)
      return
    }
    if (selectedVideoId && !sortedVideos.some((v) => v.youtube_video_id === selectedVideoId)) {
      setSelectedVideoId(sortedVideos[0].youtube_video_id)
    }
  }, [sortedVideos, selectedVideoId])

  useEffect(() => {
    if (!selectedVideo) return
    if (getChannelModes(selectedVideo).news === 'off') {
      setNewsByVideoId(prev => ({ ...prev, [selectedVideo.youtube_video_id]: [] }))
      return
    }
    const cacheKey = `${selectedVideo.summary_text || ''}|${selectedVideo.title || ''}`
    void loadRelatedNews(selectedVideo.youtube_video_id, cacheKey)
  }, [selectedVideo?.youtube_video_id, selectedVideo?.summary_text]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedVideo?.youtube_channel_id || !selectedVideo?.youtube_video_id) return
    void loadExternalChannelVideos(selectedVideo.youtube_channel_id, selectedVideo.youtube_video_id)
  }, [selectedVideo?.youtube_channel_id, selectedVideo?.youtube_video_id]) // eslint-disable-line react-hooks/exhaustive-deps

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
    onChannelAdded:    loadData,
    onChannelRemoved:  async (channelId: string) => {
      await removeChannelAction(channelId)
      await loadData()
    },
    onChannelSelected: (id: string) => setSelectedChannelIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    ),
    onChannelGroupChanged: handleChannelGroupChanged,
    onChannelClearFilter: () => setSelectedChannelIds([]),
    selectedChannelIds,
    newVideoCount:     refreshStatus?.newVideoCount ?? 0,
    onManualRefresh:   handleManualRefresh,
  }

  const renderVideoDetail = (video: Video) => (
    <div className="space-y-3.5">
      {(() => {
        const modes = getChannelModes(video)
        const localCandidates = relatedVideoRecommendationsById.get(video.youtube_video_id) || []
        const externalCandidates = externalChannelVideosById[video.youtube_channel_id] || []
        const mergedCandidates = [
          ...localCandidates.map((candidate) => ({
            youtubeVideoId: candidate.youtube_video_id,
            title: candidate.title,
            videoUrl: `https://youtube.com/watch?v=${candidate.youtube_video_id}`,
          })),
          ...externalCandidates.map((candidate) => ({
            youtubeVideoId: candidate.youtubeVideoId,
            title: candidate.title,
            videoUrl: candidate.videoUrl,
          })),
        ]
        const dedupedCandidates = Array.from(
          new Map(
            mergedCandidates
              .filter((candidate) => candidate.youtubeVideoId !== video.youtube_video_id)
              .map((candidate) => [candidate.youtubeVideoId, candidate] as const)
          ).values()
        )
        const isExternalLoading = !!externalChannelVideoLoadingById[video.youtube_channel_id]
        const externalError = externalChannelVideoErrorById[video.youtube_channel_id]
        return (
          <>
      <div className="flex items-start justify-between gap-3 pb-1 border-b border-slate-100">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 leading-snug line-clamp-2 min-h-[3.5rem]">
            {video.title}
          </h2>
          <div className="mt-1 flex items-center gap-1.5 text-xs min-h-[1rem]">
            {isNewVideo(video) && (
              <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded font-semibold text-[10px]">NEW</span>
            )}
            <span className="text-gray-500">
              {new Date(video.published_at).toLocaleString('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        </div>
        <button
          onClick={() => toggleFavorite(video.youtube_video_id)}
          disabled={togglingIds.has(video.youtube_video_id)}
          className="ui-btn ui-btn-icon flex-shrink-0 disabled:opacity-50"
          title={favoriteIds.has(video.youtube_video_id) ? '즐겨찾기 해제' : '즐겨찾기 추가'}
          aria-label={favoriteIds.has(video.youtube_video_id) ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        >
          <Heart
            size={14}
            className={favoriteIds.has(video.youtube_video_id)
              ? 'text-red-400 fill-red-400'
              : 'text-gray-300'}
          />
        </button>
      </div>

      <div className="space-y-2.5">
        <div className="border border-slate-100 bg-white rounded-xl overflow-hidden shadow-sm">
          <iframe
            src={`https://www.youtube.com/embed/${video.youtube_video_id}`}
            className="w-full aspect-video"
            allowFullScreen
          />
        </div>

        <div className="border border-slate-100 bg-slate-50/50 rounded-xl p-4">
          <h3 className="ui-title-sm text-gray-800 mb-2">영상 요약</h3>
          {video.transcript_status === 'not_available' ? (
            <p className="ui-text-body text-gray-500">아직 자막을 추출할 수 없습니다.</p>
          ) : video.transcript_status === 'pending' ? (
            <p className="ui-text-body text-gray-500 animate-pulse">자막 추출 중...</p>
          ) : video.summary_status === 'failed' && video.summary_text ? (
            <p className="ui-text-body text-gray-600">{video.summary_text}</p>
          ) : video.summary_status === 'complete' && video.summary_text ? (
              <p className="ui-text-body text-gray-700 whitespace-pre-line leading-relaxed">
              {video.summary_text}
            </p>
          ) : isSummaryLoading ? (
            <p className="ui-text-body text-gray-500 animate-pulse">요약 생성 중...</p>
          ) : (
            <p className="ui-text-body text-gray-500">아직 요약이 없습니다</p>
          )}
        </div>

        <div className="flex">
          <button
            onClick={() => handleRefreshSummary(video.youtube_video_id)}
            disabled={isSummaryLoading}
            className="tone-primary-btn ui-btn disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSummaryLoading
              ? video.transcript_status === 'pending'
                ? '자막 추출 중...'
                : '요약 생성 중...'
              : video.summary_status === 'complete' && !!video.summary_text
              ? '요약 다시 생성'
              : video.summary_status === 'failed' || video.transcript_status === 'not_available'
              ? '요약 다시 시도'
              : '요약 생성'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="border border-slate-100 bg-white rounded-xl p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="ui-title-sm text-gray-800">관련 뉴스 보기</h3>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  const cacheKey = `${video.summary_text || ''}|${video.title || ''}`
                  void loadRelatedNews(video.youtube_video_id, cacheKey, 'news')
                }}
                disabled={modes.news === 'off'}
                className="ui-btn-ghost-icon disabled:opacity-40"
                title="관련 뉴스 새로고침"
                aria-label="관련 뉴스 새로고침"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
          <div>
            {newsLoadingVideoId === video.youtube_video_id ? (
              <p className="ui-text-body text-gray-500 animate-pulse">관련 뉴스를 찾는 중...</p>
            ) : newsErrorByVideoId[video.youtube_video_id] ? (
              <p className="ui-text-body text-gray-500">{newsErrorByVideoId[video.youtube_video_id]}</p>
            ) : (newsByVideoId[video.youtube_video_id] || []).length === 0 ? (
              <p className="ui-text-body text-gray-500">{getEmptyNewsMessage(video)}</p>
            ) : (
              <div className="space-y-2">
                {(newsByVideoId[video.youtube_video_id] || []).slice(0, 3).map((article, idx) => (
                  <div
                    key={`${article.link}-${idx}`}
                    className="block h-[86px] rounded-lg border border-slate-100 px-3 py-2 hover:bg-indigo-50/50 transition-colors"
                  >
                    <a
                      href={article.link}
                      target="_blank"
                      rel="noreferrer"
                      className="relative block h-full pr-5"
                    >
                      <p className="ui-title-md text-gray-900 line-clamp-2 leading-snug">{article.title}</p>
                      <p className="absolute left-0 right-5 bottom-0 ui-text-meta text-gray-500 truncate">
                        {article.source}
                        {formatPublishedDate(article.publishedAt) ? ` · ${formatPublishedDate(article.publishedAt)}` : ''}
                      </p>
                      <ExternalLink size={13} className="absolute right-0 bottom-0.5 text-gray-400" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="border border-slate-100 bg-white rounded-xl p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="ui-title-sm text-gray-800">다른 영상 보기</h3>
            <button
              onClick={() => refreshRelatedVideos(video.youtube_video_id)}
              className="ui-btn-ghost-icon"
              title="다른 영상 새로고침"
              aria-label="다른 영상 새로고침"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="space-y-2">
            {dedupedCandidates.slice(0, 6).map((candidate) => (
                <a
                  key={candidate.youtubeVideoId}
                  href={candidate.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 hover:bg-indigo-50/50 transition-colors"
                >
                  <span className="ui-title-md text-gray-900 line-clamp-1 flex-1 min-w-0">{candidate.title}</span>
                  <ExternalLink size={13} className="text-gray-400 shrink-0" />
                </a>
              ))}
            {isExternalLoading ? (
              <p className="ui-text-body text-gray-500 animate-pulse">채널의 다른 영상을 불러오는 중...</p>
            ) : null}
            {!isExternalLoading && externalError ? (
              <p className="ui-text-body text-gray-500">{externalError}</p>
            ) : null}
            {!isExternalLoading && !externalError && dedupedCandidates.length === 0 ? (
              <p className="ui-text-body text-gray-500">같은 채널의 다른 영상이 데이터에 없습니다.</p>
            ) : null}
          </div>
        </div>
      </div>
          </>
        )
      })()}
    </div>
  )

  if (isLoading) {
    return <AppShell {...shellProps}><LoadingGridSkeleton count={6} /></AppShell>
  }

  return (
    <AppShell {...shellProps}>
      <div className="grid grid-cols-1 xl:grid-cols-[350px_minmax(0,1fr)_280px] gap-4 xl:text-slate-900">

        {/* ── 좌측: 영상 목록 ──────────────────────────────────────────── */}
        <div
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
                    setVisibleCount(20)
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
                  setVisibleCount(20)
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
                  className={`dashboard-video-item group
                    w-full text-left px-3 py-3 transition-colors cursor-pointer
                    ${idx !== 0 ? 'border-t border-slate-100' : ''}
                    ${isSelected ? 'dashboard-video-selected border-l-4 pl-2.5' : 'hover:bg-slate-50/80'}
                  `}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <h3 className="flex-1 flex items-start gap-1.5 text-[13px] font-semibold text-gray-900 leading-snug min-h-[2.4rem]">
                        {channelThumbById.get(video.youtube_channel_id) ? (
                          <img
                            src={channelThumbById.get(video.youtube_channel_id)}
                            alt={getChannelDisplayName(video)}
                            className="w-4 h-4 rounded object-cover border border-slate-200 shrink-0 mt-0.5"
                          />
                        ) : (
                          <span className="w-4 h-4 rounded bg-slate-200 border border-slate-200 shrink-0 mt-0.5" />
                        )}
                        <span className="line-clamp-2">{video.title}</span>
                      </h3>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(video.youtube_video_id) }}
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
                      {renderVideoDetail(video)}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* ── 가운데: 영상 상세 ────────────────────────────────────────── */}
        <div
          className="hidden xl:block border border-slate-100 rounded-2xl bg-white shadow-[0_1px_4px_rgba(16,24,40,0.06)] p-5 overflow-y-auto"
          style={{ maxHeight: panelMaxHeight }}
        >
          {selectedVideo ? (
            renderVideoDetail(selectedVideo)
          ) : (
            <EmptyState
              title="영상을 선택하세요"
              description="좌측 목록에서 영상을 클릭하면 상세 정보가 표시됩니다."
            />
          )}
        </div>

        {/* ── 우측: 뉴스 채널 최신 제목 ───────────────────────────────── */}
        <aside
          className="border border-slate-100 rounded-2xl bg-white shadow-[0_1px_4px_rgba(16,24,40,0.06)] p-3.5 xl:sticky xl:top-24 overflow-y-auto"
          style={{ maxHeight: panelMaxHeight }}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-gray-800">최신 뉴스</h3>
            <button
              onClick={() => void loadNewsChannelPanel(true)}
              disabled={newsPanelLoading}
              className="ui-btn-ghost-icon disabled:opacity-40"
              title="최신 뉴스 새로고침"
              aria-label="최신 뉴스 새로고침"
            >
              <RefreshCw size={14} className={newsPanelLoading ? 'animate-spin' : ''} />
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
          )}
        </aside>

      </div>
    </AppShell>
  )
}
