'use server'

/**
 * Server actions for YouTube Digest backend operations
 * These run on the server and can safely use API keys and database credentials
 */

import { youtubeService } from '@/lib/youtube/youtube-service'
import { channelRepository, channelSubscriptionRepository } from '@/lib/supabase/channels'
import { videoRepository } from '@/lib/supabase/videos'
import { summaryService } from '@/lib/summarization/summary-service'
import { getTranscriptProvider } from '@/lib/transcript/transcript-provider'
import { markRefreshDone } from '@/lib/scheduler/refresh-state'
import { getLocalSummarizer } from '@/lib/summarization/local-summarizer'
import { Channel, Video } from '@/types'

/**
 * Add a YouTube channel by URL, handle, or channel ID
 * Fetches channel metadata and latest videos
 * Stores everything in Supabase
 */
export async function addChannelAction(identifier: string): Promise<{
  success: boolean
  channel?: Channel
  videos?: Video[]
  error?: string
}> {
  try {
    // Resolve the channel
    const youtubeChannel = await youtubeService.resolveChannel(identifier)

    if (!youtubeChannel) {
      return { success: false, error: 'Could not resolve YouTube channel. Check the URL, @handle, or channel ID.' }
    }

    const channelId = youtubeChannel.id
    const uploadsPlaylistId = youtubeChannel.contentDetails?.relatedPlaylists.uploads

    if (!uploadsPlaylistId) {
      return { success: false, error: 'Could not find uploads playlist for this channel.' }
    }

    // Fetch latest videos
    const playlistItems = await youtubeService.getLatestVideosForChannel(channelId, 5, {
      allowCaptionlessFallback: true,
    })

    if (playlistItems.length === 0) {
      return { success: false, error: 'No videos found for this channel.' }
    }

    // Extract video IDs and fetch detailed metadata
    const videoIds = playlistItems.map((item) => item.snippet.resourceId.videoId)
    const videoDetails = await youtubeService.getVideoDetails(videoIds)

    // Upsert channel to database
    const channel = await channelRepository.upsert({
      youtube_channel_id: channelId,
      title: youtubeChannel.snippet.title,
      handle: youtubeChannel.snippet.customUrl || '',
      description: youtubeChannel.snippet.description,
      thumbnail_url: youtubeChannel.snippet.thumbnails.high?.url || youtubeChannel.snippet.thumbnails.medium?.url || '',
      uploads_playlist_id: uploadsPlaylistId,
    })

    if (!channel) {
      return { success: false, error: 'Failed to save channel to database.' }
    }

    // Upsert videos to database
    const savedVideos: Video[] = []

    for (const item of playlistItems) {
      const videoId = item.snippet.resourceId.videoId
      const videoDetail = videoDetails.find((v) => v.id === videoId)

      const video = await videoRepository.upsert({
        youtube_video_id: videoId,
        youtube_channel_id: channelId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail_url: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url || '',
        published_at: item.snippet.publishedAt,
        duration_text: videoDetail?.contentDetails?.duration ? youtubeService.formatDuration(videoDetail.contentDetails.duration) : undefined,
        duration_seconds: videoDetail?.contentDetails?.duration
          ? parseDurationToSeconds(videoDetail.contentDetails.duration)
          : undefined,
        like_count: videoDetail?.statistics?.likeCount
          ? Number(videoDetail.statistics.likeCount)
          : undefined,
        video_url: `https://www.youtube.com/watch?v=${videoId}`,
      })

      if (video) {
        savedVideos.push(video)
      }
    }

    // Add to subscriptions
    await channelSubscriptionRepository.add(channelId)

    return {
      success: true,
      channel,
      videos: savedVideos,
    }
  } catch (error) {
    console.error('Error adding channel:', error)
    return { success: false, error: 'An unexpected error occurred. Please check your API key and try again.' }
  }
}

/**
 * Remove a channel and all its videos
 */
export async function removeChannelAction(youtubeChannelId: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    // 채널 삭제 시 FK CASCADE로 videos, channel_subscriptions_demo,
    // video_notes, video_favorites 모두 자동 삭제됨
    await channelRepository.deleteByYouTubeId(youtubeChannelId)

    return { success: true }
  } catch (error) {
    console.error('Error removing channel:', error)
    return { success: false, error: 'Failed to remove channel.' }
  }
}

