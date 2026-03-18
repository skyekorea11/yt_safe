'use client'

/**
 * VideoCard component - displays a single video with metadata and interactions
 */

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Heart, MessageSquare, ExternalLink, RefreshCw, Download, Sparkles } from 'lucide-react'
import { Video } from '@/types'
import { useVideoFavorite, useVideoNote } from '@/hooks/useVideo'
import { cn } from '@/lib/utils'
import NoteDrawer from './NoteDrawer'
import { extractTranscriptAction, generateSummaryAction } from '@/actions/channel-actions'

interface VideoCardProps {
  video: Video
  showSummary?: boolean
  onRefreshSummary?: (videoId: string) => Promise<void>
  onVideoUpdated?: (updatedVideo: Video) => void
}

export default function VideoCard({
  video,
  showSummary = true,
  onRefreshSummary,
  onVideoUpdated,
}: VideoCardProps) {
  const { isFavorite, toggleFavorite, isLoading: isFavLoading } = useVideoFavorite(video.youtube_video_id)
  const { note, saveNote, isOpen, setIsOpen } = useVideoNote(video.youtube_video_id)
  const [isRefreshingSummary, setIsRefreshingSummary] = useState(false)
  const [isExtractingTranscript, setIsExtractingTranscript] = useState(false)
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)
  const [localVideo, setLocalVideo] = useState<Video>(video)

  const handleExtractTranscript = async () => {
    setIsExtractingTranscript(true)
    try {
      const result = await extractTranscriptAction(localVideo.youtube_video_id)
      if (result.success) {
        // Update local state
        setLocalVideo({
          ...localVideo,
          transcript_text: result.transcript || '',
          transcript_status: result.status as Video['transcript_status'],
        })
        onVideoUpdated?.({
          ...localVideo,
          transcript_text: result.transcript || '',
          transcript_status: result.status as Video['transcript_status'],
        })
      }
    } finally {
      setIsExtractingTranscript(false)
    }
  }

  const handleGenerateSummary = async () => {
    setIsGeneratingSummary(true)
    try {
      const result = await generateSummaryAction(localVideo.youtube_video_id)
      if (result.success) {
        setLocalVideo({
          ...localVideo,
          summary_text: result.summary || '',
          summary_status: result.status as Video['summary_status'],
          summary_source_type: 'transcript',
        })
        onVideoUpdated?.({
          ...localVideo,
          summary_text: result.summary || '',
          summary_status: result.status as Video['summary_status'],
          summary_source_type: 'transcript',
        })
      }
    } finally {
      setIsGeneratingSummary(false)
    }
  }

  const handleRefreshSummary = async () => {
    if (!onRefreshSummary) return
    setIsRefreshingSummary(true)
    try {
      await onRefreshSummary(localVideo.youtube_video_id)
    } finally {
      setIsRefreshingSummary(false)
    }
  }

  // Format published date
  const publishedDate = new Date(localVideo.published_at).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <>
      <div className="group bg-white rounded-2xl shadow-sm hover:shadow-lg transition-shadow duration-300 overflow-hidden border border-gray-100">
        {/* Thumbnail */}
        <div className="relative w-full aspect-video bg-gray-200 overflow-hidden">
          <Image
            src={video.thumbnail_url}
            alt={video.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />

          {/* Duration badge */}
          {video.duration_text && (
            <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-semibold px-2 py-1 rounded">
              {video.duration_text}
            </div>
          )}

          {/* Summary/transcript status badge */}
          {(() => {
            let label = ''
            let bgColor = ''
            let textColor = ''

            if (localVideo.transcript_status === 'pending') {
              label = '자막 추출중'
              bgColor = 'bg-yellow-100'
              textColor = 'text-yellow-700'
            } 
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore: status type may include 'not_available' at runtime
            else if (localVideo.transcript_status === 'not_available') {
              label = '자막 없음'
              bgColor = 'bg-gray-100'
              textColor = 'text-gray-700'
            } else if (localVideo.transcript_status === 'failed') {
              label = '자막 실패'
              bgColor = 'bg-red-100'
              textColor = 'text-red-700'
            } else if (localVideo.summary_status === 'pending') {
              label = '요약 생성중'
              bgColor = 'bg-blue-100'
              textColor = 'text-blue-700'
            } else if (localVideo.summary_status === 'failed') {
              label = '요약 실패'
              bgColor = 'bg-red-100'
              textColor = 'text-red-700'
            } else if (localVideo.summary_source_type === 'transcript') {
              label = '요약 완료'
              bgColor = 'bg-green-100'
              textColor = 'text-green-700'
            } else if (localVideo.summary_source_type === 'description') {
              label = '설명 사용'
              bgColor = 'bg-orange-100'
              textColor = 'text-orange-700'
            }

            if (label) {
              return (
                <div className={`absolute top-2 left-2 text-xs font-medium px-2 py-1 rounded-full ${bgColor} ${textColor}`}>
                  {label}
                </div>
              )
            }
            return null
          })()}
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col h-full">
          {/* Channel name */}
          <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">
            {video.channel_title}
          </div>

          {/* Title */}
          <h3 className="text-base font-semibold text-gray-900 mb-3 line-clamp-2 leading-snug">
            {video.title}
          </h3>

          {/* Published date */}
          <div className="text-sm text-gray-400 mb-3">{publishedDate}</div>

          {/* Summary / status message area */}
          {showSummary && (
            <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              {video.summary_text ? (
                (() => {
                  const lines = video.summary_text
                    .split('\n')
                    .map(l => l.trim())
                    .filter(Boolean)
                  const bullets = lines.filter(l => /^[•\-*▸✦]/.test(l))
                  // Also treat as bullets if every non-empty line starts with a bullet char
                  const isBulletList = bullets.length >= 2 || (lines.length >= 2 && lines.every(l => /^[•\-*▸✦]/.test(l)))
                  return isBulletList ? (
                    <ul className="space-y-1.5">
                      {bullets.map((b, i) => (
                        <li key={i} className="flex gap-2 text-sm text-gray-700 leading-snug">
                          <span className="text-gray-400 mt-0.5 shrink-0">✦</span>
                          <span>{b.replace(/^[•\-*▸✦]\s*/, '')}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-700 leading-relaxed">{video.summary_text}</p>
                  )
                })()
              ) : video.transcript_status === 'pending' ? (
                <p className="text-sm text-gray-500">자막을 가져오는 중...</p>
              ) : video.transcript_status === 'failed' ? (
                <p className="text-sm text-gray-500">자막을 가져오지 못했습니다</p>
              ) : video.summary_status === 'pending' ? (
                <p className="text-sm text-gray-500">요약 생성 중...</p>
              ) : video.summary_status === 'failed' ? (
                <p className="text-sm text-gray-500">요약을 생성할 수 없습니다</p>
              ) : (
                <p className="text-sm text-gray-500">요약 없음</p>
              )}
            </div>
          )}

          {/* Actions row */}
          <div className="flex items-center gap-2 mt-auto pt-3 border-t border-gray-100">
            {/* Extract transcript button */}
            {!localVideo.transcript_text && localVideo.transcript_status !== 'pending' && (
              <button
                onClick={handleExtractTranscript}
                disabled={isExtractingTranscript}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="자막 추출"
              >
                <Download
                  size={20}
                  className={isExtractingTranscript ? 'animate-spin' : ''}
                />
              </button>
            )}

            {/* Generate summary button */}
            {localVideo.transcript_text && !localVideo.summary_text && localVideo.summary_status !== 'pending' && (
              <button
                onClick={handleGenerateSummary}
                disabled={isGeneratingSummary}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="요약 생성"
              >
                <Sparkles
                  size={20}
                  className={isGeneratingSummary ? 'animate-pulse' : ''}
                />
              </button>
            )}

            {/* Favorite button */}
            <button
              onClick={toggleFavorite}
              disabled={isFavLoading}
              className={cn(
                'p-2 rounded-lg transition-colors',
                isFavorite
                  ? 'text-red-500 bg-red-50'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              )}
              title={isFavorite ? '즐겨찾기 제거' : '즐겨찾기 추가'}
            >
              <Heart
                size={20}
                className={isFavorite ? 'fill-current' : ''}
              />
            </button>

            {/* Note button */}
            <button
              onClick={() => setIsOpen(true)}
              className={cn(
                'p-2 rounded-lg transition-colors',
                note
                  ? 'text-blue-500 bg-blue-50'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              )}
              title="메모 추가"
            >
              <MessageSquare size={20} />
            </button>

            {/* Refresh summary button */}
            {onRefreshSummary && localVideo.summary_text && (
              <button
                onClick={handleRefreshSummary}
                disabled={isRefreshingSummary}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="요약 새로고침"
              >
                <RefreshCw
                  size={20}
                  className={isRefreshingSummary ? 'animate-spin' : ''}
                />
              </button>
            )}

            {/* YouTube link */}
            <Link
              href={localVideo.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="YouTube에서 보기"
            >
              <ExternalLink size={20} />
            </Link>
          </div>
        </div>
      </div>

      {/* Note drawer */}
      <NoteDrawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        note={note}
        onSave={saveNote}
        videoTitle={localVideo.title}
      />
    </>
  )
}
