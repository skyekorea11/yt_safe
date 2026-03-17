'use client'

/**
 * Settings page - configure app preferences and display system info
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { Channel, NewsChannel } from '@/types'
import { RefreshStatus } from '@/lib/scheduler/refresh-state'
import { channelRepository, newsChannelRepository } from '@/lib/supabase/channels'
import { videoFavoriteRepository, videoRepository } from '@/lib/supabase/videos'
import { MOCK_CHANNELS } from '@/lib/mock-data'
import { refreshAllChannelsAction } from '@/actions/channel-actions'
import { addNewsChannelAction, removeNewsChannelAction } from '@/actions/news-channel-actions'
import { useSummaryPreferences } from '@/hooks/useVideo'
import AppShell from '@/components/AppShell'
import { Settings, Plus, Trash2 } from 'lucide-react'

type ChannelStockMode = 'auto' | 'strict' | 'off' | 'low_stock'
type ChannelNewsMode = 'auto' | 'strict' | 'off'
type ChannelGroupKey = 'all' | 'news' | 'finance' | 'real_estate' | 'tech' | 'lifestyle' | 'etc'
type EditableChannelGroup = Exclude<ChannelGroupKey, 'all'>
type ChannelStat = {
  videoCount: number
  favoriteCount: number
  latestPublishedAt: string | null
}

const normalizeStockMode = (mode?: string): 'auto' | 'strict' | 'off' => {
  if (mode === 'off') return 'off'
  if (mode === 'strict' || mode === 'low_stock') return 'strict'
  return 'auto'
}

const getModeBadgeClass = (mode: 'auto' | 'strict' | 'off') => {
  if (mode === 'auto') return 'bg-emerald-100 text-emerald-700'
  if (mode === 'strict') return 'bg-amber-100 text-amber-700'
  return 'bg-black text-white'
}

const getModeToggleClass = (mode: 'auto' | 'strict' | 'off', isActive: boolean) => {
  if (!isActive) return 'text-gray-600 hover:text-gray-800'
  if (mode === 'auto') return 'bg-emerald-500 text-white shadow-sm'
  if (mode === 'strict') return 'bg-amber-400 text-amber-950 shadow-sm'
  return 'bg-black text-white shadow-sm'
}

const CHANNEL_GROUP_OPTIONS: Array<{ key: ChannelGroupKey; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'news', label: '뉴스/시사' },
  { key: 'finance', label: '경제/주식' },
  { key: 'real_estate', label: '부동산' },
  { key: 'tech', label: '테크/과학' },
  { key: 'lifestyle', label: '라이프/교양' },
  { key: 'etc', label: '기타' },
]

const CHANNEL_GROUP_EDIT_OPTIONS = CHANNEL_GROUP_OPTIONS.filter((option) => option.key !== 'all') as Array<{
  key: EditableChannelGroup
  label: string
}>

const getChannelGroupLabel = (group: ChannelGroupKey | EditableChannelGroup): string => {
  return CHANNEL_GROUP_OPTIONS.find((option) => option.key === group)?.label || '기타'
}

const isEditableChannelGroup = (value: string | null | undefined): value is EditableChannelGroup => {
  return value === 'news' || value === 'finance' || value === 'real_estate' || value === 'tech' || value === 'lifestyle' || value === 'etc'
}

const inferAutoChannelGroup = (channel: Channel): EditableChannelGroup => {
  const text = `${channel.title || ''} ${channel.description || ''} ${channel.handle || ''}`.toLowerCase()
  if (/(뉴스|시사|정치|속보|브리핑|economist|cnn|bbc|nyt|조선|중앙|한겨레|매일경제|한국경제)/.test(text)) return 'news'
  if (/(경제|주식|증시|투자|재테크|금리|채권|etf|연금|자산|펀드|코인|암호화폐)/.test(text)) return 'finance'
  if (/(부동산|아파트|청약|전세|월세|집값|재건축|재개발|임장|분양|신도시)/.test(text)) return 'real_estate'
  if (/(테크|기술|개발|코딩|프로그래밍|ai|인공지능|반도체|it|과학|우주)/.test(text)) return 'tech'
  if (/(교양|다큐|역사|여행|요리|건강|자기계발|라이프|문화|인터뷰)/.test(text)) return 'lifestyle'
  return 'etc'
}

const resolveChannelGroup = (channel: Channel): EditableChannelGroup => {
  return isEditableChannelGroup(channel.channel_group) ? channel.channel_group : inferAutoChannelGroup(channel)
}

export default function SettingsPage() {
  const { showSummary, updateShowSummary, enableTranscriptPipeline, updateEnableTranscriptPipeline } = useSummaryPreferences()

  const [channels, setChannels] = useState<Channel[]>([])
  const [newsChannels, setNewsChannels] = useState<NewsChannel[]>([])
  const [newsChannelInput, setNewsChannelInput] = useState('')
  const [newsChannelRegion, setNewsChannelRegion] = useState<'domestic' | 'overseas'>('domestic')
  const [channelSearchQuery, setChannelSearchQuery] = useState('')
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [channelStats, setChannelStats] = useState<Record<string, ChannelStat>>({})
  const [isNewsChannelSaving, setIsNewsChannelSaving] = useState(false)
  const [newsChannelMessage, setNewsChannelMessage] = useState<string>('')
  const [savingStockModeIds, setSavingStockModeIds] = useState<Set<string>>(new Set())
  const [savingNewsModeIds, setSavingNewsModeIds] = useState<Set<string>>(new Set())
  const [savingChannelGroupIds, setSavingChannelGroupIds] = useState<Set<string>>(new Set())
  const [channelGroupMessage, setChannelGroupMessage] = useState('')
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>({
    lastRefreshed: null,
    nextRefresh: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    newVideoCount: 0,
  })
  const prevLastRefreshed = useRef<string | null>(null)

  useEffect(() => {
    loadChannels()
    loadNewsChannels()
  }, [])

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/refresh-status')
        if (!res.ok) return
        const data: RefreshStatus = await res.json()
        if (data.lastRefreshed && data.lastRefreshed !== prevLastRefreshed.current) {
          if (prevLastRefreshed.current !== null) await loadChannels()
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
      await loadChannels()
      setRefreshStatus({
        lastRefreshed: new Date().toISOString(),
        nextRefresh: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        newVideoCount: result.newCount,
      })
    }
  }

  const loadChannels = async () => {
    try {
      const hasApiKey = !!process.env.NEXT_PUBLIC_YOUTUBE_API_KEY?.trim()
      if (hasApiKey) {
        const [data, videos, favorites] = await Promise.all([
          channelRepository.getAll(),
          videoRepository.getAll(),
          videoFavoriteRepository.getAllFavorites(),
        ])
        setChannels(data)
        const favoriteVideoIds = new Set(favorites.map((favorite) => favorite.youtube_video_id))
        const statsMap: Record<string, ChannelStat> = {}
        videos.forEach((video) => {
          const channelId = video.youtube_channel_id
          if (!statsMap[channelId]) {
            statsMap[channelId] = {
              videoCount: 0,
              favoriteCount: 0,
              latestPublishedAt: null,
            }
          }
          statsMap[channelId].videoCount += 1
          if (favoriteVideoIds.has(video.youtube_video_id)) {
            statsMap[channelId].favoriteCount += 1
          }
          const latestPublishedAt = statsMap[channelId].latestPublishedAt
          if (
            video.published_at &&
            (!latestPublishedAt || video.published_at > latestPublishedAt)
          ) {
            statsMap[channelId].latestPublishedAt = video.published_at
          }
        })
        setChannelStats(statsMap)
      } else {
        setChannels(MOCK_CHANNELS)
        setChannelStats({})
      }
    } catch {
      setChannels(MOCK_CHANNELS)
      setChannelStats({})
    }
  }

  const loadNewsChannels = async () => {
    try {
      const data = await newsChannelRepository.getAll()
      setNewsChannels(data)
    } catch {
      setNewsChannels([])
    }
  }

  const handleAddNewsChannel = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newsChannelInput.trim()) return
    setIsNewsChannelSaving(true)
    setNewsChannelMessage('')
    try {
      const result = await addNewsChannelAction(newsChannelInput.trim(), newsChannelRegion)
      if (!result.success) {
        setNewsChannelMessage(result.error || '뉴스 채널 추가에 실패했습니다.')
        return
      }
      setNewsChannelInput('')
      setNewsChannelMessage('뉴스 채널이 추가되었습니다.')
      await loadNewsChannels()
    } finally {
      setIsNewsChannelSaving(false)
    }
  }

  const handleRemoveNewsChannel = async (youtubeChannelId: string) => {
    const result = await removeNewsChannelAction(youtubeChannelId)
    if (!result.success) {
      setNewsChannelMessage(result.error || '뉴스 채널 삭제에 실패했습니다.')
      return
    }
    await loadNewsChannels()
  }

  const handleChannelStockModeChange = async (
    youtubeChannelId: string,
    stockMode: ChannelStockMode
  ) => {
    setSavingStockModeIds(prev => new Set(prev).add(youtubeChannelId))
    const prevChannels = channels
    setChannels(prev => prev.map(ch => (
      ch.youtube_channel_id === youtubeChannelId ? { ...ch, stock_mode: stockMode } : ch
    )))
    try {
      const success = await channelRepository.updateStockMode(youtubeChannelId, stockMode)
      if (!success) {
        setChannels(prevChannels)
      }
    } finally {
      setSavingStockModeIds(prev => {
        const next = new Set(prev)
        next.delete(youtubeChannelId)
        return next
      })
    }
  }

  const handleChannelNewsModeChange = async (
    youtubeChannelId: string,
    newsMode: ChannelNewsMode
  ) => {
    setSavingNewsModeIds(prev => new Set(prev).add(youtubeChannelId))
    const prevChannels = channels
    setChannels(prev => prev.map(ch => (
      ch.youtube_channel_id === youtubeChannelId ? { ...ch, news_mode: newsMode } : ch
    )))
    try {
      const success = await channelRepository.updateNewsMode(youtubeChannelId, newsMode)
      if (!success) {
        setChannels(prevChannels)
      }
    } finally {
      setSavingNewsModeIds(prev => {
        const next = new Set(prev)
        next.delete(youtubeChannelId)
        return next
      })
    }
  }

  const handleChannelGroupChange = async (
    youtubeChannelId: string,
    channelGroup: EditableChannelGroup | 'auto'
  ) => {
    setChannelGroupMessage('')
    setSavingChannelGroupIds(prev => new Set(prev).add(youtubeChannelId))
    const prevChannels = channels
    setChannels(prev => prev.map(ch => (
      ch.youtube_channel_id === youtubeChannelId
        ? { ...ch, channel_group: channelGroup === 'auto' ? null : channelGroup }
        : ch
    )))
    try {
      const result = await channelRepository.updateChannelGroup(
        youtubeChannelId,
        channelGroup === 'auto' ? null : channelGroup
      )
      if (!result.success) {
        setChannels(prevChannels)
        if (result.reason === 'missing_column') {
          setChannelGroupMessage('DB에 channel_group 컬럼이 없어 저장할 수 없습니다. schema.sql 반영 후 다시 시도해주세요.')
        } else {
          setChannelGroupMessage(result.message || '채널 분류 저장에 실패했습니다.')
        }
      }
    } finally {
      setSavingChannelGroupIds(prev => {
        const next = new Set(prev)
        next.delete(youtubeChannelId)
        return next
      })
    }
  }

  const channelsWithGroup = useMemo(() => {
    return channels.map((channel) => ({
      channel,
      group: resolveChannelGroup(channel),
    }))
  }, [channels])

  const filteredChannels = useMemo(() => {
    const query = channelSearchQuery.trim().toLowerCase()
    return channelsWithGroup.filter(({ channel }) => {
      const title = (channel.title || '').toLowerCase()
      const handle = (channel.handle || '').toLowerCase()
      const id = (channel.youtube_channel_id || '').toLowerCase()
      const byQuery = !query || title.includes(query) || handle.includes(query) || id.includes(query)
      return byQuery
    })
  }, [channelsWithGroup, channelSearchQuery])

  const selectedChannel = useMemo(() => {
    if (!selectedChannelId) return filteredChannels[0]?.channel || null
    return filteredChannels.find(({ channel }) => channel.youtube_channel_id === selectedChannelId)?.channel
      || channels.find((ch) => ch.youtube_channel_id === selectedChannelId)
      || null
  }, [filteredChannels, channels, selectedChannelId])
  const selectedChannelStat = useMemo(() => {
    if (!selectedChannel) return null
    return channelStats[selectedChannel.youtube_channel_id] || {
      videoCount: 0,
      favoriteCount: 0,
      latestPublishedAt: null,
    }
  }, [channelStats, selectedChannel])
  const selectedChannelGroupLabel = useMemo(() => {
    if (!selectedChannel) return ''
    const group = resolveChannelGroup(selectedChannel)
    return getChannelGroupLabel(group)
  }, [selectedChannel])
  const selectedChannelGroupValue = useMemo(() => {
    if (!selectedChannel) return 'auto'
    return isEditableChannelGroup(selectedChannel.channel_group) ? selectedChannel.channel_group : 'auto'
  }, [selectedChannel])

  useEffect(() => {
    if (filteredChannels.length === 0) {
      setSelectedChannelId(null)
      return
    }
    if (!selectedChannelId || !filteredChannels.some(({ channel }) => channel.youtube_channel_id === selectedChannelId)) {
      setSelectedChannelId(filteredChannels[0].channel.youtube_channel_id)
    }
  }, [filteredChannels, selectedChannelId])

  return (
    <AppShell
      channels={channels}
      onChannelAdded={loadChannels}
      newVideoCount={refreshStatus.newVideoCount}
      onManualRefresh={handleManualRefresh}
    >
      <div className="mb-12">
        <div className="flex items-center gap-4 mb-4">
          <Settings size={32} className="text-gray-700" />
          <h1 className="text-4xl font-bold text-gray-900">설정</h1>
        </div>
        <p className="text-gray-600 text-lg">
          앱의 표시 및 처리 설정을 관리하세요.
        </p>
      </div>

      <div className="space-y-8">
        <div id="news-channels" className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 max-w-2xl scroll-mt-20">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">뉴스 채널 관리</h2>
          <p className="text-sm text-gray-500 mb-4">대시보드 우측 최신 뉴스 패널에서 사용할 채널만 별도로 관리합니다.</p>

          <form onSubmit={handleAddNewsChannel} className="flex gap-2 mb-4">
            <select
              value={newsChannelRegion}
              onChange={(e) => setNewsChannelRegion(e.target.value as 'domestic' | 'overseas')}
              className="rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              disabled={isNewsChannelSaving}
            >
              <option value="domestic">국내</option>
              <option value="overseas">해외</option>
            </select>
            <input
              type="text"
              value={newsChannelInput}
              onChange={(e) => setNewsChannelInput(e.target.value)}
              placeholder="@news_handle 또는 채널 URL"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              disabled={isNewsChannelSaving}
            />
            <button
              type="submit"
              disabled={isNewsChannelSaving || !newsChannelInput.trim()}
              className="px-3 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-40 flex items-center gap-1"
            >
              <Plus size={14} />
              추가
            </button>
          </form>

          {newsChannelMessage ? (
            <p className="text-xs text-gray-500 mb-3">{newsChannelMessage}</p>
          ) : null}

          {newsChannels.length === 0 ? (
            <p className="text-sm text-gray-400">등록된 뉴스 채널이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {newsChannels.map((channel) => (
                <div key={channel.youtube_channel_id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                  {channel.thumbnail_url ? (
                    <img src={channel.thumbnail_url} alt={channel.title} className="w-8 h-8 rounded object-cover border border-gray-100" />
                  ) : (
                    <div className="w-8 h-8 rounded bg-gray-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{channel.title}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {channel.region === 'domestic' ? '국내' : '해외'} · {channel.handle || channel.youtube_channel_id}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRemoveNewsChannel(channel.youtube_channel_id)}
                    className="p-1.5 rounded text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    title="뉴스 채널 삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Display preferences */}
        <div id="display-preferences" className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 max-w-2xl scroll-mt-20">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">표시 설정</h2>

          <div className="space-y-4">
            <label className="flex items-center gap-4 cursor-pointer">
              <input
                type="checkbox"
                checked={showSummary}
                onChange={(e) => updateShowSummary(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300 focus:ring-2 focus:ring-gray-400"
              />
              <div>
                <p className="font-medium text-gray-900">요약본 표시</p>
                <p className="text-sm text-gray-500">동영상 카드에서 요약본을 표시합니다</p>
              </div>
            </label>
            <label className="flex items-center gap-4 cursor-pointer">
              <input
                type="checkbox"
                checked={enableTranscriptPipeline}
                onChange={(e) => updateEnableTranscriptPipeline(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300 focus:ring-2 focus:ring-gray-400"
              />
              <div>
                <p className="font-medium text-gray-900">자막 우선 요약 파이프라인 사용</p>
                <p className="text-sm text-gray-500">가능하다면 동영상 자막을 추출하고 이를 기반으로 요약합니다.</p>
              </div>
            </label>
          </div>
        </div>

      </div>
    </AppShell>
  )
}