/**
 * Refresh videos for a specific channel
 * Fetches latest videos and updates database
 */
export async function refreshChannelVideosAction(youtubeChannelId: string): Promise<{
  success: boolean
  videos?: Video[]
  error?: string
}> {
  try {
    // Fetch latest videos
    const playlistItems = await youtubeService.getLatestVideosForChannel(youtubeChannelId, 5, {
      allowCaptionlessFallback: true,
    })

    if (playlistItems.length === 0) {
      return { success: false, error: 'No videos found for this channel.' }
    }

    // Extract video IDs and fetch detailed metadata
    const videoIds = playlistItems.map((item) => item.snippet.resourceId.videoId)
    const videoDetails = await youtubeService.getVideoDetails(videoIds)

    // Upsert videos to database
    const savedVideos: Video[] = []

    for (const item of playlistItems) {
      const videoId = item.snippet.resourceId.videoId
      const videoDetail = videoDetails.find((v) => v.id === videoId)

      const video = await videoRepository.upsert({
        youtube_video_id: videoId,
        youtube_channel_id: youtubeChannelId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail_url: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url || '',
        published_at: item.snippet.publishedAt,
        duration_text: videoDetail?.contentDetails?.duration ? youtubeService.formatDuration(videoDetail.contentDetails.duration) : undefined,
        duration_seconds: videoDetail?.contentDetails?.duration
          ? parseDurationToSeconds(videoDetail.contentDetails.duration)
          : undefined,
        like_count: videoDetail?.statistics?.likeCount
          ? Number(videoDetail.statistics.likeCount)
          : undefined,
        video_url: `https://www.youtube.com/watch?v=${videoId}`,
      })

      if (video) {
        savedVideos.push(video)
      }
    }

    return { success: true, videos: savedVideos }
  } catch (error) {
    console.error('Error refreshing channel videos:', error)
    return { success: false, error: 'Failed to refresh videos.' }
  }
}

/**
 * Refresh summary for a video
 * Forces re-summarization using latest summary service
 */
export async function refreshVideoSummaryAction(
  videoId: string,
  title: string,
  description: string,
  useTranscriptPipeline = true
): Promise<{
  success: boolean
  summary?: { text: string; sourceType: 'transcript' | 'description' | 'external' }
  video?: Video | null
  error?: string
}> {
  try {
    const summary = await summaryService.generateNewSummary(
      videoId,
      title,
      description,
      useTranscriptPipeline
    )

    const updatedVideo = await videoRepository.getByYouTubeId(videoId)

    if (!summary) {
      return { success: false, video: updatedVideo, error: 'Failed to generate summary.' }
    }

    return { success: true, summary, video: updatedVideo }
  } catch (error) {
    console.error('Error refreshing summary:', error)
    const updatedVideo = await videoRepository.getByYouTubeId(videoId)
    return { success: false, video: updatedVideo, error: 'Failed to refresh summary.' }
  }
}

/**
 * Get summary for a video (calls getSummary on the server side)
 * This allows transcript fetching to work without CORS issues
 */
export async function getSummaryAction(
  videoId: string,
  title: string,
  description: string,
  useTranscriptPipeline = true
): Promise<{
  success: boolean
  summary?: { text: string; sourceType: 'transcript' | 'description' | 'external' }
  error?: string
}> {
  try {
    const summary = await summaryService.getSummary(
      videoId,
      title,
      description,
      useTranscriptPipeline
    )

    if (!summary) {
      return { success: false, error: 'Failed to get summary.' }
    }

    return { success: true, summary }
  } catch (error) {
    console.error('Error getting summary:', error)
    return { success: false, error: 'Failed to get summary.' }
  }
}

/**
 * Extract transcript for a video
 */
