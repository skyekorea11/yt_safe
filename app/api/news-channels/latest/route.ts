import { NextResponse } from 'next/server'
import { newsChannelRepository } from '@/lib/supabase/channels'
import { youtubeService } from '@/lib/youtube/youtube-service'
import { logger } from '@/lib/logger'

interface LatestNewsTitle {
  youtubeVideoId: string
  title: string
  channelTitle: string
  publishedAt: string
  videoUrl: string
}

const CACHE_TTL_MS = 5 * 60 * 1000
let latestCache: { at: number; domesticItems: LatestNewsTitle[]; overseasItems: LatestNewsTitle[] } | null = null

async function fetchLatestFromYouTube(channelIds: string[], limit = 10): Promise<LatestNewsTitle[]> {
  if (channelIds.length === 0) return []
  const collected: LatestNewsTitle[] = []
  const perChannel = Math.max(5, Math.ceil((limit * 2) / channelIds.length))
  for (const channelId of channelIds) {
    const playlistItems = await youtubeService.getLatestVideosForChannel(channelId, perChannel, {
      allowCaptionlessFallback: true,
      allowLiveKeyword: true,
    })
    for (const item of playlistItems) {
      collected.push({
        youtubeVideoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle || channelId,
        publishedAt: item.snippet.publishedAt,
        videoUrl: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
      })
    }
  }
  const deduped = new Map<string, LatestNewsTitle>()
  for (const item of collected) {
    if (!deduped.has(item.youtubeVideoId)) deduped.set(item.youtubeVideoId, item)
  }
  return [...deduped.values()]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit)
}

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const searchParams = new URL(request.url).searchParams
    const refresh = searchParams.get('refresh') === 'true'

    const channels = await newsChannelRepository.getAll()
    if (channels.length === 0) {
      return NextResponse.json({
        success: true,
        refreshedCount: 0,
        channelCount: 0,
        domesticItems: [],
        overseasItems: [],
      })
    }

    const useCache = !refresh && latestCache && (Date.now() - latestCache.at) < CACHE_TTL_MS
    const domesticChannelIds = channels.filter(c => c.region === 'domestic').map(c => c.youtube_channel_id)
    const overseasChannelIds = channels.filter(c => c.region === 'overseas').map(c => c.youtube_channel_id)

    const domesticItems = useCache
      ? latestCache!.domesticItems
      : await fetchLatestFromYouTube(domesticChannelIds, 10)
    const overseasItems = useCache
      ? latestCache!.overseasItems
      : await fetchLatestFromYouTube(overseasChannelIds, 10)
    latestCache = { at: Date.now(), domesticItems, overseasItems }

    return NextResponse.json({
      success: true,
      refreshedCount: refresh ? (domesticItems.length + overseasItems.length) : 0,
      channelCount: channels.length,
      domesticItems,
      overseasItems,
    })
  } catch (error) {
    logger.error('Error fetching news channel titles:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch news channel titles' },
      { status: 500 }
    )
  }
}
