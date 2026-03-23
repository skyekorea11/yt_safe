'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Channel, Video } from '@/types'
import {
  RefreshStatus,
  RelatedNewsItem,
  StockSuggestion,
  NewsChannelItem,
  ChannelVideoItem,
  ChannelNewsMode,
  SidebarChannelGroup,
  VideoSortMode,
} from '@/types/dashboard'
import { channelRepository } from '@/lib/supabase/channels'
import { videoRepository, videoFavoriteRepository, videoNoteRepository } from '@/lib/supabase/videos'
import { MOCK_CHANNELS, MOCK_VIDEOS } from '@/lib/mock-data'
import { useVideoFilter, useSummaryPreferences } from '@/hooks/useVideo'
import { refreshAllChannelsAction, removeChannelAction, refreshVideoSummaryAction } from '@/actions/channel-actions'
import { updateVideoFavoriteAction } from '@/actions/note-actions'
import { isValidStoredVideo } from '@/lib/utils/video-validity'
import { logger } from '@/lib/logger'

export function useDashboard() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [videoSortMode, setVideoSortMode] = useState<VideoSortMode>('latest')
  const [visibleCount, setVisibleCount] = useState(20)
  const [summaryLoadingVideoId, setSummaryLoadingVideoId] = useState<string | null>(null)
  const [summaryDoneVideoId, setSummaryDoneVideoId] = useState<string | null>(null)
  const [summaryElapsedSeconds, setSummaryElapsedSeconds] = useState(0)
  const [confirmedUnavailableIds, setConfirmedUnavailableIds] = useState<Set<string>>(new Set())
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
  const [newsPanelCollapsed, setNewsPanelCollapsed] = useState(false)
  const [supadataQuota, setSupadataQuota] = useState<{ remaining: number; total: number } | null>(null)
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const selectVideo = params.get('selectVideo') ?? undefined
    if (selectVideo) window.history.replaceState(null, '', '/')
    loadData(selectVideo)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadSupadataQuota() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!summaryLoadingVideoId) {
      setSummaryElapsedSeconds(0)
      return
    }
    setSummaryElapsedSeconds(0)
    const interval = setInterval(() => setSummaryElapsedSeconds(s => s + 1), 1000)
    return () => clearInterval(interval)
  }, [summaryLoadingVideoId])

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
  const getChannelModes = (_video: Video) =>
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
      logger.error(error)
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
      logger.error(error)
      const message = error instanceof Error ? error.message : '뉴스를 가져오지 못했습니다.'
      setNewsErrorByVideoId(prev => ({ ...prev, [videoId]: message }))
    } finally {
      setNewsLoadingVideoId(prev => (prev === videoId ? null : prev))
      setStocksLoadingVideoId(prev => (prev === videoId ? null : prev))
    }
  }

  const loadSupadataQuota = async () => {
    try {
      const res = await fetch('/api/supadata-quota')
      if (res.ok) setSupadataQuota(await res.json())
    } catch {}
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
      logger.error(error)
      setNewsPanelError('뉴스 채널 패널을 불러오지 못했습니다.')
    } finally {
      setNewsPanelLoading(false)
    }
  }

  const loadData = async (selectVideoId?: string | null) => {
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
      // URL param(바로가기)이 있으면 최우선
      if (selectVideoId) {
        pendingScrollToSelected.current = true
        setVisibleCount(validVideosData.length) // 해당 영상이 어디에 있든 렌더되도록
        setSelectedVideoId(selectVideoId)
      } else {
        const savedId = sessionStorage.getItem('selectedVideoId')
        const savedIdx = savedId ? validVideosData.findIndex(v => v.youtube_video_id === savedId) : -1
        const hasRestored = savedIdx >= 0
        const initialId = hasRestored ? savedId! : validVideosData[0]?.youtube_video_id ?? null
        if (hasRestored) {
          pendingScrollToSelected.current = true
          if (savedIdx >= 20) setVisibleCount(savedIdx + 10)
        }
        setSelectedVideoId(initialId)
      }
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
      void loadSupadataQuota()
    } catch (error) {
      logger.error(error)
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
      logger.error(err)
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

    setSummaryLoadingVideoId(videoId)
    try {
      localStorage.setItem('summary-loading', JSON.stringify({ videoId, title: video.title }))
      window.dispatchEvent(new Event('summary-loading-updated'))
    } catch {}
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
    let wasAborted = false
    try {
      let result = await refreshVideoSummaryAction(videoId, video.title, video.description, enableTranscriptPipeline)

      // 자막 추출 실패 시 3초 후 클라이언트에서 1회 자동 재시도
      if (result.video && (result.video.transcript_status === 'failed' || result.video.transcript_status === 'not_available') && !result.video.summary_text) {
        await new Promise(resolve => setTimeout(resolve, 3000))
        result = await refreshVideoSummaryAction(videoId, video.title, video.description, enableTranscriptPipeline)
        // 재시도 후에도 실패면 진짜 자막 없는 것으로 확정 (failed 포함)
        if (result.video && (result.video.transcript_status === 'not_available' || result.video.transcript_status === 'failed') && !result.video.summary_text) {
          setConfirmedUnavailableIds(prev => new Set(prev).add(videoId))
        }
      }

      if (result.video) {
        setVideos(prev =>
          prev.map(v => (v.youtube_video_id === videoId ? { ...v, ...result.video } : v))
        )
        const cacheKey = `${result.video.summary_text || ''}|${result.video.title || ''}`
        void loadRelatedNews(videoId, cacheKey, 'news')
        if (result.video.summary_status === 'complete' && result.video.summary_text) {
          setSummaryDoneVideoId(videoId)
          try {
            const title = videos.find(v => v.youtube_video_id === videoId)?.title || ''
            localStorage.setItem('summary-done', JSON.stringify({ videoId, title }))
            window.dispatchEvent(new Event('summary-done-updated'))
          } catch {}
        }
      }
    } catch (error) {
      wasAborted = error instanceof Error && (error.name === 'AbortError' || error.message.includes('abort'))
      if (!wasAborted) logger.error('Error refreshing summary:', error)
    } finally {
      setSummaryLoadingVideoId(null)
      // abort된 경우(페이지 이동 등) localStorage loading 상태를 유지해 팝업이 사라지지 않게 함
      if (!wasAborted) {
        try {
          localStorage.removeItem('summary-loading')
          window.dispatchEvent(new Event('summary-loading-updated'))
        } catch {}
      }
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

  const videoListRef = useRef<HTMLDivElement>(null)
  const pendingScrollToSelected = useRef(false)
  useEffect(() => {
    if (!pendingScrollToSelected.current || !selectedVideoId || !videoListRef.current) return
    const item = videoListRef.current.querySelector(`[data-video-id="${selectedVideoId}"]`)
    if (item) {
      item.scrollIntoView({ block: 'center' })
      pendingScrollToSelected.current = false
    }
  }, [videos, selectedVideoId])

  const isFirstSelectedRender = useRef(true)
  useEffect(() => {
    if (isFirstSelectedRender.current) {
      isFirstSelectedRender.current = false
      return
    }
    if (selectedVideoId) {
      sessionStorage.setItem('selectedVideoId', selectedVideoId)
    } else {
      sessionStorage.removeItem('selectedVideoId')
    }
  }, [selectedVideoId])

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
      logger.error('채널 분류 변경 실패:', result.message || 'unknown_error')
      setChannels(prevChannels)
    }
  }

  const handleChannelOrderChanged = async (orderedChannelIds: string[]) => {
    const idxMap = new Map(orderedChannelIds.map((id, idx) => [id, idx] as const))
    setChannels((prev) =>
      [...prev].sort((a, b) => {
        const aIdx = idxMap.get(a.youtube_channel_id)
        const bIdx = idxMap.get(b.youtube_channel_id)
        if (aIdx == null && bIdx == null) return 0
        if (aIdx == null) return 1
        if (bIdx == null) return -1
        return aIdx - bIdx
      })
    )
    const result = await channelRepository.updateSortOrders(orderedChannelIds)
    if (!result.success) {
      logger.error('채널 순서 저장 실패:', result.message || 'unknown_error')
      await loadData()
    }
  }

  return {
    // state
    channels,
    videos,
    isLoading,
    selectedVideoId,
    setSelectedVideoId,
    selectedChannelIds,
    setSelectedChannelIds,
    videoSortMode,
    setVideoSortMode,
    visibleCount,
    setVisibleCount,
    summaryLoadingVideoId,
    summaryDoneVideoId,
    summaryElapsedSeconds,
    confirmedUnavailableIds,
    favoriteIds,
    togglingIds,
    refreshStatus,
    newsByVideoId,
    stocksByVideoId,
    newsLoadingVideoId,
    newsErrorByVideoId,
    domesticNewsItems,
    overseasNewsItems,
    newsPanelLoading,
    newsPanelError,
    newsPanelCollapsed,
    setNewsPanelCollapsed,
    supadataQuota,
    externalChannelVideosById,
    externalChannelVideoLoadingById,
    externalChannelVideoErrorById,
    relatedVideoRecommendationsById,
    // derived
    sortedVideos,
    selectedVideo,
    weeklyVideoCount,
    channelThumbById,
    filterText,
    setFilterText,
    // refs
    videoListRef,
    // handlers
    loadData,
    loadRelatedNews,
    loadNewsChannelPanel,
    handleManualRefresh,
    handleRefreshSummary,
    handleChannelGroupChanged,
    handleChannelOrderChanged,
    toggleFavorite,
    refreshRelatedVideos,
    isNewVideo,
    getChannelDisplayName,
    getChannelModes,
    getEmptyNewsMessage,
    formatPublishedDate,
  }
}