export async function extractTranscriptAction(videoId: string): Promise<{
  success: boolean
  transcript?: string
  status?: string
  error?: string
}> {
  try {
    const transcriptProvider = getTranscriptProvider()

    if (!transcriptProvider.isAvailable()) {
      return { success: false, error: 'Transcript provider not available' }
    }

    // Mark as pending
    await videoRepository.updateTranscript(videoId, '', 'pending')

    // Fetch transcript
    const result = await transcriptProvider.fetchTranscript(videoId)

    if (result.status === 'READY' && result.text) {
      await videoRepository.updateTranscript(videoId, result.text, 'extracted')
      return { success: true, transcript: result.text, status: 'extracted' }
    } else if (result.status === 'NOT_AVAILABLE') {
      await videoRepository.updateTranscript(videoId, '', 'not_available')
      return { success: false, error: 'No transcript available', status: 'not_available' }
    } else {
      await videoRepository.updateTranscript(videoId, '', 'failed')
      return { success: false, error: result.error || 'Failed to fetch transcript', status: 'failed' }
    }
  } catch (error) {
    console.error('Error extracting transcript:', error)
    return { success: false, error: 'Failed to extract transcript' }
  }
}

/**
 * Generate summary from transcript
 */
export async function generateSummaryAction(videoId: string): Promise<{
  success: boolean
  summary?: string
  status?: string
  error?: string
}> {
  try {
    const video = await videoRepository.getByYouTubeId(videoId)

    if (!video) {
      return { success: false, error: 'Video not found' }
    }

    if (!video.transcript_text) {
      return { success: false, error: 'No transcript available for summarization' }
    }

    // 이미 완료된 요약이 있으면 재호출하지 않음
    if (video.summary_status === 'complete' && video.summary_text) {
      return { success: true, summary: video.summary_text, status: 'complete' }
    }

    const result = await summaryService.generateTranscriptSummary(videoId, video.transcript_text)
    if (!result || result.text === '요약을 생성할 수 없습니다') {
      // Gemini 실패 시 description fallback
      if (video.description) {
        const summarizer = getLocalSummarizer()
        const desc = await summarizer.summarize(video.description, 200)
        if (desc) {
          await videoRepository.updateSummary(videoId, desc, 'description', 'complete')
          return { success: true, summary: desc, status: 'complete' }
        }
      }
      return { success: false, error: 'Failed to generate summary', status: 'failed' }
    }
    return { success: true, summary: result.text, status: 'complete' }
  } catch (error) {
    console.error('Error generating summary:', error)
    return { success: false, error: 'Failed to generate summary' }
  }
}

/**
 * Refresh all channels and delete videos older than 7 days (excluding favorites)
 */
export async function refreshAllChannelsAction(): Promise<{
  success: boolean
  refreshed: number
  deleted: number
  newCount: number
  error?: string
}> {
  try {
    const channels = await channelRepository.getAll()

    // 기존 video ID 스냅샷
    const existingVideos = await videoRepository.getAll()
    const existingIds = new Set(existingVideos.map(v => v.youtube_video_id))

    let refreshed = 0
    const allSavedIds: string[] = []

    for (const channel of channels) {
      const result = await refreshChannelVideosAction(channel.youtube_channel_id)
      if (result.success && result.videos) {
        refreshed += result.videos.length
        allSavedIds.push(...result.videos.map(v => v.youtube_video_id))
      }
    }

    const newCount = allSavedIds.filter(id => !existingIds.has(id)).length
    const deleted = await videoRepository.deleteOlderThan(7)

    markRefreshDone(newCount)

    return { success: true, refreshed, deleted, newCount }
  } catch (error) {
    console.error('Error refreshing all channels:', error)
    return { success: false, refreshed: 0, deleted: 0, newCount: 0, error: 'Failed to refresh channels.' }
  }
}

/**
 * Helper: Convert ISO 8601 duration to seconds
 * e.g., PT1H30M45S -> 5445
 */
function parseDurationToSeconds(isoDuration: string): number {
  const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/
  const matches = isoDuration.match(regex)

  if (!matches) return 0

  const hours = parseInt(matches[1] || '0', 10)
  const minutes = parseInt(matches[2] || '0', 10)
  const seconds = parseInt(matches[3] || '0', 10)

  return hours * 3600 + minutes * 60 + seconds
}
