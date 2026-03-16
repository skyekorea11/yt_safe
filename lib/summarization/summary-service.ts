import { getTranscriptProvider } from '@/lib/transcript/transcript-provider'
import { DescriptionBasedSummarizer, getLocalSummarizer, HeuristicTranscriptSummarizer } from '@/lib/summarization/local-summarizer'
import { videoRepository } from '@/lib/supabase/videos'
import { buildHeuristicSummary, cleanTranscript, ensureKoreanSummary, formatSummaryText } from '@/lib/utils/transcript'

/**
 * Summary service orchestrates transcript extraction and summarization
 */

export const summaryService = {
  /**
   * Generate or fetch summary for a video
   *
   * ✅ 수정: 파라미터 순서 통일
   *   (videoId, title, description, useTranscriptPipeline, forceRefresh)
   *   기존엔 forceRefresh와 useTranscriptPipeline 순서가 뒤바뀌어 있었음
   */
  async getSummary(
    videoId: string,
    title: string,
    description: string,
    useTranscriptPipeline = true,
    forceRefresh = false
  ): Promise<{ text: string; sourceType: 'transcript' | 'description' } | null> {
    try {
      const video = await videoRepository.getByYouTubeId(videoId)

      // 이미 완성된 transcript 요약이 있으면 바로 반환
      if (
        video &&
        !forceRefresh &&
        video.summary_status === 'complete' &&
        video.summary_source_type === 'transcript'
      ) {
        return { text: video.summary_text || '', sourceType: 'transcript' }
      }

      // description 요약만 있고 파이프라인이 켜져 있으면 transcript로 업그레이드 시도
      if (
        useTranscriptPipeline &&
        video &&
        !forceRefresh &&
        video.summary_status === 'complete' &&
        video.summary_source_type === 'description'
      ) {
        if (video.transcript_text) {
          const upgrade = await this.generateTranscriptSummary(videoId, video.transcript_text)
          if (upgrade) return upgrade
        }
        return { text: video.summary_text || '', sourceType: 'description' }
      }

      // 파이프라인 꺼져 있고 description 요약 있으면 반환
      if (
        !useTranscriptPipeline &&
        video &&
        !forceRefresh &&
        video.summary_status === 'complete' &&
        video.summary_source_type === 'description'
      ) {
        return { text: video.summary_text || '', sourceType: 'description' }
      }

      // transcript는 있는데 요약이 없거나 refresh 필요한 경우
      if (video?.transcript_text && video.transcript_status === 'extracted') {
        const direct = await this.generateTranscriptSummary(videoId, video.transcript_text)
        if (direct) return direct
      }

      // 캐시 없음 또는 forceRefresh → 전체 파이프라인 실행
      return await this.generateNewSummary(videoId, title, description, useTranscriptPipeline)
    } catch (error) {
      console.error('Error getting summary:', error)
      return null
    }
  },

  /**
   * 새 요약 생성: transcript 우선, 실패 시 실패 메시지 저장
   */
  async generateNewSummary(
    videoId: string,
    title: string,
    description: string,
    useTranscriptPipeline = true
  ): Promise<{ text: string; sourceType: 'transcript' | 'description' } | null> {
    try {
      const fallbackToDescription = async () => (
        this.generateDescriptionSummary(videoId, title, description)
      )

      const transcriptProvider = getTranscriptProvider()
      const existing = await videoRepository.getByYouTubeId(videoId)

      let transcript: string | null = existing?.transcript_text || null

      // transcript가 아직 없으면 추출 시도
      if (!transcript && useTranscriptPipeline) {
        if (transcriptProvider.isAvailable()) {
          console.log(`[summary] extracting transcript for ${videoId} via ${transcriptProvider.getName()}`)
          await videoRepository.updateTranscript(videoId, '', 'pending')

          try {
            const result = await transcriptProvider.fetchTranscript(videoId)
            if (result.status === 'READY' && result.text) {
              transcript = cleanTranscript(result.text)
              await videoRepository.updateTranscript(videoId, transcript, 'extracted')
            } else {
              const status = result.status === 'NOT_AVAILABLE' ? 'not_available' : 'failed'
              await videoRepository.updateTranscript(videoId, '', status)
            }
          } catch (err) {
            console.error('[summary] transcript extraction error:', err)
            await videoRepository.updateTranscript(videoId, '', 'failed')
          }
        } else {
          console.warn('[summary] no transcript provider available')
          await videoRepository.updateTranscript(videoId, '', 'failed')
        }
      }

      // transcript 없으면 실패 처리
      if (!transcript) {
        return await fallbackToDescription()
      }

      // transcript 있으면 요약 생성
      return await this.generateTranscriptSummary(videoId, transcript)
    } catch (error) {
      console.error('[summary] Error generating new summary:', error)
      return null
    }
  },

  async generateDescriptionSummary(
    videoId: string,
    title: string,
    description: string
  ): Promise<{ text: string; sourceType: 'description' }> {
    const sourceText = [title, description].filter(Boolean).join('\n').trim()
    const local = getLocalSummarizer()
    let summary: string | null = null

    if (local.isAvailable()) {
      try {
        summary = await local.summarize(sourceText, 180)
      } catch (error) {
        console.error('[summary] local description summarizer failed:', error)
      }
    }

    if (!summary) {
      summary = await new DescriptionBasedSummarizer().summarize(sourceText, 180)
    }

    const fallbackText = summary || sourceText || '요약을 생성할 수 없습니다'
    const formatted = formatSummaryText(fallbackText, 3)
    const ensured = ensureKoreanSummary(formatted, `${title} ${description}`, 3) || formatted

    await videoRepository.updateSummary(
      videoId,
      ensured,
      'description',
      ensured ? 'complete' : 'failed'
    )

    return { text: ensured, sourceType: 'description' }
  },

  /**
   * transcript 문자열로 요약 생성 후 DB 저장
   *
   * ✅ 수정: 기존엔 getLocalSummarizer()를 선언만 하고
   *          실제 summarizer.summarize()를 호출하지 않았음
   */
  async generateTranscriptSummary(
    videoId: string,
    transcript: string
  ): Promise<{ text: string; sourceType: 'transcript' } | null> {
    try {
      const cleanedTranscript = cleanTranscript(transcript)

      if (!cleanedTranscript) {
        const message = '자막 본문을 정리하지 못했습니다'
        await videoRepository.updateSummary(videoId, message, 'transcript', 'failed')
        return { text: message, sourceType: 'transcript' }
      }

      const summarizer = getLocalSummarizer()

      if (!summarizer.isAvailable()) {
        console.warn('[summary] summarizer not available')
        const message = '요약 서비스를 사용할 수 없습니다'
        await videoRepository.updateSummary(videoId, message, 'transcript', 'failed')
        return { text: message, sourceType: 'transcript' }
      }

      console.log(`[summary] summarizing ${videoId} with ${summarizer.getName()}`)

      let summary = await summarizer.summarize(cleanedTranscript, 200)

      if (!summary && !(summarizer instanceof HeuristicTranscriptSummarizer)) {
        console.warn('[summary] primary summarizer failed, falling back to heuristic transcript summary')
        summary = await new HeuristicTranscriptSummarizer().summarize(cleanedTranscript, 200)
      }

      const formattedSummaryRaw = summary
        ? formatSummaryText(summary, 3)
        : formatSummaryText(buildHeuristicSummary(cleanedTranscript, 3), 3)
      const video = await videoRepository.getByYouTubeId(videoId)
      const formattedSummary = ensureKoreanSummary(
        formattedSummaryRaw,
        `${video?.title || ''} ${video?.description || ''} ${cleanedTranscript.slice(0, 500)}`,
        3
      )

      if (formattedSummary) {
        await videoRepository.updateTranscript(videoId, cleanedTranscript, 'extracted')
        await videoRepository.updateSummary(videoId, formattedSummary, 'transcript', 'complete')
        return { text: formattedSummary, sourceType: 'transcript' }
      } else {
        const fallbackFromDescriptionRaw = formatSummaryText(
          await new DescriptionBasedSummarizer().summarize(cleanedTranscript, 200) || '',
          3
        )
        const fallbackFromDescription = ensureKoreanSummary(
          fallbackFromDescriptionRaw,
          `${video?.title || ''} ${video?.description || ''}`,
          3
        )

        if (fallbackFromDescription) {
          await videoRepository.updateTranscript(videoId, cleanedTranscript, 'extracted')
          await videoRepository.updateSummary(videoId, fallbackFromDescription, 'transcript', 'complete')
          return { text: fallbackFromDescription, sourceType: 'transcript' }
        }

        const message = '요약을 생성할 수 없습니다'
        await videoRepository.updateSummary(videoId, message, 'transcript', 'failed')
        return { text: message, sourceType: 'transcript' }
      }
    } catch (error) {
      console.error('[summary] Error summarizing transcript:', error)
      return null
    }
  },

  /**
   * 여러 영상 일괄 요약
   */
  async batchSummarize(
    videos: Array<{ id: string; title: string; description: string }>,
    forceRefresh = false
  ): Promise<Map<string, { text: string; sourceType: 'transcript' | 'description' }>> {
    const summaries = new Map()
    for (const video of videos) {
      const summary = await this.getSummary(video.id, video.title, video.description, true, forceRefresh)
      if (summary) summaries.set(video.id, summary)
    }
    return summaries
  },

  /**
   * 대기 중인 영상들을 순차적으로 요약 처리
   */
  async processPendingSummaries(): Promise<void> {
    const pending = await videoRepository.getPendingSummaries()
    if (pending.length === 0) return

    console.log(`[summary-worker] Processing ${pending.length} pending summaries`)

    for (const video of pending) {
      await videoRepository.updateSummaryStatus(video.youtube_video_id, 'processing')
      try {
        await this.generateNewSummary(video.youtube_video_id, video.title, video.description, true)
      } catch (err) {
        console.error(`[summary-worker] Failed for ${video.youtube_video_id}:`, err)
        await videoRepository.updateSummaryStatus(video.youtube_video_id, 'failed')
      }
    }
  },

  getTranscriptProviderInfo() {
    if (typeof window !== 'undefined') return { name: 'client (unknown)', available: false }
    const provider = getTranscriptProvider()
    return { name: provider.getName(), available: provider.isAvailable() }
  },

  getSummarizerInfo() {
    const summarizer = getLocalSummarizer()
    return { name: summarizer.getName(), available: summarizer.isAvailable() }
  },
}
