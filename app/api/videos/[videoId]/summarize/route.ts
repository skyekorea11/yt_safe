/**
 * POST /api/videos/[videoId]/summarize - Generate summary from transcript
 */

import { NextRequest, NextResponse } from 'next/server'
import { videoRepository } from '@/lib/supabase/videos'
import { summaryService } from '@/lib/summarization/summary-service'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
): Promise<NextResponse> {
  try {
    const { videoId } = await params
    const body = await request.json().catch(() => ({}))
    const force = Boolean(body?.force)
    const useTranscriptPipeline = body?.useTranscriptPipeline !== false

    if (!videoId) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 })
    }

    // Get video from database
    const video = await videoRepository.getByYouTubeId(videoId)

    if (!video) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 })
    }

    // Fast path: cached summary
    if (!force && video.summary_text && video.summary_status === 'complete') {
      return NextResponse.json(
        {
          success: true,
          source: 'cached',
          summary: video.summary_text,
          sourceType: video.summary_source_type,
        },
        { status: 200 }
      )
    }

    const result = await summaryService.getSummary(
      videoId,
      video.title || '',
      video.description || '',
      useTranscriptPipeline,
      force
    )

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Failed to generate summary', status: 'failed' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        summary: result.text,
        sourceType: result.sourceType,
        status: 'complete',
        source: force ? 'refreshed' : 'generated',
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error in summarize API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
