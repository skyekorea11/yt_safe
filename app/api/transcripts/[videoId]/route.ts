/**
 * POST /api/transcripts/[videoId] - Extract transcript from YouTube video
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTranscriptProvider } from '@/lib/transcript/transcript-provider'
import { videoRepository } from '@/lib/supabase/videos'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
): Promise<NextResponse> {
  try {
    const { videoId } = await params

    // parse body: may optionally contain videoIds array for batch processing
    const body = await request.json().catch(() => ({}))
    const ids: string[] = []
    const force = body.force === true

    if (Array.isArray(body.videoIds)) {
      ids.push(...body.videoIds)
    }
    if (videoId && videoId !== 'batch') {
      ids.push(videoId)
    }

    if (ids.length > 1) {
      // batch mode
      const provider = getTranscriptProvider()
      if (!provider.isAvailable()) {
        return NextResponse.json(
          { success: false, error: 'Transcript provider not available', source: 'none' },
          { status: 503 }
        )
      }

      const uniqueIds = [...new Set(ids.filter(Boolean))]
      const results = new Map<string, string>()

      await Promise.all(uniqueIds.map(async (id) => {
        try {
          const existing = await videoRepository.getByYouTubeId(id)
          if (!force && existing?.transcript_text) {
            results.set(id, 'cached')
            return
          }

          await videoRepository.updateTranscript(id, '', 'pending')
          const result = await provider.fetchTranscript(id)
          if (result.status === 'READY' && result.text) {
            await videoRepository.updateTranscript(id, result.text, 'extracted')
            results.set(id, 'extracted')
          } else if (result.status === 'NOT_AVAILABLE') {
            await videoRepository.updateTranscript(id, '', 'not_available')
            results.set(id, 'not_available')
          } else {
            await videoRepository.updateTranscript(id, '', 'failed')
            results.set(id, 'failed')
          }
        } catch {
          results.set(id, 'failed')
        }
      }))

      return NextResponse.json({ success: true, results: Object.fromEntries(results) }, { status: 200 })
    }

    // single-video fallback (ids.length === 1)
    const singleId = ids[0]
    if (!singleId) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 })
    }

    // check cache first
    const existing = await videoRepository.getByYouTubeId(singleId)
    if (!force && existing?.transcript_text) {
      return NextResponse.json(
        {
          success: true,
          source: 'cached',
          transcript: existing.transcript_text,
          status: existing.transcript_status,
        },
        { status: 200 }
      )
    }

    // if transcript already processed status indicates no need to refetch
    if (
      !force &&
      existing &&
      (existing.transcript_status === 'extracted' || existing.transcript_status === 'not_available')
    ) {
      // nothing to do — just return current row
      return NextResponse.json(
        {
          success: true,
          source: 'skipped',
          status: existing.transcript_status,
        },
        { status: 200 }
      )
    }

    // otherwise invoke provider normally (single)
    const provider = getTranscriptProvider()
    console.log('using transcript provider:', provider.getName())

    if (!provider.isAvailable()) {
      return NextResponse.json(
        { success: false, error: 'Transcript provider not available', source: 'none' },
        { status: 503 }
      )
    }

    await videoRepository.updateTranscript(singleId, '', 'pending')
    const result = await provider.fetchTranscript(singleId)

    if (result.status === 'READY' && result.text) {
      await videoRepository.updateTranscript(singleId, result.text, 'extracted')
      return NextResponse.json(
        { success: true, source: result.source, transcript: result.text, status: 'extracted' },
        { status: 200 }
      )
    } else if (result.status === 'NOT_AVAILABLE') {
      await videoRepository.updateTranscript(singleId, '', 'not_available')
      return NextResponse.json(
        { success: false, error: 'No transcript available for this video', status: 'not_available' },
        { status: 404 }
      )
    } else {
      await videoRepository.updateTranscript(singleId, '', 'failed')
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to fetch transcript', status: 'failed' },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Error in transcript API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
