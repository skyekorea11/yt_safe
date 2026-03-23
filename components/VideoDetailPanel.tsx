'use client'

import { Heart, RefreshCw, ExternalLink } from 'lucide-react'
import { Video } from '@/types'
import { RelatedNewsItem, StockSuggestion, ChannelVideoItem } from '@/types/dashboard'

interface VideoDetailPanelProps {
  video: Video
  summaryLoadingVideoId: string | null
  summaryElapsedSeconds: number
  confirmedUnavailableIds: Set<string>
  favoriteIds: Set<string>
  togglingIds: Set<string>
  newsByVideoId: Record<string, RelatedNewsItem[]>
  stocksByVideoId: Record<string, StockSuggestion[]>
  newsLoadingVideoId: string | null
  newsErrorByVideoId: Record<string, string>
  externalChannelVideosById: Record<string, ChannelVideoItem[]>
  externalChannelVideoLoadingById: Record<string, boolean>
  externalChannelVideoErrorById: Record<string, string>
  relatedVideoRecommendationsById: Map<string, Video[]>
  isNewVideo: (video: Video) => boolean
  getChannelModes: (video: Video) => { stock: 'auto'; news: 'auto' | 'strict' | 'off' }
  getEmptyNewsMessage: (video: Video) => string
  formatPublishedDate: (value: string | null) => string
  onToggleFavorite: (videoId: string) => void
  onRefreshSummary: (videoId: string) => void
  onRefreshNews: (videoId: string, cacheKey: string, target: 'news') => void
  onRefreshRelatedVideos: (videoId: string) => void
}

export default function VideoDetailPanel({
  video,
  summaryLoadingVideoId,
  summaryElapsedSeconds,
  confirmedUnavailableIds,
  favoriteIds,
  togglingIds,
  newsByVideoId,
  newsLoadingVideoId,
  newsErrorByVideoId,
  externalChannelVideosById,
  externalChannelVideoLoadingById,
  externalChannelVideoErrorById,
  relatedVideoRecommendationsById,
  isNewVideo,
  getChannelModes,
  getEmptyNewsMessage,
  formatPublishedDate,
  onToggleFavorite,
  onRefreshSummary,
  onRefreshNews,
  onRefreshRelatedVideos,
}: VideoDetailPanelProps) {
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
    <div className="space-y-3.5">
      <div className="flex items-start justify-between gap-3 pb-1 border-b border-slate-100">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 leading-snug line-clamp-2 min-h-[3.5rem] break-keep">
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
        <div className="flex flex-col items-center justify-between self-stretch flex-shrink-0">
          <button
            onClick={() => onToggleFavorite(video.youtube_video_id)}
            disabled={togglingIds.has(video.youtube_video_id)}
            className="ui-btn ui-btn-icon disabled:opacity-50"
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
          {video.duration_seconds != null && (
            <span className="text-[11px] text-gray-400 font-medium">
              {(() => {
                const s = video.duration_seconds!
                const h = Math.floor(s / 3600)
                const m = Math.floor((s % 3600) / 60)
                const sec = s % 60
                if (h > 0) return `${h}시간 ${m}분 ${sec}초`
                if (m > 0 && sec > 0) return `${m}분 ${sec}초`
                if (m > 0) return `${m}분`
                return `${sec}초`
              })()}
            </span>
          )}
        </div>
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
          {summaryLoadingVideoId === video.youtube_video_id ? (
            <div className="space-y-1.5">
              <p className="ui-text-body text-gray-500 animate-pulse">
                {video.transcript_status === 'pending'
                  ? `자막 추출 중...`
                  : `요약 생성 중...`}
                {' '}
                <span className="font-medium text-gray-600">{Math.max(0, 60 - summaryElapsedSeconds)}초 남았습니다</span>
              </p>
              <p className="text-xs text-gray-400">
                {summaryElapsedSeconds < 1
                  ? ''
                  : summaryElapsedSeconds < 20
                  ? '🧘 기다리는 동안 기지개를 펴 보아요!'
                  : summaryElapsedSeconds < 40
                  ? '☕ 커피 한 모금 하고 오세요~'
                  : summaryElapsedSeconds < 55
                  ? '🏁 거의 다 됐어요! 조금만 더...'
                  : '🤔 흠...누군가 일을 제대로 하지 않네요. 다시 채찍질 해보겠습니다.'}
              </p>
            </div>
          ) : video.transcript_status === 'not_available' && video.summary_status !== null ? (
            <p className="ui-text-body text-gray-500">자막이 없으면 저는 일을 할수 없어요 😭</p>
          ) : video.transcript_status === 'failed' && confirmedUnavailableIds.has(video.youtube_video_id) ? (
            <p className="ui-text-body text-gray-500">자막이 없으면 저는 일을 할수 없어요 😭</p>
          ) : video.transcript_status === 'pending' && summaryLoadingVideoId === video.youtube_video_id ? (
            <p className="ui-text-body text-gray-500 animate-pulse">자막 추출 중...</p>
          ) : video.transcript_status === 'failed' && video.summary_status !== null ? (
            <p className="ui-text-body text-gray-500">자막을 가져오지 못했습니다. 다시 시도해 주세요.</p>
          ) : video.summary_status === 'failed' && video.summary_text ? (
            <p className="ui-text-body text-gray-600">{video.summary_text}</p>
          ) : video.summary_status === 'complete' && video.summary_text ? (
            (() => {
              const lines = video.summary_text.split('\n').map(l => l.trim()).filter(Boolean)
              const isBullet = lines.length >= 2
              return isBullet ? (
                <ul className="space-y-2">
                  {lines.map((l, i) => (
                    <li key={i} className="flex gap-2 ui-text-body text-gray-700 leading-snug">
                      <span className="shrink-0 mt-0.5 text-gray-400">✦</span>
                      <span className="break-keep">{l.replace(/^[✦•\-*]\s*/, '')}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ui-text-body text-gray-700 whitespace-pre-line leading-relaxed">
                  {video.summary_text}
                </p>
              )
            })()
          ) : (
            <p className="ui-text-body text-gray-500">아직 요약이 없습니다</p>
          )}
        </div>

        <div className="flex">
          <button
            onClick={() => onRefreshSummary(video.youtube_video_id)}
            disabled={summaryLoadingVideoId === video.youtube_video_id || (video.transcript_status === 'not_available' && video.summary_status !== null) || confirmedUnavailableIds.has(video.youtube_video_id) || (video.summary_status === 'complete' && !!video.summary_text && video.transcript_status !== 'failed' && video.transcript_status !== 'not_available')}
            className="tone-primary-btn ui-btn disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {summaryLoadingVideoId === video.youtube_video_id
              ? video.transcript_status === 'pending'
                ? '자막 추출 중...'
                : '요약 생성 중...'
              : video.summary_status === 'complete' && !!video.summary_text
              ? '요약 완료'
              : (video.transcript_status === 'failed' || video.transcript_status === 'not_available' || video.summary_status === 'failed') && video.summary_status !== null
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
                  onRefreshNews(video.youtube_video_id, cacheKey, 'news')
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
              onClick={() => onRefreshRelatedVideos(video.youtube_video_id)}
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
    </div>
  )
}
