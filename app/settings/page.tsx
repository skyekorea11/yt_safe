'use client'

/**
 * Settings page - configure app preferences and display system info
 */

import { useState, useEffect, useRef } from 'react'
import { Channel, NewsChannel } from '@/types'
import { RefreshStatus } from '@/lib/scheduler/refresh-state'
import { channelRepository, newsChannelRepository } from '@/lib/supabase/channels'
import { MOCK_CHANNELS } from '@/lib/mock-data'
import { refreshAllChannelsAction } from '@/actions/channel-actions'
import { addNewsChannelAction, removeNewsChannelAction } from '@/actions/news-channel-actions'
import { useSummaryPreferences } from '@/hooks/useVideo'
import AppShell from '@/components/AppShell'
import { Settings, CheckCircle, AlertCircle, Plus, Trash2 } from 'lucide-react'

type ChannelStockMode = 'auto' | 'low_stock' | 'off'
type ChannelNewsMode = 'auto' | 'strict' | 'off'

export default function SettingsPage() {
  const { showSummary, updateShowSummary, enableTranscriptPipeline, updateEnableTranscriptPipeline } = useSummaryPreferences()

  const [channels, setChannels] = useState<Channel[]>([])
  const [newsChannels, setNewsChannels] = useState<NewsChannel[]>([])
  const [newsChannelInput, setNewsChannelInput] = useState('')
  const [newsChannelRegion, setNewsChannelRegion] = useState<'domestic' | 'overseas'>('domestic')
  const [isNewsChannelSaving, setIsNewsChannelSaving] = useState(false)
  const [newsChannelMessage, setNewsChannelMessage] = useState<string>('')
  const [savingStockModeIds, setSavingStockModeIds] = useState<Set<string>>(new Set())
  const [savingNewsModeIds, setSavingNewsModeIds] = useState<Set<string>>(new Set())
  const [transcriptProviderInfo, setTranscriptProviderInfo] = useState<{ name: string; available: boolean }>({ name: '...', available: false })
  const [summarizerInfo, setSummarizerInfo] = useState<{ name: string; available: boolean }>({ name: '...', available: false })
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>({
    lastRefreshed: null,
    nextRefresh: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    newVideoCount: 0,
  })
  const prevLastRefreshed = useRef<string | null>(null)

  useEffect(() => {
    loadChannels()
    loadNewsChannels()
    loadProviderInfo()
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
        const data = await channelRepository.getAll()
        setChannels(data)
      } else {
        setChannels(MOCK_CHANNELS)
      }
    } catch {
      setChannels(MOCK_CHANNELS)
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

  const loadProviderInfo = async () => {
    try {
      const res = await fetch('/api/provider-info')
      const data = await res.json()
      if (data.success) {
        setTranscriptProviderInfo(data.transcript)
        setSummarizerInfo(data.summarizer)
      }
    } catch (e) {
      console.error('Failed to fetch provider info', e)
    }
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

  const summarizerStatusText = (() => {
    const name = (summarizerInfo.name || '').toLowerCase()
    if (!summarizerInfo.available) {
      return '설명 기반 요약을 사용하고 있습니다. 항상 사용 가능합니다.'
    }
    if (name.includes('gemini')) {
      return 'Gemini API 기반 요약 엔진이 활성화되어 있습니다.'
    }
    if (name.includes('ollama')) {
      return '로컬 LLM(Ollama) 기반 요약 엔진이 활성화되어 있습니다.'
    }
    return '요약 엔진이 활성화되어 있습니다.'
  })()

  return (
    <AppShell
      channels={channels}
      onChannelAdded={loadChannels}
      nextRefresh={refreshStatus.nextRefresh}
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

        <div id="channel-stock-mode" className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 max-w-2xl scroll-mt-20">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">채널별 관련주 모드</h2>
          <p className="text-sm text-gray-500 mb-4">
            채널별로 관련주/기사 추천 강도를 직접 제어할 수 있습니다.
          </p>
          {channels.length === 0 ? (
            <p className="text-sm text-gray-400">등록된 채널이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {channels.map((channel) => {
                const stockMode = (channel.stock_mode || 'auto') as ChannelStockMode
                const newsMode = (channel.news_mode || 'auto') as ChannelNewsMode
                const isSavingStockMode = savingStockModeIds.has(channel.youtube_channel_id)
                const isSavingNewsMode = savingNewsModeIds.has(channel.youtube_channel_id)
                return (
                  <div key={channel.youtube_channel_id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                    {channel.thumbnail_url ? (
                      <img src={channel.thumbnail_url} alt={channel.title} className="w-8 h-8 rounded object-cover border border-gray-100" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-gray-100" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{channel.title}</p>
                      <p className="text-xs text-gray-400 truncate">{channel.handle || channel.youtube_channel_id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-gray-500">관련주 모드</label>
                        <select
                          value={stockMode}
                          onChange={(e) => void handleChannelStockModeChange(channel.youtube_channel_id, e.target.value as ChannelStockMode)}
                          disabled={isSavingStockMode}
                          className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-60 min-w-[108px]"
                        >
                          <option value="auto">auto</option>
                          <option value="low_stock">low_stock</option>
                          <option value="off">off</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-gray-500">기사 모드</label>
                        <select
                          value={newsMode}
                          onChange={(e) => void handleChannelNewsModeChange(channel.youtube_channel_id, e.target.value as ChannelNewsMode)}
                          disabled={isSavingNewsMode}
                          className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-60 min-w-[108px]"
                        >
                          <option value="auto">auto</option>
                          <option value="strict">strict</option>
                          <option value="off">off</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )
              })}
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

        {/* System information */}
        <div id="system-info" className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 scroll-mt-20">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">시스템 정보</h2>

          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">스크립트 공급자</h3>
              <div className={`flex items-start gap-4 p-4 rounded-lg border ${
                transcriptProviderInfo.available
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-200'
              }`}>
                {transcriptProviderInfo.available ? (
                  <CheckCircle size={24} className="text-green-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle size={24} className="text-gray-400 flex-shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-medium text-gray-900">{transcriptProviderInfo.name}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {transcriptProviderInfo.available
                      ? '스크립트 추출이 활성화되어 있습니다.'
                      : '스크립트 추출이 비활성화되어 있습니다. 설정 후 자동 요약이 더 나아질 수 있습니다.'}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">요약 엔진</h3>
              <div className={`flex items-start gap-4 p-4 rounded-lg border ${
                summarizerInfo.available
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-200'
              }`}>
                <CheckCircle size={24} className={`flex-shrink-0 mt-0.5 ${
                  summarizerInfo.available ? 'text-green-600' : 'text-gray-400'
                }`} />
                <div>
                  <p className="font-medium text-gray-900">{summarizerInfo.name}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {summarizerStatusText}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Environment setup */}
        <div id="environment-setup" className="bg-gray-50 border border-gray-200 rounded-2xl p-6 scroll-mt-20">
          <h2 className="text-lg font-bold text-gray-800 mb-3">환경 설정</h2>
          <div className="text-sm text-gray-600 space-y-2">
            <p>다음 환경 변수를 설정하여 모든 기능을 활성화하세요:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><code className="bg-white px-2 py-1 rounded border border-gray-200">NEXT_PUBLIC_YOUTUBE_API_KEY</code> - YouTube Data API v3 키</li>
              <li><code className="bg-white px-2 py-1 rounded border border-gray-200">NEXT_PUBLIC_SUPABASE_URL</code> - Supabase 프로젝트 URL</li>
              <li><code className="bg-white px-2 py-1 rounded border border-gray-200">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> - Supabase Anon 키</li>
            </ul>
            <p className="mt-4">
              <code className="bg-white px-2 py-1 rounded border border-gray-200">.env.local</code> 파일에 설정하거나 배포 플랫폼의 환경 변수 설정에서 입력하세요.
            </p>
          </div>
        </div>

        {/* Advanced configuration */}
        <div id="advanced-settings" className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 scroll-mt-20">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">고급 설정</h2>
          <p className="text-gray-500 mb-6">
            다음 기능들은 선택 사항이며, 추가 설정이 필요합니다:
          </p>

          <div className="space-y-4">
            <details className="border border-gray-200 rounded-lg p-4">
              <summary className="font-semibold text-gray-900 cursor-pointer hover:text-gray-600">
                📺 스크립트 추출 설정
              </summary>
              <div className="mt-4 text-sm text-gray-600 space-y-2">
                <p>동영상 스크립트를 자동으로 추출하려면 <code className="bg-gray-100 px-1 rounded">yt-dlp</code>를 설치하세요:</p>
                <pre className="bg-gray-100 p-3 rounded overflow-x-auto">pip install yt-dlp</pre>
                <p>설치 후 <code className="bg-gray-100 px-1 rounded">lib/transcript/transcript-provider.ts</code>에서 <code className="bg-gray-100 px-1 rounded">LocalTranscriptProvider</code>의 TODO 섹션을 구현하세요.</p>
              </div>
            </details>

            <details className="border border-gray-200 rounded-lg p-4">
              <summary className="font-semibold text-gray-900 cursor-pointer hover:text-gray-600">
                🤖 로컬 LLM 설정
              </summary>
              <div className="mt-4 text-sm text-gray-600 space-y-2">
                <p>Ollama를 사용하여 로컬에서 요약을 생성할 수 있습니다:</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li><a href="https://ollama.ai" className="text-gray-700 underline hover:text-gray-900">ollama.ai</a>에서 Ollama 설치</li>
                  <li><code className="bg-gray-100 px-1 rounded">ollama pull llama2</code> 또는 다른 모델 다운로드</li>
                  <li><code className="bg-gray-100 px-1 rounded">ollama serve</code>로 시작</li>
                </ol>
                <p>그 후 <code className="bg-gray-100 px-1 rounded">lib/summarization/local-summarizer.ts</code>에서 <code className="bg-gray-100 px-1 rounded">OllamaLocalSummarizer</code>의 TODO 섹션을 구현하세요.</p>
              </div>
            </details>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
