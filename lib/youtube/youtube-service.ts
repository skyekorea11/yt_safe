import { YouTubeChannel, YouTubeVideo, YouTubePlaylistItem } from '@/types'

/**
 * YouTube Data API v3 service
 * Handles interactions with YouTube's public API
 * 
 * Environment variable required:
 * - NEXT_PUBLIC_YOUTUBE_API_KEY: Your YouTube Data API v3 key
 */

const API_KEY = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY
const BASE_URL = 'https://www.googleapis.com/youtube/v3'

interface YouTubeErrorResponse {
  error: {
    code: number
    message: string
  }
}

/**
 * YouTube service for channel and video operations
 */
export const youtubeService = {
  /**
   * 수집 단계 필터
   * True: 분석 포함 / False: 제외
   */
  isValidVideo(title: string, duration: number, hasCaption: boolean): boolean {
    const blockedKeywords = ['#shorts', '#라이브', '#live']
    const normalizedTitle = title.toLowerCase()
    const hasBlockedKeyword = blockedKeywords.some((kw) => normalizedTitle.includes(kw))

    if (hasBlockedKeyword) return false
    if (!hasCaption) return false
    if (duration <= 60) return false
    return true
  },

  // 요청 사양 함수명(alias)
  is_valid_video(title: string, duration: number, has_caption: boolean): boolean {
    return this.isValidVideo(title, duration, has_caption)
  },

  /**
   * Resolve a YouTube channel by:
   * - Channel ID
   * - Channel handle (@handle)
   * - Channel URL
   * 
   * Returns the channel object with uploads playlist ID
   */
  async resolveChannel(identifier: string): Promise<YouTubeChannel | null> {
    if (!API_KEY) {
      console.warn('NEXT_PUBLIC_YOUTUBE_API_KEY not set')
      return null
    }

    try {
      // Try to determine the type of identifier and fetch accordingly
      let url = `${BASE_URL}/channels?key=${API_KEY}&part=snippet,contentDetails`

      if (identifier.startsWith('UC') && identifier.length === 24) {
        // Looks like a channel ID
        url += `&id=${identifier}`
      } else if (identifier.startsWith('@')) {
        // Handle format (@channelname)
        url += `&forHandle=${identifier.slice(1)}`
      } else if (identifier.includes('youtube.com') || identifier.includes('youtu.be')) {
        // URL format - extract channel ID
        const channelId = this.extractChannelIdFromUrl(identifier)
        if (channelId) {
          url += `&id=${channelId}`
        } else {
          console.error('Could not extract channel ID from URL')
          return null
        }
      } else if (identifier.length === 24) {
        // Assume it's a channel ID
        url += `&id=${identifier}`
      } else {
        // Try as handle without @
        url += `&forHandle=${identifier}`
      }

      const response = await fetch(url)
      const data = (await response.json()) as { items?: YouTubeChannel[] } | YouTubeErrorResponse

      if ('error' in data) {
        console.error('YouTube API error:', data.error)
        return null
      }

      if (!data.items || data.items.length === 0) {
        console.error('Channel not found')
        return null
      }

      return data.items[0]
    } catch (error) {
      console.error('Error resolving channel:', error)
      return null
    }
  },

  /**
   * Get the uploads playlist ID for a channel
   * This is fetched from the channel's contentDetails
   */
  async getUploadsPlaylistId(channelId: string): Promise<string | null> {
    if (!API_KEY) {
      console.warn('NEXT_PUBLIC_YOUTUBE_API_KEY not set')
      return null
    }

    try {
      const url = `${BASE_URL}/channels?key=${API_KEY}&id=${channelId}&part=contentDetails`
      const response = await fetch(url)
      const data = (await response.json()) as { items?: YouTubeChannel[] } | YouTubeErrorResponse

      if ('error' in data) {
        console.error('YouTube API error:', data.error)
        return null
      }

      if (!data.items || data.items.length === 0) {
        console.error('Channel not found')
        return null
      }

      return data.items[0].contentDetails?.relatedPlaylists.uploads || null
    } catch (error) {
      console.error('Error getting uploads playlist ID:', error)
      return null
    }
  },

  /**
   * Get latest videos for a channel (excluding Shorts)
   * Fetches from the channel's uploads playlist
   * Filters out videos shorter than 60 seconds (typical Shorts duration)
   */
  async getLatestVideosForChannel(
    channelId: string,
    maxResults = 5,
    options?: { allowCaptionlessFallback?: boolean; allowLiveKeyword?: boolean }
  ): Promise<YouTubePlaylistItem[]> {
    if (!API_KEY) {
      console.warn('NEXT_PUBLIC_YOUTUBE_API_KEY not set')
      return []
    }

    try {
      // Get the uploads playlist ID
      const uploadsPlaylistId = await this.getUploadsPlaylistId(channelId)
      if (!uploadsPlaylistId) {
        console.error('Could not get uploads playlist ID')
        return []
      }

      // Get more raw rows to survive strict filtering.
      const fetchCount = Math.min(50, Math.max(maxResults * 6, 20))
      const url = `${BASE_URL}/playlistItems?key=${API_KEY}&playlistId=${uploadsPlaylistId}&part=snippet,contentDetails&maxResults=${fetchCount}&order=date`
      const response = await fetch(url)
      const data = (await response.json()) as { items?: YouTubePlaylistItem[] } | YouTubeErrorResponse

      if ('error' in data) {
        console.error('YouTube API error:', data.error)
        return []
      }

      const playlistItems = data.items || []

      // Extract video IDs and fetch detailed metadata
      const videoIds = playlistItems.map((item) => item.snippet.resourceId.videoId)
      const videoDetails = await this.getVideoDetails(videoIds)

      // 수집 단계 strict 필터:
      // 1) #shorts / #live / #라이브 포함 제외
      // 2) 자막 없는 영상 제외
      // 3) 60초 이하 제외
      const strictFiltered = playlistItems.filter((item) => {
        const videoId = item.snippet.resourceId.videoId
        const videoDetail = videoDetails.find((v) => v.id === videoId)

        if (!videoDetail?.contentDetails?.duration) {
          return false
        }

        const normalizedTitle = (item.snippet.title || '').toLowerCase()
        const blockedKeywords = options?.allowLiveKeyword
          ? ['#shorts']
          : ['#shorts', '#라이브', '#live']
        const hasBlockedKeyword = blockedKeywords.some((kw) => normalizedTitle.includes(kw))
        if (hasBlockedKeyword) return false

        const durationSeconds = this.parseDurationToSeconds(videoDetail.contentDetails.duration)
        if (durationSeconds <= 60) return false
        const hasCaption = videoDetail.status?.caption === 'true'
        return hasCaption
      })

      if (strictFiltered.length > 0 || !options?.allowCaptionlessFallback) {
        return strictFiltered.slice(0, maxResults)
      }

      // onboarding fallback:
      // strict 조건(자막 필수)으로 0건일 때만, 제목/길이 기준으로 완화해서 채널 등록 실패를 방지
      const blockedKeywords = options?.allowLiveKeyword
        ? ['#shorts']
        : ['#shorts', '#라이브', '#live']
      const relaxedFiltered = playlistItems.filter((item) => {
        const videoId = item.snippet.resourceId.videoId
        const videoDetail = videoDetails.find((v) => v.id === videoId)
        if (!videoDetail?.contentDetails?.duration) return false

        const normalizedTitle = (item.snippet.title || '').toLowerCase()
        const hasBlockedKeyword = blockedKeywords.some((kw) => normalizedTitle.includes(kw))
        if (hasBlockedKeyword) return false

        const durationSeconds = this.parseDurationToSeconds(videoDetail.contentDetails.duration)
        return durationSeconds > 60
      })

      return relaxedFiltered.slice(0, maxResults)
    } catch (error) {
      console.error('Error getting videos for channel:', error)
      return []
    }
  },

  /**
   * Get detailed information for multiple videos
   * Includes duration information
   */
  async getVideoDetails(videoIds: string[]): Promise<YouTubeVideo[]> {
    if (!API_KEY) {
      console.warn('NEXT_PUBLIC_YOUTUBE_API_KEY not set')
      return []
    }

    if (videoIds.length === 0) {
      return []
    }

    try {
      const url = `${BASE_URL}/videos?key=${API_KEY}&id=${videoIds.join(',')}&part=snippet,contentDetails,status,statistics`
      const response = await fetch(url)
      const data = (await response.json()) as { items?: YouTubeVideo[] } | YouTubeErrorResponse

      if ('error' in data) {
        console.error('YouTube API error:', data.error)
        return []
      }

      return data.items || []
    } catch (error) {
      console.error('Error getting video details:', error)
      return []
    }
  },

  /**
   * Helper: Parse ISO 8601 duration to seconds
   * e.g., PT1H30M45S -> 5445
   */
  parseDurationToSeconds(isoDuration: string): number {
    const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/
    const matches = isoDuration.match(regex)

    if (!matches) return 0

    const hours = parseInt(matches[1] || '0', 10)
    const minutes = parseInt(matches[2] || '0', 10)
    const seconds = parseInt(matches[3] || '0', 10)

    return hours * 3600 + minutes * 60 + seconds
  },

  /**
   * Attempt to extract a channel ID from various YouTube URL formats.
   * Returns the ID or handle/name for resolution, or null if unrecognized.
   */
  extractChannelIdFromUrl(url: string): string | null {
    try {
      const parsedUrl = new URL(url)
      const pathname = parsedUrl.pathname

      // Check for /channel/ID format
      if (pathname.startsWith('/channel/')) {
        return pathname.split('/')[2]
      }

      // Check for /@handle or /c/name format
      if (pathname.startsWith('/@') || pathname.startsWith('/c/')) {
        // For these formats, we'd need to resolve them separately
        // Return the handle/name for resolution via API
        return pathname.split('/')[1]
      }

      // Return null if format is not recognized
      return null
    } catch {
      return null
    }
  },

  /**
   * Format duration text from ISO 8601 duration
   * e.g., PT1H30M45S -> 1:30:45
   */
  formatDuration(isoDuration: string): string {
    const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/
    const matches = isoDuration.match(regex)

    if (!matches) return '0:00'

    const hours = parseInt(matches[1] || '0', 10)
    const minutes = parseInt(matches[2] || '0', 10)
    const seconds = parseInt(matches[3] || '0', 10)

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`
  },
}
