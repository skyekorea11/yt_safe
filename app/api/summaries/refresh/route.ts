import { NextResponse } from 'next/server'
import { videoRepository } from '@/lib/supabase/videos'
import { summaryService } from '@/lib/summarization/summary-service'
import { parseSummaryRefreshBody } from '@/lib/api/validate'
import { logger } from '@/lib/logger'

// POST /api/summaries/refresh - regenerate summaries/transcripts for all videos
export async function POST(request: Request) {
  try {
    const { force: forceRefresh, useTranscriptPipeline } = parseSummaryRefreshBody(
      await request.json().catch(() => null)
    )
    const videos = await videoRepository.getAll()
    for (const v of videos) {
      await summaryService.getSummary(
        v.youtube_video_id,
        v.title,
        v.description,
        useTranscriptPipeline,
        forceRefresh
      )
    }
    return NextResponse.json({ success: true, count: videos.length, forceRefresh, useTranscriptPipeline })
  } catch (err) {
    logger.error('Batch refresh error:', err)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
