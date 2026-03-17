import { NextResponse } from 'next/server'
import { youtubeService } from '@/lib/youtube/youtube-service'

interface ChannelVideoItem {
  youtubeVideoId: string
  title: string
  channelTitle: string
  publishedAt: string
  videoUrl: string
}

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> }
): Promise<NextResponse> {
  try {
    const { channelId } = await params
    if (!channelId) {
      return NextResponse.json({ success: false, error: 'channelId is required' }, { status: 400 })
    }

    const searchParams = new URL(request.url).searchParams
    const exclude = searchParams.get('exclude') || ''
    const limit = Math.min(20, Math.max(1, Number(searchParams.get('limit') || '10')))

    const playlistItems = await youtubeService.getLatestVideosForChannel(channelId, limit + 4, {
      allowCaptionlessFallback: true,
      allowLiveKeyword: true,
    })

    const items: ChannelVideoItem[] = playlistItems
      .filter((item) => item.snippet.resourceId.videoId !== exclude)
      .slice(0, limit)
      .map((item) => ({
        youtubeVideoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle || channelId,
        publishedAt: item.snippet.publishedAt,
        videoUrl: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
      }))

    return NextResponse.json({ success: true, items })
  } catch (error) {
    console.error('Error fetching channel videos:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch channel videos' },
      { status: 500 }
    )
  }
}

